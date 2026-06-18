import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.js";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.disableVerticalSwipes?.();

function syncViewport() {
  const h = tg?.viewportStableHeight ?? tg?.viewportHeight;
  if (h) document.documentElement.style.setProperty("--app-height", `${h}px`);
}
syncViewport();
tg?.onEvent?.("viewportChanged", syncViewport);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
