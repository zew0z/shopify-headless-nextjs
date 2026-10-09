import { defineConfig, memoryCache } from "astro/config";
import node from "@astrojs/node";
export default defineConfig({ output: "server", adapter: node({ mode: "standalone" }), session: false, cache: { provider: memoryCache({ max: 100 }) }, security: { checkOrigin: true } });
