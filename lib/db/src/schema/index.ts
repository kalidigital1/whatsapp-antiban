import {
  index,
  integer,
  pgTable,
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;