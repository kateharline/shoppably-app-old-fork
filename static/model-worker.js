import { SamModel, AutoProcessor, RawImage, Tensor, pipeline, env } from
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
import { objectLabels, suggestCategories } from "./mapping.mjs";

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
let sam, processor, classifier, cachedFrame, processed, embeddings;
let queue = Promise.resolve();
let activeRequestId;
const timings = {};
const emit = message => self.postMessage(message);
const status = (message, details = {}) => emit({ id: activeRequestId, type: "status", message, phase: "loading", ...details });
const progress = prefix => item => {
  if (item.status === "progress") status(`Downloading the ${prefix.toLowerCase()}…`, { progress: item.progress });
  else if (item.status === "initiate") status(`Downloading the ${prefix.toLowerCase()}…`);
};

async function loadSam() {
  if (sam) return;
  const start = performance.now();
  status("Loading selection model. The first visit downloads and caches model files.");
  let device = "wasm";
  if (self.navigator.gpu) {
    try { if (await self.navigator.gpu.requestAdapter()) device = "webgpu"; } catch { /* use CPU */ }
  }
  try {
    sam = await SamModel.from_pretrained("Xenova/slimsam-77-uniform", {
      device, dtype: "fp32", progress_callback: progress("Selection model"),
    });
  } catch (error) {
    if (device === "wasm") throw error;
    status("GPU initialization failed. Trying the browser CPU.");
    device = "wasm";
    sam = await SamModel.from_pretrained("Xenova/slimsam-77-uniform", {
      device, dtype: "fp32", progress_callback: progress("Selection model"),
    });
  }
  processor = await AutoProcessor.from_pretrained("Xenova/slimsam-77-uniform");
  timings.samLoadMs = Math.round(performance.now() - start);
  timings.device = device;
}

async function loadClassifier() {
  if (classifier) return;
  const start = performance.now();
  classifier = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32", {
    device: "wasm", dtype: "q8", progress_callback: progress("Category model"),
  });
  timings.clipLoadMs = Math.round(performance.now() - start);
}

async function readBlob(blob) {
  const url = URL.createObjectURL(blob);
  try { return await RawImage.fromURL(url); } finally { URL.revokeObjectURL(url); }
}

async function run(message) {
  const { id, type } = message;
  activeRequestId = id;
  try {
    if (type === "load") {
      await loadSam();
      await loadClassifier();
      emit({ id, type: "result", result: { timings } });
    } else if (type === "segment") {
      await loadSam();
      if (cachedFrame !== message.frameId) {
        status("Finding shapes in this paused frame…", { phase: "encoding" });
        const start = performance.now();
        processed = await processor(await readBlob(message.blob));
        embeddings = await sam.get_image_embeddings(processed);
        cachedFrame = message.frameId;
        timings.encodeMs = Math.round(performance.now() - start);
      }
      status("Drawing the outline of your object…", { phase: "segmenting" });
      const start = performance.now();
      const [height, width] = processed.reshaped_input_sizes[0];
      const points = new Tensor("float32", [message.point.x / message.width * width,
        message.point.y / message.height * height], [1, 1, 1, 2]);
      const labels = new Tensor("int64", [1n], [1, 1, 1]);
      const output = await sam({ ...embeddings, input_points: points, input_labels: labels });
      const masks = await processor.post_process_masks(output.pred_masks, processed.original_sizes, processed.reshaped_input_sizes);
      const image = RawImage.fromTensor(masks[0][0]);
      const scores = Array.from(output.iou_scores.data);
      const best = scores.indexOf(Math.max(...scores));
      const data = new Uint8Array(image.width * image.height);
      for (let i = 0; i < data.length; i++) data[i] = image.data[image.channels * i + best] ? 1 : 0;
      timings.decodeMs = Math.round(performance.now() - start);
      emit({ id, type: "result", result: { mask: data, width: image.width, height: image.height,
        score: scores[best], timings: { ...timings } } });
    } else if (type === "classify") {
      await loadClassifier();
      status("Identifying visual details in your selection…", { phase: "classifying" });
      const start = performance.now();
      const image = await readBlob(message.blob);
      const objects = await classifier(image, objectLabels);
      status("Comparing your selection with available products…", { phase: "classifying" });
      const ranks = await classifier(image, message.categories.map(c => c.name));
      status("Preparing your design suggestions…", { phase: "classifying" });
      const patterns = await classifier(image, ["a solid color", "a floral pattern", "a striped pattern",
        "a geometric pattern", "an abstract pattern", "a lace pattern", "an embroidered pattern", "a textured surface"]);
      timings.classifyMs = Math.round(performance.now() - start);
      emit({ id, type: "result", result: { ...suggestCategories(message.categories, ranks, objects),
        pattern: patterns[0].label, rankings: ranks.slice(0, 3), timings: { ...timings } } });
    }
  } catch (error) {
    emit({ id, type: "error", message: `Browser model failed: ${error.message}` });
  }
}

self.onmessage = ({ data }) => { queue = queue.then(() => run(data)); };

