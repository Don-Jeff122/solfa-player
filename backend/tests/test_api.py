from __future__ import annotations

import threading
from pathlib import Path

import fitz

from tests.conftest import FakeOcrEngine, make_client, pdf_bytes, png_bytes, wait_for_scan


class BlockingOcrEngine(FakeOcrEngine):
    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def recognize(self, image):  # noqa: ANN001
        self.started.set()
        if not self.release.wait(timeout=5):
            raise RuntimeError("test OCR was not released")
        return super().recognize(image)


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_rejects_unsupported_and_empty_files(client):
    response = client.post("/api/documents", files={"file": ("sheet.txt", b"hello", "text/plain")})
    assert response.status_code == 415

    response = client.post("/api/documents", files={"file": ("sheet.png", b"", "image/png")})
    assert response.status_code == 400

    response = client.post(
        "/api/documents",
        files={"file": ("sheet.pdf", b"%PDF-broken", "application/pdf")},
    )
    assert response.status_code == 400


def test_rejects_pdf_page_too_large_to_render(client):
    document = fitz.open()
    document.new_page(width=10000, height=10000)
    data = document.tobytes()
    document.close()
    response = client.post(
        "/api/documents",
        files={"file": ("huge.pdf", data, "application/pdf")},
    )
    assert response.status_code == 400
    assert "too large" in response.json()["detail"]


def test_upload_preview_and_scan_image(client):
    response = client.post(
        "/api/documents",
        files={"file": ("solfa sheet.png", png_bytes(), "image/png")},
    )
    assert response.status_code == 201, response.text
    document = response.json()
    assert document["page_count"] == 1
    assert document["kind"] == "image"
    assert document["filename"] == "solfa sheet.png"

    preview = client.get(document["preview_urls"][0])
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/jpeg"
    assert len(preview.content) > 1000

    status = client.post(f"/api/documents/{document['id']}/scan", json={"pages": [1]})
    assert status.status_code == 200, status.text
    finished = wait_for_scan(client, document["id"])
    assert finished["status"] == "completed"
    assert finished["progress"] == 100
    assert finished["pages"][0]["status"] == "completed"

    image = client.get(f"/api/scan/{document['id']}/pages/1/image")
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/jpeg"


def test_scan_result_and_corrections(client):
    response = client.post(
        "/api/documents",
        files={"file": ("sheet.png", png_bytes(), "image/png")},
    )
    document = response.json()
    client.post(f"/api/documents/{document['id']}/scan", json={"pages": [1]})
    wait_for_scan(client, document["id"])

    page_response = client.get(f"/api/scan/{document['id']}/pages/1")
    assert page_response.status_code == 200, page_response.text
    page = page_response.json()
    assert page["page"] == 1
    assert "S: d : d" in page["text"]
    assert page["uncertain_count"] > 0
    assert page["lines"][0]["chars"][0]["kind"] == "solfa"
    assert page["lines"][0]["chars"][2]["kind"] == "solfa"

    char = page["lines"][0]["chars"][0]
    correction = client.post(
        f"/api/scan/{document['id']}/corrections",
        json={"corrections": [{"char_id": char["id"], "text": "s"}]},
    )
    assert correction.status_code == 200, correction.text
    corrected = correction.json()
    assert corrected["text"].startswith("s: d : d")
    assert corrected["lines"][0]["chars"][0]["corrected"] is True

    saved = client.get(f"/api/scan/{document['id']}/pages/1").json()
    assert saved["text"].startswith("s: d : d")

    missing = client.post(
        f"/api/scan/{document['id']}/corrections",
        json={"corrections": [{"char_id": "p1-l99-c0", "text": "x"}]},
    )
    assert missing.status_code == 400


def test_multipage_pdf_current_page_only(client):
    response = client.post(
        "/api/documents",
        files={"file": ("hymn.pdf", pdf_bytes(2), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    document = response.json()
    assert document["page_count"] == 2
    assert len(document["preview_urls"]) == 2

    status = client.post(f"/api/documents/{document['id']}/scan", json={"pages": [2]})
    assert status.status_code == 200
    finished = wait_for_scan(client, document["id"])
    assert finished["status"] == "completed"
    assert finished["selected_pages"] == [2]
    assert finished["pages"][0]["status"] == "pending"
    assert finished["pages"][1]["status"] == "completed"

    assert client.get(f"/api/scan/{document['id']}/pages/1").status_code == 404
    page_two = client.get(f"/api/scan/{document['id']}/pages/2")
    assert page_two.status_code == 200
    assert page_two.json()["page"] == 2

    preview = client.get(document["preview_urls"][1])
    assert preview.status_code == 200


def test_multipage_pdf_scan_all_in_order(client):
    response = client.post(
        "/api/documents",
        files={"file": ("hymn.pdf", pdf_bytes(3), "application/pdf")},
    )
    document = response.json()
    client.post(f"/api/documents/{document['id']}/scan", json={"pages": None})
    finished = wait_for_scan(client, document["id"])
    assert finished["status"] == "completed"
    assert finished["selected_pages"] == [1, 2, 3]
    pages = [client.get(f"/api/scan/{document['id']}/pages/{page}").json() for page in (1, 2, 3)]
    assert [page["page"] for page in pages] == [1, 2, 3]


def test_page_limit(client, tmp_path: Path):
    with make_client(tmp_path, max_pages=2) as limited:
        response = limited.post(
            "/api/documents",
            files={"file": ("long.pdf", pdf_bytes(3), "application/pdf")},
        )
        assert response.status_code == 400
        assert "limit" in response.json()["detail"].lower()


def test_scan_failure_is_reported(tmp_path: Path):
    with make_client(tmp_path, engine=FakeOcrEngine(fail=True)) as failing:
        response = failing.post(
            "/api/documents",
            files={"file": ("sheet.png", png_bytes(), "image/png")},
        )
        document = response.json()
        failing.post(f"/api/documents/{document['id']}/scan", json={"pages": [1]})
        finished = wait_for_scan(failing, document["id"])
        assert finished["status"] == "failed"
        assert finished["error"]
        assert finished["error_hint"]


def test_legacy_scan_endpoint_accepts_pages(client):
    response = client.post(
        "/api/scan",
        files={"file": ("sheet.png", png_bytes(), "image/png")},
        data={"pages": "1"},
    )
    assert response.status_code == 202, response.text
    assert response.json()["status"] in {"queued", "processing"}


def test_invalid_page_request(client):
    document = client.post(
        "/api/documents",
        files={"file": ("sheet.png", png_bytes(), "image/png")},
    ).json()
    response = client.post(f"/api/documents/{document['id']}/scan", json={"pages": [2]})
    assert response.status_code == 400
    response = client.post(f"/api/documents/{document['id']}/scan", json={"pages": []})
    assert response.status_code == 400


def test_active_scan_cannot_be_deleted(tmp_path: Path):
    engine = BlockingOcrEngine()
    with make_client(tmp_path, engine=engine) as client:
        document = client.post(
            "/api/documents",
            files={"file": ("sheet.png", png_bytes(), "image/png")},
        ).json()
        try:
            client.post(f"/api/documents/{document['id']}/scan", json={"pages": [1]})
            assert engine.started.wait(timeout=5)
            blocked = client.delete(f"/api/documents/{document['id']}")
            assert blocked.status_code == 409
            assert client.get(f"/api/documents/{document['id']}").status_code == 200
        finally:
            engine.release.set()
        wait_for_scan(client, document["id"])
        assert client.delete(f"/api/documents/{document['id']}").status_code == 204
        assert client.get(f"/api/documents/{document['id']}").status_code == 404


def test_corrections_require_existing_char(client):
    document = client.post(
        "/api/documents",
        files={"file": ("sheet.png", png_bytes(), "image/png")},
    ).json()
    client.post(f"/api/documents/{document['id']}/scan", json={"pages": [1]})
    wait_for_scan(client, document["id"])
    response = client.post(
        f"/api/scan/{document['id']}/corrections",
        json={"corrections": [{"char_id": "bad", "text": "x"}]},
    )
    assert response.status_code == 400
