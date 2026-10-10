import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import {
  ConnectEvolutionWhatsAppBody,
  ConnectWhatsAppBody,
  CreateContactBody,
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
  ListConversationMessagesParams,
  ListConversationMessagesResponse,
  ListTemplatesResponse,
  ListTemplatesResponseItem,
  ListConversationMessagesResponseItem,
  SendConversationMessageReactionBody,
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
} from "@workspace/api-zod";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  chatMessages,
  contacts,
  conversations,
  db,
  appSettings,
  whatsappTemplateDispatchRecipients,
  whatsappTemplateDispatches,
  whatsappTemplates,
  type WhatsappTemplateComponent,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const graphVersion = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";
const metaRequestTimeoutMs = 15_000;
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
  state: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  profileNameFetchedAt?: number;
  qrCode: string | null;
};

let activeConnection: ActiveConnection | null = null;
let activeEvolutionSession: EvolutionSession | null = null;
let activeProvider: "none" | "cloud" | "evolution" = "none";
let connectionsRestored = false;
let connectionRestorePromise: Promise<void> | null = null;
const eventClients = new Set<Response>();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
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

async function restoreActiveConnection() {
  if (connectionsRestored) return;
  if (connectionRestorePromise) return connectionRestorePromise;
  connectionRestorePromise = (async () => {
    try {
      const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
      if (!settings) return;
      const hasCloudConfig = Boolean(settings.whatsappAccessTokenEncrypted && settings.whatsappBusinessAccountId);
      const hasEvolutionConfig = Boolean(settings.whatsappEvolutionConfigEncrypted);
      activeProvider = settings.whatsappActiveProvider === "evolution" && hasEvolutionConfig
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
        const config = JSON.parse(decryptEvolutionConfig(settings.whatsappEvolutionConfigEncrypted)) as EvolutionConfig;
        activeEvolutionSession = {
          ...config,
          connected: false,
          state: "connecting",
          phoneNumber: null,
          profileName: null,
          qrCode: null,
        };
        try {
          await refreshEvolutionSession(activeEvolutionSession, false);
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
    content = stringValue(mediaPayload.caption)
      || `[${media[0] === "audio" ? "Áudio" : media[0] === "sticker" ? "Figurinha" : "Arquivo"} recebido]`;
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
  const protocol = req.header("x-forwarded-proto")?.split(",")[0] ?? req.protocol;
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to secure Evolution API webhooks.");
  const token = createHash("sha256")
    .update(`${secret}:evolution-webhook:${session.instanceName}`)
    .digest("hex");
  return `${protocol}://${req.get("host") ?? "localhost"}/api/evolution/webhook?token=${token}`;
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
    let body: Record<string, unknown> = {};
    if (rawBody) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        body = asRecord(parsed);
        if (typeof parsed === "string") body.message = parsed;
      } catch {
        body.message = rawBody;
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
    return body as T;
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
  const instance = asRecord(stateBody.instance);
  session.phoneNumber =
    stringValue(instance.ownerJid).split("@")[0]
    || stringValue(instance.owner)
    || session.phoneNumber;
  session.profileName =
    stringValue(instance.profileName)
    || stringValue(stateBody.profileName)
    || session.profileName;
  if (session.connected) {
    session.qrCode = null;
    if (!session.profileName && Date.now() - (session.profileNameFetchedAt ?? 0) >= 60_000) {
      session.profileNameFetchedAt = Date.now();
      try {
        const instancesResponse = await evolutionRequest<unknown>(session, "/instance/fetchInstances");
        const instances = Array.isArray(instancesResponse) ? instancesResponse : [instancesResponse];
        const matchedRecord = instances
          .map((value) => asRecord(value))
          .find((record) => stringValue(asRecord(record.instance).instanceName) === session.instanceName);
        const matchedInstance = asRecord(matchedRecord?.instance);
        session.profileName =
          stringValue(matchedInstance.profileName)
          || stringValue(matchedInstance.pushName)
          || stringValue(matchedRecord?.profileName)
          || session.profileName;
      } catch (error) {
        logger.warn({ err: error, instanceName: session.instanceName }, "Could not resolve QR-connected account profile name");
      }
    }
    return;
  }
  if (requestQr) {
    const qrBody = await evolutionRequest<Record<string, unknown>>(
      session,
      `/instance/connect/${encodeURIComponent(session.instanceName)}`,
    );
    session.qrCode = evolutionQrCode(qrBody);
    const qrInstance = asRecord(qrBody.instance);
    session.phoneNumber =
      stringValue(qrInstance.ownerJid).split("@")[0]
      || stringValue(qrInstance.owner)
      || session.phoneNumber;
  }
}

async function setEvolutionWebhook(session: EvolutionSession, req: Request) {
  await evolutionRequest(
    session,
    `/webhook/set/${encodeURIComponent(session.instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          url: evolutionWebhookUrl(req, session),
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
}

function evolutionConnectionResponse(session: EvolutionSession | null): EvolutionConnectionStatus {
  return GetEvolutionConnectionResponse.parse({
    configured: Boolean(session),
    connected: Boolean(session?.connected),
    active: activeProvider === "evolution" && Boolean(session),
    state: session?.state ?? null,
    instanceName: session?.instanceName ?? null,
    phoneNumber: session?.phoneNumber ?? null,
    profileName: session?.profileName ?? null,
    qrCode: session?.qrCode ?? null,
    defaultServerUrlConfigured: Boolean(process.env.EVOLUTION_API_URL?.trim()),
    defaultApiKeyConfigured: Boolean(process.env.EVOLUTION_API_KEY?.trim()),
  });
}

function connectionStatus(req: Request) {
  const connection = activeConnection;
  return GetConnectionResponse.parse({
    connected: Boolean(connection),
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
      hasMedia && message.providerPayload && conversationId
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

async function conversationResponse(
  conversation: typeof conversations.$inferSelect,
  contact: typeof contacts.$inferSelect,
) {
  const [lastMessage] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversation.id))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(1);

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

  return {
    id: conversation.id,
    conversationType: conversation.conversationType === "group" ? "group" : "direct",
    remoteJid: conversation.remoteJid,
    contact: {
      name: contactDisplayName(contact),
      phoneNumber: contact.phoneNumber,
    },
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
) {
  const type = mediaMessageType(file.mimetype);
  const mediaId = await uploadMediaToMeta(phoneNumberId, file, accessToken);
  const media = {
    id: mediaId,
    ...(caption ? { caption } : {}),
    ...(type === "document" ? { filename: file.originalname } : {}),
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
    const body = await evolutionRequest<Record<string, unknown>>(
      session,
      `/message/sendMedia/${encodeURIComponent(session.instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify({
           number: evolutionRecipient(contact.phoneNumber, conversation),
          mediatype: type,
          mimetype: file.mimetype,
          caption,
          media: file.buffer.toString("base64"),
          fileName: file.originalname,
        }),
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
    );
    const [updated] = await db
      .update(chatMessages)
      .set({ status: "sent", whatsappMessageId: sent.id })
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

function isGeneratedContactName(name: string, phoneNumber: string): boolean {
  return name.trim() === `Cliente ${phoneNumber.slice(-4)}`;
}

function contactDisplayName(contact: typeof contacts.$inferSelect): string {
  const name = contact.name.trim();
  return name && !isGeneratedContactName(name, contact.phoneNumber)
    ? name
    : contact.phoneNumber;
}

async function getOrCreateContact(phoneNumber: string, name?: string) {
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

  let existing: typeof contacts.$inferSelect | undefined;
  for (const candidatePhone of new Set(candidatePhones)) {
    const [candidate] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.phoneNumber, candidatePhone))
      .limit(1);
    if (candidate) {
      existing = candidate;
      break;
    }
  }

  if (existing) {
    const incomingName = name?.trim();
    const nextName =
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

  const [created] = await db
    .insert(contacts)
    .values({ phoneNumber: storedPhoneNumber, name: name?.trim() || storedPhoneNumber })
    .returning();
  return created;
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

async function getOrCreateEvolutionConversation(
  remoteJid: string,
  name: string | undefined,
  session: EvolutionSession,
) {
  const isGroup = remoteJid.endsWith("@g.us");
  const rawPhone = remoteJid.split("@")[0];
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
      contact = await getOrCreateContact(phoneNumber, name);
    } else {
      const [existing] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.phoneNumber, remoteJid))
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
            phoneNumber: remoteJid,
            name: name?.trim() || "Contato do WhatsApp",
          })
          .returning();
        contact = created;
      }
    }
  }

  const providerPhoneNumberId = `evolution:${session.instanceName}`;
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
    const [created] = await db
      .insert(conversations)
      .values({ contactId: contact.id, phoneNumberId: providerPhoneNumberId })
      .returning();
    conversation = created;
  }

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

function evolutionRecipient(
  contactPhone: string,
  conversation: typeof conversations.$inferSelect,
): string {
  if (conversation.conversationType === "group" && conversation.remoteJid?.endsWith("@g.us")) {
    return conversation.remoteJid;
  }
  if (conversation.remoteJid?.endsWith("@lid")) return conversation.remoteJid;
  return evolutionPhoneNumber(contactPhone);
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

router.get("/evolution/connection", async (_req, res) => {
  const session = activeEvolutionSession;
  if (session) {
    try {
      await refreshEvolutionSession(session, !session.qrCode);
    } catch (error) {
      session.state = "unreachable";
      session.connected = false;
      logger.warn({ err: error, instanceName: session.instanceName }, "Evolution API state check failed");
    }
  }
  res.json(evolutionConnectionResponse(session));
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
    const encryptedConfig = encryptEvolutionConfig(JSON.stringify({
      serverUrl: session.serverUrl,
      apiKey: session.apiKey,
      instanceName: session.instanceName,
    }));
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
    res.json(evolutionConnectionResponse(session));
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Não foi possível iniciar a conexão via QR Code.";
    logger.warn({ status, message }, "Evolution API connection setup failed");
    res.status(status).json({ error: message });
  }
});

router.post("/evolution/connection/qr", async (_req, res) => {
  if (!activeEvolutionSession) {
    res.status(400).json({ error: "Configure a conexão via QR Code antes de solicitar um novo código." });
    return;
  }
  try {
    await refreshEvolutionSession(activeEvolutionSession, true);
    res.json(evolutionConnectionResponse(activeEvolutionSession));
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o QR Code.";
    res.status(status).json({ error: message });
  }
});

router.delete("/evolution/connection", async (_req, res) => {
  if (activeEvolutionSession) {
    try {
      await evolutionRequest(
        activeEvolutionSession,
        `/instance/logout/${encodeURIComponent(activeEvolutionSession.instanceName)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      logger.warn({ err: error, instanceName: activeEvolutionSession.instanceName }, "Evolution API logout failed; clearing local connection");
    }
  }
  activeEvolutionSession = null;
  activeProvider = activeConnection ? "cloud" : "none";
  await db
    .update(appSettings)
    .set({
      whatsappEvolutionConfigEncrypted: null,
      whatsappActiveProvider: activeProvider,
      updatedAt: new Date(),
    })
    .where(eq(appSettings.id, 1));
  res.json({ success: true });
});

router.post("/connection", async (req, res) => {
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

    await subscribeWhatsAppBusinessAccount(
      input.accessToken,
      input.businessAccountId,
    );

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
  activeConnection = null;
  activeProvider = activeEvolutionSession?.connected ? "evolution" : "none";
  await db
    .update(appSettings)
    .set({
      whatsappAccessTokenEncrypted: null,
      whatsappBusinessAccountId: null,
      whatsappSelectedPhoneNumberId: null,
      whatsappActiveProvider: activeProvider,
      updatedAt: new Date(),
    })
    .where(eq(appSettings.id, 1));
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

router.get("/conversations", async (_req, res) => {
  try {
    const rows = await db
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .orderBy(desc(conversations.updatedAt));
    const result = await Promise.all(
      rows.map((row) => conversationResponse(row.conversation, row.contact)),
    );
    res.json(ListConversationsResponse.parse(result));
  } catch (error) {
    logger.error({ err: error }, "Failed to list WhatsApp conversations");
    res.status(500).json({ error: "Não foi possível carregar as conversas." });
  }
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

    const whatsappId =
      conversation.remoteJid
      || (contact.phoneNumber.includes("@")
        ? contact.phoneNumber
        : `${normalizePhone(contact.phoneNumber)}@s.whatsapp.net`);
    const instance = encodeURIComponent(session.instanceName);
    const pictureRequest = evolutionRequest<Record<string, unknown>>(
      session,
      `/chat/fetchProfilePictureUrl/${instance}`,
      { method: "POST", body: JSON.stringify({ number: whatsappId }) },
    );
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

    const pictureRecords = pictureResult.status === "fulfilled"
      ? [pictureResult.value, asRecord(pictureResult.value.data)]
      : [];
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
    const pictureUrl = firstText(
      [...pictureRecords, ...records],
      ["profilePictureUrl", "profile_picture_url", "pictureUrl", "picture", "profilePicUrl"],
    );
    let safePictureUrl: string | null = null;
    if (pictureUrl) {
      try {
        const parsedUrl = new URL(pictureUrl);
        if (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") {
          safePictureUrl = parsedUrl.toString();
        }
      } catch {
        safePictureUrl = null;
      }
    }

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
      whatsappId,
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

    const deleted = await db
      .delete(conversations)
      .where(eq(conversations.id, conversationId))
      .returning({ id: conversations.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Failed to delete WhatsApp conversation");
    res.status(500).json({ error: "Não foi possível apagar a conversa." });
  }
});

router.get("/conversations/:conversationId/messages", async (req, res) => {
  try {
    const params = ListConversationMessagesParams.parse(req.params);
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);
    if (!conversation) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }

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
      if (!session) {
        res.status(503).json({ error: "A conexão via QR Code não está disponível para carregar a mídia." });
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
      const base64 = encoded.replace(/^data:[^;,]+;base64,/, "");
      if (!base64) {
        res.status(502).json({ error: "O serviço de conexão via QR Code não retornou o conteúdo da mídia." });
        return;
      }
      const bytes = Buffer.from(base64, "base64");
      if (!bytes.length) {
        res.status(502).json({ error: "O arquivo retornado pela conexão via QR Code está vazio." });
        return;
      }
      const mimeType =
        stringValue(mediaResponse.mimetype)
        || stringValue(mediaData.mimetype)
        || message.mediaMimeType
        || "application/octet-stream";
      const fileName =
        stringValue(mediaResponse.fileName)
        || stringValue(mediaData.fileName)
        || message.mediaFileName
        || "arquivo";
      const safeFileName = fileName.replace(/[\r\n"]/g, "_");
      const inline = /^(image|audio|video)\//i.test(mimeType);
      res.setHeader("Content-Type", mimeType);
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
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
      .orderBy(asc(contacts.name), asc(contacts.phoneNumber));
    res.json(ListContactsResponse.parse(savedContacts
      .filter((contact) => /^\d{8,15}$/.test(contact.phoneNumber))
      .map((contact) => ({
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      }))));
  } catch (error) {
    logger.error({ err: error }, "Failed to list WhatsApp leads");
    res.status(500).json({ error: "Não foi possível carregar os leads." });
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
    const [existing] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.phoneNumber, phoneNumber))
      .limit(1);
    const [contact] = existing
      ? await db
          .update(contacts)
          .set({ name, updatedAt: new Date() })
          .where(eq(contacts.id, existing.id))
          .returning()
      : await db
          .insert(contacts)
          .values({ name, phoneNumber })
          .returning();
    if (!contact) throw new MetaApiError("Não foi possível salvar o lead.");
    res.status(201).json({ name: contact.name, phoneNumber: contact.phoneNumber });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lead inválido.";
    logger.warn({ message }, "WhatsApp lead creation failed");
    res.status(400).json({ error: message });
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

router.post("/evolution/webhook", async (req, res) => {
  const session = activeEvolutionSession;
  if (!session) {
    res.status(401).json({ error: "A conexão via QR Code não está configurada." });
    return;
  }
  const secret = process.env.SESSION_SECRET;
  const expected = createHash("sha256")
    .update(`${secret}:evolution-webhook:${session.instanceName}`)
    .digest();
  const suppliedToken = stringValue(req.query.token);
  const supplied = Buffer.from(suppliedToken, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.status(401).json({ error: "Assinatura de webhook inválida." });
    return;
  }

  try {
    const body = asRecord(req.body);
    const event = stringValue(body.event).toLowerCase();
    const dataValue = body.data;
    const messages = evolutionEventItems(dataValue, "messages");

    if (event === "connection.update") {
      const update = asRecord(dataValue);
      const state = stringValue(asRecord(update.state).state) || stringValue(update.state);
      if (state) {
        session.state = state;
        session.connected = state.toLowerCase() === "open";
        if (session.connected) session.qrCode = null;
      }
      session.profileName =
        stringValue(update.profileName)
        || stringValue(update.profile_name)
        || stringValue(update.pushName)
        || stringValue(body.profileName)
        || session.profileName;
      const qr = evolutionQrCode(update);
      if (qr) session.qrCode = qr;
    }

    if (["contacts.set", "contacts.upsert", "contacts.update"].includes(event)) {
      for (const contactPayload of evolutionEventItems(dataValue, "contacts")) {
        const jid =
          stringValue(contactPayload.id)
          || stringValue(contactPayload.jid)
          || stringValue(contactPayload.remoteJid);
        const profileName =
          stringValue(contactPayload.name)
          || stringValue(contactPayload.pushName)
          || stringValue(contactPayload.notify)
          || stringValue(contactPayload.verifiedName);
        const rawPhone = stringValue(contactPayload.phoneNumber)
          || stringValue(contactPayload.number)
          || jid.split("@")[0];
        const phoneNumber = normalizePhone(rawPhone);
        if (/^\d{8,15}$/.test(phoneNumber)) {
          await getOrCreateContact(phoneNumber, profileName || undefined);
        } else if (jid.endsWith("@lid")) {
          const [existing] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.phoneNumber, jid))
            .limit(1);
          if (existing) {
            if (profileName && profileName !== existing.name) {
              await db
                .update(contacts)
                .set({ name: profileName, updatedAt: new Date() })
                .where(eq(contacts.id, existing.id));
            }
          } else {
            await db.insert(contacts).values({
              phoneNumber: jid,
              name: profileName || "Contato do WhatsApp",
            });
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
        const name =
          stringValue(chatPayload.name)
          || stringValue(chatPayload.subject)
          || stringValue(chatPayload.pushName)
          || stringValue(chatPayload.notify)
          || undefined;
        const conversation = await getOrCreateEvolutionConversation(remoteJid, name, session);
        if (!conversation) continue;
        const rawUnread = Number(chatPayload.unreadCount ?? chatPayload.unreadMessages);
        const lastTimestamp = Number(
          chatPayload.lastMsgTimestamp
          ?? chatPayload.conversationTimestamp
          ?? chatPayload.timestamp,
        );
        await db
          .update(conversations)
          .set({
            ...(Number.isFinite(rawUnread) && rawUnread >= 0
              ? { unreadCount: Math.floor(rawUnread) }
              : {}),
            ...(Number.isFinite(lastTimestamp) && lastTimestamp > 0
              ? { lastMessageAt: new Date(lastTimestamp * 1000) }
              : {}),
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
        const remoteJid = stringValue(key.remoteJid) || stringValue(item.remoteJid);
        if (!rawId || !remoteJid.includes("@")) continue;
        const messageId = `evolution:${session.instanceName}:${rawId}`;
        const fromMe = key.fromMe === true || item.fromMe === true;
        const details = evolutionMessageDetails(item);
        const contactName =
          stringValue(item.pushName)
          || stringValue(item.notifyName)
          || stringValue(item.verifiedName)
          || undefined;
        const conversation = await getOrCreateEvolutionConversation(
          remoteJid,
          remoteJid.endsWith("@g.us")
            ? stringValue(item.subject) || stringValue(item.groupName) || undefined
            : contactName,
          session,
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
              providerPayload: details.providerPayload,
              mediaMimeType: details.mediaMimeType,
              mediaFileName: details.mediaFileName,
              mediaCaption: details.mediaCaption,
              status: stored.status === "read" ? "read" : status,
            })
            .where(eq(chatMessages.id, stored.id));
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
});

router.post("/webhook", async (req, res) => {
  try {
    const payload = ReceiveWebhookBody.parse(req.body);
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