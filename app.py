import asyncio
import json
import logging
import re
import time
from pathlib import Path
from typing import Annotated
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from services.arcade_client import ArcadeClient, ArcadeError
from services.config import live_enabled, load_config
from services.images import normalize_reference

load_config()
ROOT = Path(__file__).parent
app = FastAPI(title="Shoppably", docs_url="/api/docs")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
arcade = ArcadeClient()
_catalog = None
_catalog_at = 0
logger = logging.getLogger("uvicorn.error")


async def bounded(operation, seconds, message):
    try:
        async with asyncio.timeout(seconds):
            return await operation
    except TimeoutError as exc:
        raise ArcadeError(message, 504) from exc


@app.exception_handler(ArcadeError)
async def arcade_error(_request, error):
    logger.warning("Arcade request failed path=%s status=%s", _request.url.path, error.status_code)
    return JSONResponse({"detail": error.message}, status_code=error.status_code)


def snapshot():
    return json.loads((ROOT / "data" / "catalog.json").read_text())["items"]


async def production_categories():
    global _catalog, _catalog_at
    if _catalog is None or time.monotonic() - _catalog_at > 60:
        _catalog = await bounded(arcade.categories(), 15, "Arcade's catalog request timed out. Please retry.")
        _catalog_at = time.monotonic()
    return [item for item in _catalog if item["world"] == "print"]


@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/config")
async def config():
    return {"mode": "live" if live_enabled() else "mock",
            "video_available": (ROOT / "static" / "demo.mp4").exists(),
            "cached_preview_available": (ROOT / "static" / "cached-product.jpg").exists()}


@app.get("/api/categories")
async def categories():
    if live_enabled():
        items = await production_categories()
        source = "live"
    else:
        items = [item for item in snapshot() if item["world"] == "print"]
        source = "snapshot"
    # Category thumbnails can expire and are unnecessary for local classification.
    return {"items": [{"categoryId": item["categoryId"], "name": item["name"], "world": item["world"]}
                      for item in items], "source": source}


@app.post("/api/create")
async def create(
    reference: Annotated[UploadFile, File()],
    category_id: Annotated[str, Form()],
    prompt: Annotated[str, Form(min_length=1, max_length=1000)],
    request_id: Annotated[str, Form(pattern=r"^[a-zA-Z0-9-]{1,80}$")],
    confirmed: Annotated[bool, Form()],
):
    if not confirmed:
        raise HTTPException(422, "Confirm the category and reference before creating.")
    if not prompt.strip():
        raise HTTPException(422, "Enter a design prompt.")
    items = await production_categories() if live_enabled() else snapshot()
    if category_id not in {item["categoryId"] for item in items if item["world"] == "print"}:
        raise HTTPException(422, "Choose a supported reference-compatible Arcade category.")
    data = await reference.read(3_000_001)
    try:
        data = normalize_reference(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not live_enabled():
        return {"id": f"demo-{request_id}", "status": "running", "mode": "mock"}
    logger.info("Arcade submission started request_id=%s", request_id)
    job = await bounded(arcade.create(data, category_id, prompt.strip(), request_id), 40,
                        "Arcade submission timed out. Retry the same design to continue with the same request ID.")
    logger.info("Arcade submission accepted request_id=%s job_id=%s status=%s", request_id, job["jobId"], job["status"])
    return {"id": job["jobId"], "status": job["status"], "mode": "live"}


@app.get("/api/creation/{job_id}")
async def creation(job_id: str):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", job_id):
        raise HTTPException(422, "Invalid creation ID.")
    if not live_enabled():
        if not job_id.startswith("demo-"):
            raise HTTPException(404, "Live jobs require live mode.")
        return {"id": job_id, "status": "succeeded", "mode": "mock",
                "product": {"title": "Demo product preview", "imageUrl": "/static/demo-product.svg"}}
    if job_id.startswith("demo-"):
        raise HTTPException(404, "Demo jobs require mock mode.")
    job, product = await bounded(arcade.status(job_id), 20,
                                 "Arcade's status check timed out. Check again to track the same creation.")
    logger.info("Arcade status job_id=%s status=%s", job_id, job["status"])
    error = "Arcade could not create this design. Edit the prompt and try again." if job["status"] == "failed" else None
    if job["status"] == "succeeded" and product is None:
        error = "The job completed without a product preview. Please retry."
    return {"id": job_id, "status": "failed" if error else job["status"],
            "mode": "live", "error": error, "product": product}


@app.get("/api/demo-preview")
async def demo_preview():
    cached = ROOT / "static" / "cached-product.json"
    if cached.exists() and (ROOT / "static" / "cached-product.jpg").exists():
        product = json.loads(cached.read_text())
        return {"mode": "cached", "product": {"title": product["title"],
                "description": product.get("description", ""),
                "imageUrl": f"/static/cached-product.jpg?v={quote(product.get('productId', 'demo'), safe='')}"}}
    return {"mode": "mock", "product": {"title": "Illustrative demo pillow",
            "imageUrl": "/static/demo-product.svg"}}

