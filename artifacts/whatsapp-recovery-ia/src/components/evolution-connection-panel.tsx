import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  Loader2,
  LockKeyhole,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Wifi,
  X,
} from "lucide-react";
import {
  getGetConnectionQueryKey,
  getGetEvolutionConnectionQueryKey,
  useConnectEvolutionWhatsApp,
  useDisconnectEvolutionWhatsApp,
  useGetEvolutionConnection,
  useRefreshEvolutionQr,
} from "@workspace/api-client-react";
import type { EvolutionConnectionStatus } from "@workspace/api-client-react";

type EvolutionConnectionPanelProps = {
  onClose?: () => void;
};

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Não foi possível concluir esta ação. Tente novamente.";
}

function qrImageSource(qrCode: string) {
  if (qrCode.startsWith("data:")) return qrCode;
  return `data:image/png;base64,${qrCode}`;
}

function connectionLabel(connection?: EvolutionConnectionStatus) {
  if (!connection?.configured) return "Não configurada";
  if (connection.connected) return connection.active ? "Conectado e ativo" : "Conectado";
  if (connection.qrCode) return "Aguardando leitura";
  if (connection.state) return connection.state.replace(/[_-]/g, " ");
  return "Desconectado";
}

export function EvolutionConnectionPanel({ onClose }: EvolutionConnectionPanelProps) {
  const queryClient = useQueryClient();
  const connectionQuery = useGetEvolutionConnection({
    query: {
      refetchInterval: 4000,
      queryKey: getGetEvolutionConnectionQueryKey(),
    },
  });
  const connect = useConnectEvolutionWhatsApp();
  const refreshQr = useRefreshEvolutionQr();
  const disconnect = useDisconnectEvolutionWhatsApp();
  const connection = connectionQuery.data;

  const [serverUrl, setServerUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");

  const isConnected = Boolean(connection?.connected);
  const isConfigured = Boolean(connection?.configured);

  const invalidateEvolution = () => {
    void queryClient.invalidateQueries({ queryKey: getGetEvolutionConnectionQueryKey() });
  };
  const invalidateConnections = () => {
    invalidateEvolution();
    void queryClient.invalidateQueries({ queryKey: getGetConnectionQueryKey() });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setActionError("");
    const cleanServerUrl = serverUrl.trim();
    const cleanApiKey = apiKey.trim();
    const cleanInstanceName = instanceName.trim();
    if (
      (!cleanServerUrl && !connection?.defaultServerUrlConfigured)
      || (!cleanApiKey && !connection?.defaultApiKeyConfigured)
      || cleanInstanceName.length < 2
    ) {
      setFormError("Informe a URL e a chave ou configure os valores padrão nos Secrets do Replit. O nome da instância deve ter pelo menos 2 caracteres.");
      return;
    }

    const data: { serverUrl?: string; apiKey?: string; instanceName: string } = {
      instanceName: cleanInstanceName,
    };
    if (cleanServerUrl) data.serverUrl = cleanServerUrl;
    if (cleanApiKey) data.apiKey = cleanApiKey;

    connect.mutate(
      { data },
      {
        onSuccess: () => {
          setApiKey("");
          setFormError("");
          invalidateConnections();
        },
        onError: (error) => setFormError(errorMessage(error)),
      },
    );
  };

  const refreshCode = () => {
    setActionError("");
    refreshQr.mutate(undefined, {
      onSuccess: () => invalidateEvolution(),
      onError: (error) => setActionError(errorMessage(error)),
    });
  };

  const disconnectNow = () => {
    setActionError("");
    disconnect.mutate(undefined, {
      onSuccess: () => {
        setApiKey("");
        invalidateConnections();
      },
      onError: (error) => setActionError(errorMessage(error)),
    });
  };

  return (
    <section className="evolution-panel rise-in" aria-labelledby="evolution-panel-title" data-testid="panel-evolution-connection">
      <header className="evolution-panel-header">
        <div className="evolution-heading-mark" aria-hidden="true"><QrCode size={18} /></div>
        <div className="evolution-heading-copy">
          <p className="evolution-kicker">Método alternativo</p>
          <h2 id="evolution-panel-title">Conectar via Evolution API</h2>
          <p>Vincule uma instância ao inbox e acompanhe a sessão por aqui.</p>
        </div>
        {onClose && (
          <button type="button" className="action-btn evolution-close" onClick={onClose} aria-label="Fechar conexão Evolution" data-testid="button-close-evolution">
            <X size={18} />
          </button>
        )}
      </header>

      <div className="evolution-panel-content quiet-scroll">
        <div className={`evolution-live-status ${isConnected ? "is-online" : "is-waiting"}`} data-testid="status-evolution-connection">
          <span className="evolution-status-indicator"><span /></span>
          <div className="evolution-live-copy">
            <strong>{connectionLabel(connection)}</strong>
             <span>{connection?.active && connection.connected ? "Mensagens do inbox usam esta sessão" : connection?.state ? `Sessão: ${connection.state}` : "Estado atualizado automaticamente"}</span>
          </div>
          <span className="evolution-live-pulse" aria-label="Atualização a cada 4 segundos" />
        </div>

        {connectionQuery.isLoading && (
          <div className="evolution-loading" aria-label="Carregando status da conexão" data-testid="state-evolution-loading">
            <div className="evolution-skeleton evolution-skeleton-status" />
            <div className="evolution-skeleton evolution-skeleton-line" />
            <div className="evolution-skeleton evolution-skeleton-block" />
          </div>
        )}

        {connectionQuery.isError && (
          <div className="evolution-error-card" data-testid="state-evolution-query-error">
            <AlertCircle size={17} />
            <div>
              <strong>Status indisponível</strong>
              <p>Não foi possível consultar a sessão agora.</p>
            </div>
            <button type="button" className="evolution-text-button" onClick={() => void connectionQuery.refetch()} data-testid="button-retry-evolution-status">Tentar novamente</button>
          </div>
        )}

        {!connectionQuery.isLoading && !isConnected && !isConfigured && (
          <form className="evolution-setup-form" onSubmit={submit}>
            <div className="evolution-section-intro">
              <span className="evolution-step">01</span>
              <div>
                <h3>Dados do servidor</h3>
                <p>Use os dados da sua instalação Evolution API.</p>
              </div>
            </div>

            {(connection?.defaultServerUrlConfigured || connection?.defaultApiKeyConfigured) && (
              <div className="evolution-defaults-note" role="note">
                <LockKeyhole size={15} aria-hidden="true" />
                <span>
                  {connection.defaultServerUrlConfigured && connection.defaultApiKeyConfigured
                    ? "URL e chave padrão guardadas nos Secrets do Replit. Os campos abaixo são opcionais."
                    : connection.defaultServerUrlConfigured
                      ? "A URL padrão está guardada nos Secrets do Replit. Informe a chave abaixo ou configure-a como Secret."
                      : "A chave padrão está guardada nos Secrets do Replit. Informe a URL abaixo."}
                </span>
              </div>
            )}

            {!connection?.defaultServerUrlConfigured && (
            <label className="evolution-field" htmlFor="evolution-server-url">
              <span>URL do servidor</span>
              <input id="evolution-server-url" type="url" inputMode="url" autoComplete="url" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://evolution.suaempresa.com" required data-testid="input-evolution-server-url" />
            </label>
            )}
            {!connection?.defaultApiKeyConfigured && (
              <label className="evolution-field" htmlFor="evolution-api-key">
              <span>Chave de API</span>
              <div className="evolution-secret-input">
                <LockKeyhole size={15} aria-hidden="true" />
                <input id="evolution-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Cole sua chave de API" required data-testid="input-evolution-api-key" />
              </div>
              <small>A chave nunca é devolvida ao navegador e o campo é limpo após conectar.</small>
            </label>
            )}
            <label className="evolution-field" htmlFor="evolution-instance-name">
              <span>Nome da instância</span>
              <input id="evolution-instance-name" type="text" autoComplete="off" minLength={2} maxLength={64} value={instanceName} onChange={(event) => setInstanceName(event.target.value)} placeholder="Ex.: atendimento-loja" required data-testid="input-evolution-instance-name" />
            </label>

            {formError && <p className="evolution-form-error" role="alert" data-testid="status-evolution-form-error"><AlertCircle size={15} />{formError}</p>}
            <button type="submit" className="evolution-primary-button" disabled={connect.isPending} data-testid="button-connect-evolution">
              {connect.isPending ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}
              {connect.isPending ? "Iniciando conexão..." : "Iniciar conexão"}
            </button>
          </form>
        )}

        {!connectionQuery.isLoading && !isConnected && isConfigured && (
          <div className="evolution-qr-section">
            {connection?.qrCode ? (
              <>
                <div className="evolution-section-intro">
                  <span className="evolution-step">02</span>
                  <div>
                    <h3>Leia o QR Code</h3>
                    <p>Abra o WhatsApp no celular que deseja conectar.</p>
                  </div>
                </div>
                <div className="evolution-scan-layout">
                  <div className="evolution-qr-frame">
                    <img src={qrImageSource(connection.qrCode)} alt="QR Code para conectar o WhatsApp" data-testid="img-evolution-qr-code" />
                  </div>
                  <ol className="evolution-scan-steps">
                    <li><span>1</span><p>WhatsApp <b>Configurações</b></p></li>
                    <li><span>2</span><p>Toque em <b>Dispositivos conectados</b></p></li>
                    <li><span>3</span><p>Escolha <b>Conectar dispositivo</b> e leia o código</p></li>
                  </ol>
                </div>
                <div className="evolution-qr-actions">
                  <span>O código pode expirar após alguns instantes.</span>
                  <button type="button" className="evolution-secondary-button" onClick={refreshCode} disabled={refreshQr.isPending} data-testid="button-refresh-evolution-qr">
                    {refreshQr.isPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    {refreshQr.isPending ? "Atualizando..." : "Gerar novo QR"}
                  </button>
                </div>
              </>
            ) : (
              <div className="evolution-awaiting-card">
                <div className="evolution-awaiting-icon"><Smartphone size={21} /></div>
                <div>
                  <h3>Aguardando QR Code</h3>
                  <p>A instância foi configurada. Atualize o código para iniciar a leitura no celular.</p>
                </div>
                <button type="button" className="evolution-primary-button" onClick={refreshCode} disabled={refreshQr.isPending} data-testid="button-create-evolution-qr">
                  {refreshQr.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  {refreshQr.isPending ? "Preparando..." : "Gerar QR Code"}
                </button>
              </div>
            )}
          </div>
        )}

        {!connectionQuery.isLoading && isConnected && (
          <div className="evolution-connected-card" data-testid="card-evolution-connected-profile">
            <div className="evolution-connected-symbol"><Check size={19} /></div>
            <div className="evolution-connected-details">
              <span className="evolution-connected-kicker">Sessão ativa</span>
              <h3>{connection?.profileName || connection?.instanceName || "WhatsApp conectado"}</h3>
              {connection?.phoneNumber && <p data-testid="text-evolution-phone">{connection.phoneNumber}</p>}
              {connection?.instanceName && <span className="evolution-instance-chip">{connection.instanceName}</span>}
            </div>
            <span className="evolution-connected-tag">Online</span>
          </div>
        )}

        {actionError && <p className="evolution-form-error" role="alert" data-testid="status-evolution-action-error"><AlertCircle size={15} />{actionError}</p>}

        {isConfigured && (
          <div className="evolution-footer">
            <p><ShieldAlert size={14} /> Evolution API é uma integração não oficial. A disponibilidade depende da sua instância e do WhatsApp.</p>
            {isConnected && (
              <button type="button" className="evolution-disconnect-button" onClick={disconnectNow} disabled={disconnect.isPending} data-testid="button-disconnect-evolution">
                {disconnect.isPending ? <Loader2 size={15} className="animate-spin" /> : <Wifi size={15} />}
                {disconnect.isPending ? "Desconectando..." : "Desconectar"}
              </button>
            )}
          </div>
        )}
        {!isConfigured && !connectionQuery.isLoading && (
          <div className="evolution-notice"><ShieldAlert size={14} /><p>Evolution API é uma integração não oficial; use uma instância confiável.</p></div>
        )}
      </div>
    </section>
  );
}
