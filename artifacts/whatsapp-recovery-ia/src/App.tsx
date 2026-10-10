import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
  FileText,
  Image as ImageIcon,
  Inbox,
  LockKeyhole,
  Loader2,
  LogOut,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Phone,
  Plus,
  QrCode,
  Search,
  Send,
  Settings,
  LayoutDashboard,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  Video,
  Wifi,
  X,
} from 'lucide-react';
import {
  getGetConnectionQueryKey,
  getGetConversationContactProfileQueryKey,
  getGetEvolutionConnectionQueryKey,
  getGetTemplateDispatchQueryKey,
  getGetTemplateCostsQueryKey,
  getListConversationMessagesQueryKey,
  getListContactsQueryKey,
  getListConversationsQueryKey,
  getListTemplatesQueryKey,
  getListTemplateDispatchesQueryKey,
  useConnectWhatsApp,
  useCreateContact,
  useCreateTemplate,
  useDisconnectWhatsApp,
  useDeleteConversation,
  useDispatchTemplate,
  useGetConnection,
  useGetConversationContactProfile,
  useGetEvolutionConnection,
  useGetTemplateDispatch,
  useGetTemplateCosts,
  useListConversationMessages,
  useListContacts,
  useListConversations,
  useListTemplates,
  useListTemplateDispatches,
  useSendConversationMessage,
  useSendConversationMedia,
  useSendConversationMessageReaction,
  useStartConversation,
  type ChatMessage,
  type Contact,
  type ConnectionStatus,
  type Conversation,
  type Template,
  type TemplateComponent,
  type TemplateComponentParameter,
  type TemplateDispatchResult,
  type TemplateInput,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { DashboardWorkspace } from '@/components/dashboard-workspace';
import { EvolutionConnectionPanel } from '@/components/evolution-connection-panel';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import metaTermsText from '@assets/Pasted-Estamos-atualizando-nossos-Termos-da-Meta-para-a-Plataf_1789996530090.txt?raw';
import metaBusinessPartnerBadge from '@assets/SELO_META_1789997227764.png';
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

const phoneCountryNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
const phoneCountryOptions = getCountries()
  .map((country) => ({
    country,
    name: phoneCountryNames.of(country) ?? country,
    callingCode: getCountryCallingCode(country),
  }))
  .sort((left, right) => {
    if (left.country === right.country) return 0;
    if (left.country === 'BR') return -1;
    if (right.country === 'BR') return 1;
    return left.name.localeCompare(right.name, 'pt-BR');
  });

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } },
});
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

function NavigationRail({ onSettings, connected, profilePictureUrl, activeSection, onSectionChange }: { onSettings: () => void; connected: boolean; profilePictureUrl?: string | null; activeSection: 'inbox' | 'templates' | 'dashboard'; onSectionChange: (section: 'inbox' | 'templates' | 'dashboard') => void }) {
  return (
    <aside className="wa-rail" aria-label="Navegação principal">
      <div className="rail-brand" aria-label="Meta Business Partner">
        <img src={metaBusinessPartnerBadge} alt="Meta Business Partner" />
      </div>
      <nav className="rail-nav">
        <button type="button" className="rail-btn" data-active={activeSection === 'inbox'} onClick={() => onSectionChange('inbox')} aria-label="Conversas" data-testid="rail-conversations"><MessageCircle size={17} /><span className="rail-btn-label">Conversas</span></button>
        <button type="button" className="rail-btn" data-active={activeSection === 'dashboard'} onClick={() => onSectionChange('dashboard')} aria-label="Dashboard" data-testid="rail-dashboard"><LayoutDashboard size={17} /><span className="rail-btn-label">Dashboard</span></button>
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

function ConnectedProfile({ connection, connectionLabel, onSettings }: { connection?: ConnectionStatus; connectionLabel: string; onSettings: () => void }) {
  const selectedPhone = connection?.phoneNumbers.find((phone) => phone.id === connection.selectedPhoneNumberId) ?? connection?.phoneNumbers[0];
  const name = selectedPhone?.verifiedName || 'Número comercial';
  const subtitle = selectedPhone?.displayPhoneNumber
    || (!connection ? 'Verificando conexão…' : connection.connected ? connectionLabel : 'WhatsApp desconectado');
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
        <p data-testid="text-connected-phone">{subtitle}</p>
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
  onDashboard,
  mobileOpen,
  onCloseMobile,
  connectionLabel,
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
  onDashboard: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  connectionLabel: string;
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
        <div className="sidebar-brand-actions">
          <img className="brand-logo" src="/assets/antiban-logo-white.png" alt="Antiban" />
          <button type="button" className="sidebar-dashboard-button" onClick={onDashboard} data-testid="button-open-dashboard"><span>Acessar Central</span></button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="action-btn" onClick={onNewConversation} data-testid="button-new-conversation" aria-label="Nova conversa"><Plus size={21} /></button>
          <button type="button" className="action-btn mobile-only" onClick={onTemplates} data-testid="button-open-templates" aria-label="Abrir templates"><FileText size={18} /></button>
          <button type="button" className="action-btn md:hidden" onClick={onCloseMobile} data-testid="button-close-sidebar" aria-label="Fechar conversas"><X size={19} /></button>
        </div>
      </header>

      <ConnectedProfile connection={connection} connectionLabel={connectionLabel} onSettings={onSettings} />

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
          {connected ? connectionLabel : 'Configure sua conexão'}
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
        <img className="empty-chat-logo" src="/assets/antiban-logo-white.png" alt="Antiban" />
        <p>Selecione uma conversa à esquerda ou inicie uma nova conversa para responder aos seus clientes.</p>
        {!connected && <button type="button" className="btn-primary mt-6" onClick={onSettings} data-testid="button-empty-connect"><Settings size={16} /> Configurar conexão</button>}
        <div className="mt-7 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[.12em] text-[#7f8d87]"><ShieldCheck size={14} /> API oficial da Meta</div>
      </div>
    </div>
  );
}

type DisplayChatMessage = ChatMessage & {
  mediaPreviewUrl?: string;
  mediaFileName?: string | null;
  mediaCaption?: string | null;
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MessageBubble({
  message,
  reactions = [],
  replyPreview,
  onReact,
}: {
  message: DisplayChatMessage;
  reactions?: ChatMessage[];
  replyPreview?: string;
  onReact?: (messageId: number, emoji: string) => void;
}) {
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const outbound = message.direction === 'outbound';
  const isMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(message.messageType);
  const reactionCounts = reactions.reduce<Array<{ emoji: string; count: number; mine: boolean }>>((groups, reaction) => {
    if (!reaction.reactionEmoji) return groups;
    const current = groups.find((group) => group.emoji === reaction.reactionEmoji);
    if (current) {
      current.count += 1;
      current.mine ||= reaction.direction === 'outbound';
    } else {
      groups.push({
        emoji: reaction.reactionEmoji,
        count: 1,
        mine: reaction.direction === 'outbound',
      });
    }
    return groups;
  }, []);
  const emojiOptions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  return (
    <div className={`message-row ${outbound ? 'outbound' : 'inbound'} rise-in`} data-testid={`message-${message.id}`}>
      <div className={`bubble ${outbound ? 'bubble-out' : 'bubble-in'} ${message.status === 'failed' ? 'border border-[#8d4942]' : ''}`}>
        {replyPreview && <div className="mb-1 border-l-2 border-[#62a477] pl-2 text-xs text-[#61736a] line-clamp-2">{replyPreview}</div>}
        {isMedia ? (
          <div className="message-media">
            {(message.mediaPreviewUrl || message.mediaUrl) && message.messageType === 'image' && <img src={message.mediaPreviewUrl || message.mediaUrl || undefined} alt={message.content || 'Imagem do WhatsApp'} />}
            {(message.mediaPreviewUrl || message.mediaUrl) && message.messageType === 'video' && <video src={message.mediaPreviewUrl || message.mediaUrl || undefined} controls muted preload="metadata" />}
            {(message.mediaPreviewUrl || message.mediaUrl) && message.messageType === 'audio' && <audio src={message.mediaPreviewUrl || message.mediaUrl || undefined} controls preload="metadata" />}
            {(!message.mediaPreviewUrl && !message.mediaUrl || message.messageType === 'document' || message.messageType === 'sticker') && (
              <div className="message-attachment">
                {message.mediaUrl && message.messageType === 'document'
                  ? <a href={message.mediaUrl} className="flex min-w-0 items-center gap-2" download={message.mediaFileName || undefined}><Paperclip size={16} /><span className="min-w-0"><strong className="block truncate">{message.mediaFileName || message.content || 'Arquivo'}</strong><span>Baixar documento</span></span></a>
                  : <><Paperclip size={16} /><div><strong>{message.mediaFileName || message.content || 'Arquivo'}</strong><span>{message.messageType === 'document' ? 'Documento' : message.messageType}</span></div></>}
              </div>
            )}
            {message.mediaCaption && <p className="message-media-caption">{message.mediaCaption}</p>}
          </div>
        ) : message.messageType === 'location' ? (
          <div className="min-w-44">
            <strong className="block text-xs text-[#61736a]">Localização compartilhada</strong>
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
            {message.mediaUrl && <a className="mt-1 inline-block text-xs font-semibold text-[#16885c] underline" href={message.mediaUrl} target="_blank" rel="noreferrer">Abrir no mapa</a>}
          </div>
        ) : message.messageType === 'contact' ? (
          <div className="flex min-w-44 items-start gap-2">
            <UserRound size={17} className="mt-0.5 shrink-0 text-[#4c8067]" />
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ) : message.messageType === 'poll' ? (
          <div className="min-w-44">
            <strong className="block text-xs text-[#61736a]">Enquete</strong>
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ) : <div className="whitespace-pre-wrap break-words">{message.content}</div>}
        {message.status === 'failed' && <div className="message-failure-note">Não foi possível confirmar o envio</div>}
        <div className="bubble-meta">
          {formatClock(message.createdAt)}
          {outbound && <StatusIcon status={message.status} />}
          {onReact && (
            <button
              type="button"
              className="ml-1 rounded px-1 text-[#597365] hover:bg-black/5"
              onClick={() => setReactionPickerOpen((open) => !open)}
              aria-label="Reagir à mensagem"
              title="Reagir"
            >
              <MessageCircle size={13} />
            </button>
          )}
        </div>
        {reactionCounts.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" aria-label="Reações">
            {reactionCounts.map((reaction) => (
              <button
                type="button"
                key={reaction.emoji}
                className={`rounded-full border px-1.5 py-0.5 text-[11px] ${reaction.mine ? 'border-[#68b37c] bg-[#d8f8d4]' : 'border-[#d5ddd8] bg-white/80'}`}
                onClick={() => onReact?.(message.id, reaction.mine ? '' : reaction.emoji)}
                title={reaction.mine ? 'Remover sua reação' : `Reagir com ${reaction.emoji}`}
              >
                {reaction.emoji} {reaction.count > 1 && reaction.count}
              </button>
            ))}
          </div>
        )}
        {reactionPickerOpen && onReact && (
          <div className="mt-1 flex gap-1 rounded-full border border-[#ccd7d0] bg-white px-2 py-1 shadow-md" role="group" aria-label="Escolher reação">
            {emojiOptions.map((emoji) => (
              <button type="button" key={emoji} className="rounded p-1 text-lg hover:bg-[#eef5ef]" onClick={() => { onReact(message.id, emoji); setReactionPickerOpen(false); }} aria-label={`Reagir com ${emoji}`}>{emoji}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactProfilePanel({
  conversation,
  messages,
  evolutionMode,
  onClose,
}: {
  conversation: Conversation;
  messages: ChatMessage[];
  evolutionMode: boolean;
  onClose: () => void;
}) {
  const inboundCount = messages.filter((message) => message.direction === 'inbound').length;
  const outboundCount = messages.filter((message) => message.direction === 'outbound').length;
  const groupConversation = conversation.conversationType === 'group';
  const phoneAvailable = !groupConversation && !conversation.contact.phoneNumber.includes('@');
  const contactProfileQuery = useGetConversationContactProfile(conversation.id, {
    query: {
      enabled: evolutionMode,
      queryKey: getGetConversationContactProfileQueryKey(conversation.id),
      staleTime: 5 * 60 * 1000,
    },
  });
  const contactProfile = contactProfileQuery.data;
  const profileName = contactProfile?.profileName || conversation.contact.name;
  const [photoUnavailable, setPhotoUnavailable] = useState(false);
  useEffect(() => setPhotoUnavailable(false), [contactProfile?.profilePictureUrl]);
  const profileDetails: Array<[string, string | null]> = [
    ['Sobre', contactProfile?.about ?? null],
    ['Nome comercial', contactProfile?.verifiedName ?? null],
    ['Descrição comercial', contactProfile?.businessDescription ?? null],
    ['Categoria', contactProfile?.businessCategory ?? null],
    ['E-mail comercial', contactProfile?.businessEmail ?? null],
    ['Site', contactProfile?.businessWebsite ?? null],
    ['Endereço comercial', contactProfile?.businessAddress ?? null],
    ['Horário comercial', contactProfile?.businessHours ?? null],
  ];
  const hasProfileDetails = profileDetails.some(([, value]) => Boolean(value));
  return (
    <aside className="contact-profile-panel rise-in" aria-label="Perfil do cliente" data-testid="contact-profile-panel">
      <header className="contact-profile-header">
        <div>
          <p className="contact-profile-kicker">{conversation.conversationType === 'group' ? 'Grupo' : 'Cliente'}</p>
          <h3>{conversation.conversationType === 'group' ? 'Dados do grupo' : 'Dados do contato'}</h3>
        </div>
        <button type="button" className="action-btn" onClick={onClose} aria-label="Fechar perfil do cliente" data-testid="button-close-contact-profile"><X size={19} /></button>
      </header>
      <div className="contact-profile-content quiet-scroll">
        <div className="contact-profile-hero">
          <div className="avatar chat-contact-photo" aria-hidden="true">
            {contactProfile?.profilePictureUrl && !photoUnavailable
              ? <img src={contactProfile.profilePictureUrl} alt="" className="h-full w-full object-cover" onError={() => setPhotoUnavailable(true)} />
              : initials(profileName)}
          </div>
          <strong>{profileName}</strong>
          <span>{groupConversation ? 'Grupo do WhatsApp' : phoneAvailable ? conversation.contact.phoneNumber : 'Telefone não disponibilizado'}</span>
        </div>
        <div className="contact-profile-section">
          <span className="contact-profile-label">{groupConversation ? 'Identificador do grupo' : 'Contato'}</span>
          {groupConversation
            ? <span className="contact-profile-phone">{conversation.remoteJid || 'Grupo do WhatsApp'}</span>
            : phoneAvailable
              ? <a href={`tel:${conversation.contact.phoneNumber}`} className="contact-profile-phone"><Phone size={15} /> {conversation.contact.phoneNumber}</a>
              : <span className="contact-profile-phone">Telefone não disponibilizado pela conexão.</span>}
        </div>
        {evolutionMode && (
          <div className="contact-profile-section">
            <span className="contact-profile-label">Perfil do WhatsApp</span>
            {contactProfileQuery.isLoading ? (
              <p className="flex items-center gap-2 text-xs text-[#9ba7a0]"><Loader2 size={14} className="animate-spin" /> Consultando dados disponíveis…</p>
            ) : contactProfileQuery.isError ? (
              <div className="space-y-2">
                <p className="text-xs leading-5 text-[#d7a79b]">Não foi possível consultar o perfil agora. A foto e os outros dados dependem da conexão e da privacidade do contato.</p>
                <button type="button" className="text-xs font-medium text-[#b9d8c1] hover:text-white" onClick={() => void contactProfileQuery.refetch()}>Tentar novamente</button>
              </div>
            ) : contactProfile ? (
              <div className="space-y-3">
                {contactProfile.isBusiness !== null && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#405a49] bg-[#263a2e] px-2.5 py-1 text-[11px] font-medium text-[#b9d8c1]">
                    {contactProfile.isBusiness && <ShieldCheck size={13} />}
                    {contactProfile.isBusiness ? 'Conta comercial' : 'Conta pessoal'}
                  </span>
                )}
                {contactProfile.numberExists !== null && (
                  <p className={`text-xs ${contactProfile.numberExists ? 'text-[#9ecfae]' : 'text-[#d7a79b]'}`}>
                    {contactProfile.numberExists ? 'Número encontrado no WhatsApp' : 'Número não confirmado no WhatsApp'}
                  </p>
                )}
                {contactProfile.whatsappId && (
                  <div className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7e8d84]">Identificador WhatsApp</span>
                    <span className="break-all text-xs leading-5 text-[#cbd5cf]">{contactProfile.whatsappId}</span>
                  </div>
                )}
                {profileDetails.map(([label, value]) => value && (
                  <div className="grid gap-1" key={label}>
                    <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7e8d84]">{label}</span>
                    {label === 'E-mail comercial'
                      ? <a href={`mailto:${value}`} className="break-all text-xs leading-5 text-[#b9d8c1] hover:text-white">{value}</a>
                      : label === 'Site' && /^https?:\/\//i.test(value)
                        ? <a href={value} target="_blank" rel="noreferrer" className="break-all text-xs leading-5 text-[#b9d8c1] hover:text-white">{value}</a>
                        : <span className="break-words whitespace-pre-line text-xs leading-5 text-[#cbd5cf]">{value}</span>}
                  </div>
                ))}
                {!hasProfileDetails && contactProfile.numberExists === null && contactProfile.isBusiness === null && (
                  <p className="text-xs leading-5 text-[#9ba7a0]">A conexão via QR Code não retornou outros dados públicos do perfil. Isso pode depender da privacidade do contato ou da compatibilidade da conexão.</p>
                )}
                <p className="text-[10px] text-[#75837b]">Consultado às {formatClock(contactProfile.fetchedAt) || 'agora'}</p>
              </div>
            ) : (
              <p className="text-xs leading-5 text-[#9ba7a0]">Nenhum dado adicional de perfil foi retornado pela conexão via QR Code.</p>
            )}
          </div>
        )}
        <div className="contact-profile-section">
          <span className="contact-profile-label">Resumo da conversa</span>
          <div className="contact-profile-stats">
            <div><strong>{messages.length}</strong><span>mensagens</span></div>
            <div><strong>{inboundCount}</strong><span>recebidas</span></div>
            <div><strong>{outboundCount}</strong><span>enviadas</span></div>
          </div>
        </div>
        <div className="contact-profile-note">
          <UserRound size={16} />
          <p>{evolutionMode ? 'O perfil é consultado ao abrir este painel. Só mostramos informações que a conexão consegue obter; dados ocultos pelas configurações de privacidade não aparecem.' : conversation.conversationType === 'group' ? 'O nome e o identificador do grupo são sincronizados pela conexão do WhatsApp.' : 'O nome e o telefone são sincronizados pela conexão do WhatsApp.'}</p>
        </div>
      </div>
    </aside>
  );
}

function ChatPanel({
  conversation,
  connected,
  evolutionMode,
  onBack,
  onSettings,
  onDeleteConversation,
}: {
  conversation: Conversation | undefined;
  connected: boolean;
  evolutionMode: boolean;
  onBack: () => void;
  onSettings: () => void;
  onDeleteConversation: () => void;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [optimistic, setOptimistic] = useState<DisplayChatMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaPreviewByMessageId, setMediaPreviewByMessageId] = useState<Record<string, string>>({});
  const [optimisticConversationId, setOptimisticConversationId] = useState<number | null>(null);
  const [reactionError, setReactionError] = useState('');
  const messagesQuery = useListConversationMessages(conversation?.id ?? 0, {
    query: { enabled: Boolean(conversation?.id), queryKey: getListConversationMessagesQueryKey(conversation?.id ?? 0), refetchInterval: 5000 },
  });
  const sendMessage = useSendConversationMessage();
  const sendMedia = useSendConversationMedia();
  const sendReaction = useSendConversationMessageReaction();
  const messages = messagesQuery.data ?? [];
  const messagesWithMediaPreviews = messages.map((message) => ({
    ...message,
    mediaPreviewUrl: message.whatsappMessageId
      ? mediaPreviewByMessageId[message.whatsappMessageId] || message.mediaUrl || undefined
      : message.mediaUrl || undefined,
    mediaFileName: message.mediaFileName || null,
    mediaCaption: message.mediaCaption || null,
  }));
  const reactionsByMessage = useMemo(() => {
    const result = new Map<number, ChatMessage[]>();
    for (const message of messages) {
      if (message.messageType !== 'reaction' || !message.replyToMessageId || !message.reactionEmoji) continue;
      result.set(message.replyToMessageId, [...(result.get(message.replyToMessageId) ?? []), message]);
    }
    return result;
  }, [messages]);
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const reactToMessage = (messageId: number, emoji: string) => {
    if (!conversation) return;
    setReactionError('');
    sendReaction.mutate({ conversationId: conversation.id, messageId, data: { emoji } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversation.id) });
        void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      },
      onError: (error) => setReactionError(errorText(error)),
    });
  };
  const activeOptimistic = optimisticConversationId === conversation?.id ? optimistic : null;
  const showOptimistic = Boolean(
    activeOptimistic
      && !messagesWithMediaPreviews.some((message) => (
        message.id === activeOptimistic.id
        || (message.whatsappMessageId && message.whatsappMessageId === activeOptimistic.whatsappMessageId)
      )),
  );
  const sending = sendMessage.isPending || sendMedia.isPending;

  useEffect(() => {
    if (!mediaFile) {
      setMediaPreviewUrl(null);
      return;
    }
    if (mediaFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setMediaPreviewUrl(typeof reader.result === 'string' ? reader.result : null);
      reader.readAsDataURL(mediaFile);
      return () => reader.abort();
    }
    if (mediaFile.type.startsWith('video/') || mediaFile.type.startsWith('audio/')) {
      const url = URL.createObjectURL(mediaFile);
      setMediaPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setMediaPreviewUrl(null);
    return undefined;
  }, [mediaFile]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const messageContent = content.trim();
    if (!conversation || sending || (!messageContent && !mediaFile)) return;
    const mediaType = mediaFile
      ? (mediaFile.type.startsWith('image/') ? 'image' : mediaFile.type.startsWith('video/') ? 'video' : mediaFile.type.startsWith('audio/') ? 'audio' : 'document')
      : 'text';
    const temporary: DisplayChatMessage = { id: -Date.now(), direction: 'outbound', content: mediaFile?.name || messageContent, messageType: mediaType, status: 'sending', createdAt: new Date().toISOString(), whatsappMessageId: null, mediaUrl: null, mediaMimeType: mediaFile?.type || null, mediaCaption: mediaFile ? (messageContent || null) : null, mediaFileName: mediaFile?.name || null, replyToMessageId: null, reactionEmoji: null, mediaPreviewUrl: mediaPreviewUrl ?? undefined };
    setOptimistic(temporary);
    setOptimisticConversationId(conversation.id);
    setContent('');
    const onTextSuccess = () => {
      setOptimistic(null);
      setOptimisticConversationId(null);
      setMediaFile(null);
      void queryClient.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversation.id) });
      void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    };
    const onError = () => setOptimistic({ ...temporary, status: 'failed' });
    if (mediaFile) {
      const fileToSend = mediaFile;
      const sentPreviewUrl = mediaPreviewUrl;
      const onMediaSuccess = (sentMessage: ChatMessage) => {
        if (sentMessage.messageType === 'image' && sentMessage.whatsappMessageId && sentPreviewUrl) {
          setMediaPreviewByMessageId((current) => ({
            ...current,
            [sentMessage.whatsappMessageId as string]: sentPreviewUrl,
          }));
          setOptimistic({
            ...sentMessage,
            mediaPreviewUrl: sentPreviewUrl,
            mediaFileName: fileToSend.name,
            mediaCaption: messageContent || null,
          });
        } else {
          setOptimistic(null);
          setOptimisticConversationId(null);
        }
        setMediaFile(null);
        void queryClient.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversation.id) });
        void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      };
      sendMedia.mutate({ conversationId: conversation.id, data: { file: fileToSend, ...(messageContent ? { caption: messageContent } : {}) } }, { onSuccess: onMediaSuccess, onError });
      return;
    }
    sendMessage.mutate({ conversationId: conversation.id, data: { content: messageContent } }, { onSuccess: onTextSuccess, onError });
  };

  if (!conversation) return <ChatEmpty connected={connected} onSettings={onSettings} onOpenConversations={onBack} />;

  return (
    <section className="chat-area" data-testid="panel-chat">
      <header className="chat-topbar">
        <button type="button" className="action-btn mobile-only" onClick={onBack} data-testid="button-back-to-conversations" aria-label="Voltar para conversas"><ArrowLeft size={20} /></button>
        <Avatar name={conversation.contact.name} size="large" />
        <div className="chat-contact-meta">
          <h2 className="chat-contact-name" data-testid={`text-contact-name-${conversation.id}`}>{conversation.contact.name}</h2>
          <p className="chat-contact-status">{conversation.conversationType === 'group' ? 'Grupo do WhatsApp' : conversation.contact.phoneNumber}</p>
        </div>
        <div className="chat-header-actions">
          {conversation.conversationType !== 'group' && !conversation.contact.phoneNumber.includes('@') && <>
            <button type="button" className="action-btn" onClick={() => { window.location.href = `tel:${conversation.contact.phoneNumber}`; }} data-testid="button-call-contact" aria-label="Ligar para contato"><Phone size={19} /></button>
            <button type="button" className="action-btn" onClick={() => undefined} data-testid="button-video-contact" aria-label="Iniciar chamada de vídeo"><Video size={19} /></button>
          </>}
           <button type="button" className="action-btn" onClick={() => setProfileOpen((open) => !open)} data-testid="button-contact-profile" aria-label="Ver perfil do cliente"><UserRound size={19} /></button>
          <button type="button" className="action-btn mobile-only mobile-delete-btn" onClick={onDeleteConversation} data-testid="button-delete-conversation-mobile" aria-label="Apagar conversa da inbox"><Trash2 size={19} /></button>
          <div className="relative">
            <button type="button" className="action-btn" onClick={() => setMenuOpen((open) => !open)} data-testid="button-chat-menu" aria-label="Mais opções"><MoreVertical size={20} /></button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-10 w-52 rounded-lg border border-[#4b514e] bg-[#272b29] p-2 shadow-2xl" data-testid="menu-chat-options">
                 <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-[#c0cac4] hover:bg-[#303533]" onClick={() => { setProfileOpen(true); setMenuOpen(false); }}><UserRound size={14} /> Dados do contato</button>
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
            <div className="message-row inbound rise-in" data-testid="state-messages-loading" role="status" aria-label="Carregando mensagens">
              <div className="message-loading-bubble" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          {messagesQuery.isError && <div className="status-note mx-auto my-5 max-w-sm justify-center text-center" data-testid="state-messages-error"><AlertCircle size={17} /> Não foi possível carregar as mensagens. A atualização automática continuará tentando.</div>}
          {reactionError && <div className="status-note mx-auto my-3 max-w-sm justify-center text-center" role="alert"><AlertCircle size={15} />{reactionError}</div>}
          {!messagesQuery.isLoading && !messagesQuery.isError && messages.length === 0 && !optimistic && <div className="py-20 text-center text-xs text-[#89958f]" data-testid="state-messages-empty">Nenhuma mensagem nesta conversa.</div>}
          {messagesWithMediaPreviews.filter((message) => message.messageType !== 'reaction').map((message) => <MessageBubble key={message.id} message={message} reactions={reactionsByMessage.get(message.id) ?? []} replyPreview={message.replyToMessageId ? messagesById.get(message.replyToMessageId)?.content : undefined} onReact={evolutionMode ? reactToMessage : undefined} />)}
          {showOptimistic && activeOptimistic && <MessageBubble message={activeOptimistic} />}
        </div>
      </div>

      <div className="composer-wrap">
        {mediaFile && (
          <div className="attachment-draft" data-testid="attachment-draft">
            <div className="attachment-draft-preview">
              {mediaPreviewUrl && mediaFile.type.startsWith('image/') && <img src={mediaPreviewUrl} alt="Prévia do arquivo selecionado" />}
              {mediaPreviewUrl && mediaFile.type.startsWith('video/') && <video src={mediaPreviewUrl} controls muted preload="metadata" />}
              {mediaPreviewUrl && mediaFile.type.startsWith('audio/') && <audio src={mediaPreviewUrl} controls preload="metadata" />}
              {!mediaPreviewUrl && <FileText size={24} />}
            </div>
            <div className="attachment-draft-info">
              <strong>{mediaFile.name}</strong>
              <span>{formatFileSize(mediaFile.size)} · {mediaFile.type || 'Documento'}</span>
              <small>{mediaFile.type.startsWith('image/') || mediaFile.type.startsWith('video/') || mediaFile.type.startsWith('audio/') ? 'Adicione uma legenda abaixo antes de enviar' : 'O documento será enviado como anexo'}</small>
            </div>
            <button type="button" className="action-btn" onClick={() => setMediaFile(null)} disabled={sending} aria-label="Remover arquivo selecionado"><X size={17} /></button>
          </div>
        )}
        <form className="composer" onSubmit={submit}>
          <label className="attach-btn" aria-label="Enviar arquivo" title="Enviar imagem, vídeo, áudio ou documento">
            <Paperclip size={19} />
            <input
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
              onChange={(event) => setMediaFile(event.target.files?.[0] ?? null)}
              disabled={sending}
              data-testid="input-message-file"
            />
          </label>
          <textarea
            className="composer-field"
            rows={1}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
            placeholder={mediaFile ? 'Adicione uma legenda (opcional)' : 'Digite uma mensagem'}
            disabled={sending}
            data-testid="input-message"
            aria-label="Mensagem"
          />
          <button type="submit" className="send-btn" disabled={(!content.trim() && !mediaFile) || sending} data-testid="button-send-message" aria-label={mediaFile ? 'Enviar arquivo' : 'Enviar mensagem'}>
            {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
          </button>
        </form>
        {mediaFile && <div className="attachment-selection"><Paperclip size={14} /><span>{mediaFile.name}</span><button type="button" onClick={() => setMediaFile(null)} aria-label="Remover arquivo selecionado"><X size={14} /></button></div>}
        {(sendMessage.isError || sendMedia.isError) && <p className="mx-auto mt-2 max-w-[1000px] text-right text-[11px] text-[#eea59e]" data-testid="status-send-error">{errorText(sendMessage.error || sendMedia.error)}</p>}
      </div>
      {profileOpen && <ContactProfilePanel conversation={conversation} messages={messages} evolutionMode={evolutionMode} onClose={() => setProfileOpen(false)} />}
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
  const evolutionConnectionQuery = useGetEvolutionConnection({ query: { refetchInterval: 10000, queryKey: getGetEvolutionConnectionQueryKey() } });
  const connection = connectionQuery.data;
  const evolutionActive = Boolean(evolutionConnectionQuery.data?.active);
  const [accessToken, setAccessToken] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [formError, setFormError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedVerifyToken, setCopiedVerifyToken] = useState(false);
  const [connectionMethod, setConnectionMethod] = useState<'cloud' | 'evolution'>('cloud');
  const connect = useConnectWhatsApp();
  const disconnect = useDisconnectWhatsApp();

  useEffect(() => {
    if (connection?.businessAccountId) setBusinessAccountId(connection.businessAccountId);
    if (connection?.selectedPhoneNumberId) setPhoneNumberId(connection.selectedPhoneNumberId);
  }, [connection]);

  const isConnected = Boolean(connection?.connected);
  useEffect(() => {
    if (evolutionActive) setConnectionMethod('evolution');
  }, [evolutionActive]);
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
          <div className="connection-method-tabs" role="tablist" aria-label="Método de conexão do WhatsApp">
            <button type="button" role="tab" aria-selected={connectionMethod === 'cloud'} className={connectionMethod === 'cloud' ? 'is-active' : ''} onClick={() => setConnectionMethod('cloud')} data-testid="tab-whatsapp-cloud">API Oficial{isConnected && !evolutionActive && <span>Ativa</span>}</button>
            <button type="button" role="tab" aria-selected={connectionMethod === 'evolution'} className={connectionMethod === 'evolution' ? 'is-active' : ''} onClick={() => setConnectionMethod('evolution')} data-testid="tab-whatsapp-evolution"><QrCode size={15} /> Conectar via QR Code{evolutionActive && <span>Ativa</span>}</button>
          </div>
          {connectionMethod === 'evolution' ? <EvolutionConnectionPanel /> : <>
          {connectionQuery.isLoading && <div className="space-y-3" data-testid="state-connection-loading"><div className="skeleton h-12 rounded-lg" /><div className="skeleton h-12 rounded-lg" /></div>}
          {connectionQuery.isError && <div className="status-note" data-testid="state-connection-error"><AlertCircle size={16} /> Não foi possível consultar o status atual da conexão.</div>}
          <div className={`flex items-center justify-between rounded-lg border p-4 ${isConnected ? 'border-[#35684b] bg-[#1b3024]' : 'border-[#685330] bg-[#332b1e]'}`} data-testid="status-connection">
            <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-[#2b4736] text-[#68d18c]"><Wifi size={17} /></div><div><p className="text-sm font-medium">{isConnected ? 'WhatsApp conectado' : 'Conexão pendente'}</p><p className="mt-1 text-[11px] text-[#a2aaa5]">{isConnected ? (evolutionActive ? 'A API Oficial está conectada; o inbox usa a conexão via QR Code.' : 'Mensagens do inbox passam pela API Oficial.') : 'Adicione as credenciais da Meta para começar.'}</p></div></div>
            <span className={`connection-pill ${isConnected ? '' : 'offline'}`}><span className="dot" />{isConnected ? (evolutionActive ? 'Conectada' : 'Ativa') : 'Offline'}</span>
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
          </>}
          <button type="button" className="btn-ghost w-full" onClick={() => void logout()} data-testid="button-logout"><LogOut size={16} /> Sair da conta</button>
        </div>
      </div>
    </div>
  );
}

function NewConversationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (conversation: Conversation) => void }) {
  const queryClient = useQueryClient();
  const templatesQuery = useListTemplates({ query: { queryKey: getListTemplatesQueryKey() } });
  const evolutionConnectionQuery = useGetEvolutionConnection({ query: { refetchInterval: 10000, queryKey: getGetEvolutionConnectionQueryKey() } });
  const evolutionMode = Boolean(evolutionConnectionQuery.data?.active);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('BR');
  const [sendMode, setSendMode] = useState<'text' | 'template'>('text');
  const [content, setContent] = useState('');
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const startConversation = useStartConversation();
  const approvedTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.status.toUpperCase() === 'APPROVED'),
    [templatesQuery.data],
  );
  const selectedTemplate = useMemo(
    () => approvedTemplates.find((template) => template.id === templateId),
    [approvedTemplates, templateId],
  );
  const parameterSlots = useMemo(
    () => selectedTemplate ? templateParameterSlots(selectedTemplate) : [],
    [selectedTemplate],
  );

  useEffect(() => {
    if (evolutionMode && sendMode === 'template') setSendMode('text');
  }, [evolutionMode, sendMode]);

  useEffect(() => {
    if (templateId === null && approvedTemplates.length > 0) {
      setTemplateId(approvedTemplates[0].id);
      return;
    }
    if (templateId !== null && approvedTemplates.length > 0 && !selectedTemplate) {
      setTemplateId(approvedTemplates[0].id);
    }
  }, [approvedTemplates, selectedTemplate, templateId]);

  useEffect(() => {
    if (!selectedTemplate) {
      setParameterValues({});
      return;
    }
    setParameterValues(Object.fromEntries(
      parameterSlots.map((slot, index) => [
        slot.key,
        selectedTemplate.variables[index]?.startsWith('{{') ? '' : selectedTemplate.variables[index] ?? '',
      ]),
    ));
  }, [parameterSlots, selectedTemplate]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    const parsedPhoneNumber = parsePhoneNumberFromString(phoneNumber.trim(), phoneCountry);
    if (!parsedPhoneNumber || !parsedPhoneNumber.isPossible()) {
      setFormError('Informe um telefone válido para o país selecionado.');
      return;
    }
    const internationalPhoneNumber = parsedPhoneNumber.number;
    if (sendMode === 'text') {
      if (!content.trim()) {
        setFormError('Digite a mensagem inicial.');
        return;
      }
      startConversation.mutate({
        data: {
          phoneNumber: internationalPhoneNumber,
          content: content.trim(),
        },
      }, {
        onSuccess: (result) => { void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }); onCreated(result.conversation); },
        onError: (error) => setFormError(errorText(error)),
      });
      return;
    }
    if (!selectedTemplate) {
      setFormError('É necessário ter um template aprovado pela Meta para iniciar uma conversa.');
      return;
    }
    const values = parameterSlots.map((slot) => parameterValues[slot.key]?.trim() ?? '');
    if (values.some((value) => !value)) {
      setFormError('Preencha todos os campos do template antes de enviar.');
      return;
    }
    const componentParameters = parameterSlots.map((slot, index) => ({
      component: slot.component,
      parameterType: slot.parameterType,
      index: slot.index,
      subType: slot.subType,
      value: values[index],
    }));
    const variables = parameterSlots
      .filter((slot) => slot.component === 'body' && slot.parameterType === 'text')
      .map((slot) => parameterValues[slot.key]?.trim() ?? '');
    startConversation.mutate({
      data: {
        phoneNumber: internationalPhoneNumber,
        templateId: selectedTemplate.id,
        variables,
        componentParameters,
      },
    }, {
      onSuccess: (result) => { void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }); onCreated(result.conversation); },
      onError: (error) => setFormError(errorText(error)),
    });
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title" data-testid="dialog-new-conversation">
      <div className="settings-card rise-in">
        <div className="settings-section flex items-start justify-between"><div><p className="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#68c98a]">Novo contato</p><h2 id="new-conversation-title" className="settings-title">Iniciar conversa</h2><p className="settings-copy">Envie uma mensagem normal ou use um template aprovado.</p></div><button type="button" className="action-btn" onClick={onClose} data-testid="button-close-new-conversation" aria-label="Fechar nova conversa"><X size={20} /></button></div>
        <form className="space-y-4 p-5" onSubmit={submit}>
          <div className="grid grid-cols-[1.15fr_1fr] gap-3">
            <div className="field"><label className="field-label" htmlFor="new-phone-country">País / DDI</label><select id="new-phone-country" className="field-input" value={phoneCountry} onChange={(event) => setPhoneCountry(event.target.value as CountryCode)} data-testid="select-new-phone-country">{phoneCountryOptions.map((country) => <option key={country.country} value={country.country}>{country.name} (+{country.callingCode})</option>)}</select></div>
            <div className="field"><label className="field-label" htmlFor="new-phone-number">Telefone</label><input id="new-phone-number" type="tel" inputMode="tel" className="field-input" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder={phoneCountry === 'BR' ? 'DDD e número' : 'Número local'} data-testid="input-new-phone-number" /></div>
          </div>
          <p className="field-help -mt-2">O DDI selecionado será aplicado automaticamente. Você também pode colar um número completo com DDI.</p>
          <div className="field"><label className="field-label" htmlFor="new-message-mode">Tipo de mensagem</label><select id="new-message-mode" className="field-input" value={sendMode} onChange={(event) => setSendMode(event.target.value as 'text' | 'template')} data-testid="select-new-message-mode"><option value="text">Mensagem normal</option><option value="template" disabled={evolutionMode || approvedTemplates.length === 0}>{evolutionMode ? 'Template disponível apenas na API Oficial' : `Template aprovado${approvedTemplates.length === 0 ? ' (nenhum disponível)' : ''}`}</option></select>{evolutionMode && <p className="field-help">Templates oficiais exigem conexão ativa com a API Oficial da Meta.</p>}</div>
          {sendMode === 'text' && <div className="field"><label className="field-label" htmlFor="new-message">Mensagem inicial</label><textarea id="new-message" className="field-input min-h-28 resize-y" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Olá, como podemos ajudar?" data-testid="input-new-message" /><p className="field-help">A Meta pode bloquear texto normal quando o contato ainda não iniciou uma conversa ou não há janela de atendimento ativa.</p></div>}
          {templatesQuery.isLoading && <div className="status-note"><Loader2 size={16} className="animate-spin" /> Carregando templates aprovados...</div>}
          {sendMode === 'template' && !templatesQuery.isLoading && approvedTemplates.length === 0 && <div className="status-note"><AlertCircle size={16} /> Nenhum template aprovado está disponível.</div>}
          {sendMode === 'template' && approvedTemplates.length > 0 && <div className="field"><label className="field-label" htmlFor="new-template">Template aprovado</label><select id="new-template" className="field-input" value={templateId ?? ''} onChange={(event) => setTemplateId(Number(event.target.value))} data-testid="select-new-template">{approvedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.languageCode}</option>)}</select><p className="field-help">{selectedTemplate?.body}</p></div>}
          {sendMode === 'template' && parameterSlots.map((slot) => <div className="field" key={slot.key}><label className="field-label" htmlFor={`new-template-${slot.key}`}>{slot.label}</label><input id={`new-template-${slot.key}`} className="field-input" value={parameterValues[slot.key] ?? ''} onChange={(event) => setParameterValues((current) => ({ ...current, [slot.key]: event.target.value }))} placeholder={slot.placeholder} data-testid={`input-new-template-${slot.key}`} /></div>)}
          {formError && <p className="flex items-center gap-2 text-xs text-[#eea59e]" data-testid="status-new-conversation-error"><AlertCircle size={15} />{formError}</p>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={onClose} data-testid="button-cancel-new-conversation">Cancelar</button><button type="submit" className="btn-primary" disabled={startConversation.isPending || (sendMode === 'template' && !selectedTemplate)} data-testid="button-start-conversation">{startConversation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{startConversation.isPending ? 'Iniciando...' : 'Iniciar conversa'}</button></div>
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

type ManualButtonDraft = {
  type: 'URL' | 'QUICK_REPLY' | 'PHONE_NUMBER';
  text: string;
  url: string;
  phoneNumber: string;
};

type ManualTemplateDraft = {
  name: string;
  languageCode: string;
  category: string;
  headerFormat: 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  headerText: string;
  body: string;
  footer: string;
  buttons: ManualButtonDraft[];
};

const emptyManualTemplate = (): ManualTemplateDraft => ({
  name: '',
  languageCode: 'pt_BR',
  category: 'UTILITY',
  headerFormat: 'NONE',
  headerText: '',
  body: '',
  footer: '',
  buttons: [],
});

function buildManualTemplateInput(draft: ManualTemplateDraft): TemplateInput {
  const components: TemplateComponent[] = [
    ...(draft.headerFormat !== 'NONE'
      ? [{
          type: 'HEADER',
          format: draft.headerFormat,
          text: draft.headerFormat === 'TEXT' ? draft.headerText.trim() || null : null,
          example: null,
          buttons: [],
        }]
      : []),
    { type: 'BODY', format: null, text: draft.body.trim(), example: null, buttons: [] },
    ...(draft.footer.trim()
      ? [{ type: 'FOOTER', format: null, text: draft.footer.trim(), example: null, buttons: [] }]
      : []),
    ...(draft.buttons.length
      ? [{
          type: 'BUTTONS',
          format: null,
          text: null,
          example: null,
          buttons: draft.buttons.map((button) => ({
            type: button.type,
            text: button.text.trim() || null,
            url: button.type === 'URL' ? button.url.trim() || null : null,
            phoneNumber: button.type === 'PHONE_NUMBER' ? button.phoneNumber.trim() || null : null,
            example: null,
          })),
        }]
      : []),
  ];
  const variableSource = `${draft.headerText} ${draft.body} ${draft.buttons.map((button) => button.url).join(' ')}`;
  return {
    name: draft.name.trim(),
    languageCode: draft.languageCode.trim(),
    category: draft.category,
    status: 'PENDING',
    header: draft.headerFormat === 'TEXT' ? draft.headerText.trim() || null : null,
    body: draft.body.trim(),
    footer: draft.footer.trim() || null,
    variables: variableNumbers(variableSource).map((index) => `{{${index}}}`),
    components,
  };
}

function templateStatusLabel(status: string) {
  const normalized = status.toUpperCase().replace(/[\s-]+/g, '_');
  return ({
    PENDING: 'Em análise',
    IN_REVIEW: 'Em análise',
    PENDING_REVIEW: 'Em análise',
    APPROVED: 'Aprovado',
    REJECTED: 'Rejeitado',
    PAUSED: 'Pausado',
    DISABLED: 'Desabilitado',
    LIMITED: 'Limitado',
    DELETED: 'Excluído',
    DISABLED_BY_META: 'Desabilitado',
    IMPORTED: 'Em análise',
  } as Record<string, string>)[normalized] ?? status;
}

function dispatchStatusLabel(status: string) {
  return ({ pending: 'Pendente', partial: 'Parcial', sent: 'Aceito pela Meta', delivered: 'Entregue', read: 'Lido', failed: 'Falhou' } as Record<string, string>)[status] ?? status;
}

function TemplateWorkspace({ onBackToInbox }: { onBackToInbox: () => void }) {
  const queryClient = useQueryClient();
  const contactsQuery = useListContacts({ query: { queryKey: getListContactsQueryKey() } });
  const templatesQuery = useListTemplates({ query: { queryKey: getListTemplatesQueryKey() } });
  const costsQuery = useGetTemplateCosts({ query: { queryKey: getGetTemplateCostsQueryKey() } });
  const dispatchesQuery = useListTemplateDispatches({ query: { queryKey: getListTemplateDispatchesQueryKey(), refetchInterval: 5000 } });
  const [selectedDispatchId, setSelectedDispatchId] = useState<number | null>(null);
  const dispatchDetailQuery = useGetTemplateDispatch(selectedDispatchId ?? 0, { query: { queryKey: getGetTemplateDispatchQueryKey(selectedDispatchId ?? 0), enabled: selectedDispatchId !== null, refetchInterval: 5000 } });
  const createTemplate = useCreateTemplate();
  const createContact = useCreateContact();
  const dispatchTemplate = useDispatchTemplate();
  const contacts = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const dispatches = useMemo(() => dispatchesQuery.data ?? [], [dispatchesQuery.data]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [flowStep, setFlowStep] = useState<1 | 2 | 3>(1);
  const [manualDraft, setManualDraft] = useState<ManualTemplateDraft>(() => emptyManualTemplate());
  const [manualError, setManualError] = useState('');
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadError, setLeadError] = useState('');
  const [selectedLeadPhones, setSelectedLeadPhones] = useState<string[]>([]);
  const [recipientsText, setRecipientsText] = useState('');
  const [tps, setTps] = useState(10);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [dispatchError, setDispatchError] = useState('');
  const [dispatchResult, setDispatchResult] = useState<TemplateDispatchResult | null>(null);
  const selectedTemplate = useMemo(() => templates.find((template) => template.id === selectedId), [templates, selectedId]);
  const parameterSlots = useMemo(() => selectedTemplate ? templateParameterSlots(selectedTemplate) : [], [selectedTemplate]);
  const selectedLeadRecipients = useMemo(() => contacts.filter((contact) => selectedLeadPhones.includes(contact.phoneNumber)).map((contact) => contact.phoneNumber), [contacts, selectedLeadPhones]);
  const recipients = useMemo(() => recipientsText.trim() ? recipientsText.split(/[,\n;]+/).map((item) => item.trim()).filter(Boolean) : selectedLeadRecipients, [recipientsText, selectedLeadRecipients]);
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

  const submitManualTemplate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setManualError('');
    if (!manualDraft.name.trim()) {
      setManualError('Informe um nome para o template.');
      return;
    }
    if (!manualDraft.body.trim()) {
      setManualError('Informe o texto do corpo do template.');
      return;
    }
    if (manualDraft.headerFormat === 'TEXT' && !manualDraft.headerText.trim()) {
      setManualError('Informe o texto do cabeçalho.');
      return;
    }
    createTemplate.mutate({ data: buildManualTemplateInput(manualDraft) }, {
      onSuccess: (created) => {
        queryClient.setQueryData<Template[]>(getListTemplatesQueryKey(), (current = []) => current.some((template) => template.id === created.id) ? current : [...current, created]);
        void queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        setSelectedId(created.id);
        setManualDraft(emptyManualTemplate());
      },
      onError: (error) => setManualError(errorText(error)),
    });
  };

  const submitLead = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLeadError('');
    if (!leadName.trim()) {
      setLeadError('Informe o nome do lead.');
      return;
    }
    if (!leadPhone.trim()) {
      setLeadError('Informe o telefone com DDI.');
      return;
    }
    createContact.mutate({ data: { name: leadName.trim(), phoneNumber: leadPhone.trim() } }, {
      onSuccess: (contact) => {
        void queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setSelectedLeadPhones((current) => current.includes(contact.phoneNumber) ? current : [...current, contact.phoneNumber]);
        setLeadName('');
        setLeadPhone('');
      },
      onError: (error) => setLeadError(errorText(error)),
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
     dispatchTemplate.mutate({ templateId: selectedTemplate.id, data: { recipients, componentParameters, tps } }, {
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
    return templateStatusLabel(normalized);
  };

  return (
    <section className="templates-area" data-testid="workspace-templates">
      <header className="templates-topbar">
        <div>
          <button type="button" className="templates-mobile-back mobile-only" onClick={onBackToInbox} data-testid="button-back-to-inbox"><ArrowLeft size={16} /> Conversas</button>
          <h1 className="templates-title">Envios oficiais</h1>
          <p className="templates-subtitle">Use os componentes aprovados pela Meta e acompanhe a entrega por destinatário.</p>
        </div>
        <div className="templates-connection-note"><ShieldCheck size={14} /> envio oficial pela Meta</div>
      </header>
      <nav className="flow-stepper" aria-label="Etapas dos envios">
        {[
          { number: 1 as const, label: 'Templates', detail: 'Cadastro e status' },
          { number: 2 as const, label: 'Leads', detail: 'Seleção de destinatários' },
          { number: 3 as const, label: 'Envios', detail: 'TPS e acompanhamento' },
        ].map((step) => {
          const available = step.number === 1 || (step.number === 2 && templates.length > 0) || (step.number === 3 && selectedLeadPhones.length > 0 && templates.some((template) => template.status.toLowerCase() === 'approved'));
          return <button type="button" key={step.number} className="flow-step" data-active={flowStep === step.number} data-complete={flowStep > step.number} disabled={!available} onClick={() => available && setFlowStep(step.number)}><span className="flow-step-number">{flowStep > step.number ? <Check size={14} /> : step.number}</span><span><strong>{step.label}</strong><small>{step.detail}</small></span></button>;
        })}
      </nav>
      <div className="templates-body">
        <section className="templates-library flow-panel" data-active={flowStep === 1} aria-label="Biblioteca de templates" data-testid="template-list">
          <div className="templates-section-label"><span>Biblioteca</span><span className="templates-count">{templates.length} {templates.length === 1 ? 'template' : 'templates'}</span></div>
          {templatesQuery.isLoading && <div className="templates-loading" data-testid="state-templates-loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>}
          {templatesQuery.isError && <div className="status-note" data-testid="state-templates-error"><AlertCircle size={16} /><span>Não foi possível carregar os templates.</span></div>}
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
          <div className="template-import-card template-create-card">
            <div className="template-import-heading"><Plus size={16} /><span>Criar template manualmente</span></div>
            <p className="template-import-help">Cadastre o conteúdo no padrão da Meta. Todo novo template começa com status <strong>Em análise</strong>.</p>
            <form className="manual-template-form" onSubmit={submitManualTemplate}>
              <div className="field"><label className="field-label" htmlFor="manual-template-name">Nome do template</label><input id="manual-template-name" className="field-input" value={manualDraft.name} onChange={(event) => setManualDraft((current) => ({ ...current, name: event.target.value }))} placeholder="ex.: confirmacao_pedido" data-testid="input-manual-template-name" /></div>
              <div className="manual-template-grid">
                <div className="field"><label className="field-label" htmlFor="manual-template-language">Idioma</label><input id="manual-template-language" className="field-input" value={manualDraft.languageCode} onChange={(event) => setManualDraft((current) => ({ ...current, languageCode: event.target.value }))} placeholder="pt_BR" data-testid="input-manual-template-language" /></div>
                <div className="field"><label className="field-label" htmlFor="manual-template-category">Categoria</label><select id="manual-template-category" className="field-input" value={manualDraft.category} onChange={(event) => setManualDraft((current) => ({ ...current, category: event.target.value }))} data-testid="select-manual-template-category"><option value="UTILITY">Utilidade</option><option value="MARKETING">Marketing</option><option value="AUTHENTICATION">Autenticação</option></select></div>
              </div>
              <div className="field"><label className="field-label" htmlFor="manual-template-header-format">Header</label><select id="manual-template-header-format" className="field-input" value={manualDraft.headerFormat} onChange={(event) => setManualDraft((current) => ({ ...current, headerFormat: event.target.value as ManualTemplateDraft['headerFormat'] }))} data-testid="select-manual-template-header"><option value="NONE">Sem header</option><option value="TEXT">Texto</option><option value="IMAGE">Imagem</option><option value="VIDEO">Vídeo</option><option value="DOCUMENT">Documento</option></select></div>
              {manualDraft.headerFormat === 'TEXT' && <div className="field"><label className="field-label" htmlFor="manual-template-header-text">Texto do header</label><input id="manual-template-header-text" className="field-input" value={manualDraft.headerText} onChange={(event) => setManualDraft((current) => ({ ...current, headerText: event.target.value }))} placeholder="Olá, {{1}}" data-testid="input-manual-template-header-text" /></div>}
              {manualDraft.headerFormat !== 'NONE' && manualDraft.headerFormat !== 'TEXT' && <p className="field-help">O arquivo de {manualDraft.headerFormat.toLowerCase()} será informado no momento do envio.</p>}
              <div className="field"><label className="field-label" htmlFor="manual-template-body">Body</label><textarea id="manual-template-body" className="field-input min-h-28 resize-y" value={manualDraft.body} onChange={(event) => setManualDraft((current) => ({ ...current, body: event.target.value }))} placeholder="Olá, {{1}}! Seu pedido {{2}} foi confirmado." data-testid="input-manual-template-body" /><p className="field-help">Use variáveis numeradas no formato {'{{1}}'}, {'{{2}}'}.</p></div>
              <div className="field"><label className="field-label" htmlFor="manual-template-footer">Footer <span className="field-optional">opcional</span></label><input id="manual-template-footer" className="field-input" value={manualDraft.footer} onChange={(event) => setManualDraft((current) => ({ ...current, footer: event.target.value }))} placeholder="Equipe Antiban" data-testid="input-manual-template-footer" /></div>
              <div className="manual-buttons-block">
                <div className="manual-buttons-heading"><span>Botões <small>opcional</small></span><button type="button" className="btn-ghost" onClick={() => manualDraft.buttons.length < 3 && setManualDraft((current) => ({ ...current, buttons: [...current.buttons, { type: 'QUICK_REPLY', text: '', url: '', phoneNumber: '' }] }))} disabled={manualDraft.buttons.length >= 3} data-testid="button-add-manual-template-button"><Plus size={14} /> Adicionar</button></div>
                {manualDraft.buttons.map((button, index) => <div className="manual-button-row" key={`manual-button-${index}`}><select className="field-input" value={button.type} onChange={(event) => setManualDraft((current) => ({ ...current, buttons: current.buttons.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as ManualButtonDraft['type'] } : item) }))} aria-label={`Tipo do botão ${index + 1}`}><option value="QUICK_REPLY">Resposta rápida</option><option value="URL">URL</option><option value="PHONE_NUMBER">Telefone</option></select><input className="field-input" value={button.text} onChange={(event) => setManualDraft((current) => ({ ...current, buttons: current.buttons.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) }))} placeholder="Texto do botão" aria-label={`Texto do botão ${index + 1}`} />{button.type === 'URL' && <input className="field-input" value={button.url} onChange={(event) => setManualDraft((current) => ({ ...current, buttons: current.buttons.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item) }))} placeholder="https://..." aria-label={`URL do botão ${index + 1}`} />}{button.type === 'PHONE_NUMBER' && <input className="field-input" value={button.phoneNumber} onChange={(event) => setManualDraft((current) => ({ ...current, buttons: current.buttons.map((item, itemIndex) => itemIndex === index ? { ...item, phoneNumber: event.target.value } : item) }))} placeholder="+55..." aria-label={`Telefone do botão ${index + 1}`} />}<button type="button" className="action-btn" onClick={() => setManualDraft((current) => ({ ...current, buttons: current.buttons.filter((_item, itemIndex) => itemIndex !== index) }))} aria-label={`Remover botão ${index + 1}`}><X size={15} /></button></div>)}
              </div>
              {manualError && <p className="template-inline-error" data-testid="status-manual-template-error"><AlertCircle size={15} />{manualError}</p>}
              <button type="submit" className="btn-primary w-full" disabled={createTemplate.isPending} data-testid="button-create-template">{createTemplate.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}{createTemplate.isPending ? 'Salvando...' : 'Cadastrar template'}</button>
            </form>
          </div>
          <div className="flow-step-actions">
            <p className="field-help">Depois que o template for aprovado pela Meta, avance para selecionar os leads.</p>
            <button type="button" className="btn-primary" disabled={templates.length === 0} onClick={() => setFlowStep(2)} data-testid="button-next-leads">Continuar para leads <ArrowLeft size={15} className="rotate-180" /></button>
          </div>
        </section>
        <section className="leads-panel flow-panel" data-active={flowStep === 2} aria-label="Seleção de leads" data-testid="leads-panel">
          <div className="templates-section-label"><span>Leads</span><span className="templates-count">{contacts.length} cadastrados</span></div>
          <p className="flow-panel-copy">Cadastre os contatos e selecione quem receberá o template na próxima etapa.</p>
          <form className="lead-form" onSubmit={submitLead}>
            <div className="manual-template-grid">
              <div className="field"><label className="field-label" htmlFor="lead-name">Nome do lead</label><input id="lead-name" className="field-input" value={leadName} onChange={(event) => setLeadName(event.target.value)} placeholder="ex.: Maria Silva" data-testid="input-lead-name" /></div>
              <div className="field"><label className="field-label" htmlFor="lead-phone">Telefone com DDI</label><input id="lead-phone" className="field-input" value={leadPhone} onChange={(event) => setLeadPhone(event.target.value)} placeholder="+55 11 99999-0000" data-testid="input-lead-phone" /></div>
            </div>
            {leadError && <p className="template-inline-error"><AlertCircle size={15} />{leadError}</p>}
            <button type="submit" className="btn-primary" disabled={createContact.isPending} data-testid="button-add-lead">{createContact.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}{createContact.isPending ? 'Salvando...' : 'Adicionar lead'}</button>
          </form>
          <div className="leads-list-card">
            <div className="leads-list-heading"><span>Leads disponíveis</span><span>{selectedLeadPhones.length} selecionado(s)</span></div>
            {contactsQuery.isLoading && <div className="templates-loading"><div className="skeleton" /><div className="skeleton" /></div>}
            {!contactsQuery.isLoading && contacts.length === 0 && <div className="dispatch-empty">Nenhum lead cadastrado ainda.</div>}
            {contacts.map((contact) => <label className="lead-row" key={contact.phoneNumber}><input type="checkbox" checked={selectedLeadPhones.includes(contact.phoneNumber)} onChange={(event) => setSelectedLeadPhones((current) => event.target.checked ? [...current, contact.phoneNumber] : current.filter((phone) => phone !== contact.phoneNumber))} data-testid={`checkbox-lead-${contact.phoneNumber}`} /><span><strong>{contact.name}</strong><small>{contact.phoneNumber}</small></span></label>)}
          </div>
          <div className="flow-step-actions">
            <button type="button" className="btn-ghost" onClick={() => setFlowStep(1)}><ArrowLeft size={15} /> Voltar para templates</button>
            <button type="button" className="btn-primary" disabled={selectedLeadPhones.length === 0 || !templates.some((template) => template.status.toLowerCase() === 'approved')} onClick={() => setFlowStep(3)} data-testid="button-next-dispatch">Continuar para envios <ArrowLeft size={15} className="rotate-180" /></button>
          </div>
        </section>
        <section className="templates-dispatch flow-panel" data-active={flowStep === 3} aria-label="Envio de template">
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
                 <div className="field"><div className="field-label-row"><label className="field-label" htmlFor="template-recipients">Destinatários</label><button type="button" className="btn-ghost compact" onClick={() => setRecipientsText(selectedLeadRecipients.join('\n'))} disabled={selectedLeadRecipients.length === 0}>Usar leads selecionados</button></div><textarea id="template-recipients" className="field-input min-h-24 resize-y" value={recipientsText} onChange={(event) => setRecipientsText(event.target.value)} placeholder="+55 11 99999-0000&#10;+55 21 98888-0000" data-testid="input-template-recipients" /><p className="field-help">Separe números por linha, vírgula ou ponto e vírgula. {recipients.length > 0 ? `${recipients.length} destinatário(s) detectado(s).` : ''}</p></div>
                 <div className="field"><label className="field-label" htmlFor="template-tps">Velocidade de envio (TPS)</label><select id="template-tps" className="field-input" value={tps} onChange={(event) => setTps(Number(event.target.value))} data-testid="select-template-tps"><option value={1}>1 TPS · mais conservador</option><option value={5}>5 TPS · equilibrado</option><option value={10}>10 TPS · recomendado</option><option value={20}>20 TPS · mais rápido</option><option value={50}>50 TPS · alto volume</option></select><p className="field-help">TPS define quantas mensagens por segundo o painel solicita ao servidor.</p></div>
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
                 <button type="button" className="btn-ghost" onClick={() => setFlowStep(2)}><ArrowLeft size={15} /> Voltar para leads</button>
              </form>
              {dispatchResult && <div className="template-results-card rise-in" data-testid="template-dispatch-results"><div className="template-results-summary"><div className="template-result-stat"><span>Lote</span><strong>#{dispatchResult.dispatchId}</strong></div><div className="template-result-stat" data-tone="success"><span>Aceitos</span><strong>{dispatchResult.sentCount}</strong></div><div className="template-result-stat"><span>Pendentes</span><strong>{dispatchResult.pendingCount}</strong></div><div className="template-result-stat" data-tone="error"><span>Falhas</span><strong>{dispatchResult.failedCount}</strong></div></div></div>}
            </>
          ) : (
            <div className="template-empty" data-testid="state-template-selection-empty"><FileText size={28} strokeWidth={1.5} /><div><strong>Selecione um template</strong><p>Depois de importar ou escolher um item, os componentes e parâmetros aparecem aqui.</p></div></div>
          )}
        </section>
        <section className="dispatch-monitor flow-panel" data-active={flowStep === 3} aria-label="Painel de acompanhamento de envios" data-testid="dispatch-monitor">
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
  const evolutionConnectionQuery = useGetEvolutionConnection({ query: { refetchInterval: 10000, queryKey: getGetEvolutionConnectionQueryKey() } });
  const conversations = conversationsQuery.data ?? [];
  const connection = connectionQuery.data;
  const evolutionConnection = evolutionConnectionQuery.data;
  const evolutionMode = Boolean(evolutionConnection?.active);
  const chatConnected = evolutionMode
    ? Boolean(evolutionConnection?.connected)
    : Boolean(connection?.connected);
  const displayConnection: ConnectionStatus | undefined = evolutionMode
    ? {
        connected: Boolean(evolutionConnection?.connected),
        businessAccountId: null,
        phoneNumbers: evolutionConnection?.connected ? [{
          id: 'evolution-active',
          displayPhoneNumber: evolutionConnection.phoneNumber ?? '',
          verifiedName: evolutionConnection.profileName || evolutionConnection.instanceName || 'WhatsApp conectado',
          qualityRating: 'N/A',
          profilePictureUrl: null,
        }] : [],
        selectedPhoneNumberId: evolutionConnection?.connected ? 'evolution-active' : null,
        webhookUrl: connection?.webhookUrl ?? '',
        webhookVerifyTokenConfigured: false,
        webhookVerifyToken: null,
      }
    : connection;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<'inbox' | 'templates' | 'dashboard'>('inbox');
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
      <div className={`inbox-shell ${activeSection === 'dashboard' ? 'dashboard-shell' : ''}`} data-mobile-list-open={activeSection === 'inbox' ? mobileListOpen : undefined}>
        <NavigationRail
          onSettings={() => setSettingsOpen(true)}
          connected={chatConnected}
          profilePictureUrl={displayConnection?.phoneNumbers.find((phone) => phone.id === displayConnection.selectedPhoneNumberId)?.profilePictureUrl}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        {activeSection === 'dashboard' ? <DashboardWorkspace onBackToInbox={() => setActiveSection('inbox')} /> : activeSection === 'templates' ? <TemplateWorkspace onBackToInbox={() => { setActiveSection('inbox'); setMobileListOpen(true); }} /> : (
          <>
            <Sidebar conversations={conversations} selectedId={selectedId} setSelectedId={(id) => { setSelectedId(id); setMobileListOpen(false); }} connected={chatConnected} connection={displayConnection} connectionLabel={evolutionMode ? 'Conectado via QR Code' : 'WhatsApp Cloud API ativo'} loading={conversationsQuery.isLoading} error={conversationsQuery.error} onSettings={() => setSettingsOpen(true)} onNewConversation={() => setNewConversationOpen(true)} onTemplates={() => setActiveSection('templates')} onDashboard={() => setActiveSection('dashboard')} mobileOpen={mobileListOpen} onCloseMobile={() => setMobileListOpen(false)} />
            <button type="button" className="mobile-scrim" aria-label="Fechar lista de conversas" onClick={() => setMobileListOpen(false)} data-testid="button-mobile-scrim" />
            <ChatPanel conversation={selectedConversation} connected={chatConnected} evolutionMode={evolutionMode} onBack={() => setMobileListOpen(true)} onSettings={() => setSettingsOpen(true)} onDeleteConversation={() => { if (selectedConversation) { setDeleteError(''); setConversationToDelete(selectedConversation); } }} />
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