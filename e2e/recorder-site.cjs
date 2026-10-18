// A fake two-site library shaped like the CIBSE Knowledge Portal, for the
// step recorder's end-to-end check. One port, two origins: the list and
// items on http://127.0.0.1:PORT, the viewer on http://localhost:PORT.
//   /list?page=1|2  three cards a page, each with "Access Now"; Next Page on page 1
//   /item/N         "Read online" opens the viewer in a new tab; item 5 is "Buy now" only
//   /viewer/N       draws a toolbar after 800 ms with an icon-only Download button
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

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
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

function item(n, viewerOrigin) {
  const action = n === 5
    ? `<p class="gate">Members only: Buy now</p><button class="buy">Buy now</button>`
    : `<p><a class="btn read" href="${viewerOrigin}/viewer/${n}" target="_blank">Read online</a></p>`;
  return page(TITLES[n], `<header class="site"><h1>${TITLES[n]}</h1></header><main class="item">${action}</main>`);
}

function viewer(n) {
  return page("Viewer", `<div id="app">Loading…</div><script>
    setTimeout(function () {
      document.getElementById("app").innerHTML =
        '<div class="toolbar"><span class="group"><button class="cmd ms-Button root-123" aria-label="Download"><i class="icon"></i></button></span></div>' +
        '<canvas width="200" height="260"></canvas>';
      document.querySelector(".cmd").addEventListener("click", function () { location.href = "/file/${n}.pdf"; });
    }, 800);
  </script>`);
}

function start(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      const viewerOrigin = `http://localhost:${server.address().port}`;
      const send = (status, type, body, extra = {}) => {
        res.writeHead(status, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, extra));
        res.end(body);
      };
      let match;
      if (url.pathname === "/list") return send(200, "text/html", list(url.searchParams.get("page") === "2" ? 2 : 1));
      if ((match = /^\/item\/(\d)$/.exec(url.pathname)) && TITLES[match[1]]) return send(200, "text/html", item(Number(match[1]), viewerOrigin));
      if ((match = /^\/viewer\/(\d)$/.exec(url.pathname))) return send(200, "text/html", viewer(Number(match[1])));
      if ((match = /^\/file\/(\d)\.pdf$/.exec(url.pathname))) {
        return send(200, "application/pdf", `%PDF-1.4 fake document ${match[1]}`, { "Content-Disposition": `attachment; filename="doc-${match[1]}.pdf"` });
      }
      return send(404, "text/plain", "not here");
    });
    server.listen(port, () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}

module.exports = { start };
