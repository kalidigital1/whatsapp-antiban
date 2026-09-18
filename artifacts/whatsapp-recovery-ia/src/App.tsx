import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
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
  if (status === 'read' || status === 'delivered') return <CheckCheck size={14} strokeWidth={2.2} />;
  if (status === 'sent') return <Check size={14} strokeWidth={2.2} />;
  if (status === 'failed') return <AlertCircle size={14} />;
  return <Loader2 size={13} className="animate-spin" />;
}

function Avatar({ name, size = 'normal' }: { name: string; size?: 'normal' | 'large' }) {
  return (
    <div className={size === 'large' ? 'avatar !h-11 !w-11' : 'avatar'} aria-hidden="true">
      {initials(name)}
    </div>
  );
}

function Sidebar({
  conversations,
  selectedId,
  setSelectedId,
  connected,
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
    <aside className="sidebar-panel flex min-h-0 flex-col border-r border-[hsl(210_18%_16%)] bg-[hsl(208_36%_7%)]" data-open={mobileOpen}>
      <header className="flex items-center justify-between border-b border-[hsl(210_18%_16%)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-[hsl(162_37%_19%)] text-[hsl(162_62%_60%)]">
            <MessageCircle size={19} fill="currentColor" strokeWidth={1.8} />
          </div>
          <div>
            <p className="text-[14px] font-bold tracking-tight text-[hsl(var(--foreground))]">Recovery IA</p>
            <p className="mono text-[9px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">central de conversas</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost !p-2" onClick={onNewConversation} data-testid="button-new-conversation" aria-label="Nova conversa">
            <Plus size={19} />
          </button>
          <button type="button" className="btn-ghost !p-2 md:hidden" onClick={onCloseMobile} data-testid="button-close-sidebar" aria-label="Fechar conversas">
            <X size={18} />
          </button>
          <button type="button" className="btn-ghost !p-2" onClick={onSettings} data-testid="button-open-settings" aria-label="Abrir configurações">
            <Settings size={18} />
          </button>
        </div>
      </header>

      <div className="px-4 pb-3 pt-3">
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <span className={`connection-pill ${connected ? 'connected' : 'offline'}`}>
              <span className="dot" /> {connected ? 'Conectado' : 'Não conectado'}
            </span>
          </div>
          <span className="mono text-[10px] text-[hsl(var(--muted-foreground))]">{conversations.length} conversas</span>
        </div>
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={16} />
          <input
            type="search"
            className="field-input !rounded-[7px] !border-transparent !bg-[hsl(210_20%_12%)] !py-[9px] !pl-9 text-[13px]"
            placeholder="Buscar conversas"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            data-testid="input-search-conversations"
          />
        </label>
      </div>

      <div className="conversation-list quiet-scroll flex-1">
        {loading && (
          <div className="space-y-1 px-3 py-2" data-testid="state-conversations-loading">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg px-2 py-3">
                <div className="skeleton h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2"><div className="skeleton h-3 w-28 rounded" /><div className="skeleton h-2.5 w-40 rounded" /></div>
              </div>
            ))}
          </div>
        )}
        {Boolean(error) && !loading && (
          <div className="m-4 rounded-lg border border-[hsl(3_45%_30%)] bg-[hsl(3_30%_14%)] p-4 text-sm text-[hsl(3_77%_76%)]" data-testid="state-conversations-error">
            <div className="mb-2 flex items-center gap-2 font-semibold"><AlertCircle size={16} /> Falha ao carregar conversas</div>
            <p className="text-xs opacity-80">{errorText(error)}</p>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="px-7 py-14 text-center" data-testid="state-conversations-empty">
            <Inbox className="mx-auto mb-3 text-[hsl(var(--muted-foreground))]" size={27} strokeWidth={1.4} />
            <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{search ? 'Nenhuma conversa encontrada' : 'Sua caixa está vazia'}</p>
            <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{search ? 'Tente buscar por outro nome ou telefone.' : 'Novas mensagens recebidas aparecerão aqui.'}</p>
          </div>
        )}
        {!loading && filtered.map((conversation) => (
          <button
            type="button"
            key={conversation.id}
            className="conversation-row flex gap-3 px-4 py-3.5"
            data-active={conversation.id === selectedId}
            onClick={() => { setSelectedId(conversation.id); onCloseMobile(); }}
            data-testid={`conversation-${conversation.id}`}
          >
            <Avatar name={conversation.contact.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <span className="truncate text-[14px] font-semibold text-[hsl(var(--foreground))]">{conversation.contact.name}</span>
                <span className="shrink-0 text-[10px] text-[hsl(var(--muted-foreground))]">{formatDay(conversation.updatedAt)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="truncate text-[12px] text-[hsl(var(--muted-foreground))]">{conversation.lastMessage.content || 'Sem mensagem de texto'}</p>
                {conversation.unreadCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--primary))] px-1 text-[10px] font-bold text-[hsl(var(--primary-foreground))]">{conversation.unreadCount}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
      <footer className="border-t border-[hsl(210_18%_16%)] px-5 py-3">
        <button type="button" className="flex w-full items-center gap-2 text-left text-[11px] text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]" onClick={onSettings} data-testid="button-sidebar-connection">
          <Wifi size={14} className={connected ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--accent))]'} />
          {connected ? 'WhatsApp Cloud API ativo' : 'Configure sua conexão'}
          <ChevronDown className="ml-auto -rotate-90" size={13} />
        </button>
      </footer>
    </aside>
  );
}

function ChatEmpty({ connected, onSettings }: { connected: boolean; onSettings: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-7 text-center" data-testid="state-chat-empty">
      <div className="rise-in max-w-[390px]">
        <div className="empty-illustration mx-auto mb-7"><MessageCircle size={34} strokeWidth={1.3} /></div>
        <h1 className="text-[26px] font-semibold tracking-[-.04em] text-[hsl(var(--foreground))]">Whatsapp Recovery IA</h1>
        <p className="mx-auto mt-3 max-w-[340px] text-[13px] leading-6 text-[hsl(var(--muted-foreground))]">Selecione uma conversa à esquerda ou inicie uma nova conversa para começar.</p>
        {!connected && (
          <button type="button" className="btn-primary mt-7" onClick={onSettings} data-testid="button-empty-connect">
            <Settings size={16} /> Configurar conexão
          </button>
        )}
        <div className="mt-9 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]"><ShieldCheck size={14} /> mensagens protegidas pela API oficial</div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const outbound = message.direction === 'outbound';
  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'} rise-in`} data-testid={`message-${message.id}`}>
      <div className={`bubble ${outbound ? 'bubble-out' : 'bubble-in'} ${message.status === 'failed' ? 'border border-[hsl(3_55%_40%)]' : ''}`}>
        <div className="whitespace-pre-wrap break-words text-[hsl(var(--foreground))]">{message.content}</div>
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${message.status === 'failed' ? 'text-[hsl(3_77%_72%)]' : 'text-[hsl(var(--muted-foreground))]'}`}>
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
    query: {
      enabled: Boolean(conversation?.id),
      queryKey: getListConversationMessagesQueryKey(conversation?.id ?? 0),
      refetchInterval: 5000,
    },
  });
  const sendMessage = useSendConversationMessage();
  const messages = messagesQuery.data ?? [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const messageContent = content.trim();
    if (!conversation || !messageContent || sendMessage.isPending) return;
    const temporary: ChatMessage = {
      id: -Date.now(),
      direction: 'outbound',
      content: messageContent,
      messageType: 'text',
      status: 'sending',
      createdAt: new Date().toISOString(),
      whatsappMessageId: null,
    };
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
        <button type="button" className="btn-ghost mr-1 !p-2 md:hidden" onClick={onBack} data-testid="button-back-to-conversations" aria-label="Voltar para conversas"><ArrowLeft size={19} /></button>
        <Avatar name={conversation.contact.name} size="large" />
        <div className="ml-3 min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-[hsl(var(--foreground))]" data-testid={`text-contact-name-${conversation.id}`}>{conversation.contact.name}</h2>
          <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">{conversation.contact.phoneNumber}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="btn-ghost !p-2" onClick={() => { window.location.href = `tel:${conversation.contact.phoneNumber}`; }} data-testid="button-call-contact" aria-label="Ligar para contato"><Phone size={17} /></button>
          <div className="relative">
            <button type="button" className="btn-ghost !p-2" onClick={() => setMenuOpen((open) => !open)} data-testid="button-chat-menu" aria-label="Mais opções"><MoreVertical size={18} /></button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-10 w-52 rounded-lg border border-[hsl(210_18%_24%)] bg-[hsl(208_28%_13%)] p-2 shadow-2xl" data-testid="menu-chat-options">
                <div className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-[hsl(var(--muted-foreground))]"><UserRound size={14} /> Dados do contato</div>
                <div className="border-t border-[hsl(210_18%_20%)] px-2 pb-1 pt-2 text-[11px] text-[hsl(var(--foreground))]">{conversation.contact.phoneNumber}</div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="message-wall quiet-scroll" data-testid={`messages-${conversation.id}`}>
        <div className="message-wall-inner space-y-2">
          <div className="mx-auto mb-5 mt-1 w-fit rounded-md border border-[hsl(40_45%_28%)] bg-[hsl(40_30%_15%)] px-3 py-1.5 text-center text-[10px] text-[hsl(40_82%_74%)]">Mensagens desta conversa são sincronizadas pelo webhook</div>
          {messagesQuery.isLoading && (
            <div className="space-y-3 py-4" data-testid="state-messages-loading">
              <div className="skeleton ml-auto h-11 w-44 rounded-lg opacity-50" />
              <div className="skeleton h-14 w-64 rounded-lg opacity-50" />
              <div className="skeleton ml-auto h-11 w-52 rounded-lg opacity-50" />
            </div>
          )}
          {messagesQuery.isError && (
            <div className="mx-auto max-w-sm rounded-lg border border-[hsl(3_45%_30%)] bg-[hsl(3_30%_14%)] p-4 text-center text-xs text-[hsl(3_77%_76%)]" data-testid="state-messages-error">
              <AlertCircle className="mx-auto mb-2" size={18} />
              Não foi possível carregar as mensagens. A atualização automática continuará tentando.
            </div>
          )}
          {!messagesQuery.isLoading && !messagesQuery.isError && messages.length === 0 && !optimistic && (
            <div className="py-20 text-center text-xs text-[hsl(var(--muted-foreground))]" data-testid="state-messages-empty">Nenhuma mensagem nesta conversa.</div>
          )}
          {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
          {optimistic && <MessageBubble message={optimistic} />}
        </div>
      </div>

      <div className="composer-wrap">
        <form className="composer" onSubmit={submit}>
          <textarea
            className="field-input max-h-32 min-h-[43px] resize-none !rounded-[8px] !py-3 text-[13px]"
            rows={1}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
            placeholder="Escreva uma mensagem"
            disabled={sendMessage.isPending}
            data-testid="input-message"
          />
          <button type="submit" className="btn-primary !h-[43px] !w-[43px] !rounded-[8px] !p-0" disabled={!content.trim() || sendMessage.isPending} data-testid="button-send-message" aria-label="Enviar mensagem">
            {sendMessage.isPending ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />}
          </button>
        </form>
        {sendMessage.isError && <p className="mx-auto mt-2 max-w-[940px] text-right text-[11px] text-[hsl(3_77%_72%)]" data-testid="status-send-error">{errorText(sendMessage.error)}</p>}
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
    if (!accessToken.trim() || !businessAccountId.trim()) {
      setFormError('Informe o token de acesso e o ID da conta comercial.');
      return;
    }
    connect.mutate({
      data: {
        accessToken: accessToken.trim(),
        businessAccountId: businessAccountId.trim(),
        ...(phoneNumberId ? { phoneNumberId } : {}),
      },
    }, {
      onSuccess: () => {
        setAccessToken('');
        void queryClient.invalidateQueries({ queryKey: getGetConnectionQueryKey() });
      },
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
      <div className="settings-card quiet-scroll rise-in">
        <div className="flex items-start justify-between border-b border-[hsl(210_18%_21%)] px-6 py-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[hsl(var(--primary))]"><Settings size={17} /><span className="mono text-[10px] uppercase tracking-[.16em]">ambiente da operação</span></div>
            <h2 id="settings-title" className="text-[22px] font-semibold tracking-[-.04em]">Conexão WhatsApp</h2>
            <p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">Credenciais ficam apenas na API do servidor.</p>
          </div>
          <button type="button" className="btn-ghost !p-2" onClick={onClose} data-testid="button-close-settings" aria-label="Fechar configurações"><X size={19} /></button>
        </div>

        <div className="space-y-6 p-6">
          {connectionQuery.isLoading && <div className="space-y-3" data-testid="state-connection-loading"><div className="skeleton h-12 rounded-lg" /><div className="skeleton h-12 rounded-lg" /></div>}
          {connectionQuery.isError && <div className="flex gap-2 rounded-lg border border-[hsl(3_45%_30%)] bg-[hsl(3_30%_14%)] p-3 text-xs text-[hsl(3_77%_76%)]" data-testid="state-connection-error"><AlertCircle size={16} className="mt-0.5 shrink-0" /> Não foi possível consultar o status atual da conexão.</div>}
          <div className={`flex items-center justify-between rounded-lg border p-4 ${isConnected ? 'border-[hsl(162_35%_29%)] bg-[hsl(162_28%_13%)]' : 'border-[hsl(40_35%_28%)] bg-[hsl(40_27%_13%)]'}`} data-testid="status-connection">
            <div className="flex items-center gap-3">
              <div className={`grid h-9 w-9 place-items-center rounded-full ${isConnected ? 'bg-[hsl(162_35%_21%)] text-[hsl(var(--primary))]' : 'bg-[hsl(40_35%_22%)] text-[hsl(var(--accent))]'}`}><Wifi size={17} /></div>
              <div><p className="text-sm font-semibold">{isConnected ? 'WhatsApp conectado' : 'Conexão pendente'}</p><p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{isConnected ? 'Mensagens podem ser recebidas e enviadas.' : 'Adicione as credenciais da Meta para começar.'}</p></div>
            </div>
            <span className={`connection-pill ${isConnected ? 'connected' : 'offline'}`}><span className="dot" />{isConnected ? 'Ativo' : 'Offline'}</span>
          </div>

          {!isConnected && (
            <form className="space-y-4" onSubmit={submit}>
              <div className="field">
                <label className="field-label" htmlFor="access-token">Token de acesso</label>
                <input id="access-token" className="field-input" type="password" autoComplete="new-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Cole o token permanente da Meta" data-testid="input-access-token" />
                <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">O token é usado uma única vez para validar a conexão e não é salvo no navegador.</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="business-account-id">ID da conta comercial</label>
                <input id="business-account-id" className="field-input" value={businessAccountId} onChange={(event) => setBusinessAccountId(event.target.value)} placeholder="Ex.: 104938274615" data-testid="input-business-account-id" />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="phone-number-id">Número de telefone <span className="font-normal normal-case tracking-normal text-[hsl(var(--muted-foreground))]">(opcional)</span></label>
                {connection?.phoneNumbers?.length ? (
                  <select id="phone-number-id" className="field-input" value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} data-testid="select-phone-number">
                    <option value="">Selecionar depois</option>
                    {connection.phoneNumbers.map((phone) => <option key={phone.id} value={phone.id}>{phone.verifiedName} · {phone.displayPhoneNumber}</option>)}
                  </select>
                ) : <input id="phone-number-id" className="field-input" value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} placeholder="ID do número no WhatsApp Business" data-testid="input-phone-number-id" />}
              </div>
              {formError && <p className="flex items-center gap-2 text-xs text-[hsl(3_77%_72%)]" data-testid="status-connection-error"><AlertCircle size={15} />{formError}</p>}
              <button type="submit" className="btn-primary w-full" disabled={connect.isPending} data-testid="button-connect-whatsapp">{connect.isPending ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}{connect.isPending ? 'Validando conexão...' : 'Conectar WhatsApp'}</button>
            </form>
          )}

          {isConnected && connection && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[hsl(210_18%_22%)] bg-[hsl(208_33%_9%)] p-4">
                <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><Smartphone size={16} className="text-[hsl(var(--primary))]" /> Número conectado</div><span className="mono text-[10px] text-[hsl(var(--muted-foreground))]">{connection.phoneNumbers.length} disponível(is)</span></div>
                {connection.phoneNumbers.length > 0 ? (
                  <div className="divide-y divide-[hsl(210_18%_18%)]">
                    {connection.phoneNumbers.map((phone) => <div className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0" key={phone.id}><div><p className="text-[13px] font-medium">{phone.verifiedName || 'Número comercial'}</p><p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{phone.displayPhoneNumber} · qualidade {phone.qualityRating}</p></div>{phone.id === connection.selectedPhoneNumberId && <span className="flex items-center gap-1 text-[11px] font-semibold text-[hsl(var(--primary))]"><Check size={14} /> selecionado</span>}</div>)}
                  </div>
                ) : <p className="text-xs text-[hsl(var(--muted-foreground))]">Nenhum número retornado pela conta.</p>}
              </div>
              <div className="rounded-lg border border-[hsl(210_18%_22%)] bg-[hsl(208_33%_9%)] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-[hsl(var(--primary))]" /> Callback do webhook</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-[hsl(210_20%_14%)] px-2.5 py-2 text-[11px] text-[hsl(162_45%_73%)]" data-testid="text-webhook-url">{connection.webhookUrl}</code>
                  <button type="button" className="btn-ghost shrink-0 !p-2" onClick={copyWebhook} data-testid="button-copy-webhook" aria-label="Copiar URL do webhook">{copied ? <Check size={16} /> : <Clipboard size={16} />}</button>
                </div>
                 <div className="mt-3 flex items-center gap-2">
                   <code className="min-w-0 flex-1 truncate rounded-md bg-[hsl(210_20%_14%)] px-2.5 py-2 text-[11px] text-[hsl(40_82%_74%)]" data-testid="text-webhook-verify-token">{connection.webhookVerifyToken ?? 'Não configurado'}</code>
                   <button type="button" className="btn-ghost shrink-0 !p-2" onClick={copyVerifyToken} disabled={!connection.webhookVerifyToken} data-testid="button-copy-webhook-verify-token" aria-label="Copiar token de verificação">{copiedVerifyToken ? <Check size={16} /> : <Clipboard size={16} />}</button>
                 </div>
                 <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]"><span className={`dot ${connection.webhookVerifyTokenConfigured ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--accent))]'}`} />{connection.webhookVerifyTokenConfigured ? 'Token de verificação pronto para usar no Meta' : 'Configure WHATSAPP_WEBHOOK_VERIFY_TOKEN nos Secrets'}</p>
              </div>
              {formError && <p className="flex items-center gap-2 text-xs text-[hsl(3_77%_72%)]" data-testid="status-connection-error"><AlertCircle size={15} />{formError}</p>}
              <button type="button" className="btn-ghost btn-danger w-full" onClick={disconnectNow} disabled={disconnect.isPending} data-testid="button-disconnect-whatsapp">{disconnect.isPending ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}{disconnect.isPending ? 'Desconectando...' : 'Desconectar WhatsApp'}</button>
            </div>
          )}
          <div className="flex items-start gap-2 border-t border-[hsl(210_18%_20%)] pt-4 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]"><CircleHelp size={15} className="mt-0.5 shrink-0" />A conexão usa somente os endpoints oficiais da WhatsApp Cloud API. O servidor recebe eventos pelo webhook e mantém o histórico das conversas.</div>
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
    if (phoneNumber.trim().length < 8 || !content.trim()) {
      setFormError('Informe um telefone válido e a primeira mensagem.');
      return;
    }
    startConversation.mutate({ data: { phoneNumber: phoneNumber.trim(), content: content.trim() } }, {
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        onCreated(result.conversation);
      },
      onError: (error) => setFormError(errorText(error)),
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title" data-testid="dialog-new-conversation">
      <div className="settings-card rise-in">
        <div className="flex items-start justify-between border-b border-[hsl(210_18%_21%)] px-6 py-5">
          <div><div className="mb-2 flex items-center gap-2 text-[hsl(var(--primary))]"><Plus size={17} /><span className="mono text-[10px] uppercase tracking-[.16em]">novo contato</span></div><h2 id="new-conversation-title" className="text-[22px] font-semibold tracking-[-.04em]">Iniciar conversa</h2><p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">A primeira mensagem abre uma nova conversa na API.</p></div>
          <button type="button" className="btn-ghost !p-2" onClick={onClose} data-testid="button-close-new-conversation" aria-label="Fechar nova conversa"><X size={19} /></button>
        </div>
        <form className="space-y-4 p-6" onSubmit={submit}>
          <div className="field"><label className="field-label" htmlFor="new-phone-number">Telefone com DDI</label><input id="new-phone-number" className="field-input" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+55 11 99999-0000" data-testid="input-new-phone-number" /><p className="text-[11px] text-[hsl(var(--muted-foreground))]">Use o mesmo formato cadastrado no WhatsApp.</p></div>
          <div className="field"><label className="field-label" htmlFor="new-message">Mensagem inicial</label><textarea id="new-message" className="field-input min-h-28 resize-y" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Olá, como podemos ajudar?" data-testid="input-new-message" /></div>
          {formError && <p className="flex items-center gap-2 text-xs text-[hsl(3_77%_72%)]" data-testid="status-new-conversation-error"><AlertCircle size={15} />{formError}</p>}
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
  const connection = connectionQuery.data as ConnectionStatus | undefined;
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
    <main className="app-frame noise">
      <div className="inbox-shell">
        <Sidebar conversations={conversations} selectedId={selectedId} setSelectedId={(id) => { setSelectedId(id); setMobileListOpen(false); }} connected={Boolean(connection?.connected)} loading={conversationsQuery.isLoading} error={conversationsQuery.error} onSettings={() => setSettingsOpen(true)} onNewConversation={() => setNewConversationOpen(true)} mobileOpen={mobileListOpen} onCloseMobile={() => setMobileListOpen(false)} />
        <button type="button" className="mobile-scrim hidden" aria-label="Fechar lista de conversas" onClick={() => setMobileListOpen(false)} data-testid="button-mobile-scrim" />
        <ChatPanel conversation={selectedConversation} connected={Boolean(connection?.connected)} onBack={() => setMobileListOpen(true)} onSettings={() => setSettingsOpen(true)} />
      </div>
      <button type="button" className="fixed bottom-5 left-4 z-[8] hidden rounded-lg border border-[hsl(210_18%_25%)] bg-[hsl(208_28%_12%)] p-3 text-[hsl(var(--foreground))] shadow-lg md:hidden" onClick={() => setMobileListOpen(true)} data-testid="button-open-conversations" aria-label="Abrir lista de conversas"><Menu size={18} /></button>
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