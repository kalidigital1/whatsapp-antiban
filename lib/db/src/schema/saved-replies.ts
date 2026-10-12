import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const savedReplies = pgTable(
  "whatsapp_saved_replies",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    content: text("content"),
    objectPath: text("object_path"),
    mediaMimeType: text("media_mime_type"),
    mediaFileName: text("media_file_name"),
    sizeBytes: integer("size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIndex: index("whatsapp_saved_replies_created_at_idx").on(table.createdAt, table.id),
  }),
);

export const insertSavedReplySchema = createInsertSchema(savedReplies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSavedReply = z.infer<typeof insertSavedReplySchema>;
export type SavedReply = typeof savedReplies.$inferSelect;
