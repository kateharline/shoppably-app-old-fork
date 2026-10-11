"""Verify recovery from stalled polling without creating a paid Arcade job."""
import asyncio

from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        page = await browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.add_init_script("""
          sessionStorage.setItem('shoppably-job', JSON.stringify({id:'test-job',mode:'live'}));
          window.Worker = class {
            postMessage(data) { setTimeout(() => this.onmessage({data:{id:data.id,result:{}}}),0); }
            terminate() {}
          };
        """)
        await page.route("**/api/config", lambda r: r.fulfill(json={"mode": "live", "video_available": True}))
        await page.route("**/api/categories", lambda r: r.fulfill(json={"items": []}))
        await page.clock.install()
        # Hold the response open to reproduce a request that otherwise spins forever.
        await page.route("**/api/creation/test-job", lambda _r: None)
        await page.goto("http://127.0.0.1:8011", wait_until="domcontentloaded")
        await page.wait_for_selector("#generation:not([hidden])")
        assert "test-job" in await page.locator("#generation-job").inner_text()
        await page.clock.run_for(31000)
        await page.wait_for_selector("#resume-poll:not([hidden])")
        assert not await page.locator("#generation-spinner").is_visible()
        assert "timed out" in await page.locator("#error-message").inner_text()
        assert await page.evaluate("JSON.parse(sessionStorage.getItem('shoppably-job')).id") == "test-job"
        await page.unroute("**/api/creation/test-job")
        await page.route("**/api/creation/test-job", lambda r: r.fulfill(json={
            "status": "succeeded", "mode": "live", "product": {
                "title": "Recovered creation", "imageUrl": "/static/demo-product.svg"}}))
        await page.locator("#resume-poll").click()
        await page.wait_for_selector("#result:not([hidden])")
        assert await page.locator("#result-title").inner_text() == "Recovered creation"
        assert await page.evaluate("sessionStorage.getItem('shoppably-job')") is None
        assert not errors, errors
        await browser.close()
        print("Browser: stalled status timed out, spinner stopped, same job resumed successfully")


if __name__ == "__main__":
    asyncio.run(main())
