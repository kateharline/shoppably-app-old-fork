import { sourcePoint, videoRect, maskBounds } from "./geometry.mjs";
import { requestJson } from "./api.mjs";
import { createRequestId } from "./request-id.mjs";

const $ = id => document.getElementById(id);
const video = $("video"), overlay = $("overlay"), stage = $("video-stage");
const frame = document.createElement("canvas");
let categories = [], config, worker, frameId = 0, busy = false, creating = false;
let selection, cropBlob, cropUrl, uploadUrl, requestId, lastJob, pollVersion = 0, keyboardPoint;
const pending = new Map();
let rpcId = 0;
let modelLoadPromise = null, modelsReady = false;
let selectionEnabled = false;

function hide(id, value = true) { $(id).hidden = value; }
function status(message, state = "busy", details = {}) {
  if (state === "busy" && (!details.phase || details.phase === "loading")) {
    message = "Loading image intelligence functionality…";
  }
  $("model-status").textContent = message;
  $("model-dot").className = `status-dot ${state}`;
  $("model-bar").hidden = state === "busy";
  if (state !== "busy") {
    hide("video-progress");
    if (state === "ready" && video.paused && !selection && !overlay.hidden) hide("selection-tip", false);
    return;
  }
  hide("selection-tip");
  const phase = details.phase || "loading";
  $("video-progress").dataset.phase = phase;
  $("video-progress-title").textContent = {
    loading: "Loading image intelligence functionality…", encoding: "Analyzing your paused frame",
    segmenting: "Selecting your object", classifying: "Finding product matches",
  }[phase];
  $("video-progress-message").textContent = phase === "loading"
    ? "You can play the video while we get ready." : message;
  const progress = $("video-progress-bar");
  if (Number.isFinite(details.progress)) {
    progress.value = Math.max(0, Math.min(100, details.progress));
    $("video-progress-label").textContent = `Loading · ${Math.round(progress.value)}%`;
  } else {
    progress.removeAttribute("value");
    $("video-progress-label").textContent = phase === "loading"
      ? "Loading…"
      : "Working on your selection…";
  }
  hide("video-progress", false);
}
function error(message, retry = false) {
  $("error-message").textContent = message;
  hide("error-box", false); hide("retry", !retry);
}
async function api(path, options) {
  return requestJson(path, options, path === "/api/create" ? 60000 : 30000);
}
function rpc(type, data = {}) {
  if (!worker) {
    worker = new Worker("/static/model-worker.js", { type: "module" });
    worker.onmessage = ({ data: message }) => {
      const request = pending.get(message.id);
      if (!request) return;
      if (message.type === "status") {
        if (request.frameId !== undefined && request.frameId !== frameId) return;
        status(message.message, "busy", message);
        return;
      }
      clearTimeout(request.timeout); pending.delete(message.id);
      if (message.type === "error") request.reject(new Error(message.message));
      else {
        if (message.result.timings) $("timings").textContent = JSON.stringify(message.result.timings, null, 2);
        request.resolve(message.result);
      }
    };
    worker.onerror = () => {
      modelsReady = false;
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error("Image intelligence could not load. Check your connection and try again."));
      }
      pending.clear(); worker.terminate(); worker = null;
    };
  }
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("This is taking longer than expected. Check your connection and try again."));
    }, 240000);
    pending.set(id, { resolve, reject, timeout, frameId: data.frameId });
    worker.postMessage({ id, type, ...data });
  });
}
function loadModels() {
  if (modelsReady) return Promise.resolve();
  if (modelLoadPromise) return modelLoadPromise;
  status("Loading image intelligence functionality…", "busy", { progress: 0 });
  $("load-models").textContent = "Loading…";
  $("load-models").disabled = true;
  modelLoadPromise = rpc("load").then(() => {
    modelsReady = true;
    $("load-models").textContent = "Ready";
    if (!busy) status("Image intelligence is ready. Pause the video and pick an object.", "ready");
  }).finally(() => {
    modelLoadPromise = null;
    if (!modelsReady) $("load-models").textContent = "Try again";
    $("load-models").disabled = busy || modelsReady;
    if (!busy) hide("video-progress");
  });
  return modelLoadPromise;
}
async function preloadModels() {
  try { await loadModels(); }
  catch (err) {
    if (!busy) {
      error(err.message);
      status("Image intelligence could not load. Select Try again to retry.", "");
    }
  }
}
const toBlob = (canvas, type = "image/jpeg") => new Promise((resolve, reject) =>
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not capture the video frame.")), type, 0.9));

function layoutOverlay() {
  if (!video.videoWidth) return;
  const container = stage.getBoundingClientRect();
  const rect = videoRect(container, video.videoWidth, video.videoHeight);
  Object.assign(overlay.style, { left: `${rect.left - container.left}px`, top: `${rect.top - container.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px` });
}
new ResizeObserver(layoutOverlay).observe(stage);

function resetSelection() {
  if (creating) return;
  selection = null; cropBlob = null; requestId = null;
  if (cropUrl) { URL.revokeObjectURL(cropUrl); cropUrl = null; }
  $("confirm").checked = false;
  hide("design-form"); hide("result"); hide("generation"); hide("error-box");
  hide("studio-empty", false);
  $("step-create").classList.remove("active");
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
}

function capture() {
  if (!selectionEnabled || !video.videoWidth || video.readyState < 2 || !video.paused) return;
  frame.width = video.videoWidth; frame.height = video.videoHeight;
  frame.getContext("2d").drawImage(video, 0, 0);
  overlay.width = frame.width; overlay.height = frame.height;
  frameId++;
  resetSelection();
  keyboardPoint = { x: Math.floor(frame.width / 2), y: Math.floor(frame.height / 2) };
  layoutOverlay();
  hide("overlay", false); hide("selection-tip", !$("video-progress").hidden);
  $("selection-tip").textContent = uploadUrl ? "Click a detail you love" : "Click her wedding dress";
  $("video-help").textContent = uploadUrl ? "Click an object in the frame to select it." : "Click her dress to turn its details into a design.";
  $("step-pick").classList.add("active");
}
video.addEventListener("loadedmetadata", () => {
  hide("video-empty"); layoutOverlay();
});
video.addEventListener("loadeddata", capture);
video.addEventListener("pause", () => {
  selectionEnabled = true;
  capture();
});
video.addEventListener("seeked", capture);
video.addEventListener("play", () => {
  selectionEnabled = false;
  frameId++;
  hide("overlay"); hide("selection-tip");
  if (!modelLoadPromise) hide("video-progress");
  $("video-help").textContent = "Pause when something catches your eye.";
});
video.addEventListener("error", () => {
  hide("video-empty", false); hide("overlay"); hide("selection-tip");
  $("video-help").textContent = "Open a local video to start.";
});
video.addEventListener("click", async event => {
  // Leave the native playback controls available beneath the selection canvas.
  const rect = video.getBoundingClientRect();
  if (event.clientY >= rect.bottom - 48) return;
  event.preventDefault();
  if (!video.paused) video.pause();
  else try { await video.play(); } catch { error("The video could not play. Try opening a local MP4."); }
});
$("video-upload").addEventListener("change", () => {
  const file = $("video-upload").files[0];
  if (!file || creating) return;
  video.pause(); resetSelection();
  selectionEnabled = false; hide("overlay"); hide("selection-tip");
  if (uploadUrl) URL.revokeObjectURL(uploadUrl);
  uploadUrl = URL.createObjectURL(file); video.src = uploadUrl; video.removeAttribute("poster"); video.load();
});

function drawMask(data, width, height) {
  const image = overlay.getContext("2d").createImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    if (!data[i]) continue;
    const n = i * 4;
    image.data[n] = 59; image.data[n + 1] = 130; image.data[n + 2] = 246; image.data[n + 3] = 105;
  }
  overlay.getContext("2d").putImageData(image, 0, 0);
}
function extractCrop(mask, bounds) {
  const pad = 8;
  const left = Math.max(0, bounds.left - pad), top = Math.max(0, bounds.top - pad);
  const width = Math.min(frame.width - left, bounds.width + pad * 2);
  const height = Math.min(frame.height - top, bounds.height + pad * 2);
  const pixels = frame.getContext("2d").getImageData(left, top, width, height);
  const counts = new Map();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const n = (y * width + x) * 4;
    if (!mask[(top + y) * frame.width + left + x]) {
      pixels.data[n] = pixels.data[n + 1] = pixels.data[n + 2] = 255;
    } else if ((x + y) % 4 === 0) {
      const color = Array.from(pixels.data.slice(n, n + 3), value => Math.min(255, Math.round(value / 32) * 32));
      const hex = "#" + color.map(value => value.toString(16).padStart(2, "0")).join("");
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
  }
  const crop = document.createElement("canvas"); crop.width = width; crop.height = height;
  crop.getContext("2d").putImageData(pixels, 0, 0);
  const resized = document.createElement("canvas");
  const scale = Math.min(1, 1024 / Math.max(width, height));
  resized.width = Math.max(1, Math.round(width * scale)); resized.height = Math.max(1, Math.round(height * scale));
  resized.getContext("2d").drawImage(crop, 0, 0, resized.width, resized.height);
  return { crop: resized, colors: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(item => item[0]) };
}

async function pick(point) {
  if (busy || creating || !video.paused || !point) return;
  if (!categories.length) { error("The product catalog is unavailable. Reload the page to retry."); return; }
  busy = true; $("load-models").disabled = true;
  resetSelection(); hide("selection-tip");
  const version = frameId;
  try {
    await loadModels();
    if (version !== frameId || !video.paused) return;
    status("Finding shapes and details in your selection…", "busy", { phase: "encoding" });
    const result = await rpc("segment", { blob: await toBlob(frame), point, frameId: version,
      width: frame.width, height: frame.height });
    if (version !== frameId || !video.paused) return;
    const bounds = maskBounds(result.mask, result.width, result.height);
    if (!bounds || bounds.count < 25 || bounds.count > result.width * result.height * 0.9) {
      throw new Error("That selection was unclear. Try clicking nearer the center of an object.");
    }
    drawMask(result.mask, result.width, result.height);
    const { crop, colors } = extractCrop(result.mask, bounds);
    cropBlob = await toBlob(crop);
    cropUrl = URL.createObjectURL(cropBlob); $("crop-preview").src = cropUrl;
    const mapping = await rpc("classify", { blob: cropBlob, categories, frameId: version });
    if (version !== frameId || !video.paused) return;
    selection = { ...mapping, colors };
    $("object-name").textContent = mapping.directIds.length ? mapping.objectName : "Selected detail";
    $("attributes").textContent = `Visual suggestion: ${mapping.pattern.replace(/^a[n]? /, "")}`;
    $("color-swatches").replaceChildren(...colors.map(color => {
      const swatch = document.createElement("span"); swatch.style.backgroundColor = color; swatch.title = color; return swatch;
    }));
    const category = $("category");
    category.replaceChildren(...categories.map(item => new Option(item.name, item.categoryId)));
    category.value = mapping.suggestions[0].categoryId;
    $("suggestions").replaceChildren(...mapping.suggestions.map(item => {
      const button = document.createElement("button"); button.type = "button"; button.textContent = item.name;
      button.dataset.category = item.categoryId;
      button.addEventListener("click", () => { category.value = item.categoryId; changeCategory(); });
      return button;
    }));
    changeCategory();
    hide("studio-empty"); hide("design-form", false);
    $("step-create").classList.add("active");
    status("Selection ready. Review the suggestions and make it yours.", "ready");
  } catch (err) {
    if (version === frameId) { error(err.message); status("Selection needs another try.", ""); }
  } finally {
    busy = false; $("load-models").disabled = !!modelLoadPromise || modelsReady;
    if (!modelLoadPromise) hide("video-progress");
    if (modelsReady && version !== frameId) status("Image intelligence is ready. Pause the video and pick an object.", "ready");
  }
}
overlay.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const point = sourcePoint(event.clientX, event.clientY, stage.getBoundingClientRect(), frame.width, frame.height);
  if (point) { keyboardPoint = point; pick(point); }
});
overlay.addEventListener("keydown", event => {
  if (["Enter", " "].includes(event.key)) { event.preventDefault(); pick(keyboardPoint); return; }
  const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
  if (!delta || !keyboardPoint || busy) return;
  event.preventDefault();
  keyboardPoint.x = Math.max(0, Math.min(frame.width - 1, keyboardPoint.x + delta[0]));
  keyboardPoint.y = Math.max(0, Math.min(frame.height - 1, keyboardPoint.y + delta[1]));
  const context = overlay.getContext("2d"); context.clearRect(0, 0, overlay.width, overlay.height);
  context.beginPath(); context.arc(keyboardPoint.x, keyboardPoint.y, 8, 0, Math.PI * 2);
  context.strokeStyle = "#3b82f6"; context.lineWidth = 3; context.stroke();
});

function changeCategory() {
  if (!selection) return;
  const chosen = categories.find(item => item.categoryId === $("category").value);
  const direct = selection.directIds.includes(chosen.categoryId);
  $("match-note").textContent = direct
    ? "A possible direct category match. Review the selection before creating."
    : "Inspired by your selection: we’ll use its visual character on a different product, rather than recreate the original object.";
  $("prompt").value = `Create a ${chosen.name.toLowerCase()} design inspired by the selected visual reference. Use ${selection.pattern} and preserve the reference’s visual character and dominant colors (${selection.colors.join(", ")}). Adapt it into a printable textile design.`;
  $("confirm").checked = false; requestId = null;
  for (const button of $("suggestions").children) button.classList.toggle("selected", button.dataset.category === chosen.categoryId);
}
$("category").addEventListener("change", changeCategory);
$("prompt").addEventListener("input", () => { requestId = null; $("confirm").checked = false; });
$("clear-selection").addEventListener("click", resetSelection);
$("load-models").addEventListener("click", () => { hide("error-box"); preloadModels(); });

function showProduct(product, mode) {
  creating = false;
  hide("generation"); hide("design-form"); hide("studio-empty"); hide("error-box"); hide("result", false);
  $("result-image").src = product.images?.[0]?.url || product.imageUrl;
  $("result-title").textContent = product.title;
  $("result-mode").textContent = mode === "live" ? "Created with Arcade" : mode === "cached" ? "Cached demo · previous creation" : "Illustrative demo preview";
  $("result-mode").classList.toggle("live", mode === "live");
  $("result-detail").textContent = mode === "live"
    ? (product.selectionLabel || "Your reference-inspired product is ready.")
    : `${product.description ? product.description + " " : ""}This is a demo example. It was not generated from your current selection.`;
  $("create").disabled = false;
  $("video-upload").disabled = false;
}
$("result-image").addEventListener("error", () => error("The preview image could not load. Refresh the creation status to renew its URL."));

async function poll(job) {
  const version = ++pollVersion;
  const start = Date.now();
  creating = true;
  hide("error-box"); hide("design-form"); hide("studio-empty"); hide("generation", false);
  hide("resume-poll"); hide("generation-spinner", false);
  $("create").disabled = true; $("video-upload").disabled = true;
  $("generation-title").textContent = job.mode === "live" ? "Arcade accepted your creation." : "Preparing your demo preview.";
  $("generation-job").textContent = `Creation ID: ${job.id}`;
  $("generation-message").textContent = "Checking creation status…";
  while (version === pollVersion && Date.now() - start < 240000) {
    try {
      const data = await api(`/api/creation/${encodeURIComponent(job.id)}`);
      if (version !== pollVersion) return;
      if (!["running", "succeeded", "failed"].includes(data.status)) throw new Error("The server returned an unknown creation status. Check again.");
      if (data.status === "succeeded") {
        sessionStorage.removeItem("shoppably-job"); showProduct(data.product, data.mode); return;
      }
      if (data.status === "failed") {
        sessionStorage.removeItem("shoppably-job"); lastJob = null; requestId = null;
        creating = false; hide("generation"); $("create").disabled = false; $("video-upload").disabled = false;
        hide("design-form", !cropBlob); hide("studio-empty", !!cropBlob);
        error(data.error || "Arcade could not create this design.", !!cropBlob);
        return;
      }
    } catch (err) {
      if (version !== pollVersion) return;
      creating = false; hide("generation"); $("create").disabled = false; $("video-upload").disabled = false;
      error(err.message); hide("resume-poll", false);
      // Keep the job so a network error can be retried without another generation.
      hide("generation", false); $("generation-title").textContent = "Creation needs another check.";
      hide("generation-spinner");
      $("generation-message").textContent = "Status checks paused. Check again to track this creation without submitting another design.";
      return;
    }
    $("generation-message").textContent = Date.now() - start > 60000
      ? "Arcade is still working. You can keep waiting or open the cached demo preview."
      : `Arcade is designing your pattern and building a product preview. Checked after ${Math.round((Date.now() - start) / 1000)} seconds.`;
    await new Promise(resolve => setTimeout(resolve, config.mode === "mock" ? 1000 : 4000));
  }
  if (version === pollVersion) {
    creating = false; $("create").disabled = false; $("video-upload").disabled = false;
    $("generation-title").textContent = "Your design is still in progress.";
    $("generation-message").textContent = "You can check again without starting another creation.";
    hide("resume-poll", false);
    hide("generation-spinner");
  }
}
async function createProduct() {
  if (creating || !cropBlob || !$("design-form").reportValidity()) return;
  creating = true; hide("error-box"); hide("design-form"); hide("generation", false); hide("result");
  const submissionVersion = ++pollVersion;
  $("generation-title").textContent = "Making your inspiration real.";
  $("generation-message").textContent = "Uploading your selected reference to Arcade…";
  $("generation-job").textContent = "Waiting for Arcade to accept the creation.";
  hide("generation-spinner", false); hide("resume-poll");
  $("create").disabled = true; $("video-upload").disabled = true;
  try {
    requestId ||= createRequestId();
    const body = new FormData();
    body.append("reference", cropBlob, "reference.jpg"); body.append("category_id", $("category").value);
    body.append("prompt", $("prompt").value); body.append("request_id", requestId); body.append("confirmed", "true");
    lastJob = await api("/api/create", { method: "POST", body });
    if (!lastJob.id || !["live", "mock"].includes(lastJob.mode)) throw new Error("The server did not return a creation ID. Retry this same design.");
    sessionStorage.setItem("shoppably-job", JSON.stringify(lastJob));
    if (submissionVersion !== pollVersion) return;
    await poll(lastJob);
  } catch (err) {
    if (submissionVersion !== pollVersion) return;
    creating = false; $("create").disabled = false; $("video-upload").disabled = false;
    hide("generation"); hide("design-form", false); error(err.message, true);
  }
}
$("design-form").addEventListener("submit", event => { event.preventDefault(); createProduct(); });
$("retry").addEventListener("click", createProduct);
$("resume-poll").addEventListener("click", () => { if (lastJob) { creating = true; poll(lastJob); } });
$("demo-preview").addEventListener("click", async () => {
  try { const data = await api("/api/demo-preview"); pollVersion++; frameId++; showProduct(data.product, data.mode); }
  catch (err) { error(err.message); }
});
$("new-design").addEventListener("click", () => {
  pollVersion++; creating = false; resetSelection(); if (video.paused) capture();
});

async function boot() {
  try {
    config = await api("/api/config");
    $("mode").textContent = config.mode === "live" ? "Live Arcade" : "Demo mode";
    $("mode").classList.toggle("live", config.mode === "live");
    $("demo-preview").textContent = config.cached_preview_available ? "See a cached demo preview ↗" : "See an illustrative demo preview ↗";
    if (!config.video_available) hide("video-empty", false);
    categories = (await api("/api/categories")).items;
    capture();
    const saved = sessionStorage.getItem("shoppably-job");
    if (saved) {
      lastJob = JSON.parse(saved);
      if (lastJob.mode === config.mode) {
        hide("studio-empty"); hide("generation", false); creating = true; poll(lastJob);
      } else sessionStorage.removeItem("shoppably-job");
    }
  } catch (err) { error(err.message); }
}
preloadModels();
boot();

