"""Check persistent binary caching in a worker on an insecure HTTP LAN origin."""
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
WORKER = """
import { ModelCache } from '/static/model-cache.mjs';
self.onmessage = async ({data:mode}) => {
  try {
    const cache = new ModelCache();
    if (mode === 'write') {
      const bytes = new Uint8Array(8 * 1024 * 1024); bytes[0]=42; bytes[bytes.length-1]=99;
      const response = new Response(bytes, {headers:{'content-type':'application/octet-stream','content-length':String(bytes.length)}});
      await cache.put('https://models.test/model.onnx', response);
      if (response.bodyUsed) throw new Error('Cache consumed original response');
      await cache.put('https://models.test/missing', new Response('missing',{status:404}));
    }
    const hit = await cache.match('https://models.test/model.onnx');
    const bytes = hit ? new Uint8Array(await hit.arrayBuffer()) : [];
    const disabled = new ModelCache({open(){throw new Error('Storage blocked');}});
    await disabled.put('key',new Response('data'));
    if (await disabled.match('key')) throw new Error('Disabled cache returned a hit');
    self.postMessage({secure:isSecureContext,cacheAPI:typeof caches,size:bytes.length,
      first:bytes[0],last:bytes[bytes.length-1],length:hit?.headers.get('content-length'),
      missing:!!await cache.match('https://models.test/missing')});
  } catch(error) {self.postMessage({error:error.message});}
};
"""


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        context = await browser.new_context()
        page = await context.new_page()
        async def respond(route):
            url = route.request.url
            if url.endswith("/cache-worker.js"):
                await route.fulfill(body=WORKER, content_type="text/javascript")
            elif url.endswith("/static/model-cache.mjs"):
                await route.fulfill(path=ROOT / "static/model-cache.mjs", content_type="text/javascript")
            else:
                await route.fulfill(body="<!doctype html><title>Cache test</title>", content_type="text/html")
        await page.route("http://192.168.122.87:*/**", respond)
        async def probe(mode):
            return await page.evaluate("""mode => new Promise((resolve,reject) => {
              const worker = new Worker('/cache-worker.js',{type:'module'});
              worker.onmessage = ({data}) => {worker.terminate();resolve(data);};
              worker.onerror = error => {worker.terminate();reject(new Error(error.message));};
              worker.postMessage(mode);
            })""", mode)
        await page.goto("http://192.168.122.87:8000/")
        written = await probe("write")
        assert not written.get("error"), written
        assert written["secure"] is False and written["cacheAPI"] == "undefined", written
        assert written["size"] == 8 * 1024 * 1024 and written["first"] == 42 and written["last"] == 99, written
        assert written["length"] == str(8 * 1024 * 1024) and written["missing"] is False
        await page.reload()
        assert await probe("read") == written
        await page.goto("http://192.168.122.87:8001/")
        assert (await probe("read"))["size"] == 0
        await browser.close()
        print("HTTP worker cache passed: 8 MB binary persisted across reload, origin isolation, storage-error fallback")


if __name__ == "__main__":
    asyncio.run(main())
