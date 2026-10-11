"""Arcade.ai v1 adapter. Jobs live in Arcade, not process-local storage."""
import os
import logging

import httpx2

logger = logging.getLogger("uvicorn.error")


class ArcadeError(Exception):
    def __init__(self, message, status_code=502):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class ArcadeClient:
    BASE_URL = "https://platform.arcade.ai/v1"

    def __init__(self, key=None, transport=None):
        self.key = key if key is not None else os.getenv("ARCADE_API_KEY", "")
        self.transport = transport

    async def call(self, endpoint, payload):
        if not self.key:
            raise ArcadeError("Set ARCADE_API_KEY on the server to use live generation.", 503)
        try:
            logger.info("Arcade API request endpoint=%s", endpoint)
            async with httpx2.AsyncClient(
                timeout=httpx2.Timeout(45, connect=15), transport=self.transport,
                headers={"Authorization": f"Bearer {self.key}",
                         "User-Agent": "shoppably-hackathon/0.1"},
            ) as client:
                response = await client.post(f"{self.BASE_URL}/{endpoint}", json=payload)
                logger.info("Arcade API response endpoint=%s status=%s", endpoint, response.status_code)
                if response.is_error:
                    # Avoid forwarding raw upstream bodies, headers or signed URLs.
                    message = {
                        401: "Arcade rejected the server's API key.",
                        403: "The Arcade account cannot perform this operation.",
                        400: "Arcade rejected this design or category. Try editing the prompt.",
                        404: "This Arcade creation is no longer available.",
                        429: "Arcade is busy or rate limited. Wait a moment and retry.",
                    }.get(response.status_code, "Arcade is temporarily unavailable. Please retry.")
                    raise ArcadeError(message, 429 if response.status_code == 429 else 502)
                return response.json()
        except httpx2.TimeoutException as exc:
            raise ArcadeError("Arcade timed out. Retry with the same request to avoid duplicates.", 504) from exc
        except (httpx2.RequestError, ValueError) as exc:
            raise ArcadeError("Unable to reach Arcade. Please retry or use the demo preview.") from exc

    async def categories(self):
        return (await self.call("categories/list", {}))["items"]

    async def upload_reference(self, data, request_id):
        upload = await self.call("references/createUpload", {
            "requestId": f"{request_id}-upload", "mediaType": "image/jpeg", "byteLength": len(data),
        })
        # Upload through a separate client: never send the Arcade bearer key to a storage host.
        try:
            async with httpx2.AsyncClient(timeout=45, transport=self.transport) as client:
                response = await client.put(upload["uploadUrl"], content=data, headers=upload["requiredHeaders"])
                response.raise_for_status()
        except httpx2.HTTPError as exc:
            raise ArcadeError("Reference image upload failed. Please retry.") from exc
        reference = await self.call("references/create", {
            "requestId": f"{request_id}-reference", "uploadId": upload["uploadId"],
        })
        return reference["referenceId"]

    async def create(self, data, category_id, prompt, request_id):
        reference_id = await self.upload_reference(data, request_id)
        return await self.call("patterns/create", {
            "requestId": request_id, "categoryId": category_id,
            "prompt": prompt, "referenceIds": [reference_id],
        })

    async def status(self, job_id):
        job = await self.call("jobs/get", {"jobId": job_id})
        result = job.get("result") or {}
        product = None
        if job["status"] == "succeeded" and result.get("productId"):
            product = await self.call("products/get", {"productId": result["productId"]})
        return job, product

