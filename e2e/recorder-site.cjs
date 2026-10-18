// A fake two-site library built like the CIBSE Knowledge Portal, for the
// step recorder's end-to-end check. One port, three origins: the list and
// items on http://127.0.0.1:PORT, the viewer on http://localhost:PORT, a
// login page on http://[::1]:PORT.
//   /list?page=1|2  three cards a page, each with "Access Now"; Next Page on page 1
//   /item/N         a Download link (main and side copies, the main one hidden
//                   on a wide screen) that the site's script takes over late,
//                   as CIBSE's jQuery does at DOM ready: it opens an agreement
//                   box whose "Yes, I agree" calls window.open(viewer).
//                   "Back To All Knowledge Items" goes to the list's first page.
//                   Item 5 has "Buy now" instead.
//   /site.js        that script, served 1.2 s late
//   /viewer/N       draws a toolbar after 800 ms with an icon-only Download button;
//                   viewer 6 goes to a login page on a third origin (a lapsed session)
//   /file/N.pdf     served as an attachment

const http = require("http");

const TITLES = {
  1: "Guide D1 Transportation systems in buildings 2025",
  2: "TM59 Overheating risk in dwellings 2026",
  3: "TM71 Measuring heat transfer coefficients 2026",
  4: "Guide A Environmental design 2025",
  5: "Commissioning Code M 2024",
  6: "TM65 Embodied carbon in building services 2026",
};

const STYLE = `<style>
  .modal { display: none; } .modal.show { display: block; position: fixed; top: 20%; left: 30%; background: #fff; border: 1px solid #333; padding: 20px; }
  @media (min-width: 768px) { .d-md-none { display: none; } }
</style>`;

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${STYLE}<script defer src="/site.js"></script></head><body>${body}</body></html>`;
}

function card(n) {
  return `<article class="card">
    <a class="thumb" href="/item/${n}"><img alt="" width="40" height="40"></a>
    <h3><a class="title" href="/item/${n}">${TITLES[n]}</a></h3>
    <p class="price">Available to Members from FREE</p>
    <a class="btn access" href="/item/${n}">Access Now</a>
  </article>`;
}

function list(number) {
  const items = number === 1 ? [1, 2, 3] : [4, 5, 6];
  const pager = number === 1
    ? `<nav class="pager"><a href="/list?page=0">Previous Page</a> <a class="active" aria-current="page" href="/list?page=1">1</a> <a href="/list?page=2">2</a> <a href="/list?page=2">Next Page</a></nav>`
    : `<nav class="pager"><a href="/list?page=1">Previous Page</a> <a href="/list?page=1">1</a> <a class="active" aria-current="page" href="/list?page=2">2</a></nav>`;
  return page("Knowledge Portal", `<header class="site"><h1>Knowledge Portal</h1></header>
    <main><div class="results">${items.map(card).join("")}</div>${pager}</main>`);
}

function purchase(where, viewerUrl) {
  return `<div class="knowledge-purchase-cta"><div class="tab-content">
    <div class="knowledge-purchase-cta__inner tab-pane active" id="knowldge-purchase-${where}-download">
      <p>Member Rate FREE</p>
      <a href="${viewerUrl}" target="_blank" data-modal="download" class="btn btn-secondary btn-block btn-cta knowledge-purchase-cta__btn-purchase">Download</a>
    </div></div></div>`;
}

function item(n, viewerOrigin) {
  const viewerUrl = `${viewerOrigin}/viewer/${n}`;
  const back = `<a class="btn btn-clear subpage-hero-banner__btn-back" href="/list?page=1"><span class="btn-back__text">Back To All Knowledge Items</span></a>`;
  if (n === 5) {
    return page(TITLES[n], `<main>${back}<h1>${TITLES[n]}</h1><p class="gate">Members only: Buy now</p><button class="buy">Buy now</button></main>`);
  }
  return page(TITLES[n], `<main class="content-body__main">${back}<h1>${TITLES[n]}</h1>
      <div class="knowledge-detail__purchase-cta d-md-none">${purchase("main", viewerUrl)}</div>
      <div id="download-modal" class="modal" role="dialog"><h2>IMPORTANT NOTICE</h2><p>I agree the content remains the copyright property of CIBSE.</p>
        <button type="button" class="btn btn-secondary btn-cta-confirm">Yes, I agree</button>
        <button type="button" class="btn btn-light btn-cta-cancel">Cancel</button></div>
    </main>
    <aside class="content-body__aside"><div class="knowledge-detail__purchase-cta">${purchase("aside", viewerUrl)}</div></aside>`);
}

// What CIBSE's download-modal.ts does, without jQuery.
const SITE_JS = `
document.addEventListener("DOMContentLoaded", function () {
  var modal = document.getElementById("download-modal");
  if (!modal) return;
  var href = "";
  modal.querySelector(".btn-cta-confirm").addEventListener("click", function () {
    window.open(href, "_blank").focus();
    modal.classList.remove("show");
  });
  modal.querySelector(".btn-cta-cancel").addEventListener("click", function () { modal.classList.remove("show"); });
  document.querySelectorAll('[data-modal="download"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      href = e.target.href;
      modal.classList.add("show");
    });
  });
});`;

function viewer(n, port) {
  if (n === 6) return `<!doctype html><script>location.replace("http://[::1]:${port}/login");</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Viewer</title></head><body><div id="app">Loading…</div><script>
    setTimeout(function () {
      document.getElementById("app").innerHTML =
        '<div class="toolbar"><span class="group"><button class="cmd ms-Button root-123" aria-label="Download"><i class="icon"></i></button></span></div>' +
        '<canvas width="200" height="260"></canvas>';
      document.querySelector(".cmd").addEventListener("click", function () { location.href = "/file/${n}.pdf"; });
    }, 800);
  </script></body></html>`;
}

function start(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      const here = server.address().port;
      const send = (status, type, body, extra = {}) => {
        res.writeHead(status, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, extra));
        res.end(body);
      };
      let match;
      if (url.pathname === "/site.js") { setTimeout(() => send(200, "text/javascript", SITE_JS), 1200); return; }
      if (url.pathname === "/list") return send(200, "text/html", list(url.searchParams.get("page") === "2" ? 2 : 1));
      if ((match = /^\/item\/(\d)$/.exec(url.pathname)) && TITLES[match[1]]) return send(200, "text/html", item(Number(match[1]), `http://localhost:${here}`));
      if ((match = /^\/viewer\/(\d)$/.exec(url.pathname))) return send(200, "text/html", viewer(Number(match[1]), here));
      if (url.pathname === "/login") return send(200, "text/html", "<!doctype html><title>Sign in</title><h1>Sign in to your account</h1>");
      if ((match = /^\/file\/(\d)\.pdf$/.exec(url.pathname))) {
        return send(200, "application/pdf", `%PDF-1.4 fake document ${match[1]}`, { "Content-Disposition": `attachment; filename="doc-${match[1]}.pdf"` });
      }
      return send(404, "text/plain", "not here");
    });
    server.listen(port, () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}

module.exports = { start };
