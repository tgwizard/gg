import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildInfo } from "./tools/build-info.ts";
import { devLogs } from "./tools/dev-logs.ts";

export default defineConfig(({ command }) => ({
  // One build stamp for the page and the Worker alike (src/shared/build.ts); dev is "dev".
  define: { __GG_BUILD__: JSON.stringify(command === "build" ? buildInfo() : { id: "dev", games: {} }) },
  // devLogs first, so its endpoint is answered before requests reach the Worker.
  // No Worker debugger: nobody attaches one, and it only warns when port 9229 is taken.
  plugins: [devLogs(), react(), cloudflare({ inspectorPort: false })],
}));
