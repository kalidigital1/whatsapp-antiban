import express, { type Express } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const frontendDistCandidates = [
  process.env.FRONTEND_DIST_DIR,
  path.resolve(process.cwd(), "artifacts/whatsapp-recovery-ia/dist/public"),
  path.resolve(process.cwd(), "../whatsapp-recovery-ia/dist/public"),
].filter((directory): directory is string => Boolean(directory));
const frontendDist = frontendDistCandidates.find((directory) =>
  fs.existsSync(path.join(directory, "index.html")),
);
if (process.env.NODE_ENV === "production" && frontendDist) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    const isApiRequest = req.path === "/api" || req.path.startsWith("/api/");
    if (req.method === "GET" && !isApiRequest) {
      res.sendFile(path.join(frontendDist, "index.html"));
      return;
    }
    next();
  });
}

export default app;
