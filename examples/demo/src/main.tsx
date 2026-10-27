import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { SeoProvider } from "@anubhav-choubey/web-for-agents";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <SeoProvider
    defaults={{
      siteName: "Paper Lantern Books",
      siteUrl: "https://paperlantern.example",
      titleTemplate: "%s | Paper Lantern Books",
      description: "Paper Lantern Books is a small independent bookshop with hand-picked reads.",
      image: "/og.svg",
      locale: "en_GB",
    }}
  >
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </SeoProvider>,
);
