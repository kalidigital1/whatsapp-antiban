import { Readable } from "node:stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const uploadMaxBytes = 25 * 1024 * 1024;

router.post(
  "/storage/uploads/request-url",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Os dados do arquivo são inválidos." });
      return;
    }
    if (parsed.data.size > uploadMaxBytes) {
      res.status(400).json({ error: "O arquivo deve ter até 25 MB." });
      return;
    }

    try {
      const uploadURL = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      res.json(RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: parsed.data,
      }));
    } catch (error) {
      req.log.error({ err: error }, "Could not create saved-media upload URL");
      res.status(500).json({ error: "Não foi possível preparar o envio do arquivo." });
    }
  },
);

router.get(
  "/storage/objects/*path",
  async (req: Request, res: Response): Promise<void> => {
    const rawPath = req.params.path;
    const relativePath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
    try {
      const file = await storage.getObjectEntityFile(`/objects/${relativePath}`);
      const response = await storage.downloadObject(file);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (!response.body) {
        res.end();
        return;
      }
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Arquivo não encontrado." });
        return;
      }
      req.log.error({ err: error }, "Could not serve saved media");
      if (!res.headersSent) res.status(500).json({ error: "Não foi possível carregar o arquivo." });
      else res.destroy(error instanceof Error ? error : undefined);
    }
  },
);

export default router;
