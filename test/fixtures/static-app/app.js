const root = document.getElementById("root");
const show = (html) => {
  root.innerHTML = `<main>${html}</main>`;
};

function boom() {
  throw new Error("boom");
}

function start() {
  switch (location.pathname) {
    case "/":
      show('<h1>Home</h1><a href="/fetch">Fetch</a> <a href="/held">Held</a>');
      break;
    case "/fetch":
      fetch("/data.json")
        .then((r) => r.json())
        .then((d) => show(`<p>${d.text}</p>`));
      break;
    case "/held":
      window.__WFA_READY__ = false;
      setTimeout(() => {
        show("<h1>Held</h1>");
        window.__WFA_READY__ = true;
      }, 300);
      break;
    case "/forever":
      window.__WFA_READY__ = false;
      break;
    case "/boom":
      boom();
      break;
    case "/reject":
      fetch("/data.json").then(() => {
        throw new Error("async boom");
      });
      break;
    case "/console":
      console.timeStamp("t");
      console.profile("p");
      console.profileEnd("p");
      show("<h1>Console</h1>");
      break;
    case "/interval":
      setInterval(() => {}, 1000);
      show("<h1>Interval</h1>");
      break;
    case "/dynamic":
      import("./chunk.js").then((m) => m.render(root));
      break;
    case "/css": {
      // what Vite's preload helper does for a lazy chunk's CSS: append a stylesheet, then listen
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.crossOrigin = "";
      link.href = "/style.css";
      document.head.appendChild(link);
      link.addEventListener("load", () => show("<h1>Styled</h1>"));
      link.addEventListener("error", () => show("<h1>Unstyled</h1>"));
      break;
    }
    case "/empty":
      break;
    case "/xorigin": {
      // loads a script, stylesheet and image from the origin in ?from=, then renders regardless
      const from = new URLSearchParams(location.search).get("from");
      const script = document.createElement("script");
      script.async = true; // as browsers treat inserted scripts; happy-dom loads others synchronously
      script.src = from + "/evil.js";
      document.head.appendChild(script);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = from + "/evil.css";
      document.head.appendChild(link);
      show(`<h1>Cross</h1><img src="${from}/evil.png" alt="">`);
      break;
    }
    case "/xfetch": {
      // the render survives a failed request it handles
      const from = new URLSearchParams(location.search).get("from");
      fetch(from + "/data.json").then(
        (r) => r.json().then((d) => show(`<p>xfetch ok ${d.text}</p>`)),
        (e) => show(`<p>xfetch failed ${e && e.name}</p>`),
      );
      break;
    }
    case "/xneeds": {
      // the render depends on the request
      const from = new URLSearchParams(location.search).get("from");
      fetch(from + "/data.json")
        .then((r) => r.json())
        .then((d) => show(`<p>${d.text}</p>`));
      break;
    }
    case "/escape": {
      // a hostile script: escapes happy-dom's VM to Node's process, reads secrets, writes a file
      const q = new URLSearchParams(location.search);
      let out;
      try {
        const p = window.constructor.constructor("return process")();
        out = { escaped: true, secret: p.env.WFA_TEST_SECRET ?? null, keys: Object.keys(p.env).sort() };
        p.env.WFA_TEST_SECRET = "overwritten";
        try {
          p.getBuiltinModule("fs").writeFileSync(q.get("write"), "pwned");
          out.wrote = true;
        } catch (e) {
          out.wrote = String(e && (e.code || e.name));
        }
      } catch (e) {
        out = { escaped: false, error: String(e && e.name) };
      }
      show(`<pre id="escape">${JSON.stringify(out)}</pre>`);
      break;
    }
    case "/xsocket": {
      const from = new URLSearchParams(location.search).get("from");
      let result = "opened";
      try {
        new WebSocket(from.replace(/^http/, "ws") + "/socket");
      } catch (e) {
        result = "refused " + e.name;
      }
      show(`<p>socket ${result}</p>`);
      break;
    }
  }
}

start();
