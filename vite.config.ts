import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devLogs } from "./tools/dev-logs.ts";

export default defineConfig({
  // devLogs first, so its endpoint is answered before requests reach the Worker.
  // No Worker debugger: nobody attaches one, and it only warns when port 9229 is taken.
  plugins: [devLogs(), react(), cloudflare({ inspectorPort: false })],
});
