import { Router, type IRouter } from "express";
import {
  ExportDashboardReportCsvQueryParams,
  GetDashboardReportResponse,
  GetDashboardReportQueryParams,
} from "@workspace/api-zod";
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  lt,
  max,
  ne,
  sql,
  sum,
} from "drizzle-orm";
import {
  chatMessages,
  contacts,
  conversations,
  db,
  whatsappTemplateDispatches,
  whatsappTemplates,
} from "@workspace/db";

const router: IRouter = Router();
const REPORT_TIME_ZONE = "America/Belem";
const ACTIVITY_PAGE_SIZE = 50;

type ReportPeriod = "7d" | "30d" | "90d";

function localDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function zoneOffsetMilliseconds(date: Date): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  if (!name || name === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):?(\d{2})?$/.exec(name);
  if (!match) throw new Error(`Unsupported time-zone offset: ${name}`);
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return (match[1] === "-" ? -1 : 1) * minutes * 60_000;
}

function localMidnightAsUtc(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  const offset = zoneOffsetMilliseconds(new Date(localMidnightAsUtc + 12 * 60 * 60_000));
  return new Date(localMidnightAsUtc - offset);
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return localDateKey(new Date(Date.UTC(year, month - 1, day + days, 12)));
}

function periodWindow(period: ReportPeriod) {
  const days = Number.parseInt(period, 10);
  const end = new Date();
  const today = localDateKey(end);
  const startDate = shiftDateKey(today, -(days - 1));
  return {
    days,
    startDate,
    start: localMidnightAsUtc(startDate),
    end,
  };
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function csvLine(values: unknown[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

router.get("/dashboard", async (req, res): Promise<void> => {
  const parsed = GetDashboardReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Selecione um período válido para o relatório." });
    return;
  }

  const { period, page } = parsed.data;
  const window = periodWindow(period);
  const rangeConditions = [
    gte(chatMessages.createdAt, window.start),
    lt(chatMessages.createdAt, window.end),
  ];
  const messageConditions = [...rangeConditions, ne(chatMessages.messageType, "reaction")];
  const pageOffset = (page - 1) * ACTIVITY_PAGE_SIZE;

  try {
    const [
      totalsRows,
      responseRows,
      queueRows,
      unreadRows,
      trendRows,
      activityTotalRows,
      activityRows,
      contactRows,
      dispatchTotalRows,
      recentDispatchRows,
    ] = await Promise.all([
      db
        .select({
          totalMessages: count(),
          inboundMessages: count(
            sql`CASE WHEN ${chatMessages.direction} = 'inbound' THEN 1 END`,
          ),
          outboundMessages: count(
            sql`CASE WHEN ${chatMessages.direction} = 'outbound' AND ${chatMessages.status} NOT IN ('pending', 'failed') THEN 1 END`,
          ),
          pendingOutboundMessages: count(
            sql`CASE WHEN ${chatMessages.direction} = 'outbound' AND ${chatMessages.status} = 'pending' THEN 1 END`,
          ),
          failedOutboundMessages: count(
            sql`CASE WHEN ${chatMessages.direction} = 'outbound' AND ${chatMessages.status} = 'failed' THEN 1 END`,
          ),
          activeConversations: count(sql`DISTINCT ${chatMessages.conversationId}`),
        })
        .from(chatMessages)
        .where(and(...messageConditions)),
      db.execute(sql<{
        inbound_count: string | number;
        answered_count: string | number;
        average_minutes: string | number | null;
      }>`
        WITH inbound AS (
          SELECT id, conversation_id, created_at
          FROM whatsapp_chat_messages
          WHERE direction = 'inbound'
            AND message_type <> 'reaction'
            AND created_at >= ${window.start}
            AND created_at < ${window.end}
        ),
        paired AS (
          SELECT inbound.id, inbound.conversation_id, inbound.created_at,
            (
              SELECT MIN(outbound.created_at)
              FROM whatsapp_chat_messages AS outbound
              WHERE outbound.conversation_id = inbound.conversation_id
                AND outbound.direction = 'outbound'
                AND outbound.message_type <> 'reaction'
                AND outbound.status NOT IN ('pending', 'failed')
                AND (outbound.created_at, outbound.id) > (inbound.created_at, inbound.id)
                AND NOT EXISTS (
                  SELECT 1
                  FROM whatsapp_chat_messages AS next_inbound
                  WHERE next_inbound.conversation_id = inbound.conversation_id
                    AND next_inbound.direction = 'inbound'
                    AND next_inbound.message_type <> 'reaction'
                    AND (next_inbound.created_at, next_inbound.id) > (inbound.created_at, inbound.id)
                    AND (next_inbound.created_at, next_inbound.id) < (outbound.created_at, outbound.id)
                )
            ) AS responded_at
          FROM inbound
        )
        SELECT
          COUNT(*) AS inbound_count,
          COUNT(responded_at) AS answered_count,
          AVG(EXTRACT(EPOCH FROM (responded_at - created_at)) / 60.0) AS average_minutes
        FROM paired
      `),
      db.execute(sql<{
        waiting_for_team: string | number;
        waiting_for_customer: string | number;
      }>`
        SELECT
          COUNT(*) FILTER (WHERE latest.direction = 'inbound') AS waiting_for_team,
          COUNT(*) FILTER (WHERE latest.direction = 'outbound') AS waiting_for_customer
        FROM (
          SELECT DISTINCT ON (conversation_id) conversation_id, direction
          FROM whatsapp_chat_messages
          WHERE message_type <> 'reaction'
            AND direction IN ('inbound', 'outbound')
            AND status NOT IN ('pending', 'failed')
          ORDER BY conversation_id, created_at DESC, id DESC
        ) AS latest
      `),
      db
        .select({ count: count() })
        .from(conversations)
        .where(gt(conversations.unreadCount, 0)),
      db
        .select({
          date: sql<string>`to_char(date_trunc('day', ${chatMessages.createdAt} AT TIME ZONE ${REPORT_TIME_ZONE}), 'YYYY-MM-DD')`,
          direction: chatMessages.direction,
          count: count(),
        })
        .from(chatMessages)
        .where(and(...messageConditions))
        .groupBy(
          sql`date_trunc('day', ${chatMessages.createdAt} AT TIME ZONE ${REPORT_TIME_ZONE})`,
          chatMessages.direction,
        ),
      db
        .select({ count: count() })
        .from(chatMessages)
        .where(and(...rangeConditions)),
      db
        .select({
          id: chatMessages.id,
          conversationId: conversations.id,
          contactName: contacts.name,
          phoneNumber: contacts.phoneNumber,
          direction: chatMessages.direction,
          content: chatMessages.content,
          messageType: chatMessages.messageType,
          status: chatMessages.status,
          conversationType: conversations.conversationType,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
        .innerJoin(contacts, eq(conversations.contactId, contacts.id))
        .where(and(...rangeConditions))
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(ACTIVITY_PAGE_SIZE)
        .offset(pageOffset),
      db
        .select({
          contactName: contacts.name,
          phoneNumber: contacts.phoneNumber,
          messageCount: count(),
          lastMessageAt: max(chatMessages.createdAt),
        })
        .from(chatMessages)
        .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
        .innerJoin(contacts, eq(conversations.contactId, contacts.id))
        .where(and(...messageConditions))
        .groupBy(contacts.id, contacts.name, contacts.phoneNumber)
        .orderBy(desc(count()), desc(max(chatMessages.createdAt)))
        .limit(5),
      db
        .select({
          dispatchCount: count(),
          recipientsCount: sum(whatsappTemplateDispatches.recipientsCount),
          sentCount: sum(whatsappTemplateDispatches.sentCount),
          deliveredCount: sum(whatsappTemplateDispatches.deliveredCount),
          readCount: sum(whatsappTemplateDispatches.readCount),
          failedCount: sum(whatsappTemplateDispatches.failedCount),
          pendingCount: sum(whatsappTemplateDispatches.pendingCount),
        })
        .from(whatsappTemplateDispatches)
        .where(
          and(
            gte(whatsappTemplateDispatches.createdAt, window.start),
            lt(whatsappTemplateDispatches.createdAt, window.end),
          ),
        ),
      db
        .select({
          id: whatsappTemplateDispatches.id,
          templateName: whatsappTemplates.name,
          status: whatsappTemplateDispatches.status,
          recipientsCount: whatsappTemplateDispatches.recipientsCount,
          sentCount: whatsappTemplateDispatches.sentCount,
          deliveredCount: whatsappTemplateDispatches.deliveredCount,
          readCount: whatsappTemplateDispatches.readCount,
          failedCount: whatsappTemplateDispatches.failedCount,
          pendingCount: whatsappTemplateDispatches.pendingCount,
          estimatedCost: whatsappTemplateDispatches.estimatedCost,
          currency: whatsappTemplateDispatches.currency,
          createdAt: whatsappTemplateDispatches.createdAt,
        })
        .from(whatsappTemplateDispatches)
        .innerJoin(
          whatsappTemplates,
          eq(whatsappTemplateDispatches.templateId, whatsappTemplates.id),
        )
        .where(
          and(
            gte(whatsappTemplateDispatches.createdAt, window.start),
            lt(whatsappTemplateDispatches.createdAt, window.end),
          ),
        )
        .orderBy(desc(whatsappTemplateDispatches.createdAt))
        .limit(8),
    ]);

    const totals = totalsRows[0];
    const responseStats = responseRows.rows[0] as unknown as
      | {
          inbound_count: string | number;
          answered_count: string | number;
          average_minutes: string | number | null;
        }
      | undefined;
    const queueStats = queueRows.rows[0] as unknown as
      | {
          waiting_for_team: string | number;
          waiting_for_customer: string | number;
        }
      | undefined;
    const unreadConversations = unreadRows[0]?.count ?? 0;
    const responseCount = asNumber(responseStats?.inbound_count);
    const answeredCount = asNumber(responseStats?.answered_count);
    const activityTotal = activityTotalRows[0]?.count ?? 0;
    const dispatchTotals = dispatchTotalRows[0];
    const trendLookup = new Map<string, { inbound: number; outbound: number }>();
    for (const row of trendRows) {
      const day = trendLookup.get(row.date) ?? { inbound: 0, outbound: 0 };
      if (row.direction === "inbound") day.inbound = row.count;
      if (row.direction === "outbound") day.outbound = row.count;
      trendLookup.set(row.date, day);
    }
    const trend = Array.from({ length: window.days }, (_, index) => {
      const date = shiftDateKey(window.startDate, index);
      return { date, ...(trendLookup.get(date) ?? { inbound: 0, outbound: 0 }) };
    });

    const report = GetDashboardReportResponse.parse({
      period,
      rangeStart: window.start,
      rangeEnd: window.end,
      generatedAt: new Date(),
      summary: {
        totalMessages: totals?.totalMessages ?? 0,
        inboundMessages: totals?.inboundMessages ?? 0,
        outboundMessages: totals?.outboundMessages ?? 0,
        pendingOutboundMessages: totals?.pendingOutboundMessages ?? 0,
        failedOutboundMessages: totals?.failedOutboundMessages ?? 0,
        answeredInboundMessages: answeredCount,
        unansweredInboundMessages: Math.max(0, responseCount - answeredCount),
        responseRatePercent:
          responseCount === 0 ? 0 : Number(((answeredCount / responseCount) * 100).toFixed(1)),
        averageResponseTimeMinutes:
          responseStats?.average_minutes == null
            ? null
            : Number(asNumber(responseStats.average_minutes).toFixed(1)),
        activeConversations: totals?.activeConversations ?? 0,
        waitingForTeam: asNumber(queueStats?.waiting_for_team),
        waitingForCustomer: asNumber(queueStats?.waiting_for_customer),
        unreadConversations,
        templateDispatchCount: dispatchTotals?.dispatchCount ?? 0,
        templateRecipientsCount: asNumber(dispatchTotals?.recipientsCount),
        templateSentCount: asNumber(dispatchTotals?.sentCount),
        templateDeliveredCount: asNumber(dispatchTotals?.deliveredCount),
        templateReadCount: asNumber(dispatchTotals?.readCount),
        templateFailedCount: asNumber(dispatchTotals?.failedCount),
        templatePendingCount: asNumber(dispatchTotals?.pendingCount),
      },
      trend,
      topContacts: contactRows.map((row) => ({
        ...row,
        messageCount: asNumber(row.messageCount),
      })),
      recentDispatches: recentDispatchRows,
      activity: {
        items: activityRows.map((row) => ({
          ...row,
          conversationType: row.conversationType === "group" ? "group" : "direct",
          direction: row.direction === "outbound" ? "outbound" : "inbound",
        })),
        page,
        pageSize: ACTIVITY_PAGE_SIZE,
        total: activityTotal,
        totalPages: Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE),
      },
    });
    res.json(report);
  } catch (error) {
    req.log.error({ err: error }, "Failed to build WhatsApp dashboard report");
    res.status(500).json({ error: "Não foi possível gerar o relatório do WhatsApp." });
  }
});

router.get("/dashboard/export.csv", async (req, res): Promise<void> => {
  const parsed = ExportDashboardReportCsvQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Selecione um período válido para exportar." });
    return;
  }

  const { period } = parsed.data;
  const window = periodWindow(period);
  const messageConditions = [
    gte(chatMessages.createdAt, window.start),
    lt(chatMessages.createdAt, window.end),
  ];
  const dispatchConditions = [
    gte(whatsappTemplateDispatches.createdAt, window.start),
    lt(whatsappTemplateDispatches.createdAt, window.end),
  ];

  try {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="antiban-relatorio-${period}.csv"`,
    );
    res.write("\uFEFF");
    res.write(
      csvLine([
        "Data",
        "Tipo de evento",
        "Contato",
        "Telefone",
        "Direção",
        "Tipo",
        "Conteúdo",
        "Status",
        "Template",
        "Destinatários",
        "Enviadas",
        "Entregues",
        "Lidas",
        "Falhas",
        "Pendentes",
        "Custo estimado",
        "Moeda",
      ]),
    );

    const exportPageSize = 500;
    for (let offset = 0; ; offset += exportPageSize) {
      const rows = await db
        .select({
          createdAt: chatMessages.createdAt,
          contactName: contacts.name,
          phoneNumber: contacts.phoneNumber,
          direction: chatMessages.direction,
          messageType: chatMessages.messageType,
          content: chatMessages.content,
          status: chatMessages.status,
        })
        .from(chatMessages)
        .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
        .innerJoin(contacts, eq(conversations.contactId, contacts.id))
        .where(and(...messageConditions))
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(exportPageSize)
        .offset(offset);
      for (const row of rows) {
        res.write(
          csvLine([
            row.createdAt.toISOString(),
            "Mensagem",
            row.contactName,
            row.phoneNumber,
            row.direction,
            row.messageType,
            row.content,
            row.status,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ]),
        );
      }
      if (rows.length < exportPageSize) break;
    }

    for (let offset = 0; ; offset += exportPageSize) {
      const rows = await db
        .select({
          createdAt: whatsappTemplateDispatches.createdAt,
          templateName: whatsappTemplates.name,
          status: whatsappTemplateDispatches.status,
          recipientsCount: whatsappTemplateDispatches.recipientsCount,
          sentCount: whatsappTemplateDispatches.sentCount,
          deliveredCount: whatsappTemplateDispatches.deliveredCount,
          readCount: whatsappTemplateDispatches.readCount,
          failedCount: whatsappTemplateDispatches.failedCount,
          pendingCount: whatsappTemplateDispatches.pendingCount,
          estimatedCost: whatsappTemplateDispatches.estimatedCost,
          currency: whatsappTemplateDispatches.currency,
        })
        .from(whatsappTemplateDispatches)
        .innerJoin(
          whatsappTemplates,
          eq(whatsappTemplateDispatches.templateId, whatsappTemplates.id),
        )
        .where(and(...dispatchConditions))
        .orderBy(desc(whatsappTemplateDispatches.createdAt))
        .limit(exportPageSize)
        .offset(offset);
      for (const row of rows) {
        res.write(
          csvLine([
            row.createdAt.toISOString(),
            "Envio de template",
            "",
            "",
            "",
            "",
            "",
            row.status,
            row.templateName,
            row.recipientsCount,
            row.sentCount,
            row.deliveredCount,
            row.readCount,
            row.failedCount,
            row.pendingCount,
            row.estimatedCost,
            row.currency,
          ]),
        );
      }
      if (rows.length < exportPageSize) break;
    }
    res.end();
  } catch (error) {
    req.log.error({ err: error }, "Failed to export WhatsApp dashboard report");
    if (!res.headersSent) {
      res.status(500).json({ error: "Não foi possível exportar o relatório." });
      return;
    }
    res.end();
  }
});

export default router;
