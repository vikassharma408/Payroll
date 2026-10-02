// Browser persistence layer: keeps the in-memory `db` object (see db.js)
// surviving page reloads via IndexedDB, plus manual backup download/restore
// and folder-based auto-save via the File System Access API. Everything here
// is Promise-based; nothing here mutates the db shape, it only moves the
// serialized JSON in and out of storage.

(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;

  const IDB_NAME = "payroll-app";
  const IDB_VERSION = 1;
  const STORE = "kv";
  const STATE_KEY = "state";
  const FOLDER_HANDLE_KEY = "backupFolderHandle";
  const BACKUP_FILE_NAME = "payroll-backup.json";

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(key) {
    return openIdb().then(
      (idb) =>
        new Promise((resolve, reject) => {
          const tx = idb.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  function idbSet(key, value) {
    return openIdb().then(
      (idb) =>
        new Promise((resolve, reject) => {
          const tx = idb.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  }

  /** Persists the whole db object to IndexedDB (overwrites the single stored record). */
  function saveDb(db) {
    return idbSet(STATE_KEY, db);
  }

  /** Loads the previously saved db object, or null if nothing has been saved yet. */
  function loadDb() {
    return idbGet(STATE_KEY);
  }

  function backupFileContents(db) {
    return JSON.stringify(db, null, 2);
  }

  /** Triggers a browser download of the current db as a timestamped JSON file. */
  function downloadBackupFile(db) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([backupFileContents(db)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Parses+validates a backup File (from an <input type=file> or drag-drop) into a db object. Throws on invalid content. */
  function restoreFromFile(file) {
    return file.text().then((text) => {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("That file isn't valid JSON. Please select a backup file downloaded from this app.");
      }
      if (!parsed || typeof parsed !== "object" || typeof parsed.schemaVersion !== "number") {
        throw new Error("That file doesn't look like a Payroll app backup (missing schemaVersion).");
      }
      return parsed;
    });
  }

  const hasFileSystemAccess = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

  /** Opens the browser's directory picker and remembers the chosen folder (handle persisted in IndexedDB) for future auto-saves. */
  async function pickBackupFolder() {
    if (!hasFileSystemAccess()) {
      throw new Error("Your browser doesn't support choosing a folder for auto-save (this needs a Chromium-based browser, e.g. Chrome or Edge). Use manual download/restore instead.");
    }
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await idbSet(FOLDER_HANDLE_KEY, handle);
    return handle;
  }

  /** Retrieves the remembered folder handle, if any, re-requesting readwrite permission if it has lapsed. Returns null if none was ever chosen or permission is denied. */
  async function getRememberedFolderHandle() {
    const handle = await idbGet(FOLDER_HANDLE_KEY);
    if (!handle) return null;
    const opts = { mode: "readwrite" };
    let permission = await handle.queryPermission(opts);
    if (permission !== "granted") {
      permission = await handle.requestPermission(opts);
    }
    if (permission !== "granted") return null;
    return handle;
  }

  async function forgetBackupFolder() {
    await idbSet(FOLDER_HANDLE_KEY, null);
  }

  /** Writes the current db as JSON into the remembered auto-save folder. Returns true if written, false if no folder is set up (caller should fall back to manual download). */
  async function writeBackupToFolder(db) {
    const handle = await getRememberedFolderHandle();
    if (!handle) return false;
    const fileHandle = await handle.getFileHandle(BACKUP_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(backupFileContents(db));
    await writable.close();
    return true;
  }

  const Persistence = {
    saveDb,
    loadDb,
    downloadBackupFile,
    restoreFromFile,
    hasFileSystemAccess,
    pickBackupFolder,
    getRememberedFolderHandle,
    forgetBackupFolder,
    writeBackupToFolder,
    BACKUP_FILE_NAME,
  };

  if (isNode) {
    module.exports = Persistence;
  } else {
    root.Persistence = Persistence;
  }
})(typeof window !== "undefined" ? window : globalThis);
