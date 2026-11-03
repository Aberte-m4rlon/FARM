/**
 * FloatingAICloud — Global draggable AI assistant for AlpasFarm.
 * Uses AIFloatingButton and AIChat modular components.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useFarmData } from '../lib/useFarmData';
import { useGateMonitoringSummary } from '../lib/useGateMonitoringSummary';
import {
  type MyAIConversation, type MyAIMessage, type AIStatus,
  checkAIStatus, buildFarmContext, streamChat,
  loadConversations, saveConversations, newConversation,
} from '../lib/myai';
import { AIFloatingButton } from './ai/AIFloatingButton';
import { AIChat } from './ai/AIChat';

function getStatusDot(s: AIStatus) {
  if (s === 'online' || s === 'production') return '#10B981';
  if (s === 'checking') return '#F59E0B';
  return '#EF4444';
}

export function FloatingAICloud() {
  const farmData = useFarmData();
  const gateMonitoring = useGateMonitoringSummary();

  // Panel State
  const [open, setOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIStatus>('checking');
  const [retryCount, setRetryCount] = useState(0);

  // Conversations
  const [conversations, setConversations] = useState<MyAIConversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const c = loadConversations();
    return c.length > 0 ? c[0].id : null;
  });
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamText] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handleSendRef = useRef<(text: string, image?: string, profileContext?: string) => Promise<void>>(async () => undefined);

  // Status Polling
  const checkStatus = useCallback(async () => {
    setAiStatus(await checkAIStatus());
  }, []);

  useEffect(() => {
    checkStatus();
    pollRef.current = setInterval(checkStatus, 30000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [checkStatus, retryCount]);

  // Listen for global open event from sidebar AI Cloud launcher and Vet AI consults
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    const handleConsult = (e: Event) => {
      const customEvent = e as CustomEvent<{ prompt?: string; image?: string; profileContext?: string }>;
      setOpen(true);
      if (customEvent.detail?.prompt || customEvent.detail?.image) {
        setTimeout(() => {
          void handleSendRef.current(customEvent.detail.prompt || '', customEvent.detail.image, customEvent.detail.profileContext);
        }, 300);
      }
    };

    window.addEventListener('alpas:open-ai-cloud', handleOpen);
    window.addEventListener('alpas:consult-vet-ai', handleConsult);
    return () => {
      window.removeEventListener('alpas:open-ai-cloud', handleOpen);
      window.removeEventListener('alpas:consult-vet-ai', handleConsult);
    };
  }, []);

  // Persist Conversations
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // Conversation Management
  const handleNewConv = () => {
    const c = newConversation();
    setConversations((p) => [c, ...p]);
    setActiveId(c.id);
  };

  const handleDelConv = (id: string) => {
    setConversations((p) => p.filter((c) => c.id !== id));
    if (activeId === id) {
      const r = conversations.filter((c) => c.id !== id);
      setActiveId(r.length > 0 ? r[0].id : null);
    }
  };

  const handleSelectConv = (id: string) => {
    setActiveId(id);
  };

  const handleStopStreaming = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStreaming(false);
  };

  const isOffline = aiStatus === 'offline' || aiStatus === 'no_model' || aiStatus === 'unavailable';

  // Send Message
  const handleSend = async (text: string, image?: string, profileContext?: string) => {
    const msg = text.trim();
    if ((!msg && !image) || streaming || isOffline) return;

    const displayTitle = msg ? (msg.slice(0, 48) + (msg.length > 48 ? '...' : '')) : 'Image Analysis';

    let conv = conversations.find((c) => c.id === activeId) ?? null;
    if (!conv) {
      conv = newConversation(displayTitle);
      setConversations((p) => [conv!, ...p]);
      setActiveId(conv.id);
    } else if (conv.messages.length === 0) {
      setConversations((p) =>
        p.map((c) =>
          c.id === conv!.id ? { ...c, title: displayTitle } : c
        )
      );
    }

    const userMsg: MyAIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: msg || (image ? 'Please analyze this attached livestock image.' : ''),
      image: image || undefined,
      timestamp: Date.now(),
    };

    setConversations((p) =>
      p.map((c) =>
        c.id === conv!.id
          ? { ...c, messages: [...c.messages, userMsg], updatedAt: Date.now() }
          : c
      )
    );

    const farmContext = !farmData.loading
      ? buildFarmContext({
          ...farmData,
          gateMonitoring: {
            session: gateMonitoring.session,
            summary: gateMonitoring.summary,
            events: gateMonitoring.events,
            crossings: gateMonitoring.crossings,
            cameraMetrics: gateMonitoring.cameraMetrics,
            liveTracks: gateMonitoring.liveTracks,
            alerts: gateMonitoring.alerts,
            available: gateMonitoring.available,
            loading: gateMonitoring.loading,
          },
        }, msg || 'Image Analysis')
      : '';
    const ctx = [farmContext, profileContext ? `[CURRENT ANIMAL PROFILE RECORDS]\n${profileContext}` : '']
      .filter(Boolean)
      .join('\n\n');

    const sys = ctx
      ? `You are the AI Farm Assistant for AlpasFarm, a goat and sheep farm management system in the Philippines.\nIMPORTANT:\n- Use a Filipino-friendly Tagalog + English (Taglish) language style that is natural, warm, and easy for Filipino farmers, farm staff, and technicians to understand.\n- Avoid overly deep or archaic Tagalog words; use common English technical terms (e.g., 'Health Status', 'Breeding', 'Vaccine', 'Inventory', 'Overdue', 'Weight').\n- Use the REAL farm data below. NEVER invent records or sensor values.\n- Remind the user to consult a licensed veterinarian for medical or diagnostic advice.\n\nFARM DATA:\n${ctx}`
      : `You are the AI Farm Assistant for AlpasFarm — a Goat & Sheep Farm Management System in the Philippines. Respond in natural, friendly Taglish (simple Tagalog mixed with common English farm/tech terms). Be concise and helpful.`;

    const historyMsgs = conv.messages
      .filter((m) => m && (m.content || m.image) && !m.content.trim().startsWith('[Alert]'))
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.trim(), image: m.image }));

    const msgs = [
      { role: 'system', content: sys },
      ...historyMsgs,
      { role: 'user', content: userMsg.content, image: userMsg.image },
    ];

    setStreaming(true);
    setStreamText('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let full = '';

    try {
      for await (const _ of streamChat(
        msgs,
        (t) => {
          full += t;
          setStreamText(full);
        },
        ctrl.signal
      )) {
        /* streaming */
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        full = `${err?.message ?? 'Pansamantalang hindi maabot ang AI service. Pakisubukan muli.'}`;
        setStreamText(full);
        checkStatus();
      }
    }

    const aMsg: MyAIMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: full || '(no response)',
      timestamp: Date.now(),
    };

    setConversations((p) =>
      p.map((c) =>
        c.id === conv!.id
          ? { ...c, messages: [...c.messages, aMsg], updatedAt: Date.now() }
          : c
      )
    );

    setStreamText('');
    setStreaming(false);
    abortRef.current = null;
  };

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  return (
    <>
      <AIFloatingButton
        isOpen={open}
        onToggle={() => setOpen((o) => !o)}
        statusDotColor={getStatusDot(aiStatus)}
      />

      <AIChat
        open={open}
        onClose={() => setOpen(false)}
        aiStatus={aiStatus}
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={handleSelectConv}
        onNewConversation={handleNewConv}
        onDeleteConversation={handleDelConv}
        onSendMessage={handleSend}
        onStopStreaming={handleStopStreaming}
        onRetryStatus={() => {
          setRetryCount((r) => r + 1);
          checkStatus();
        }}
        streaming={streaming}
        streamingText={streamingText}
      />
    </>
  );
}
