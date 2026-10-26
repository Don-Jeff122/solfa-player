from __future__ import annotations

import math
import unicodedata

from .schemas import BBox, CorrectionItem, PageResult, ScanChar, ScanLine

SOLFA = set("drmfslt")
SUBSCRIPT_DIGITS = "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089"
NOTE_MODIFIERS = "'\u2019,"
SOLFA_MODIFIERS = set(NOTE_MODIFIERS + "0123456789" + SUBSCRIPT_DIGITS)
PUNCTUATION = set(":|/-.,;!?(){}[]<>\"_'=+*&%$#@~`\\")
DIGITS = set("0123456789" + SUBSCRIPT_DIGITS)


def char_weight(char: str) -> float:
    if char.isspace():
        return 0.58
    if unicodedata.east_asian_width(char) in {"W", "F"}:
        return 2.0
    if char in "ilI.,:;'`!|1":
        return 0.45
    if char in "mwMW@":
        return 1.4
    if char.isupper():
        return 1.08
    return 1.0


def classify_char(char: str) -> str:
    if "\ufffd" in char:
        return "unknown"
    if char and char[0].lower() in SOLFA and all(
        c.lower() in SOLFA or c in SOLFA_MODIFIERS for c in char
    ):
        return "solfa"
    if char and all(c in DIGITS for c in char):
        return "digit"
    if char and all(c in PUNCTUATION for c in char):
        return "punctuation"
    if any(c.isalpha() or c.isdigit() for c in char):
        return "text"
    return "unknown"


def _tokenize(
    text: str,
    bbox: BBox,
    confidence: float,
    page_number: int,
    line_index: int,
    threshold: float,
) -> list[ScanChar]:
    if not text:
        return []
    weights = [char_weight(c) for c in text]
    total = sum(weights) or 1.0
    cursor = bbox.x0
    width = max(bbox.x1 - bbox.x0, 1.0)
    chars: list[ScanChar] = []
    char_index = 0
    previous_solfa: ScanChar | None = None
    for offset, char in enumerate(text):
        span = width * (weights[offset] / total)
        x0 = cursor
        x1 = cursor + span
        cursor = x1
        if char.isspace():
            continue
        kind = classify_char(char)
        uncertain = confidence < threshold or "\ufffd" in char
        modifier_of = None
        immediate = previous_solfa is not None and previous_solfa.offset == offset - 1
        if immediate and char in SUBSCRIPT_DIGITS:
            kind = "solfa"
            modifier_of = previous_solfa.id
        chars.append(
            ScanChar(
                id=f"p{page_number}-l{line_index}-c{char_index}",
                text=char,
                bbox=BBox(x0=x0, y0=bbox.y0, x1=x1, y1=bbox.y1),
                confidence=round(confidence, 4),
                uncertain=uncertain,
                kind=kind,  # type: ignore[arg-type]
                offset=offset,
                modifier_of=modifier_of,
            )
        )
        if kind == "solfa":
            previous_solfa = chars[-1]
        char_index += 1
    return chars


def make_line(
    text: str,
    bbox: tuple[float, float, float, float],
    confidence: float,
    page_number: int,
    line_index: int,
    threshold: float,
) -> ScanLine:
    x0, y0, x1, y1 = bbox
    box = BBox(
        x0=max(0.0, x0),
        y0=max(0.0, y0),
        x1=max(0.0, x1),
        y1=max(0.0, y1),
    )
    chars = _tokenize(text, box, confidence, page_number, line_index, threshold)
    return ScanLine(
        id=f"p{page_number}-l{line_index}",
        text=text,
        raw_text=text,
        bbox=box,
        confidence=round(confidence, 4),
        uncertain=confidence < threshold or "\ufffd" in text,
        chars=chars,
    )


def _row_groups(lines: list[ScanLine]) -> list[list[ScanLine]]:
    if not lines:
        return []
    ordered = sorted(lines, key=lambda line: (line.bbox.y0, line.bbox.x0))
    heights = [max(line.bbox.y1 - line.bbox.y0, 1.0) for line in ordered]
    tolerance = max(6.0, sorted(heights)[len(heights) // 2] * 0.55)
    rows: list[list[ScanLine]] = []
    for line in ordered:
        cy = (line.bbox.y0 + line.bbox.y1) / 2
        placed = False
        for row in rows:
            row_y0 = min(item.bbox.y0 for item in row)
            row_y1 = max(item.bbox.y1 for item in row)
            row_cy = (row_y0 + row_y1) / 2
            overlap = min(line.bbox.y1, row_y1) - max(line.bbox.y0, row_y0)
            if overlap > 0 or abs(cy - row_cy) <= tolerance:
                row.append(line)
                placed = True
                break
        if not placed:
            rows.append([line])
    rows.sort(key=lambda row: (min(line.bbox.y0 for line in row), min(line.bbox.x0 for line in row)))
    for index, row in enumerate(rows):
        row.sort(key=lambda line: line.bbox.x0)
        for line in row:
            line.row = index
    return rows


def compose_text(lines: list[ScanLine]) -> str:
    """Build editable text while keeping visual rows and wide column gaps apart."""
    rows = _row_groups(lines)
    if not rows:
        return ""
    left = min(line.bbox.x0 for line in lines)
    char_widths = [
        char.bbox.x1 - char.bbox.x0
        for line in lines
        for char in line.chars
        if char.bbox.x1 > char.bbox.x0
    ]
    median_char = sorted(char_widths)[len(char_widths) // 2] if char_widths else 12.0
    if median_char <= 0:
        median_char = 12.0
    output: list[str] = []
    for row in rows:
        clusters: list[list[ScanLine]] = []
        for line in row:
            if clusters and line.bbox.x0 - max(item.bbox.x1 for item in clusters[-1]) <= max(
                2.5 * median_char, 40.0
            ):
                clusters[-1].append(line)
            else:
                clusters.append([line])
        for cluster in clusters:
            indent = min(24, max(0, round((cluster[0].bbox.x0 - left) / median_char)))
            pieces: list[str] = []
            for index, line in enumerate(cluster):
                if index:
                    gap = line.bbox.x0 - cluster[index - 1].bbox.x1
                    spaces = min(8, max(1, round(gap / median_char)))
                    pieces.append(" " * spaces)
                pieces.append(line.text.rstrip())
            text = "".join(pieces).strip()
            if text:
                output.append(" " * indent + text)
    return "\n".join(output)


def page_statistics(lines: list[ScanLine]) -> tuple[float, int]:
    uncertain_count = sum(
        1 for line in lines for char in line.chars if char.uncertain and not char.corrected
    )
    scored = [char.confidence for line in lines for char in line.chars]
    mean = sum(scored) / len(scored) if scored else 0.0
    return round(mean, 4), uncertain_count


def apply_corrections(
    page: PageResult, corrections: list[CorrectionItem]
) -> tuple[PageResult, list[str]]:
    by_id = {char.id: char for line in page.lines for char in line.chars}
    values = {item.char_id: item.text for item in corrections if item.char_id in by_id}
    missing = [item.char_id for item in corrections if item.char_id not in by_id]
    if not values:
        return page, missing

    for line in page.lines:
        original = line.raw_text
        pieces: list[str] = []
        cursor = 0
        for char in sorted(line.chars, key=lambda item: item.offset):
            if char.offset < 0 or char.offset >= len(original):
                continue
            pieces.append(original[cursor : char.offset])
            if char.id in values:
                char.text = values[char.id]
                char.corrected = True
                char.uncertain = False
                char.confidence = 1.0
                char.kind = classify_char(char.text)  # type: ignore[assignment]
            pieces.append(char.text)
            cursor = char.offset + 1
        pieces.append(original[cursor:])
        line.text = "".join(pieces)
        if line.chars:
            line.confidence = round(
                sum(char.confidence for char in line.chars) / len(line.chars), 4
            )
            line.uncertain = any(
                char.uncertain for char in line.chars if not char.corrected
            )
        else:
            line.uncertain = False

    page.text = compose_text(page.lines)
    page.mean_confidence, page.uncertain_count = page_statistics(page.lines)
    return page, missing


def median(values: list[float], fallback: float = 0.0) -> float:
    if not values:
        return fallback
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def line_height_range(lines: list[ScanLine]) -> tuple[float, float]:
    heights = [line.bbox.y1 - line.bbox.y0 for line in lines]
    return median(heights, 10.0), max(heights, default=10.0)


def safe_number(value: float, fallback: float = 0.0) -> float:
    return float(value) if math.isfinite(value) else fallback
