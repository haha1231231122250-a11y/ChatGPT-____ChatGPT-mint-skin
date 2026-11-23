// Serialized alongside the background picker and run in the desktop renderer.
export function openWallpaperLibrary() {
  const storeName = 'images';
  const limit = 12;
  const maxBytes = 15 * 1024 * 1024;
  const db = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('无法打开本地图库')); return; }
    const request = indexedDB.open('mint-skin-wallpapers', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地图库'));
    request.onblocked = () => reject(new Error('本地图库正在被其他窗口使用'));
  });

  async function run(mode, action) {
    const connection = await db;
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      let reason;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(reason || new Error('无法保存或读取本地图库，可能是存储空间不足'));
      action(store, (value) => { result = value; }, (error) => {
        reason = error;
        transaction.abort();
      });
    });
  }

  async function render(bitmap, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob) throw new Error('无法处理此图片');
    return blob;
  }

  async function prepare(file) {
    if (!file.size) throw new Error('文件为空');
    if (file.size > maxBytes) throw new Error('单张图片不能超过 15 MB');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const bytes = (...signature) => signature.every((value, i) => header[i] === value);
    const jpeg = bytes(255, 216, 255);
    const png = bytes(137, 80, 78, 71, 13, 10, 26, 10);
    const webp = bytes(82, 73, 70, 70) && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
    if (!jpeg && !png && !webp) throw new Error('请选择 JPEG、PNG 或 WebP');
    const bitmap = await createImageBitmap(file).catch(() => { throw new Error('图片无法解码'); });
    try {
      if (bitmap.width * bitmap.height > 32_000_000) throw new Error('图片不能超过 3200 万像素');
      return {
        id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, '0')).join(''),
        name: file.name.slice(0, 120),
        image: await render(bitmap, 2560),
        thumb: await render(bitmap, 360),
      };
    } finally {
      bitmap.close();
    }
  }

  return {
    limit,
    list: () => run('readonly', (store, done) => {
      const entries = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { done(entries); return; }
        const { id, name, thumb, added } = cursor.value;
        entries.push({ id, name, thumb, added });
        cursor.continue();
      };
    }),
    get: (id) => run('readonly', (store, done) => {
      const request = store.get(id);
      request.onsuccess = () => done(request.result);
    }),
    add: async (file) => {
      await db;
      const entry = await prepare(file);
      entry.added = Date.now();
      return run('readwrite', (store, done, abort) => {
        const count = store.count();
        count.onsuccess = () => {
          if (count.result >= limit) { abort(new Error('图库已满，最多保存 12 张')); return; }
          store.add(entry);
          done(entry.id);
        };
      });
    },
    remove: (id) => run('readwrite', (store) => store.delete(id)),
    close: () => { void db.then((connection) => connection.close(), () => {}); },
  };
}
