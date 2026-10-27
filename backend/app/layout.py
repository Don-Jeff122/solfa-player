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


def _box_height(box: BBox) -> float:
    return max(box.y1 - box.y0, 1.0)


def _same_visual_row(left: ScanLine, right: ScanLine, median_height: float) -> bool:
    overlap = min(left.bbox.y1, right.bbox.y1) - max(left.bbox.y0, right.bbox.y0)
    if overlap > 0:
        ratio = overlap / min(_box_height(left.bbox), _box_height(right.bbox))
        if ratio >= 0.5:
            return True
    left_center = (left.bbox.y0 + left.bbox.y1) / 2
    right_center = (right.bbox.y0 + right.bbox.y1) / 2
    return abs(left_center - right_center) <= max(6.0, median_height * 0.28)


def _group_visual_rows(lines: list[ScanLine]) -> list[list[ScanLine]]:
    if not lines:
        return []
    ordered = sorted(lines, key=lambda line: (line.bbox.y0, line.bbox.x0))
    heights = sorted(_box_height(line.bbox) for line in ordered)
    median_height = heights[len(heights) // 2]
    rows: list[list[ScanLine]] = []
    for line in ordered:
        placed = False
        for row in rows:
            if _same_visual_row(row[0], line, median_height):
                row.append(line)
                placed = True
                break
        if not placed:
            rows.append([line])
    rows.sort(key=lambda row: (min(line.bbox.y0 for line in row), min(line.bbox.x0 for line in row)))
    for row in rows:
        row.sort(key=lambda line: (line.bbox.x0, line.bbox.y0))
    return rows


def _row_groups(lines: list[ScanLine]) -> list[list[ScanLine]]:
    rows = _group_visual_rows(lines)
    for index, row in enumerate(rows):
        for line in row:
            line.row = index
    return rows


def _median_char_width(lines: list[ScanLine]) -> float:
    widths = sorted(
        char.bbox.x1 - char.bbox.x0
        for line in lines
        for char in line.chars
        if char.bbox.x1 > char.bbox.x0
    )
    return widths[len(widths) // 2] if widths else 12.0


def merge_line_fragments(
    lines: list[ScanLine],
    page_number: int,
    threshold: float,
) -> list[ScanLine]:
    """Merge OCR fragments that describe the same printed row.

    PaddleOCR often returns several horizontal boxes for one long solfa row.
    Treating each box as an independent line destroys the four-part order and
    puts fragments from different voices into separate systems. Fragments are
    joined left-to-right here, while their character boxes keep their original
    page coordinates for review and source highlighting.
    """
    rows = _group_visual_rows(lines)
    merged: list[ScanLine] = []
    for row_index, row in enumerate(rows):
        line_index = len(merged)
        if len(row) == 1:
            fragment = row[0]
            old_to_new: dict[str, str] = {}
            chars: list[ScanChar] = []
            for char_index, char in enumerate(fragment.chars):
                new_id = f"p{page_number}-l{line_index}-c{char_index}"
                old_to_new[char.id] = new_id
                chars.append(char.model_copy(update={"id": new_id}))
            for char in chars:
                if char.modifier_of:
                    char.modifier_of = old_to_new.get(char.modifier_of)
            merged.append(
                fragment.model_copy(
                    update={
                        "id": f"p{page_number}-l{line_index}",
                        "chars": chars,
                        "row": row_index,
                    }
                )
            )
            continue
        median_char = _median_char_width(row)
        text = ""
        chars = []
        old_to_new = {}
        previous_x1: float | None = None
        char_index = 0
        for fragment in row:
            stripped = fragment.text.strip()
            if not stripped:
                continue
            if previous_x1 is not None:
                gap = fragment.bbox.x0 - previous_x1
                spaces = min(8, max(1, round(gap / median_char))) if gap > 1 else 1
                text += " " * spaces
            leading = len(fragment.text) - len(fragment.text.lstrip())
            start = len(text)
            text += stripped
            for char in fragment.chars:
                if char.offset < leading or char.offset >= leading + len(stripped):
                    continue
                new_id = f"p{page_number}-l{line_index}-c{char_index}"
                old_to_new[char.id] = new_id
                chars.append(
                    char.model_copy(
                        update={
                            "id": new_id,
                            "offset": start + char.offset - leading,
                        }
                    )
                )
                char_index += 1
            previous_x1 = fragment.bbox.x1
        if not text:
            continue
        for char in chars:
            if char.modifier_of:
                char.modifier_of = old_to_new.get(char.modifier_of)
        box = BBox(
            x0=min(fragment.bbox.x0 for fragment in row),
            y0=min(fragment.bbox.y0 for fragment in row),
            x1=max(fragment.bbox.x1 for fragment in row),
            y1=max(fragment.bbox.y1 for fragment in row),
        )
        total_chars = sum(max(len(fragment.chars), 1) for fragment in row)
        confidence = (
            sum(fragment.confidence * max(len(fragment.chars), 1) for fragment in row)
            / total_chars
        )
        merged.append(
            ScanLine(
                id=f"p{page_number}-l{line_index}",
                text=text,
                raw_text=text,
                bbox=box,
                confidence=round(confidence, 4),
                uncertain=any(char.uncertain for char in chars) or confidence < threshold,
                chars=chars,
                row=row_index,
            )
        )
    return merged


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
