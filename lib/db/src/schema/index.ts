import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const contacts = pgTable(
  "whatsapp_contacts",
  {
    id: serial("id").primaryKey(),
    phoneNumber: text("phone_number").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    phoneNumberUnique: uniqueIndex("whatsapp_contacts_phone_number_unique").on(
      table.phoneNumber,
    ),
  }),
);

export const conversations = pgTable(
  "whatsapp_conversations",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id").notNull(),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    contactPhoneUnique: uniqueIndex(
      "whatsapp_conversations_contact_phone_unique",
    ).on(table.contactId, table.phoneNumberId),
    updatedAtIndex: index("whatsapp_conversations_updated_at_idx").on(
      table.updatedAt,
    ),
  }),
);

export const chatMessages = pgTable(
  "whatsapp_chat_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    whatsappMessageId: text("whatsapp_message_id"),
    direction: text("direction").notNull(),
    messageType: text("message_type").notNull().default("text"),
    content: text("content").notNull(),
    status: text("status").notNull().default("received"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    whatsappMessageUnique: uniqueIndex(
      "whatsapp_chat_messages_whatsapp_id_unique",
    ).on(table.whatsappMessageId),
    conversationCreatedIndex: index(
      "whatsapp_chat_messages_conversation_created_idx",
    ).on(table.conversationId, table.createdAt),
  }),
);

export const appSettings = pgTable("whatsapp_app_settings", {
  id: serial("id").primaryKey(),
  webhookVerifyToken: text("webhook_verify_token"),
  whatsappAccessTokenEncrypted: text("whatsapp_access_token_encrypted"),
  whatsappBusinessAccountId: text("whatsapp_business_account_id"),
  whatsappSelectedPhoneNumberId: text("whatsapp_selected_phone_number_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const whatsappTemplates = pgTable(
  "whatsapp_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    languageCode: text("language_code").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("PENDING"),
    header: text("header"),
    body: text("body").notNull(),
    footer: text("footer"),
    variables: jsonb("variables").$type<string[]>().notNull().default([]),
    components: jsonb("components")
      .$type<WhatsappTemplateComponent[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    nameLanguageUnique: uniqueIndex("whatsapp_templates_name_language_unique").on(
      table.name,
      table.languageCode,
    ),
    updatedAtIndex: index("whatsapp_templates_updated_at_idx").on(table.updatedAt),
  }),
);

export type WhatsappTemplateComponent = {
  type: string;
  format?: string | null;
  text?: string | null;
  example?: Record<string, unknown> | null;
  buttons?: Array<{
    type: string;
    text?: string | null;
    url?: string | null;
    phoneNumber?: string | null;
    example?: string[] | null;
  }>;
};

export const whatsappTemplateDispatches = pgTable(
  "whatsapp_template_dispatches",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => whatsappTemplates.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    recipientsCount: integer("recipients_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    deliveredCount: integer("delivered_count").notNull().default(0),
    readCount: integer("read_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    pendingCount: integer("pending_count").notNull().default(0),
    estimatedCost: real("estimated_cost").notNull().default(0),
    currency: text("currency").notNull().default("BRL"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIndex: index("whatsapp_template_dispatches_created_at_idx").on(table.createdAt),
    templateIdIndex: index("whatsapp_template_dispatches_template_id_idx").on(table.templateId),
  }),
);

export const whatsappTemplateDispatchRecipients = pgTable(
  "whatsapp_template_dispatch_recipients",
  {
    id: serial("id").primaryKey(),
    dispatchId: integer("dispatch_id")
      .notNull()
      .references(() => whatsappTemplateDispatches.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    status: text("status").notNull().default("pending"),
    message: text("message"),
    whatsappMessageId: text("whatsapp_message_id"),
    errorCode: text("error_code"),
    errorTitle: text("error_title"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    dispatchIdIndex: index("whatsapp_template_dispatch_recipients_dispatch_id_idx").on(table.dispatchId),
    whatsappMessageIndex: index("whatsapp_template_dispatch_recipients_whatsapp_id_idx").on(table.whatsappMessageId),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type WhatsappTemplateDispatch = typeof whatsappTemplateDispatches.$inferSelect;
export type WhatsappTemplateDispatchRecipient = typeof whatsappTemplateDispatchRecipients.$inferSelect;