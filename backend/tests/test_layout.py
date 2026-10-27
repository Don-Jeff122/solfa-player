from __future__ import annotations

import numpy as np

from app.imaging import attach_underlines, detect_rules
from app.layout import apply_corrections, compose_text, make_line, merge_line_fragments
from app.schemas import BBox, CorrectionItem, PageResult, ScanRule


def page_with(lines, width=1200, height=800) -> PageResult:
    return PageResult(
        page=1,
        width=width,
        height=height,
        lines=lines,
        rules=[],
        text=compose_text(lines),
        mean_confidence=0.8,
        uncertain_count=0,
        image_url="/image.jpg",
    )


def test_tokenization_preserves_notation_and_marks_uncertain():
    line = make_line("S: d₁ : d | m : -", (20, 30, 500, 80), 0.51, 1, 0, 0.72)
    assert line.text == "S: d₁ : d | m : -"
    assert "".join(char.text for char in line.chars) == "S:d₁:d|m:-".replace("₁", "₁")
    assert line.chars[0].kind == "solfa"
    assert line.chars[0].text == "S"
    subscript = next(char for char in line.chars if char.text == "₁")
    assert subscript.kind == "solfa"
    assert subscript.modifier_of == line.chars[2].id
    assert line.uncertain is True
    assert all(char.uncertain for char in line.chars)
    assert line.chars[0].offset == 0


def test_note_notation_is_not_normalized():
    line = make_line("D r M f S l T do re", (0, 0, 300, 40), 0.98, 1, 0, 0.7)
    assert [char.text for char in line.chars][:8] == ["D", "r", "M", "f", "S", "l", "T", "d"]
    assert all(
        char.kind == "solfa" for char in line.chars if char.text.lower() in "drmfslt"
    )


def test_wide_columns_are_not_joined_in_editable_text():
    left = make_line("S: d : d", (40, 50, 240, 90), 0.9, 1, 0, 0.7)
    right = make_line("A: m : m", (700, 50, 900, 90), 0.9, 1, 1, 0.7)
    below = make_line("S: r : r", (40, 160, 240, 200), 0.9, 1, 2, 0.7)
    text = compose_text([right, below, left])
    lines = text.splitlines()
    assert lines[0].strip() == "S: d : d"
    assert lines[1].strip() == "A: m : m"
    assert lines[2].strip() == "S: r : r"
    assert lines[1].startswith(" ")
    assert "S: d : d A: m : m" not in text


def test_merge_line_fragments_rebuilds_rows_and_keeps_character_sources():
    left = make_line("d : d", (40, 50, 180, 90), 0.91, 1, 0, 0.7)
    right = make_line("m : m", (360, 52, 520, 92), 0.87, 1, 1, 0.7)
    below = make_line("s : s", (40, 150, 180, 190), 0.95, 1, 2, 0.7)
    merged = merge_line_fragments([right, below, left], 1, 0.7)
    assert len(merged) == 2
    first, second = merged
    assert first.id == "p1-l0"
    assert second.id == "p1-l1"
    assert first.row == 0
    assert second.row == 1
    assert first.text.startswith("d : d")
    assert first.text.endswith("m : m")
    assert first.raw_text == first.text
    assert second.text == "s : s"
    assert "".join(char.text for char in first.chars) == "d:dm:m"
    assert all(0 <= char.offset < len(first.text) for char in first.chars)
    assert len({char.id for char in first.chars}) == len(first.chars)
    assert min(char.bbox.x0 for char in first.chars) < 200
    assert max(char.bbox.x1 for char in first.chars) > 350


def test_merge_line_fragments_keeps_adjacent_rows_separate_when_boxes_overlap_slightly():
    upper = make_line("d : d", (40, 50, 500, 100), 0.9, 1, 0, 0.7)
    lower = make_line("m : m", (40, 96, 500, 146), 0.9, 1, 1, 0.7)
    merged = merge_line_fragments([lower, upper], 1, 0.7)
    assert [line.text for line in merged] == ["d : d", "m : m"]


def test_correction_changes_only_selected_character_and_survives_second_edit():
    first = make_line("S: d : d | m : -", (20, 30, 500, 80), 0.6, 1, 0, 0.72)
    second = make_line("A: m : m | s : -", (20, 130, 500, 180), 0.9, 1, 1, 0.72)
    page = page_with([first, second])
    selected = next(char for char in first.chars if char.text == "d")
    assert selected.text == "d"
    page, missing = apply_corrections(page, [CorrectionItem(char_id=selected.id, text="r")])
    assert not missing
    assert page.lines[0].text == "S: r : d | m : -"
    assert page.lines[1].text == "A: m : m | s : -"
    page, _ = apply_corrections(
        page, [CorrectionItem(char_id=first.chars[-1].id, text="0")]
    )
    assert page.lines[0].text == "S: r : d | m : 0"
    assert page.lines[0].chars[2].corrected is True


def test_underline_rules_attach_to_nearby_line():
    line = make_line("d : d | m : -", (100, 100, 500, 150), 0.93, 1, 0, 0.7)
    rule = ScanRule(
        id="r0",
        orientation="horizontal",
        x0=100,
        y0=156,
        x1=330,
        y1=160,
    )
    remaining = attach_underlines([line], [rule])
    assert line.underline == BBox(x0=100, y0=156, x1=330, y1=160)
    assert remaining == []


def test_detect_rules_finds_underline_and_separator():
    image = np.full((500, 800), 255, dtype=np.uint8)
    image[160:163, 80:360] = 0
    image[80:420, 440:443] = 0
    rules = detect_rules(image)
    assert any(rule.orientation == "horizontal" for rule in rules)
    assert any(rule.orientation == "vertical" for rule in rules)
