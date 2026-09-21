import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Check,
  CheckCheck,
  CircleHelp,
  CircleDollarSign,
  Clipboard,
  FileJson,
  FileText,
  Image as ImageIcon,
  Inbox,
  LockKeyhole,
  Loader2,
  LogOut,
  MessageCircle,
  MoreVertical,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  UserRound,
  Video,
  Wifi,
  X,
} from 'lucide-react';
import {
  getGetConnectionQueryKey,
  getGetTemplateDispatchQueryKey,
  getGetTemplateCostsQueryKey,
  getListConversationMessagesQueryKey,
  getListConversationsQueryKey,
  getListTemplatesQueryKey,
  getListTemplateDispatchesQueryKey,
  useConnectWhatsApp,
  useCreateTemplate,
  useDisconnectWhatsApp,
  useDeleteConversation,
  useDispatchTemplate,
  useGetConnection,
  useGetTemplateDispatch,
  useGetTemplateCosts,
  useListConversationMessages,
  useListConversations,
  useListTemplates,
  useListTemplateDispatches,
  useSendConversationMessage,
  useStartConversation,
  type ChatMessage,
  type ConnectionStatus,
  type Conversation,
  type Template,
  type TemplateComponent,
  type TemplateComponentParameter,
  type TemplateDispatchResult,
  type TemplateInput,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import metaTermsText from '@assets/Pasted-Estamos-atualizando-nossos-Termos-da-Meta-para-a-Plataf_1789996530090.txt?raw';
import metaBusinessPartnerBadge from '@assets/SELO_META_1789997227764.png';

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

function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  useEffect(() => {
    if (!termsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTermsOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [termsOpen]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError('');
    setPending(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, remember }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Não foi possível entrar.');
      setPassword('');
      onAuthenticated();
    } catch (loginError) {
      setError(errorText(loginError));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card rise-in">
        <div className="login-brand">
          <img src="/assets/antiban-logo-white.png" alt="Antiban" />
        </div>
        <p className="login-kicker text-[#ffffff]">GO PLAYGROUND</p>
        <h1>Acesse sua central</h1>
        <p className="login-copy">Entre para gerenciar suas conversas e acompanhar seus clientes.</p>
        <form className="login-form" onSubmit={submit}>
          <div className="field">
            <label className="field-label" htmlFor="login-username">Usuário</label>
            <input id="login-username" className="field-input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="@antiban" autoComplete="username" autoFocus data-testid="input-login-username" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="login-password">Senha</label>
            <input id="login-password" className="field-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Digite sua senha" autoComplete="current-password" data-testid="input-login-password" />
          </div>
          <label className="remember-login">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} data-testid="checkbox-remember-login" />
            <span>Manter conectado por 30 dias</span>
          </label>
          {error && <p className="login-error" role="alert" data-testid="status-login-error"><AlertCircle size={15} />{error}</p>}
          <button type="submit" className="btn-primary login-submit" disabled={pending || !username.trim() || !password}>
            {pending ? <Loader2 size={17} className="animate-spin" /> : <LockKeyhole size={17} />}
            {pending ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p className="login-footnote"><ShieldCheck size={14} /> Ambiente protegido</p>
        <a
          className="login-terms"
          href="https://www.whatsapp.com/legal/meta-terms-whatsapp-business?lang=pt"
          target="_blank"
          rel="noreferrer"
          data-testid="link-meta-terms"
        >
          Termos de uso do WhatsApp Business
        </a>
        {termsOpen && (
          <div
            className="terms-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meta-terms-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setTermsOpen(false);
            }}
            data-testid="dialog-meta-terms"
          >
            <section className="terms-modal rise-in">
              <header className="terms-header">
                <div>
                  <p className="terms-kicker">Documento oficial</p>
                  <h2 id="meta-terms-title">Termos da Meta para o WhatsApp Business</h2>
                  <p>Última modificação: 15 de outubro de 2025</p>
                </div>
                <button type="button" className="action-btn" onClick={() => setTermsOpen(false)} aria-label="Fechar termos" data-testid="button-close-meta-terms">
                  <X size={20} />
                </button>
              </header>
              <div className="terms-content quiet-scroll" tabIndex={0} data-testid="content-meta-terms">
                {metaTermsText}
              </div>
              <footer className="terms-footer">
                <a href="https://www.whatsapp.com/legal/meta-terms-whatsapp-business?lang=pt" target="_blank" rel="noreferrer" className="terms-official-link" data-testid="link-official-meta-terms">
                  Ver página oficial
                </a>
                <button type="button" className="btn-primary" onClick={() => setTermsOpen(false)} data-testid="button-understand-meta-terms">
                  Fechar
                </button>
              </footer>
            </section>
          </div>
        )}
      </section>
    </main>
  );
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
  if (status === 'read') return <CheckCheck className="message-status-icon status-read" size={14} strokeWidth={2.4} aria-label="Lida" />;
  if (status === 'delivered') return <CheckCheck className="message-status-icon status-delivered" size={14} strokeWidth={2.4} aria-label="Entregue" />;
  if (status === 'sent') return <Check className="message-status-icon status-sent" size={14} strokeWidth={2.4} aria-label="Enviada" />;
  if (status === 'failed') return <AlertCircle className="message-status-icon status-failed" size={14} aria-label="Falhou" />;
  return <Loader2 className="message-status-icon status-pending animate-spin" size={13} aria-label="Enviando" />;
}

function ConversationPreviewStatus({ status }: { status: string }) {
  if (status === 'read') return <CheckCheck className="message-status-icon status-read" size={15} strokeWidth={2.2} />;
  if (status === 'delivered') return <CheckCheck className="message-status-icon status-delivered" size={15} strokeWidth={2.2} />;
  if (status === 'failed') return <AlertCircle className="message-status-icon status-failed" size={15} strokeWidth={2.1} />;
  return <Check className="message-status-icon status-sent" size={15} strokeWidth={2.2} />;
}

function Avatar({ name, size = 'normal' }: { name: string; size?: 'normal' | 'large' }) {
  return (
    <div className={`${size === 'large' ? 'chat-contact-photo' : ''} avatar`} aria-hidden="true">
      {initials(name || 'WA')}
    </div>
  );
}

function NavigationRail({ onSettings, connected, profilePictureUrl, activeSection, onSectionChange }: { onSettings: () => void; connected: boolean; profilePictureUrl?: string | null; activeSection: 'inbox' | 'templates'; onSectionChange: (section: 'inbox' | 'templates') => void }) {
  return (
    <aside className="wa-rail" aria-label="Navegação principal">
      <div className="rail-brand" aria-label="Meta Business Partner">
        <img src={metaBusinessPartnerBadge} alt="Meta Business Partner" />
      </div>
      <nav className="rail-nav">
        <button type="button" className="rail-btn" data-active={activeSection === 'inbox'} onClick={() => onSectionChange('inbox')} aria-label="Conversas" data-testid="rail-conversations"><MessageCircle size={17} /><span className="rail-btn-label">Conversas</span></button>
        <button type="button" className="rail-btn" data-active={activeSection === 'templates'} onClick={() => onSectionChange('templates')} aria-label="Envios" data-testid="rail-templates"><FileText size={17} strokeWidth={1.8} /><span className="rail-btn-label">Envios</span></button>
        <button type="button" className="rail-btn" onClick={() => undefined} aria-label="Contatos" data-testid="rail-contacts"><UserRound size={17} /><span className="rail-btn-label">Contatos</span></button>
      </nav>
      <div className="rail-bottom">
        <button type="button" className="rail-btn" onClick={onSettings} aria-label="Configurações" data-testid="rail-settings"><Settings size={17} /><span className="rail-btn-label">Configurações</span></button>
        <button type="button" className="rail-btn" onClick={onSettings} aria-label={connected ? 'Perfil conectado' : 'Configurar conexão'} data-testid="rail-profile">
          <div
            className={`profile-photo !m-0 !h-8 !w-8 text-[10px] ${connected ? 'connected-profile-photo' : ''}`}
            style={profilePictureUrl ? { backgroundImage: `url(${profilePictureUrl})` } : undefined}
          >
            {connected ? (profilePictureUrl ? '' : '?') : '?'}
          </div>
          <span className="rail-btn-label">Perfil</span>
        </button>
      </div>
    </aside>
  );
}

function ConnectedProfile({ connection, onSettings }: { connection?: ConnectionStatus; onSettings: () => void }) {
  const selectedPhone = connection?.phoneNumbers.find((phone) => phone.id === connection.selectedPhoneNumberId) ?? connection?.phoneNumbers[0];
  const name = selectedPhone?.verifiedName || 'Número comercial';
  const number = selectedPhone?.displayPhoneNumber || 'Número não conectado';
  const profilePictureUrl = selectedPhone?.profilePictureUrl;
  const profileStyle = profilePictureUrl ? { backgroundImage: `url(${profilePictureUrl})` } : undefined;
  return (
    <div className="profile-card">
      <div className={`profile-photo ${profilePictureUrl ? 'connected-profile-photo' : ''}`} style={profileStyle} aria-hidden="true">
        {profilePictureUrl ? '' : initials(name)}
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
  onTemplates,
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
  onTemplates: () => void;
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
        <img className="brand-logo" src="/assets/antiban-logo-white.png" alt="Antiban" />
        <div className="flex items-center gap-1">
          <button type="button" className="action-btn" onClick={onNewConversation} data-testid="button-new-conversation" aria-label="Nova conversa"><Plus size={21} /></button>
          <button type="button" className="action-btn mobile-only" onClick={onTemplates} data-testid="button-open-templates" aria-label="Abrir templates"><FileText size={18} /></button>
          <button type="button" className="action-btn md:hidden" onClick={onCloseMobile} data-testid="button-close-sidebar" aria-label="Fechar conversas"><X size={19} /></button>
        </div>
      </header>

      <ConnectedProfile connection={connection} onSettings={onSettings} />

      <div className="sidebar-tools">
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
                <p>
                  {conversation.lastMessage.direction === 'outbound' && (
                    <span className={`conversation-row-status ${conversation.lastMessage.status === 'failed' ? 'failed' : ''}`} aria-label={`Status: ${conversation.lastMessage.status}`}>
                      <ConversationPreviewStatus status={conversation.lastMessage.status} />
                    </span>
                  )}
                  <span className="conversation-row-preview-text">{conversation.lastMessage.content || 'Sem mensagem de texto'}</span>
                </p>
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

function ChatEmpty({ connected, onSettings, onOpenConversations }: { connected: boolean; onSettings: () => void; onOpenConversations: () => void }) {
  return (
    <div className="empty-chat" data-testid="state-chat-empty">
      <div className="empty-chat-card rise-in">
        <button type="button" className="empty-chat-list-button mobile-only" onClick={onOpenConversations} data-testid="button-open-conversations">
          <ArrowLeft size={16} /> Ver conversas
        </button>
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
  onDeleteConversation,
}: {
  conversation: Conversation | undefined;
  connected: boolean;
  onBack: () => void;
  onSettings: () => void;
  onDeleteConversation: () => void;
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

  if (!conversation) return <ChatEmpty connected={connected} onSettings={onSettings} onOpenConversations={onBack} />;

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
                  <button type="button" className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-[#efaaa2] hover:bg-[#432725]" onClick={() => { setMenuOpen(false); onDeleteConversation(); }} data-testid="button-delete-conversation"><Trash2 size={14} /> Apagar conversa da inbox</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="message-wall quiet-scroll" data-testid={`messages-${conversation.id}`}>
        <div className="message-wall-inner">
          <div className="wall-notice">Mensagens criptografadas</div>
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

function DeleteConversationDialog({
  conversation,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  conversation: Conversation;
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title" data-testid="dialog-delete-conversation">
      <div className="settings-card rise-in">
        <div className="settings-section flex items-start justify-between">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#eea59e]">Ação permanente</p>
            <h2 id="delete-conversation-title" className="settings-title">Apagar conversa?</h2>
            <p className="settings-copy">As mensagens de <strong className="text-[#e5ece8]">{conversation.contact.name}</strong> serão removidas desta inbox e do histórico local.</p>
          </div>
          <button type="button" className="action-btn" onClick={onClose} disabled={pending} data-testid="button-close-delete-conversation" aria-label="Cancelar exclusão"><X size={20} /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="status-note"><AlertCircle size={16} /><span>A conversa remota no WhatsApp não é apagada. Esta ação remove somente a cópia persistida nesta plataforma.</span></div>
          {error && <p className="flex items-center gap-2 text-xs text-[#eea59e]" data-testid="status-delete-conversation-error"><AlertCircle size={15} />{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={pending} data-testid="button-cancel-delete-conversation">Cancelar</button>
            <button type="button" className="btn-primary btn-danger" onClick={onConfirm} disabled={pending} data-testid="button-confirm-delete-conversation">
              {pending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              {pending ? 'Apagando...' : 'Apagar conversa'}
            </button>
          </div>
        </div>
      </div>
    </div>
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
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.reload();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-testid="dialog-settings">
      <div className="settings-card rise-in">
        <div className="settings-section flex items-start justify-between">
          <div><h2 id="settings-title" className="settings-title">Configurações da conta</h2></div>
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
                {connection.phoneNumbers.length > 0 ? <div className="divide-y divide-[#303633]">{connection.phoneNumbers.map((phone) => <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0" key={phone.id}><div className="flex min-w-0 items-center gap-3"><div className="profile-photo !m-0 !h-9 !w-9 shrink-0 text-[10px]" style={phone.profilePictureUrl ? { backgroundImage: `url(${phone.profilePictureUrl})` } : undefined}>{phone.profilePictureUrl ? '' : initials(phone.verifiedName || 'WA')}</div><div className="min-w-0"><p className="truncate text-[13px] font-medium">{phone.verifiedName || 'Número comercial'}</p><p className="mt-1 truncate text-[11px] text-[#8f9b95]">{phone.displayPhoneNumber} · qualidade {phone.qualityRating}</p></div></div>{phone.id === connection.selectedPhoneNumberId && <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#68d18c]"><Check size={14} /> selecionado</span>}</div>)}</div> : <p className="text-xs text-[#8f9b95]">Nenhum número retornado pela conta.</p>}
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
          <button type="button" className="btn-ghost w-full" onClick={() => void logout()} data-testid="button-logout"><LogOut size={16} /> Sair da conta</button>
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

type TemplateParameterSlot = {
  key: string;
  component: TemplateComponentParameter['component'];
  parameterType: TemplateComponentParameter['parameterType'];
  index: number | null;
  subType: string | null;
  label: string;
  placeholder: string;
};

function variableNumbers(text: string | null | undefined) {
  return Array.from(new Set((text ?? '').match(/\{\{\s*\d+\s*\}\}/g)?.map((value) => Number(value.replace(/[^\d]/g, ''))) ?? [])).sort((a, b) => a - b);
}

function templateParameterSlots(template: Template): TemplateParameterSlot[] {
  const slots: TemplateParameterSlot[] = [];
  const components = template.components ?? [];
  const body = components.find((component) => component.type.toUpperCase() === 'BODY');
  const header = components.find((component) => component.type.toUpperCase() === 'HEADER');
  const buttons = components.find((component) => component.type.toUpperCase() === 'BUTTONS');

  variableNumbers(body?.text ?? template.body).forEach((variable) => {
    slots.push({ key: `body-${variable}`, component: 'body', parameterType: 'text', index: null, subType: null, label: `Texto · variável {{${variable}}}`, placeholder: 'Valor usado no texto' });
  });
  if (slots.filter((slot) => slot.component === 'body').length === 0 && template.variables.length > 0) {
    template.variables.forEach((_value, index) => {
      slots.push({ key: `body-${index + 1}`, component: 'body', parameterType: 'text', index: null, subType: null, label: `Texto · variável {{${index + 1}}}`, placeholder: 'Valor usado no texto' });
    });
  }

  const headerFormat = header?.format?.toUpperCase();
  if (headerFormat === 'TEXT') {
    variableNumbers(header?.text).forEach((variable) => {
      slots.push({ key: `header-${variable}`, component: 'header', parameterType: 'text', index: null, subType: null, label: `Cabeçalho · variável {{${variable}}}`, placeholder: 'Valor do cabeçalho' });
    });
  } else if (headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
    slots.push({
      key: 'header-media',
      component: 'header',
      parameterType: headerFormat.toLowerCase() as TemplateParameterSlot['parameterType'],
      index: null,
      subType: null,
      label: `Cabeçalho · ${headerFormat.toLowerCase()}`,
      placeholder: 'URL pública do arquivo',
    });
  }

  (buttons?.buttons ?? []).forEach((button, index) => {
    if (button.type.toUpperCase() !== 'URL') return;
    variableNumbers(button.url).forEach((variable) => {
      slots.push({ key: `button-${index}-${variable}`, component: 'button', parameterType: 'text', index, subType: 'url', label: `Botão URL ${index + 1} · variável {{${variable}}}`, placeholder: 'Valor que completa o link' });
    });
  });
  return slots;
}

function normalizeImportedTemplate(value: unknown): TemplateInput {
  const root = Array.isArray(value) ? value[0] : value;
  const source = (root && typeof root === 'object' ? root : {}) as Record<string, unknown>;
  const nested = Array.isArray(source.templates) ? source.templates[0] : undefined;
  const data = (nested && typeof nested === 'object' ? nested : source) as Record<string, unknown>;
  const rawComponents = Array.isArray(data.components) ? data.components.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
  const components: TemplateComponent[] = rawComponents.map((component) => {
    const rawButtons = Array.isArray(component.buttons) ? component.buttons.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
    return {
      type: String(component.type ?? '').toUpperCase(),
      format: typeof component.format === 'string' ? component.format.toUpperCase() : null,
      text: typeof component.text === 'string' ? component.text : null,
      example: component.example && typeof component.example === 'object' && !Array.isArray(component.example) ? component.example as Record<string, unknown> : null,
      buttons: rawButtons.map((button) => ({
        type: String(button.type ?? '').toUpperCase(),
        text: typeof button.text === 'string' ? button.text : null,
        url: typeof button.url === 'string' ? button.url : null,
        phoneNumber: typeof button.phone_number === 'string' ? button.phone_number : typeof button.phoneNumber === 'string' ? button.phoneNumber : null,
        example: Array.isArray(button.example) ? button.example.filter((item): item is string => typeof item === 'string') : null,
      })),
    };
  }).filter((component) => component.type);
  const componentText = (type: string) => components.find((component) => component.type === type)?.text ?? null;
  const body = typeof data.body === 'string' ? data.body : componentText('BODY');
  const header = typeof data.header === 'string' ? data.header : componentText('HEADER');
  const footer = typeof data.footer === 'string' ? data.footer : componentText('FOOTER');
  const variableMatches = (body ?? '').match(/{{\s*[^}]+\s*}}/g) ?? [];
  const rawVariables = Array.isArray(data.variables) ? data.variables.filter((item): item is string => typeof item === 'string') : variableMatches;
  const name = typeof data.name === 'string' ? data.name : '';
  const languageCode = typeof data.languageCode === 'string'
    ? data.languageCode
    : typeof data.language_code === 'string'
      ? data.language_code
      : typeof data.language === 'string'
        ? data.language
        : (data.language && typeof data.language === 'object' && typeof (data.language as Record<string, unknown>).code === 'string' ? String((data.language as Record<string, unknown>).code) : '');
  const category = typeof data.category === 'string' ? data.category : 'UTILITY';
  const status = typeof data.status === 'string' ? data.status : undefined;
  if (!name.trim() || !languageCode.trim() || !body?.trim()) throw new Error('O JSON precisa conter name, languageCode (ou language_code) e body (ou um componente BODY).');
  return {
    name: name.trim(),
    languageCode: languageCode.trim(),
    category: category.trim() || 'UTILITY',
    ...(status ? { status } : {}),
    header: header?.trim() || null,
    body: body.trim(),
    footer: footer?.trim() || null,
    variables: rawVariables,
    components,
  };
}

function dispatchStatusLabel(status: string) {
  return ({ pending: 'Pendente', partial: 'Parcial', sent: 'Aceito pela Meta', delivered: 'Entregue', read: 'Lido', failed: 'Falhou' } as Record<string, string>)[status] ?? status;
}

function TemplateWorkspace({ onBackToInbox }: { onBackToInbox: () => void }) {
  const queryClient = useQueryClient();
  const templatesQuery = useListTemplates({ query: { queryKey: getListTemplatesQueryKey() } });
  const costsQuery = useGetTemplateCosts({ query: { queryKey: getGetTemplateCostsQueryKey() } });
  const dispatchesQuery = useListTemplateDispatches({ query: { queryKey: getListTemplateDispatchesQueryKey(), refetchInterval: 5000 } });
  const [selectedDispatchId, setSelectedDispatchId] = useState<number | null>(null);
  const dispatchDetailQuery = useGetTemplateDispatch(selectedDispatchId ?? 0, { query: { queryKey: getGetTemplateDispatchQueryKey(selectedDispatchId ?? 0), enabled: selectedDispatchId !== null, refetchInterval: 5000 } });
  const createTemplate = useCreateTemplate();
  const dispatchTemplate = useDispatchTemplate();
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const dispatches = useMemo(() => dispatchesQuery.data ?? [], [dispatchesQuery.data]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [importDraft, setImportDraft] = useState<TemplateInput | null>(null);
  const [fileName, setFileName] = useState('');
  const [importError, setImportError] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [dispatchError, setDispatchError] = useState('');
  const [dispatchResult, setDispatchResult] = useState<TemplateDispatchResult | null>(null);
  const selectedTemplate = useMemo(() => templates.find((template) => template.id === selectedId), [templates, selectedId]);
  const parameterSlots = useMemo(() => selectedTemplate ? templateParameterSlots(selectedTemplate) : [], [selectedTemplate]);
  const recipients = useMemo(() => recipientsText.split(/[,\n;]+/).map((item) => item.trim()).filter(Boolean), [recipientsText]);
  const cost = costsQuery.data;
  const estimatedTotal = cost ? cost.costPerMessage * recipients.length : null;

  useEffect(() => {
    if (selectedId === null && templates.length > 0) setSelectedId(templates[0].id);
    if (selectedId !== null && templates.length > 0 && !templates.some((template) => template.id === selectedId)) setSelectedId(templates[0].id);
    if (templates.length === 0) setSelectedId(null);
  }, [templates, selectedId]);

  useEffect(() => {
    if (selectedTemplate) {
      const slots = templateParameterSlots(selectedTemplate);
      setParameterValues(Object.fromEntries(slots.map((slot, index) => [slot.key, selectedTemplate.variables[index]?.startsWith('{{') ? '' : selectedTemplate.variables[index] ?? ''])));
    }
  }, [selectedTemplate]);

  useEffect(() => {
    if (selectedDispatchId === null && dispatches.length > 0) setSelectedDispatchId(dispatches[0].id);
  }, [dispatches, selectedDispatchId]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportError('');
    setImportDraft(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      setImportDraft(normalizeImportedTemplate(parsed));
    } catch (error) {
      setImportError(error instanceof SyntaxError ? 'O arquivo não contém um JSON válido.' : errorText(error));
    }
    event.target.value = '';
  };

  const submitImport = () => {
    if (!importDraft || createTemplate.isPending) return;
    createTemplate.mutate({ data: importDraft }, {
      onSuccess: (created) => {
        queryClient.setQueryData<Template[]>(getListTemplatesQueryKey(), (current = []) => current.some((template) => template.id === created.id) ? current : [...current, created]);
        void queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        setSelectedId(created.id);
        setImportDraft(null);
        setFileName('');
      },
      onError: (error) => setImportError(errorText(error)),
    });
  };

  const dispatch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDispatchError('');
    setDispatchResult(null);
    if (!selectedTemplate) { setDispatchError('Selecione um template aprovado para continuar.'); return; }
    if (selectedTemplate.status.toLowerCase() !== 'approved') { setDispatchError('Somente templates aprovados podem ser enviados pela API oficial.'); return; }
    if (recipients.length === 0) { setDispatchError('Informe ao menos um número de telefone.'); return; }
    const missing = parameterSlots.filter((slot) => !parameterValues[slot.key]?.trim());
    if (missing.length > 0) { setDispatchError(`Preencha ${missing.length === 1 ? 'o parâmetro obrigatório' : 'os parâmetros obrigatórios'} antes de enviar.`); return; }
    const componentParameters: TemplateComponentParameter[] = parameterSlots.map((slot) => ({
      component: slot.component,
      parameterType: slot.parameterType,
      index: slot.index,
      subType: slot.subType,
      value: parameterValues[slot.key].trim(),
    }));
    dispatchTemplate.mutate({ templateId: selectedTemplate.id, data: { recipients, componentParameters } }, {
      onSuccess: (result) => {
        setDispatchResult(result);
        setSelectedDispatchId(result.dispatchId);
        void queryClient.invalidateQueries({ queryKey: getListTemplateDispatchesQueryKey() });
      },
      onError: (error) => setDispatchError(errorText(error)),
    });
  };

  const statusLabel = (status: string) => {
    const normalized = status.toLowerCase();
    return normalized === 'approved' ? 'Aprovado' : normalized === 'pending' ? 'Pendente' : normalized === 'rejected' ? 'Rejeitado' : status;
  };

  return (
    <section className="templates-area" data-testid="workspace-templates">
      <header className="templates-topbar">
        <div>
          <button type="button" className="templates-mobile-back mobile-only" onClick={onBackToInbox} data-testid="button-back-to-inbox"><ArrowLeft size={16} /> Conversas</button>
          <p className="templates-kicker">WhatsApp Cloud API · operação</p>
          <h1 className="templates-title">Envios oficiais</h1>
          <p className="templates-subtitle">Use os componentes aprovados pela Meta e acompanhe a entrega por destinatário.</p>
        </div>
        <div className="templates-connection-note"><ShieldCheck size={14} /> envio oficial pela Meta</div>
      </header>
      <div className="templates-body">
        <section className="templates-library" aria-label="Biblioteca de templates" data-testid="template-list">
          <div className="templates-section-label"><span>Biblioteca</span><span className="templates-count">{templates.length} {templates.length === 1 ? 'template' : 'templates'}</span></div>
          {templatesQuery.isLoading && <div className="templates-loading" data-testid="state-templates-loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>}
          {templatesQuery.isError && <div className="status-note" data-testid="state-templates-error"><AlertCircle size={16} /><span>Não foi possível carregar os templates.</span></div>}
          {!templatesQuery.isLoading && !templatesQuery.isError && templates.length === 0 && (
            <div className="template-empty" data-testid="state-templates-empty"><FileText size={27} strokeWidth={1.5} /><div><strong>Nenhum template importado</strong><p>Importe o JSON real da Meta com HEADER, BODY, FOOTER e BUTTONS.</p></div></div>
          )}
          {!templatesQuery.isLoading && templates.length > 0 && (
            <div className="template-list">
              {templates.map((template) => (
                <button type="button" key={template.id} className="template-row" data-active={template.id === selectedId} onClick={() => { setSelectedId(template.id); setDispatchResult(null); }} data-testid={`template-row-${template.id}`}>
                  <span className="template-row-name">{template.name}</span>
                  <span className="template-row-meta"><span>{template.languageCode}</span><span>·</span><span>{template.category}</span><span className="template-status" data-status={template.status.toLowerCase()}>{statusLabel(template.status)}</span></span>
                </button>
              ))}
            </div>
          )}
          <div className="template-import-card">
            <div className="template-import-heading"><FileJson size={16} /><span>Importar definição da Meta</span></div>
            <p className="template-import-help">Aceita exportações com componentes HEADER, BODY, FOOTER e BUTTONS, incluindo formato de mídia e exemplos.</p>
            <label className="template-file-label" htmlFor="template-json-file"><Upload size={15} /> Escolher arquivo JSON<input id="template-json-file" type="file" accept="application/json,.json" onChange={handleFile} data-testid="input-template-file" /></label>
            {fileName && <p className="template-file-name" data-testid="text-template-file-name">{fileName}{importDraft ? ' · pronto para importar' : ''}</p>}
            {importDraft && (
              <div className="mt-3 grid gap-2">
                <p className="text-[11px] text-[#b9c8be]"><strong>{importDraft.name}</strong> · {importDraft.languageCode} · {importDraft.category} · {importDraft.components?.length ?? 0} componentes</p>
                <button type="button" className="btn-primary w-full" onClick={submitImport} disabled={createTemplate.isPending} data-testid="button-import-template">{createTemplate.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}{createTemplate.isPending ? 'Importando...' : 'Importar template'}</button>
              </div>
            )}
            {importError && <p className="template-inline-error mt-3" data-testid="status-template-import-error"><AlertCircle size={15} />{importError}</p>}
          </div>
        </section>
        <section className="templates-dispatch" aria-label="Envio de template">
          <div className="templates-section-label"><span>Revisão e envio</span><span className="templates-count">componentes Meta</span></div>
          {selectedTemplate ? (
            <>
              <div className="template-preview-card" data-testid={`template-preview-${selectedTemplate.id}`}>
                <div className="template-preview-header">
                  <div><h2 className="template-preview-name">{selectedTemplate.name}</h2><p className="template-preview-meta">{selectedTemplate.languageCode} · {selectedTemplate.category} · {statusLabel(selectedTemplate.status)}</p></div>
                  <span className="template-status" data-status={selectedTemplate.status.toLowerCase()}>{statusLabel(selectedTemplate.status)}</span>
                </div>
                <div className="template-message-preview">
                  {selectedTemplate.components.find((component) => component.type.toUpperCase() === 'HEADER')?.text && <div className="template-message-header">{selectedTemplate.components.find((component) => component.type.toUpperCase() === 'HEADER')?.text}</div>}
                  {selectedTemplate.components.find((component) => component.type.toUpperCase() === 'HEADER')?.format && selectedTemplate.components.find((component) => component.type.toUpperCase() === 'HEADER')?.format !== 'TEXT' && <div className="template-media-note"><ImageIcon size={14} /> Cabeçalho de {selectedTemplate.components.find((component) => component.type.toUpperCase() === 'HEADER')?.format?.toLowerCase()}</div>}
                  <div>{selectedTemplate.body}</div>
                  {selectedTemplate.footer && <div className="template-message-footer">{selectedTemplate.footer}</div>}
                  {selectedTemplate.components.find((component) => component.type.toUpperCase() === 'BUTTONS')?.buttons.map((button, index) => <div className="template-button-preview" key={`${button.type}-${index}`}>{button.text ?? button.type}</div>)}
                </div>
              </div>
              <form className="template-dispatch-form" onSubmit={dispatch}>
                <div className="field"><label className="field-label" htmlFor="template-recipients">Destinatários</label><textarea id="template-recipients" className="field-input min-h-24 resize-y" value={recipientsText} onChange={(event) => setRecipientsText(event.target.value)} placeholder="+55 11 99999-0000&#10;+55 21 98888-0000" data-testid="input-template-recipients" /><p className="field-help">Separe números por linha, vírgula ou ponto e vírgula. {recipients.length > 0 ? `${recipients.length} destinatário(s) detectado(s).` : ''}</p></div>
                <div className="template-parameters-card">
                  <div className="template-parameters-heading"><span>Parâmetros exigidos pelo template</span><span>{parameterSlots.length} campo(s)</span></div>
                  {parameterSlots.length === 0 && <p className="field-help">Este template não exige variáveis ou mídia adicional.</p>}
                  {parameterSlots.map((slot) => <div className="field" key={slot.key}><label className="field-label" htmlFor={`template-parameter-${slot.key}`}>{slot.label}</label><input id={`template-parameter-${slot.key}`} className="field-input" value={parameterValues[slot.key] ?? ''} onChange={(event) => setParameterValues((current) => ({ ...current, [slot.key]: event.target.value }))} placeholder={slot.placeholder} data-testid={`input-template-parameter-${slot.key}`} /></div>)}
                  <p className="field-help">Os valores são enviados nos componentes corretos da API da Meta; a URL de mídia precisa ser pública.</p>
                </div>
                <div className="template-cost-card" data-testid="template-cost-summary">
                  <div><div className="template-cost-label"><CircleDollarSign size={13} className="mr-1 inline-block align-[-2px]" />Estimativa para {recipients.length || 0} destinatário(s)</div><div className="template-cost-value">{cost ? `${cost.currency} ${estimatedTotal?.toFixed(2)}` : costsQuery.isLoading ? 'Consultando tarifa...' : 'Tarifa indisponível'}</div></div>
                  <p className="template-cost-note">{cost?.disclaimer ?? (costsQuery.isError ? 'Não foi possível consultar a tarifa configurada.' : 'A estimativa será carregada pela API.')}</p>
                </div>
                {dispatchError && <p className="template-inline-error" data-testid="status-template-dispatch-error"><AlertCircle size={15} />{dispatchError}</p>}
                <button type="submit" className="btn-primary w-full" disabled={dispatchTemplate.isPending || !selectedTemplate} data-testid="button-dispatch-template">{dispatchTemplate.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{dispatchTemplate.isPending ? 'Enviando pelo WhatsApp...' : 'Enviar template oficial'}</button>
              </form>
              {dispatchResult && <div className="template-results-card rise-in" data-testid="template-dispatch-results"><div className="template-results-summary"><div className="template-result-stat"><span>Lote</span><strong>#{dispatchResult.dispatchId}</strong></div><div className="template-result-stat" data-tone="success"><span>Aceitos</span><strong>{dispatchResult.sentCount}</strong></div><div className="template-result-stat"><span>Pendentes</span><strong>{dispatchResult.pendingCount}</strong></div><div className="template-result-stat" data-tone="error"><span>Falhas</span><strong>{dispatchResult.failedCount}</strong></div></div></div>}
            </>
          ) : (
            <div className="template-empty" data-testid="state-template-selection-empty"><FileText size={28} strokeWidth={1.5} /><div><strong>Selecione um template</strong><p>Depois de importar ou escolher um item, os componentes e parâmetros aparecem aqui.</p></div></div>
          )}
        </section>
        <section className="dispatch-monitor" aria-label="Painel de acompanhamento de envios" data-testid="dispatch-monitor">
          <div className="templates-section-label"><span><BarChart3 size={15} /> Acompanhamento dos envios</span><span className="templates-count">atualização automática</span></div>
          <div className="dispatch-monitor-grid">
            <div className="dispatch-history">
              {dispatchesQuery.isLoading && <div className="templates-loading"><div className="skeleton" /><div className="skeleton" /></div>}
              {!dispatchesQuery.isLoading && dispatches.length === 0 && <div className="dispatch-empty">Nenhum lote enviado ainda.</div>}
              {dispatches.map((dispatch) => <button type="button" key={dispatch.id} className="dispatch-history-row" data-active={dispatch.id === selectedDispatchId} onClick={() => setSelectedDispatchId(dispatch.id)}><span><strong>#{dispatch.id} · {dispatch.templateName}</strong><small>{new Date(dispatch.createdAt).toLocaleString('pt-BR')} · {dispatch.languageCode}</small></span><span className="dispatch-history-stats"><b>{dispatch.sentCount}/{dispatch.recipientsCount}</b><em data-status={dispatch.status}>{dispatchStatusLabel(dispatch.status)}</em></span></button>)}
            </div>
            <div className="dispatch-detail">
              {!selectedDispatchId && <div className="dispatch-empty">Selecione um lote para ver os destinatários.</div>}
              {selectedDispatchId && dispatchDetailQuery.isLoading && <div className="dispatch-empty">Carregando detalhes...</div>}
              {selectedDispatchId && dispatchDetailQuery.data && <><div className="dispatch-detail-summary"><div><span>Status</span><strong>{dispatchStatusLabel(dispatchDetailQuery.data.status)}</strong></div><div><span>Entregues</span><strong>{dispatchDetailQuery.data.deliveredCount}</strong></div><div><span>Lidos</span><strong>{dispatchDetailQuery.data.readCount}</strong></div><div><span>Custo estimado</span><strong>{dispatchDetailQuery.data.currency} {dispatchDetailQuery.data.estimatedCost.toFixed(2)}</strong></div></div><div className="dispatch-recipient-list">{dispatchDetailQuery.data.results.map((result) => <div className="dispatch-recipient-row" key={`${result.phoneNumber}-${result.whatsappMessageId ?? result.updatedAt}`}><span className="template-result-phone">{result.phoneNumber}</span><span className="dispatch-recipient-message">{result.message ?? (result.whatsappMessageId ? 'Aguardando confirmação da Meta' : 'Aguardando envio')}</span><em data-status={result.status}><span className="dot" />{dispatchStatusLabel(result.status)}</em></div>)}</div></>}
            </div>
          </div>
        </section>
      </div>
    </section>
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
  const [activeSection, setActiveSection] = useState<'inbox' | 'templates'>('inbox');
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const deleteConversation = useDeleteConversation();
  const selectedConversation = useMemo(() => conversations.find((item) => item.id === selectedId), [conversations, selectedId]);

  useEffect(() => {
    const events = new EventSource('/api/events');
    const handleConversationUpdate = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const payload = JSON.parse(message.data) as { conversationId?: unknown };
        if (typeof payload.conversationId !== 'number') return;

        void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        void queryClient.invalidateQueries({
          queryKey: getListConversationMessagesQueryKey(payload.conversationId),
        });
      } catch {
        // The stream is best-effort; polling remains the recovery mechanism.
      }
    };

    events.addEventListener('conversation.updated', handleConversationUpdate);
    return () => {
      events.removeEventListener('conversation.updated', handleConversationUpdate);
      events.close();
    };
  }, []);

  useEffect(() => {
    if (selectedId === null && conversations.length > 0) setSelectedId(conversations[0].id);
    if (selectedId !== null && conversations.length > 0 && !conversations.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [conversations, selectedId]);

  const confirmDeleteConversation = () => {
    if (!conversationToDelete || deleteConversation.isPending) return;
    setDeleteError('');
    deleteConversation.mutate(
      { conversationId: conversationToDelete.id },
      {
        onSuccess: () => {
          const deletedId = conversationToDelete.id;
          setConversationToDelete(null);
          setSelectedId((current) => (current === deletedId ? null : current));
          setMobileListOpen(true);
          void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          void queryClient.removeQueries({ queryKey: getListConversationMessagesQueryKey(deletedId) });
        },
        onError: (error) => setDeleteError(errorText(error)),
      },
    );
  };

  return (
    <main className="app-frame">
      <div className="inbox-shell" data-mobile-list-open={activeSection === 'inbox' ? mobileListOpen : undefined}>
        <NavigationRail
          onSettings={() => setSettingsOpen(true)}
          connected={Boolean(connection?.connected)}
          profilePictureUrl={connection?.phoneNumbers.find((phone) => phone.id === connection.selectedPhoneNumberId)?.profilePictureUrl}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        {activeSection === 'templates' ? <TemplateWorkspace onBackToInbox={() => { setActiveSection('inbox'); setMobileListOpen(true); }} /> : (
          <>
            <Sidebar conversations={conversations} selectedId={selectedId} setSelectedId={(id) => { setSelectedId(id); setMobileListOpen(false); }} connected={Boolean(connection?.connected)} connection={connection} loading={conversationsQuery.isLoading} error={conversationsQuery.error} onSettings={() => setSettingsOpen(true)} onNewConversation={() => setNewConversationOpen(true)} onTemplates={() => setActiveSection('templates')} mobileOpen={mobileListOpen} onCloseMobile={() => setMobileListOpen(false)} />
            <button type="button" className="mobile-scrim" aria-label="Fechar lista de conversas" onClick={() => setMobileListOpen(false)} data-testid="button-mobile-scrim" />
            <ChatPanel conversation={selectedConversation} connected={Boolean(connection?.connected)} onBack={() => setMobileListOpen(true)} onSettings={() => setSettingsOpen(true)} onDeleteConversation={() => { if (selectedConversation) { setDeleteError(''); setConversationToDelete(selectedConversation); } }} />
          </>
        )}
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {newConversationOpen && <NewConversationDialog onClose={() => setNewConversationOpen(false)} onCreated={(conversation) => { setNewConversationOpen(false); setSelectedId(conversation.id); setMobileListOpen(false); }} />}
      {conversationToDelete && <DeleteConversationDialog conversation={conversationToDelete} pending={deleteConversation.isPending} error={deleteError} onClose={() => { if (!deleteConversation.isPending) { setConversationToDelete(null); setDeleteError(''); } }} onConfirm={confirmDeleteConversation} />}
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

function AuthGate() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((response) => {
        if (active) setAuthenticated(response.ok);
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (authenticated === null) {
    return <div className="auth-loading"><Loader2 size={22} className="animate-spin" /></div>;
  }
  if (!authenticated) {
    return <LoginScreen onAuthenticated={() => { queryClient.clear(); setAuthenticated(true); }} />;
  }
  return <Router />;
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
          <AuthGate />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;