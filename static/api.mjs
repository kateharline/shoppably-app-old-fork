export async function requestJson(path, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(path === "/api/create"
        ? "Submission timed out. Retry this same design to check or continue the request without creating a duplicate."
        : "The status request timed out. Check again to continue tracking the same creation."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetch(path, { ...options, signal: controller.signal, cache: "no-store" });
      let data;
      try { data = await response.json(); }
      catch { throw new Error("The server returned an unreadable response. Please retry."); }
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The request could not be completed. Please retry.");
      return data;
    })()]);
  } finally { clearTimeout(timer); }
}
