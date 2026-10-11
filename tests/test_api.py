import io
import asyncio

import httpx2
import pytest
from PIL import Image

import app as server
from services.arcade_client import ArcadeClient, ArcadeError


def image_bytes():
    output = io.BytesIO()
    Image.new("RGB", (32, 32), "red").save(output, "PNG")
    return output.getvalue()


@pytest.fixture
def mock_mode(monkeypatch):
    monkeypatch.setenv("ARCADE_MODE", "mock")


@pytest.fixture
async def client():
    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=server.app), base_url="http://test") as http:
        yield http


async def test_mock_flow_survives_process_state_loss(client, mock_mode):
    categories = (await client.get("/api/categories")).json()["items"]
    assert all(c["world"] == "print" for c in categories)
    result = await client.post("/api/create", data={
        "category_id": categories[0]["categoryId"], "prompt": "Botanical pillow",
        "request_id": "test-request", "confirmed": "true",
    }, files={"reference": ("reference.png", image_bytes(), "image/png")})
    assert result.status_code == 200
    server._catalog = None
    status = (await client.get(f"/api/creation/{result.json()['id']}")).json()
    assert status["status"] == "succeeded" and status["mode"] == "mock"


@pytest.mark.parametrize("field,value", [
    ("category_id", "invented-category"),
    ("category_id", "23f9c1bf-2fb5-4412-85ba-91cfcf4cba50"),
    ("confirmed", "false"), ("prompt", "   "), ("request_id", "bad/request"),
])
async def test_invalid_creations_are_rejected(client, mock_mode, field, value):
    data = {"category_id": server.snapshot()[0]["categoryId"], "prompt": "pillow",
            "request_id": "test-request", "confirmed": "true", field: value}
    response = await client.post("/api/create", data=data,
        files={"reference": ("reference.png", image_bytes(), "image/png")})
    assert response.status_code == 422


async def test_bad_image_is_rejected(client, mock_mode):
    response = await client.post("/api/create", data={
        "category_id": server.snapshot()[0]["categoryId"], "prompt": "pillow",
        "request_id": "test-request", "confirmed": "true",
    }, files={"reference": ("reference.jpg", b"not an image", "image/jpeg")})
    assert response.status_code == 422


async def test_marketing_site_at_root_and_demo_at_demo(client):
    home = await client.get("/")
    assert home.status_code == 200 and "Build a business from your couch" in home.text
    demo = await client.get("/demo")
    assert demo.status_code == 200 and 'id="video"' in demo.text
    assert (await client.get("/media/hero.mp4")).status_code == 200


async def test_live_catalog_failure_never_silently_switches_to_mock(client, monkeypatch):
    monkeypatch.setenv("ARCADE_MODE", "live")
    monkeypatch.setattr(server, "_catalog", None)
    async def fail():
        raise ArcadeError("Arcade is unavailable")
    monkeypatch.setattr(server.arcade, "categories", fail)
    response = await client.get("/api/categories")
    assert response.status_code == 502


async def test_adapter_reference_then_creation_and_no_key_to_storage():
    requests = []
    def respond(request):
        requests.append(request)
        if request.url.host == "storage.test":
            assert "authorization" not in request.headers
            assert request.content == b"image-bytes"
            return httpx2.Response(200)
        assert request.headers["authorization"] == "Bearer test-key"
        if request.url.path.endswith("createUpload"):
            return httpx2.Response(200, json={"uploadUrl": "https://storage.test/ref",
                "uploadId": "upload.png", "requiredHeaders": {"Content-Type": "image/jpeg"}})
        if request.url.path == "/v1/references/create":
            return httpx2.Response(200, json={"referenceId": "ref-123"})
        return httpx2.Response(200, json={"jobId": "job-123", "status": "running"})
    adapter = ArcadeClient("test-key", transport=httpx2.MockTransport(respond))
    result = await adapter.create(b"image-bytes", "category", "prompt", "request-123")
    assert result["jobId"] == "job-123"
    assert [r.url.path for r in requests] == ["/v1/references/createUpload", "/ref", "/v1/references/create", "/v1/patterns/create"]
    import json
    body = json.loads(requests[-1].content)
    assert body["referenceIds"] == ["ref-123"] and body["categoryId"] == "category"
    assert body["requestId"] == "request-123"


async def test_job_poll_fetches_product_and_renews_preview():
    def respond(request):
        if request.url.path.endswith("jobs/get"):
            return httpx2.Response(200, json={"status": "succeeded", "result": {"productId": "prod-1"}})
        return httpx2.Response(200, json={"productId": "prod-1", "imageUrl": "https://example.com/preview.jpg"})
    adapter = ArcadeClient("test-key", transport=httpx2.MockTransport(respond))
    job, product = await adapter.status("job-1")
    assert job["status"] == "succeeded" and product["productId"] == "prod-1"


async def test_upstream_error_is_sanitized():
    adapter = ArcadeClient("test-key", transport=httpx2.MockTransport(
        lambda _: httpx2.Response(401, text="secret-value upstream body")))
    with pytest.raises(ArcadeError) as error:
        await adapter.categories()
    assert "secret-value" not in str(error.value)


async def test_live_api_passes_validated_reference_and_job(client, monkeypatch):
    monkeypatch.setenv("ARCADE_MODE", "live")
    monkeypatch.setattr(server, "_catalog", None)
    category = server.snapshot()[0]
    calls = []
    async def categories():
        return [category]
    async def create(data, category_id, prompt, request_id):
        calls.append((data, category_id, prompt, request_id))
        return {"jobId": "real-job", "status": "running"}
    async def status(job_id):
        assert job_id == "real-job"
        return {"status": "succeeded"}, {"productId": "prod-1", "title": "Pillow", "imageUrl": "https://example.com/pillow.jpg"}
    monkeypatch.setattr(server.arcade, "categories", categories)
    monkeypatch.setattr(server.arcade, "create", create)
    monkeypatch.setattr(server.arcade, "status", status)
    result = await client.post("/api/create", data={
        "category_id": category["categoryId"], "prompt": "  My edited design  ",
        "request_id": "same-id-on-retry", "confirmed": "true",
    }, files={"reference": ("reference.png", image_bytes(), "image/png")})
    assert result.json() == {"id": "real-job", "status": "running", "mode": "live"}
    assert calls[0][0].startswith(b"\xff\xd8")  # validated and converted to JPEG
    assert calls[0][2:] == ("My edited design", "same-id-on-retry")
    response = await client.get("/api/creation/real-job")
    assert response.json()["product"]["productId"] == "prod-1"


async def test_failed_job_returns_useful_failure(client, monkeypatch):
    monkeypatch.setenv("ARCADE_MODE", "live")
    async def status(_job_id):
        return {"status": "failed", "error": {"message": "upstream raw body"}}, None
    monkeypatch.setattr(server.arcade, "status", status)
    response = await client.get("/api/creation/failed-job")
    assert response.json()["status"] == "failed"
    assert "Edit the prompt" in response.json()["error"]


async def test_too_large_image_rejected(client, mock_mode):
    response = await client.post("/api/create", data={
        "category_id": server.snapshot()[0]["categoryId"], "prompt": "pillow",
        "request_id": "test-request", "confirmed": "true",
    }, files={"reference": ("reference.jpg", b"x" * 3_000_001, "image/jpeg")})
    assert response.status_code == 422


async def test_deadline_cancels_stalled_upstream_operation():
    cancelled = asyncio.Event()
    async def stuck():
        try:
            await asyncio.sleep(60)
        finally:
            cancelled.set()
    with pytest.raises(ArcadeError) as error:
        await server.bounded(stuck(), 0.01, "Status check timed out")
    assert error.value.status_code == 504
    assert cancelled.is_set()

