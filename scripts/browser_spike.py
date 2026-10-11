"""Exercise real browser models. Does not trigger paid Arcade generation."""
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright


async def main():
    Path("artifacts").mkdir(exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, ignore_https_errors=True)
        page = await context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        async with page.expect_response("**/api/categories"):
            await page.goto("http://127.0.0.1:8000/demo", wait_until="domcontentloaded")
        await page.wait_for_selector("#video-progress:not([hidden])")
        assert await page.locator("#video-progress").get_attribute("data-phase") == "loading"
        assert await page.locator("#play-toggle").count() == 0
        await page.screenshot(path="artifacts/loading-desktop.png", full_page=True)
        await page.wait_for_function("document.querySelector('#video').readyState >= 2")
        await page.locator("#video").click(position={"x": 50, "y": 50})
        await page.wait_for_function("!document.querySelector('#video').paused")
        await page.locator("#video").click(position={"x": 50, "y": 50})
        await page.wait_for_selector("#overlay:not([hidden])")
        await page.screenshot(path="artifacts/studio-desktop.png", full_page=True)
        box = await page.locator("#overlay").bounding_box()
        # Click the skirt of her wedding dress in the requested opening frame.
        await page.mouse.click(box["x"] + box["width"] * .605, box["y"] + box["height"] * .73)
        await page.wait_for_function("document.querySelector('#video-progress').dataset.phase === 'encoding'", timeout=240000)
        await page.screenshot(path="artifacts/segmentation-progress-desktop.png", full_page=True)
        for index in range(120):
            await asyncio.sleep(2)
            if await page.locator("#design-form").is_visible():
                break
            if await page.locator("#error-box").is_visible():
                raise RuntimeError(await page.locator("#error-message").inner_text())
            if index % 10 == 0:
                print(await page.locator("#model-status").inner_text(), flush=True)
        else:
            raise RuntimeError("Browser model spike exceeded four minutes")
        assert not await page.locator("#video-progress").is_visible()
        print(json.dumps({"object": await page.locator("#object-name").inner_text(),
            "suggestions": await page.locator("#suggestions").inner_text(),
            "timings": await page.locator("#timings").text_content(), "errors": errors}, indent=2))
        await page.screenshot(path="artifacts/selection-desktop.png", full_page=True)
        # Save the exact masked crop for a separate one-call Arcade API spike.
        crop = await page.evaluate("async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('#crop-preview').src)).arrayBuffer()))")
        Path("artifacts/selected-reference.jpg").write_bytes(bytes(crop))
        # Exercise review/edit/create/poll UI without another paid generation.
        await page.route("**/api/create", lambda route: route.fulfill(json={"id": "ui-test", "status": "running", "mode": "mock"}))
        await page.route("**/api/creation/ui-test", lambda route: route.fulfill(json={"id": "ui-test", "status": "succeeded", "mode": "mock", "product": {"title": "UI test product", "imageUrl": "/static/demo-product.svg"}}))
        await page.locator("#category").select_option(label="Decorative Pillows")
        await page.locator("#prompt").fill("Cream and red botanical pillow inspired by this detail.")
        await page.locator("#confirm").check()
        await page.locator("#create").click()
        await page.wait_for_selector("#result:not([hidden])")
        assert "Illustrative" in await page.locator("#result-mode").inner_text()
        await page.locator("#demo-preview").click()
        await page.wait_for_selector("#result:not([hidden])")
        await page.screenshot(path="artifacts/result-desktop.png", full_page=True)
        await page.set_viewport_size({"width": 390, "height": 844})
        await page.screenshot(path="artifacts/studio-mobile.png", full_page=True)
        assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        assert not errors, errors
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

