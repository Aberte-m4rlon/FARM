import { useState, useRef, useEffect, type ReactNode } from 'react';
import {
  Send, Square, X, RefreshCw, AlertCircle,
  Copy, Check, Plus, Trash2, Bot, Sparkles, MessageSquare,
  Image as ImageIcon, Eye,
} from 'lucide-react';
import { Button } from '../ui/Button';
import {
  type MyAIConversation, type MyAIMessage, type AIStatus,
  MYAI_MODEL, AI_MODE, compressImageFile,
} from '../../lib/myai';
import { loadCorner } from './AIFloatingButton';

const PANEL_W = 420;
const PANEL_H = 600;
const BTN_SIZE = 48;
const MARGIN = 16;

export interface AIChatProps {
  open: boolean;
  onClose: () => void;
  aiStatus: AIStatus;
  conversations: MyAIConversation[];
  activeId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onSendMessage: (text: string, image?: string) => void;
  onStopStreaming: () => void;
  onRetryStatus: () => void;
  streaming: boolean;
  streamingText: string;
  quickPrompts?: string[];
}

// ── Markdown Formatter ─────────────────────────────────────────────────────────
function fmt(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i} style={{ color: 'var(--color-text-primary, #0F172A)' }}>
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function renderMessageContent(text: string): ReactNode[] {
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const t = line.trim();
    if (!t) return <div key={idx} style={{ height: 6 }} />;
    if (t.startsWith('## ') || t.startsWith('# ')) {
      return (
        <div
          key={idx}
          style={{
            fontWeight: 800,
            fontSize: '13.5px',
            marginTop: 8,
            marginBottom: 4,
            color: 'var(--color-text-primary, #1F2933)',
          }}
        >
          {t.replace(/^#+\s*/, '')}
        </div>
      );
    }
    if (t.startsWith('- ') || t.startsWith('• ') || t.startsWith('* ')) {
      return (
        <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 3 }}>
          <span style={{ color: 'var(--color-primary, #43A047)', flexShrink: 0, marginTop: 3, fontSize: 10 }}>●</span>
          <span style={{ lineHeight: 1.55, fontSize: '13px' }}>{fmt(t.slice(2))}</span>
        </div>
      );
    }
    if (/^\d+\./.test(t)) {
      return (
        <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 3 }}>
          <span style={{ color: 'var(--color-primary, #43A047)', flexShrink: 0, fontWeight: 700, fontSize: 11, minWidth: 16 }}>
            {t.match(/^(\d+)\./)?.[1]}.
          </span>
          <span style={{ lineHeight: 1.55, fontSize: '13px' }}>{fmt(t.replace(/^\d+\.\s*/, ''))}</span>
        </div>
      );
    }
    return (
      <div key={idx} style={{ lineHeight: 1.55, marginBottom: 2, fontSize: '13px' }}>
        {fmt(t)}
      </div>
    );
  });
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      title="Kopyahin ang sagot"
      aria-label="Kopyahin ang sagot"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--color-text-muted, #94A3B8)',
        padding: '2px 4px',
        borderRadius: 4,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 11,
      }}
    >
      {copied ? <Check size={12} color="var(--color-primary, #43A047)" /> : <Copy size={12} />}
    </button>
  );
}

export function AIChat({
  open,
  onClose,
  aiStatus,
  conversations,
  activeId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onSendMessage,
  onStopStreaming,
  onRetryStatus,
  streaming,
  streamingText,
  quickPrompts = [
    'Goat and Sheep Status (Katayuan ng Kambing at Tupa)',
    'Mga alagang kailangan ng atensyon',
    'Lampas na sa schedule na bakuna',
    'Mga buntis na inahin',
    'Mababa na ang stock sa inventory',
    'Mga paalala sa kalusugan',
  ],
}: AIChatProps) {
  const [input, setInput] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [previewModalImage, setPreviewModalImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeConv = conversations.find((c) => c.id === activeId);
  const messages: MyAIMessage[] = activeConv?.messages ?? [];

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, messages.length, streamingText]);

  if (!open) return null;

  const handleSend = () => {
    if ((!input.trim() && !selectedImage) || streaming) return;
    onSendMessage(input.trim(), selectedImage || undefined);
    setInput('');
    setSelectedImage(null);
    setImageName(null);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressed = await compressImageFile(file);
        setSelectedImage(compressed);
        setImageName(file.name);
      } catch (err) {
        console.error('Image compression error:', err);
      }
    }
    // reset input so the same file can be re-selected if removed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          try {
            const compressed = await compressImageFile(file);
            setSelectedImage(compressed);
            setImageName('Pasted Screenshot');
          } catch (err) {
            console.error('Failed to parse pasted image:', err);
          }
          break;
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const compressed = await compressImageFile(file);
        setSelectedImage(compressed);
        setImageName(file.name);
      } catch (err) {
        console.error('Dropped image processing failed:', err);
      }
    }
  };

  const corner = loadCorner();
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 500;

  // Responsive position styles
  const getPanelStyles = (): React.CSSProperties => {
    if (isMobile) {
      return {
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        borderRadius: 0,
        zIndex: 9999,
      };
    }

    const offset = BTN_SIZE + MARGIN * 2;
    const maxW = typeof window !== 'undefined' ? window.innerWidth - MARGIN * 2 : PANEL_W;
    const maxH = typeof window !== 'undefined' ? window.innerHeight - offset - MARGIN : PANEL_H;
    const pw = Math.min(PANEL_W, maxW);
    const ph = Math.min(PANEL_H, maxH);

    const base: React.CSSProperties = {
      position: 'fixed',
      width: pw,
      height: ph,
      borderRadius: 'var(--radius-xl, 24px)',
      zIndex: 9999,
    };

    switch (corner) {
      case 'tl': return { ...base, left: MARGIN, top: offset };
      case 'tr': return { ...base, right: MARGIN, top: offset };
      case 'bl': return { ...base, left: MARGIN, bottom: offset };
      case 'br': return { ...base, right: MARGIN, bottom: offset };
    }
  };

  return (
    <>
      {/* Backdrop for mobile */}
      {isMobile && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(6, 18, 32, 0.65)',
            backdropFilter: 'blur(4px)',
            zIndex: 9998,
          }}
        />
      )}

      {/* Image Zoom Lightbox Modal */}
      {previewModalImage && (
        <div
          onClick={() => setPreviewModalImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.82)',
            backdropFilter: 'blur(6px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '92vw',
              maxHeight: '88vh',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              background: '#1F2933',
            }}
          >
            <img
              src={previewModalImage}
              alt="Expanded preview"
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '84vh',
                objectFit: 'contain',
              }}
            />
            <button
              onClick={() => setPreviewModalImage(null)}
              aria-label="Close image preview"
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                background: 'rgba(0, 0, 0, 0.65)',
                color: '#FFFFFF',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '50%',
                width: 34,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div
        className="alpas-ai-chat-panel"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          ...getPanelStyles(),
          background: 'var(--color-surface, #FFFFFF)',
          border: isDragging ? '2px dashed var(--color-primary, #43A047)' : '1px solid var(--color-border, rgba(226, 232, 240, 0.95))',
          boxShadow: 'var(--shadow-modal, 0 24px 64px rgba(15, 23, 42, 0.18))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Panel Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border-light, rgba(226, 232, 240, 0.8))',
            background: 'var(--color-surface, #FFFFFF)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              title="Mga Pag-uusap"
              aria-label="Mga Pag-uusap"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-secondary, #475569)',
                padding: 4,
                borderRadius: '6px',
                display: 'flex',
              }}
            >
              <MessageSquare size={17} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--ai-gradient, linear-gradient(135deg, #43A047 0%, #42A5F5 100%))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                }}
              >
                <Bot size={16} />
              </div>
              <div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--color-text-primary, #1F2933)' }}>
                  AlpasFarm AI
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--color-text-muted, #667085)' }}>
                  {AI_MODE} · {MYAI_MODEL}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={onRetryStatus}
              title="I-refresh ang status"
              aria-label="I-refresh ang status"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted, #94A3B8)',
                padding: 4,
              }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              aria-label="Isara ang chat"
              title="Isara ang chat"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-secondary, #475569)',
                padding: 4,
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Conversations Drawer */}
        {showSidebar && (
          <div
            style={{
              padding: '12px',
              background: 'var(--color-surface-hover, rgba(148, 163, 184, 0.08))',
              borderBottom: '1px solid var(--color-border-light, rgba(226, 232, 240, 0.8))',
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted, #667085)' }}>
                Mga Pag-uusap
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onNewConversation();
                  setShowSidebar(false);
                }}
                leftIcon={<Plus size={12} />}
                style={{ padding: '2px 8px', fontSize: '11px', minHeight: 24 }}
              >
                Bagong Chat
              </Button>
            </div>
            {conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => {
                  onSelectConversation(c.id);
                  setShowSidebar(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm, 8px)',
                  background: c.id === activeId ? 'rgba(67, 160, 71, 0.12)' : 'transparent',
                  color: c.id === activeId ? 'var(--color-primary, #2E7D32)' : 'var(--color-text-primary, #1F2933)',
                  fontSize: '12px',
                  fontWeight: c.id === activeId ? 700 : 500,
                  cursor: 'pointer',
                  marginBottom: 2,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.title || 'Pag-uusap'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(c.id);
                  }}
                  aria-label="Burahin ang chat"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-muted, #94A3B8)',
                    padding: 2,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Message Feed */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px 8px' }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(67, 160, 71, 0.12)',
                  color: 'var(--color-primary, #2E7D32)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 10,
                }}
              >
                <Sparkles size={20} />
              </div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '14.5px', fontWeight: 700, color: 'var(--color-text-primary, #1F2933)' }}>
                Paano kita matutulungan sa iyong bukid ngayon?
              </h4>
              <p style={{ margin: '0 0 14px 0', fontSize: '12.5px', color: 'var(--color-text-muted, #667085)', lineHeight: 1.4 }}>
                Magtanong tungkol sa aktuwal na tala ng alaga, galaw sa camera, gamot, bakuna, breeding, imbentaryo, o benta.
              </p>

              {/* Quick Prompts Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                {quickPrompts.map((q) => (
                  <button
                    key={q}
                    onClick={() => onSendMessage(q)}
                    style={{
                      background: 'var(--color-surface, #F0F4F1)',
                      border: '1px solid var(--color-border, #E5EDE6)',
                      borderRadius: 'var(--radius-pill, 999px)',
                      padding: '5px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: 'var(--color-text-secondary, #475569)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  padding: m.image && !m.content ? '6px' : '10px 14px',
                  borderRadius:
                    m.role === 'user'
                      ? '18px 18px 4px 18px'
                      : '18px 18px 18px 4px',
                  background:
                    m.role === 'user'
                      ? 'var(--color-primary-gradient, linear-gradient(135deg, #43A047 0%, #2E7D32 100%))'
                      : 'var(--color-surface-hover, #F0F4F1)',
                  color: m.role === 'user' ? '#FFFFFF' : 'var(--color-text-primary, #1F2933)',
                  boxShadow: m.role === 'user' ? '0 4px 12px rgba(46, 125, 50, 0.25)' : 'none',
                  fontSize: '13px',
                }}
              >
                {/* User attached image thumbnail */}
                {m.image && (
                  <div
                    onClick={() => setPreviewModalImage(m.image!)}
                    style={{
                      marginBottom: m.content ? 8 : 0,
                      borderRadius: 12,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      position: 'relative',
                      border: m.role === 'user' ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(0,0,0,0.1)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}
                    title="I-click para i-zoom ang litrato"
                  >
                    <img
                      src={m.image}
                      alt="Attached livestock observation"
                      style={{
                        width: '100%',
                        maxHeight: 180,
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 6,
                        right: 6,
                        background: 'rgba(0, 0, 0, 0.65)',
                        color: '#FFFFFF',
                        borderRadius: 6,
                        padding: '2px 6px',
                        fontSize: 10,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Eye size={11} /> Zoom
                    </div>
                  </div>
                )}

                {m.content && (
                  m.role === 'user' ? m.content : renderMessageContent(m.content)
                )}
              </div>
              {m.role === 'assistant' && (
                <div style={{ marginTop: 2, paddingLeft: 4 }}>
                  <CopyBtn text={m.content} />
                </div>
              )}
            </div>
          ))}

          {/* Streaming response */}
          {streaming && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <div
                style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: '18px 18px 18px 4px',
                  background: 'var(--color-surface-hover, #F0F4F1)',
                  color: 'var(--color-text-primary, #1F2933)',
                  fontSize: '13px',
                }}
              >
                {streamingText ? renderMessageContent(streamingText) : <span style={{ opacity: 0.6 }}>Nag-iisip ang AI…</span>}
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* Selected Image Attachment Preview Chip */}
        {selectedImage && (
          <div
            style={{
              padding: '8px 14px',
              background: 'var(--color-surface-hover, #F0F4F1)',
              borderTop: '1px solid var(--color-border-light, #E5EDE6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
              <img
                src={selectedImage}
                alt="Selected preview"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 8,
                  objectFit: 'cover',
                  border: '1px solid var(--color-border, #DDE7DF)',
                  flexShrink: 0,
                }}
              />
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary, #1F2933)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {imageName || 'Nakalakip na Litrato'}
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--color-primary, #2E7D32)', fontWeight: 500 }}>
                  Handa para sa AI Analysis
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedImage(null);
                setImageName(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted, #94A3B8)',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Alisin ang litrato"
              title="Alisin ang litrato"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Input Bar */}
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--color-border-light, #E5EDE6)',
            background: 'var(--color-surface, #FFFFFF)',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />

          {/* Attach Image Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Maglakip ng litrato ng kambing o tupa"
            aria-label="Maglakip ng litrato ng kambing o tupa"
            style={{
              background: selectedImage ? 'rgba(46, 125, 50, 0.12)' : 'none',
              border: 'none',
              color: selectedImage ? 'var(--color-primary, #2E7D32)' : 'var(--color-text-muted, #64748B)',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
              flexShrink: 0,
              minHeight: 36,
            }}
          >
            <ImageIcon size={18} />
          </button>

          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={selectedImage ? "Maglagay ng mensahe o itanong sa AI ang tungkol sa litrato..." : "Magtanong sa AI o mag-attach ng litrato..."}
            style={{
              flex: 1,
              maxHeight: 90,
              padding: '8px 12px',
              fontSize: '13px',
              fontFamily: 'inherit',
              borderRadius: 'var(--radius-md, 12px)',
              background: 'var(--color-surface-hover, #F8FAF8)',
              border: '1px solid var(--color-border, #DDE7DF)',
              color: 'var(--color-text-primary, #1F2933)',
              outline: 'none',
              resize: 'none',
            }}
          />

          {streaming ? (
            <Button
              variant="danger"
              size="sm"
              onClick={onStopStreaming}
              aria-label="Itigil ang pagsagot"
              title="Itigil ang pagsagot"
              style={{ padding: '8px 12px', minHeight: 36 }}
            >
              <Square size={14} />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSend}
              disabled={!input.trim() && !selectedImage}
              aria-label="Ipadala ang mensahe"
              title="Ipadala ang mensahe"
              style={{ padding: '8px 12px', minHeight: 36 }}
            >
              <Send size={14} />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
