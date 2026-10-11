# Shoppably

Pause a video, select an object, and create an Arcade.ai product inspired by it.
FastAPI serves a vanilla JavaScript app; SlimSAM and CLIP run in a browser worker.
The Python HTTP client is **httpx2**.

## Run locally

```bash
pixi install
pixi run dev
```

Open http://localhost:8000. The bundled video is an 8-second excerpt of
[Im Getting Married](https://www.youtube.com/watch?v=LegHU2why0Y&t=731s), from
12:11 to 12:19. Pause and click her wedding dress. It demonstrates an
**inspired-by** match: adapt its visual details to a supported Arcade product.
You can also open a local video in the UI.

Set `ARCADE_API_KEY` in your environment or in an ignored `.env` file. For this
workspace's local development, a literal exported key in `~/.bashrc` is also
loaded without executing the file. Set `ARCADE_KEY_FROM_BASHRC=0` to disable
that behavior. On Vercel the app only uses environment variables.

`ARCADE_MODE=auto` uses live Arcade when a key is present and otherwise uses
mock mode. Force `live` or `mock` with `ARCADE_MODE`. The header identifies the
active mode. Live errors never silently switch to a mock result.

## Try the flow

1. Play the video and pause on a detail. Click its center. For keyboard selection,
   focus the paused canvas, move with arrow keys, then press Enter.
2. As soon as the page opens, models load in the background from Hugging Face
   and the library/runtime from jsDelivr. You can play the video during loading.
   A video overlay shows real download percentages, then frame analysis,
   segmentation and category-matching stages. Inference uses an indeterminate
   indicator because the models do not expose a completion percentage.
   Subsequent loads use browser caching. **Load tools** retries a failed preload.
   If you click before loading finishes, that selection waits for the same load.
3. Review the isolated crop and three product suggestions. Change the category
   or design prompt, then confirm the selection.
4. Click **Create with Arcade**. The server uploads the crop as an Arcade
   reference, then calls `patterns/create` with the prompt and category.
5. The browser polls the job until the product preview is ready. Generation can
   take several minutes. **Check again** resumes polling without starting another
   job, and a pending job can survive a page reload through sessionStorage.

**See a cached demo preview** explicitly displays an earlier product, or a
labeled illustration when no cached product exists. Neither is represented as
being generated from the current selection. Mock mode returns an illustrative
product without calling Arcade.

## Models and categories

- `Xenova/slimsam-77-uniform` (Apache 2.0): point-prompted segmentation, fp32.
  WebGPU is attempted when available; model initialization falls back to WASM.
  Image embeddings are reused for clicks on the same paused frame.
- `Xenova/clip-vit-base-patch32`: quantized q8 zero-shot image classification on
  WASM. It ranks object labels, catalog category names, and a few pattern labels.
- Models run in a worker to keep playback and UI responsive. See **Browser
  performance** for model-loading and inference times on your device.
- Category scores are relative similarity scores, not calibrated probabilities.
  A confident object-label match can prioritize a known direct category; other
  results are marked inspired-by. Every recommendation needs manual confirmation.
- Colors are measured from the selected pixels. Material claims are not inferred.
  Pattern/object labels are visual suggestions and may need correction.
- `/api/categories` retrieves the live catalog in live mode. `/api/create`
  validates the chosen ID against the server's production allowlist before
  upload/generation. Only `world=print` categories are supported initially:
  jewelry does not accept image references through this API.

The checked-in catalog snapshot is for mock mode. It was read from the actual
Arcade production API; its IDs are not invented. Rugs and vases are not in that
catalog, so they should produce inspired-by suggestions.

The wedding-dress clip can be selected with real browser models. A successful
live Arcade reference-to-product generation from the earlier demo reference is
bundled as the labeled cached preview. In headless Chromium on the development machine, WASM frame
encoding took about 7.8 seconds, mask decoding 0.4 seconds, and classification
1.6 seconds on the wedding-dress frame; these timings will vary by device. Backend tests (14) and browser
geometry/category tests (5) passed. Desktop/mobile browser checks completed
without JavaScript errors. Vercel deployment has not yet been exercised.

## Development checks and assets

```bash
pixi run test
pixi run test-ui
pixi run playwright install chromium
pixi run python scripts/browser_spike.py
```

The browser spike expects the local server on port 8000, exercises real models,
saves the isolated crop and desktop/mobile screenshots under ignored `artifacts/`,
and does not start paid generation.

```bash
pixi run video
pixi run spike
# Supplying a reference starts ONE real Arcade generation and caches its preview:
pixi run spike --reference artifacts/selected-reference.jpg
# Resume the same generation if interrupted:
pixi run spike --job JOB_ID
```

`pixi run video` uses yt-dlp and ffmpeg to recreate the bundled H.264 MP4. If
YouTube blocks extraction, use `pixi run python scripts/prepare_video.py --source
/path/to/video.mp4`; the default starting time is 731 seconds. Large downloaded
source files stay in `artifacts/` and are excluded from deployment.

## Vercel

Import this repository as a FastAPI project or run `vercel` from its root. Set
`ARCADE_API_KEY` and `ARCADE_MODE=live` in Vercel's environment settings. The
`.python-version` and `requirements.txt` specify Python 3.12 and runtime-only
dependencies; Pixi manages the separate local development environment.
Static assets are mounted at `/static` and Vercel supports promoting mounted
FastAPI assets to its CDN. A `.vercelignore` excludes development environments,
raw downloads, tests, scripts, and local secrets.

There is no database, filesystem job storage, or long-running background task.
Each generation is stored by Arcade. Submission returns promptly; subsequent
requests poll the same Arcade job ID and renew product image URLs by fetching
the product again. Crops are compressed to 1024 pixels and server uploads are
limited to 3 MB to fit within Vercel's function request limits.

Deployment configuration is included; an actual Vercel deployment still needs
your Vercel account/project connection.

## API contract

- `GET /api/config`: mode, bundled-video availability, cached-preview availability.
- `GET /api/categories`: valid reference-compatible category IDs and names.
- `POST /api/create`: multipart `reference` image, `category_id`, editable `prompt`,
  `request_id` (stable across retries), and `confirmed=true`. Returns a job ID.
- `GET /api/creation/{id}`: running/succeeded/failed plus the product when ready.
- `GET /api/demo-preview`: explicitly labeled cached or illustrative demo result.
- `/api/docs`: generated interactive FastAPI API documentation.

Selection happens entirely in the browser, so the brief's proposed `/api/select`
endpoint is replaced by the worker interface. Only the isolated reference crop
is uploaded, after the user clicks Create.

Arcade documentation: [index](https://docs.arcade.ai/llms.txt),
[references](https://docs.arcade.ai/api-reference/references/create-an-upload-url),
[creation](https://docs.arcade.ai/api-reference/patterns/create-a-pattern),
[categories](https://docs.arcade.ai/api-reference/categories/list-categories).

