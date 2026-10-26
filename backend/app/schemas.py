from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ScanStatus = Literal["uploaded", "queued", "processing", "completed", "failed"]
PageStatus = Literal["pending", "completed", "failed"]
CharKind = Literal["solfa", "punctuation", "digit", "text", "unknown"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BBox(StrictModel):
    x0: float
    y0: float
    x1: float
    y1: float


class ScanChar(StrictModel):
    id: str
    text: str
    bbox: BBox
    confidence: float
    uncertain: bool
    kind: CharKind
    corrected: bool = False
    offset: int
    modifier_of: str | None = None


class ScanLine(StrictModel):
    id: str
    text: str
    raw_text: str
    bbox: BBox
    confidence: float
    uncertain: bool
    chars: list[ScanChar]
    underline: BBox | None = None
    row: int = 0


class ScanRule(StrictModel):
    id: str
    orientation: Literal["horizontal", "vertical"]
    x0: float
    y0: float
    x1: float
    y1: float


class PageResult(StrictModel):
    page: int
    width: int
    height: int
    lines: list[ScanLine]
    rules: list[ScanRule]
    text: str
    mean_confidence: float
    uncertain_count: int
    image_url: str


class PageSummary(StrictModel):
    page: int
    width: int
    height: int
    status: PageStatus = "pending"
    line_count: int = 0
    uncertain_count: int = 0
    image_url: str | None = None


class DocumentInfo(StrictModel):
    id: str
    filename: str
    kind: Literal["image", "pdf"]
    page_count: int
    pages: list[PageSummary]
    max_pages: int
    max_upload_mb: int
    preview_urls: list[str]


class ScanStatusResponse(StrictModel):
    id: str
    filename: str
    kind: Literal["image", "pdf"]
    page_count: int
    selected_pages: list[int]
    status: ScanStatus
    stage: str
    progress: int = 0
    error: str | None = None
    error_hint: str | None = None
    pages: list[PageSummary]
    created_at: str
    updated_at: str


class ScanRequest(StrictModel):
    pages: list[int] | None = None


class CorrectionItem(StrictModel):
    char_id: str
    text: str = Field(min_length=1, max_length=12)


class CorrectionsRequest(StrictModel):
    corrections: list[CorrectionItem] = Field(min_length=1, max_length=500)


class HealthResponse(StrictModel):
    status: Literal["ok"]
    service: str
    ocr: str
