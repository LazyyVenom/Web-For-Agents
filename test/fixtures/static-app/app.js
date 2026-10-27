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
    case "/interval":
      setInterval(() => {}, 1000);
      show("<h1>Interval</h1>");
      break;
    case "/dynamic":
      import("./chunk.js").then((m) => m.render(root));
      break;
    case "/empty":
      break;
  }
}

start();
