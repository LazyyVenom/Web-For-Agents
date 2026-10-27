import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.DEV) import("../../../../src/overlay/index").then((m) => m.mountOverlay());
