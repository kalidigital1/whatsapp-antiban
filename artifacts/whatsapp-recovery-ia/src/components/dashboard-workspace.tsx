import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, ArrowDownLeft, ArrowUpRight, BarChart3, Check, ChevronDown, Clock3, Download,
  FileSpreadsheet, Inbox, Moon, Printer, RefreshCw, Sun, Users, Wifi,
} from 'lucide-react';
import {
  getExportDashboardReportCsvQueryKey, getGetDashboardReportQueryKey,
  useExportDashboardReportCsv, useGetDashboardReport,
  type GetDashboardReportPeriod,
} from '@workspace/api-client-react';

type Props = { onBackToInbox: () => void };
type ExportRow = Record<string, string | number>;
const CHART_COLORS = { blue: '#0079F2', purple: '#795EFF', green: '#009118', red: '#A60808', pink: '#ec4899' };
const INTERVAL_OPTIONS = [
  { label: '5 minutos', ms: 5 * 60 * 1000 },
  { label: '15 minutos', ms: 15 * 60 * 1000 },
  { label: '1 hora', ms: 60 * 60 * 1000 },
  { label: '24 horas', ms: 24 * 60 * 60 * 1000 },
];
const periodOptions: Array<{ value: GetDashboardReportPeriod; label: string }> = [
  { value: '7d', label: '7 dias' }, { value: '30d', label: '30 dias' }, { value: '90d', label: '90 dias' },
];

function number(value: number) { return new Intl.NumberFormat('pt-BR').format(value); }
function percentage(value: number) { return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`; }
function localDate(value: string, options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00-03:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'America/Belem' }).format(d);
}
function downloadCsv(filename: string, rows: ExportRow[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const escape = (input: unknown) => {
    const value = String(input ?? '');
    const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replaceAll('"', '""')}"`;
  };
  const csv = [keys.map(escape).join(';'), ...rows.map((row) => keys.map((key) => escape(row[key])).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function timeAgoLabel(timestamp: number) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Belem' }).format(new Date(timestamp));
}
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="dash-tooltip"><strong>{label}</strong>{payload.map((entry, index) => <div key={`${entry.name}-${index}`}><i style={{ background: entry.color }} />{entry.name}<b>{number(entry.value ?? 0)}</b></div>)}</div>;
}
function ChartDownload({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="dash-icon-button" aria-label={`Exportar CSV: ${label}`} data-testid={`button-export-${label}`} disabled={disabled} onClick={onClick}><Download size={15} /></button>;
}
function EmptyChart({ title }: { title: string }) {
  return <div className="dash-chart-empty" role="status"><BarChart3 size={24} /><span>Sem dados de {title.toLowerCase()} neste período.</span></div>;
}
function MetricCard({ eyebrow, value, detail, icon, accent = '' }: { eyebrow: string; value: string; detail: string; icon: ReactNode; accent?: string }) {
  return <article className={`dash-metric ${accent}`}><div className="dash-metric-top"><span>{eyebrow}</span><span className="dash-metric-icon">{icon}</span></div><strong data-testid={`metric-${eyebrow.toLowerCase().replaceAll(' ', '-')}`}>{value}</strong><p>{detail}</p></article>;
}

export function DashboardWorkspace({ onBackToInbox }: Props) {
  const [period, setPeriod] = useState<GetDashboardReportPeriod>('7d');
  const [page, setPage] = useState(1);
  const [isDark, setIsDark] = useState(() => localStorage.getItem('dashboard-theme') !== 'light');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalMs, setIntervalMs] = useState(INTERVAL_OPTIONS[0].ms);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [exportError, setExportError] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryParams = useMemo(() => ({ period, page }), [period, page]);
  const query = useGetDashboardReport(queryParams, { query: { queryKey: getGetDashboardReportQueryKey(queryParams), refetchInterval: autoRefresh ? intervalMs : false, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 } });
  const exportParams = useMemo(() => ({ period }), [period]);
  const exportQuery = useExportDashboardReportCsv(exportParams, { query: { queryKey: getExportDashboardReportCsvQueryKey(exportParams), enabled: false, staleTime: 0 } });
  const report = query.data;
  const summary = report?.summary;
  const loading = query.isLoading || query.isFetching;
  const gridColor = isDark ? 'rgba(230,242,236,.10)' : 'rgba(31,62,48,.12)';
  const tickColor = isDark ? '#9dafaa' : '#75837d';
  const activity = report?.activity;
  const time = query.dataUpdatedAt ? timeAgoLabel(query.dataUpdatedAt) : '';

  useEffect(() => {
    document.documentElement.classList.toggle('dashboard-light', !isDark);
    localStorage.setItem('dashboard-theme', isDark ? 'dark' : 'light');
  }, [isDark]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => {
    if (loading) setIsSpinning(true);
    else {
      const timeout = window.setTimeout(() => setIsSpinning(false), 600);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [loading]);

  const refresh = () => { void query.refetch(); };
  const exportFullReport = async () => {
    setExportError('');
    const result = await exportQuery.refetch();
    if (!result.error && result.data instanceof Blob) {
      const url = URL.createObjectURL(result.data);
      const link = document.createElement('a'); link.href = url; link.download = `relatorio-whatsapp-${period}.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      setExportError('Não foi possível exportar o relatório. Tente novamente.');
    }
  };
  const changePeriod = (next: GetDashboardReportPeriod) => { setPeriod(next); setPage(1); };
  const trends = report?.trend ?? [];
  const contacts = report?.topContacts ?? [];
  const dispatches = report?.recentDispatches ?? [];
  const trendCsv = trends.map((item) => ({ data: item.date, recebidas: item.inbound, enviadas: item.outbound }));
  const contactsCsv = contacts.map((item) => ({ contato: item.contactName, telefone: item.phoneNumber, mensagens: item.messageCount, ultimaMensagem: item.lastMessageAt }));
  const dispatchCsv = dispatches.map((item) => ({ template: item.templateName, status: item.status, destinatarios: item.recipientsCount, enviadas: item.sentCount, entregues: item.deliveredCount, lidas: item.readCount, falhas: item.failedCount, pendentes: item.pendingCount, custoEstimado: item.estimatedCost, moeda: item.currency }));

  return (
    <section className="dashboard-workspace" aria-labelledby="dashboard-title" data-testid="workspace-dashboard">
      <header className="dashboard-header">
        <div className="dashboard-brand-line">
          <button type="button" className="dashboard-logo-button" onClick={onBackToInbox} aria-label="Voltar para Antiban" data-testid="button-dashboard-back">
            <img src="/assets/antiban-logo-white.png" alt="Antiban" />
          </button>
          <span className="dashboard-header-divider" />
          <div className="dashboard-title-wrap"><span className="dashboard-overline"><span className="dash-live-dot" /> CENTRAL DE OPERAÇÕES</span><h1 id="dashboard-title">Dashboard</h1></div>
          <div className="dashboard-period-control" role="group" aria-label="Período do relatório" data-testid="control-dashboard-period">
            {periodOptions.map((option) => <button type="button" key={option.value} aria-pressed={period === option.value} data-testid={`button-period-${option.value}`} onClick={() => changePeriod(option.value)}>{option.label}</button>)}
          </div>
        </div>
        <div className="dashboard-header-actions print:hidden">
          <div className="dashboard-refresh-group" ref={dropdownRef}>
            <div className="dashboard-refresh-split">
              <button type="button" onClick={refresh} disabled={loading} data-testid="button-dashboard-refresh"><RefreshCw size={14} className={isSpinning ? 'dash-spin' : ''} /> Atualizar</button>
              <span />
              <button type="button" aria-label="Opções de atualização" aria-expanded={dropdownOpen} onClick={() => setDropdownOpen((open) => !open)} data-testid="button-dashboard-refresh-options"><ChevronDown size={14} /></button>
            </div>
            {dropdownOpen && <div className="dashboard-refresh-menu" role="dialog" aria-label="Atualização automática">
              <label className="dashboard-auto-toggle"><span><strong>Atualização automática</strong><small>Desativada por padrão</small></span><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} data-testid="checkbox-auto-refresh" /></label>
              <div className="dashboard-menu-caption">Intervalo mínimo de 5 minutos</div>
              {INTERVAL_OPTIONS.map((option) => <button type="button" key={option.ms} className="dashboard-interval-option" disabled={!autoRefresh} aria-pressed={intervalMs === option.ms} onClick={() => setIntervalMs(option.ms)} data-testid={`button-refresh-interval-${option.ms}`}>{option.label}{intervalMs === option.ms && <Check size={14} />}</button>)}
            </div>}
          </div>
          <button type="button" className="dash-utility-button" onClick={exportFullReport} disabled={exportQuery.isFetching} data-testid="button-export-report"><FileSpreadsheet size={15} />{exportQuery.isFetching ? 'Exportando…' : 'Exportar relatório'}</button>
          <button type="button" className="dash-icon-button" onClick={() => window.print()} aria-label="Imprimir ou salvar como PDF" data-testid="button-dashboard-print"><Printer size={15} /></button>
          <button type="button" className="dash-icon-button" onClick={() => setIsDark((dark) => !dark)} aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'} data-testid="button-dashboard-theme">{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>
      <div className="dashboard-report-meta">
        <span>Relatório em <b>America/Belem</b>{report && <> · {localDate(report.rangeStart, { day: '2-digit', month: 'long', year: 'numeric' })} — {localDate(report.rangeEnd, { day: '2-digit', month: 'long', year: 'numeric' })}</>}</span>
        <span>{time ? `Atualizado às ${time}` : 'Dados do seu espaço'}</span>
      </div>
      {exportError && <div className="dashboard-inline-warning" role="alert" data-testid="status-dashboard-export-error">{exportError}</div>}

      {query.isError && !report && <section className="dashboard-state dashboard-error" role="alert" data-testid="state-dashboard-error"><Activity size={25} /><h2>Não foi possível carregar o dashboard</h2><p>Verifique sua conexão e tente atualizar novamente.</p><button type="button" onClick={refresh} data-testid="button-dashboard-retry"><RefreshCw size={15} /> Tentar novamente</button></section>}
      {!query.isError || report ? <>
        <section className="dashboard-bento" aria-label="Resumo do período" aria-busy={loading}>
          <article className="dash-hero-stat">
            <div className="dash-hero-grid" aria-hidden="true" />
            <div className="dash-hero-kicker"><Activity size={14} /> DESEMPENHO DE ATENDIMENTO</div>
            <span className="dash-hero-label">Taxa de resposta</span>
            <strong className="dash-hero-value" data-testid="metric-response-rate">{loading && !summary ? '—' : !summary?.inboundMessages ? '—' : percentage(summary.responseRatePercent)}</strong>
            <p>Mensagens recebidas que tiveram resposta bem-sucedida antes da próxima mensagem do cliente.</p>
            <div className="dash-hero-foot"><span>{number(summary?.answeredInboundMessages ?? 0)} respondidas</span><span>{number(summary?.unansweredInboundMessages ?? 0)} sem resposta</span></div>
          </article>
          <MetricCard eyebrow="Mensagens no período" value={loading && !summary ? '—' : number(summary?.totalMessages ?? 0)} detail={`${number(summary?.inboundMessages ?? 0)} recebidas · ${number(summary?.outboundMessages ?? 0)} enviadas · ${number(summary?.pendingOutboundMessages ?? 0)} pendentes · ${number(summary?.failedOutboundMessages ?? 0)} falhas`} icon={<Activity size={17} />} />
          <MetricCard eyebrow="Tempo de resposta" value={summary?.averageResponseTimeMinutes == null ? (loading && !summary ? '—' : '—') : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(summary.averageResponseTimeMinutes)} min`} detail="Média das respostas bem-sucedidas" icon={<Clock3 size={17} />} />
          <MetricCard eyebrow="Conversas ativas" value={loading && !summary ? '—' : number(summary?.activeConversations ?? 0)} detail={`${number(summary?.unreadConversations ?? 0)} não lidas`} icon={<Inbox size={17} />} />
          <article className="dash-waiting-stat"><div><span className="dash-label">AGUARDANDO</span><strong>{loading && !summary ? '—' : number(summary?.waitingForTeam ?? 0)}</strong><p>Sua equipe</p></div><span className="dash-waiting-separator" /><div><span className="dash-label">AGUARDANDO</span><strong>{loading && !summary ? '—' : number(summary?.waitingForCustomer ?? 0)}</strong><p>Cliente</p></div><div className="dash-waiting-icon"><Users size={19} /></div></article>
        </section>

        {query.isError && report && <div className="dashboard-inline-warning" role="status">A atualização falhou. Exibindo os últimos dados carregados.</div>}
        <section className="dashboard-chart-grid" aria-label="Análises">
          <article className="dashboard-panel dashboard-trend-panel">
            <div className="dashboard-panel-heading"><div><span className="dash-panel-kicker">MOVIMENTO DE MENSAGENS</span><h2>Entradas e respostas</h2><p>Volume diário de conversas recebidas e enviadas</p></div><ChartDownload label="tendencia" disabled={loading || !trends.length} onClick={() => downloadCsv(`mensagens-${period}.csv`, trendCsv)} /></div>
            <div className="dashboard-chart-area" data-testid="chart-message-trend">
              {loading && !report ? <div className="dash-chart-skeleton"><i /><i /><i /><i /><i /><i /></div> : !trends.length ? <EmptyChart title="mensagens" /> : <ResponsiveContainer width="100%" height={245} debounce={0}>
                <AreaChart data={trends} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                  <defs><linearGradient id="inboundFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART_COLORS.blue} stopOpacity={0.2} /><stop offset="100%" stopColor={CHART_COLORS.blue} stopOpacity={0.01} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 5" vertical={false} stroke={gridColor} />
                  <XAxis dataKey="date" tickFormatter={(date: string) => localDate(date)} tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} minTickGap={22} />
                  <YAxis tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={{ fill: 'rgba(0,0,0,.04)', stroke: 'none' }} />
                  <Legend verticalAlign="top" align="right" height={30} iconType="circle" wrapperStyle={{ fontSize: 12, color: tickColor }} />
                  <Area type="monotone" dataKey="inbound" name="Recebidas" stroke={CHART_COLORS.blue} fill="url(#inboundFade)" strokeWidth={2.5} isAnimationActive={false} />
                  <Line type="monotone" dataKey="outbound" name="Enviadas" stroke={CHART_COLORS.purple} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>}
            </div>
          </article>
          <article className="dashboard-panel dashboard-contact-panel">
            <div className="dashboard-panel-heading"><div><span className="dash-panel-kicker">CONTATOS EM FOCO</span><h2>Mais conversas</h2><p>Contatos com mais mensagens no período</p></div><ChartDownload label="contatos" disabled={loading || !contacts.length} onClick={() => downloadCsv(`contatos-mais-ativos-${period}.csv`, contactsCsv)} /></div>
            <div className="dashboard-chart-area" data-testid="chart-top-contacts">
              {loading && !report ? <div className="dash-chart-skeleton"><i /><i /><i /><i /><i /></div> : !contacts.length ? <EmptyChart title="contatos" /> : <ResponsiveContainer width="100%" height={245} debounce={0}>
                <BarChart data={contacts.slice(0, 6)} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" horizontal={false} stroke={gridColor} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="contactName" width={92} tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={false} />
                  <Bar dataKey="messageCount" name="Mensagens" fill={CHART_COLORS.blue} fillOpacity={0.82} activeBar={{ fillOpacity: 1 }} radius={[0, 5, 5, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>}
            </div>
          </article>
          <article className="dashboard-panel dashboard-dispatch-panel">
            <div className="dashboard-panel-heading"><div><span className="dash-panel-kicker">CAMPANHAS</span><h2>Desempenho de envios</h2><p>{number(summary?.templateDispatchCount ?? 0)} disparos no período · lista recente limitada a 8</p></div><ChartDownload label="campanhas" disabled={loading || !dispatches.length} onClick={() => downloadCsv(`campanhas-${period}.csv`, dispatchCsv)} /></div>
            <div className="dispatch-summary">
              <div><span>Destinatários</span><strong>{number(summary?.templateRecipientsCount ?? 0)}</strong></div>
              <div><span>Enviadas</span><strong>{number(summary?.templateSentCount ?? 0)}</strong></div>
              <div><span>Entregues</span><strong>{number(summary?.templateDeliveredCount ?? 0)}</strong></div>
              <div><span>Lidas</span><strong>{number(summary?.templateReadCount ?? 0)}</strong></div>
              <div><span>Falhas</span><strong>{number(summary?.templateFailedCount ?? 0)}</strong></div>
              <div><span>Pendentes</span><strong>{number(summary?.templatePendingCount ?? 0)}</strong></div>
            </div>
            {loading && !report ? <div className="dash-dispatch-skeleton"><i /><i /><i /></div> : dispatches.length === 0 ? <EmptyChart title="disparos" /> : <div className="dispatch-list" data-testid="list-recent-dispatches">{dispatches.slice(0, 8).map((dispatch) => <div className="dispatch-row" key={dispatch.id} data-testid={`dispatch-${dispatch.id}`}><div className="dispatch-mark"><FileSpreadsheet size={15} /></div><div className="dispatch-name"><strong>{dispatch.templateName}</strong><span>{localDate(dispatch.createdAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {dispatch.recipientsCount} destinatários</span></div><span className={`dispatch-status status-${dispatch.status}`}>{dispatch.status}</span><div className="dispatch-delivery"><span>{dispatch.deliveredCount}/{dispatch.recipientsCount}</span><small>entregues</small></div></div>)}</div>}
          </article>
        </section>

        <section className="dashboard-panel dashboard-activity-panel">
          <div className="dashboard-panel-heading activity-heading"><div><span className="dash-panel-kicker">ATIVIDADE RECENTE</span><h2>Mensagens da operação</h2><p>Até 50 registros por página · exportação completa disponível acima</p></div><button type="button" className="dash-activity-export" onClick={exportFullReport} disabled={exportQuery.isFetching} data-testid="button-export-activity"><Download size={14} /> CSV completo</button></div>
          {loading && !report ? <div className="activity-skeleton" aria-label="Carregando atividade">{[1, 2, 3, 4].map((row) => <i key={row} />)}</div> : !activity?.items.length ? <div className="dashboard-activity-empty" data-testid="state-dashboard-activity-empty"><Inbox size={23} /><strong>Nenhuma atividade neste período</strong><span>Quando houver mensagens, elas aparecerão aqui.</span></div> : <>
            <div className="activity-table-wrap"><table className="dashboard-table"><thead><tr><th>Contato</th><th>Mensagem</th><th>Direção</th><th>Status</th><th>Data e hora</th></tr></thead><tbody>{activity.items.map((item) => <tr key={item.id} data-testid={`activity-row-${item.id}`}><td><strong className="activity-contact">{item.contactName}</strong><span className="activity-phone">{item.phoneNumber}</span></td><td className="activity-message" title={item.content}>{item.content || `Mensagem ${item.messageType}`}</td><td><span className={`activity-direction ${item.direction}`}>{item.direction === 'inbound' ? <><ArrowDownLeft size={13} /> Recebida</> : <><ArrowUpRight size={13} /> Enviada</>}</span></td><td><span className={`activity-status activity-${item.status}`}>{item.status}</span></td><td className="activity-date">{localDate(item.createdAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td></tr>)}</tbody></table></div>
            <div className="activity-pagination" data-testid="pagination-dashboard-activity"><span>{number(activity.total)} mensagens · Página {activity.page} de {Math.max(activity.totalPages, 1)}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(current - 1, 1))} data-testid="button-activity-previous">Anterior</button><button type="button" disabled={page >= activity.totalPages || loading} onClick={() => setPage((current) => Math.min(current + 1, activity.totalPages))} data-testid="button-activity-next">Próxima</button></div></div>
          </>}
        </section>
        <details className="dashboard-definitions"><summary>Como interpretar estes indicadores</summary><div>
          <p><strong>Taxa e tempo de resposta:</strong> considera mensagens recebidas seguidas por uma resposta enviada com sucesso antes da próxima mensagem recebida. O tempo médio usa essas mesmas respostas.</p>
          <p><strong>Aguardando equipe ou cliente:</strong> direção da última mensagem que não seja reação em cada conversa; envios pendentes ou com falha são excluídos.</p>
          <p><strong>Não lidas:</strong> conversas com base no contador de mensagens não lidas armazenado.</p>
          <p><strong>Período e datas:</strong> calculados e exibidos no fuso America/Belem. O CSV completo inclui todas as mensagens e disparos de templates do período selecionado.</p>
        </div></details>
        <footer className="dashboard-footer"><span><Wifi size={13} /> Dados do workspace</span><span>{report?.generatedAt ? `Relatório gerado ${localDate(report.generatedAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Visão operacional'}</span></footer>
      </> : null}
    </section>
  );
}
