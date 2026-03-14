import { Router } from "express";
import { createProxyMiddleware, responseInterceptor } from "http-proxy-middleware";

const DB_DASHBOARD_URL =
  process.env.PAPERCLIP_DB_DASHBOARD_URL ?? "http://localhost:8476";

const PROXY_BASE = "/api/instance/db-proxy";

const router = Router();

router.use((req, res, next) => {
  if (req.actor.type !== "board") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

router.use(
  createProxyMiddleware({
    target: DB_DASHBOARD_URL,
    changeOrigin: true,
    selfHandleResponse: true,
    on: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      proxyRes: responseInterceptor(async (buffer, proxyRes: any) => {
        const contentType: string = proxyRes.headers?.["content-type"] ?? "";
        if (contentType.includes("text/html")) {
          const html = buffer.toString("utf8");
          // Inject <base> so absolute paths in muninndb resolve through the proxy
          if (html.includes("<head>")) {
            return html.replace("<head>", `<head><base href="${PROXY_BASE}/">`);
          }
          if (html.includes("<HEAD>")) {
            return html.replace("<HEAD>", `<HEAD><base href="${PROXY_BASE}/">`);
          }
        }
        return buffer;
      }) as never,
    },
  }),
);

export { router as instanceDbProxyRoutes };
