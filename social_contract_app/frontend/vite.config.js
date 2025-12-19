import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      disable: process.env.VITE_DISABLE_PWA === "true",
      registerType: "autoUpdate",
      minify: false,
      manifest: {
        name: "Social Contract",
        short_name: "Social Contract",
        start_url: "/",
        display: "standalone",
        background_color: "#0d0f1b",
        theme_color: "#7dd3ff",
        description: "Draft, share, and track agreements with accountability partners.",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
      },
      includeAssets: ["favicon.svg"],
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
  },
});
