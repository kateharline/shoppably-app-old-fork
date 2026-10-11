// IndexedDB works on HTTP LAN origins and stores large binary model files.
// The library uses this Cache-compatible interface before fetching a file.
export class ModelCache {
  constructor(storage = globalThis.indexedDB) {
    this.storage = storage;
    this.database = null;
    this.disabled = !storage;
  }
  open() {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = this.storage.open("shoppably-vision-3.8.1-v1", 1);
        const timer = setTimeout(() => reject(new Error("Cache open timed out")), 5000);
        request.onupgradeneeded = () => request.result.createObjectStore("files");
        request.onsuccess = () => {
          clearTimeout(timer);
          if (this.disabled) { request.result.close(); return; }
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); reject(new Error("Cache is blocked")); };
      });
    }
    return this.database;
  }
  disable() {
    if (!this.disabled) console.warn("Vision model caching unavailable; continuing with downloads.");
    this.disabled = true;
  }
  async match(key) {
    if (this.disabled) return undefined;
    try {
      const db = await this.open();
      const record = await new Promise((resolve, reject) => {
        const transaction = db.transaction("files", "readonly");
        const request = transaction.objectStore("files").get(String(key));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
      return record ? new Response(record.body, {
        status: record.status, statusText: record.statusText, headers: record.headers,
      }) : undefined;
    } catch { this.disable(); return undefined; }
  }
  async put(key, response) {
    if (this.disabled || !response.ok) return;
    try {
      const db = await this.open();
      const record = { body: await response.clone().blob(), status: response.status,
        statusText: response.statusText, headers: [...response.headers] };
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("files", "readwrite");
        transaction.objectStore("files").put(record, String(key));
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } catch { this.disable(); }
  }
}
