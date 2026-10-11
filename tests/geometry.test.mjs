import { test } from "node:test";
import assert from "node:assert/strict";
import { sourcePoint, maskBounds } from "../static/geometry.mjs";
import { suggestCategories } from "../static/mapping.mjs";

test("maps clicks through scaling and horizontal letterboxing", () => {
  const container = { left: 100, top: 200, width: 1000, height: 500 };
  assert.deepEqual(sourcePoint(600, 450, container, 1920, 1080), { x: 960, y: 540 });
  assert.equal(sourcePoint(110, 450, container, 1920, 1080), null);
});
test("rejects clicks in vertical letterboxing and outside source bounds", () => {
  const box = { left: 0, top: 0, width: 400, height: 400 };
  assert.equal(sourcePoint(200, 10, box, 1920, 1080), null);
  assert.deepEqual(sourcePoint(200, 200, box, 1920, 1080), { x: 960, y: 540 });
  assert.equal(sourcePoint(400, 200, box, 1920, 1080), null);
});
test("handles empty and edge-touching object masks", () => {
  assert.equal(maskBounds(new Uint8Array(4), 2, 2), null);
  assert.deepEqual(maskBounds(new Uint8Array([1, 0, 1, 0]), 2, 2), { left: 0, top: 0, width: 1, height: 2, count: 2 });
});
const categories = [{ categoryId: "pillow", name: "Decorative Pillows" }, { categoryId: "scarf", name: "Scarves" }, { categoryId: "napkin", name: "Napkins" }];
const rankings = [{ label: "Scarves", score: .7 }, { label: "Napkins", score: .2 }, { label: "Decorative Pillows", score: .1 }];
test("obvious direct matches are prioritized over visual similarity", () => {
  const result = suggestCategories(categories, rankings, [{ label: "decorative pillow", score: .8 }, { label: "sofa", score: .1 }]);
  assert.equal(result.matchType, "direct");
  assert.equal(result.suggestions[0].categoryId, "pillow");
});
test("unsupported and ambiguous objects produce inspired-by suggestions only", () => {
  for (const objects of [ [{ label: "ceramic vase", score: .8 }],
    [{ label: "decorative pillow", score: .31 }, { label: "sofa", score: .30 }] ]) {
    const result = suggestCategories(categories, rankings, objects);
    assert.equal(result.matchType, "inspired_by");
    assert.equal(result.suggestions.length, 3);
    assert.ok(result.suggestions.every(c => categories.includes(c)));
  }
});

