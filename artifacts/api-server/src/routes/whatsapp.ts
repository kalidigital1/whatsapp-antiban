import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import {
  ConnectEvolutionWhatsAppBody,
  ConnectWhatsAppBody,
  CreateSavedReplyBody,
  CreateSavedReplyResponse,
  CreateContactBody,
  DeleteContactsBody,
  DeleteContactsResponse,
  DeleteSavedReplyParams,
  DeleteSavedReplyResponse,
  ImportContactsBody,
  ImportContactsResponse,
  CreateTemplateBody,
  DispatchTemplateBody,
  DispatchTemplateParams,
  GetTemplateCostsResponse,
  GetConnectionResponse,
  GetEvolutionConnectionResponse,
  GetConversationContactProfileParams,
  GetConversationContactProfileResponse,
  ListConversationsResponse,
  ListContactsResponse,
  ListSavedRepliesResponse,
  ListConversationMessagesParams,
  ListConversationMessagesResponse,
  ListTemplatesResponse,
  ListTemplatesResponseItem,
  ListConversationMessagesResponseItem,
  SendConversationMessageReactionBody,
  SendSavedReplyParams,
  SendSavedReplyResponse,
  MessageInput,
  ReceiveWebhookBody,
  SendConversationMessageBody,
  SendConversationMessageParams,
  StartConversationBody,
  StartConversationResponse,
  DispatchTemplateResponse,
  GetTemplateDispatchParams,
  GetTemplateDispatchResponse,
  ListTemplateDispatchesResponse,
  EvolutionConnectionStatus,
  UpdateEvolutionProfileNameBody,
  UpdateSavedReplyBody,
  UpdateSavedReplyParams,
  UpdateSavedReplyResponse,
} from "@workspace/api-zod";
import { and, asc, desc, eq, inArray, isNull, like, notLike, or, sql } from "drizzle-orm";
import {
  chatMessages,
  contacts,
  conversations,
  db,
  appSettings,
  savedReplies,
  whatsappTemplateDispatchRecipients,
  whatsappTemplateDispatches,
  whatsappTemplates,
  type WhatsappTemplateComponent,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const graphVersion = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";
const metaRequestTimeoutMs = 15_000;
const profilePictureRefreshIntervalMs = 60_000;
const profilePictureUrlCacheMs = 60_000;
const profilePictureMaxBytes = 5 * 1024 * 1024;
const evolutionMediaMaxBytes = 100 * 1024 * 1024;
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

type PhoneNumber = {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string;
  profilePictureUrl: string | null;
};

type ActiveConnection = {
  accessToken: string;
  businessAccountId: string;
  phoneNumbers: PhoneNumber[];
  selectedPhoneNumberId: string;
};

type EvolutionConfig = {
  serverUrl: string;
  apiKey: string;
  instanceName: string;
};

type EvolutionSession = EvolutionConfig & {
  connected: boolean;
  hasConnectedBefore?: boolean;
  state: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  profilePictureUrl?: string | null;
  profileMetadataFetchedAt?: number;
  profilePictureFetchedAt?: number;
  webhookUrlConfigured?: string;
  webhookConfigAttemptedAt?: number;
  qrCode: string | null;
};

let activeConnection: ActiveConnection | null = null;
let activeEvolutionSession: EvolutionSession | null = null;
let activeProvider: "none" | "cloud" | "evolution" = "none";
let connectionsRestored = false;
let connectionRestorePromise: Promise<void> | null = null;
const eventClients = new Set<Response>();
const evolutionMessageSyncTimestamps = new Map<string, number>();
const evolutionConversationHistorySyncTimestamps = new Map<string, number>();
const evolutionConversationHistorySyncRequests = new Map<string, Promise<number>>();
const evolutionConversationDedupTimestamps = new Map<string, number>();
const evolutionConversationDedupRequests = new Map<string, Promise<void>>();
const evolutionChatPinSyncTimestamps = new Map<string, number>();
const evolutionMessageSyncRequests = new Map<string, Promise<void>>();
const evolutionMessageSyncErrorLogAt = new Map<string, number>();
const evolutionMessageSyncLogAt = new Map<string, number>();
const evolutionLidAliasCache = new Map<string, {
  aliases: Map<string, string>;
  expiresAt: number;
}>();
const evolutionLidAliasRequests = new Map<string, Promise<Map<string, string>>>();
const evolutionProfilePictureUrlCache = new Map<string, {
  url: string | null;
  expiresAt: number;
}>();
const evolutionProfilePictureUrlRequests = new Map<string, Promise<string | null>>();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

let conversationControlsSchemaPromise: Promise<void> | null = null;
function ensureConversationControlsSchema(): Promise<void> {
  if (!conversationControlsSchemaPromise) {
    conversationControlsSchemaPromise = (async () => {
      await db.execute(sql`
        ALTER TABLE whatsapp_conversations
        ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '[]'::jsonb
      `);
      await db.execute(sql`
        ALTER TABLE whatsapp_conversations
        ADD COLUMN IF NOT EXISTS archived_at timestamptz
      `);
      await db.execute(sql`
        ALTER TABLE whatsapp_conversations
        ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false
      `);
    })();
  }
  return conversationControlsSchemaPromise.catch((error) => {
    conversationControlsSchemaPromise = null;
    throw error;
  });
}

router.use((_req, res, next) => {
  void ensureConversationControlsSchema().then(() => next()).catch((error) => {
    logger.error({ err: error }, "Could not prepare conversation labels and archive fields");
    res.status(500).json({ error: "Não foi possível preparar os controles das conversas." });
  });
});

type ConversationEvent = {
  conversationId: number;
  reason: "message" | "status";
  whatsappMessageId?: string;
};

function publishConversationEvent(event: ConversationEvent) {
  const payload = `event: conversation.updated\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) {
    if (client.writableEnded || client.destroyed) {
      eventClients.delete(client);
      continue;
    }

    try {
      client.write(payload);
    } catch {
      eventClients.delete(client);
    }
  }
}

class MetaApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function whatsappEncryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to protect the WhatsApp access token.");
  return createHash("sha256").update(`${secret}:whatsapp-access-token`).digest();
}

function encryptWhatsAppToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", whatsappEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptWhatsAppToken(value: string) {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error("Stored WhatsApp token is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", whatsappEncryptionKey(), Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function evolutionEncryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Não foi possível proteger a configuração da conexão via QR Code.");
  return createHash("sha256").update(`${secret}:evolution-api-config`).digest();
}

function encryptEvolutionConfig(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", evolutionEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptEvolutionConfig(value: string) {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error("A configuração salva da conexão via QR Code é inválida.");
  const decipher = createDecipheriv("aes-256-gcm", evolutionEncryptionKey(), Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function evolutionConfigPayload(session: EvolutionSession) {
  return JSON.stringify({
    serverUrl: session.serverUrl,
    apiKey: session.apiKey,
    instanceName: session.instanceName,
    phoneNumber: session.phoneNumber,
    profileName: session.profileName,
    profilePictureUrl: session.profilePictureUrl ?? null,
    hasConnectedBefore: Boolean(session.hasConnectedBefore),
  });
}

async function persistEvolutionSession(session: EvolutionSession): Promise<void> {
  await db
    .update(appSettings)
    .set({
      whatsappEvolutionConfigEncrypted: encryptEvolutionConfig(evolutionConfigPayload(session)),
      updatedAt: new Date(),
    })
    .where(eq(appSettings.id, 1));
}

function evolutionProfilePicturePath(number?: string | null): string {
  const query = number ? `?number=${encodeURIComponent(number)}` : "";
  return `/api/evolution/profile-picture${query}`;
}

async function restoreActiveConnection() {
  if (connectionsRestored) return;
  if (connectionRestorePromise) return connectionRestorePromise;
  connectionRestorePromise = (async () => {
    try {
      const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
      if (!settings) return;
      const hasCloudConfig = Boolean(settings.whatsappAccessTokenEncrypted && settings.whatsappBusinessAccountId);
      const hasEvolutionConfig = Boolean(settings.whatsappEvolutionConfigEncrypted);
      activeProvider = settings.whatsappActiveProvider === "none"
        ? "none"
        : settings.whatsappActiveProvider === "evolution" && hasEvolutionConfig
          ? "evolution"
          : settings.whatsappActiveProvider === "cloud" && hasCloudConfig
            ? "cloud"
            : hasCloudConfig
              ? "cloud"
              : hasEvolutionConfig
                ? "evolution"
                : "none";
      if (!activeConnection && settings.whatsappAccessTokenEncrypted && settings.whatsappBusinessAccountId) {
        try {
          const accessToken = decryptWhatsAppToken(settings.whatsappAccessTokenEncrypted);
          await subscribeWhatsAppBusinessAccount(accessToken, settings.whatsappBusinessAccountId);
          const phoneNumbers = await loadPhoneNumbers(accessToken, settings.whatsappBusinessAccountId);
          if (phoneNumbers.length > 0) {
            const selected = phoneNumbers.some((phone) => phone.id === settings.whatsappSelectedPhoneNumberId)
              ? settings.whatsappSelectedPhoneNumberId!
              : phoneNumbers[0].id;
            activeConnection = {
              accessToken,
              businessAccountId: settings.whatsappBusinessAccountId,
              phoneNumbers,
              selectedPhoneNumberId: selected,
            };
          }
        } catch (error) {
          logger.warn({ err: error }, "Could not restore WhatsApp Cloud API connection");
        }
      }
      if (!activeEvolutionSession && settings.whatsappEvolutionConfigEncrypted) {
        const storedConfig = asRecord(JSON.parse(decryptEvolutionConfig(settings.whatsappEvolutionConfigEncrypted)));
        const storedPhoneNumber = phoneNumberFromJid(storedConfig.phoneNumber);
        const hasPersistedConnectionHistory = typeof storedConfig.hasConnectedBefore === "boolean";
        activeEvolutionSession = {
          serverUrl: stringValue(storedConfig.serverUrl),
          apiKey: stringValue(storedConfig.apiKey),
          instanceName: stringValue(storedConfig.instanceName),
          connected: false,
          hasConnectedBefore: hasPersistedConnectionHistory
            ? storedConfig.hasConnectedBefore === true
            : Boolean(
                storedPhoneNumber
                || firstStringValue(storedConfig.profileName)
                || safeWhatsAppPictureUrl(storedConfig.profilePictureUrl),
              ),
          state: "connecting",
          phoneNumber: storedPhoneNumber,
          profileName: firstStringValue(storedConfig.profileName),
          profilePictureUrl: safeWhatsAppPictureUrl(storedConfig.profilePictureUrl),
          qrCode: null,
        };
        try {
          await refreshEvolutionSession(activeEvolutionSession, false);
          await persistEvolutionSession(activeEvolutionSession);
        } catch (error) {
          logger.warn({ err: error }, "Could not refresh Evolution API connection state");
        }
      }
    } catch (error) {
      logger.warn({ err: error }, "Could not restore WhatsApp connection settings from storage");
    } finally {
      connectionsRestored = true;
      connectionRestorePromise = null;
    }
  })();
  return connectionRestorePromise;
}

router.use(async (_req, _res, next) => {
  await restoreActiveConnection();
  next();
});

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstStringValue(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text) return text;
  }
  return null;
}

function safeHttpUrl(value: unknown): string | null {
  const candidate = stringValue(value).trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeWhatsAppPictureUrl(value: unknown): string | null {
  const candidate = safeHttpUrl(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    const trustedDomains = ["whatsapp.net", "fbcdn.net", "fbsbx.com"];
    return trustedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function phoneNumberFromJid(value: unknown): string | null {
  const identifier = stringValue(value).trim();
  const [user, domain] = identifier.split("@", 2);
  if (domain?.toLowerCase() === "lid") return null;
  const number = user.split(":")[0].replace(/^\+/, "");
  return /^\d{8,15}$/.test(number) ? number : null;
}

function evolutionOwnerPhoneNumber(...values: unknown[]): string | null {
  const candidates = values.flatMap((value) => {
    const record = asRecord(value);
    const owner = asRecord(record.owner);
    const me = asRecord(record.me);
    return [
      value,
      record.ownerJid,
      record.owner_jid,
      record.wuid,
      record.phoneNumber,
      record.phone_number,
      record.number,
      record.phone,
      owner.jid,
      owner.wuid,
      owner.phoneNumber,
      owner.phone_number,
      owner.number,
      owner.phone,
      me.jid,
      me.wuid,
      me.phoneNumber,
      me.phone_number,
      me.number,
      me.phone,
    ];
  });
  return candidates
    .map(phoneNumberFromJid)
    .find((phoneNumber): phoneNumber is string => Boolean(phoneNumber)) ?? null;
}

function isEvolutionLid(value: unknown): boolean {
  return stringValue(value).trim().toLowerCase().endsWith("@lid");
}

function evolutionValueString(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function evolutionPhoneFromAlternateJid(value: string): string | null {
  const candidate = value.trim();
  if (/@(?:s\.whatsapp\.net|c\.us)$/i.test(candidate)) {
    return phoneNumberFromJid(candidate);
  }
  return /^\+?\d{8,15}$/.test(candidate) ? normalizePhone(candidate) : null;
}

function withoutEvolutionBinary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEvolutionBinary);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key.toLowerCase() !== "base64")
      .map(([key, nested]) => [key, withoutEvolutionBinary(nested)]),
  );
}

function evolutionEventItems(data: unknown, collectionKey: string): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map(asRecord);
  const record = asRecord(data);
  const nested = asRecord(record.data);
  const candidates = [
    record[collectionKey],
    nested[collectionKey],
    record.records,
    nested.records,
  ];
  const collection = candidates.find(Array.isArray);
  if (Array.isArray(collection)) return collection.map(asRecord);
  return Object.keys(record).length ? [record] : [];
}

function unwrapEvolutionMessage(value: unknown): Record<string, unknown> {
  let message = asRecord(value);
  for (let depth = 0; depth < 4; depth += 1) {
    const wrapper = [
      "ephemeralMessage",
      "viewOnceMessage",
      "viewOnceMessageV2",
      "viewOnceMessageV2Extension",
      "documentWithCaptionMessage",
    ].map((key) => asRecord(message[key])).find((item) => Object.keys(item).length > 0);
    if (!wrapper || !Object.keys(asRecord(wrapper.message)).length) break;
    message = asRecord(wrapper.message);
  }
  return message;
}

function evolutionMessageDetails(item: Record<string, unknown>) {
  const message = unwrapEvolutionMessage(item.message);
  const mediaTypes = [
    ["image", message.imageMessage],
    ["video", message.videoMessage],
    ["document", message.documentMessage],
    ["audio", message.audioMessage],
    ["sticker", message.stickerMessage],
  ] as const;
  const media = mediaTypes.find(([, value]) => Object.keys(asRecord(value)).length > 0);
  const mediaPayload = asRecord(media?.[1]);
  const reaction = asRecord(message.reactionMessage);
  const reactionKey = asRecord(reaction.key);
  const reactionEmoji = stringValue(reaction.text);
  let messageType = "text";
  let content = "";

  if (typeof message.conversation === "string") {
    content = message.conversation;
  } else if (typeof asRecord(message.extendedTextMessage).text === "string") {
    content = stringValue(asRecord(message.extendedTextMessage).text);
  } else if (media) {
    messageType = media[0];
    const mediaLabel = {
      image: "Imagem",
      video: "Vídeo",
      document: "Arquivo",
      audio: "Áudio",
      sticker: "Figurinha",
    }[media[0]];
    content = stringValue(mediaPayload.caption) || `[${mediaLabel} recebido]`;
  } else if (Object.keys(reaction).length > 0) {
    messageType = "reaction";
    content = reactionEmoji;
  } else {
    const location = asRecord(message.locationMessage);
    const contactCard = asRecord(message.contactMessage);
    const poll = asRecord(message.pollCreationMessageV3 ?? message.pollCreationMessage);
    const interactive = asRecord(message.listResponseMessage);
    if (Object.keys(location).length) {
      messageType = "location";
      content = stringValue(location.name) || stringValue(location.address) || "Localização compartilhada";
    } else if (Object.keys(contactCard).length) {
      messageType = "contact";
      const vcard = stringValue(contactCard.vcard);
      const phone = vcard.match(/TEL[^:]*:(?:tel:)?([^\r\n]+)/i)?.[1]?.trim();
      content = [
        stringValue(contactCard.displayName) || "Contato compartilhado",
        phone ? normalizePhone(phone) : "",
      ].filter(Boolean).join("\n");
    } else if (Object.keys(poll).length) {
      messageType = "poll";
      const options = Array.isArray(poll.options)
        ? poll.options.map((option) => stringValue(asRecord(option).optionName)).filter(Boolean)
        : [];
      content = [
        stringValue(poll.name) || "Enquete",
        ...options.map((option) => `• ${option}`),
      ].join("\n");
    } else if (Object.keys(asRecord(message.pollUpdateMessage)).length) {
      messageType = "poll";
      content = "Voto em enquete";
    } else if (Object.keys(interactive).length) {
      messageType = "text";
      content = stringValue(asRecord(interactive.singleSelectReply).title)
        || stringValue(interactive.title)
        || "Resposta interativa";
    } else {
      messageType = stringValue(item.messageType).replace(/Message$/, "").toLowerCase() || "text";
      content = "[Mensagem recebida]";
    }
  }

  const replyKey = asRecord(asRecord(message.extendedTextMessage).contextInfo);
  const mediaCaption = stringValue(mediaPayload.caption) || null;
  const payload = withoutEvolutionBinary({
    key: item.key,
    message: item.message,
    messageType: item.messageType,
    messageTimestamp: item.messageTimestamp,
  }) as Record<string, unknown>;

  return {
    messageType,
    content,
    mediaMimeType: stringValue(mediaPayload.mimetype) || null,
    mediaFileName:
      stringValue(mediaPayload.fileName) || stringValue(mediaPayload.filename) || null,
    mediaCaption,
    providerPayload: payload,
    reactionEmoji: reactionEmoji || null,
    reactionTargetId: stringValue(reactionKey.id),
    replyTargetId: stringValue(asRecord(asRecord(replyKey.quotedMessage).key).id),
  };
}

function evolutionMessageStatus(value: unknown, fromMe: boolean): string {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("read") || normalized === "4") return "read";
  if (normalized.includes("deliver") || normalized === "3") return "delivered";
  if (normalized.includes("sent") || normalized === "2") return "sent";
  return fromMe ? "sent" : "received";
}

function webhookVerifyToken(): string {
  if (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (sessionSecret) {
    return createHash("sha256")
      .update(`${sessionSecret}:whatsapp-webhook`)
      .digest("hex")
      .slice(0, 32);
  }

  return "";
}

function webhookUrl(req: Request): string {
  const protocol = req.header("x-forwarded-proto")?.split(",")[0] ?? req.protocol;
  return `${protocol}://${req.get("host") ?? "localhost"}/api/webhook`;
}

function evolutionWebhookUrl(req: Request, session: EvolutionSession): string {
  const protocol = req.header("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const host = req.header("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host") || "localhost";
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to secure Evolution API webhooks.");
  const token = createHash("sha256")
    .update(`${secret}:evolution-webhook:${session.instanceName}`)
    .digest("hex");
  return `${protocol}://${host}/api/evolution/webhook?token=${token}`;
}

function normalizeEvolutionUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new MetaApiError("Informe uma URL válida para o servidor configurado.");
  }
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback))
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new MetaApiError("Use uma URL HTTPS pública ou HTTP local, sem usuário, senha, parâmetros ou fragmento.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function evolutionErrorMessages(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (Array.isArray(value)) {
    return value.flatMap((item) => evolutionErrorMessages(item, depth + 1));
  }
  const record = asRecord(value);
  return [
    "message",
    "detail",
    "details",
    "description",
    "reason",
    "errors",
    "issues",
    "cause",
    "error",
    "response",
    "data",
  ].flatMap((key) => evolutionErrorMessages(record[key], depth + 1));
}

async function evolutionRequest<T>(
  session: EvolutionConfig,
  endpoint: string,
  init: RequestInit = {},
  timeoutMs = metaRequestTimeoutMs,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  headers.set("apikey", session.apiKey);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  try {
    const response = await fetch(`${session.serverUrl}${endpoint}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const rawBody = await response.text();
    let parsedBody: unknown = {};
    let body: Record<string, unknown> = {};
    if (rawBody) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        body = asRecord(parsed);
        if (typeof parsed === "string") {
          body.message = parsed;
          parsedBody = body;
        } else {
          parsedBody = parsed;
        }
      } catch {
        body.message = rawBody;
        parsedBody = body;
      }
    }
    if (!response.ok) {
      const candidates = evolutionErrorMessages(body);
      const genericMessages = /^(bad request|error)$/i;
      const message =
        candidates.find((candidate) => !genericMessages.test(candidate))
        || `A conexão via QR Code recusou o envio com HTTP ${response.status} sem informar a causa. Confira se o telefone tem código do país e WhatsApp ativo.`;
      const userMessage = message
        .replace(/\bEvolution API\b/gi, "conexão via QR Code")
        .replace(/\bEvolution\b/gi, "conexão via QR Code");
      throw new MetaApiError(userMessage, response.status);
    }
    return parsedBody as T;
  } catch (error) {
    if (error instanceof MetaApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new MetaApiError("O servidor da conexão via QR Code não respondeu em 15 segundos.", 504);
    }
    throw new MetaApiError("Não foi possível alcançar o servidor da conexão via QR Code.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadEvolutionLidAliases(session: EvolutionSession): Promise<Map<string, string>> {
  const now = Date.now();
  const cached = evolutionLidAliasCache.get(session.instanceName);
  if (cached && cached.expiresAt > now) return cached.aliases;
  const pending = evolutionLidAliasRequests.get(session.instanceName);
  if (pending) return pending;

  const request = (async () => {
    const aliases = new Map<string, string>();
    let cacheDurationMs = 30_000;
    try {
      const [contactsResult, chatsResult] = await Promise.allSettled([
        evolutionRequest<unknown>(
          session,
          `/chat/findContacts/${encodeURIComponent(session.instanceName)}`,
          {
            method: "POST",
            body: JSON.stringify({ where: {}, take: 1000, skip: 0 }),
          },
          10_000,
        ),
        evolutionRequest<unknown>(
          session,
          `/chat/findChats/${encodeURIComponent(session.instanceName)}`,
          {
            method: "POST",
            body: JSON.stringify({ where: {}, take: 1000, skip: 0 }),
          },
          10_000,
        ),
      ]);
      if (contactsResult.status === "rejected" && chatsResult.status === "rejected") {
        throw contactsResult.reason;
      }

      const responses = [
        ...(contactsResult.status === "fulfilled"
          ? [{ source: "contacts" as const, value: contactsResult.value }]
          : []),
        ...(chatsResult.status === "fulfilled"
          ? [{ source: "chats" as const, value: chatsResult.value }]
          : []),
      ];
      let contactRecordsSeen = 0;
      let chatRecordsSeen = 0;
      for (const { source, value: response } of responses) {
        const root = asRecord(response);
        const data = asRecord(root.data);
        const contactsContainer = asRecord(root.contacts);
        const chatsContainer = asRecord(root.chats);
        const dataContactsContainer = asRecord(data.contacts);
        const dataChatsContainer = asRecord(data.chats);
        const collectionCandidates = [
          response,
          root.contacts,
          root.chats,
          root.records,
          root.result,
          root.data,
          root.results,
          data.contacts,
          data.chats,
          data.records,
          data.result,
          data.results,
          contactsContainer.records,
          contactsContainer.results,
          chatsContainer.records,
          chatsContainer.results,
          dataContactsContainer.records,
          dataContactsContainer.results,
          dataChatsContainer.records,
          dataChatsContainer.results,
        ];
        const collection = collectionCandidates.find(Array.isArray);
        const records = Array.isArray(collection) ? collection.map(asRecord) : [];
        if (source === "contacts") contactRecordsSeen = records.length;
        else chatRecordsSeen = records.length;
        for (const contact of records) {
          const key = asRecord(contact.key);
          const lidJids = [
            contact.id,
            contact.jid,
            contact.remoteJid,
            contact.lid,
            contact.lidJid,
            key.remoteJid,
          ].map(stringValue).filter(isEvolutionLid);
          const phoneCandidates = [
            contact.id,
            contact.number,
            contact.phoneNumber,
            contact.remoteJidAlt,
            contact.remoteJid,
            contact.jid,
            contact.phone,
            contact.whatsappNumber,
            contact.wuid,
            key.remoteJid,
            key.remoteJidAlt,
            key.participantAlt,
            contact.participantAlt,
          ].map((candidate) => evolutionPhoneFromAlternateJid(evolutionValueString(candidate)))
            .filter((candidate): candidate is string => Boolean(candidate));
          const pictureUrl = safeWhatsAppPictureUrl(firstStringValue(
            contact.profilePictureUrl,
            contact.profilePicUrl,
            contact.profile_pic_url,
            contact.pictureUrl,
            contact.picture,
          ));
          if (pictureUrl) {
            for (const phone of phoneCandidates) {
              cacheEvolutionPictureUrl(session, phone, pictureUrl);
              cacheEvolutionPictureUrl(session, `${phone}@s.whatsapp.net`, pictureUrl);
            }
          }
          for (const lidJid of lidJids) {
            const lidDigits = normalizePhone(lidJid.split("@")[0]);
            const phone = phoneCandidates.find((candidate) => candidate !== lidDigits);
            if (phone) {
              aliases.set(lidJid, phone);
              if (pictureUrl) {
                cacheEvolutionPictureUrl(session, lidJid, pictureUrl);
                cacheEvolutionPictureUrl(session, phone, pictureUrl);
                cacheEvolutionPictureUrl(session, `${phone}@s.whatsapp.net`, pictureUrl);
              }
            }
          }
        }
      }
      if (aliases.size > 0) cacheDurationMs = 5 * 60_000;
      const warningKey = `lid-aliases:${session.instanceName}`;
      const lastWarningAt = evolutionMessageSyncErrorLogAt.get(warningKey) ?? 0;
      if (aliases.size > 0) {
        logger.info(
          { instanceName: session.instanceName, contactRecordsSeen, chatRecordsSeen, resolvedLidAliases: aliases.size },
          "Resolved QR Code contact phone numbers",
        );
      } else if (Date.now() - lastWarningAt >= 60_000) {
        evolutionMessageSyncErrorLogAt.set(warningKey, Date.now());
        logger.warn(
          { instanceName: session.instanceName, contactRecordsSeen, chatRecordsSeen },
          "Evolution returned no verified phone mapping for linked contact identifiers",
        );
      }
    } catch (error) {
      cacheDurationMs = aliases.size ? 60_000 : 30_000;
      const warningKey = `lid-aliases:${session.instanceName}`;
      const lastWarningAt = evolutionMessageSyncErrorLogAt.get(warningKey) ?? 0;
      if (Date.now() - lastWarningAt >= 60_000) {
        evolutionMessageSyncErrorLogAt.set(warningKey, Date.now());
        logger.warn(
          { err: error, instanceName: session.instanceName },
          "Could not resolve QR Code contact identifiers",
        );
      }
    }
    evolutionLidAliasCache.set(session.instanceName, {
      aliases,
      expiresAt: Date.now() + cacheDurationMs,
    });
    if (aliases.size > 0) {
      void deduplicateEvolutionConversations(session, true)
        .then(async () => {
          const [conversation] = await db
            .select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.phoneNumberId, `evolution:${session.instanceName}`))
            .limit(1);
          if (conversation) {
            publishConversationEvent({ conversationId: conversation.id, reason: "message" });
          }
        })
        .catch((error) => {
          logger.warn({ err: error, instanceName: session.instanceName }, "Could not merge conversations after resolving contact numbers");
        });
    }
    return aliases;
  })();

  evolutionLidAliasRequests.set(session.instanceName, request);
  try {
    return await request;
  } finally {
    if (evolutionLidAliasRequests.get(session.instanceName) === request) {
      evolutionLidAliasRequests.delete(session.instanceName);
    }
  }
}

function getCachedEvolutionLidAliases(session?: EvolutionSession | null): Map<string, string> {
  if (!session) return new Map();
  const cached = evolutionLidAliasCache.get(session.instanceName);
  return cached && cached.expiresAt > Date.now() ? cached.aliases : new Map();
}

function rememberEvolutionLidAlias(
  session: EvolutionSession,
  lidJidValue: unknown,
  phoneValue: unknown,
): void {
  const lidJid = stringValue(lidJidValue).trim();
  if (!isEvolutionLid(lidJid)) return;
  const phone = evolutionPhoneFromAlternateJid(evolutionValueString(phoneValue));
  const lidDigits = normalizePhone(lidJid.split("@")[0]);
  if (!phone || phone === lidDigits) return;

  const existing = evolutionLidAliasCache.get(session.instanceName);
  const aliases = new Map(existing?.aliases ?? []);
  aliases.set(lidJid, phone);
  evolutionLidAliasCache.set(session.instanceName, {
    aliases,
    expiresAt: Date.now() + 5 * 60_000,
  });
}

function evolutionChatPinnedState(chat: Record<string, unknown>): boolean | null {
  for (const field of ["isPinned", "pinned", "is_pinned"]) {
    const value = chat[field];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === 0) return value === 1;
    if (typeof value === "string" && /^(true|false|1|0)$/i.test(value.trim())) {
      return /^(true|1)$/i.test(value.trim());
    }
  }
  for (const field of ["pinTimestamp", "pinnedAt", "pinTime"]) {
    const value = chat[field];
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return true;
    if (typeof value === "string" && Number.isNaN(numeric) && !Number.isNaN(Date.parse(value))) return true;
  }
  return null;
}

function evolutionQrCode(body: Record<string, unknown>): string | null {
  const qrcode = asRecord(body.qrcode);
  const qr = asRecord(body.qr);
  const value = stringValue(qrcode.base64)
    || stringValue(qrcode.code)
    || stringValue(body.base64)
    || stringValue(body.code)
    || stringValue(qr.base64)
    || stringValue(qr.code);
  if (!value) return null;
  return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;
}

function nestedEvolutionProfileString(
  value: unknown,
  fieldNames: Set<string>,
  depth = 0,
): string | null {
  if (depth > 5) return null;
  const normalizedFieldNames = new Set([...fieldNames].map((fieldName) => fieldName.toLowerCase()));
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = nestedEvolutionProfileString(item, normalizedFieldNames, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  for (const [key, candidate] of Object.entries(record)) {
    if (normalizedFieldNames.has(key.toLowerCase())) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      const nested = nestedEvolutionProfileString(candidate, new Set(["url", "src"]), depth + 1);
      if (nested) return nested;
    }
  }
  for (const candidate of Object.values(record)) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const found = nestedEvolutionProfileString(candidate, normalizedFieldNames, depth + 1);
    if (found) return found;
  }
  return null;
}

function evolutionProfileNameFromResponse(response: unknown): string | null {
  return nestedEvolutionProfileString(response, new Set([
    "profileName",
    "profile_name",
    "pushName",
    "push_name",
    "verifiedName",
    "verified_name",
    "notifyName",
    "notify_name",
    "name",
  ]));
}

function evolutionPictureUrlFromResponse(response: unknown): string | null {
  return safeWhatsAppPictureUrl(nestedEvolutionProfileString(response, new Set([
    "profilePictureUrl",
    "profile_picture_url",
    "profilePicUrl",
    "profile_pic_url",
    "pictureUrl",
    "picture_url",
    "picUrl",
    "picture",
    "avatar",
    "url",
  ])));
}

function cacheEvolutionPictureUrl(session: EvolutionSession, whatsappId: string, url: string | null): void {
  evolutionProfilePictureUrlCache.set(`${session.instanceName}:${whatsappId}`, {
    url,
    expiresAt: Date.now() + profilePictureUrlCacheMs,
  });
}

async function getEvolutionPictureUrl(session: EvolutionSession, whatsappId: string): Promise<string | null> {
  const cacheKey = `${session.instanceName}:${whatsappId}`;
  const cached = evolutionProfilePictureUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const pending = evolutionProfilePictureUrlRequests.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const response = await evolutionRequest<unknown>(
      session,
      `/chat/fetchProfilePictureUrl/${encodeURIComponent(session.instanceName)}`,
      { method: "POST", body: JSON.stringify({ number: whatsappId }) },
    );
    const url = evolutionPictureUrlFromResponse(response);
    cacheEvolutionPictureUrl(session, whatsappId, url);
    return url;
  })();
  evolutionProfilePictureUrlRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (evolutionProfilePictureUrlRequests.get(cacheKey) === request) {
      evolutionProfilePictureUrlRequests.delete(cacheKey);
    }
  }
}

async function getEvolutionOwnProfilePictureUrl(session: EvolutionSession): Promise<string | null> {
  const phoneNumber = normalizePhone(session.phoneNumber ?? "");
  if (!phoneNumber) return null;
  let lastError: unknown;
  for (const candidate of [phoneNumber, `${phoneNumber}@s.whatsapp.net`]) {
    try {
      const url = await getEvolutionPictureUrl(session, candidate);
      if (url) return url;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function refreshConnectedProfileMetadata(session: EvolutionSession): Promise<void> {
  const now = Date.now();
  const shouldRefreshMetadata = now - (session.profileMetadataFetchedAt ?? 0) >= 60_000;
  if (shouldRefreshMetadata) session.profileMetadataFetchedAt = now;
  const encodedInstance = encodeURIComponent(session.instanceName);

  if (shouldRefreshMetadata) {
    try {
      const instancesResponse = await evolutionRequest<unknown>(session, "/instance/fetchInstances");
      const instances = Array.isArray(instancesResponse) ? instancesResponse : [instancesResponse];
      const matchedRecord = instances
        .map((value) => asRecord(value))
        .find((record) => firstStringValue(
          asRecord(record.instance).instanceName,
          record.instanceName,
        ) === session.instanceName);
      const instance = asRecord(matchedRecord?.instance);

      const profileName = firstStringValue(
        instance.profileName,
        instance.profile_name,
        instance.pushName,
        instance.push_name,
        instance.notifyName,
        instance.notify_name,
        matchedRecord?.profileName,
        matchedRecord?.pushName,
        matchedRecord?.push_name,
        matchedRecord?.notifyName,
        matchedRecord?.notify_name,
      );
      if (profileName) session.profileName = profileName;

      const phoneNumber = evolutionOwnerPhoneNumber(instance, matchedRecord);
      if (phoneNumber) session.phoneNumber = phoneNumber;
    } catch (error) {
      logger.warn({ err: error, instanceName: session.instanceName }, "Could not read connected account profile metadata");
    }
  }

  const ownWhatsAppId = session.phoneNumber
    ? `${session.phoneNumber}@s.whatsapp.net`
    : null;
  if (!ownWhatsAppId) return;

  if (shouldRefreshMetadata) {
    const ownPhoneNumber = normalizePhone(session.phoneNumber ?? "");
    let profileLoaded = false;
    let lastProfileError: unknown;
    for (const number of [ownPhoneNumber, ownWhatsAppId].filter((value): value is string => Boolean(value))) {
      try {
        const response = await evolutionRequest<unknown>(
          session,
          `/chat/fetchProfile/${encodedInstance}`,
          { method: "POST", body: JSON.stringify({ number }) },
        );
        const profileName = evolutionProfileNameFromResponse(response);
        const profilePictureUrl = evolutionPictureUrlFromResponse(response);
        if (profileName) session.profileName = profileName;
        if (profilePictureUrl) {
          session.profilePictureUrl = profilePictureUrl;
          cacheEvolutionPictureUrl(session, ownPhoneNumber, profilePictureUrl);
          cacheEvolutionPictureUrl(session, ownWhatsAppId, profilePictureUrl);
        }
        if (profileName || profilePictureUrl) {
          profileLoaded = true;
          break;
        }
      } catch (error) {
        lastProfileError = error;
      }
    }
    if (!profileLoaded || !session.profileName || !session.profilePictureUrl) {
      try {
        const businessProfile = await evolutionRequest<unknown>(
          session,
          `/chat/fetchBusinessProfile/${encodedInstance}`,
          {
            method: "POST",
            body: JSON.stringify({ number: ownPhoneNumber }),
          },
        );
        const profileName = evolutionProfileNameFromResponse(businessProfile);
        const profilePictureUrl = evolutionPictureUrlFromResponse(businessProfile);
        if (profileName) session.profileName = profileName;
        if (profilePictureUrl) {
          session.profilePictureUrl = profilePictureUrl;
          cacheEvolutionPictureUrl(session, ownPhoneNumber, profilePictureUrl);
          cacheEvolutionPictureUrl(session, ownWhatsAppId, profilePictureUrl);
        }
        profileLoaded ||= Boolean(profileName || profilePictureUrl);
      } catch (error) {
        lastProfileError ??= error;
      }
    }
    if (!profileLoaded && lastProfileError) {
      logger.warn({ err: lastProfileError, instanceName: session.instanceName }, "Could not read connected account profile metadata");
    }
  }

  if (now - (session.profilePictureFetchedAt ?? 0) >= profilePictureRefreshIntervalMs) {
    session.profilePictureFetchedAt = now;
    try {
      const profilePictureUrl = await getEvolutionOwnProfilePictureUrl(session);
      if (profilePictureUrl) session.profilePictureUrl = profilePictureUrl;
    } catch (error) {
      logger.warn({ err: error, instanceName: session.instanceName }, "Could not read connected account profile photo");
    }
  }
}

async function refreshEvolutionSession(
  session: EvolutionSession,
  requestQr = true,
): Promise<void> {
  const stateBody = await evolutionRequest<Record<string, unknown>>(
    session,
    `/instance/connectionState/${encodeURIComponent(session.instanceName)}`,
  );
  const state = stringValue(asRecord(stateBody.instance).state) || stringValue(stateBody.state) || "unknown";
  session.state = state;
  session.connected = state.toLowerCase() === "open";
  if (session.connected) session.hasConnectedBefore = true;
  const instance = asRecord(stateBody.instance);
  const stateData = asRecord(stateBody.data);
  session.phoneNumber = evolutionOwnerPhoneNumber(instance, stateBody, stateData) || session.phoneNumber;
  session.profileName = firstStringValue(
    instance.profileName,
    instance.profile_name,
    instance.pushName,
    instance.push_name,
    instance.notifyName,
    instance.notify_name,
    stateBody.profileName,
    stateBody.profile_name,
    stateBody.pushName,
    stateBody.push_name,
    stateData.profileName,
    stateData.profile_name,
    stateData.pushName,
    stateData.push_name,
  ) || session.profileName;
  if (session.connected) {
    session.qrCode = null;
    await refreshConnectedProfileMetadata(session);
    return;
  }
  if (requestQr) {
    const qrBody = await evolutionRequest<Record<string, unknown>>(
      session,
      `/instance/connect/${encodeURIComponent(session.instanceName)}`,
    );
    session.qrCode = evolutionQrCode(qrBody);
    const qrInstance = asRecord(qrBody.instance);
    session.phoneNumber = evolutionOwnerPhoneNumber(qrInstance, qrBody) || session.phoneNumber;
  }
}

async function setEvolutionWebhook(session: EvolutionSession, req: Request) {
  const url = evolutionWebhookUrl(req, session);
  await evolutionRequest(
    session,
    `/webhook/set/${encodeURIComponent(session.instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          url,
          enabled: true,
          webhookByEvents: false,
          webhookBase64: false,
          events: [
            "MESSAGES_SET",
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "CONTACTS_SET",
            "CONTACTS_UPSERT",
            "CONTACTS_UPDATE",
            "CHATS_SET",
            "CHATS_UPSERT",
            "CHATS_UPDATE",
            "GROUPS_UPSERT",
            "GROUP_UPDATE",
            "GROUP_PARTICIPANTS_UPDATE",
            "CONNECTION_UPDATE",
          ],
        },
      }),
    },
  );
  session.webhookUrlConfigured = url;
  req.log.info(
    { webhookHost: new URL(url).host },
    "QR webhook endpoint configured",
  );
}

async function ensureEvolutionWebhook(session: EvolutionSession, req: Request): Promise<void> {
  const expectedUrl = evolutionWebhookUrl(req, session);
  if (session.webhookUrlConfigured === expectedUrl) return;

  const now = Date.now();
  if (now - (session.webhookConfigAttemptedAt ?? 0) < 60_000) return;
  session.webhookConfigAttemptedAt = now;
  await setEvolutionWebhook(session, req);
}

function evolutionConnectionResponse(
  session: EvolutionSession | null,
  includeQrCode = false,
): EvolutionConnectionStatus {
  return GetEvolutionConnectionResponse.parse({
    configured: Boolean(session),
    connected: Boolean(session?.connected),
    active: activeProvider === "evolution" && Boolean(session),
    state: session?.state ?? null,
    instanceName: session?.instanceName ?? null,
    phoneNumber: session?.phoneNumber ?? null,
    profileName: session?.profileName ?? null,
    profilePictureUrl: session?.connected
      ? evolutionProfilePicturePath(session.phoneNumber)
      : null,
    qrCode: includeQrCode ? session?.qrCode ?? null : null,
    defaultServerUrlConfigured: Boolean(process.env.EVOLUTION_API_URL?.trim()),
    defaultApiKeyConfigured: Boolean(process.env.EVOLUTION_API_KEY?.trim()),
  });
}

function isKnownEvolutionDisconnectedState(state: string | null): boolean {
  const normalizedState = state?.trim().toLowerCase() ?? "";
  return ["close", "closed", "disconnected", "logout", "logged_out", "logged out"]
    .includes(normalizedState);
}

function connectionStatus(req: Request) {
  const connection = activeConnection;
  return GetConnectionResponse.parse({
    connected: activeProvider === "cloud" && Boolean(connection),
    businessAccountId: connection?.businessAccountId ?? null,
    phoneNumbers: connection?.phoneNumbers ?? [],
    selectedPhoneNumberId: connection?.selectedPhoneNumberId ?? null,
    webhookUrl: webhookUrl(req),
    webhookVerifyTokenConfigured: Boolean(webhookVerifyToken()),
    webhookVerifyToken: webhookVerifyToken() || null,
  });
}

async function graphRequest<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchMeta(
    `https://graph.facebook.com/${graphVersion}/${path}`,
    accessToken,
    init,
  );

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const error = asRecord(body.error);
    const message =
      stringValue(error.message) ||
      "A Meta recusou a solicitação. Verifique o token e os IDs informados.";
    throw new MetaApiError(message, response.status, stringValue(error.code));
  }

  return body as T;
}

async function fetchMeta(
  url: string,
  accessToken: string,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), metaRequestTimeoutMs);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new MetaApiError(
        "A Meta não respondeu dentro de 15 segundos. O envio não pôde ser confirmado.",
        504,
        "META_TIMEOUT",
      );
    }
    throw new MetaApiError(
      "Não foi possível alcançar a API da Meta para confirmar o envio.",
      502,
      "META_NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function subscribeWhatsAppBusinessAccount(
  accessToken: string,
  businessAccountId: string,
) {
  await graphRequest<{ success?: boolean }>(
    `${encodeURIComponent(businessAccountId)}/subscribed_apps`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

async function loadPhoneNumbers(
  accessToken: string,
  businessAccountId: string,
): Promise<PhoneNumber[]> {
  const body = await graphRequest<{
    data?: Array<Record<string, unknown>>;
  }>(
    `${encodeURIComponent(businessAccountId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=100`,
    accessToken,
  );

  const numbers = (body.data ?? []).map((phone) => ({
    id: stringValue(phone.id),
    displayPhoneNumber: stringValue(phone.display_phone_number),
    verifiedName: stringValue(phone.verified_name) || "WhatsApp Business",
    qualityRating: stringValue(phone.quality_rating) || "UNKNOWN",
    profilePictureUrl: null as string | null,
  }));

  return Promise.all(
    numbers.map(async (phone) => {
      try {
        const profile = await graphRequest<{
          data?: Array<Record<string, unknown>> | Record<string, unknown>;
          profile_picture_url?: string;
        }>(
          `${encodeURIComponent(phone.id)}/whatsapp_business_profile?fields=profile_picture_url`,
          accessToken,
        );
        const profileData = Array.isArray(profile.data)
          ? asRecord(profile.data[0])
          : asRecord(profile.data);
        return {
          ...phone,
          profilePictureUrl:
            stringValue(profileData.profile_picture_url) ||
            stringValue(profile.profile_picture_url) ||
            null,
        };
      } catch {
        return phone;
      }
    }),
  );
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function recipientPhoneNumber(phoneNumber: string, connection: ActiveConnection): string {
  const normalized = normalizePhone(phoneNumber);
  if (phoneNumber.trim().startsWith("+")) return normalized;
  const selectedPhone = connection.phoneNumbers.find(
    (phone) => phone.id === connection.selectedPhoneNumberId,
  );
  const senderDigits = normalizePhone(selectedPhone?.displayPhoneNumber ?? "");
  const senderIsBrazilian = senderDigits.startsWith("55");
  const looksLikeBrazilianLocalNumber =
    senderIsBrazilian &&
    (normalized.length === 10 || normalized.length === 11);

  return looksLikeBrazilianLocalNumber ? `55${normalized}` : normalized;
}

function estimatedCostPerMessage(): number {
  const configured = Number(process.env.WHATSAPP_ESTIMATED_COST_PER_MESSAGE ?? "0.05");
  return Number.isFinite(configured) && configured >= 0 ? configured : 0.05;
}

function templateResponse(template: typeof whatsappTemplates.$inferSelect) {
  const storedComponents = Array.isArray(template.components)
    ? template.components
    : [];
  return ListTemplatesResponseItem.parse({
    id: template.id,
    name: template.name,
    languageCode: template.languageCode,
    category: template.category,
    status: template.status,
    header: template.header,
    body: template.body,
    footer: template.footer,
    variables: Array.isArray(template.variables) ? template.variables : [],
    components: storedComponents.length
      ? storedComponents.map(normalizeStoredComponent)
      : legacyTemplateComponents(template).map(normalizeStoredComponent),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  });
}

function normalizeStoredComponent(component: WhatsappTemplateComponent) {
  return {
    type: component.type,
    format: component.format ?? null,
    text: component.text ?? null,
    example: component.example ?? null,
    buttons: (component.buttons ?? []).map((button) => ({
      type: button.type,
      text: button.text ?? null,
      url: button.url ?? null,
      phoneNumber: button.phoneNumber ?? null,
      example: button.example ?? null,
    })),
  };
}

function normalizeInputComponents(
  components: Array<{
    type: string;
    format: string | null;
    text: string | null;
    example: Record<string, unknown> | null;
    buttons: Array<{
      type: string;
      text: string | null;
      url: string | null;
      phoneNumber: string | null;
      example: string[] | null;
    }>;
  }>,
): WhatsappTemplateComponent[] {
  return components.map((component) => ({
    type: component.type.toUpperCase(),
    format: component.format?.toUpperCase() ?? null,
    text: component.text ?? null,
    example: component.example ?? null,
    buttons: component.buttons.map((button) => ({
      type: button.type.toUpperCase(),
      text: button.text ?? null,
      url: button.url ?? null,
      phoneNumber: button.phoneNumber ?? null,
      example: button.example ?? null,
    })),
  }));
}

function legacyTemplateComponents(input: {
  header?: string | null;
  body: string;
  footer?: string | null;
}): WhatsappTemplateComponent[] {
  return [
    ...(input.header
      ? [{ type: "HEADER", format: "TEXT", text: input.header, buttons: [] }]
      : []),
    { type: "BODY", format: null, text: input.body, buttons: [] },
    ...(input.footer
      ? [{ type: "FOOTER", format: null, text: input.footer, buttons: [] }]
      : []),
  ];
}

function renderTemplateBody(body: string, variables: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => variables[Number(index) - 1] ?? `{{${index}}}`);
}

type ComponentParameterInput = {
  component: "header" | "body" | "button";
  parameterType: "text" | "image" | "video" | "document";
  index: number | null;
  subType: string | null;
  value: string;
};

function parameterValue(parameter: ComponentParameterInput) {
  if (parameter.parameterType === "text") {
    return { type: "text", text: parameter.value };
  }

  return {
    type: parameter.parameterType,
    [parameter.parameterType]: { link: parameter.value },
  };
}

function buildMetaTemplateComponents(
  variables: string[],
  componentParameters: ComponentParameterInput[],
) {
  const supplied = componentParameters.length
    ? componentParameters
    : variables.map((value) => ({
        component: "body" as const,
        parameterType: "text" as const,
        index: null,
        subType: null,
        value,
      }));

  const components: Array<Record<string, unknown>> = [];
  for (const parameter of supplied) {
    if (parameter.component === "button") {
      components.push({
        type: "button",
        sub_type: parameter.subType || "url",
        index: String(parameter.index ?? 0),
        parameters: [parameterValue(parameter)],
      });
      continue;
    }

    const existing = components.find((item) => item.type === parameter.component);
    if (existing) {
      (existing.parameters as unknown[]).push(parameterValue(parameter));
    } else {
      components.push({
        type: parameter.component,
        parameters: [parameterValue(parameter)],
      });
    }
  }

  return components;
}

async function sendTemplateMessage(
  phoneNumberId: string,
  to: string,
  template: typeof whatsappTemplates.$inferSelect,
  variables: string[],
  componentParameters: ComponentParameterInput[],
  accessToken: string,
) {
  const components = buildMetaTemplateComponents(variables, componentParameters);

  const body = await graphRequest<{ messages?: Array<{ id?: string }> }>(
    `${encodeURIComponent(phoneNumberId)}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.languageCode },
          ...(components.length ? { components } : {}),
        },
      }),
    },
  );

  const id = stringValue(body.messages?.[0]?.id);
  if (!id) throw new MetaApiError("A Meta não retornou o ID do template enviado.");
  return id;
}

function dispatchStatusFromCounts(input: {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
}) {
  if (input.total > 0 && input.failed === input.total) return "failed" as const;
  if (input.pending > 0) {
    return input.sent + input.delivered + input.read + input.failed > 0
      ? ("partial" as const)
      : ("pending" as const);
  }
  if (input.total > 0 && input.read === input.total) return "read" as const;
  if (input.total > 0 && input.delivered === input.total) return "delivered" as const;
  if (input.total > 0 && input.sent === input.total) return "sent" as const;
  return "partial" as const;
}

async function refreshDispatchSummary(dispatchId: number) {
  const recipients = await db
    .select()
    .from(whatsappTemplateDispatchRecipients)
    .where(eq(whatsappTemplateDispatchRecipients.dispatchId, dispatchId));
  const sent = recipients.filter((item) => ["sent", "delivered", "read"].includes(item.status)).length;
  const delivered = recipients.filter((item) => item.status === "delivered" || item.status === "read").length;
  const read = recipients.filter((item) => item.status === "read").length;
  const failed = recipients.filter((item) => item.status === "failed").length;
  const pending = recipients.filter((item) => item.status === "pending").length;
  const status = dispatchStatusFromCounts({
    total: recipients.length,
    sent,
    delivered,
    read,
    failed,
    pending,
  });
  const [dispatch] = await db
    .update(whatsappTemplateDispatches)
    .set({
      status,
      recipientsCount: recipients.length,
      sentCount: sent,
      deliveredCount: delivered,
      readCount: read,
      failedCount: failed,
      pendingCount: pending,
      updatedAt: new Date(),
    })
    .where(eq(whatsappTemplateDispatches.id, dispatchId))
    .returning();
  return dispatch;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function dispatchResultResponse(dispatchId: number) {
  const [dispatch] = await db
    .select()
    .from(whatsappTemplateDispatches)
    .where(eq(whatsappTemplateDispatches.id, dispatchId))
    .limit(1);
  if (!dispatch) return null;
  const [template] = await db
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.id, dispatch.templateId))
    .limit(1);
  if (!template) return null;
  const recipients = await db
    .select()
    .from(whatsappTemplateDispatchRecipients)
    .where(eq(whatsappTemplateDispatchRecipients.dispatchId, dispatchId))
    .orderBy(asc(whatsappTemplateDispatchRecipients.id));
  return GetTemplateDispatchResponse.parse({
    dispatchId: dispatch.id,
    template: templateResponse(template),
    status: dispatch.status,
    recipientsCount: dispatch.recipientsCount,
    sentCount: dispatch.sentCount,
    deliveredCount: dispatch.deliveredCount,
    readCount: dispatch.readCount,
    failedCount: dispatch.failedCount,
    pendingCount: dispatch.pendingCount,
    estimatedCost: dispatch.estimatedCost,
    currency: dispatch.currency,
    results: recipients.map((recipient) => ({
      phoneNumber: recipient.phoneNumber,
      status: recipient.status,
      message: recipient.message,
      whatsappMessageId: recipient.whatsappMessageId,
      updatedAt: recipient.updatedAt.toISOString(),
    })),
  });
}

function messageResponse(
  message: typeof chatMessages.$inferSelect,
  conversationId?: number,
) {
  const hasMedia = ["image", "video", "audio", "document", "sticker"].includes(
    message.messageType,
  );
  const rawMessage = asRecord(asRecord(message.providerPayload).message);
  const localMediaPath = stringValue(asRecord(message.providerPayload).localMediaPath);
  const location = asRecord(unwrapEvolutionMessage(rawMessage).locationMessage);
  const latitude = Number(location.degreesLatitude);
  const longitude = Number(location.degreesLongitude);
  const locationUrl = message.messageType === "location"
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    ? `https://www.google.com/maps?q=${latitude},${longitude}`
    : null;
  return ListConversationMessagesResponseItem.parse({
    id: message.id,
    direction: message.direction,
    content: message.content,
    messageType: message.messageType,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    whatsappMessageId: message.whatsappMessageId,
    mediaUrl: locationUrl || (
      localMediaPath
        ? `/api/storage${localMediaPath}`
        : hasMedia && message.providerPayload && conversationId
          ? `/api/conversations/${conversationId}/messages/${message.id}/media`
          : null
    ),
    mediaMimeType: message.mediaMimeType,
    mediaFileName: message.mediaFileName,
    mediaCaption: message.mediaCaption,
    replyToMessageId: message.replyToMessageId,
    reactionEmoji: message.reactionEmoji,
  });
}

function savedReplyResponse(reply: typeof savedReplies.$inferSelect) {
  return {
    id: reply.id,
    title: reply.title,
    kind: reply.kind,
    content: reply.content,
    objectPath: reply.objectPath,
    mediaMimeType: reply.mediaMimeType,
    mediaFileName: reply.mediaFileName,
    sizeBytes: reply.sizeBytes,
    createdAt: reply.createdAt.toISOString(),
    updatedAt: reply.updatedAt.toISOString(),
  };
}

function localMediaPathFromPayload(payload: unknown): string | null {
  const path = stringValue(asRecord(payload).localMediaPath);
  return path && /^\/objects\/uploads\/[A-Za-z0-9-]+$/.test(path) ? path : null;
}

async function deleteLocalMediaObjects(payloads: unknown[]): Promise<void> {
  const paths = [...new Set(payloads.map(localMediaPathFromPayload).filter(
    (path): path is string => path !== null,
  ))];
  await Promise.all(paths.map(async (path) => {
    try {
      await objectStorage.deleteObjectEntityFile(path);
    } catch (error) {
      logger.warn({ err: error, path }, "Could not remove saved chat media from private storage");
    }
  }));
}

async function clearConversationHistory(scope: "all" | "evolution"): Promise<void> {
  await Promise.all(
    [...evolutionMessageSyncRequests.values()].map((request) =>
      request.catch(() => undefined),
    ),
  );

  const evolutionFilter = or(
    like(conversations.phoneNumberId, "evolution:%"),
    like(conversations.remoteJid, "%@lid"),
  );
  const filter = scope === "evolution" ? evolutionFilter : undefined;
  const existingRows = filter
    ? await db.select({ id: conversations.id }).from(conversations).where(filter).limit(1)
    : await db.select({ id: conversations.id }).from(conversations).limit(1);
  if (existingRows.length === 0) {
    evolutionConversationHistorySyncTimestamps.clear();
    return;
  }

  const mediaQuery = db
    .select({ providerPayload: chatMessages.providerPayload })
    .from(chatMessages)
    .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id));
  const mediaRows = filter ? await mediaQuery.where(filter) : await mediaQuery;

  await db.transaction(async (tx) => {
    if (filter) {
      const scopedConversationIds = tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(filter);
      await tx
        .delete(chatMessages)
        .where(inArray(chatMessages.conversationId, scopedConversationIds));
      await tx.delete(conversations).where(filter);
      return;
    }

    const allConversationIds = tx
      .select({ id: conversations.id })
      .from(conversations);
    await tx
      .delete(chatMessages)
      .where(inArray(chatMessages.conversationId, allConversationIds));
    await tx.delete(conversations);
  });

  await deleteLocalMediaObjects(mediaRows.map((row) => row.providerPayload));
  evolutionConversationHistorySyncTimestamps.clear();
}

async function conversationResponse(
  conversation: typeof conversations.$inferSelect,
  contact: typeof contacts.$inferSelect,
  lastMessageOverride?: typeof chatMessages.$inferSelect | null,
  lidAliases?: ReadonlyMap<string, string>,
) {
  const [queriedLastMessage] = lastMessageOverride === undefined
    ? await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversation.id))
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(1)
    : [];
  const lastMessage = lastMessageOverride === undefined ? queriedLastMessage : lastMessageOverride;

  const fallback = {
    id: 0,
    direction: "inbound",
    content: "",
    messageType: "text",
    status: "received",
    createdAt: conversation.updatedAt.toISOString(),
    whatsappMessageId: null,
    mediaUrl: null,
    mediaMimeType: null,
    mediaFileName: null,
    mediaCaption: null,
    replyToMessageId: null,
    reactionEmoji: null,
  } as const;

  const phoneNumber = conversationPhoneNumber(conversation, contact, lidAliases);
  const contactName = conversationContactDisplayName(conversation, contact);
  const shouldShowUnsavedNumber = activeProvider === "evolution"
    && conversation.conversationType !== "group"
    && Boolean(contact.deletedAt)
    && Boolean(phoneNumber);

  return {
    id: conversation.id,
    conversationType: conversation.conversationType === "group" ? "group" : "direct",
    remoteJid: conversation.remoteJid,
    labels: Array.isArray(conversation.labels) ? conversation.labels : [],
    archivedAt: conversation.archivedAt?.toISOString() ?? null,
    isPinned: conversation.isPinned,
    contact: {
      name: shouldShowUnsavedNumber ? phoneNumber : contactName,
      phoneNumber,
    },
    profilePictureUrl: (() => {
      if (activeProvider !== "evolution" || !activeEvolutionSession?.connected) return null;
      const pictureLookupId = conversation.conversationType === "group"
        ? stringValue(conversation.remoteJid)
        : phoneNumber || stringValue(conversation.remoteJid) || contact.phoneNumber;
      return pictureLookupId ? evolutionProfilePicturePath(pictureLookupId) : null;
    })(),
    lastMessage: lastMessage ? messageResponse(lastMessage, conversation.id) : fallback,
    unreadCount: conversation.unreadCount,
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

async function sendTextMessage(
  phoneNumberId: string,
  to: string,
  content: string,
  accessToken: string,
) {
  const body = await graphRequest<{
    messages?: Array<{ id?: string }>;
  }>(`${encodeURIComponent(phoneNumberId)}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: content },
    }),
  });

  const id = stringValue(body.messages?.[0]?.id);
  if (!id) {
    throw new MetaApiError("A Meta não retornou o ID da mensagem enviada.");
  }
  return id;
}

type MediaMessageType = "image" | "video" | "audio" | "document";

function mediaMessageType(mimeType: string): MediaMessageType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function isOggOpus(buffer: Buffer): boolean {
  return buffer.length >= 32
    && buffer.toString("ascii", 0, 4) === "OggS"
    && buffer.indexOf(Buffer.from("OpusHead"), 0, "ascii") >= 0;
}

async function uploadMediaToMeta(
  phoneNumberId: string,
  file: Express.Multer.File,
  accessToken: string,
) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  const fileBytes = new Uint8Array(file.buffer).slice().buffer;
  form.append(
    "file",
    new Blob([fileBytes], { type: file.mimetype }),
    file.originalname,
  );
  const response = await fetchMeta(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/media`,
    accessToken,
    { method: "POST", headers: {}, body: form },
  );
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = asRecord(body.error);
    throw new MetaApiError(
      stringValue(error.message) || "A Meta recusou o arquivo enviado.",
      response.status,
      stringValue(error.code),
    );
  }
  const mediaId = stringValue(body.id);
  if (!mediaId) throw new MetaApiError("A Meta não retornou o ID da mídia.");
  return mediaId;
}

async function sendMediaMessage(
  phoneNumberId: string,
  to: string,
  file: Express.Multer.File,
  caption: string,
  accessToken: string,
  asVoiceNote = false,
) {
  const type = mediaMessageType(file.mimetype);
  const mediaId = await uploadMediaToMeta(phoneNumberId, file, accessToken);
  const media = {
    id: mediaId,
    ...(caption ? { caption } : {}),
    ...(type === "document" ? { filename: file.originalname } : {}),
    ...(asVoiceNote && type === "audio" ? { voice: true } : {}),
  };
  const body = await graphRequest<{ messages?: Array<{ id?: string }> }>(
    `${encodeURIComponent(phoneNumberId)}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type,
        [type]: media,
      }),
    },
  );
  const id = stringValue(body.messages?.[0]?.id);
  if (!id) throw new MetaApiError("A Meta não retornou o ID da mídia enviada.");
  return { id, type };
}

async function storeOutboundEvolutionMediaMessage(
  conversation: typeof conversations.$inferSelect,
  file: Express.Multer.File,
  caption: string,
  session: EvolutionSession,
  asVoiceNote = false,
  historyObjectPath?: string,
) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, conversation.contactId))
    .limit(1);
  if (!contact) throw new MetaApiError("Contato da conversa não encontrado.", 404);

  const type = mediaMessageType(file.mimetype);
  if (asVoiceNote && (type !== "audio" || !isOggOpus(file.buffer))) {
    throw new MetaApiError("Notas de voz precisam estar no formato OGG/Opus.", 400);
  }
  const [pending] = await db
    .insert(chatMessages)
    .values({
      conversationId: conversation.id,
      direction: "outbound",
      messageType: type,
      content: caption || file.originalname,
      status: "pending",
    })
    .returning();
  try {
    const endpoint = asVoiceNote
      ? `/message/sendWhatsAppAudio/${encodeURIComponent(session.instanceName)}`
      : `/message/sendMedia/${encodeURIComponent(session.instanceName)}`;
    const requestBody = asVoiceNote
      ? {
          number: evolutionRecipient(contact.phoneNumber, conversation),
          audio: file.buffer.toString("base64"),
        }
      : {
          number: evolutionRecipient(contact.phoneNumber, conversation),
          mediatype: type,
          mimetype: file.mimetype,
          caption,
          media: file.buffer.toString("base64"),
          fileName: file.originalname,
        };
    const body = await evolutionRequest<Record<string, unknown>>(
      session,
      endpoint,
      {
        method: "POST",
        body: JSON.stringify(requestBody),
      },
    );
    const key = asRecord(asRecord(body.data).key);
    const topKey = asRecord(body.key);
    const rawId = stringValue(key.id) || stringValue(topKey.id) || stringValue(body.keyId);
    if (!rawId) throw new MetaApiError("O serviço de conexão via QR Code não retornou o ID da mídia enviada.");
    const whatsappMessageId = `evolution:${session.instanceName}:${rawId}`;
    const mediaData = asRecord(body.data);
    const providerPayload = withoutEvolutionBinary({
      key: Object.keys(key).length ? key : topKey,
      message: mediaData.message ?? body.message,
      messageType: type,
      messageTimestamp: mediaData.messageTimestamp ?? body.messageTimestamp,
    }) as Record<string, unknown>;
    if (historyObjectPath) providerPayload.localMediaPath = historyObjectPath;
    const [latestPending] = await db
      .select({ status: chatMessages.status })
      .from(chatMessages)
      .where(eq(chatMessages.id, pending.id))
      .limit(1);
    const finalStatus = ["delivered", "read", "failed"].includes(latestPending?.status ?? "")
      ? latestPending!.status
      : "sent";
    const [sent] = await db
      .update(chatMessages)
      .set({
        status: finalStatus,
        whatsappMessageId,
        providerPayload,
        mediaMimeType: file.mimetype,
        mediaFileName: file.originalname,
        mediaCaption: caption || null,
      })
      .where(eq(chatMessages.id, pending.id))
      .returning();
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
    publishConversationEvent({ conversationId: conversation.id, reason: "message", whatsappMessageId });
    return sent ?? pending;
  } catch (error) {
    await db
      .update(chatMessages)
      .set({ status: "failed" })
      .where(eq(chatMessages.id, pending.id));
    throw error;
  }
}

async function storeOutboundMediaMessage(
  conversation: typeof conversations.$inferSelect,
  file: Express.Multer.File,
  caption: string,
  connection: ActiveConnection,
  asVoiceNote = false,
  historyObjectPath?: string,
) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, conversation.contactId))
    .limit(1);
  if (!contact) throw new MetaApiError("Contato da conversa não encontrado.", 404);

  const type = mediaMessageType(file.mimetype);
  const [pending] = await db
    .insert(chatMessages)
    .values({
      conversationId: conversation.id,
      direction: "outbound",
      messageType: type,
      content: caption || file.originalname,
      status: "pending",
    })
    .returning();

  try {
    const sent = await sendMediaMessage(
      conversation.phoneNumberId,
      recipientPhoneNumber(contact.phoneNumber, connection),
      file,
      caption,
      connection.accessToken,
      asVoiceNote,
    );
    const [updated] = await db
      .update(chatMessages)
      .set({
        status: "sent",
        whatsappMessageId: sent.id,
        mediaMimeType: file.mimetype,
        mediaFileName: file.originalname,
        mediaCaption: caption || null,
        ...(historyObjectPath ? { providerPayload: { localMediaPath: historyObjectPath } } : {}),
      })
      .where(eq(chatMessages.id, pending.id))
      .returning();
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
    return updated ?? pending;
  } catch (error) {
    await db
      .update(chatMessages)
      .set({ status: "failed" })
      .where(eq(chatMessages.id, pending.id));
    throw error;
  }
}

function contactPhoneCandidates(phoneNumber: string): string[] {
  const normalizedPhone = normalizePhone(phoneNumber);
  const explicitlyInternational = phoneNumber.trim().startsWith("+");
  const storedPhoneNumber = explicitlyInternational ? `+${normalizedPhone}` : normalizedPhone;
  const candidatePhones: string[] = [];
  if (explicitlyInternational) candidatePhones.push(storedPhoneNumber);
  candidatePhones.push(normalizedPhone, `+${normalizedPhone}`);
  if (activeConnection || activeEvolutionSession) {
    const countryAwarePhone = activeConnection
      ? recipientPhoneNumber(phoneNumber, activeConnection)
      : normalizedPhone;
    const brazilPhone = countryAwarePhone.startsWith("55") && countryAwarePhone.length > 12
      ? countryAwarePhone
      : normalizedPhone;
    if (brazilPhone.startsWith("55") && brazilPhone.length > 12) {
      candidatePhones.push(brazilPhone.slice(2));
    }
    candidatePhones.push(countryAwarePhone);
  }
  return [...new Set(candidatePhones)];
}

async function findContactByPhone(phoneNumber: string) {
  for (const candidatePhone of contactPhoneCandidates(phoneNumber)) {
    const [candidate] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.phoneNumber, candidatePhone))
      .limit(1);
    if (candidate) return candidate;
  }
  return undefined;
}

function isGeneratedContactName(name: string, phoneNumber: string): boolean {
  return name.trim() === `Cliente ${phoneNumber.slice(-4)}`;
}

function isEvolutionPlaceholderContactName(name: string, phoneNumber: string): boolean {
  const normalized = name
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized === "voce"
    || normalized === "contato do whatsapp"
    || normalized === "whatsapp contact"
    || /^\d{1,4}$/.test(normalized)
    || isGeneratedContactName(name, phoneNumber);
}

function contactDisplayName(contact: typeof contacts.$inferSelect): string {
  const name = contact.name.trim();
  if (name && !isGeneratedContactName(name, contact.phoneNumber)) return name;
  return isEvolutionLid(contact.phoneNumber) ? "Contato do WhatsApp" : contact.phoneNumber;
}

function conversationContactDisplayName(
  conversation: typeof conversations.$inferSelect,
  contact: typeof contacts.$inferSelect,
): string {
  if (
    activeProvider === "evolution"
    && contact.deletedAt
    && conversation.conversationType !== "group"
  ) {
    return "Contato do WhatsApp";
  }
  const name = contactDisplayName(contact);
  if (!isEvolutionLid(conversation.remoteJid)) return name;
  const lidDigits = normalizePhone(stringValue(conversation.remoteJid).split("@")[0]);
  return name === conversation.remoteJid || normalizePhone(name) === lidDigits
    ? "Contato do WhatsApp"
    : name;
}

function conversationPhoneNumber(
  conversation: typeof conversations.$inferSelect,
  contact: typeof contacts.$inferSelect,
  lidAliases?: ReadonlyMap<string, string>,
): string {
  if (conversation.conversationType === "group") return "";

  const remoteJid = stringValue(conversation.remoteJid);
  const storedPhone = stringValue(contact.phoneNumber).trim();
  const lidJid = isEvolutionLid(remoteJid)
    ? remoteJid
    : isEvolutionLid(storedPhone)
      ? storedPhone
      : null;

  if (lidJid) {
    const lidDigits = normalizePhone(lidJid.split("@")[0]);
    const aliases = lidAliases ?? getCachedEvolutionLidAliases(
      activeProvider === "evolution" ? activeEvolutionSession : null,
    );
    const resolved = evolutionPhoneFromAlternateJid(
      aliases.get(remoteJid) ?? aliases.get(storedPhone) ?? "",
    );
    if (resolved && resolved !== lidDigits) return resolved;

    const storedDigits = normalizePhone(storedPhone);
    return /^\d{8,15}$/.test(storedDigits) && storedDigits !== lidDigits
      ? storedPhone
      : "";
  }

  const jidPhone = phoneNumberFromJid(remoteJid) || phoneNumberFromJid(storedPhone);
  if (jidPhone) return jidPhone;
  const normalizedStoredPhone = normalizePhone(storedPhone);
  return /^\d{8,15}$/.test(normalizedStoredPhone) ? storedPhone : "";
}

async function getOrCreateContact(
  phoneNumber: string,
  name?: string,
  options: { preserveSavedName?: boolean } = {},
) {
  const normalizedPhone = normalizePhone(phoneNumber);
  const explicitlyInternational = phoneNumber.trim().startsWith("+");
  const storedPhoneNumber = explicitlyInternational ? `+${normalizedPhone}` : normalizedPhone;
  const existing = await findContactByPhone(phoneNumber);

  if (existing) {
    const incomingName = name?.trim();
    const nextName = options.preserveSavedName && !existing.deletedAt
      ? existing.name
      :
      incomingName ||
      (isGeneratedContactName(existing.name, existing.phoneNumber)
        ? existing.phoneNumber
        : existing.name);
    const nextPhoneNumber = explicitlyInternational ? storedPhoneNumber : existing.phoneNumber;
    if (nextName !== existing.name || nextPhoneNumber !== existing.phoneNumber) {
      const [updated] = await db
        .update(contacts)
        .set({ name: nextName, phoneNumber: nextPhoneNumber, updatedAt: new Date() })
        .where(eq(contacts.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  try {
    const [created] = await db
      .insert(contacts)
      .values({ phoneNumber: storedPhoneNumber, name: name?.trim() || storedPhoneNumber })
      .returning();
    return created;
  } catch (error) {
    const createdConcurrently = await findContactByPhone(phoneNumber);
    if (createdConcurrently) return createdConcurrently;
    throw error;
  }
}

async function restoreContactInAddressBook(contactId: number) {
  await db
    .update(contacts)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(contacts.id, contactId));
}

async function getOrCreateConversation(contactId: number, phoneNumberId: string) {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, contactId),
        eq(conversations.phoneNumberId, phoneNumberId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  if (phoneNumberId === "unknown") {
    const [contactConversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.contactId, contactId))
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(1);
    if (contactConversation) return contactConversation;
  }

  const [created] = await db
    .insert(conversations)
    .values({ contactId, phoneNumberId })
    .returning();
  return created;
}

async function mergeEvolutionConversationRows(
  primary: typeof conversations.$inferSelect,
  duplicateRows: Array<typeof conversations.$inferSelect>,
) {
  const duplicates = [...new Map(
    duplicateRows
      .filter((row) => row.id !== primary.id)
      .map((row) => [row.id, row]),
  ).values()];
  if (duplicates.length === 0) return primary;

  const allRows = [primary, ...duplicates];
  const latestMessageAt = allRows
    .map((row) => row.lastMessageAt)
    .filter((date): date is Date => date !== null)
    .sort((first, second) => second.getTime() - first.getTime())[0] ?? null;
  const latestUpdatedAt = new Date(Math.max(...allRows.map((row) => row.updatedAt.getTime())));
  const archivedAt = allRows.find((row) => row.archivedAt)?.archivedAt ?? null;
  const labels = [...new Set(allRows.flatMap((row) => row.labels ?? []))].slice(0, 12);

  await db.transaction(async (tx) => {
    for (const duplicate of duplicates) {
      await tx
        .update(chatMessages)
        .set({ conversationId: primary.id })
        .where(eq(chatMessages.conversationId, duplicate.id));
    }
    await tx
      .update(conversations)
      .set({
        unreadCount: allRows.reduce((total, row) => total + row.unreadCount, 0),
        lastMessageAt: latestMessageAt,
        updatedAt: latestUpdatedAt,
        labels,
        archivedAt,
        isPinned: allRows.some((row) => row.isPinned),
      })
      .where(eq(conversations.id, primary.id));
    await tx
      .delete(conversations)
      .where(inArray(conversations.id, duplicates.map((row) => row.id)));
  });

  const [merged] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, primary.id))
    .limit(1);
  return merged ?? primary;
}

async function getOrCreateEvolutionConversation(
  remoteJid: string,
  name: string | undefined,
  session: EvolutionSession,
  alternateRemoteJid?: string,
) {
  const isGroup = remoteJid.endsWith("@g.us");
  const cachedAliases = evolutionLidAliasCache.get(session.instanceName);
  let aliases = cachedAliases && cachedAliases.expiresAt > Date.now()
    ? cachedAliases.aliases
    : new Map<string, string>();
  const remotePhone = !isGroup ? phoneNumberFromJid(remoteJid) : null;
  const alternatePhone = !isGroup
    ? evolutionPhoneFromAlternateJid(alternateRemoteJid ?? "")
    : null;
  const observedLidJid = isEvolutionLid(remoteJid)
    ? remoteJid
    : isEvolutionLid(alternateRemoteJid)
      ? alternateRemoteJid
      : null;
  const observedPhone = alternatePhone || remotePhone;
  if (observedLidJid && observedPhone) {
    rememberEvolutionLidAlias(session, observedLidJid, observedPhone);
    aliases = getCachedEvolutionLidAliases(session);
  }
  if (!isGroup && isEvolutionLid(remoteJid) && !alternatePhone && !aliases.has(remoteJid)) {
    aliases = await loadEvolutionLidAliases(session);
  }
  const aliasedPhone = !isGroup && isEvolutionLid(remoteJid)
    ? evolutionPhoneFromAlternateJid(aliases.get(remoteJid) ?? "")
    : null;
  const rawPhone = remotePhone || alternatePhone || aliasedPhone
    || (isEvolutionLid(remoteJid) ? "" : remoteJid.split("@")[0]);
  const resolvedPhone = normalizePhone(rawPhone);
  const lidJids = new Set<string>(
    [remoteJid, alternateRemoteJid ?? ""].filter(isEvolutionLid),
  );
  if (!isGroup && /^\d{8,15}$/.test(resolvedPhone)) {
    for (const [lidJid, mappedPhone] of aliases) {
      const mappedNumber = evolutionPhoneFromAlternateJid(mappedPhone);
      if (mappedNumber && normalizePhone(mappedNumber) === resolvedPhone) {
        lidJids.add(lidJid);
      }
    }
  }
  let contact: typeof contacts.$inferSelect;

  if (isGroup) {
    const [existing] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.phoneNumber, remoteJid))
      .limit(1);
    const groupName = name?.trim() || existing?.name || "Grupo do WhatsApp";
    if (existing) {
      if (existing.name !== groupName) {
        const [updated] = await db
          .update(contacts)
          .set({ name: groupName, updatedAt: new Date() })
          .where(eq(contacts.id, existing.id))
          .returning();
        contact = updated ?? existing;
      } else {
        contact = existing;
      }
    } else {
      const [created] = await db
        .insert(contacts)
        .values({ phoneNumber: remoteJid, name: groupName })
        .returning();
      contact = created;
    }
  } else {
    const phoneNumber = normalizePhone(rawPhone);
    if (/^\d{8,15}$/.test(phoneNumber)) {
      let existingPhoneContact = await findContactByPhone(phoneNumber);
      if (
        existingPhoneContact
        && !existingPhoneContact.deletedAt
        && isEvolutionPlaceholderContactName(existingPhoneContact.name, existingPhoneContact.phoneNumber)
      ) {
        const [unsavedContact] = await db
          .update(contacts)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(contacts.id, existingPhoneContact.id))
          .returning();
        existingPhoneContact = unsavedContact ?? existingPhoneContact;
      }
      contact = existingPhoneContact && !existingPhoneContact.deletedAt
        ? existingPhoneContact
        : await getOrCreateContact(phoneNumber, name, { preserveSavedName: true });
      if (!existingPhoneContact) {
        const [conversationOnlyContact] = await db
          .update(contacts)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(contacts.id, contact.id))
          .returning();
        contact = conversationOnlyContact ?? contact;
      }
    } else {
      const identityJid = isEvolutionLid(remoteJid)
        ? remoteJid
        : isEvolutionLid(alternateRemoteJid ?? "")
          ? alternateRemoteJid!
          : remoteJid;
      const [existing] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.phoneNumber, identityJid))
        .limit(1);
      if (existing) {
        const nextName = name?.trim() || existing.name;
        if (nextName !== existing.name) {
          const [updated] = await db
            .update(contacts)
            .set({ name: nextName, updatedAt: new Date() })
            .where(eq(contacts.id, existing.id))
            .returning();
          contact = updated ?? existing;
        } else {
          contact = existing;
        }
      } else {
        const [created] = await db
          .insert(contacts)
          .values({
            phoneNumber: identityJid,
            name: name?.trim() || "Contato do WhatsApp",
          })
          .returning();
        contact = created;
      }
      if (isEvolutionLid(identityJid) && !contact.deletedAt) {
        const [conversationOnlyContact] = await db
          .update(contacts)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(contacts.id, contact.id))
          .returning();
        contact = conversationOnlyContact ?? contact;
      }
    }
  }

  const providerPhoneNumberId = `evolution:${session.instanceName}`;
  const phoneCandidates = !isGroup && /^\d{8,15}$/.test(resolvedPhone)
    ? contactPhoneCandidates(resolvedPhone)
    : [];
  const identityJids = [...new Set(
    [remoteJid, alternateRemoteJid ?? "", ...lidJids].filter((jid) => jid.includes("@")),
  )];
  const relatedPredicates = [
    ...(phoneCandidates.length ? [inArray(contacts.phoneNumber, phoneCandidates)] : []),
    ...(identityJids.length ? [inArray(conversations.remoteJid, identityJids)] : []),
  ];
  const relatedRows = relatedPredicates.length
    ? await db
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(and(
        eq(conversations.phoneNumberId, providerPhoneNumberId),
        or(...relatedPredicates),
      ))
    : [];
  let [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, contact.id),
        eq(conversations.phoneNumberId, providerPhoneNumberId),
      ),
    )
    .limit(1);
  if (!conversation) {
    const preferredRelated = [...relatedRows].sort((first, second) => {
      const firstSaved = first.contact.deletedAt ? 0 : 1;
      const secondSaved = second.contact.deletedAt ? 0 : 1;
      return secondSaved - firstSaved
        || (second.conversation.lastMessageAt?.getTime() ?? 0)
          - (first.conversation.lastMessageAt?.getTime() ?? 0)
        || second.conversation.updatedAt.getTime() - first.conversation.updatedAt.getTime();
    })[0]?.conversation;
    if (preferredRelated) {
      if (preferredRelated.contactId === contact.id) {
        conversation = preferredRelated;
      } else {
        try {
          const [relinked] = await db
            .update(conversations)
            .set({ contactId: contact.id })
            .where(eq(conversations.id, preferredRelated.id))
            .returning();
          conversation = relinked ?? preferredRelated;
        } catch (error) {
          const [concurrentCanonical] = await db
            .select()
            .from(conversations)
            .where(and(
              eq(conversations.contactId, contact.id),
              eq(conversations.phoneNumberId, providerPhoneNumberId),
            ))
            .limit(1);
          if (!concurrentCanonical) throw error;
          conversation = concurrentCanonical;
        }
      }
    }
  }
  if (!conversation) {
    [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.contactId, contact.id),
          eq(conversations.phoneNumberId, "unknown"),
        ),
      )
      .limit(1);
    if (conversation) {
      const [migrated] = await db
        .update(conversations)
        .set({ phoneNumberId: providerPhoneNumberId })
        .where(eq(conversations.id, conversation.id))
        .returning();
      conversation = migrated ?? conversation;
    }
  }
  if (!conversation) {
    try {
      const [created] = await db
        .insert(conversations)
        .values({ contactId: contact.id, phoneNumberId: providerPhoneNumberId })
        .returning();
      conversation = created;
    } catch (error) {
      const [concurrentCanonical] = await db
        .select()
        .from(conversations)
        .where(and(
          eq(conversations.contactId, contact.id),
          eq(conversations.phoneNumberId, providerPhoneNumberId),
        ))
        .limit(1);
      if (!concurrentCanonical) throw error;
      conversation = concurrentCanonical;
    }
  }

  const sameContactRows = await db
    .select()
    .from(conversations)
    .where(and(
      eq(conversations.contactId, contact.id),
      eq(conversations.phoneNumberId, providerPhoneNumberId),
    ));
  conversation = await mergeEvolutionConversationRows(
    conversation,
    [
      ...relatedRows.map((row) => row.conversation),
      ...sameContactRows,
    ],
  );
  const [updated] = await db
    .update(conversations)
    .set({
      remoteJid,
      conversationType: isGroup ? "group" : "direct",
    })
    .where(eq(conversations.id, conversation.id))
    .returning();
  return updated ?? conversation;
}

async function deduplicateEvolutionConversations(
  session: EvolutionSession,
  force = false,
): Promise<void> {
  const syncKey = session.instanceName;
  const pending = evolutionConversationDedupRequests.get(syncKey);
  if (pending) await pending;
  if (!force && Date.now() - (evolutionConversationDedupTimestamps.get(syncKey) ?? 0) < 15_000) return;

  const request = (async () => {
    const pendingSync = evolutionMessageSyncRequests.get(syncKey);
    if (pendingSync) await pendingSync;

    const cachedAliases = evolutionLidAliasCache.get(syncKey);
    const aliases = cachedAliases && cachedAliases.expiresAt > Date.now()
      ? cachedAliases.aliases
      : new Map<string, string>();
    const rows = await db
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversations.phoneNumberId, `evolution:${session.instanceName}`));
    const byPhone = new Map<string, Array<{
      conversation: typeof conversations.$inferSelect;
      contact: typeof contacts.$inferSelect;
    }>>();

    for (const row of rows) {
      if (row.conversation.conversationType === "group") continue;
      const remoteJid = row.conversation.remoteJid ?? "";
      const phoneCandidate =
        phoneNumberFromJid(row.contact.phoneNumber)
        || phoneNumberFromJid(remoteJid)
        || evolutionPhoneFromAlternateJid(aliases.get(remoteJid) ?? "")
        || evolutionPhoneFromAlternateJid(aliases.get(row.contact.phoneNumber) ?? "");
      const phone = normalizePhone(phoneCandidate ?? "");
      if (!/^\d{8,15}$/.test(phone)) continue;
      const samePhone = byPhone.get(phone) ?? [];
      samePhone.push(row);
      byPhone.set(phone, samePhone);
    }

    for (const samePhone of byPhone.values()) {
      if (samePhone.length < 2) continue;
      const ordered = [...samePhone].sort((first, second) => {
        const firstSaved = first.contact.deletedAt ? 0 : 1;
        const secondSaved = second.contact.deletedAt ? 0 : 1;
        return secondSaved - firstSaved
          || Number(second.conversation.isPinned) - Number(first.conversation.isPinned)
          || (second.conversation.lastMessageAt?.getTime() ?? 0)
            - (first.conversation.lastMessageAt?.getTime() ?? 0)
          || second.conversation.updatedAt.getTime() - first.conversation.updatedAt.getTime();
      });
      await mergeEvolutionConversationRows(
        ordered[0]!.conversation,
        ordered.slice(1).map((row) => row.conversation),
      );
    }

    evolutionConversationDedupTimestamps.set(syncKey, Date.now());
  })();

  evolutionConversationDedupRequests.set(syncKey, request);
  try {
    await request;
  } finally {
    if (evolutionConversationDedupRequests.get(syncKey) === request) {
      evolutionConversationDedupRequests.delete(syncKey);
    }
  }
}

function evolutionRecipient(
  contactPhone: string,
  conversation: typeof conversations.$inferSelect,
): string {
  if (conversation.conversationType === "group" && conversation.remoteJid?.endsWith("@g.us")) {
    return conversation.remoteJid;
  }
  if (conversation.remoteJid?.endsWith("@lid")) {
    const contactDigits = normalizePhone(contactPhone);
    const lidDigits = normalizePhone(conversation.remoteJid.split("@")[0]);
    if (/^\d{8,15}$/.test(contactDigits) && contactDigits !== lidDigits) {
      return evolutionPhoneNumber(contactPhone);
    }
    return conversation.remoteJid;
  }
  return evolutionPhoneNumber(contactPhone);
}

async function syncEvolutionRecentMessages(session: EvolutionSession): Promise<void> {
  const syncKey = session.instanceName;
  const pending = evolutionMessageSyncRequests.get(syncKey);
  if (pending) {
    await pending;
    return;
  }
  const lastSyncAt = evolutionMessageSyncTimestamps.get(syncKey) ?? 0;
  if (Date.now() - lastSyncAt < 8_000) return;

  const request = (async () => {
    const [response, lidAliases] = await Promise.all([
      evolutionRequest<unknown>(
        session,
        `/chat/findMessages/${encodeURIComponent(session.instanceName)}`,
        {
          method: "POST",
          body: JSON.stringify({
            where: {},
            take: 100,
            skip: 0,
            orderBy: { messageTimestamp: "desc" },
          }),
        },
        8_000,
      ),
      loadEvolutionLidAliases(session),
    ]);
    const result = asRecord(response);
    const messagePage = asRecord(result.messages);
    const records = Array.isArray(messagePage.records)
      ? messagePage.records.map(asRecord)
      : Array.isArray(result.records)
        ? result.records.map(asRecord)
        : [];
    const changed = new Map<number, {
      unreadCount: number;
      unreadDelta: number;
      lastMessageAt: Date | null;
    }>();
    let syncedMessageCount = 0;
    let reassociatedMessageCount = 0;
    const markChanged = (
      targetConversation: typeof conversations.$inferSelect,
      createdAt: Date,
      incoming: boolean,
    ) => {
      const state = changed.get(targetConversation.id) ?? {
        unreadCount: targetConversation.unreadCount,
        unreadDelta: 0,
        lastMessageAt: targetConversation.lastMessageAt,
      };
      if (incoming) state.unreadDelta += 1;
      if (!state.lastMessageAt || createdAt > state.lastMessageAt) {
        state.lastMessageAt = createdAt;
      }
      changed.set(targetConversation.id, state);
    };

    for (const item of [...records].reverse()) {
      const key = asRecord(item.key);
      const rawId = stringValue(key.id) || stringValue(item.id);
      const itemRemoteJid = stringValue(key.remoteJid) || stringValue(item.remoteJid);
      const rawAlternateRemoteJid =
        stringValue(key.remoteJidAlt) || stringValue(item.remoteJidAlt);
      const alternateRemoteJid = evolutionPhoneFromAlternateJid(rawAlternateRemoteJid)
        ? rawAlternateRemoteJid
        : isEvolutionLid(rawAlternateRemoteJid)
          ? rawAlternateRemoteJid
          : lidAliases.get(itemRemoteJid) ?? "";
      const remoteJid = itemRemoteJid || alternateRemoteJid;
      if (!rawId || !remoteJid.includes("@")) continue;

      const messageId = `evolution:${session.instanceName}:${rawId}`;
      const [stored] = await db
        .select({
          id: chatMessages.id,
          conversationId: chatMessages.conversationId,
          createdAt: chatMessages.createdAt,
          direction: chatMessages.direction,
          status: chatMessages.status,
        })
        .from(chatMessages)
        .where(eq(chatMessages.whatsappMessageId, messageId))
        .limit(1);
      const fromMe = key.fromMe === true || item.fromMe === true;
      const contactName = !fromMe ? (
        stringValue(item.pushName)
        || stringValue(item.notifyName)
        || stringValue(item.verifiedName)
        || undefined
      ) : undefined;
      if (stored) {
        if (remoteJid.endsWith("@lid") && alternateRemoteJid) {
          const targetConversation = await getOrCreateEvolutionConversation(
            remoteJid,
            contactName,
            session,
            alternateRemoteJid,
          );
          if (stored.conversationId !== targetConversation.id) {
            await db
              .update(chatMessages)
              .set({ conversationId: targetConversation.id })
              .where(eq(chatMessages.id, stored.id));
            markChanged(
              targetConversation,
              stored.createdAt,
              stored.direction === "inbound"
                && stored.status !== "read"
                && stored.createdAt.getTime() >= Date.now() - 5 * 60_000,
            );
            reassociatedMessageCount += 1;
          }
        }
        continue;
      }

      const details = evolutionMessageDetails(item);
      if (details.messageType === "reaction" && fromMe && !details.reactionEmoji) continue;
      const syncedConversation = await getOrCreateEvolutionConversation(
        remoteJid,
        remoteJid.endsWith("@g.us")
          ? stringValue(item.subject) || stringValue(item.groupName) || undefined
          : contactName,
        session,
        alternateRemoteJid,
      );

      const rawTimestamp = Number(item.messageTimestamp ?? item.timestamp);
      const createdAt = Number.isFinite(rawTimestamp) && rawTimestamp > 0
        ? new Date(rawTimestamp * 1000)
        : new Date();
      const status = evolutionMessageStatus(item.status, fromMe);
      if (fromMe) {
        const pendingRows = await db
          .select()
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.conversationId, syncedConversation.id),
              eq(chatMessages.direction, "outbound"),
              eq(chatMessages.status, "pending"),
            ),
          )
          .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
          .limit(5);
        const pendingMessage = pendingRows.find((candidate) => {
          const ageMs = Math.abs(createdAt.getTime() - candidate.createdAt.getTime());
          const sameType = candidate.messageType === details.messageType;
          const sameText = candidate.content === details.content;
          const isMedia = ["image", "video", "audio", "document", "sticker"].includes(details.messageType);
          return ageMs < 120_000 && sameType && (sameText || isMedia);
        });
        if (pendingMessage) {
          await db
            .update(chatMessages)
            .set({
              whatsappMessageId: messageId,
              status,
              providerPayload: details.providerPayload,
              mediaMimeType: details.mediaMimeType,
              mediaFileName: details.mediaFileName,
              mediaCaption: details.mediaCaption,
            })
            .where(eq(chatMessages.id, pendingMessage.id));
          markChanged(syncedConversation, createdAt, false);
          syncedMessageCount += 1;
          continue;
        }
      }
      const targetRawId = details.messageType === "reaction"
        ? details.reactionTargetId
        : details.replyTargetId;
      let replyToMessageId: number | null = null;
      if (targetRawId) {
        const [target] = await db
          .select({ id: chatMessages.id })
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.conversationId, syncedConversation.id),
              eq(
                chatMessages.whatsappMessageId,
                `evolution:${session.instanceName}:${targetRawId}`,
              ),
            ),
          )
          .limit(1);
        replyToMessageId = target?.id ?? null;
      }

      const [inserted] = await db
        .insert(chatMessages)
        .values({
          conversationId: syncedConversation.id,
          whatsappMessageId: messageId,
          direction: fromMe ? "outbound" : "inbound",
          messageType: details.messageType,
          content: details.content,
          status,
          providerPayload: details.providerPayload,
          mediaMimeType: details.mediaMimeType,
          mediaFileName: details.mediaFileName,
          mediaCaption: details.mediaCaption,
          replyToMessageId,
          reactionEmoji: details.messageType === "reaction" ? details.reactionEmoji : null,
          createdAt,
        })
        .onConflictDoNothing({ target: chatMessages.whatsappMessageId })
        .returning({ id: chatMessages.id });
      if (!inserted) continue;
      markChanged(
        syncedConversation,
        createdAt,
        !fromMe && createdAt.getTime() >= Date.now() - 5 * 60_000,
      );
      syncedMessageCount += 1;
    }

    for (const [conversationId, state] of changed) {
      await db
        .update(conversations)
        .set({
          ...(state.unreadDelta > 0
            ? { unreadCount: state.unreadCount + state.unreadDelta }
            : {}),
          ...(state.lastMessageAt
            ? { lastMessageAt: state.lastMessageAt, updatedAt: state.lastMessageAt }
            : {}),
        })
        .where(eq(conversations.id, conversationId));
      publishConversationEvent({ conversationId, reason: "message" });
    }
    const lastLogAt = evolutionMessageSyncLogAt.get(session.instanceName) ?? 0;
    if (changed.size > 0 || Date.now() - lastLogAt >= 60_000) {
      evolutionMessageSyncLogAt.set(session.instanceName, Date.now());
      logger.info(
        {
          fetchedRecords: records.length,
          syncedMessages: syncedMessageCount,
          reassociatedMessages: reassociatedMessageCount,
          mappedLidContacts: lidAliases.size,
        },
        "QR Code chat messages synchronized",
      );
    }
    evolutionMessageSyncTimestamps.set(syncKey, Date.now());
  })();
  evolutionMessageSyncRequests.set(syncKey, request);
  try {
    await request;
  } catch (error) {
    evolutionMessageSyncTimestamps.set(syncKey, Date.now());
    throw error;
  } finally {
    if (evolutionMessageSyncRequests.get(syncKey) === request) {
      evolutionMessageSyncRequests.delete(syncKey);
    }
  }
}

async function syncEvolutionConversationHistory(
  session: EvolutionSession,
  conversation: typeof conversations.$inferSelect,
  contactName?: string,
): Promise<number> {
  const cacheKey = `${session.instanceName}:${conversation.id}`;
  if (
    activeProvider !== "evolution"
    || activeEvolutionSession !== session
    || !session.connected
  ) return 0;
  const pending = evolutionConversationHistorySyncRequests.get(cacheKey);
  if (pending) return pending;
  const lastSyncAt = evolutionConversationHistorySyncTimestamps.get(cacheKey) ?? 0;
  if (Date.now() - lastSyncAt < 120_000) return 0;
  if (!conversation.remoteJid || conversation.phoneNumberId !== `evolution:${session.instanceName}`) return 0;

  const request = performEvolutionConversationHistorySync(session, conversation, contactName);
  evolutionConversationHistorySyncRequests.set(cacheKey, request);
  try {
    const importedCount = await request;
    if (activeEvolutionSession === session && session.connected) {
      evolutionConversationHistorySyncTimestamps.set(cacheKey, Date.now());
    }
    return importedCount;
  } catch (error) {
    if (activeEvolutionSession === session && session.connected) {
      evolutionConversationHistorySyncTimestamps.set(cacheKey, Date.now());
    }
    throw error;
  } finally {
    if (evolutionConversationHistorySyncRequests.get(cacheKey) === request) {
      evolutionConversationHistorySyncRequests.delete(cacheKey);
    }
  }
}

async function performEvolutionConversationHistorySync(
  session: EvolutionSession,
  conversation: typeof conversations.$inferSelect,
  contactName?: string,
): Promise<number> {
  const cacheKey = `${session.instanceName}:${conversation.id}`;
  if (
    !conversation.remoteJid
    || activeProvider !== "evolution"
    || activeEvolutionSession !== session
    || !session.connected
  ) return 0;
  const aliases = await loadEvolutionLidAliases(session);
  if (activeEvolutionSession !== session || !session.connected) return 0;
  const remoteJids = new Set([conversation.remoteJid]);
  if (isEvolutionLid(conversation.remoteJid)) {
    const phone = evolutionPhoneFromAlternateJid(aliases.get(conversation.remoteJid) ?? "");
    if (phone) remoteJids.add(evolutionPhoneNumber(phone));
  }
  const pageSize = 1000;
  let importedCount = 0;

  for (const remoteJid of remoteJids) {
    for (let page = 0; page < 10; page += 1) {
      if (activeEvolutionSession !== session || !session.connected) return importedCount;
      const response = await evolutionRequest<unknown>(
        session,
        `/chat/findMessages/${encodeURIComponent(session.instanceName)}`,
        {
          method: "POST",
          body: JSON.stringify({
            where: { key: { remoteJid } },
            take: pageSize,
            skip: page * pageSize,
            orderBy: { messageTimestamp: "desc" },
          }),
        },
        15_000,
      );
      const root = asRecord(response);
      const data = asRecord(root.data);
      const messagePage = asRecord(root.messages);
      const nestedPage = asRecord(data.messages);
      const candidates = [
        response,
        root.records,
        messagePage.records,
        data.records,
        nestedPage.records,
      ];
      const candidateRecords = candidates.find(Array.isArray);
      const records = Array.isArray(candidateRecords) ? candidateRecords.map(asRecord) : [];
      if (activeEvolutionSession !== session || !session.connected) return importedCount;

      for (const item of [...records].reverse()) {
        const key = asRecord(item.key);
        const rawId = stringValue(key.id) || stringValue(item.id);
        const itemRemoteJid =
          stringValue(key.remoteJid)
          || stringValue(item.remoteJid)
          || remoteJid;
        const rawAlternateRemoteJid =
          stringValue(key.remoteJidAlt)
          || stringValue(item.remoteJidAlt);
        const alternateRemoteJid = evolutionPhoneFromAlternateJid(rawAlternateRemoteJid)
          ? rawAlternateRemoteJid
          : isEvolutionLid(rawAlternateRemoteJid)
            ? rawAlternateRemoteJid
            : aliases.get(itemRemoteJid) ?? "";
        if (!rawId || !itemRemoteJid.includes("@")) continue;

        const whatsappMessageId = `evolution:${session.instanceName}:${rawId}`;
        const details = evolutionMessageDetails(item);
        const fromMe = key.fromMe === true || item.fromMe === true;
        if (details.messageType === "reaction" && fromMe && !details.reactionEmoji) continue;
        const messageConversation = await getOrCreateEvolutionConversation(
          itemRemoteJid,
          itemRemoteJid.endsWith("@g.us")
            ? stringValue(item.subject) || stringValue(item.groupName) || undefined
            : (fromMe
                ? contactName
                : stringValue(item.pushName) || stringValue(item.notifyName) || contactName),
          session,
          alternateRemoteJid,
        );
        const [stored] = await db
          .select({ id: chatMessages.id, conversationId: chatMessages.conversationId })
          .from(chatMessages)
          .where(eq(chatMessages.whatsappMessageId, whatsappMessageId))
          .limit(1);
        if (stored) {
          if (stored.conversationId !== messageConversation.id) {
            await db
              .update(chatMessages)
              .set({ conversationId: messageConversation.id })
              .where(eq(chatMessages.id, stored.id));
          }
          continue;
        }

        const rawTimestamp = Number(item.messageTimestamp ?? item.timestamp);
        const createdAt = Number.isFinite(rawTimestamp) && rawTimestamp > 0
          ? new Date(rawTimestamp * 1000)
          : new Date();
        const status = evolutionMessageStatus(item.status, fromMe);
        const targetRawId = details.messageType === "reaction"
          ? details.reactionTargetId
          : details.replyTargetId;
        let replyToMessageId: number | null = null;
        if (targetRawId) {
          const [target] = await db
            .select({ id: chatMessages.id })
            .from(chatMessages)
            .where(and(
              eq(chatMessages.conversationId, messageConversation.id),
              eq(
                chatMessages.whatsappMessageId,
                `evolution:${session.instanceName}:${targetRawId}`,
              ),
            ))
            .limit(1);
          replyToMessageId = target?.id ?? null;
        }

        const [inserted] = await db
          .insert(chatMessages)
          .values({
            conversationId: messageConversation.id,
            whatsappMessageId,
            direction: fromMe ? "outbound" : "inbound",
            messageType: details.messageType,
            content: details.content,
            status,
            providerPayload: details.providerPayload,
            mediaMimeType: details.mediaMimeType,
            mediaFileName: details.mediaFileName,
            mediaCaption: details.mediaCaption,
            replyToMessageId,
            reactionEmoji: details.messageType === "reaction" ? details.reactionEmoji : null,
            createdAt,
          })
          .onConflictDoNothing({ target: chatMessages.whatsappMessageId })
          .returning({ id: chatMessages.id });
        if (inserted) importedCount += 1;
        const [latest] = await db
          .select({ lastMessageAt: conversations.lastMessageAt })
          .from(conversations)
          .where(eq(conversations.id, messageConversation.id))
          .limit(1);
        if (!latest?.lastMessageAt || createdAt > latest.lastMessageAt) {
          await db
            .update(conversations)
            .set({ lastMessageAt: createdAt, updatedAt: createdAt })
            .where(eq(conversations.id, messageConversation.id));
        }
      }

      if (records.length < pageSize) break;
    }
  }
  if (importedCount > 0) {
    logger.info(
      { instanceName: session.instanceName, conversationId: conversation.id, importedCount },
      "QR Code conversation history synchronized",
    );
  }
  return importedCount;
}

async function syncEvolutionPinnedChats(session: EvolutionSession): Promise<void> {
  const lastSyncAt = evolutionChatPinSyncTimestamps.get(session.instanceName) ?? 0;
  if (Date.now() - lastSyncAt < 60_000) return;
  const response = await evolutionRequest<unknown>(
    session,
    `/chat/findChats/${encodeURIComponent(session.instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({ where: {}, take: 1000, skip: 0 }),
    },
    12_000,
  );
  const root = asRecord(response);
  const data = asRecord(root.data);
  const chatContainer = asRecord(root.chats);
  const dataChatContainer = asRecord(data.chats);
  const candidateCollections = [
    response,
    root.records,
    root.chats,
    root.result,
    root.data,
    data.records,
    data.chats,
    data.result,
    chatContainer.records,
    dataChatContainer.records,
  ];
  const collection = candidateCollections.find(Array.isArray);
  const chats = Array.isArray(collection) ? collection.map(asRecord) : [];
  const aliases = await loadEvolutionLidAliases(session);

  for (const chat of chats) {
    const pinned = evolutionChatPinnedState(chat);
    if (pinned === null) continue;
    const remoteJid = firstStringValue(
      chat.id,
      chat.remoteJid,
      chat.jid,
      asRecord(chat.key).remoteJid,
    ) || "";
    if (!remoteJid.includes("@")) continue;
    let [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(
        eq(conversations.phoneNumberId, `evolution:${session.instanceName}`),
        eq(conversations.remoteJid, remoteJid),
      ))
      .limit(1);
    if (!existing && isEvolutionLid(remoteJid)) {
      const alternatePhone = evolutionPhoneFromAlternateJid(
        firstStringValue(chat.remoteJidAlt, chat.phoneNumber, aliases.get(remoteJid)) || "",
      );
      if (alternatePhone) {
        const [matchingConversation] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .innerJoin(contacts, eq(conversations.contactId, contacts.id))
          .where(and(
            eq(conversations.phoneNumberId, `evolution:${session.instanceName}`),
            eq(contacts.phoneNumber, alternatePhone),
          ))
          .limit(1);
        existing = matchingConversation;
      }
    }
    if (existing) {
      await db
        .update(conversations)
        .set({ isPinned: pinned })
        .where(eq(conversations.id, existing.id));
    }
  }
  evolutionChatPinSyncTimestamps.set(session.instanceName, Date.now());
}

function scheduleEvolutionPinnedChatSync(session: EvolutionSession): void {
  void syncEvolutionPinnedChats(session).catch((error) => {
    const warningKey = `pinned-chats:${session.instanceName}`;
    const lastWarningAt = evolutionMessageSyncErrorLogAt.get(warningKey) ?? 0;
    if (Date.now() - lastWarningAt >= 60_000) {
      evolutionMessageSyncErrorLogAt.set(warningKey, Date.now());
      logger.warn(
        { err: error, instanceName: session.instanceName },
        "Could not load pinned chat state from the QR Code provider",
      );
    }
  });
}

function scheduleEvolutionMessageSync(session: EvolutionSession): void {
  void syncEvolutionRecentMessages(session).catch((error) => {
    const lastWarningAt = evolutionMessageSyncErrorLogAt.get(session.instanceName) ?? 0;
    if (Date.now() - lastWarningAt >= 30_000) {
      evolutionMessageSyncErrorLogAt.set(session.instanceName, Date.now());
      logger.warn(
        { err: error, instanceName: session.instanceName },
        "Could not sync messages from the QR Code connection",
      );
    }
  });
}

function scheduleEvolutionConversationHistorySync(
  session: EvolutionSession,
  conversation: typeof conversations.$inferSelect,
  contactName?: string,
): void {
  void syncEvolutionConversationHistory(session, conversation, contactName)
    .then((importedCount) => {
      if (importedCount > 0) {
        publishConversationEvent({ conversationId: conversation.id, reason: "message" });
      }
    })
    .catch((error) => {
      const warningKey = `history:${session.instanceName}:${conversation.id}`;
      const lastWarningAt = evolutionMessageSyncErrorLogAt.get(warningKey) ?? 0;
      if (Date.now() - lastWarningAt >= 60_000) {
        evolutionMessageSyncErrorLogAt.set(warningKey, Date.now());
        logger.warn(
          { err: error, conversationId: conversation.id, instanceName: session.instanceName },
          "Could not fetch older messages for the QR Code conversation",
        );
      }
    });
}

async function storeOutboundMessage(
  conversation: typeof conversations.$inferSelect,
  content: string,
  connection: ActiveConnection,
) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, conversation.contactId))
    .limit(1);
  if (!contact) throw new MetaApiError("Contato da conversa não encontrado.", 404);

  const [pending] = await db
    .insert(chatMessages)
    .values({
      conversationId: conversation.id,
      direction: "outbound",
      messageType: "text",
      content,
      status: "pending",
    })
    .returning();

  try {
    const whatsappMessageId = await sendTextMessage(
      conversation.phoneNumberId,
      recipientPhoneNumber(contact.phoneNumber, connection),
      content,
      connection.accessToken,
    );
    const [sent] = await db
      .update(chatMessages)
      .set({ status: "sent", whatsappMessageId })
      .where(eq(chatMessages.id, pending.id))
      .returning();
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
    return sent ?? pending;
  } catch (error) {
    await db
      .update(chatMessages)
      .set({ status: "failed" })
      .where(eq(chatMessages.id, pending.id));
    throw error;
  }
}

function evolutionPhoneNumber(phoneNumber: string): string {
  const trimmedPhoneNumber = phoneNumber.trim();
  const isDirectJid = /@(?:s\.whatsapp\.net|c\.us)$/i.test(trimmedPhoneNumber);
  if (trimmedPhoneNumber.startsWith("+")) return normalizePhone(trimmedPhoneNumber);
  if (trimmedPhoneNumber.includes("@") && !isDirectJid) return trimmedPhoneNumber;
  const normalized = normalizePhone(trimmedPhoneNumber);
  if (normalized.length === 10 || normalized.length === 11) {
    return `55${normalized}`;
  }
  return normalized;
}

async function sendEvolutionTextMessage(session: EvolutionSession, to: string, text: string) {
  const body = await evolutionRequest<Record<string, unknown>>(
    session,
    `/message/sendText/${encodeURIComponent(session.instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number: evolutionPhoneNumber(to),
        text,
        linkPreview: false,
      }),
    },
  );
  const key = asRecord(asRecord(body.data).key);
  const topKey = asRecord(body.key);
  const id = stringValue(key.id) || stringValue(topKey.id) || stringValue(body.keyId);
  if (!id) throw new MetaApiError("O serviço de conexão via QR Code não retornou o ID da mensagem enviada.");
  return `evolution:${session.instanceName}:${id}`;
}

async function storeOutboundEvolutionMessage(
  conversation: typeof conversations.$inferSelect,
  content: string,
  session: EvolutionSession,
) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, conversation.contactId))
    .limit(1);
  if (!contact) throw new MetaApiError("Contato da conversa não encontrado.", 404);

  const [pending] = await db
    .insert(chatMessages)
    .values({
      conversationId: conversation.id,
      direction: "outbound",
      messageType: "text",
      content,
      status: "pending",
    })
    .returning();
  try {
    const whatsappMessageId = await sendEvolutionTextMessage(
      session,
      evolutionRecipient(contact.phoneNumber, conversation),
      content,
    );
    const [latestPending] = await db
      .select({ status: chatMessages.status })
      .from(chatMessages)
      .where(eq(chatMessages.id, pending.id))
      .limit(1);
    const finalStatus = ["delivered", "read", "failed"].includes(latestPending?.status ?? "")
      ? latestPending!.status
      : "sent";
    const [sent] = await db
      .update(chatMessages)
      .set({ status: finalStatus, whatsappMessageId })
      .where(eq(chatMessages.id, pending.id))
      .returning();
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
    publishConversationEvent({
      conversationId: conversation.id,
      reason: "message",
      whatsappMessageId,
    });
    return sent ?? pending;
  } catch (error) {
    await db
      .update(chatMessages)
      .set({ status: "failed" })
      .where(eq(chatMessages.id, pending.id));
    throw error;
  }
}

async function storeOutboundTemplateMessage(
  conversation: typeof conversations.$inferSelect,
  template: typeof whatsappTemplates.$inferSelect,
  variables: string[],
  componentParameters: ComponentParameterInput[],
  connection: ActiveConnection,
) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, conversation.contactId))
    .limit(1);
  if (!contact) throw new MetaApiError("Contato da conversa não encontrado.", 404);

  const whatsappMessageId = await sendTemplateMessage(
    conversation.phoneNumberId,
    recipientPhoneNumber(contact.phoneNumber, connection),
    template,
    variables,
    componentParameters,
    connection.accessToken,
  );
  const [sent] = await db
    .insert(chatMessages)
    .values({
      conversationId: conversation.id,
      direction: "outbound",
      messageType: "template",
      content: renderTemplateBody(template.body, variables),
      status: "sent",
      whatsappMessageId,
    })
    .returning();
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));
  return sent;
}

router.get("/connection", (req, res) => {
  res.json(GetConnectionResponse.parse(connectionStatus(req)));
});

router.get("/evolution/connection", async (req, res) => {
  const session = activeEvolutionSession;
  const wasConnected = Boolean(session?.connected);
  const hadConnectedBeforeRefresh = Boolean(session?.hasConnectedBefore);
  const previousMetadata = session
    ? JSON.stringify([session.phoneNumber, session.profileName, session.profilePictureUrl ?? null])
    : null;
  if (session) {
    try {
      await ensureEvolutionWebhook(session, req);
    } catch (error) {
      logger.warn({ err: error, instanceName: session.instanceName }, "Could not refresh QR Code webhook configuration");
    }
    try {
      await refreshEvolutionSession(session, false);
    } catch (error) {
      session.state = "unreachable";
      session.connected = false;
      logger.warn({ err: error, instanceName: session.instanceName }, "Evolution API state check failed");
    }
    const currentMetadata = JSON.stringify([session.phoneNumber, session.profileName, session.profilePictureUrl ?? null]);
    if (session.connected && (
      previousMetadata !== currentMetadata
      || !hadConnectedBeforeRefresh
    )) {
      try {
        await persistEvolutionSession(session);
      } catch (error) {
        logger.warn({ err: error, instanceName: session.instanceName }, "Could not persist WhatsApp profile metadata");
      }
    }
    if (
      activeProvider === "evolution"
      && !session.connected
      && session.hasConnectedBefore
      && isKnownEvolutionDisconnectedState(session.state)
    ) {
      try {
        await clearConversationHistory("all");
        session.hasConnectedBefore = false;
        await persistEvolutionSession(session);
      } catch (error) {
        logger.error({ err: error, instanceName: session.instanceName }, "Could not clear WhatsApp history after QR disconnection");
        res.status(500).json({ error: "Não foi possível limpar o histórico após desconectar o WhatsApp." });
        return;
      }
    } else if (wasConnected && !session.connected) {
      req.log.info({ instanceName: session.instanceName }, "WhatsApp QR connection went offline");
    }
  }
  res.json(evolutionConnectionResponse(session));
});

router.get("/evolution/profile-picture", async (req, res): Promise<void> => {
  const session = activeEvolutionSession;
  if (activeProvider !== "evolution" || !session?.connected) {
    res.status(503).json({ error: "A conexão via QR Code não está ativa." });
    return;
  }

  const queryNumber = Array.isArray(req.query.number) ? req.query.number[0] : req.query.number;
  const requestedNumber = typeof queryNumber === "string" && queryNumber.trim()
    ? queryNumber.trim()
    : session.phoneNumber
      ? `${session.phoneNumber}@s.whatsapp.net`
      : "";
  const validNumber = /^\+?\d{7,15}$/.test(requestedNumber)
    || /^[\w.:-]{1,80}@(s\.whatsapp\.net|c\.us|g\.us|lid)$/i.test(requestedNumber);
  if (!validNumber) {
    res.status(400).json({ error: "Identificador de perfil inválido." });
    return;
  }
  const whatsappId = requestedNumber.includes("@")
    ? requestedNumber
    : `${normalizePhone(requestedNumber)}@s.whatsapp.net`;
  const lidPhoneNumber = isEvolutionLid(whatsappId)
    ? evolutionPhoneFromAlternateJid(getCachedEvolutionLidAliases(session).get(whatsappId) ?? "")
    : null;
  const pictureLookupId = lidPhoneNumber || whatsappId;
  const requestedPhoneNumber = normalizePhone(requestedNumber.split("@")[0] ?? "");
  const isOwnProfile = Boolean(
    session.phoneNumber
    && requestedPhoneNumber
    && requestedPhoneNumber === normalizePhone(session.phoneNumber),
  );

  try {
    let pictureUrl: string | null;
    try {
      pictureUrl = isOwnProfile
        ? await getEvolutionOwnProfilePictureUrl(session)
        : await getEvolutionPictureUrl(session, pictureLookupId);
    } catch (error) {
      if (!isOwnProfile || !session.profilePictureUrl) throw error;
      pictureUrl = safeWhatsAppPictureUrl(session.profilePictureUrl);
    }
    if (!pictureUrl && isOwnProfile) pictureUrl = safeWhatsAppPictureUrl(session.profilePictureUrl);
    if (!pictureUrl) {
      res.status(404).json({ error: "A foto de perfil não está disponível." });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      let imageResponse = await fetch(pictureUrl, {
        signal: controller.signal,
        redirect: "error",
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" },
      });
      if (!imageResponse.ok && [401, 403, 404, 410].includes(imageResponse.status)) {
        const cacheKeys = new Set([
          whatsappId,
          pictureLookupId,
          normalizePhone(session.phoneNumber ?? ""),
          session.phoneNumber ? `${normalizePhone(session.phoneNumber)}@s.whatsapp.net` : "",
        ].filter(Boolean).map((key) => `${session.instanceName}:${key}`));
        for (const key of cacheKeys) evolutionProfilePictureUrlCache.delete(key);
        if (isOwnProfile) session.profilePictureFetchedAt = 0;
        const refreshedPictureUrl = isOwnProfile
          ? await getEvolutionOwnProfilePictureUrl(session)
          : await getEvolutionPictureUrl(session, pictureLookupId);
        if (refreshedPictureUrl) {
          pictureUrl = refreshedPictureUrl;
          imageResponse = await fetch(pictureUrl, {
            signal: controller.signal,
            redirect: "error",
            headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" },
          });
        }
      }
      if (!imageResponse.ok) {
        res.status(404).json({ error: "A foto de perfil não está disponível." });
        return;
      }
      const contentType = imageResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      const supportedImageType = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(contentType);
      const contentLength = Number(imageResponse.headers.get("content-length") || 0);
      if (!supportedImageType || contentLength > profilePictureMaxBytes) {
        res.status(502).json({ error: "A imagem de perfil retornada não é válida." });
        return;
      }
      const reader = imageResponse.body?.getReader();
      if (!reader) {
        res.status(502).json({ error: "A imagem de perfil retornada não é válida." });
        return;
      }
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > profilePictureMaxBytes) {
          await reader.cancel();
          res.status(502).json({ error: "A imagem de perfil retornada é muito grande." });
          return;
        }
        chunks.push(value);
      }
      if (totalBytes === 0) {
        res.status(502).json({ error: "A imagem de perfil retornada não é válida." });
        return;
      }
      const image = Buffer.concat(chunks, totalBytes);
      res
        .status(200)
        .set({
          "Cache-Control": "private, max-age=60, must-revalidate",
          "Content-Type": contentType,
          "X-Content-Type-Options": "nosniff",
        })
        .send(image);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    req.log.warn({ err: error, instanceName: session.instanceName }, "Could not proxy WhatsApp profile picture");
    res.status(502).json({ error: "Não foi possível carregar a foto do perfil." });
  }
});

router.post("/evolution/connection", async (req, res) => {
  try {
    const input = ConnectEvolutionWhatsAppBody.parse(req.body);
    const instanceName = input.instanceName.trim();
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(instanceName)) {
      res.status(400).json({ error: "O nome da instância deve ter de 2 a 64 caracteres: letras, números, hífen ou sublinhado." });
      return;
    }
    if (!process.env.SESSION_SECRET) {
      res.status(500).json({ error: "SESSION_SECRET não está configurado para proteger a conexão via QR Code." });
      return;
    }
    const serverUrl = input.serverUrl?.trim() || process.env.EVOLUTION_API_URL?.trim() || "";
    const apiKey = input.apiKey?.trim() || process.env.EVOLUTION_API_KEY?.trim() || "";
    if (!serverUrl || !apiKey) {
      res.status(400).json({
        error: "Configure EVOLUTION_API_URL e EVOLUTION_API_KEY nos Secrets do Replit ou preencha os campos desta tela.",
      });
      return;
    }

    const session: EvolutionSession = {
      serverUrl: normalizeEvolutionUrl(serverUrl),
      apiKey,
      instanceName,
      connected: false,
      hasConnectedBefore: false,
      state: "connecting",
      phoneNumber: null,
      profileName: null,
      qrCode: null,
    };
    try {
      const created = await evolutionRequest<Record<string, unknown>>(
        session,
        "/instance/create",
        {
          method: "POST",
          body: JSON.stringify({
            instanceName,
            integration: "WHATSAPP-BAILEYS",
            qrcode: true,
          }),
        },
      );
      session.qrCode = evolutionQrCode(created);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const status = error instanceof MetaApiError ? error.status : 0;
      if (status !== 409 && !message.includes("already") && !message.includes("exist")) throw error;
    }
    await setEvolutionWebhook(session, req);
    await refreshEvolutionSession(session, true);
    const previousSession = activeEvolutionSession;
    const previousProvider = activeProvider;
    activeEvolutionSession = null;
    activeProvider = "none";
    try {
      await clearConversationHistory("all");
      const encryptedConfig = encryptEvolutionConfig(evolutionConfigPayload(session));
      await db
        .insert(appSettings)
        .values({
          id: 1,
          whatsappEvolutionConfigEncrypted: encryptedConfig,
          whatsappActiveProvider: "evolution",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: {
            whatsappEvolutionConfigEncrypted: encryptedConfig,
            whatsappActiveProvider: "evolution",
            updatedAt: new Date(),
          },
        });
      activeEvolutionSession = session;
      activeProvider = "evolution";
    } catch (error) {
      activeEvolutionSession = previousSession;
      activeProvider = previousProvider;
      throw error;
    }
    res.json(evolutionConnectionResponse(session, true));
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Não foi possível iniciar a conexão via QR Code.";
    logger.warn({ status, message }, "Evolution API connection setup failed");
    res.status(status).json({ error: message });
  }
});

router.post("/evolution/connection/qr", async (_req, res) => {
  const session = activeEvolutionSession;
  if (!session) {
    res.status(400).json({ error: "Configure a conexão via QR Code antes de solicitar um novo código." });
    return;
  }
  const previousProvider = activeProvider;
  const shouldActivateSession = activeProvider !== "evolution" || !session.connected;
  if (shouldActivateSession) activeProvider = "none";
  try {
    await refreshEvolutionSession(session, true);
    if (shouldActivateSession) {
      if (
        !session.connected
        && session.hasConnectedBefore
        && isKnownEvolutionDisconnectedState(session.state)
      ) {
        await clearConversationHistory("all");
        session.hasConnectedBefore = false;
        try {
          await persistEvolutionSession(session);
        } catch (error) {
          logger.warn({ err: error, instanceName: session.instanceName }, "Could not persist confirmed QR disconnection");
        }
      }
      await db
        .update(appSettings)
        .set({ whatsappActiveProvider: "evolution", updatedAt: new Date() })
        .where(eq(appSettings.id, 1));
      activeProvider = "evolution";
    }
    if (session.connected) {
      try {
        await persistEvolutionSession(session);
      } catch (error) {
        logger.warn({ err: error, instanceName: session.instanceName }, "Could not persist WhatsApp profile metadata after QR refresh");
      }
    }
    res.json(evolutionConnectionResponse(session, true));
  } catch (error) {
    if (shouldActivateSession) activeProvider = previousProvider;
    const status = error instanceof MetaApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o QR Code.";
    res.status(status).json({ error: message });
  }
});

router.post("/evolution/profile-name", async (req, res): Promise<void> => {
  const input = UpdateEvolutionProfileNameBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Informe um nome válido para o perfil do WhatsApp." });
    return;
  }

  const session = activeEvolutionSession;
  if (!session || activeProvider !== "evolution" || !session.connected) {
    res.status(400).json({ error: "Conecte o WhatsApp via QR Code antes de alterar o nome do perfil." });
    return;
  }

  const name = input.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "O nome do perfil não pode ficar vazio." });
    return;
  }

  try {
    await evolutionRequest(
      session,
      `/chat/updateProfileName/${encodeURIComponent(session.instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
    );
    session.profileName = name;
    try {
      await persistEvolutionSession(session);
    } catch (error) {
      req.log.warn({ err: error, instanceName: session.instanceName }, "Could not persist the updated WhatsApp profile name");
    }
    res.json(evolutionConnectionResponse(session));
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 502;
    const providerMessage = error instanceof Error ? error.message : "";
    const genericRejection = /recusou o envio com HTTP \d+ sem informar a causa/i.test(providerMessage);
    const message = genericRejection
      ? "Não foi possível atualizar o nome do perfil. Confira o nome e tente novamente."
      : providerMessage || "Não foi possível atualizar o nome do perfil do WhatsApp.";
    req.log.warn({ status, instanceName: session.instanceName }, "WhatsApp profile name update failed");
    res.status(status).json({ error: message });
  }
});

router.delete("/evolution/connection", async (_req, res): Promise<void> => {
  const sessionToDisconnect = activeEvolutionSession;
  const previousProvider = activeProvider;
  const nextProvider = "none";

  // Stop new QR syncs/webhooks from repopulating history while it is cleared.
  activeEvolutionSession = null;
  activeProvider = nextProvider;

  try {
    await Promise.all(
      [...evolutionMessageSyncRequests.values()].map((request) =>
        request.catch(() => undefined),
      ),
    );
    const mediaQuery = db
      .select({ providerPayload: chatMessages.providerPayload })
      .from(chatMessages)
      .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id));
    const qrMediaPayloads = nextProvider === "none"
      ? await mediaQuery
      : await mediaQuery.where(or(
          like(conversations.phoneNumberId, "evolution:%"),
          like(conversations.remoteJid, "%@lid"),
        ));

    await db.transaction(async (tx) => {
      if (nextProvider === "none") {
        const allConversationIds = tx
          .select({ id: conversations.id })
          .from(conversations);
        await tx.delete(chatMessages).where(inArray(chatMessages.conversationId, allConversationIds));
        await tx.delete(conversations);
      } else {
        const qrConversationFilter = or(
          like(conversations.phoneNumberId, "evolution:%"),
          like(conversations.remoteJid, "%@lid"),
        );
        const qrConversationIds = tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(qrConversationFilter);
        await tx.delete(chatMessages).where(inArray(chatMessages.conversationId, qrConversationIds));
        await tx.delete(conversations).where(qrConversationFilter);
      }
      await tx
        .update(appSettings)
        .set({
          whatsappEvolutionConfigEncrypted: null,
          whatsappActiveProvider: nextProvider,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, 1));
    });
    await deleteLocalMediaObjects(qrMediaPayloads.map((row) => row.providerPayload));
    if (sessionToDisconnect) {
      evolutionConversationHistorySyncTimestamps.forEach((_timestamp, key) => {
        if (key.startsWith(`${sessionToDisconnect.instanceName}:`)) {
          evolutionConversationHistorySyncTimestamps.delete(key);
        }
      });
    }
  } catch (error) {
    activeEvolutionSession = sessionToDisconnect;
    activeProvider = previousProvider;
    throw error;
  }

  if (sessionToDisconnect) {
    try {
      await evolutionRequest(
        sessionToDisconnect,
        `/instance/logout/${encodeURIComponent(sessionToDisconnect.instanceName)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      logger.warn(
        { err: error, instanceName: sessionToDisconnect.instanceName },
        "QR Code logout failed after local history and connection cleanup",
      );
    }
  }

  res.json({ success: true });
});

router.post("/connection", async (req, res) => {
  let previousProviderToRestore: typeof activeProvider | null = null;
  try {
    const input = ConnectWhatsAppBody.parse(req.body);
    const phoneNumbers = await loadPhoneNumbers(
      input.accessToken,
      input.businessAccountId,
    );
    if (phoneNumbers.length === 0) {
      throw new MetaApiError(
        "A conta foi encontrada, mas nenhum número de telefone WhatsApp está disponível.",
      );
    }

    const selected =
      (input.phoneNumberId &&
        phoneNumbers.find((phone) => phone.id === input.phoneNumberId)?.id) ??
      phoneNumbers[0].id;
    const selectedPhoneNumber = phoneNumbers.find((phone) => phone.id === selected);
    const currentCloudConnection = activeConnection;
    const previousPhoneNumber = activeProvider === "cloud"
      ? currentCloudConnection?.phoneNumbers.find(
          (phone) => phone.id === currentCloudConnection?.selectedPhoneNumberId,
        )?.displayPhoneNumber
      : activeProvider === "evolution"
        ? activeEvolutionSession?.phoneNumber
        : null;
    const currentDigits = previousPhoneNumber?.replace(/\D/g, "") ?? "";
    const nextDigits = selectedPhoneNumber?.displayPhoneNumber.replace(/\D/g, "") ?? "";
    const numberChanged = activeProvider === "cloud"
      ? activeConnection?.selectedPhoneNumberId !== selected
      : activeProvider === "evolution"
        ? !currentDigits || !nextDigits || currentDigits !== nextDigits
        : false;

    await subscribeWhatsAppBusinessAccount(
      input.accessToken,
      input.businessAccountId,
    );
    if (numberChanged) {
      previousProviderToRestore = activeProvider;
      activeProvider = "none";
      await clearConversationHistory("all");
    }

    const encryptedAccessToken = encryptWhatsAppToken(input.accessToken);
    await db
      .insert(appSettings)
      .values({
        id: 1,
        whatsappAccessTokenEncrypted: encryptedAccessToken,
        whatsappBusinessAccountId: input.businessAccountId,
        whatsappSelectedPhoneNumberId: selected,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.id,
        set: {
          whatsappAccessTokenEncrypted: encryptedAccessToken,
          whatsappBusinessAccountId: input.businessAccountId,
          whatsappSelectedPhoneNumberId: selected,
          updatedAt: new Date(),
        },
      });
    activeConnection = {
      accessToken: input.accessToken,
      businessAccountId: input.businessAccountId,
      phoneNumbers,
      selectedPhoneNumberId: selected,
    };
    activeProvider = "cloud";
    connectionsRestored = true;
    await db.update(appSettings)
      .set({ whatsappActiveProvider: "cloud", updatedAt: new Date() })
      .where(eq(appSettings.id, 1));

    res.json(connectionStatus(req));
  } catch (error) {
    if (previousProviderToRestore) activeProvider = previousProviderToRestore;
    const status = error instanceof MetaApiError ? error.status : 400;
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível conectar à API Oficial.";
    logger.warn({ status, message }, "WhatsApp connection failed");
    res.status(status).json({ error: message });
  }
});

router.delete("/connection", async (_req, res) => {
  const previousConnection = activeConnection;
  const previousProvider = activeProvider;
  const nextProvider = "none";

  activeConnection = null;
  activeProvider = nextProvider;
  try {
    const cloudMediaPayloads = await db
      .select({ providerPayload: chatMessages.providerPayload })
      .from(chatMessages)
      .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id));
    await Promise.all(
      [...evolutionMessageSyncRequests.values()].map((request) =>
        request.catch(() => undefined),
      ),
    );
    await db.transaction(async (tx) => {
      const allConversationIds = tx
        .select({ id: conversations.id })
        .from(conversations);

      await tx
        .delete(chatMessages)
        .where(inArray(chatMessages.conversationId, allConversationIds));
      await tx.delete(conversations);
      await tx
        .update(appSettings)
        .set({
          whatsappAccessTokenEncrypted: null,
          whatsappBusinessAccountId: null,
          whatsappSelectedPhoneNumberId: null,
          whatsappActiveProvider: nextProvider,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, 1));
    });
    await deleteLocalMediaObjects(cloudMediaPayloads.map((row) => row.providerPayload));
  } catch (error) {
    activeConnection = previousConnection;
    activeProvider = previousProvider;
    throw error;
  }
  res.json({ success: true });
});

router.get("/events", (req, res) => {
  res.status(200);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(": connected\n\n");
  eventClients.add(res);

  const cleanup = () => {
    clearInterval(heartbeat);
    eventClients.delete(res);
  };
  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      cleanup();
      return;
    }
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", cleanup);
  res.on("close", cleanup);
});

router.get("/conversations", async (req, res) => {
  try {
    if (activeProvider === "none") {
      res.json(ListConversationsResponse.parse([]));
      return;
    }
    if (activeProvider === "evolution" && !activeEvolutionSession?.connected) {
      res.json(ListConversationsResponse.parse([]));
      return;
    }

    if (activeProvider === "evolution" && activeEvolutionSession?.connected) {
      try {
        await deduplicateEvolutionConversations(activeEvolutionSession);
      } catch (error) {
        logger.warn({ err: error }, "Could not merge duplicate QR Code conversations");
      }
      scheduleEvolutionMessageSync(activeEvolutionSession);
      scheduleEvolutionPinnedChatSync(activeEvolutionSession);
    }

    const activePhoneNumberId = activeProvider === "evolution" && activeEvolutionSession?.connected
      ? `evolution:${activeEvolutionSession.instanceName}`
      : activeProvider === "cloud" && activeConnection
        ? activeConnection.selectedPhoneNumberId
        : null;
    if (!activePhoneNumberId) {
      res.json(ListConversationsResponse.parse([]));
      return;
    }

    const rows = await db
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversations.phoneNumberId, activePhoneNumberId))
      .orderBy(desc(conversations.isPinned), desc(conversations.updatedAt));
    const lidAliases = activeProvider === "evolution"
      ? getCachedEvolutionLidAliases(activeEvolutionSession)
      : new Map<string, string>();
    const latestMessages = rows.length
      ? await db
          .selectDistinctOn(
            [chatMessages.conversationId],
            { conversationId: chatMessages.conversationId, message: chatMessages },
          )
          .from(chatMessages)
          .where(inArray(chatMessages.conversationId, rows.map((row) => row.conversation.id)))
          .orderBy(chatMessages.conversationId, desc(chatMessages.createdAt), desc(chatMessages.id))
      : [];
    const latestMessageByConversationId = new Map(
      latestMessages.map((row) => [row.conversationId, row.message]),
    );
    const result = await Promise.all(
      rows.map((row) => conversationResponse(
        row.conversation,
        row.contact,
        latestMessageByConversationId.get(row.conversation.id) ?? null,
        lidAliases,
      )),
    );
    res.json(ListConversationsResponse.parse(result));
  } catch (error) {
    logger.error({ err: error }, "Failed to list WhatsApp conversations");
    res.status(500).json({ error: "Não foi possível carregar as conversas." });
  }
});

type EvolutionLabel = { id: string; name: string };

class EvolutionLabelSyncError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 502,
  ) {
    super(message);
    this.name = "EvolutionLabelSyncError";
  }
}

function parseEvolutionLabels(payload: unknown): EvolutionLabel[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const rawLabels = [
    payload,
    root.labels,
    root.data,
    data.labels,
    root.response,
  ].find(Array.isArray);
  if (!Array.isArray(rawLabels)) {
    throw new EvolutionLabelSyncError(
      "A conexão QR não retornou a lista de etiquetas do WhatsApp.",
    );
  }
  return rawLabels.flatMap((value): EvolutionLabel[] => {
    const record = asRecord(value);
    const id = stringValue(
      record.labelId ?? record.LabelID ?? record.id ?? record.ID,
    );
    const name = stringValue(
      record.name ?? record.Name ?? record.label ?? record.text,
    ).trim();
    const deleted = record.deleted === true || record.Deleted === true;
    return id && name && !deleted ? [{ id, name }] : [];
  });
}

async function syncEvolutionConversationLabels(
  session: EvolutionSession,
  conversation: typeof conversations.$inferSelect,
  contact: typeof contacts.$inferSelect,
  previousLabels: string[],
  nextLabels: string[],
): Promise<void> {
  const previousSet = new Set(previousLabels.map((label) => label.toLocaleLowerCase("pt-BR")));
  const nextSet = new Set(nextLabels.map((label) => label.toLocaleLowerCase("pt-BR")));
  const changed = previousSet.size !== nextSet.size
    || [...previousSet].some((label) => !nextSet.has(label));
  if (!changed) return;

  const number = evolutionPhoneNumber(evolutionRecipient(contact.phoneNumber, conversation));
  if (!number || isEvolutionLid(number)) {
    throw new EvolutionLabelSyncError(
      "Não foi possível aplicar a etiqueta: a conexão não tem o número real deste contato.",
      409,
    );
  }

  let providerLabels: EvolutionLabel[];
  try {
    const payload = await evolutionRequest<unknown>(
      session,
      `/label/findLabels/${encodeURIComponent(session.instanceName)}`,
      { method: "GET" },
    );
    providerLabels = parseEvolutionLabels(payload);
  } catch (error) {
    if (error instanceof EvolutionLabelSyncError) throw error;
    logger.warn({ err: error, instanceName: session.instanceName }, "Could not read WhatsApp Business labels");
    throw new EvolutionLabelSyncError(
      "Não foi possível consultar as etiquetas do WhatsApp. Nada foi alterado.",
    );
  }

  const byName = new Map(
    providerLabels.map((label) => [label.name.toLocaleLowerCase("pt-BR"), label]),
  );
  const missing = nextLabels.filter(
    (label) => !byName.has(label.toLocaleLowerCase("pt-BR")),
  );
  if (missing.length) {
    throw new EvolutionLabelSyncError(
      `A etiqueta ${missing.map((label) => `“${label}”`).join(", ")} não existe na lista disponível do WhatsApp Business. Crie-a no WhatsApp Business e tente novamente.`,
      409,
    );
  }

  const requestedLabels = nextLabels
    .map((label) => byName.get(label.toLocaleLowerCase("pt-BR")))
    .filter((label): label is EvolutionLabel => Boolean(label));
  const removedLabels = previousLabels
    .filter((label) => !nextSet.has(label.toLocaleLowerCase("pt-BR")))
    .map((label) => byName.get(label.toLocaleLowerCase("pt-BR")))
    .filter((label): label is EvolutionLabel => Boolean(label));
  const operations = [
    ...requestedLabels.map((label) => ({ label, action: "add" as const })),
    ...removedLabels.map((label) => ({ label, action: "remove" as const })),
  ];

  try {
    for (const { label, action } of operations) {
      await evolutionRequest<unknown>(
        session,
        `/label/handleLabel/${encodeURIComponent(session.instanceName)}`,
        {
          method: "POST",
          body: JSON.stringify({
            number,
            labelId: label.id,
            action,
          }),
        },
      );
    }
  } catch (error) {
    logger.warn({ err: error, instanceName: session.instanceName }, "Could not apply WhatsApp label to chat");
    throw new EvolutionLabelSyncError(
      "A conexão QR não conseguiu atualizar a etiqueta no WhatsApp. As etiquetas do Antiban não foram alteradas.",
    );
  }
}

router.patch("/conversations/:conversationId/metadata", async (req, res): Promise<void> => {
  const conversationId = Number(req.params.conversationId);
  if (!Number.isSafeInteger(conversationId) || conversationId < 1) {
    res.status(400).json({ error: "Conversa inválida." });
    return;
  }
  const body = asRecord(req.body);
  if (!Array.isArray(body.labels) || typeof body.archived !== "boolean" || typeof body.pinned !== "boolean") {
    res.status(400).json({ error: "Informe as etiquetas e os estados de arquivamento e fixação." });
    return;
  }
  const labels: string[] = [];
  const seenLabels = new Set<string>();
  for (const value of body.labels) {
    if (typeof value !== "string") {
      res.status(400).json({ error: "As etiquetas informadas são inválidas." });
      return;
    }
    const label = value.trim().replace(/\s+/g, " ");
    const normalized = label.toLocaleLowerCase("pt-BR");
    if (!label || label.length > 32 || seenLabels.has(normalized)) continue;
    seenLabels.add(normalized);
    labels.push(label);
    if (labels.length > 12) {
      res.status(400).json({ error: "Cada conversa pode ter até 12 etiquetas." });
      return;
    }
  }
  const [existing] = await db
    .select({ conversation: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Conversa não encontrada." });
    return;
  }
  const previousLabels = Array.isArray(existing.conversation.labels)
    ? existing.conversation.labels
    : [];
  const previousLabelSet = new Set(previousLabels.map((label) => label.toLocaleLowerCase("pt-BR")));
  const nextLabelSet = new Set(labels.map((label) => label.toLocaleLowerCase("pt-BR")));
  const labelsChanged = previousLabelSet.size !== nextLabelSet.size
    || [...previousLabelSet].some((label) => !nextLabelSet.has(label));
  let labelsSync: "local" | "unchanged" | "requested" = "local";
  let labelSyncNotice: string | undefined;
  if (activeProvider === "evolution" && activeEvolutionSession?.connected) {
    try {
      await syncEvolutionConversationLabels(
        activeEvolutionSession,
        existing.conversation,
        existing.contact,
        previousLabels,
        labels,
      );
      labelsSync = labelsChanged ? "requested" : "unchanged";
      if (labelsChanged) {
        labelSyncNotice = "Pedido enviado pela conexão QR. A Evolution não confirma se a etiqueta já apareceu no aplicativo WhatsApp.";
      }
    } catch (error) {
      if (error instanceof EvolutionLabelSyncError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      logger.error({ err: error, conversationId }, "Could not synchronize WhatsApp labels");
      res.status(502).json({ error: "Não foi possível sincronizar as etiquetas com o WhatsApp." });
      return;
    }
  } else if (labelsChanged) {
    labelSyncNotice = activeProvider === "cloud"
      ? "Etiqueta salva apenas no Antiban; a API oficial não oferece sincronização de etiquetas do chat."
      : "Etiqueta salva apenas no Antiban porque não há uma conexão WhatsApp ativa.";
  }
  const archivedAt = body.archived ? new Date() : null;
  const isPinned = body.pinned;
  await db
    .update(conversations)
    .set({ labels, archivedAt, isPinned })
    .where(eq(conversations.id, conversationId));
  res.json({
    success: true,
    labels,
    archivedAt: archivedAt?.toISOString() ?? null,
    isPinned,
    labelsSync,
    ...(labelSyncNotice ? { labelSyncNotice } : {}),
  });
});

router.get("/conversations/:conversationId/contact-profile", async (req, res): Promise<void> => {
  try {
    const params = GetConversationContactProfileParams.parse(req.params);
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);
    if (!conversation) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, conversation.contactId))
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "Contato não encontrado." });
      return;
    }

    const session = activeEvolutionSession;
    if (activeProvider !== "evolution" || !session?.connected) {
      res.status(503).json({ error: "A conexão via QR Code não está ativa." });
      return;
    }

    const rawWhatsappId =
      conversation.remoteJid
      || (contact.phoneNumber.includes("@")
        ? contact.phoneNumber
        : `${normalizePhone(contact.phoneNumber)}@s.whatsapp.net`);
    let resolvedPhone: string | null = null;
    if (isEvolutionLid(rawWhatsappId)) {
      const aliases = await loadEvolutionLidAliases(session);
      resolvedPhone = evolutionPhoneFromAlternateJid(aliases.get(rawWhatsappId) ?? "");
      const contactDigits = normalizePhone(contact.phoneNumber);
      const lidDigits = normalizePhone(rawWhatsappId.split("@")[0]);
      if (!resolvedPhone && /^\d{8,15}$/.test(contactDigits) && contactDigits !== lidDigits) {
        resolvedPhone = contactDigits;
      }
    }
    const whatsappId = resolvedPhone
      ? `${resolvedPhone}@s.whatsapp.net`
      : rawWhatsappId;
    const instance = encodeURIComponent(session.instanceName);
    const pictureRequest = getEvolutionPictureUrl(session, whatsappId);
    const profileRequest = conversation.conversationType === "group"
      ? Promise.resolve<Record<string, unknown>>({})
      : evolutionRequest<Record<string, unknown>>(
          session,
          `/chat/fetchProfile/${instance}`,
          { method: "POST", body: JSON.stringify({ number: whatsappId }) },
        );
    const [pictureResult, profileResult] = await Promise.allSettled([
      pictureRequest,
      profileRequest,
    ]);

    if (pictureResult.status === "rejected" && profileResult.status === "rejected") {
      throw pictureResult.reason;
    }

    const profileRoot = profileResult.status === "fulfilled" ? profileResult.value : {};
    const profileData = asRecord(profileRoot.data);
    const records = [
      profileRoot,
      profileData,
      asRecord(profileRoot.profile),
      asRecord(profileRoot.businessProfile),
      asRecord(profileData.profile),
      asRecord(profileData.businessProfile),
      asRecord(profileRoot.business),
      asRecord(profileData.business),
    ];
    const profileValueText = (value: unknown): string | null => {
      if (typeof value === "string") return value.trim() || null;
      if (typeof value === "number") return String(value);
      if (Array.isArray(value)) {
        const parts = value.map(profileValueText).filter((part): part is string => Boolean(part));
        return parts.length ? parts.join(", ") : null;
      }
      if (typeof value === "object" && value !== null) {
        const record = asRecord(value);
        for (const key of ["localized_display_name", "displayName", "name", "label", "text", "value"]) {
          const preferred = profileValueText(record[key]);
          if (preferred) return preferred;
        }
        const parts = Object.entries(record)
          .map(([key, nested]) => {
            const text = profileValueText(nested);
            return text ? `${key}: ${text}` : null;
          })
          .filter((part): part is string => Boolean(part));
        return parts.length ? parts.join("\n") : null;
      }
      return null;
    };
    const firstText = (sources: Record<string, unknown>[], keys: string[]): string | null => {
      for (const source of sources) {
        for (const key of keys) {
          const text = profileValueText(source[key]);
          if (text) return text;
        }
      }
      return null;
    };
    const firstBoolean = (keys: string[]): boolean | null => {
      for (const source of records) {
        for (const key of keys) {
          const value = source[key];
          if (typeof value === "boolean") return value;
          if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
            return value.trim().toLowerCase() === "true";
          }
        }
      }
      return null;
    };
    const fallbackPictureUrl = safeWhatsAppPictureUrl(firstText(
      records,
      ["profilePictureUrl", "profile_picture_url", "pictureUrl", "picture", "profilePicUrl"],
    ));
    const pictureUrl = pictureResult.status === "fulfilled" && pictureResult.value
      ? pictureResult.value
      : fallbackPictureUrl;
    if (pictureUrl && (pictureResult.status === "rejected" || !pictureResult.value)) {
      evolutionProfilePictureUrlCache.set(`${session.instanceName}:${whatsappId}`, {
        url: pictureUrl,
        expiresAt: Date.now() + profilePictureUrlCacheMs,
      });
    }
    const safePictureUrl = pictureUrl ? evolutionProfilePicturePath(whatsappId) : null;

    const addressValue = records
      .map((record) => record.businessAddress ?? record.business_address ?? record.address)
      .find((value) => value !== undefined && value !== null);
    const businessAddress = typeof addressValue === "string"
      ? addressValue.trim() || null
      : (() => {
          const address = asRecord(addressValue);
          const parts = ["street", "number", "city", "state", "zip", "country"]
            .map((key) => stringValue(address[key]).trim())
            .filter(Boolean);
          return parts.length ? parts.join(", ") : null;
        })();
    const website = firstText(records, ["businessWebsite", "business_website", "website", "websites"]);
    let safeWebsite: string | null = null;
    if (website) {
      try {
        const parsedUrl = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
        if (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") {
          safeWebsite = parsedUrl.toString();
        }
      } catch {
        safeWebsite = null;
      }
    }

    const response = {
      profileName: firstText(records, ["profileName", "profile_name", "pushName", "push_name", "name"]),
      profilePictureUrl: safePictureUrl,
      whatsappId: isEvolutionLid(whatsappId) ? null : whatsappId,
      about: firstText(records, ["about", "statusText", "status_text", "status", "profileStatus", "profile_status"]),
      verifiedName: firstText(records, ["verifiedName", "verified_name", "businessName", "business_name"]),
      isBusiness: firstBoolean(["isBusiness", "is_business"]),
      numberExists: firstBoolean(["numberExists", "number_exists", "exists", "isOnWhatsApp", "is_on_whatsapp"]),
      businessDescription: firstText(records, ["businessDescription", "business_description", "description"]),
      businessEmail: firstText(records, ["businessEmail", "business_email", "email"]),
      businessWebsite: safeWebsite,
      businessAddress,
      businessCategory: firstText(records, ["businessCategory", "business_category", "categories", "category", "industry"]),
      businessHours: firstText(records, ["businessHours", "business_hours", "hours"]),
      fetchedAt: new Date().toISOString(),
    };
    res.json(GetConversationContactProfileResponse.parse(response));
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 502;
    const message = error instanceof Error
      ? error.message
      : "Não foi possível consultar o perfil pela conexão via QR Code.";
    req.log.warn({ err: error }, "Failed to fetch WhatsApp contact profile from Evolution");
    res.status(status).json({ error: message });
  }
});

router.delete("/conversations/:conversationId", async (req, res) => {
  try {
    const conversationId = Number(req.params.conversationId);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }

    const mediaPayloads = await db
      .select({ providerPayload: chatMessages.providerPayload })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId));
    const deleted = await db
      .delete(conversations)
      .where(eq(conversations.id, conversationId))
      .returning({ id: conversations.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }

    await deleteLocalMediaObjects(mediaPayloads.map((row) => row.providerPayload));
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Failed to delete WhatsApp conversation");
    res.status(500).json({ error: "Não foi possível apagar a conversa." });
  }
});

router.get("/conversations/:conversationId/messages", async (req, res) => {
  try {
    const params = ListConversationMessagesParams.parse(req.params);
    const [row] = await db
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversations.id, params.conversationId))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }

    const { conversation, contact } = row;

    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversation.id))
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
    await db
      .update(conversations)
      .set({ unreadCount: 0 })
      .where(eq(conversations.id, conversation.id));
    res.json(
      ListConversationMessagesResponse.parse(
        messages.map((message) => messageResponse(message, conversation.id)),
      ),
    );
    if (activeProvider === "evolution" && activeEvolutionSession?.connected) {
      scheduleEvolutionConversationHistorySync(
        activeEvolutionSession,
        conversation,
        contact.name,
      );
    }
  } catch (error) {
    logger.error({ err: error }, "Failed to list WhatsApp messages");
    res.status(400).json({ error: "Não foi possível carregar as mensagens." });
  }
});

router.get(
  "/conversations/:conversationId/messages/:messageId/media",
  async (req, res) => {
    try {
      const conversationId = Number(req.params.conversationId);
      const messageId = Number(req.params.messageId);
      if (!Number.isInteger(conversationId) || !Number.isInteger(messageId)) {
        res.status(404).json({ error: "Mídia não encontrada." });
        return;
      }
      const [message] = await db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.id, messageId),
            eq(chatMessages.conversationId, conversationId),
          ),
        )
        .limit(1);
      const payload = asRecord(message?.providerPayload);
      if (!message || !Object.keys(payload).length) {
        res.status(404).json({ error: "A mídia desta mensagem não está disponível." });
        return;
      }
      const session = activeEvolutionSession;
      if (!session?.connected) {
        res.status(503).json({ error: "Conecte o WhatsApp via QR Code para carregar esta mídia." });
        return;
      }
      const mediaResponse = await evolutionRequest<Record<string, unknown>>(
        session,
        `/chat/getBase64FromMediaMessage/${encodeURIComponent(session.instanceName)}`,
        {
          method: "POST",
          body: JSON.stringify({ message: payload, convertToMp4: false }),
        },
        60_000,
      );
      const mediaData = asRecord(mediaResponse.data);
      const encoded =
        stringValue(mediaResponse.base64)
        || stringValue(mediaData.base64)
        || stringValue(mediaResponse.mediaBase64)
        || stringValue(mediaData.mediaBase64);
      const base64 = encoded.replace(/^data:[^,]*;base64,/i, "").replace(/\s/g, "");
      if (!base64) {
        res.status(502).json({ error: "O serviço de conexão via QR Code não retornou o conteúdo da mídia." });
        return;
      }
      if (base64.length > Math.ceil(evolutionMediaMaxBytes * 4 / 3) + 16) {
        res.status(502).json({ error: "A mídia é grande demais para ser exibida nesta conversa." });
        return;
      }
      const bytes = Buffer.from(base64, "base64");
      if (!bytes.length) {
        res.status(502).json({ error: "O arquivo retornado pela conexão via QR Code está vazio." });
        return;
      }
      if (bytes.length > evolutionMediaMaxBytes) {
        res.status(502).json({ error: "A mídia é grande demais para ser exibida nesta conversa." });
        return;
      }
      const requestedMimeType =
        stringValue(mediaResponse.mimetype)
        || stringValue(mediaData.mimetype)
        || message.mediaMimeType
        || "application/octet-stream";
      const mimeTypeCandidate = requestedMimeType.split(";")[0]?.trim().toLowerCase() ?? "";
      const mimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeTypeCandidate)
        ? mimeTypeCandidate
        : "application/octet-stream";
      const fileName =
        stringValue(mediaResponse.fileName)
        || stringValue(mediaData.fileName)
        || message.mediaFileName
        || "arquivo";
      const safeFileName = fileName.replace(/[\r\n"]/g, "_");
      const asciiFileName = safeFileName.replace(/[^\x20-\x7e]/g, "_");
      const inline = /^(image|audio|video)\//i.test(mimeType) || mimeType === "application/pdf";
      res.setHeader("Content-Type", mimeType);
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.setHeader("Content-Length", bytes.length);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(bytes);
    } catch (error) {
      const status = error instanceof MetaApiError ? error.status : 502;
      logger.warn({ err: error, conversationId: req.params.conversationId, messageId: req.params.messageId }, "Evolution media retrieval failed");
      res.status(status).json({ error: "Não foi possível carregar a mídia do WhatsApp." });
    }
  },
);

router.post(
  "/conversations/:conversationId/messages/:messageId/reaction",
  async (req, res) => {
    try {
      const conversationId = Number(req.params.conversationId);
      const messageId = Number(req.params.messageId);
      if (!Number.isInteger(conversationId) || !Number.isInteger(messageId)) {
        res.status(404).json({ error: "Mensagem não encontrada." });
        return;
      }
      const { emoji } = SendConversationMessageReactionBody.parse(req.body);
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      const [target] = await db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.id, messageId),
            eq(chatMessages.conversationId, conversationId),
          ),
        )
        .limit(1);
      const session = activeEvolutionSession;
      if (!conversation || !target) {
        res.status(404).json({ error: "Mensagem não encontrada." });
        return;
      }
      if (activeProvider !== "evolution" || !session?.connected) {
        res.status(400).json({ error: "Reações estão disponíveis enquanto a conexão via QR Code estiver ativa." });
        return;
      }
      if (target.messageType === "reaction") {
        res.status(400).json({ error: "Não é possível reagir a outra reação." });
        return;
      }
      const [contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, conversation.contactId))
        .limit(1);
      const storedPayload = asRecord(target.providerPayload);
      const storedKey = asRecord(storedPayload.key);
      const rawMessageId = target.whatsappMessageId?.split(":").slice(2).join(":") || "";
      const remoteJid =
        stringValue(storedKey.remoteJid)
        || conversation.remoteJid
        || (contact?.phoneNumber.endsWith("@g.us")
          ? contact.phoneNumber
          : `${contact?.phoneNumber ?? ""}@s.whatsapp.net`);
      const reactionKey = {
        ...storedKey,
        remoteJid,
        id: stringValue(storedKey.id) || rawMessageId,
        fromMe: typeof storedKey.fromMe === "boolean"
          ? storedKey.fromMe
          : target.direction === "outbound",
      };
      if (!reactionKey.id || !reactionKey.remoteJid) {
        res.status(400).json({ error: "A conexão via QR Code não possui os dados necessários para reagir a esta mensagem." });
        return;
      }

      const response = await evolutionRequest<Record<string, unknown>>(
        session,
        `/message/sendReaction/${encodeURIComponent(session.instanceName)}`,
        {
          method: "POST",
          body: JSON.stringify({ key: reactionKey, reaction: emoji }),
        },
      );
      await db
        .delete(chatMessages)
        .where(
          and(
            eq(chatMessages.conversationId, conversation.id),
            eq(chatMessages.replyToMessageId, target.id),
            eq(chatMessages.direction, "outbound"),
            eq(chatMessages.messageType, "reaction"),
          ),
        );
      const responseKey = asRecord(asRecord(response.data).key);
      const topKey = asRecord(response.key);
      const reactionRawId = stringValue(responseKey.id) || stringValue(topKey.id);
      const reactionMessage = {
        key: responseKey,
        message: asRecord(response.data).message,
        messageTimestamp: Math.floor(Date.now() / 1000),
      };
      const [reaction] = await db
        .insert(chatMessages)
        .values({
          conversationId: conversation.id,
          whatsappMessageId: reactionRawId
            ? `evolution:${session.instanceName}:${reactionRawId}`
            : null,
          direction: "outbound",
          messageType: "reaction",
          content: emoji,
          reactionEmoji: emoji || null,
          replyToMessageId: target.id,
          providerPayload: reactionMessage,
          status: "sent",
        })
        .returning();
      publishConversationEvent({ conversationId: conversation.id, reason: "message" });
      res.json(messageResponse(reaction, conversation.id));
    } catch (error) {
      const status = error instanceof MetaApiError ? error.status : 400;
      logger.warn({ err: error, conversationId: req.params.conversationId, messageId: req.params.messageId }, "Evolution message reaction failed");
      res.status(status).json({ error: error instanceof Error ? error.message : "Falha ao reagir à mensagem." });
    }
  },
);

router.post("/conversations/:conversationId/messages", async (req, res) => {
  try {
    const params = SendConversationMessageParams.parse(req.params);
    const { content } = SendConversationMessageBody.parse(req.body);

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);
    if (!conversation) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }

    let message;
    if (activeProvider === "evolution") {
      if (!activeEvolutionSession?.connected) {
        res.status(400).json({ error: "A conexão via QR Code não está ativa. Leia o código novamente." });
        return;
      }
      message = await storeOutboundEvolutionMessage(conversation, content.trim(), activeEvolutionSession);
    } else if (activeProvider === "cloud" && activeConnection) {
      message = await storeOutboundMessage(conversation, content.trim(), activeConnection);
    } else {
      res.status(400).json({ error: "Conecte a API oficial ou configure uma conexão via QR Code antes de enviar mensagens." });
      return;
    }
    res.status(201).json(messageResponse(message, conversation.id));
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Falha ao enviar mensagem.";
    logger.warn({ status, message }, "WhatsApp message send failed");
    res.status(status).json({ error: message });
  }
});

router.post(
  "/conversations/:conversationId/media",
  mediaUpload.single("file"),
  async (req, res) => {
    try {
      const params = SendConversationMessageParams.parse(req.params);
      if (!req.file) {
        res.status(400).json({ error: "Selecione um arquivo para enviar." });
        return;
      }

      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, params.conversationId))
        .limit(1);
      if (!conversation) {
        res.status(404).json({ error: "Conversa não encontrada." });
        return;
      }

      const caption = typeof req.body?.caption === "string" ? req.body.caption.trim() : "";
      let message;
      if (activeProvider === "evolution") {
        if (!activeEvolutionSession?.connected) {
          res.status(400).json({ error: "A conexão via QR Code não está ativa. Leia o código novamente." });
          return;
        }
        message = await storeOutboundEvolutionMediaMessage(conversation, req.file, caption, activeEvolutionSession);
      } else if (activeProvider === "cloud" && activeConnection) {
        message = await storeOutboundMediaMessage(conversation, req.file, caption, activeConnection);
      } else {
        res.status(400).json({ error: "Conecte a API oficial ou configure uma conexão via QR Code antes de enviar arquivos." });
        return;
      }
      res.status(201).json(messageResponse(message, conversation.id));
    } catch (error) {
      const status = error instanceof MetaApiError ? error.status : 400;
      const message = error instanceof Error ? error.message : "Falha ao enviar arquivo.";
      logger.warn({ status, message }, "WhatsApp media send failed");
      res.status(status).json({ error: message });
    }
  },
);

router.get("/saved-replies", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(savedReplies)
      .orderBy(asc(savedReplies.createdAt), asc(savedReplies.id));
    res.json(ListSavedRepliesResponse.parse(rows.map(savedReplyResponse)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list saved chat highlights");
    res.status(500).json({ error: "Não foi possível carregar os destaques." });
  }
});

router.post("/saved-replies", async (req, res): Promise<void> => {
  let uploadedObjectPath: string | null = null;
  try {
    const input = CreateSavedReplyBody.parse(req.body);
    const title = input.title.trim();
    if (!title) {
      res.status(400).json({ error: "Informe um nome para o destaque." });
      return;
    }

    let content: string | null = null;
    let objectPath: string | null = null;
    let mediaMimeType: string | null = null;
    let mediaFileName: string | null = null;
    let sizeBytes: number | null = null;

    if (input.kind === "text") {
      content = input.content?.trim() || null;
      if (!content) {
        res.status(400).json({ error: "Escreva a mensagem que será salva." });
        return;
      }
    } else {
      objectPath = input.objectPath?.trim() || null;
      uploadedObjectPath = objectPath;
      if (
        !objectPath
        || !/^\/objects\/uploads\/[A-Za-z0-9-]+$/.test(objectPath)
        || !input.mediaMimeType
        || !input.mediaFileName
        || !input.sizeBytes
      ) {
        res.status(400).json({ error: "Envie um arquivo válido para salvar o destaque." });
        return;
      }
      if (input.sizeBytes > 25 * 1024 * 1024) {
        res.status(400).json({ error: "O arquivo deve ter até 25 MB." });
        return;
      }
      const file = await objectStorage.getObjectEntityFile(objectPath);
      const [metadata] = await file.getMetadata();
      const actualSize = Number(metadata.size);
      const storedMimeType = String(metadata.contentType || input.mediaMimeType);
      if (!Number.isFinite(actualSize) || actualSize !== input.sizeBytes) {
        res.status(400).json({ error: "O arquivo carregado não corresponde aos dados enviados." });
        return;
      }
      if (mediaMessageType(input.mediaMimeType) !== input.kind) {
        res.status(400).json({ error: "O formato do arquivo não corresponde ao tipo do destaque." });
        return;
      }
      if (input.kind === "audio") {
        if (actualSize > 16 * 1024 * 1024) {
          res.status(400).json({ error: "O áudio deve ter até 16 MB." });
          return;
        }
        const [audioBuffer] = await file.download();
        if (!isOggOpus(audioBuffer)) {
          res.status(400).json({ error: "Para enviar como nota de voz, use um arquivo OGG/Opus." });
          return;
        }
      }
      mediaMimeType = input.kind === "audio" ? "audio/ogg" : storedMimeType;
      mediaFileName = input.mediaFileName.slice(0, 255);
      sizeBytes = actualSize;
    }

    const [created] = await db
      .insert(savedReplies)
      .values({
        title,
        kind: input.kind,
        content,
        objectPath,
        mediaMimeType,
        mediaFileName,
        sizeBytes,
        updatedAt: new Date(),
      })
      .returning();
    uploadedObjectPath = null;
    res.status(201).json(CreateSavedReplyResponse.parse(savedReplyResponse(created)));
  } catch (error) {
    if (uploadedObjectPath) {
      try {
        await objectStorage.deleteObjectEntityFile(uploadedObjectPath);
      } catch {
        // Keep the original validation or database error for the caller.
      }
    }
    const status = error instanceof MetaApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Não foi possível salvar o destaque.";
    req.log.warn({ err: error }, "Failed to save chat highlight");
    res.status(status).json({ error: message });
  }
});

router.patch("/saved-replies/:savedReplyId", async (req, res): Promise<void> => {
  try {
    const params = UpdateSavedReplyParams.parse(req.params);
    const input = UpdateSavedReplyBody.parse(req.body);
    const [existing] = await db
      .select()
      .from(savedReplies)
      .where(eq(savedReplies.id, params.savedReplyId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Destaque não encontrado." });
      return;
    }
    const title = input.title.trim();
    const content = existing.kind === "text" && input.content !== undefined
      ? input.content.trim()
      : existing.content;
    if (!title || (existing.kind === "text" && !content)) {
      res.status(400).json({ error: "O nome e o conteúdo do destaque não podem ficar vazios." });
      return;
    }
    const [updated] = await db
      .update(savedReplies)
      .set({ title, content, updatedAt: new Date() })
      .where(eq(savedReplies.id, params.savedReplyId))
      .returning();
    res.json(UpdateSavedReplyResponse.parse(savedReplyResponse(updated)));
  } catch (error) {
    req.log.warn({ err: error }, "Failed to update chat highlight");
    res.status(400).json({
      error: error instanceof Error ? error.message : "Não foi possível atualizar o destaque.",
    });
  }
});

router.delete("/saved-replies/:savedReplyId", async (req, res): Promise<void> => {
  try {
    const params = DeleteSavedReplyParams.parse(req.params);
    const [deleted] = await db
      .delete(savedReplies)
      .where(eq(savedReplies.id, params.savedReplyId))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Destaque não encontrado." });
      return;
    }
    if (deleted.objectPath) {
      try {
        await objectStorage.deleteObjectEntityFile(deleted.objectPath);
      } catch (error) {
        req.log.warn({ err: error, objectPath: deleted.objectPath }, "Could not remove deleted highlight media");
      }
    }
    res.json(DeleteSavedReplyResponse.parse({ success: true }));
  } catch (error) {
    req.log.warn({ err: error }, "Failed to delete chat highlight");
    res.status(400).json({ error: "Não foi possível remover o destaque." });
  }
});

router.post(
  "/conversations/:conversationId/saved-replies/:savedReplyId/send",
  async (req, res): Promise<void> => {
    let historyObjectPath: string | undefined;
    try {
      const params = SendSavedReplyParams.parse(req.params);
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, params.conversationId))
        .limit(1);
      const [reply] = await db
        .select()
        .from(savedReplies)
        .where(eq(savedReplies.id, params.savedReplyId))
        .limit(1);
      if (!conversation || !reply) {
        res.status(404).json({ error: "Conversa ou destaque não encontrado." });
        return;
      }

      let message;
      if (reply.kind === "text") {
        if (activeProvider === "evolution" && activeEvolutionSession?.connected) {
          message = await storeOutboundEvolutionMessage(
            conversation,
            reply.content ?? "",
            activeEvolutionSession,
          );
        } else if (activeProvider === "cloud" && activeConnection) {
          message = await storeOutboundMessage(conversation, reply.content ?? "", activeConnection);
        } else {
          res.status(400).json({ error: "Conecte o WhatsApp antes de enviar um destaque." });
          return;
        }
      } else {
        if (activeProvider === "evolution" && !activeEvolutionSession?.connected) {
          res.status(400).json({ error: "A conexão via QR Code não está ativa. Leia o código novamente." });
          return;
        }
        if (activeProvider !== "evolution" && !(activeProvider === "cloud" && activeConnection)) {
          res.status(400).json({ error: "Conecte o WhatsApp antes de enviar um destaque." });
          return;
        }
        if (!reply.objectPath || !reply.mediaMimeType || !reply.mediaFileName) {
          res.status(400).json({ error: "O arquivo deste destaque não está disponível." });
          return;
        }
        const sourceFile = await objectStorage.getObjectEntityFile(reply.objectPath);
        const [buffer] = await sourceFile.download();
        if (reply.kind === "audio" && !isOggOpus(buffer)) {
          res.status(400).json({ error: "A nota de voz não está mais em formato OGG/Opus." });
          return;
        }
        historyObjectPath = await objectStorage.copyObjectEntityFile(reply.objectPath);
        const mediaFile = {
          fieldname: "file",
          originalname: reply.mediaFileName,
          encoding: "7bit",
          mimetype: reply.mediaMimeType,
          size: buffer.length,
          stream: Readable.from(buffer),
          destination: "",
          filename: reply.mediaFileName,
          path: "",
          buffer,
        } satisfies Express.Multer.File;
        const asVoiceNote = reply.kind === "audio";
        if (activeProvider === "evolution" && activeEvolutionSession) {
          message = await storeOutboundEvolutionMediaMessage(
            conversation,
            mediaFile,
            "",
            activeEvolutionSession,
            asVoiceNote,
            historyObjectPath,
          );
        } else if (activeProvider === "cloud" && activeConnection) {
          message = await storeOutboundMediaMessage(
            conversation,
            mediaFile,
            "",
            activeConnection,
            asVoiceNote,
            historyObjectPath,
          );
        } else {
          res.status(400).json({ error: "Conecte o WhatsApp antes de enviar um destaque." });
          return;
        }
        historyObjectPath = undefined;
      }
      res.status(201).json(SendSavedReplyResponse.parse(messageResponse(message, conversation.id)));
    } catch (error) {
      if (historyObjectPath) {
        try {
          await objectStorage.deleteObjectEntityFile(historyObjectPath);
        } catch (cleanupError) {
          req.log.warn({ err: cleanupError, historyObjectPath }, "Could not remove unsent chat media copy");
        }
      }
      const status = error instanceof MetaApiError ? error.status : 502;
      const message = error instanceof Error ? error.message : "Não foi possível enviar o destaque.";
      req.log.warn({ err: error, conversationId: req.params.conversationId }, "Saved chat highlight send failed");
      res.status(status).json({ error: message });
    }
  },
);

router.post("/conversations/start", async (req, res) => {
  try {
    const input = StartConversationBody.parse(req.body);
    const usingEvolution = activeProvider === "evolution";
    if (usingEvolution && !activeEvolutionSession?.connected) {
      res.status(400).json({ error: "A conexão via QR Code não está ativa. Leia o código novamente." });
      return;
    }
    if (!usingEvolution && (activeProvider !== "cloud" || !activeConnection)) {
      res.status(400).json({ error: "Conecte a API oficial ou configure uma conexão via QR Code antes de iniciar conversas." });
      return;
    }
    if (!input.content?.trim() && !input.templateId) {
      res.status(400).json({
        error: "Para iniciar conversa com um novo contato, selecione um template aprovado pela Meta.",
      });
      return;
    }
    if (usingEvolution && input.templateId) {
      res.status(400).json({ error: "Templates aprovados só podem ser enviados pela conexão da API Oficial da Meta." });
      return;
    }

    const phoneNumber = normalizePhone(input.phoneNumber);
    if (phoneNumber.length < 8) {
      res.status(400).json({ error: "Informe um telefone válido com DDI." });
      return;
    }
    const contact = await getOrCreateContact(input.phoneNumber);
    const conversation = await getOrCreateConversation(
      contact.id,
      usingEvolution ? "unknown" : activeConnection!.selectedPhoneNumberId,
    );
    let message;
    if (input.templateId) {
      const [template] = await db
        .select()
        .from(whatsappTemplates)
        .where(eq(whatsappTemplates.id, input.templateId))
        .limit(1);
      if (!template) {
        res.status(404).json({ error: "Template não encontrado." });
        return;
      }
      if (template.status.toUpperCase() !== "APPROVED") {
        res.status(400).json({
          error: "O template selecionado ainda não foi aprovado pela Meta.",
        });
        return;
      }
      message = await storeOutboundTemplateMessage(
        conversation,
        template,
        input.variables ?? [],
        (input.componentParameters ?? []) as ComponentParameterInput[],
        activeConnection!,
      );
    } else {
      message = usingEvolution
        ? await storeOutboundEvolutionMessage(conversation, input.content!.trim(), activeEvolutionSession!)
        : await storeOutboundMessage(conversation, input.content!.trim(), activeConnection!);
    }
    const currentConversation =
      (await conversationResponse(conversation, contact)) ?? conversation;
    res.status(201).json(
      StartConversationResponse.parse({
        conversation: currentConversation,
        message: messageResponse(message),
      }),
    );
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Falha ao iniciar conversa.";
    logger.warn({ status, message }, "New WhatsApp conversation failed");
    res.status(status).json({ error: message });
  }
});

router.get("/contacts", async (_req, res) => {
  try {
    const savedContacts = await db
      .select()
      .from(contacts)
      .where(isNull(contacts.deletedAt))
      .orderBy(asc(contacts.name), asc(contacts.phoneNumber));
    const linkedConversations = await db
      .select({
        contactId: conversations.contactId,
        phoneNumber: contacts.phoneNumber,
        remoteJid: conversations.remoteJid,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id));
    const lidIdentifiers = new Set(
      linkedConversations
        .filter((row) => isEvolutionLid(row.remoteJid))
        .map((row) => normalizePhone(stringValue(row.remoteJid).split("@")[0])),
    );
    res.json(ListContactsResponse.parse(savedContacts
      .filter((contact) => (
        /^\d{8,15}$/.test(normalizePhone(contact.phoneNumber))
        && !lidIdentifiers.has(normalizePhone(contact.phoneNumber))
      ))
      .map((contact) => ({
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      }))));
  } catch (error) {
    logger.error({ err: error }, "Failed to list WhatsApp leads");
    res.status(500).json({ error: "Não foi possível carregar os leads." });
  }
});

router.post("/contacts/import", async (req, res) => {
  try {
    const input = ImportContactsBody.parse(req.body);
    const summary = {
      createdCount: 0,
      updatedCount: 0,
      rejectedCount: 0,
      errors: [] as Array<{ rowNumber: number; reason: string }>,
    };
    const seenPhones = new Set<string>();

    for (const row of input.contacts) {
      const name = row.name.trim();
      const phoneNumber = normalizePhone(row.phoneNumber);
      const phoneKey = phoneNumber.startsWith("55") && phoneNumber.length >= 12
        ? phoneNumber.slice(2)
        : phoneNumber;
      let reason: string | null = null;

      if (!name) {
        reason = "Informe o nome do contato.";
      } else if (name.length > 160) {
        reason = "O nome deve ter no máximo 160 caracteres.";
      } else if (phoneNumber.length < 8 || phoneNumber.length > 15) {
        reason = "Informe um telefone válido com DDI.";
      } else if (seenPhones.has(phoneKey)) {
        reason = "Telefone duplicado no arquivo; a primeira ocorrência foi mantida.";
      }

      if (reason) {
        summary.rejectedCount += 1;
        summary.errors.push({ rowNumber: row.rowNumber, reason });
        continue;
      }
      seenPhones.add(phoneKey);

      try {
        const existing = await findContactByPhone(row.phoneNumber);
        const contact = await getOrCreateContact(row.phoneNumber, name);
        await restoreContactInAddressBook(contact.id);
        if (existing) summary.updatedCount += 1;
        else summary.createdCount += 1;
      } catch (error) {
        summary.rejectedCount += 1;
        summary.errors.push({
          rowNumber: row.rowNumber,
          reason: "Não foi possível salvar este contato.",
        });
        logger.warn(
          { err: error, rowNumber: row.rowNumber },
          "WhatsApp contact import row failed",
        );
      }
    }

    res.json(ImportContactsResponse.parse(summary));
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Arquivo de contatos inválido.";
    logger.warn({ message }, "WhatsApp contacts import failed");
    res.status(400).json({ error: "A lista de contatos enviada é inválida." });
  }
});

router.post("/contacts", async (req, res) => {
  try {
    const input = CreateContactBody.parse(req.body);
    const phoneNumber = normalizePhone(input.phoneNumber);
    if (phoneNumber.length < 8) {
      res.status(400).json({ error: "Informe um telefone válido com DDI." });
      return;
    }
    const name = input.name.trim();
    if (!name) {
      res.status(400).json({ error: "Informe um nome para o lead." });
      return;
    }
    const contact = await getOrCreateContact(input.phoneNumber, name);
    if (!contact) throw new MetaApiError("Não foi possível salvar o lead.");
    await restoreContactInAddressBook(contact.id);
    res.status(201).json({ name: contact.name, phoneNumber: contact.phoneNumber });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lead inválido.";
    logger.warn({ message }, "WhatsApp lead creation failed");
    res.status(400).json({ error: message });
  }
});

router.post("/contacts/delete", async (req, res) => {
  const parsed = DeleteContactsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Selecione pelo menos um contato válido para remover." });
    return;
  }

  const phoneNumbers = [...new Set(parsed.data.phoneNumbers.map(normalizePhone))];
  if (phoneNumbers.some((phoneNumber) => !/^\d{8,15}$/.test(phoneNumber))) {
    res.status(400).json({ error: "A lista contém um ou mais telefones inválidos." });
    return;
  }

  try {
    const deletedAt = new Date();
    const removedContacts = await db
      .update(contacts)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(and(
        isNull(contacts.deletedAt),
        inArray(contacts.phoneNumber, phoneNumbers),
      ))
      .returning({ phoneNumber: contacts.phoneNumber });
    const removedPhones = new Set(removedContacts.map((contact) => contact.phoneNumber));

    res.json(DeleteContactsResponse.parse({
      deletedCount: removedContacts.length,
      notFoundCount: phoneNumbers.filter((phoneNumber) => !removedPhones.has(phoneNumber)).length,
    }));
  } catch (error) {
    logger.error({ err: error }, "Failed to remove WhatsApp contacts from the address book");
    res.status(500).json({ error: "Não foi possível remover os contatos da agenda." });
  }
});

router.get("/templates", async (_req, res) => {
  try {
    const templates = await db
      .select()
      .from(whatsappTemplates)
      .orderBy(desc(whatsappTemplates.updatedAt));
    res.json(ListTemplatesResponse.parse(templates.map(templateResponse)));
  } catch (error) {
    logger.error({ err: error }, "Failed to list WhatsApp templates");
    res.status(500).json({ error: "Não foi possível carregar os templates." });
  }
});

router.post("/templates", async (req, res) => {
  try {
    const input = CreateTemplateBody.parse(req.body);
    const variables = input.variables ?? [];
    const [existing] = await db
      .select()
      .from(whatsappTemplates)
      .where(
        and(
          eq(whatsappTemplates.name, input.name.trim()),
          eq(whatsappTemplates.languageCode, input.languageCode.trim()),
        ),
      )
      .limit(1);

    const components = input.components?.length
      ? normalizeInputComponents(input.components)
      : legacyTemplateComponents(input);
    const values = {
      name: input.name.trim(),
      languageCode: input.languageCode.trim(),
      category: input.category.trim().toUpperCase(),
      status: input.status?.trim().toUpperCase() || "PENDING",
      header: input.header?.trim() || null,
      body: input.body.trim(),
      footer: input.footer?.trim() || null,
      variables,
      components,
      updatedAt: new Date(),
    };
    const [template] = existing
      ? await db
          .update(whatsappTemplates)
          .set(values)
          .where(eq(whatsappTemplates.id, existing.id))
          .returning()
      : await db.insert(whatsappTemplates).values(values).returning();

    if (!template) throw new MetaApiError("Não foi possível salvar o template.");
    res.status(201).json(templateResponse(template));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template inválido.";
    logger.warn({ message }, "WhatsApp template creation failed");
    res.status(400).json({ error: message });
  }
});

router.get("/templates/costs", (_req, res) => {
  res.json(
    GetTemplateCostsResponse.parse({
      currency: process.env.WHATSAPP_ESTIMATED_COST_CURRENCY ?? "BRL",
      costPerMessage: estimatedCostPerMessage(),
      source: "Estimativa configurada no servidor",
      disclaimer: "O valor real varia conforme país, categoria e cobrança vigente da Meta.",
    }),
  );
});

router.get("/templates/dispatches", async (_req, res) => {
  try {
    const dispatches = await db
      .select()
      .from(whatsappTemplateDispatches)
      .orderBy(desc(whatsappTemplateDispatches.createdAt))
      .limit(50);
    const summaries = await Promise.all(
      dispatches.map(async (dispatch) => {
        const [template] = await db
          .select({
            name: whatsappTemplates.name,
            languageCode: whatsappTemplates.languageCode,
          })
          .from(whatsappTemplates)
          .where(eq(whatsappTemplates.id, dispatch.templateId))
          .limit(1);
        return {
          id: dispatch.id,
          templateId: dispatch.templateId,
          templateName: template?.name ?? "Template removido",
          languageCode: template?.languageCode ?? "",
          status: dispatch.status,
          recipientsCount: dispatch.recipientsCount,
          sentCount: dispatch.sentCount,
          deliveredCount: dispatch.deliveredCount,
          readCount: dispatch.readCount,
          failedCount: dispatch.failedCount,
          pendingCount: dispatch.pendingCount,
          estimatedCost: dispatch.estimatedCost,
          currency: dispatch.currency,
          createdAt: dispatch.createdAt.toISOString(),
          updatedAt: dispatch.updatedAt.toISOString(),
        };
      }),
    );
    res.json(ListTemplateDispatchesResponse.parse(summaries));
  } catch (error) {
    logger.error({ err: error }, "Failed to list template dispatches");
    res.status(500).json({ error: "Não foi possível carregar o painel de envios." });
  }
});

router.get("/templates/dispatches/:dispatchId", async (req, res) => {
  try {
    const { dispatchId } = GetTemplateDispatchParams.parse(req.params);
    if (!Number.isInteger(dispatchId)) {
      res.status(400).json({ error: "Lote de envio inválido." });
      return;
    }
    const result = await dispatchResultResponse(dispatchId);
    if (!result) {
      res.status(404).json({ error: "Lote de envio não encontrado." });
      return;
    }
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, "Failed to get template dispatch");
    res.status(500).json({ error: "Não foi possível carregar o envio." });
  }
});

router.post("/templates/:templateId/dispatch", async (req, res) => {
  try {
    if (activeProvider !== "cloud" || !activeConnection) {
      res.status(400).json({ error: "Envio de templates oficiais exige que a conexão da API Oficial da Meta esteja ativa." });
      return;
    }
    const params = DispatchTemplateParams.parse(req.params);
    const input = DispatchTemplateBody.parse(req.body);
    if (!activeConnection) {
      res.status(400).json({ error: "Conecte a API Oficial antes de disparar templates." });
      return;
    }
    const connection = activeConnection;

    const [template] = await db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.id, params.templateId))
      .limit(1);
    if (!template) {
      res.status(404).json({ error: "Template não encontrado." });
      return;
    }

    const recipients = [
      ...new Set(
        input.recipients
          .map(normalizePhone)
          .map((phone) => recipientPhoneNumber(phone, connection))
          .filter((phone) => phone.length >= 8),
      ),
    ];
    if (recipients.length === 0) {
      res.status(400).json({ error: "Informe pelo menos um telefone válido com DDI." });
      return;
    }

    const currency = process.env.WHATSAPP_ESTIMATED_COST_CURRENCY ?? "BRL";
    const estimatedCost = Number((recipients.length * estimatedCostPerMessage()).toFixed(4));
    const [dispatch] = await db
      .insert(whatsappTemplateDispatches)
      .values({
        templateId: template.id,
        status: "pending",
        recipientsCount: recipients.length,
        pendingCount: recipients.length,
        estimatedCost,
        currency,
      })
      .returning();
    if (!dispatch) throw new MetaApiError("Não foi possível criar o lote de envio.");

    const pendingRecipients = await db
      .insert(whatsappTemplateDispatchRecipients)
      .values(recipients.map((phoneNumber) => ({
        dispatchId: dispatch.id,
        phoneNumber,
        status: "pending",
      })))
      .returning();
    const recipientByPhone = new Map(pendingRecipients.map((recipient) => [recipient.phoneNumber, recipient]));
    const componentParameters = (input.componentParameters ?? []) as ComponentParameterInput[];
    const messagesPerSecond = input.tps ?? 10;
    const intervalMs = Math.ceil(1000 / messagesPerSecond);
    const bodyVariables = componentParameters
      .filter((parameter) => parameter.component === "body" && parameter.parameterType === "text")
      .map((parameter) => parameter.value);
    const renderedVariables = bodyVariables.length ? bodyVariables : input.variables ?? [];

    for (const [index, phoneNumber] of recipients.entries()) {
      const recipient = recipientByPhone.get(phoneNumber);
      try {
        if (index > 0) await wait(intervalMs);
        const whatsappMessageId = await sendTemplateMessage(
          connection.selectedPhoneNumberId,
          phoneNumber,
          template,
          input.variables ?? [],
          componentParameters,
          connection.accessToken,
        );
        const contact = await getOrCreateContact(phoneNumber);
        const conversation = await getOrCreateConversation(
          contact.id,
          activeConnection.selectedPhoneNumberId,
        );
        await db.insert(chatMessages).values({
          conversationId: conversation.id,
          whatsappMessageId,
          direction: "outbound",
          messageType: "template",
           content: renderTemplateBody(template.body, renderedVariables),
          status: "sent",
        });
        await db
          .update(conversations)
          .set({ lastMessageAt: new Date(), updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id));
        if (recipient) {
          await db
            .update(whatsappTemplateDispatchRecipients)
            .set({
              status: "sent",
              whatsappMessageId,
              updatedAt: new Date(),
            })
            .where(eq(whatsappTemplateDispatchRecipients.id, recipient.id));
        }
      } catch (error) {
        logger.warn(
          {
            err: error,
            dispatchId: dispatch.id,
            templateId: template.id,
            recipientSuffix: phoneNumber.slice(-4),
          },
          "WhatsApp template recipient failed",
        );
        if (recipient) {
          await db
            .update(whatsappTemplateDispatchRecipients)
            .set({
              status: "failed",
              message: error instanceof Error ? error.message : "Falha ao enviar.",
              errorCode: error instanceof MetaApiError ? error.code ?? null : null,
              updatedAt: new Date(),
            })
            .where(eq(whatsappTemplateDispatchRecipients.id, recipient.id));
        }
      }
    }

    await refreshDispatchSummary(dispatch.id);
    const result = await dispatchResultResponse(dispatch.id);
    if (!result) throw new MetaApiError("Não foi possível carregar o resultado do envio.");
    if (result.recipientsCount > 0 && result.failedCount === result.recipientsCount) {
      throw new MetaApiError(
        "A Meta recusou todos os destinatários. Verifique os números, o template aprovado e os parâmetros informados.",
        502,
        "META_TEMPLATE_ALL_FAILED",
      );
    }
    res.status(201).json(DispatchTemplateResponse.parse(result));
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Falha ao disparar template.";
    logger.warn({ status, message }, "WhatsApp template dispatch failed");
    res.status(status).json({ error: message });
  }
});

router.get("/webhook", (req, res) => {
  const mode = stringValue(req.query["hub.mode"]);
  const token = stringValue(req.query["hub.verify_token"]);
  const challenge = stringValue(req.query["hub.challenge"]);
  if (mode === "subscribe" && token && token === webhookVerifyToken() && challenge) {
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  res.status(403).send("Forbidden");
});

const handleEvolutionWebhook = async (req: Request, res: Response): Promise<void> => {
  const session = activeEvolutionSession;
  if (!session) {
    res.status(401).json({ error: "A conexão via QR Code não está configurada." });
    return;
  }
  const secret = process.env.SESSION_SECRET;
  const expected = createHash("sha256")
    .update(`${secret}:evolution-webhook:${session.instanceName}`)
    .digest();
  const rawSuppliedToken = stringValue(req.query.token);
  const suppliedToken = /^([a-f0-9]{64})(?:\/[a-z0-9_-]+)*\/?$/i.exec(rawSuppliedToken)?.[1] ?? "";
  const supplied = Buffer.from(suppliedToken, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.status(401).json({ error: "Assinatura de webhook inválida." });
    return;
  }
  if (activeProvider !== "evolution") {
    res.json({ success: true, ignored: true });
    return;
  }

  try {
    const body = asRecord(req.body);
    const rawEvent = stringValue(body.event) || stringValue(req.params.eventName);
    const event = rawEvent.toLowerCase().replace(/[_-]/g, ".").replace(/\.+/g, ".");
    if (!session.connected && event !== "connection.update") {
      res.json({ success: true, ignored: true });
      return;
    }
    req.log.info({ event, instanceName: session.instanceName }, "QR Code webhook received");
    const dataValue = body.data;
    const messages = evolutionEventItems(dataValue, "messages");

    if (event === "connection.update") {
      const update = asRecord(dataValue);
      const updateData = asRecord(update.data);
      const updateInstance = asRecord(update.instance);
      const state = stringValue(asRecord(update.state).state) || stringValue(update.state);
      if (state) {
        session.state = state;
        session.connected = state.toLowerCase() === "open";
        if (session.connected) session.hasConnectedBefore = true;
        if (session.connected) session.qrCode = null;
      }
      session.profileName =
        stringValue(update.profileName)
        || stringValue(update.profile_name)
        || stringValue(update.pushName)
        || stringValue(updateData.profileName)
        || stringValue(updateData.pushName)
        || stringValue(updateInstance.profileName)
        || stringValue(body.profileName)
        || session.profileName;
      session.profilePictureUrl = safeWhatsAppPictureUrl(firstStringValue(
        update.profilePictureUrl,
        update.profile_picture_url,
        update.profilePicUrl,
        updateData.profilePictureUrl,
        updateData.profilePicUrl,
        updateInstance.profilePictureUrl,
      )) || session.profilePictureUrl;
      const previousPhoneNumber = session.phoneNumber;
      session.phoneNumber = evolutionOwnerPhoneNumber(
        update,
        updateData,
        updateInstance,
        body,
      ) || session.phoneNumber;
      if (session.phoneNumber !== previousPhoneNumber) {
        evolutionLidAliasCache.delete(session.instanceName);
      }
      const qr = evolutionQrCode(update);
      if (qr) session.qrCode = qr;
      try {
        await persistEvolutionSession(session);
      } catch (error) {
        req.log.warn({ err: error, instanceName: session.instanceName }, "Could not persist WhatsApp connection profile metadata");
      }
    }

    if (["contacts.set", "contacts.upsert", "contacts.update"].includes(event)) {
      for (const contactPayload of evolutionEventItems(dataValue, "contacts")) {
        const jid =
          stringValue(contactPayload.id)
          || stringValue(contactPayload.jid)
          || stringValue(contactPayload.remoteJid);
        const lidJid = [
          jid,
          contactPayload.lid,
          contactPayload.lidJid,
          contactPayload.remoteJid,
        ].map(stringValue).find(isEvolutionLid) ?? "";
        const profileName =
          stringValue(contactPayload.name)
          || stringValue(contactPayload.pushName)
          || stringValue(contactPayload.notify)
          || stringValue(contactPayload.verifiedName);
        const lidDigits = lidJid ? normalizePhone(lidJid.split("@")[0]) : "";
        const phoneNumberCandidates = [
          contactPayload.phoneNumber,
          contactPayload.number,
          contactPayload.remoteJidAlt,
          contactPayload.phone,
        ].map((candidate) => evolutionPhoneFromAlternateJid(evolutionValueString(candidate)))
          .filter((candidate): candidate is string => Boolean(candidate));
        const phoneFromJid = [
          jid,
          contactPayload.id,
          contactPayload.jid,
          contactPayload.remoteJid,
          contactPayload.remoteJidAlt,
        ].map(phoneNumberFromJid)
          .find((candidate) => candidate && candidate !== lidDigits) ?? null;
        const phoneNumber =
          phoneNumberCandidates.find((candidate) => candidate !== lidDigits)
          || phoneFromJid
          || null;

        if (lidJid && phoneNumber) rememberEvolutionLidAlias(session, lidJid, phoneNumber);
        if (phoneNumber && /^\d{8,15}$/.test(phoneNumber)) {
          const existingPhoneContact = await findContactByPhone(phoneNumber);
          const contact = await getOrCreateContact(
            phoneNumber,
            profileName || undefined,
            { preserveSavedName: true },
          );
          if (!existingPhoneContact && contact) {
            await db
              .update(contacts)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(eq(contacts.id, contact.id));
          }
        } else if (lidJid) {
          const [existing] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.phoneNumber, lidJid))
            .limit(1);
          if (existing) {
            if (profileName && profileName !== existing.name) {
              await db
                .update(contacts)
                .set({ name: profileName, updatedAt: new Date() })
                .where(eq(contacts.id, existing.id));
            }
          }
        }
      }
    }

    if (["chats.set", "chats.upsert", "chats.update", "groups.upsert", "group.update"].includes(event)) {
      const collectionKey = event.startsWith("group") ? "groups" : "chats";
      for (const chatPayload of evolutionEventItems(dataValue, collectionKey)) {
        const remoteJid =
          stringValue(chatPayload.id)
          || stringValue(chatPayload.remoteJid)
          || stringValue(chatPayload.jid)
          || stringValue(asRecord(chatPayload.key).remoteJid);
        if (!remoteJid.includes("@")) continue;
        const rawAlternateRemoteJid = firstStringValue(
          chatPayload.remoteJidAlt,
          chatPayload.phoneNumber,
          asRecord(chatPayload.key).remoteJidAlt,
        ) || "";
        const alternateRemoteJid = evolutionPhoneFromAlternateJid(rawAlternateRemoteJid)
          ? rawAlternateRemoteJid
          : isEvolutionLid(rawAlternateRemoteJid)
            ? rawAlternateRemoteJid
          : remoteJid.endsWith("@lid")
            ? (await loadEvolutionLidAliases(session)).get(remoteJid) ?? ""
            : "";
        const name =
          stringValue(chatPayload.name)
          || stringValue(chatPayload.subject)
          || stringValue(chatPayload.pushName)
          || stringValue(chatPayload.notify)
          || undefined;
        const conversation = await getOrCreateEvolutionConversation(
          remoteJid,
          name,
          session,
          alternateRemoteJid,
        );
        if (!conversation) continue;
        const rawUnread = Number(chatPayload.unreadCount ?? chatPayload.unreadMessages);
        const lastTimestamp = Number(
          chatPayload.lastMsgTimestamp
          ?? chatPayload.conversationTimestamp
          ?? chatPayload.timestamp,
        );
        const pinnedState = evolutionChatPinnedState(chatPayload);
        await db
          .update(conversations)
          .set({
            ...(Number.isFinite(rawUnread) && rawUnread >= 0
              ? { unreadCount: Math.floor(rawUnread) }
              : {}),
            ...(Number.isFinite(lastTimestamp) && lastTimestamp > 0
              ? { lastMessageAt: new Date(lastTimestamp * 1000) }
              : {}),
            ...(pinnedState !== null ? { isPinned: pinnedState } : {}),
          })
          .where(eq(conversations.id, conversation.id));
      }
    }

    if (["messages.upsert", "messages.set"].includes(event)) {
      const isHistorySync = event === "messages.set";
      const changedConversationIds = new Set<number>();
      for (const item of messages) {
        const key = asRecord(item.key);
        const rawId = stringValue(key.id) || stringValue(item.id);
        const itemRemoteJid = stringValue(key.remoteJid) || stringValue(item.remoteJid);
        const rawAlternateRemoteJid =
          stringValue(key.remoteJidAlt) || stringValue(item.remoteJidAlt);
        const remoteJid = itemRemoteJid || rawAlternateRemoteJid;
        if (!rawId || !remoteJid.includes("@")) continue;
        const alternateRemoteJid = evolutionPhoneFromAlternateJid(rawAlternateRemoteJid)
          ? rawAlternateRemoteJid
          : isEvolutionLid(rawAlternateRemoteJid)
            ? rawAlternateRemoteJid
          : remoteJid.endsWith("@lid")
            ? (await loadEvolutionLidAliases(session)).get(remoteJid) ?? ""
            : "";
        const messageId = `evolution:${session.instanceName}:${rawId}`;
        const fromMe = key.fromMe === true || item.fromMe === true;
        const details = evolutionMessageDetails(item);
        const contactName = !fromMe ? (
          stringValue(item.pushName)
          || stringValue(item.notifyName)
          || stringValue(item.verifiedName)
          || undefined
        ) : undefined;
        const conversation = await getOrCreateEvolutionConversation(
          remoteJid,
          remoteJid.endsWith("@g.us")
            ? stringValue(item.subject) || stringValue(item.groupName) || undefined
            : contactName,
          session,
          alternateRemoteJid,
        );
        if (!conversation) continue;
        const [stored] = await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.whatsappMessageId, messageId))
          .limit(1);
        const rawTimestamp = Number(item.messageTimestamp ?? item.timestamp);
        const createdAt = Number.isFinite(rawTimestamp) && rawTimestamp > 0
          ? new Date(rawTimestamp * 1000)
          : new Date();
        const status = evolutionMessageStatus(item.status, fromMe);
        if (stored) {
          await db
            .update(chatMessages)
            .set({
              ...(stored.conversationId !== conversation.id
                ? { conversationId: conversation.id }
                : {}),
              providerPayload: details.providerPayload,
              mediaMimeType: details.mediaMimeType,
              mediaFileName: details.mediaFileName,
              mediaCaption: details.mediaCaption,
              status: stored.status === "read" ? "read" : status,
            })
            .where(eq(chatMessages.id, stored.id));
          if (stored.conversationId !== conversation.id) {
            changedConversationIds.add(conversation.id);
          }
          continue;
        }

        if (fromMe) {
          const pendingRows = await db
            .select()
            .from(chatMessages)
            .where(
              and(
                eq(chatMessages.conversationId, conversation.id),
                eq(chatMessages.direction, "outbound"),
                eq(chatMessages.status, "pending"),
              ),
            )
            .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
            .limit(5);
          const pending = pendingRows.find((candidate) => {
            const ageMs = Math.abs(createdAt.getTime() - candidate.createdAt.getTime());
            const sameType = candidate.messageType === details.messageType;
            const sameText = candidate.content === details.content;
            const isMedia = ["image", "video", "audio", "document", "sticker"].includes(details.messageType);
            return ageMs < 120_000 && sameType && (sameText || isMedia);
          });
          if (pending) {
            await db
              .update(chatMessages)
              .set({
                whatsappMessageId: messageId,
                status,
                providerPayload: details.providerPayload,
                mediaMimeType: details.mediaMimeType,
                mediaFileName: details.mediaFileName,
                mediaCaption: details.mediaCaption,
              })
              .where(eq(chatMessages.id, pending.id));
            const latestMessageAt =
              conversation.lastMessageAt && conversation.lastMessageAt > createdAt
                ? conversation.lastMessageAt
                : createdAt;
            await db
              .update(conversations)
              .set({ lastMessageAt: latestMessageAt, updatedAt: latestMessageAt })
              .where(eq(conversations.id, conversation.id));
            changedConversationIds.add(conversation.id);
            continue;
          }
        }

        let replyToMessageId: number | null = null;
        const targetRawId = details.messageType === "reaction"
          ? details.reactionTargetId
          : details.replyTargetId;
        if (targetRawId) {
          const [target] = await db
            .select({ id: chatMessages.id })
            .from(chatMessages)
            .where(
              and(
                eq(chatMessages.conversationId, conversation.id),
                eq(
                  chatMessages.whatsappMessageId,
                  `evolution:${session.instanceName}:${targetRawId}`,
                ),
              ),
            )
            .limit(1);
          replyToMessageId = target?.id ?? null;
          if (details.messageType === "reaction" && fromMe && replyToMessageId !== null) {
            await db
              .delete(chatMessages)
              .where(
                and(
                  eq(chatMessages.conversationId, conversation.id),
                  eq(chatMessages.replyToMessageId, replyToMessageId),
                  eq(chatMessages.direction, "outbound"),
                  eq(chatMessages.messageType, "reaction"),
                ),
              );
          }
          if (details.messageType === "reaction" && fromMe && !details.reactionEmoji) continue;
        }

        await db.insert(chatMessages).values({
          conversationId: conversation.id,
          whatsappMessageId: messageId,
          direction: fromMe ? "outbound" : "inbound",
          messageType: details.messageType,
          content: details.content,
          status,
          providerPayload: details.providerPayload,
          mediaMimeType: details.mediaMimeType,
          mediaFileName: details.mediaFileName,
          mediaCaption: details.mediaCaption,
          replyToMessageId,
          reactionEmoji: details.messageType === "reaction" ? details.reactionEmoji : null,
          createdAt,
        });
        const latestMessageAt =
          conversation.lastMessageAt && conversation.lastMessageAt > createdAt
            ? conversation.lastMessageAt
            : createdAt;
        await db.update(conversations)
          .set({
            ...(isHistorySync || fromMe ? {} : { unreadCount: conversation.unreadCount + 1 }),
            lastMessageAt: latestMessageAt,
            updatedAt: latestMessageAt,
          })
          .where(eq(conversations.id, conversation.id));
        changedConversationIds.add(conversation.id);
      }
      for (const conversationId of changedConversationIds) {
        const referenceRows = await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, conversationId));
        for (const row of referenceRows) {
          if (row.replyToMessageId || !row.providerPayload) continue;
          const details = evolutionMessageDetails(
            asRecord(row.providerPayload),
          );
          const targetRawId = details.messageType === "reaction"
            ? details.reactionTargetId
            : details.replyTargetId;
          if (!targetRawId) continue;
          const [target] = await db
            .select({ id: chatMessages.id })
            .from(chatMessages)
            .where(
              and(
                eq(chatMessages.conversationId, conversationId),
                eq(
                  chatMessages.whatsappMessageId,
                  `evolution:${session.instanceName}:${targetRawId}`,
                ),
              ),
            )
            .limit(1);
          if (target) {
            await db
              .update(chatMessages)
              .set({ replyToMessageId: target.id })
              .where(eq(chatMessages.id, row.id));
          }
        }
        publishConversationEvent({ conversationId, reason: "message" });
      }
    }

    if (event === "messages.update") {
      for (const raw of messages) {
        const item = asRecord(raw);
        const key = asRecord(item.key);
        const rawId = stringValue(key.id) || stringValue(item.id);
        if (!rawId) continue;
        const update = asRecord(item.update);
        const rawStatus = String(update.status ?? item.status ?? "").toLowerCase();
        const status = rawStatus.includes("read") || rawStatus === "4"
          ? "read"
          : rawStatus.includes("deliver") || rawStatus === "3"
            ? "delivered"
            : rawStatus.includes("sent") || rawStatus === "2"
              ? "sent"
              : "";
        if (!status) continue;
        const messageId = `evolution:${session.instanceName}:${rawId}`;
        const [stored] = await db
          .select({ conversationId: chatMessages.conversationId })
          .from(chatMessages)
          .where(eq(chatMessages.whatsappMessageId, messageId))
          .limit(1);
        if (!stored) continue;
        await db.update(chatMessages)
          .set({ status })
          .where(eq(chatMessages.whatsappMessageId, messageId));
        publishConversationEvent({ conversationId: stored.conversationId, reason: "status", whatsappMessageId: messageId });
      }
    }

    if (event === "messages.delete") {
      for (const item of messages) {
        const rawId = stringValue(asRecord(item.key).id) || stringValue(item.id);
        if (!rawId) continue;
        const messageId = `evolution:${session.instanceName}:${rawId}`;
        const [stored] = await db
          .select({ conversationId: chatMessages.conversationId })
          .from(chatMessages)
          .where(eq(chatMessages.whatsappMessageId, messageId))
          .limit(1);
        if (!stored) continue;
        await db
          .update(chatMessages)
          .set({
            content: "Esta mensagem foi apagada no WhatsApp.",
            messageType: "text",
            providerPayload: null,
            mediaMimeType: null,
            mediaFileName: null,
            mediaCaption: null,
          })
          .where(eq(chatMessages.whatsappMessageId, messageId));
        publishConversationEvent({ conversationId: stored.conversationId, reason: "message", whatsappMessageId: messageId });
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error, instanceName: session.instanceName }, "Evolution API webhook processing failed");
    res.status(500).json({ error: "Falha ao processar a atualização do WhatsApp." });
  }
};

router.post("/evolution/webhook", handleEvolutionWebhook);
router.post("/evolution/webhook/:eventName", handleEvolutionWebhook);

router.post("/webhook", async (req, res) => {
  try {
    const payload = ReceiveWebhookBody.parse(req.body);
    if (activeProvider !== "cloud" || !activeConnection) {
      res.json({ success: true, ignored: true });
      return;
    }
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    for (const entry of entries) {
      const entryRecord = asRecord(entry);
      const changes = Array.isArray(entryRecord.changes) ? entryRecord.changes : [];
      for (const change of changes) {
        const value = asRecord(asRecord(change).value);
        const metadata = asRecord(value.metadata);
        const phoneNumberId = stringValue(metadata.phone_number_id);
        const contactProfiles = new Map<string, Record<string, unknown>>();
        let defaultProfile: Record<string, unknown> = {};
        if (Array.isArray(value.contacts)) {
          for (const rawContact of value.contacts) {
            const contactPayload = asRecord(rawContact);
            const profile = asRecord(contactPayload.profile);
            if (!Object.keys(defaultProfile).length) defaultProfile = profile;
            const contactPhone = normalizePhone(stringValue(contactPayload.wa_id));
            if (contactPhone) contactProfiles.set(contactPhone, profile);
          }
        }
        const messagePayloads = Array.isArray(value.messages)
          ? value.messages
          : [];

        for (const rawMessage of messagePayloads) {
          const message = asRecord(rawMessage);
          const whatsappMessageId = stringValue(message.id);
          const from = normalizePhone(stringValue(message.from));
          if (!whatsappMessageId || !from) continue;

          const [alreadyStored] = await db
            .select({ id: chatMessages.id })
            .from(chatMessages)
            .where(eq(chatMessages.whatsappMessageId, whatsappMessageId))
            .limit(1);
          if (alreadyStored) continue;

          const profile = contactProfiles.get(from) ?? defaultProfile;
          const contact = await getOrCreateContact(
            from,
            stringValue(profile.name) || undefined,
          );
          const conversation = await getOrCreateConversation(
            contact.id,
            phoneNumberId || activeConnection?.selectedPhoneNumberId || "unknown",
          );
          const type = stringValue(message.type) || "text";
          const typePayload = asRecord(message[type]);
          const content =
            stringValue(asRecord(typePayload).body) ||
            stringValue(typePayload.caption) ||
            (type === "reaction"
              ? stringValue(typePayload.emoji)
              : `[Mensagem ${type}]`);

          await db.insert(chatMessages).values({
            conversationId: conversation.id,
            whatsappMessageId,
            direction: "inbound",
            messageType: type,
            content,
            status: "received",
          });
          await db
            .update(conversations)
            .set({
              unreadCount: conversation.unreadCount + 1,
              lastMessageAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, conversation.id));
          publishConversationEvent({
            conversationId: conversation.id,
            reason: "message",
            whatsappMessageId,
          });
        }

        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        for (const rawStatus of statuses) {
          const status = asRecord(rawStatus);
          const messageId = stringValue(status.id);
          const statusValue = stringValue(status.status);
          if (!messageId || !statusValue) continue;
          const statusErrors = Array.isArray(status.errors)
            ? asRecord(status.errors[0])
            : {};
          if (statusValue === "failed") {
            logger.warn(
              {
                messageId,
                errorCode: stringValue(statusErrors.code),
                errorTitle: stringValue(statusErrors.title),
                errorMessage: stringValue(statusErrors.message),
              },
              "WhatsApp message delivery failed",
            );
          }

          const [storedMessage] = await db
            .select({ conversationId: chatMessages.conversationId })
            .from(chatMessages)
            .where(eq(chatMessages.whatsappMessageId, messageId))
            .limit(1);
          if (!storedMessage) continue;

          await db
            .update(chatMessages)
            .set({ status: statusValue })
            .where(eq(chatMessages.whatsappMessageId, messageId));
          const [dispatchRecipient] = await db
            .select()
            .from(whatsappTemplateDispatchRecipients)
            .where(eq(whatsappTemplateDispatchRecipients.whatsappMessageId, messageId))
            .limit(1);
          if (dispatchRecipient) {
            const normalizedStatus = ["sent", "delivered", "read", "failed"].includes(statusValue)
              ? statusValue
              : "pending";
            await db
              .update(whatsappTemplateDispatchRecipients)
              .set({
                status: normalizedStatus,
                message: stringValue(statusErrors.title) || stringValue(statusErrors.message) || null,
                errorCode: stringValue(statusErrors.code) || null,
                updatedAt: new Date(),
              })
              .where(eq(whatsappTemplateDispatchRecipients.id, dispatchRecipient.id));
            await refreshDispatchSummary(dispatchRecipient.dispatchId);
          }
          publishConversationEvent({
            conversationId: storedMessage.conversationId,
            reason: "status",
            whatsappMessageId: messageId,
          });
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "WhatsApp webhook processing failed");
    res.status(200).json({ success: true });
  }
});

export default router;