import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      // TiTiler is embedded in the backend (backend/app/tiler.py), so raster
      // tile requests go to the same backend as the API.
      "/titiler": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
