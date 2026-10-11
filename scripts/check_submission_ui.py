"""Exercise HTTP-origin submission with stub models and no paid API calls."""
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        page = await browser.new_page()
        errors, submitted = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.add_init_script("""
          Object.defineProperty(crypto, 'randomUUID', {value: undefined});
          window.Worker = class {
            postMessage(data) {
              let result = {};
              if (data.type === 'segment') {
                const mask = new Uint8Array(data.width * data.height);
                for (let y=20;y<100;y++) for (let x=20;x<100;x++) mask[y*data.width+x]=1;
                result = {mask,width:data.width,height:data.height};
              } else if (data.type === 'classify') {
                result = {directIds:['pillow'],objectName:'pillow',pattern:'a solid color',
                  suggestions:[{categoryId:'pillow',name:'Decorative Pillows'}]};
              }
              setTimeout(() => this.onmessage({data:{id:data.id,result}}),0);
            }
            terminate() {}
          };
        """)

        async def respond(route):
            path = route.request.url.split(":8000", 1)[1].split("?", 1)[0]
            if path == "/api/config":
                await route.fulfill(json={"mode": "live", "video_available": True})
            elif path == "/api/categories":
                await route.fulfill(json={"items": [{"categoryId": "pillow", "name": "Decorative Pillows"}]})
            elif path == "/api/create":
                submitted.append(route.request.post_data_buffer.decode("latin1"))
                if len(submitted) == 1:
                    await route.fulfill(status=502, json={"detail": "Please retry"})
                else:
                    await route.fulfill(json={"id": "accepted-job", "mode": "live", "status": "running"})
            elif path.startswith("/api/creation/"):
                await route.fulfill(json={"status": "succeeded", "mode": "live", "product": {
                    "title": "HTTP submission succeeded", "imageUrl": "/static/demo-product.svg"}})
            else:
                await route.fulfill(path=ROOT / ("static/index.html" if path == "/demo" else path.lstrip("/")))

        await page.route("http://192.168.122.87:8000/**", respond)
        await page.goto("http://192.168.122.87:8000/demo", wait_until="domcontentloaded")
        assert await page.evaluate("typeof crypto.randomUUID") == "undefined"
        assert not await page.evaluate("isSecureContext")
        await page.wait_for_selector("#overlay:not([hidden])")
        await page.locator("#overlay").click(position={"x": 50, "y": 50})
        await page.wait_for_selector("#design-form:not([hidden])")
        await page.locator("#confirm").check()
        await page.locator("#create").click()
        await page.wait_for_selector("#error-box:not([hidden])")
        assert not await page.locator("#create").is_disabled()
        await page.locator("#retry").click()
        await page.wait_for_selector("#result:not([hidden])")
        def request_id(body):
            return body.split('name="request_id"\r\n\r\n', 1)[1].split("\r\n", 1)[0]
        assert request_id(submitted[0]) == request_id(submitted[1])
        # A setup failure must restore the form rather than leave a spinner.
        await page.locator("#new-design").click()
        await page.locator("#overlay").click(position={"x": 50, "y": 50})
        await page.wait_for_selector("#design-form:not([hidden])")
        await page.evaluate("() => { crypto.getRandomValues = () => { throw new Error('ID generation failed'); }; }")
        await page.locator("#confirm").check()
        await page.locator("#create").click()
        await page.wait_for_selector("#error-box:not([hidden])")
        assert not await page.locator("#generation").is_visible()
        assert not await page.locator("#create").is_disabled()
        assert len(submitted) == 2
        assert not errors, errors
        await browser.close()
        print("HTTP browser submission passed: UUID fallback, stable retry ID, setup-error recovery")


if __name__ == "__main__":
    asyncio.run(main())
