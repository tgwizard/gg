import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devLogs } from "./tools/dev-logs";

export default defineConfig({
  // devLogs first, so its endpoint is answered before requests reach the Worker.
  plugins: [devLogs(), react(), cloudflare()],
});
