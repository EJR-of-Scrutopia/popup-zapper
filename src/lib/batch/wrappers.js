// Watching the page hand a file over. Each wrapper calls the page's own
// function with the same `this` and arguments and returns exactly what it
// returned; the bookkeeping sits beside the call inside try/catch, so a fault
// in it never reaches the page, and while no batch waits they only call
// through. Installed on the first Play, never at load.
//
// `scope` is the page's window (unsafeWindow under a userscript manager) or a
// stand-in in tests. `sink` says which batch waits (tag), the time (now), the
// page address (base), and takes each event (note).

import { headersFromRaw, isFileResponse, shortUrl } from "./evidence.js";

function methodOf(input, init) {
  const named = (init && init.method) || (input && typeof input === "object" && input.method) || "GET";
  return String(named).toUpperCase();
}

function urlOf(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  return String(input);
}

function headerOf(response, name) {
  try {
    const headers = response && response.headers;
    const value = headers && typeof headers.get === "function" ? headers.get(name) : null;
    return value == null ? "" : String(value);
  } catch {
    return "";
  }
}

// Read a COPY of a response to its last byte and say when it is done or broke
// off. The page's own response is untouched.
function drainCopy(response, finished) {
  let reader = null;
  try {
    const copy = response.clone();
    const body = copy && copy.body;
    if (!body || typeof body.getReader !== "function") { finished(null); return; }
    reader = body.getReader();
  } catch (error) {
    finished(error);
    return;
  }
  const pump = () => {
    try {
      reader.read().then(
        (step) => { if (step && step.done) finished(null); else pump(); },
        (error) => finished(error || new Error("the download broke off")),
      );
    } catch (error) {
      finished(error);
    }
  };
  pump();
}

// A wrapper reports the same length as the function it wraps.
function sameShape(wrapper, original) {
  try { Object.defineProperty(wrapper, "length", { value: original.length }); } catch { /* cosmetic */ }
  return wrapper;
}

export function installWrappers(scope, sink) {
  const done = { fetch: false, xhr: false, blob: false, anchor: false };
  if (!scope || !sink) return done;

  const tagNow = () => {
    try {
      const tag = sink.tag();
      return typeof tag === "number" && Number.isFinite(tag) ? tag : null;
    } catch { return null; }
  };
  const timeNow = () => { try { return sink.now(); } catch { return NaN; } };
  const baseNow = () => { try { return String(sink.base() || ""); } catch { return ""; } };
  const tell = (event) => { try { sink.note(event); } catch { /* never the page's problem */ } };

  // A fetch is finished when its body has been read to the end, not when its
  // headers arrive: a zip still streaming in has not been handed over.
  function followFetch(result, request) {
    if (!result || typeof result.then !== "function") return;
    const after = result.then((response) => {
      try {
        const event = {
          kind: "response", via: "fetch", batch: request.tag, method: request.method, url: request.url,
          status: response && typeof response.status === "number" ? response.status : 0,
          contentType: headerOf(response, "content-type"),
          disposition: headerOf(response, "content-disposition"),
          at: NaN, failed: false,
        };
        if (!isFileResponse(event)) { event.at = timeNow(); tell(event); return; }
        // Announced now, finished once the copy is read.
        tell(Object.assign({}, event, { kind: "incoming", at: timeNow() }));
        drainCopy(response, (error) => { event.at = timeNow(); event.failed = !!error; tell(event); });
      } catch { /* the page has its response regardless */ }
    }, () => {
      tell({
        kind: "response", via: "fetch", batch: request.tag, method: request.method, url: request.url,
        status: 0, contentType: "", disposition: "", at: timeNow(), failed: true,
      });
    });
    if (after && typeof after.catch === "function") after.catch(() => {});
  }

  try {
    const originalFetch = scope.fetch;
    if (typeof originalFetch === "function") {
      scope.fetch = sameShape(function fetch(input, init) {
        let request = null;
        try {
          const tag = tagNow();
          if (tag !== null) request = { tag, method: methodOf(input, init), url: shortUrl(urlOf(input), baseNow()) };
        } catch { request = null; }
        const result = originalFetch.apply(this, arguments);
        if (request) { try { followFetch(result, request); } catch { /* nothing */ } }
        return result;
      }, originalFetch);
      done.fetch = true;
    }
  } catch { done.fetch = false; }

  function xhrEvent(xhr, request, kind) {
    let raw = "";
    try { raw = xhr.getAllResponseHeaders() || ""; } catch { raw = ""; }
    const head = headersFromRaw(raw);
    const status = typeof xhr.status === "number" ? xhr.status : 0;
    let address = request.url;
    try { if (xhr.responseURL) address = String(xhr.responseURL); } catch { address = request.url; }
    return {
      kind, via: "xhr", batch: request.tag, method: request.method,
      url: shortUrl(address, baseNow()), status,
      contentType: head.contentType, disposition: head.disposition,
      at: timeNow(), failed: kind === "response" && status === 0,
    };
  }

  // Headers in (readyState 2): announced if they name a file. Last byte in
  // (readyState 4): reported whatever it was.
  function xhrStep(xhr, request) {
    if (request.tag === null || request.finished) return;
    const state = xhr.readyState;
    if (state >= 2 && !request.announced) {
      request.announced = true;
      const arriving = xhrEvent(xhr, request, "incoming");
      if (isFileResponse(arriving)) tell(arriving);
    }
    if (state === 4) {
      request.finished = true;
      tell(xhrEvent(xhr, request, "response"));
    }
  }

  // The listener goes on at open where it can, so the script hears the news
  // before a page listener added after open.
  function listen(xhr, request) {
    if (request.listening || typeof xhr.addEventListener !== "function") return;
    request.listening = true;
    xhr.addEventListener("readystatechange", () => { try { xhrStep(xhr, request); } catch { /* nothing */ } });
  }

  try {
    const XHR = scope.XMLHttpRequest;
    const proto = XHR && XHR.prototype;
    const originalOpen = proto && proto.open;
    const originalSend = proto && proto.send;
    if (typeof originalOpen === "function" && typeof originalSend === "function") {
      const requests = new WeakMap();
      proto.open = sameShape(function open(method, url) {
        try {
          const request = {
            method: String(method || "GET").toUpperCase(), url: String(url), tag: null,
            announced: false, finished: false, listening: false,
          };
          requests.set(this, request);
          if (tagNow() !== null) listen(this, request);
        } catch { /* the page's own open still runs */ }
        return originalOpen.apply(this, arguments);
      }, originalOpen);
      proto.send = sameShape(function send() {
        try {
          const tag = tagNow();
          const request = requests.get(this);
          if (tag !== null && request) { request.tag = tag; listen(this, request); }
        } catch { /* the page's own send still runs */ }
        return originalSend.apply(this, arguments);
      }, originalSend);
      done.xhr = true;
    }
  } catch { done.xhr = false; }

  try {
    const Addresses = scope.URL;
    const originalCreate = Addresses && Addresses.createObjectURL;
    if (typeof originalCreate === "function") {
      Addresses.createObjectURL = sameShape(function createObjectURL(object) {
        const made = originalCreate.apply(this, arguments);
        try {
          const tag = tagNow();
          if (tag !== null) {
            tell({
              kind: "blob", at: timeNow(), batch: tag, url: String(made),
              type: object && typeof object.type === "string" ? object.type : "",
              size: object && typeof object.size === "number" ? object.size : null,
            });
          }
        } catch { /* the page has its address regardless */ }
        return made;
      }, originalCreate);
      done.blob = true;
    }
  } catch { done.blob = false; }

  // Only links: the wrapper sits on the anchor's own prototype.
  try {
    const Anchor = scope.HTMLAnchorElement;
    const proto = Anchor && Anchor.prototype;
    const originalClick = proto && proto.click;
    if (typeof originalClick === "function") {
      proto.click = sameShape(function click() {
        try {
          const tag = tagNow();
          if (tag !== null) {
            tell({
              kind: "anchor", at: timeNow(), batch: tag, href: String(this.href || ""),
              download: typeof this.getAttribute === "function" ? String(this.getAttribute("download") || "") : "",
            });
          }
        } catch { /* the page's own click still runs */ }
        return originalClick.apply(this, arguments);
      }, originalClick);
      done.anchor = true;
    }
  } catch { done.anchor = false; }

  return done;
}

// window.open, a form submitted, a frame given an address: each can START a
// download the page never reads, so none is evidence of a hand-over. They go
// into the trace, so a real run shows which one a site uses.
export function installStartWrappers(scope, sink) {
  const done = { open: false, submit: false, frame: false };
  if (!scope || !sink) return done;
  const report = (kind, details) => {
    try {
      const waiting = sink.tag();
      if (typeof waiting !== "number" || !Number.isFinite(waiting)) return;
      let when = NaN;
      try { when = sink.now(); } catch { when = NaN; }
      sink.note(Object.assign({ kind, at: when, batch: waiting }, details));
    } catch { /* never the page's problem */ }
  };

  try {
    const originalOpen = scope.open;
    if (typeof originalOpen === "function") {
      scope.open = sameShape(function open(url) {
        report("open", { url: String(url == null ? "" : url) });
        return originalOpen.apply(this, arguments);
      }, originalOpen);
      done.open = true;
    }
  } catch { done.open = false; }

  try {
    const Form = scope.HTMLFormElement;
    const formProto = Form && Form.prototype;
    for (const name of ["submit", "requestSubmit"]) {
      const original = formProto && formProto[name];
      if (typeof original !== "function") continue;
      formProto[name] = sameShape(function () {
        report("submit", { url: String(this.action || ""), method: String(this.method || "get").toUpperCase(), via: name });
        return original.apply(this, arguments);
      }, original);
      done.submit = true;
    }
  } catch { /* whatever was wrapped stays wrapped */ }

  try {
    const Frame = scope.HTMLIFrameElement;
    const frameProto = Frame && Frame.prototype;
    const held = frameProto && Object.getOwnPropertyDescriptor(frameProto, "src");
    if (held && typeof held.set === "function" && held.configurable) {
      Object.defineProperty(frameProto, "src", {
        get: held.get,
        set(value) { report("iframe", { url: String(value) }); return held.set.call(this, value); },
        configurable: true,
        enumerable: held.enumerable,
      });
      done.frame = true;
    }
    const originalSet = frameProto && frameProto.setAttribute;
    if (typeof originalSet === "function") {
      frameProto.setAttribute = sameShape(function setAttribute(name, value) {
        if (String(name).toLowerCase() === "src") report("iframe", { url: String(value) });
        return originalSet.apply(this, arguments);
      }, originalSet);
      done.frame = true;
    }
  } catch { /* as above */ }
  return done;
}
