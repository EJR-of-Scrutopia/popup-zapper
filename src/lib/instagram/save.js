// Saving a post's media at the size Instagram actually served it.
//
// A plain <a download> is ignored by the browser for a cross-origin CDN file, so
// the bytes are pulled through GM_xmlhttpRequest as a blob and saved from an
// object URL. anonymous: true keeps the request cookie-free, like every other
// call this feature makes.

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "heic", "gif"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v"]);

export function fileNameFor(item, shortcode) {
  const stem = item.index ? `instagram-${shortcode}-${item.index}` : `instagram-${shortcode}`;
  return `${stem}.${extensionFor(item)}`;
}

function extensionFor(item) {
  const fallback = item.type === "video" ? "mp4" : "jpg";
  const allowed = item.type === "video" ? VIDEO_EXT : IMAGE_EXT;
  const path = String(item.url || "").split("?")[0];
  const dot = path.lastIndexOf(".");
  if (dot < 0) return fallback;
  const ext = path.slice(dot + 1).toLowerCase();
  // Never trust an extension off a URL beyond the handful we expect.
  return allowed.has(ext) ? ext : fallback;
}

export async function saveMedia(item, { shortcode, gmXhr, doc }) {
  if (!item || !item.url) return { ok: false, reason: "There is nothing to save for this post." };

  let blob;
  try {
    blob = await fetchBlob(item.url, gmXhr);
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  const href = URL.createObjectURL(blob);
  try {
    const a = doc.createElement("a");
    a.setAttribute("href", href);
    a.setAttribute("download", fileNameFor(item, shortcode));
    a.style.display = "none";
    doc.body.appendChild(a);
    a.click();
    a.remove();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Could not save that file: ${err.message}` };
  } finally {
    // Not in this task. Chromium does not reliably finish reading a blob URL
    // within the click that started the download, and revoking underneath it
    // fails the download outright, the more likely the bigger the file.
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }
}

function fetchBlob(url, gmXhr) {
  return new Promise((resolve, reject) => {
    try {
      gmXhr({
        method: "GET",
        url,
        responseType: "blob",
        anonymous: true,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300 && res.response) resolve(res.response);
          else reject(new Error(`Could not fetch that file (${res.status}).`));
        },
        onerror: () => reject(new Error("Could not reach Instagram's servers for that file.")),
        ontimeout: () => reject(new Error("Timed out fetching that file.")),
      });
    } catch (err) {
      reject(new Error(`Could not fetch that file: ${err.message}`));
    }
  });
}
