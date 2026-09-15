// ==UserScript==
// @name         AmiAmi - Save main images
// @namespace    local.amiami.main-image
// @version      1.1.3
// @description  Save one main product image per open AmiAmi product tab, named after its listing, directly into one chosen folder.
// @match        https://www.amiami.com/*
// @match        https://amiami.com/*
// @run-at       document-start
// @noframes
// @grant        GM_download
// @grant        GM_info
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_getTabs
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      img.amiami.com
// ==/UserScript==

(() => {
  'use strict';

  const KEY = 'amiamiMainImageV1';
  const TIMING = { page: 10000, helper: 12000, image: 10000, poll: 200, betweenItems: 150 };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function productURL(raw) {
    try {
      const u = new URL(raw, location.href);
      if (!['amiami.com', 'www.amiami.com'].includes(u.hostname) ||
          u.protocol !== 'https:' || !/\/detail\/?$/.test(u.pathname)) return null;
      const code = u.searchParams.get('gcode') || u.searchParams.get('scode');
      if (!code || !/^[a-z0-9_-]+$/i.test(code)) return null;
      return { code, url: `https://www.amiami.com/eng/detail/?gcode=${encodeURIComponent(code)}` };
    } catch { return null; }
  }

  function imageURL(raw) {
    if (!raw) return null;
    try {
      const u = new URL(raw, location.href);
      return u.protocol === 'https:' && u.hostname === 'img.amiami.com' &&
        u.pathname.startsWith('/images/product/') && /\.(jpg|jpeg|png|webp|gif)$/i.test(u.pathname)
        ? u.href : null;
    } catch { return null; }
  }

  function extract(doc, product) {
    const title = doc.querySelector('.item-detail__section-title')?.textContent.trim();
    if (!title) return null;
    // Use only the singular main image, never gallery/review thumbnails.
    const main = doc.querySelector('.item-detail__image .item-detail__slider img');
    const candidates = [
      main?.getAttribute('data-src'), main?.getAttribute('src'),
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
    ];
    const image = candidates.map(imageURL).find(url => url && new URL(url).pathname.includes('/product/main/'));
    if (!image) return null;
    // During SPA navigation the previous product's DOM can briefly remain visible.
    // Pre-owned URLs use -R or -R175; both share the base product's image.
    const baseCode = product.code.replace(/-R\d*$/i, '');
    const filename = decodeURIComponent(new URL(image).pathname.split('/').pop());
    if (!filename.toLowerCase().startsWith(baseCode.toLowerCase() + '_') &&
        !filename.toLowerCase().startsWith(baseCode.toLowerCase() + '.')) return null;
    return { ...product, title, image };
  }

  function safeName(text, limit = 110) {
    let name = text.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
      .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
    name = Array.from(name).slice(0, limit).join('').replace(/[. ]+$/g, '');
    if (!name) name = 'Untitled';
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = '_' + name;
    return name;
  }

  // Background helper tabs render AmiAmi's JavaScript page before extracting.
  const workerToken = location.hash.match(/^#amiami-first-image=([a-f0-9-]{36})$/i)?.[1];
  if (workerToken) {
    (async () => {
      const product = productURL(location.href);
      const deadline = Date.now() + TIMING.page;
      while (product && Date.now() < deadline) {
        const result = extract(document, product);
        if (result) { GM_setValue(`${KEY}:${workerToken}`, { result }); return; }
        await sleep(TIMING.poll);
      }
      GM_setValue(`${KEY}:${workerToken}`, { error: 'No main product image found. Open the product and check whether it has loaded or requires verification.' });
    })();
    return;
  }

  // Register immediately, independently of page loading or dialog creation.
  let menuReady;
  GM_registerMenuCommand('Save main product images…', async () => {
    try {
      if (!menuReady) menuReady = mountMenu();
      const show = await menuReady;
      show();
    } catch (error) {
      menuReady = null;
      console.error('AmiAmi downloader dialog failed:', error);
      alert(`AmiAmi downloader could not open: ${error.message}`);
    }
  });

  let tabState;
  let lastSnapshot = '';
  function register() {
    if (!tabState) return;
    const product = productURL(location.href);
    const data = product;
    const serialized = JSON.stringify(data);
    if (serialized !== lastSnapshot) {
      lastSnapshot = serialized;
      tabState[KEY] = data;
      GM_saveTab(tabState);
    }
  }
  GM_getTab(tab => { tabState = tab; register(); });
  setInterval(register, 1500);
  addEventListener('pageshow', () => { lastSnapshot = ''; register(); });
  addEventListener('pagehide', () => {
    if (tabState) { tabState[KEY] = null; GM_saveTab(tabState); lastSnapshot = ''; }
  });
  document.addEventListener('visibilitychange', register);

  async function mountMenu() {
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host{all:initial}*{box-sizing:border-box}section{width:340px;max-width:90vw;background:#fff;color:#20232a;border:1px solid #cdd2da;border-radius:12px;padding:16px;box-shadow:0 6px 30px #0003;font:14px/1.45 system-ui,sans-serif}
      header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}strong{font-size:16px}button,select{font:inherit}button{cursor:pointer;border:0;border-radius:6px;padding:9px 12px;background:#17634b;color:white}button:disabled{opacity:.5;cursor:default}select{width:100%;padding:7px;margin:5px 0 10px}p{margin:8px 0}small{display:block;color:#555}#close{background:#eee;color:#333;padding:3px 8px}#stop{background:#eee;color:#333}#log{white-space:pre-wrap;overflow-wrap:anywhere;max-height:170px;overflow:auto;font-size:12px}#launcher{box-shadow:0 3px 16px #0003}progress{width:100%;margin-top:12px}[hidden]{display:none!important}
    </style>
    <section hidden role="dialog" aria-label="Save AmiAmi main images">
      <header><strong>Main product images</strong><button id="close" aria-label="Close dialog">×</button></header>
      <p>From all open AmiAmi product tabs.</p>
      <small>Reload existing AmiAmi tabs after installing. One image per listing, named after its title, all in your chosen folder.</small>
      <label>Save method<select id="method"><option value="folder">Choose one folder for all images</option><option value="dialogs">Save As dialog for each image</option></select></label>
      <small id="compatibility"></small>
      <p><button id="start">Choose folder & save</button> <button id="stop" disabled>Stop</button></p>
      <progress id="progress" value="0" max="1"></progress>
      <p id="status" role="status" aria-live="polite">Ready. One main product image per listing.</p>
      <div id="log"></div>
    </section>`;
  document.body.append(host);
  const $ = id => root.querySelector(id);
  const panel = $('section');
  function updateMethod() {
    const folderMode = $('#method').value === 'folder';
    $('#start').textContent = folderMode ? 'Choose folder & save' : 'Start Save As downloads';
    $('#compatibility').textContent = folderMode
      ? 'One folder selection, then all images save automatically.'
      : 'Brave will ask where to save each image. For one folder prompt instead, enable File System Access API at brave://flags/#file-system-access-api, relaunch Brave, and reload the AmiAmi tabs.';
  }
  if (typeof window.showDirectoryPicker !== 'function') $('#method').value = 'dialogs';
  $('#method').onchange = updateMethod;
  updateMethod();
  const show = () => { panel.hidden = false; };
  $('#close').onclick = () => { panel.hidden = true; };
  let running = false;
  let stopped = false;
  let activeRequest = null;
  $('#stop').onclick = () => { stopped = true; activeRequest?.abort(); $('#status').textContent = 'Stopping…'; };
  const log = message => { const line = document.createElement('div'); line.textContent = message; $('#log').append(line); };

  async function collect() {
    register();
    // Freeze the open-tab URL list for this click; process it in this tab.
    const found = Object.values(await new Promise(resolve => GM_getTabs(resolve))).map(tab => tab[KEY]).filter(Boolean);
    {
      const current = productURL(location.href);
      if (current) found.unshift({ ...current, item: extract(document, current) });
    }
    const unique = new Map();
    for (const entry of found) {
      const valid = productURL(entry.url);
      if (valid && (!unique.has(valid.code) || entry.item)) unique.set(valid.code, { ...entry, ...valid });
    }
    return [...unique.values()];
  }

  async function resolveProduct(entry) {
    if (entry.item?.image && imageURL(entry.item.image)) return entry.item;
    const token = crypto.randomUUID();
    const storageKey = `${KEY}:${token}`;
    let helper;
    try {
      helper = GM_openInTab(`${entry.url}#amiami-first-image=${token}`, { active: false, insert: true, setParent: true });
      const deadline = Date.now() + TIMING.helper;
      while (!stopped && Date.now() < deadline) {
        const data = GM_getValue(storageKey, null);
        if (data?.error) throw new Error(data.error);
        if (data?.result) return data.result;
        if (helper.closed) throw new Error('Helper tab was closed before the product loaded.');
        await sleep(TIMING.poll);
      }
      throw new Error(stopped ? 'Stopped' : 'Product loading timed out. Open/reload this product tab and retry.');
    } finally {
      helper?.close();
      GM_deleteValue(storageKey);
    }
  }

  function download(url) {
    if (!imageURL(url)) return Promise.reject(new Error('Invalid product image URL.'));
    return new Promise((resolve, reject) => {
      activeRequest = GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'blob', timeout: TIMING.image,
        onload: async response => {
          activeRequest = null;
          if (response.status < 200 || response.status >= 300) { reject(new Error(`Image HTTP ${response.status}`)); return; }
          const blob = response.response;
          if (!blob?.size) { reject(new Error('Empty image response.')); return; }
          try {
            // Decode to reject HTML error pages even when the server returns HTTP 200.
            const bitmap = await createImageBitmap(blob);
            bitmap.close();
            resolve(blob);
          } catch { reject(new Error('The server did not return a readable image.')); }
        },
        onerror: () => { activeRequest = null; reject(new Error('Image network error.')); },
        ontimeout: () => { activeRequest = null; reject(new Error('Image download timed out.')); },
        onabort: () => { activeRequest = null; reject(new Error('Stopped')); }
      });
    });
  }

  async function save(rootDir, item, blob) {
    // Include the product code to distinguish identical/truncated titles.
    const ext = new URL(item.image).pathname.match(/\.(jpg|jpeg|png|webp|gif)$/i)[1].toLowerCase();
    const stem = `${safeName(item.title)} [${safeName(item.code, 35)}]`;
    let name;
    // Preserve existing files: repeated runs receive (2), (3), etc.
    for (let n = 1; ; n++) {
      name = `${stem}${n === 1 ? '' : ` (${n})`}.${ext}`;
      try { await rootDir.getFileHandle(name); }
      catch (error) { if (error.name === 'NotFoundError') break; throw error; }
    }
    const file = await rootDir.getFileHandle(name, { create: true });
    const stream = await file.createWritable();
    try { await stream.write(blob); await stream.close(); }
    catch (error) { try { await stream.abort(); } catch {} throw error; }
  }

  async function saveAs(item, blob) {
    const ext = new URL(item.image).pathname.match(/\.(jpg|jpeg|png|webp|gif)$/i)[1].toLowerCase();
    const name = `${safeName(item.title)} [${safeName(item.code, 35)}].${ext}`;
    const objectURL = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        const finish = callback => value => { activeRequest = null; callback(value); };
        const request = GM_download({
          url: objectURL, name, saveAs: true, conflictAction: 'uniquify',
          onload: finish(resolve),
          onerror: finish(error => reject(new Error(
            `Save As failed (${error?.error || 'cancelled or blocked'}). Check Tampermonkey Download Mode is Browser API, download permission is allowed, and ${ext} is in its allowed extensions.`))),
          ontimeout: finish(() => reject(new Error('Save As download timed out.')))
        });
        activeRequest = { abort() {
          try { request?.abort(); } finally { activeRequest = null; reject(new Error('Stopped')); }
        } };
      });
    } finally {
      activeRequest = null;
      URL.revokeObjectURL(objectURL);
    }
  }

  $('#start').onclick = async () => {
    if (running) return;
    const folderMode = $('#method').value === 'folder';
    if (folderMode && typeof window.showDirectoryPicker !== 'function') {
      $('#status').textContent = 'Brave folder picker is disabled. Enable File System Access API at brave://flags/#file-system-access-api and relaunch, or select Save As dialog for each image.';
      return;
    }
    if (!folderMode && (typeof GM_download !== 'function' || typeof GM_info === 'undefined' || GM_info.downloadMode !== 'browser')) {
      $('#status').textContent = 'In Tampermonkey Settings, set Config mode to Advanced, then Download Mode to Browser API. Allow download permission when asked, then reload this tab.';
      return;
    }
    running = true;
    stopped = false;
    $('#start').disabled = true;
    $('#method').disabled = true;
    $('#log').textContent = '';
    let saved = 0, failed = 0;
    try {
      // Must happen directly from the click, before asynchronous tab discovery.
      const destination = folderMode ? await window.showDirectoryPicker({ id: 'amiami-images', mode: 'readwrite' }) : null;
      const entries = await collect();
      if (!entries.length) throw new Error('No product links found. Reload your open AmiAmi product tabs and try again.');
      $('#stop').disabled = false;
      $('#progress').max = entries.length;
      $('#progress').value = 0;
      for (let i = 0; i < entries.length && !stopped; i++) {
        const entry = entries[i];
        $('#status').textContent = `${i + 1}/${entries.length} · ${entry.code}`;
        try {
          const item = await resolveProduct(entry);
          if (stopped) break;
          const blob = await download(item.image);
          if (stopped) break;
          if (folderMode) await save(destination, item, blob);
          else await saveAs(item, blob);
          saved++;
          log(`Saved: ${item.title}`);
        } catch (error) {
          if (stopped) break;
          failed++;
          log(`Failed: ${entry.url}\n${error.message}`);
        }
        $('#progress').value = i + 1;
        if (i + 1 < entries.length && !stopped) await sleep(TIMING.betweenItems);
      }
      $('#status').textContent = `${stopped ? 'Stopped' : 'Finished'}: ${saved} saved, ${failed} failed${stopped ? `, ${entries.length - saved - failed} remaining` : ''}.`;
    } catch (error) {
      $('#status').textContent = error.name === 'AbortError' ? 'Folder selection cancelled.'
        : ['SecurityError', 'NotAllowedError'].includes(error.name)
          ? 'Folder access was blocked. Allow file editing for AmiAmi in Brave, or choose Save As dialog for each image.' : error.message;
    } finally {
      running = false;
      $('#start').disabled = false;
      $('#method').disabled = false;
      $('#stop').disabled = true;
    }
  };
  return show;
  }
})();
