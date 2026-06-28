/// <reference types="vitest" />
import {
  defineConfig,
  type Plugin,
  type ViteDevServer,
  type PreviewServer,
  type IndexHtmlTransformContext,
} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  cspDirectives,
  buildCspString,
  cspMetaString,
} from "../api-server/src/lib/csp";

// Single source of truth: cspDirectives lives in lib/csp.ts (shared with helmet).
// frame-ancestors is excluded from STRICT_CSP — browsers ignore it in <meta> tags;
// it is only effective as an HTTP response header (preview server / nginx in prod).
const STRICT_CSP = cspMetaString;

// DEV_CSP extends production directives with Vite HMR requirements.
function buildDevCsp(): string {
  const dev = {
    ...cspDirectives,
    scriptSrc:  [...cspDirectives.scriptSrc,  "'unsafe-inline'"],
    styleSrc:   [...cspDirectives.styleSrc,   "'unsafe-inline'"],
    connectSrc: [...cspDirectives.connectSrc, "ws:"],
  };
  const toKebab = (k: string) =>
    k.replace(/([A-Z])/g, (_, c: string) => `-${c.toLowerCase()}`);
  return Object.entries(dev)
    .map(([key, vals]) => `${toKebab(key)} ${vals.join(" ")}`)
    .join("; ");
}

const DEV_CSP = buildDevCsp();

function cspHeaderPlugin(): Plugin {
  return {
    name: "medicore-csp",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((_req: IncomingMessage, res: ServerResponse, next: () => void) => {
        res.setHeader("Content-Security-Policy", DEV_CSP);
        next();
      });
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use((_req: IncomingMessage, res: ServerResponse, next: () => void) => {
        // buildCspString() includes frame-ancestors 'none' and report-uri (if Phase 2 enabled)
        res.setHeader("Content-Security-Policy", buildCspString());
        next();
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html: string, ctx: IndexHtmlTransformContext) {
        if (!ctx.server) {
          return html.replace(
            "<head>",
            `<head>\n    <meta http-equiv="Content-Security-Policy" content="${STRICT_CSP}" />`
          );
        }
        return html;
      },
    },
  };
}

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    cspHeaderPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
