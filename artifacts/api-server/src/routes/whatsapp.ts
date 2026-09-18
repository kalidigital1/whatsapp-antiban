import { createHash } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  ConnectWhatsAppBody,
  CreateTemplateBody,
  DispatchTemplateBody,
  DispatchTemplateParams,
  GetTemplateCostsResponse,
  GetConnectionResponse,
  ListConversationsResponse,
  ListConversationMessagesParams,
  ListConversationMessagesResponse,
  ListTemplatesResponse,
  ListTemplatesResponseItem,
  ListConversationMessagesResponseItem,
  MessageInput,
  ReceiveWebhookBody,
  SendConversationMessageBody,
  SendConversationMessageParams,
  StartConversationBody,
  StartConversationResponse,
  DispatchTemplateResponse,
} from "@workspace/api-zod";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  chatMessages,
  contacts,
  conversations,
  db,
  whatsappTemplates,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const graphVersion = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";

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

let activeConnection: ActiveConnection | null = null;

class MetaApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    },
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
    throw new MetaApiError(message, response.status);
  }

  return body as T;
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

function estimatedCostPerMessage(): number {
  const configured = Number(process.env.WHATSAPP_ESTIMATED_COST_PER_MESSAGE ?? "0.05");
  return Number.isFinite(configured) && configured >= 0 ? configured : 0.05;
}

function templateResponse(template: typeof whatsappTemplates.$inferSelect) {
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
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  });
}

function renderTemplateBody(body: string, variables: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => variables[Number(index) - 1] ?? `{{${index}}}`);
}

async function sendTemplateMessage(
  phoneNumberId: string,
  to: string,
  template: typeof whatsappTemplates.$inferSelect,
  variables: string[],
  accessToken: string,
) {
  const components = variables.length
    ? [
        {
          type: "body",
          parameters: variables.map((text) => ({ type: "text", text })),
        },
      ]
    : undefined;

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
          ...(components ? { components } : {}),
        },
      }),
    },
  );

  const id = stringValue(body.messages?.[0]?.id);
  if (!id) throw new MetaApiError("A Meta não retornou o ID do template enviado.");
  return id;
}

function messageResponse(message: typeof chatMessages.$inferSelect) {
  return ListConversationMessagesResponseItem.parse({
    id: message.id,
    direction: message.direction,
    content: message.content,
    messageType: message.messageType,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    whatsappMessageId: message.whatsappMessageId,
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
  } as const;

  return {
    id: conversation.id,
    contact: {
      name: contact.name || `Cliente ${contact.phoneNumber.slice(-4)}`,
      phoneNumber: contact.phoneNumber,
    },
    lastMessage: lastMessage ? messageResponse(lastMessage) : fallback,
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

async function getOrCreateContact(phoneNumber: string, name?: string) {
  const [existing] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.phoneNumber, phoneNumber))
    .limit(1);
  if (existing) {
    if (name && existing.name !== name) {
      const [updated] = await db
        .update(contacts)
        .set({ name, updatedAt: new Date() })
        .where(eq(contacts.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  const [created] = await db
    .insert(contacts)
    .values({ phoneNumber, name: name || `Cliente ${phoneNumber.slice(-4)}` })
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

  const [created] = await db
    .insert(conversations)
    .values({ contactId, phoneNumberId })
    .returning();
  return created;
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
      contact.phoneNumber,
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

router.get("/connection", (req, res) => {
  res.json(GetConnectionResponse.parse(connectionStatus(req)));
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

    activeConnection = {
      accessToken: input.accessToken,
      businessAccountId: input.businessAccountId,
      phoneNumbers,
      selectedPhoneNumberId: selected,
    };

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

router.delete("/connection", (_req, res) => {
  activeConnection = null;
  res.json({ success: true });
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
    res.json(ListConversationMessagesResponse.parse(messages.map(messageResponse)));
  } catch (error) {
    logger.error({ err: error }, "Failed to list WhatsApp messages");
    res.status(400).json({ error: "Não foi possível carregar as mensagens." });
  }
});

router.post("/conversations/:conversationId/messages", async (req, res) => {
  try {
    const params = SendConversationMessageParams.parse(req.params);
    const { content } = SendConversationMessageBody.parse(req.body);
    if (!activeConnection) {
      res.status(400).json({ error: "Conecte a API Oficial antes de enviar mensagens." });
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

    const message = await storeOutboundMessage(
      conversation,
      content.trim(),
      activeConnection,
    );
    res.status(201).json(messageResponse(message));
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Falha ao enviar mensagem.";
    logger.warn({ status, message }, "WhatsApp message send failed");
    res.status(status).json({ error: message });
  }
});

router.post("/conversations/start", async (req, res) => {
  try {
    const input = StartConversationBody.parse(req.body);
    if (!activeConnection) {
      res.status(400).json({ error: "Conecte a API Oficial antes de iniciar conversas." });
      return;
    }

    const phoneNumber = normalizePhone(input.phoneNumber);
    if (phoneNumber.length < 8) {
      res.status(400).json({ error: "Informe um telefone válido com DDI." });
      return;
    }
    const contact = await getOrCreateContact(phoneNumber);
    const conversation = await getOrCreateConversation(
      contact.id,
      activeConnection.selectedPhoneNumberId,
    );
    const message = await storeOutboundMessage(
      conversation,
      input.content.trim(),
      activeConnection,
    );
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

    const values = {
      name: input.name.trim(),
      languageCode: input.languageCode.trim(),
      category: input.category.trim().toUpperCase(),
      status: input.status?.trim().toUpperCase() || "IMPORTED",
      header: input.header?.trim() || null,
      body: input.body.trim(),
      footer: input.footer?.trim() || null,
      variables,
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
    logger.warn({ message }, "WhatsApp template import failed");
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

router.post("/templates/:templateId/dispatch", async (req, res) => {
  try {
    const params = DispatchTemplateParams.parse(req.params);
    const input = DispatchTemplateBody.parse(req.body);
    if (!activeConnection) {
      res.status(400).json({ error: "Conecte a API Oficial antes de disparar templates." });
      return;
    }

    const [template] = await db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.id, params.templateId))
      .limit(1);
    if (!template) {
      res.status(404).json({ error: "Template não encontrado." });
      return;
    }

    const recipients = [...new Set(input.recipients.map(normalizePhone).filter((phone) => phone.length >= 8))];
    if (recipients.length === 0) {
      res.status(400).json({ error: "Informe pelo menos um telefone válido com DDI." });
      return;
    }

    const results: Array<{ phoneNumber: string; status: "sent" | "failed"; message: string | null }> = [];
    for (const phoneNumber of recipients) {
      try {
        const whatsappMessageId = await sendTemplateMessage(
          activeConnection.selectedPhoneNumberId,
          phoneNumber,
          template,
          input.variables ?? [],
          activeConnection.accessToken,
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
          content: renderTemplateBody(template.body, input.variables ?? []),
          status: "sent",
        });
        await db
          .update(conversations)
          .set({ lastMessageAt: new Date(), updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id));
        results.push({ phoneNumber, status: "sent", message: null });
      } catch (error) {
        results.push({
          phoneNumber,
          status: "failed",
          message: error instanceof Error ? error.message : "Falha ao enviar.",
        });
      }
    }

    const sentCount = results.filter((result) => result.status === "sent").length;
    res.status(201).json(
      DispatchTemplateResponse.parse({
        template: templateResponse(template),
        recipientsCount: recipients.length,
        sentCount,
        failedCount: recipients.length - sentCount,
        estimatedCost: Number((recipients.length * estimatedCostPerMessage()).toFixed(4)),
        currency: process.env.WHATSAPP_ESTIMATED_COST_CURRENCY ?? "BRL",
        results,
      }),
    );
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
        const contactPayload = Array.isArray(value.contacts)
          ? asRecord(value.contacts[0])
          : {};
        const profile = asRecord(contactPayload.profile);
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
        }

        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        for (const rawStatus of statuses) {
          const status = asRecord(rawStatus);
          const messageId = stringValue(status.id);
          const statusValue = stringValue(status.status);
          if (!messageId || !statusValue) continue;
          await db
            .update(chatMessages)
            .set({ status: statusValue })
            .where(eq(chatMessages.whatsappMessageId, messageId));
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