/**
 * MyAIPage — The AI Cloud assistant is now the global floating assistant.
 * This page redirects to dashboard; users open AI Cloud via the floating button.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

export function MyAIPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to dashboard after a short moment so the user sees the message
    const t = setTimeout(() => navigate('/dashboard', { replace: true }), 1800);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '60vh', gap: 20, textAlign: 'center',
      padding: 24,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20,
        background: 'linear-gradient(135deg, #238B45, #176B35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 28px rgba(35, 139, 69, 0.38)',
      }}>
        <Sparkles size={32} color="#fff" />
      </div>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', marginBottom: 8, letterSpacing: '-0.5px' }}>
          Available na sa buong sistema ang AI Farm Assistant
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 360 }}>
          Maaari mong kausapin ang AI Farm Assistant sa kahit saang pahina.
          Hanapin lamang ang floating button sa ibabang bahagi ng screen.
        </p>
      </div>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 20px', borderRadius: 999,
        background: '#EAF6ED', border: '1px solid rgba(35, 139, 69, 0.30)',
        fontSize: 13, color: '#174B2A', fontWeight: 600,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#238B45', animation: 'pulse 1.5s ease-in-out infinite' }} />
        Lilipat sa Goat and Sheep Status (Katayuan ng Kambing at Tupa)…
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.4)} }`}</style>
    </div>
  );
}
