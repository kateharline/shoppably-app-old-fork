export const objectLabels = ["decorative pillow", "floor pillow", "scarf", "napkin", "placemat",
  "tablecloth", "table runner", "duvet", "pillow sham", "quilt", "lampshade", "curtain",
  "tea towel", "rug", "ceramic vase", "sofa", "armchair", "wooden table", "painting",
  "plant", "shirt", "wedding dress", "skirt", "jewelry", "sewing machine", "suitcase", "wall", "floor", "person", "human arm", "human hand", "other object"];

const directNames = {
  "decorative pillow": ["Decorative Pillows", "Outdoor Decorative Pillows"],
  "floor pillow": ["Floor Pillows"], "scarf": ["Scarves", "Ribbon Scarf"],
  "napkin": ["Napkins"], "placemat": ["Placemats", "Outdoor Placemats"],
  "tablecloth": ["Tablecloths"], "table runner": ["Table Runners"], "duvet": ["Duvets"],
  "pillow sham": ["Shams", "Quilted Shams"], "quilt": ["Quilts"],
  "lampshade": ["Drum Lampshades", "Tall Drum Lampshades", "Rectangular Lampshades"],
  "curtain": ["Curtains"], "tea towel": ["Tea Towels"],
};

export function suggestCategories(categories, rankings, objects) {
  const first = objects[0];
  const margin = first.score - (objects[1]?.score ?? 0);
  const names = first.score >= 0.3 && margin >= 0.1 ? (directNames[first.label] ?? []) : [];
  const direct = categories.filter(c => names.includes(c.name));
  const ranked = rankings.map(result => categories.find(c => c.name === result.label)).filter(Boolean);
  const suggestions = [...new Map([...direct, ...ranked].map(c => [c.categoryId, c])).values()].slice(0, 3);
  return { suggestions, objectName: first.label, objectScore: first.score,
    directIds: direct.map(c => c.categoryId), matchType: direct.length ? "direct" : "inspired_by" };
}

