"""Verify the catalog, optionally upload a reference and create/cache one product."""
import argparse
import asyncio
import json
import io
import sys
import uuid
from pathlib import Path

import httpx2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.arcade_client import ArcadeClient
from services.config import load_config
from services.images import normalize_reference


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", help="Image path; supplying it starts one real generation")
    parser.add_argument("--job", help="Resume polling a previously created job")
    parser.add_argument("--category", default="Decorative Pillows", help="Arcade production category name")
    parser.add_argument("--prompt", default="Design a decorative pillow inspired by the reference image. Preserve its colors and visual character as a printable textile pattern.")
    args = parser.parse_args()
    load_config()
    client = ArcadeClient()
    categories = await client.categories()
    Path("data").mkdir(exist_ok=True)
    clean = [{key: item[key] for key in ("categoryId", "name", "world")} for item in categories]
    Path("data/catalog.json").write_text(json.dumps({"items": clean}, indent=2) + "\n")
    print(f"Verified {len(categories)} production categories; {sum(c['world'] == 'print' for c in categories)} accept references.")
    if not args.reference and not args.job:
        return
    Path("artifacts").mkdir(exist_ok=True)
    if args.job:
        job_id = args.job
    else:
        category = next(c for c in categories if c["name"] == args.category and c["world"] == "print")
        data = normalize_reference(Path(args.reference).read_bytes())
        job = await client.create(data, category["categoryId"],
            args.prompt,
            f"spike-{uuid.uuid4()}")
        job_id = job["jobId"]
        Path("artifacts/spike-job.json").write_text(json.dumps({"jobId": job_id}))
        print(f"Reference uploaded and generation started: {job_id}", flush=True)
    for attempt in range(120):
        job, product = await client.status(job_id)
        if job["status"] == "failed":
            raise RuntimeError("Arcade generation failed")
        if product:
            async with httpx2.AsyncClient(timeout=45, follow_redirects=True) as http:
                image = await http.get(product["images"][0]["url"] if product["images"] else product["imageUrl"])
                image.raise_for_status()
            # Generated previews can exceed the user-reference upload size limit.
            with Image.open(io.BytesIO(image.content)) as preview:
                preview = preview.convert("RGB")
                preview.thumbnail((1024, 1024))
                preview.save("static/cached-product.jpg", "JPEG", quality=90, optimize=True)
            Path("static/cached-product.json").write_text(json.dumps({"title": product["title"], "productId": product["productId"],
                "category": args.category, "description": args.prompt}, indent=2))
            print("Real Arcade product succeeded; cached preview is ready.")
            return
        if attempt % 6 == 0:
            print("Arcade job is still running...", flush=True)
        await asyncio.sleep(5)
    raise RuntimeError(f"Job still running; resume with --job {job_id}")


if __name__ == "__main__":
    asyncio.run(main())

