// A stand-in for instagram.com, served to Chromium by request interception so
// the pages really are on https://www.instagram.com. That matters twice: the
// userscript only acts on that hostname, and the viewer's offscreen frame has
// to be same-origin with the page that opens it.
//
// The embed route paints itself from a script, exactly as the real one does,
// so the viewer is tested against the thing it actually has to cope with: a
// page whose served HTML holds no media at all.

const POSTS = {
  AAphoto1: {
    kind: "photo",
    img: "https://scontent.cdninstagram.com/v/t51.82787-15/photo-one-full.jpg",
    caption: "first light on the dish",
  },
  BBphoto2: {
    kind: "photo",
    img: "https://scontent.cdninstagram.com/v/t51.82787-15/photo-two-full.jpg",
    caption: "second post",
  },
  CCcarousel: {
    kind: "carousel",
    img: "https://scontent.cdninstagram.com/v/t51.82787-15/carousel-first.jpg",
    caption: "three pictures, one post",
  },
  DDreel: {
    kind: "reel",
    video: "https://scontent.cdninstagram.com/o1/v/t2/clip.mp4",
    poster: "https://scontent.cdninstagram.com/v/t51.82787-15/clip-cover.jpg",
    caption: "a moving one",
  },
};

const ORDER = ["AAphoto1", "BBphoto2", "CCcarousel", "DDreel"];

const profilePage = () => `<!doctype html>
<html><head><meta charset="utf-8"><title>fakegram</title>
<style>
  body { font: 14px sans-serif; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(3, 180px); gap: 6px; padding: 12px; }
  .grid a { display: block; width: 180px; height: 180px; background: #ddd; }
  #wall { position: fixed; inset: 0; background: rgba(0,0,0,.8); display: none;
          align-items: center; justify-content: center; z-index: 9999; color: #fff; }
  #wall.up { display: flex; }
</style></head>
<body>
  <h1>fakegram</h1>
  <div class="grid">
    ${ORDER.map((code) => `<a href="/fakegram/p/${code}/" data-code="${code}"><span>${code}</span></a>`).join("\n    ")}
  </div>
  <div id="wall"><div><h2>See this post</h2><p>Sign up or log in to see this post.</p></div></div>
<script>
  // Instagram's own behaviour: every tile raises the wall instead of navigating.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    e.preventDefault();
    document.getElementById("wall").classList.add("up");
  });
</script>
</body></html>`;

// Painted by script, never served in the HTML, like the real embed.
const embedPage = (code) => {
  const post = POSTS[code];
  if (!post) return null;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Instagram</title></head>
<body><div id="root"></div>
<script>
  var post = ${JSON.stringify(post)};
  setTimeout(function () {
    var media = post.video
      ? '<video class="vid" src="' + post.video + '" poster="' + post.poster + '"></video>'
      : '<img class="EmbeddedMediaImage" alt="Instagram post" src="' + post.img + '">';
    var next = post.kind === "carousel"
      ? '<button aria-label="Next">next</button>' : '';
    document.getElementById("root").innerHTML =
      '<div class="Avatar"><img src="https://scontent.cdninstagram.com/v/t51.2885-19/av.jpg"></div>' +
      '<div class="UsernameText">fakegram</div>' +
      media + next +
      '<div class="Caption"><span class="CaptionUsername">fakegram</span> ' + post.caption + '</div>';
  }, 150);
</script>
</body></html>`;
};

// A 1x1 gif, so the CDN URLs in the fixtures resolve to something.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function routeFor(urlString) {
  const url = new URL(urlString);
  const p = url.pathname;

  if (/cdninstagram\.com$/.test(url.hostname)) {
    return { contentType: /\.mp4$/.test(p) ? "video/mp4" : "image/gif", body: PIXEL };
  }

  const embed = /^\/p\/([A-Za-z0-9_-]+)\/embed/.exec(p);
  if (embed) {
    const html = embedPage(embed[1]);
    return html ? { contentType: "text/html; charset=utf-8", body: html } : { status: 404, body: "no" };
  }

  const post = /^(?:\/[^/]+)?\/p\/([A-Za-z0-9_-]+)\/?$/.exec(p);
  if (post) return { contentType: "text/html; charset=utf-8", body: profilePage() };

  if (p === "/" || /^\/[^/]+\/?$/.test(p)) {
    return { contentType: "text/html; charset=utf-8", body: profilePage() };
  }

  return { status: 404, body: "no" };
}

module.exports = { routeFor, POSTS, ORDER };
