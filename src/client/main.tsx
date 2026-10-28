import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../ui";
import { App } from "./App";
import "./app.css";
import { checkSiteUpdated } from "./update";

// A file this page needs is gone or didn't load: if the site was updated, the page is
// stale, and reloads when it can (see ./update). The error itself is the caller's to show.
window.addEventListener("vite:preloadError", () => void checkSiteUpdated());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
