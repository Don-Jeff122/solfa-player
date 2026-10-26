from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import fitz
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import Settings
from .layout import median
from .schemas import BBox, ScanLine, ScanRule

Image.MAX_IMAGE_PIXELS = 80_000_000
MAX_SOURCE_PIXELS = 60_000_000


class ImageInputError(ValueError):
    pass


@dataclass
class SourceInfo:
    kind: str
    page_count: int
    page_sizes: list[tuple[int, int]]


@dataclass
class PreparedPage:
    image: np.ndarray
    gray: np.ndarray
    width: int
    height: int
    deskew_angle: float


def _target_scale(width: int, height: int, settings: Settings) -> float:
    longest = max(width, height, 1)
    scale = 1.0
    if longest > settings.max_image_side:
        scale = settings.max_image_side / longest
    elif longest < settings.min_image_long_side:
        scale = min(settings.min_image_long_side / longest, 2.5)
    return scale


def _pdf_pixel_size(page: fitz.Page, dpi: int) -> tuple[int, int]:
    zoom = dpi / 72.0
    return max(1, round(page.rect.width * zoom)), max(1, round(page.rect.height * zoom))


def _pdf_page_bgr(document: fitz.Document, page_number: int, dpi: int) -> np.ndarray:
    page = document[page_number - 1]
    width, height = _pdf_pixel_size(page, dpi)
    if width * height > MAX_SOURCE_PIXELS:
        raise ImageInputError("This PDF page is too large to render safely.")
    zoom = dpi / 72.0
    pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False, colorspace=fitz.csRGB)
    rgb = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def _read_image(path: Path) -> np.ndarray:
    try:
        with Image.open(path) as opened:
            if opened.width * opened.height > MAX_SOURCE_PIXELS:
                raise ImageInputError(
                    "The image has too many pixels. Downscale it below 60 megapixels and retry."
                )
            image = ImageOps.exif_transpose(opened)
            if image.mode in {"RGBA", "LA"} or (
                image.mode == "P" and "transparency" in image.info
            ):
                rgba = image.convert("RGBA")
                flattened = Image.new("RGB", rgba.size, "white")
                flattened.paste(rgba, mask=rgba.getchannel("A"))
                image = flattened
            else:
                image = image.convert("RGB")
            rgb = np.asarray(image)
    except ImageInputError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageInputError("The image could not be opened or is damaged.") from exc
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ImageInputError("The image format is not supported.")
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def inspect_source(path: Path, kind: str, settings: Settings) -> SourceInfo:
    if kind == "pdf":
        try:
            with fitz.open(path) as document:
                if document.needs_pass:
                    raise ImageInputError("This PDF is password protected. Remove the password and try again.")
                if document.page_count == 0:
                    raise ImageInputError("This PDF has no pages.")
                if document.page_count > settings.max_pages:
                    raise ImageInputError(
                        f"This PDF has {document.page_count} pages. The limit is {settings.max_pages}."
                    )
                sizes: list[tuple[int, int]] = []
                for page in document:
                    width, height = _pdf_pixel_size(page, settings.pdf_dpi)
                    if width * height > MAX_SOURCE_PIXELS:
                        raise ImageInputError("This PDF has a page that is too large to render safely.")
                    scale = _target_scale(width, height, settings)
                    sizes.append((max(1, round(width * scale)), max(1, round(height * scale))))
                return SourceInfo("pdf", document.page_count, sizes)
        except ImageInputError:
            raise
        except Exception as exc:
            raise ImageInputError("This PDF could not be opened or is damaged.") from exc

    image = _read_image(path)
    height, width = image.shape[:2]
    if width < 20 or height < 20:
        raise ImageInputError("The image is too small to scan.")
    scale = _target_scale(width, height, settings)
    return SourceInfo("image", 1, [(max(1, round(width * scale)), max(1, round(height * scale)))])


def load_page(path: Path, kind: str, page_number: int, settings: Settings) -> np.ndarray:
    if kind == "pdf":
        try:
            with fitz.open(path) as document:
                if page_number < 1 or page_number > document.page_count:
                    raise ImageInputError(f"Page {page_number} does not exist.")
                return _pdf_page_bgr(document, page_number, settings.pdf_dpi)
        except ImageInputError:
            raise
        except Exception as exc:
            raise ImageInputError(f"Page {page_number} could not be rendered.") from exc
    if page_number != 1:
        raise ImageInputError("An image has only one page.")
    return _read_image(path)


def _estimate_skew(gray: np.ndarray) -> float:
    height, width = gray.shape[:2]
    if min(height, width) < 120:
        return 0.0
    small = gray
    if max(height, width) > 1800:
        scale = 1800 / max(height, width)
        small = cv2.resize(gray, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    edges = cv2.Canny(small, 60, 180)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 1800,
        threshold=max(40, small.shape[1] // 16),
        minLineLength=max(40, small.shape[1] // 5),
        maxLineGap=8,
    )
    if lines is None:
        return 0.0
    samples: list[tuple[float, float]] = []
    for x1, y1, x2, y2 in lines[:, 0]:
        dx, dy = int(x2) - int(x1), int(y2) - int(y1)
        length = math.hypot(dx, dy)
        angle = math.degrees(math.atan2(dy, dx))
        if length < 25 or abs(angle) > 9 or abs(angle) < 0.2:
            continue
        samples.append((angle, length))
    if not samples:
        return 0.0
    samples.sort(key=lambda item: item[0])
    weighted = [angle for angle, length in samples for _ in range(max(1, round(length / 60)))]
    return float(median([float(value) for value in weighted], 0.0))


def _rotate(image: np.ndarray, angle: float) -> np.ndarray:
    height, width = image.shape[:2]
    center = (width / 2, height / 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    border = tuple(int(v) for v in image[0, 0]) if image.ndim == 3 else int(image[0, 0])
    return cv2.warpAffine(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=border,
    )


def _enhance(color: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lab = cv2.cvtColor(color, cv2.COLOR_BGR2LAB)
    lightness, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    lightness = clahe.apply(lightness)
    enhanced = cv2.cvtColor(cv2.merge((lightness, a, b)), cv2.COLOR_LAB2BGR)
    gray = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY)
    return enhanced, gray


def prepare_page(path: Path, kind: str, page_number: int, settings: Settings) -> PreparedPage:
    color = load_page(path, kind, page_number, settings)
    height, width = color.shape[:2]
    scale = _target_scale(width, height, settings)
    if abs(scale - 1.0) > 0.01:
        interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
        color = cv2.resize(color, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=interpolation)
    gray_for_skew = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    angle = _estimate_skew(gray_for_skew)
    if abs(angle) >= 0.35:
        color = _rotate(color, angle)
    color, gray = _enhance(color)
    height, width = color.shape[:2]
    return PreparedPage(
        image=color,
        gray=gray,
        width=width,
        height=height,
        deskew_angle=round(angle, 2) if abs(angle) >= 0.35 else 0.0,
    )


def detect_rules(gray: np.ndarray) -> list[ScanRule]:
    height, width = gray.shape[:2]
    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        15,
    )
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(13, width // 110), 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(15, height // 90)))
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=1)
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel, iterations=1)

    rules: list[ScanRule] = []
    index = 0
    for image, orientation in ((horizontal, "horizontal"), (vertical, "vertical")):
        contours, _ = cv2.findContours(image, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if orientation == "horizontal":
                if w < max(18, width // 100) or h > max(7, height // 90) or w < h * 5:
                    continue
            else:
                if h < max(20, height // 100) or w > max(7, width // 120) or h < w * 4:
                    continue
            rules.append(
                ScanRule(
                    id=f"r{index}",
                    orientation=orientation,
                    x0=float(x),
                    y0=float(y),
                    x1=float(x + w),
                    y1=float(y + h),
                )
            )
            index += 1
    rules.sort(key=lambda rule: (rule.y0, rule.x0))
    return rules


def attach_underlines(lines: list[ScanLine], rules: list[ScanRule]) -> list[ScanRule]:
    remaining: list[ScanRule] = []
    for rule in rules:
        if rule.orientation != "horizontal":
            remaining.append(rule)
            continue
        rect = BBox(x0=rule.x0, y0=rule.y0, x1=rule.x1, y1=rule.y1)
        best: ScanLine | None = None
        best_overlap = 0.0
        for line in lines:
            vertical = line.bbox.y1 - line.bbox.y0
            line_h = max(vertical, 1.0)
            if rect.y0 < line.bbox.y0 + line_h * 0.45:
                continue
            if rect.y0 > line.bbox.y1 + line_h * 0.45:
                continue
            overlap = max(0.0, min(rect.x1, line.bbox.x1) - max(rect.x0, line.bbox.x0))
            line_width = max(line.bbox.x1 - line.bbox.x0, 1.0)
            if overlap / line_width >= 0.32 and overlap > best_overlap:
                best = line
                best_overlap = overlap
        if best is not None:
            if best.underline is None:
                best.underline = rect
            else:
                remaining.append(rule)
        else:
            remaining.append(rule)
    return remaining


def write_preview(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    extension = path.suffix.lower()
    if extension in {".jpg", ".jpeg"}:
        quality = [cv2.IMWRITE_JPEG_QUALITY, 92]
        cv2.imwrite(str(path), image, quality)
    else:
        cv2.imwrite(str(path), image)
