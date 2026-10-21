import { execFileSync } from "node:child_process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode, command }) => {
  const env = {...loadEnv(mode,process.cwd(),''),...process.env};
  if (command==='build' && mode==='production' && (env.VITE_LOCAL_CARE==='1' || env.VITE_USE_EMULATORS==='1' || env.VITE_CARE_DEVICE_ORIGIN || env.VITE_FIREBASE_PROJECT_ID?.startsWith('demo-'))) throw new Error('Production builds must exclude emulator/demo configuration');
  const commit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const dirty=execFileSync("git",["status","--porcelain","--untracked-files=normal"],{encoding:"utf8"}).trim().length>0;
  return ({
  define: { __BUILD_COMMIT__: JSON.stringify(commit), __BUILD_DIRTY__: JSON.stringify(dirty) },

  // This preview only talks to local emulators. No production API, proxy or model service.
  server: ['care','unified-preview'].includes(mode) ? { watch:{ignored:["**/.care-device/**","**/test-results/**"]}, headers: { 'Content-Security-Policy': "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*" } } : {watch:{ignored:["**/.care-device/**","**/test-results/**"]}},
  preview: ['care','unified-preview'].includes(mode) ? { headers: { 'Content-Security-Policy': "connect-src 'self' http://127.0.0.1:* http://localhost:*" } } : undefined,
  plugins: [
    { name:"build-identity",generateBundle(){this.emitFile({type:"asset",fileName:"build-info.json",source:JSON.stringify({version:"1.5.0-local",commit,dirty,mode})});} },
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "consumption-catalog.json"],
      workbox: {
        maximumFileSizeToCacheInBytes: 5_000_000,
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2,ttf}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        id: "/",
        name: "טנק מלא",
        short_name: "טנק מלא",
        description: "יומן התדלוקים החכם שלך — צריכה, עלויות ומגמות.",
        lang: "he",
        dir: "rtl",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#F4F5F5",
        theme_color: "#0B6B5E",
        categories: ["productivity", "utilities"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
}); });
