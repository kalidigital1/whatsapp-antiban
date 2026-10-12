import { useState, type FormEvent } from "react";
import {
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquareText,
  Mic,
  Pencil,
  Plus,
  Send,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListConversationMessagesQueryKey,
  getListConversationsQueryKey,
  getListSavedRepliesQueryKey,
  useCreateSavedReply,
  useDeleteSavedReply,
  useListSavedReplies,
  useRequestUploadUrl,
  useSendSavedReply,
  useUpdateSavedReply,
} from "@workspace/api-client-react";

type SavedKind = "text" | "audio" | "image" | "video" | "document";
type FormKind = "text" | "audio" | "media";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

function displayError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Não foi possível concluir a ação.";
}

async function uploadResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object" && "error" in payload) {
      const message = (payload as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    // Use the status-based message below when the response is not JSON.
  }
  return `${fallback} (HTTP ${response.status}).`;
}

function kindFromFile(file: File): SavedKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "document";
}

function KindIcon({ kind, size = 15 }: { kind: SavedKind; size?: number }) {
  if (kind === "audio") return <Mic size={size} />;
  if (kind === "image") return <ImageIcon size={size} />;
  if (kind === "video") return <Video size={size} />;
  if (kind === "document") return <FileText size={size} />;
  return <MessageSquareText size={size} />;
}

function kindLabel(kind: SavedKind): string {
  if (kind === "audio") return "Nota de voz";
  if (kind === "image") return "Imagem";
  if (kind === "video") return "Vídeo";
  if (kind === "document") return "Arquivo";
  return "Mensagem";
}

export function SavedReplyHighlights({
  conversationId,
  disabled,
  manageOnly = false,
  onClose,
}: {
  conversationId: number | null;
  disabled: boolean;
  manageOnly?: boolean;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const savedQuery = useListSavedReplies();
  const sendSavedReply = useSendSavedReply();
  const createSavedReply = useCreateSavedReply();
  const updateSavedReply = useUpdateSavedReply();
  const deleteSavedReply = useDeleteSavedReply();
  const requestUploadUrl = useRequestUploadUrl();
  const [dialogOpen, setDialogOpen] = useState(manageOnly);
  const [formKind, setFormKind] = useState<FormKind>("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sendingId, setSendingId] = useState<number | null>(null);

  const replies = savedQuery.data ?? [];
  const sending = sendSavedReply.isPending || sendingId !== null;
  const closeDialog = () => {
    setDialogOpen(false);
    onClose?.();
  };

  const refreshSavedReplies = () => {
    void queryClient.invalidateQueries({ queryKey: getListSavedRepliesQueryKey() });
  };

  const send = (savedReplyId: number) => {
    if (disabled || sending || manageOnly || conversationId === null) return;
    setError("");
    setSendingId(savedReplyId);
    sendSavedReply.mutate(
      { conversationId, savedReplyId },
      {
        onSuccess: () => {
          setSendingId(null);
          void queryClient.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversationId) });
          void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        },
        onError: (sendError) => {
          setSendingId(null);
          setError(displayError(sendError));
        },
      },
    );
  };

  const resetForm = () => {
    setTitle("");
    setContent("");
    setFile(null);
    setEditingId(null);
    setFormKind("text");
    setError("");
  };

  const startEdit = (reply: (typeof replies)[number]) => {
    setEditingId(reply.id);
    setTitle(reply.title);
    setContent(reply.content ?? "");
    setFile(null);
    setFormKind(reply.kind === "text" ? "text" : reply.kind === "audio" ? "audio" : "media");
    setError("");
  };

  const handleFileChange = (selected: File | null) => {
    setError("");
    if (!selected) {
      setFile(null);
      return;
    }
    const isAudio = formKind === "audio";
    if (isAudio && (!selected.type.startsWith("audio/") || !selected.name.toLowerCase().endsWith(".ogg"))) {
      setError("Escolha um arquivo OGG/Opus para enviar como nota de voz.");
      setFile(null);
      return;
    }
    if (!isAudio && selected.type.startsWith("audio/")) {
      setError("Use a opção Nota de voz para salvar um áudio.");
      setFile(null);
      return;
    }
    const limit = isAudio ? MAX_AUDIO_BYTES : MAX_MEDIA_BYTES;
    if (selected.size > limit) {
      setError(`O arquivo deve ter até ${isAudio ? "16" : "25"} MB.`);
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Informe um nome para o destaque.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (editingId !== null) {
        await updateSavedReply.mutateAsync({
          savedReplyId: editingId,
          data: { title: cleanTitle, ...(formKind === "text" ? { content: content.trim() } : {}) },
        });
      } else if (formKind === "text") {
        if (!content.trim()) {
          setError("Escreva a mensagem que será salva.");
          setBusy(false);
          return;
        }
        await createSavedReply.mutateAsync({
          data: { title: cleanTitle, kind: "text", content: content.trim() },
        });
      } else {
        if (!file) {
          setError("Selecione um arquivo.");
          setBusy(false);
          return;
        }
        const contentType = file.type || "application/octet-stream";
        const modeResponse = await fetch("/api/storage/upload-mode");
        if (!modeResponse.ok) {
          throw new Error(await uploadResponseError(modeResponse, "Não foi possível preparar o envio do arquivo"));
        }
        const modePayload: unknown = await modeResponse.json();
        if (!modePayload || typeof modePayload !== "object" || !("mode" in modePayload)) {
          throw new Error("O servidor retornou um modo de envio inválido.");
        }

        let objectPath: string;
        if ((modePayload as { mode?: unknown }).mode === "server") {
          const formData = new FormData();
          formData.append("file", file, file.name);
          const uploadResponse = await fetch("/api/storage/uploads", {
            method: "POST",
            body: formData,
          });
          if (!uploadResponse.ok) {
            throw new Error(await uploadResponseError(uploadResponse, "Não foi possível salvar o arquivo"));
          }
          const uploadPayload: unknown = await uploadResponse.json();
          const uploadedPath = uploadPayload && typeof uploadPayload === "object" && "objectPath" in uploadPayload
            ? (uploadPayload as { objectPath?: unknown }).objectPath
            : null;
          if (typeof uploadedPath !== "string" || !uploadedPath.startsWith("/objects/uploads/")) {
            throw new Error("O servidor não confirmou o armazenamento do arquivo.");
          }
          objectPath = uploadedPath;
        } else if ((modePayload as { mode?: unknown }).mode === "direct") {
          const upload = await requestUploadUrl.mutateAsync({
            data: { name: file.name, size: file.size, contentType },
          });
          const uploadResponse = await fetch(upload.uploadURL, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: file,
          });
          if (!uploadResponse.ok) throw new Error("Não foi possível carregar o arquivo.");
          objectPath = upload.objectPath;
        } else {
          throw new Error("O servidor retornou um modo de envio não suportado.");
        }

        const kind: SavedKind = formKind === "audio" ? "audio" : kindFromFile(file);
        await createSavedReply.mutateAsync({
          data: {
            title: cleanTitle,
            kind,
            objectPath,
            mediaMimeType: contentType,
            mediaFileName: file.name,
            sizeBytes: file.size,
          },
        });
      }
      await queryClient.invalidateQueries({ queryKey: getListSavedRepliesQueryKey() });
      resetForm();
      closeDialog();
    } catch (saveError) {
      setError(displayError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (savedReplyId: number, savedReplyTitle: string) => {
    if (!window.confirm(`Remover o destaque “${savedReplyTitle}”?`)) return;
    setError("");
    try {
      await deleteSavedReply.mutateAsync({ savedReplyId });
      refreshSavedReplies();
      if (editingId === savedReplyId) resetForm();
    } catch (deleteError) {
      setError(displayError(deleteError));
    }
  };

  return (
    <>
      {!manageOnly && <div className="saved-highlights" aria-label="Destaques para envio rápido">
        {replies.map((reply) => (
          <button
            type="button"
            className="saved-highlight-chip"
            key={reply.id}
            onClick={() => send(reply.id)}
            disabled={disabled || sending}
            title={`Enviar agora: ${reply.title}`}
            data-testid={`button-send-saved-reply-${reply.id}`}
          >
            {sendingId === reply.id
              ? <LoaderCircle className="animate-spin" size={14} />
              : <KindIcon kind={reply.kind} />}
            <span>{reply.title}</span>
          </button>
        ))}
        <button
          type="button"
          className="saved-highlight-manage"
          onClick={() => { resetForm(); setDialogOpen(true); }}
          aria-label="Gerenciar destaques"
          title="Gerenciar destaques"
          data-testid="button-manage-saved-replies"
        >
          <Plus size={16} />
        </button>
        {savedQuery.isLoading && <span className="saved-highlight-loading"><LoaderCircle size={14} className="animate-spin" /></span>}
      </div>}
      {error && <p className="saved-highlight-error" role="alert">{error}</p>}

      {dialogOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) closeDialog();
          }}
        >
          <section
            className="saved-replies-dialog rise-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-replies-title"
            data-testid="dialog-saved-replies"
          >
            <header className="saved-replies-header">
              <div>
                <h2 id="saved-replies-title">{manageOnly ? 'ZapBan' : 'Destaques'}</h2>
                <p>{manageOnly ? 'Gerencie suas mensagens em destaque.' : 'Toque em um destaque no chat para enviar imediatamente.'}</p>
              </div>
              <button type="button" className="action-btn" onClick={closeDialog} disabled={busy} aria-label="Fechar destaques">
                <X size={19} />
              </button>
            </header>

            <div className="saved-replies-content">
              <div className="saved-replies-list">
                {savedQuery.isLoading && <p className="saved-replies-empty">Carregando destaques…</p>}
                {!savedQuery.isLoading && replies.length === 0 && <p className="saved-replies-empty">Nenhum destaque salvo.</p>}
                {replies.map((reply) => (
                  <div className="saved-reply-row" key={reply.id}>
                    <span className="saved-reply-kind"><KindIcon kind={reply.kind} /></span>
                    <div className="saved-reply-row-copy">
                      <strong>{reply.title}</strong>
                      <span>{reply.kind === "text" ? reply.content : kindLabel(reply.kind)}</span>
                    </div>
                    <button type="button" className="saved-reply-icon-btn" onClick={() => startEdit(reply)} aria-label={`Editar ${reply.title}`} title="Editar">
                      <Pencil size={15} />
                    </button>
                    <button type="button" className="saved-reply-icon-btn danger" onClick={() => void remove(reply.id, reply.title)} aria-label={`Remover ${reply.title}`} title="Remover">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>

              <form className="saved-reply-form" onSubmit={save}>
                <div className="saved-reply-form-heading">
                  <h3>{editingId === null ? "Novo destaque" : "Editar destaque"}</h3>
                  {editingId !== null && (
                    <button type="button" className="saved-reply-cancel-edit" onClick={resetForm}>Novo</button>
                  )}
                </div>
                <div className="saved-reply-kind-tabs" role="group" aria-label="Tipo de destaque">
                  <button type="button" className={formKind === "text" ? "active" : ""} onClick={() => { setFormKind("text"); setFile(null); }} disabled={editingId !== null && formKind !== "text"}>
                    <MessageSquareText size={14} /> Mensagem
                  </button>
                  <button type="button" className={formKind === "audio" ? "active" : ""} onClick={() => { setFormKind("audio"); setFile(null); }} disabled={editingId !== null && formKind !== "audio"}>
                    <Mic size={14} /> Nota de voz
                  </button>
                  <button type="button" className={formKind === "media" ? "active" : ""} onClick={() => { setFormKind("media"); setFile(null); }} disabled={editingId !== null && formKind !== "media"}>
                    <ImageIcon size={14} /> Mídia
                  </button>
                </div>
                <label className="saved-reply-field">
                  <span>Nome</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={64}
                    placeholder="Ex.: Boas-vindas"
                    required
                  />
                </label>
                {formKind === "text" ? (
                  <label className="saved-reply-field">
                    <span>Mensagem</span>
                    <textarea
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                      maxLength={10000}
                      rows={3}
                      placeholder="Escreva a mensagem"
                      required
                    />
                  </label>
                ) : editingId !== null ? (
                  <p className="saved-reply-file-note">Para trocar o arquivo, remova este destaque e crie outro.</p>
                ) : (
                  <label className="saved-reply-file-input">
                    <span>{formKind === "audio" ? "Arquivo OGG/Opus · até 16 MB" : "Imagem, vídeo ou documento · até 25 MB"}</span>
                    <input
                      type="file"
                      accept={formKind === "audio" ? ".ogg,audio/ogg" : "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"}
                      onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
                    />
                    {file && <small>{file.name}</small>}
                  </label>
                )}
                {error && <p className="saved-reply-form-error" role="alert">{error}</p>}
                <div className="saved-reply-form-actions">
                  <button type="button" className="saved-reply-cancel" onClick={() => { resetForm(); closeDialog(); }} disabled={busy}>Fechar</button>
                  <button type="submit" className="saved-reply-save" disabled={busy || createSavedReply.isPending || updateSavedReply.isPending}>
                    {busy ? <LoaderCircle size={15} className="animate-spin" /> : editingId === null ? <Plus size={15} /> : <Send size={15} />}
                    {busy ? "Salvando" : "Salvar"}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
