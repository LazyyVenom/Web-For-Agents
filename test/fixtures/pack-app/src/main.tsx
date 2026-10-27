import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { SeoProvider } from "@anubhav-choubey/web-for-agents";
import { App } from "./App";

declare const __SITE_URL__: string;

createRoot(document.getElementById("root")!).render(
  <SeoProvider
    defaults={{
      siteName: "Lantern Tea",
      siteUrl: __SITE_URL__,
      titleTemplate: "%s | Lantern Tea",
      image: "/og.svg",
    }}
  >
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </SeoProvider>,
);
