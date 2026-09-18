import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  CircleHelp,
  Clipboard,
  Inbox,
  Loader2,
  Menu,
  MessageCircle,
  MoreVertical,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  UserRound,
  Video,
  Wifi,
  X,
} from 'lucide-react';
import {
  getGetConnectionQueryKey,
  getListConversationMessagesQueryKey,
  getListConversationsQueryKey,
  useConnectWhatsApp,
  useDisconnectWhatsApp,
  useGetConnection,
  useListConversationMessages,
  useListConversations,
  useSendConversationMessage,
  useStartConversation,
  type ChatMessage,
  type ConnectionStatus,
  type Conversation,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const verifiedBadgePath = '/assets/SELO_META_VERIFIED_1789757214597.png';

function errorText(error: unknown) {
  if (!error) return 'Não foi possível concluir a operação.';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message ?? 'Erro inesperado.');
  }
  return 'Erro inesperado. Tente novamente.';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
}

function formatClock(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatDay(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return formatClock(value);
  if (date.toDateString() === yesterday.toDateString()) return 'ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'read' || status === 'delivered') return <CheckCheck size={14} strokeWidth={2.4} />;
  if (status === 'sent') return <Check size={14} strokeWidth={2.4} />;
  if (status === 'failed') return <AlertCircle size={14} />;
  return <Loader2 size={13} className="animate-spin" />;
}

function Avatar({ name, size = 'normal' }: { name: string; size?: 'normal' | 'large' }) {
  return (
    <div className={`${size === 'large' ? 'chat-contact-photo' : ''} avatar`} aria-hidden="true">
      {initials(name || 'WA')}
    </div>
  );
}

function NavigationRail({ onSettings, connected, profilePictureUrl }: { onSettings: () => void; connected: boolean; profilePictureUrl?: string | null }) {
  return (
    <aside className="wa-rail" aria-label="Navegação principal">
      <div className="rail-brand" aria-label="WhatsApp Recovery IA"><MessageCircle size={23} /></div>
      <nav className="rail-nav">
        <button type="button" className="rail-btn" data-active="true" onClick={() => undefined} aria-label="Conversas" data-testid="rail-conversations"><MessageCircle size={23} /></button>
        <button type="button" className="rail-btn" onClick={() => undefined} aria-label="Atualizações" data-testid="rail-updates"><Wifi size={22} /></button>
        <button type="button" className="rail-btn" onClick={() => undefined} aria-label="Contatos" data-testid="rail-contacts"><UserRound size={22} /></button>
        <button type="button" className="rail-btn" onClick={() => undefined} aria-label="Chamadas" data-testid="rail-calls"><Phone size={22} /></button>
      </nav>
      <div className="rail-bottom">
        <button type="button" className="rail-btn" onClick={onSettings} aria-label="Configurações" data-testid="rail-settings"><Settings size={22} /></button>
        <button type="button" className="rail-btn" onClick={onSettings} aria-label={connected ? 'Perfil conectado' : 'Configurar conexão'} data-testid="rail-profile">
          <div
            className={`profile-photo !m-0 !h-8 !w-8 text-[10px] ${connected ? 'connected-profile-photo' : ''}`}
            style={profilePictureUrl ? { backgroundImage: `url(${profilePictureUrl})` } : undefined}
          >
            {connected ? '' : '?'}
          </div>
        </button>
      </div>
    </aside>
  );
}

function ConnectedProfile({ connection, onSettings }: { connection?: ConnectionStatus; onSettings: () => void }) {
  const selectedPhone = connection?.phoneNumbers.find((phone) => phone.id === connection.selectedPhoneNumberId) ?? connection?.phoneNumbers[0];
  const name = selectedPhone?.verifiedName || 'Número comercial';
  const number = selectedPhone?.displayPhoneNumber || 'Número não conectado';
  const profileStyle = selectedPhone?.profilePictureUrl ? { backgroundImage: `url(${selectedPhone.profilePictureUrl})` } : undefined;
  return (
    <div className="profile-card">
      <div className={`profile-photo ${connection?.connected ? 'connected-profile-photo' : ''}`} style={profileStyle} aria-hidden="true">
        {connection?.connected ? '' : initials(selectedPhone?.verifiedName || 'WA')}
      </div>
      <div className="profile-details">
        <strong data-testid="text-connected-verified-name">
          {name}
          {connection?.connected && <img className="verified-badge" src={verifiedBadgePath} alt="Meta Verified" />}
        </strong>
        <p data-testid="text-connected-phone">{number}</p>
      </div>
      <button type="button" className="action-btn profile-action" onClick={onSettings} aria-label="Abrir perfil e configurações" data-testid="button-open-profile"><Settings size={18} /></button>
    </div>
  );
}

function Sidebar({
  conversations,
  selectedId,
  setSelectedId,
  connected,
  connection,
  loading,
  error,
  onSettings,
  onNewConversation,
  mobileOpen,
  onCloseMobile,
}: {
  conversations: Conversation[];
  selectedId: number | null;
  setSelectedId: (id: number) => void;
  connected: boolean;
  connection?: ConnectionStatus;
  loading: boolean;
  error: unknown;
  onSettings: () => void;
  onNewConversation: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) => (
      conversation.contact.name.toLowerCase().includes(needle)
      || conversation.contact.phoneNumber.includes(needle)
      || conversation.lastMessage.content.toLowerCase().includes(needle)
    ));
  }, [conversations, search]);

  return (
    <aside className="sidebar-panel" data-open={mobileOpen}>
      <header className="sidebar-header">
        <div>
          <div className="brand-title">Conversas</div>
          <div className="brand-subtitle">Recovery IA · atendimento</div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="action-btn" onClick={onNewConversation} data-testid="button-new-conversation" aria-label="Nova conversa"><Plus size={21} /></button>
          <button type="button" className="action-btn md:hidden" onClick={onCloseMobile} data-testid="button-close-sidebar" aria-label="Fechar conversas"><X size={19} /></button>
        </div>
      </header>

      <ConnectedProfile connection={connection} onSettings={onSettings} />

      <div className="sidebar-tools">
        <div className="list-caption">
          <span className={`connection-pill ${connected ? '' : 'offline'}`}><span className="dot" />{connected ? 'Conectado' : 'Não conectado'}</span>
          <span>{conversations.length} {conversations.length === 1 ? 'conversa' : 'conversas'}</span>
        </div>
        <label className="search-box">
          <Search size={17} />
          <input type="search" placeholder="Pesquisar" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-conversations" aria-label="Pesquisar conversas" />
        </label>
      </div>

      <div className="conversation-list quiet-scroll">
        {loading && (
          <div className="space-y-1 px-3 py-2" data-testid="state-conversations-loading">
            {[1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg px-2 py-3">
                <div className="skeleton h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2"><div className="skeleton h-3 w-32 rounded" /><div className="skeleton h-2.5 w-44 rounded" /></div>
              </div>
            ))}
          </div>
        )}
        {Boolean(error) && !loading && (
          <div className="m-4 status-note" data-testid="state-conversations-error"><AlertCircle size={16} /><span><strong className="block">Falha ao carregar conversas</strong><small>{errorText(error)}</small></span></div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="px-7 py-14 text-center" data-testid="state-conversations-empty">
            <Inbox className="mx-auto mb-3 text-[#87938e]" size={30} strokeWidth={1.4} />
            <p className="text-sm font-medium text-[#e3e9e6]">{search ? 'Nenhuma conversa encontrada' : 'Sua caixa está vazia'}</p>
            <p className="mt-1 text-xs leading-relaxed text-[#89958f]">{search ? 'Tente buscar por outro nome ou telefone.' : 'Novas mensagens recebidas aparecerão aqui.'}</p>
          </div>
        )}
        {!loading && filtered.map((conversation) => (
          <button
            type="button"
            key={conversation.id}
            className="conversation-row"
            data-active={conversation.id === selectedId}
            onClick={() => { setSelectedId(conversation.id); onCloseMobile(); }}
            data-testid={`conversation-${conversation.id}`}
          >
            <Avatar name={conversation.contact.name} />
            <div className="conversation-row-content">
              <div className="conversation-row-name">
                <strong>{conversation.contact.name}</strong>
                <span className="conversation-row-time">{formatDay(conversation.updatedAt)}</span>
              </div>
              <div className="conversation-row-preview">
                <p>{conversation.lastMessage.content || 'Sem mensagem de texto'}</p>
                {conversation.unreadCount > 0 && <span className="unread-badge">{conversation.unreadCount}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
      <footer className="border-t border-[#292e2c] px-5 py-3">
        <button type="button" className="flex w-full items-center gap-2 text-left text-[11px] text-[#89958f] hover:text-[#eaf1ed]" onClick={onSettings} data-testid="button-sidebar-connection">
          <Wifi size={14} className={connected ? 'text-[#48c976]' : 'text-[#dfb76d]'} />
          {connected ? 'WhatsApp Cloud API ativo' : 'Configure sua conexão'}
          <span className="ml-auto">›</span>
        </button>
      </footer>
    </aside>
  );
}

function ChatEmpty({ connected, onSettings }: { connected: boolean; onSettings: () => void }) {
  return (
    <div className="empty-chat" data-testid="state-chat-empty">
      <div className="empty-chat-card rise-in">
        <div className="empty-chat-icon"><MessageCircle size={32} strokeWidth={1.4} /></div>
        <h1>WhatsApp Recovery IA</h1>
        <p>Selecione uma conversa à esquerda ou inicie uma nova conversa para responder aos seus clientes.</p>
        {!connected && <button type="button" className="btn-primary mt-6" onClick={onSettings} data-testid="button-empty-connect"><Settings size={16} /> Configurar conexão</button>}
        <div className="mt-7 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[.12em] text-[#7f8d87]"><ShieldCheck size={14} /> API oficial da Meta</div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const outbound = message.direction === 'outbound';
  return (
    <div className={`message-row ${outbound ? 'outbound' : 'inbound'} rise-in`} data-testid={`message-${message.id}`}>
      <div className={`bubble ${outbound ? 'bubble-out' : 'bubble-in'} ${message.status === 'failed' ? 'border border-[#8d4942]' : ''}`}>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        <div className="bubble-meta">
          {formatClock(message.createdAt)}
          {outbound && <StatusIcon status={message.status} />}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({
  conversation,
  connected,
  onBack,
  onSettings,
}: {
  conversation: Conversation | undefined;
  connected: boolean;
  onBack: () => void;
  onSettings: () => void;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [optimistic, setOptimistic] = useState<ChatMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const messagesQuery = useListConversationMessages(conversation?.id ?? 0, {
    query: { enabled: Boolean(conversation?.id), queryKey: getListConversationMessagesQueryKey(conversation?.id ?? 0), refetchInterval: 5000 },
  });
  const sendMessage = useSendConversationMessage();
  const messages = messagesQuery.data ?? [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const messageContent = content.trim();
    if (!conversation || !messageContent || sendMessage.isPending) return;
    const temporary: ChatMessage = { id: -Date.now(), direction: 'outbound', content: messageContent, messageType: 'text', status: 'sending', createdAt: new Date().toISOString(), whatsappMessageId: null };
    setOptimistic(temporary);
    setContent('');
    sendMessage.mutate({ conversationId: conversation.id, data: { content: messageContent } }, {
      onSuccess: () => {
        setOptimistic(null);
        void queryClient.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversation.id) });
        void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      },
      onError: () => setOptimistic({ ...temporary, status: 'failed' }),
    });
  };

  if (!conversation) return <ChatEmpty connected={connected} onSettings={onSettings} />;

  return (
    <section className="chat-area" data-testid="panel-chat">
      <header className="chat-topbar">
        <button type="button" className="action-btn mobile-only" onClick={onBack} data-testid="button-back-to-conversations" aria-label="Voltar para conversas"><ArrowLeft size={20} /></button>
        <Avatar name={conversation.contact.name} size="large" />
        <div className="chat-contact-meta">
          <h2 className="chat-contact-name" data-testid={`text-contact-name-${conversation.id}`}>{conversation.contact.name}</h2>
          <p className="chat-contact-status">{conversation.contact.phoneNumber}</p>
        </div>
        <div className="chat-header-actions">
          <button type="button" className="action-btn" onClick={() => { window.location.href = `tel:${conversation.contact.phoneNumber}`; }} data-testid="button-call-contact" aria-label="Ligar para contato"><Phone size={19} /></button>
          <button type="button" className="action-btn" onClick={() => undefined} data-testid="button-video-contact" aria-label="Iniciar chamada de vídeo"><Video size={19} /></button>
          <div className="relative">
            <button type="button" className="action-btn" onClick={() => setMenuOpen((open) => !open)} data-testid="button-chat-menu" aria-label="Mais opções"><MoreVertical size={20} /></button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-10 w-52 rounded-lg border border-[#4b514e] bg-[#272b29] p-2 shadow-2xl" data-testid="menu-chat-options">
                <div className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-[#c0cac4]"><UserRound size={14} /> Dados do contato</div>
                <div className="border-t border-[#404643] px-2 pb-1 pt-2 text-[11px] text-[#eef3ef]">{conversation.contact.phoneNumber}</div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="message-wall quiet-scroll" data-testid={`messages-${conversation.id}`}>
        <div className="message-wall-inner">
          <div className="wall-notice">Mensagens sincronizadas pelo webhook</div>
          {messagesQuery.isLoading && (
            <div className="space-y-3 py-4" data-testid="state-messages-loading">
              <div className="skeleton ml-auto h-11 w-44 rounded-lg opacity-60" />
              <div className="skeleton h-14 w-64 rounded-lg opacity-60" />
              <div className="skeleton ml-auto h-11 w-52 rounded-lg opacity-60" />
            </div>
          )}
          {messagesQuery.isError && <div className="status-note mx-auto my-5 max-w-sm justify-center text-center" data-testid="state-messages-error"><AlertCircle size={17} /> Não foi possível carregar as mensagens. A atualização automática continuará tentando.</div>}
          {!messagesQuery.isLoading && !messagesQuery.isError && messages.length === 0 && !optimistic && <div className="py-20 text-center text-xs text-[#89958f]" data-testid="state-messages-empty">Nenhuma mensagem nesta conversa.</div>}
          {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
          {optimistic && <MessageBubble message={optimistic} />}
        </div>
      </div>

      <div className="composer-wrap">
        <form className="composer" onSubmit={submit}>
          <textarea
            className="composer-field"
            rows={1}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
            placeholder="Digite uma mensagem"
            disabled={sendMessage.isPending}
            data-testid="input-message"
            aria-label="Mensagem"
          />
          <button type="submit" className="send-btn" disabled={!content.trim() || sendMessage.isPending} data-testid="button-send-message" aria-label="Enviar mensagem">
            {sendMessage.isPending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
          </button>
        </form>
        {sendMessage.isError && <p className="mx-auto mt-2 max-w-[1000px] text-right text-[11px] text-[#eea59e]" data-testid="status-send-error">{errorText(sendMessage.error)}</p>}
      </div>
    </section>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const connectionQuery = useGetConnection({ query: { refetchInterval: 10000, queryKey: getGetConnectionQueryKey() } });
  const connection = connectionQuery.data;
  const [accessToken, setAccessToken] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [formError, setFormError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedVerifyToken, setCopiedVerifyToken] = useState(false);
  const connect = useConnectWhatsApp();
  const disconnect = useDisconnectWhatsApp();

  useEffect(() => {
    if (connection?.businessAccountId) setBusinessAccountId(connection.businessAccountId);
    if (connection?.selectedPhoneNumberId) setPhoneNumberId(connection.selectedPhoneNumberId);
  }, [connection]);

  const isConnected = Boolean(connection?.connected);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    if (!accessToken.trim() || !businessAccountId.trim()) { setFormError('Informe o token de acesso e o ID da conta comercial.'); return; }
    connect.mutate({ data: { accessToken: accessToken.trim(), businessAccountId: businessAccountId.trim(), ...(phoneNumberId ? { phoneNumberId } : {}) } }, {
      onSuccess: () => { setAccessToken(''); void queryClient.invalidateQueries({ queryKey: getGetConnectionQueryKey() }); },
      onError: (error) => setFormError(errorText(error)),
    });
  };

  const disconnectNow = () => {
    disconnect.mutate(undefined, {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetConnectionQueryKey() }),
      onError: (error) => setFormError(errorText(error)),
    });
  };
  const copyWebhook = () => {
    if (!connection?.webhookUrl) return;
    void navigator.clipboard?.writeText(connection.webhookUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const copyVerifyToken = () => {
    if (!connection?.webhookVerifyToken) return;
    void navigator.clipboard?.writeText(connection.webhookVerifyToken);
    setCopiedVerifyToken(true);
    window.setTimeout(() => setCopiedVerifyToken(false), 1800);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-testid="dialog-settings">
      <div className="settings-card rise-in">
        <div className="settings-section flex items-start justify-between">
          <div><p className="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#68c98a]">Configurações da conta</p><h2 id="settings-title" className="settings-title">Conexão WhatsApp</h2><p className="settings-copy">Credenciais ficam somente na API do servidor.</p></div>
          <button type="button" className="action-btn" onClick={onClose} data-testid="button-close-settings" aria-label="Fechar configurações"><X size={20} /></button>
        </div>
        <div className="space-y-5 p-5">
          {connectionQuery.isLoading && <div className="space-y-3" data-testid="state-connection-loading"><div className="skeleton h-12 rounded-lg" /><div className="skeleton h-12 rounded-lg" /></div>}
          {connectionQuery.isError && <div className="status-note" data-testid="state-connection-error"><AlertCircle size={16} /> Não foi possível consultar o status atual da conexão.</div>}
          <div className={`flex items-center justify-between rounded-lg border p-4 ${isConnected ? 'border-[#35684b] bg-[#1b3024]' : 'border-[#685330] bg-[#332b1e]'}`} data-testid="status-connection">
            <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-[#2b4736] text-[#68d18c]"><Wifi size={17} /></div><div><p className="text-sm font-medium">{isConnected ? 'WhatsApp conectado' : 'Conexão pendente'}</p><p className="mt-1 text-[11px] text-[#a2aaa5]">{isConnected ? 'Mensagens podem ser recebidas e enviadas.' : 'Adicione as credenciais da Meta para começar.'}</p></div></div>
            <span className={`connection-pill ${isConnected ? '' : 'offline'}`}><span className="dot" />{isConnected ? 'Ativo' : 'Offline'}</span>
          </div>
          {!isConnected && (
            <form className="space-y-4" onSubmit={submit}>
              <div className="field"><label className="field-label" htmlFor="access-token">Token de acesso</label><input id="access-token" className="field-input" type="password" autoComplete="new-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Cole o token permanente da Meta" data-testid="input-access-token" /><p className="field-help">O token é usado para validar a conexão e não é salvo no navegador.</p></div>
              <div className="field"><label className="field-label" htmlFor="business-account-id">ID da conta comercial</label><input id="business-account-id" className="field-input" value={businessAccountId} onChange={(event) => setBusinessAccountId(event.target.value)} placeholder="ID da conta WhatsApp Business" data-testid="input-business-account-id" /></div>
              <div className="field"><label className="field-label" htmlFor="phone-number-id">Número de telefone <span className="font-normal normal-case tracking-normal text-[#8d9993]">(opcional)</span></label>{connection?.phoneNumbers?.length ? <select id="phone-number-id" className="field-input" value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} data-testid="select-phone-number"><option value="">Selecionar depois</option>{connection.phoneNumbers.map((phone) => <option key={phone.id} value={phone.id}>{phone.verifiedName} · {phone.displayPhoneNumber}</option>)}</select> : <input id="phone-number-id" className="field-input" value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} placeholder="ID do número no WhatsApp Business" data-testid="input-phone-number-id" />}</div>
              {formError && <p className="flex items-center gap-2 text-xs text-[#eea59e]" data-testid="status-connection-error"><AlertCircle size={15} />{formError}</p>}
              <button type="submit" className="btn-primary w-full" disabled={connect.isPending} data-testid="button-connect-whatsapp">{connect.isPending ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}{connect.isPending ? 'Validando conexão...' : 'Conectar WhatsApp'}</button>
            </form>
          )}
          {isConnected && connection && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#414845] bg-[#171b19] p-4">
                <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-medium"><Smartphone size={16} className="text-[#65cb87]" /> Número conectado</div><span className="text-[11px] text-[#8c9993]">{connection.phoneNumbers.length} disponível(is)</span></div>
                {connection.phoneNumbers.length > 0 ? <div className="divide-y divide-[#303633]">{connection.phoneNumbers.map((phone) => <div className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0" key={phone.id}><div><p className="text-[13px] font-medium">{phone.verifiedName || 'Número comercial'}</p><p className="mt-1 text-[11px] text-[#8f9b95]">{phone.displayPhoneNumber} · qualidade {phone.qualityRating}</p></div>{phone.id === connection.selectedPhoneNumberId && <span className="flex items-center gap-1 text-[11px] font-semibold text-[#68d18c]"><Check size={14} /> selecionado</span>}</div>)}</div> : <p className="text-xs text-[#8f9b95]">Nenhum número retornado pela conta.</p>}
              </div>
              <div className="rounded-lg border border-[#414845] bg-[#171b19] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium"><ShieldCheck size={16} className="text-[#65cb87]" /> Callback do webhook</div>
                <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-md bg-[#242a27] px-2.5 py-2 text-[11px] text-[#a7dbb6]" data-testid="text-webhook-url">{connection.webhookUrl}</code><button type="button" className="btn-ghost shrink-0 !p-2" onClick={copyWebhook} data-testid="button-copy-webhook" aria-label="Copiar URL do webhook">{copied ? <Check size={16} /> : <Clipboard size={16} />}</button></div>
                <div className="mt-3 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-md bg-[#242a27] px-2.5 py-2 text-[11px] text-[#e6c67e]" data-testid="text-webhook-verify-token">{connection.webhookVerifyToken ?? 'Não configurado'}</code><button type="button" className="btn-ghost shrink-0 !p-2" onClick={copyVerifyToken} disabled={!connection.webhookVerifyToken} data-testid="button-copy-webhook-verify-token" aria-label="Copiar token de verificação">{copiedVerifyToken ? <Check size={16} /> : <Clipboard size={16} />}</button></div>
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8e9a94]"><span className={`dot ${connection.webhookVerifyTokenConfigured ? 'text-[#68d18c]' : 'text-[#e0b66c]'}`} />{connection.webhookVerifyTokenConfigured ? 'Token de verificação pronto para usar no Meta' : 'Configure WHATSAPP_WEBHOOK_VERIFY_TOKEN nos Secrets'}</p>
              </div>
              {formError && <p className="flex items-center gap-2 text-xs text-[#eea59e]" data-testid="status-connection-error"><AlertCircle size={15} />{formError}</p>}
              <button type="button" className="btn-ghost btn-danger w-full" onClick={disconnectNow} disabled={disconnect.isPending} data-testid="button-disconnect-whatsapp">{disconnect.isPending ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}{disconnect.isPending ? 'Desconectando...' : 'Desconectar WhatsApp'}</button>
            </div>
          )}
          <div className="flex items-start gap-2 border-t border-[#383d3b] pt-4 text-[11px] leading-relaxed text-[#8f9b95]"><CircleHelp size={15} className="mt-0.5 shrink-0" />A conexão usa os endpoints oficiais da WhatsApp Cloud API. O servidor recebe eventos pelo webhook e mantém o histórico das conversas.</div>
        </div>
      </div>
    </div>
  );
}

function NewConversationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (conversation: Conversation) => void }) {
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [content, setContent] = useState('');
  const [formError, setFormError] = useState('');
  const startConversation = useStartConversation();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    if (phoneNumber.trim().length < 8 || !content.trim()) { setFormError('Informe um telefone válido e a primeira mensagem.'); return; }
    startConversation.mutate({ data: { phoneNumber: phoneNumber.trim(), content: content.trim() } }, {
      onSuccess: (result) => { void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }); onCreated(result.conversation); },
      onError: (error) => setFormError(errorText(error)),
    });
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title" data-testid="dialog-new-conversation">
      <div className="settings-card rise-in">
        <div className="settings-section flex items-start justify-between"><div><p className="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#68c98a]">Novo contato</p><h2 id="new-conversation-title" className="settings-title">Iniciar conversa</h2><p className="settings-copy">A primeira mensagem abre uma nova conversa na API.</p></div><button type="button" className="action-btn" onClick={onClose} data-testid="button-close-new-conversation" aria-label="Fechar nova conversa"><X size={20} /></button></div>
        <form className="space-y-4 p-5" onSubmit={submit}>
          <div className="field"><label className="field-label" htmlFor="new-phone-number">Telefone com DDI</label><input id="new-phone-number" className="field-input" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+55 11 99999-0000" data-testid="input-new-phone-number" /><p className="field-help">Use o mesmo formato cadastrado no WhatsApp.</p></div>
          <div className="field"><label className="field-label" htmlFor="new-message">Mensagem inicial</label><textarea id="new-message" className="field-input min-h-28 resize-y" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Olá, como podemos ajudar?" data-testid="input-new-message" /></div>
          {formError && <p className="flex items-center gap-2 text-xs text-[#eea59e]" data-testid="status-new-conversation-error"><AlertCircle size={15} />{formError}</p>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={onClose} data-testid="button-cancel-new-conversation">Cancelar</button><button type="submit" className="btn-primary" disabled={startConversation.isPending} data-testid="button-start-conversation">{startConversation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{startConversation.isPending ? 'Iniciando...' : 'Iniciar conversa'}</button></div>
        </form>
      </div>
    </div>
  );
}

function Home() {
  const conversationsQuery = useListConversations({ query: { refetchInterval: 5000, queryKey: getListConversationsQueryKey() } });
  const connectionQuery = useGetConnection({ query: { refetchInterval: 10000, queryKey: getGetConnectionQueryKey() } });
  const conversations = conversationsQuery.data ?? [];
  const connection = connectionQuery.data;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const selectedConversation = useMemo(() => conversations.find((item) => item.id === selectedId), [conversations, selectedId]);

  useEffect(() => {
    if (selectedId === null && conversations.length > 0) setSelectedId(conversations[0].id);
    if (selectedId !== null && conversations.length > 0 && !conversations.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [conversations, selectedId]);

  return (
    <main className="app-frame">
      <div className="inbox-shell">
        <NavigationRail
          onSettings={() => setSettingsOpen(true)}
          connected={Boolean(connection?.connected)}
          profilePictureUrl={connection?.phoneNumbers.find((phone) => phone.id === connection.selectedPhoneNumberId)?.profilePictureUrl}
        />
        <Sidebar conversations={conversations} selectedId={selectedId} setSelectedId={(id) => { setSelectedId(id); setMobileListOpen(false); }} connected={Boolean(connection?.connected)} connection={connection} loading={conversationsQuery.isLoading} error={conversationsQuery.error} onSettings={() => setSettingsOpen(true)} onNewConversation={() => setNewConversationOpen(true)} mobileOpen={mobileListOpen} onCloseMobile={() => setMobileListOpen(false)} />
        <button type="button" className="mobile-scrim" aria-label="Fechar lista de conversas" onClick={() => setMobileListOpen(false)} data-testid="button-mobile-scrim" />
        <ChatPanel conversation={selectedConversation} connected={Boolean(connection?.connected)} onBack={() => setMobileListOpen(true)} onSettings={() => setSettingsOpen(true)} />
      </div>
      <button type="button" className="mobile-list-trigger" onClick={() => setMobileListOpen(true)} data-testid="button-open-conversations" aria-label="Abrir lista de conversas"><Menu size={20} /></button>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {newConversationOpen && <NewConversationDialog onClose={() => setNewConversationOpen(false)} onCreated={(conversation) => { setNewConversationOpen(false); setSelectedId(conversation.id); setMobileListOpen(false); }} />}
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;