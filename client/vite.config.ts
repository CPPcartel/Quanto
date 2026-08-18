import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Serve the whitepaper for viewing rather than saving.
 *
 * Without an explicit Content-Disposition the browser is left to infer intent,
 * and some configurations fall back to downloading. Stating `inline` removes
 * the ambiguity: this is a document to render in the tab, not an attachment.
 * The production equivalent lives in vercel.json — both are needed.
 */
function inlinePdf(): Plugin {
  return {
    name: "inline-pdf",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0].endsWith(".pdf")) {
          res.setHeader("Content-Disposition", 'inline; filename="whitepaper.pdf"');
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0].endsWith(".pdf")) {
          res.setHeader("Content-Disposition", 'inline; filename="whitepaper.pdf"');
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), inlinePdf()],
  server: { port: 5173 },
});
