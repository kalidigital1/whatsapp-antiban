import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  Loader2,
  MessageCircle,
  QrCode,
  RefreshCw,
  X,
} from "lucide-react";
import {
  getGetConnectionQueryKey,
  getGetEvolutionConnectionQueryKey,
  getListConversationsQueryKey,
  useConnectEvolutionWhatsApp,
  useDisconnectEvolutionWhatsApp,
  useGetEvolutionConnection,
  useRefreshEvolutionQr,
} from "@workspace/api-client-react";
import type { EvolutionConnectionStatus } from "@workspace/api-client-react";

type EvolutionConnectionPanelProps = {
  onClose?: () => void;
  onGoToConversations: () => void;
};

function qrImageSource(qrCode: string) {
  if (qrCode.startsWith("data:")) return qrCode;
  return `data:image/png;base64,${qrCode}`;
}

export function EvolutionConnectionPanel({ onClose, onGoToConversations }: EvolutionConnectionPanelProps) {
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
  const [actionError, setActionError] = useState("");
  const [generatedQrCode, setGeneratedQrCode] = useState<string | null>(null);

  const isConnected = Boolean(connection?.connected);
  const isWorking = connect.isPending || refreshQr.isPending;
  const showGeneratedQrCode = Boolean(generatedQrCode && !isConnected);

  useEffect(() => {
    if (isConnected) setGeneratedQrCode(null);
  }, [isConnected]);

  const invalidateEvolution = () => {
    void queryClient.invalidateQueries({ queryKey: getGetEvolutionConnectionQueryKey() });
  };
  const invalidateConnections = () => {
    invalidateEvolution();
    void queryClient.invalidateQueries({ queryKey: getGetConnectionQueryKey() });
  };
  const clearConversationCache = async () => {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey.some(
        (part) => typeof part === "string" && /message/i.test(part),
      ),
    });
    queryClient.setQueryData(getListConversationsQueryKey(), []);
    await queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  };

  const generateQr = () => {
    setActionError("");
    setGeneratedQrCode(null);
    if (connection?.configured) {
      refreshQr.mutate(undefined, {
        onSuccess: (updatedConnection) => {
          setGeneratedQrCode(updatedConnection.qrCode);
          if (!updatedConnection.qrCode) {
            setActionError("O servidor não retornou um QR Code. Tente novamente.");
          }
          queryClient.setQueryData(getGetEvolutionConnectionQueryKey(), updatedConnection);
          invalidateEvolution();
          void clearConversationCache();
        },
        onError: () => setActionError("Não foi possível gerar o QR Code. Tente novamente."),
      });
      return;
    }

    connect.mutate(
      { data: { instanceName: `antiban-${Date.now().toString(36)}` } },
      {
        onSuccess: async (newConnection) => {
          setGeneratedQrCode(newConnection.qrCode);
          if (!newConnection.qrCode) {
            setActionError("O servidor não retornou um QR Code. Tente novamente.");
          }
          queryClient.setQueryData(getGetEvolutionConnectionQueryKey(), newConnection);
          invalidateConnections();
          await clearConversationCache();
        },
        onError: () => setActionError("Não foi possível gerar o QR Code. Tente novamente."),
      },
    );
  };

  const disconnectNow = () => {
    const confirmed = window.confirm(
      "Desconectar apagará permanentemente as conversas, mensagens e mídias desta conexão via QR Code no Antiban. Os contatos serão mantidos. Deseja continuar?",
    );
    if (!confirmed) return;

    setActionError("");
    disconnect.mutate(undefined, {
      onSuccess: async () => {
        setGeneratedQrCode(null);
        invalidateConnections();
        await clearConversationCache();
      },
      onError: () => setActionError("Não foi possível desconectar. Tente novamente."),
    });
  };

  return (
    <section className="evolution-panel rise-in" aria-label="Conexão do WhatsApp por QR Code" data-testid="panel-evolution-connection">
      <header className="evolution-panel-header">
        <img className="evolution-brand-logo" src="/assets/antiban-logo-white.png" alt="Antiban" />
        {onClose && (
          <button type="button" className="action-btn evolution-close" onClick={onClose} aria-label="Fechar conexão via QR Code" data-testid="button-close-evolution">
            <X size={18} />
          </button>
        )}
      </header>

      <div className="evolution-panel-content quiet-scroll">
        {connectionQuery.isLoading && (
          <div className="evolution-loading" aria-label="Carregando conexão" data-testid="state-evolution-loading">
            <Loader2 size={23} className="animate-spin" />
          </div>
        )}

        {!connectionQuery.isLoading && !isConnected && (
          <div className={`evolution-connect-view ${showGeneratedQrCode ? "has-qr" : ""}`}>
            {showGeneratedQrCode && generatedQrCode && (
              <div className="evolution-qr-frame">
                <img src={qrImageSource(generatedQrCode)} alt="QR Code para conectar o WhatsApp" data-testid="img-evolution-qr-code" />
              </div>
            )}
            {connectionQuery.isError && (
              <p className="evolution-form-error" role="alert" data-testid="state-evolution-query-error">
                <AlertCircle size={15} />Não foi possível consultar a conexão. Tente novamente.
              </p>
            )}
            {actionError && (
              <p className="evolution-form-error" role="alert" data-testid="status-evolution-action-error">
                <AlertCircle size={15} />{actionError}
              </p>
            )}
            <button
              type="button"
              className="evolution-primary-button"
              onClick={generateQr}
              disabled={isWorking}
              data-testid={showGeneratedQrCode ? "button-refresh-evolution-qr" : connection?.configured ? "button-create-evolution-qr" : "button-connect-evolution"}
            >
              {isWorking ? <Loader2 size={18} className="animate-spin" /> : showGeneratedQrCode ? <RefreshCw size={17} /> : <QrCode size={18} />}
              {isWorking ? "Gerando QR Code..." : showGeneratedQrCode ? "Gerar novo QR Code" : "Gerar acesso via QR Code"}
            </button>
          </div>
        )}

        {!connectionQuery.isLoading && isConnected && (
          <div className="evolution-connected-view" data-testid="card-evolution-connected-profile">
            <div className="evolution-connected-symbol" aria-hidden="true"><Check size={24} strokeWidth={2.5} /></div>
            <div className="evolution-connected-copy">
              <p>Conectado via QR Code</p>
              <strong data-testid="text-evolution-phone">{connection?.phoneNumber || "Número não identificado"}</strong>
            </div>
            {actionError && <p className="evolution-form-error" role="alert" data-testid="status-evolution-action-error"><AlertCircle size={15} />{actionError}</p>}
            <button type="button" className="evolution-disconnect-button" onClick={disconnectNow} disabled={disconnect.isPending} data-testid="button-disconnect-evolution">
              {disconnect.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
              {disconnect.isPending ? "Desconectando..." : "Desconectar"}
            </button>
            <button type="button" className="btn-ghost w-full" onClick={onGoToConversations} data-testid="button-go-conversations">
              <MessageCircle size={16} /> Ir para conversas
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
