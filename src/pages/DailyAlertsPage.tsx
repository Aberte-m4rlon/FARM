import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFarmData } from '../lib/useFarmData';
import { useNotifications } from '../context/NotificationContext';
import { generateDailyAlerts, type DailyAlert } from '../lib/recommendations';
import { matchDailyAlertsWithReadState } from '../lib/dailyAlertMatching';
import { FilterToolbar, FilterPill } from '../components/FilterToolbar';
import { sendPushNotifications, generateAlertSummary, copyAlertSummaryToClipboard } from '../lib/alertNotifications';
import { useToast } from '../components/ui/Toast';
import {
  Bell,
  Copy,
  Mail,
  HeartPulse,
  Syringe,
  Heart,
  Scale,
  Package,
  AlertTriangle,
  CheckCircle2,
  CheckCircle,
  ArrowRight,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';

export function DailyAlertsPage() {
  const farmData = useFarmData();
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    handleNotificationClick,
    markAllAsRead,
    syncAlerts,
  } = useNotifications();

  const navigate = useNavigate();
  const toast = useToast();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [visibleLimit, setVisibleLimit] = useState(100);

  const {
    animals,
    weightRecords,
    vaccinations,
    inventory,
    breedingRecords,
    settings,
  } = farmData;

  const rawAlerts = useMemo(
    () =>
      generateDailyAlerts(
        animals,
        weightRecords,
        vaccinations,
        inventory,
        breedingRecords,
        settings ?? undefined
      ),
    [animals, weightRecords, vaccinations, inventory, breedingRecords, settings]
  );

  // Sync alerts with global notifications once farm data is loaded
  useEffect(() => {
    if (!farmData.loading && !notificationsLoading && rawAlerts.length > 0) {
      void syncAlerts(rawAlerts);
    }
  }, [farmData.loading, notificationsLoading, rawAlerts, syncAlerts]);

  // Map alerts to sync with read status from notifications
  const alertsWithReadState = useMemo(() => {
    return matchDailyAlertsWithReadState(rawAlerts, notifications);
  }, [rawAlerts, notifications]);

  const filteredAlerts = useMemo(() => {
    if (priorityFilter === 'All') return alertsWithReadState;
    if (priorityFilter === 'Unread') return alertsWithReadState.filter((a) => !a.isRead);
    return alertsWithReadState.filter((a) => a.priority === priorityFilter);
  }, [alertsWithReadState, priorityFilter]);

  useEffect(() => {
    setVisibleLimit(100);
  }, [priorityFilter]);

  const visibleAlerts = useMemo(
    () => filteredAlerts.slice(0, visibleLimit),
    [filteredAlerts, visibleLimit]
  );

  const alertSummary = useMemo(
    () => generateAlertSummary(rawAlerts, settings?.farm_name ?? 'AlpasFarm'),
    [rawAlerts, settings?.farm_name]
  );

  const urgentCount = useMemo(() => {
    return alertsWithReadState.filter((a) => a.priority === 'Critical' || a.priority === 'Warning').length;
  }, [alertsWithReadState]);

  const handleSendPushNotifications = async () => {
    setSending(true);
    try {
      await sendPushNotifications(rawAlerts);
      toast('Naipadala na ang mga alerto sa notipikasyon.', 'success');
    } catch {
      toast('Hindi naipadala ang mga paalala. Suriin ang koneksyon at subukan muli.', 'danger');
    } finally {
      setSending(false);
    }
  };

  const handleCopySummary = async () => {
    try {
      await copyAlertSummaryToClipboard(rawAlerts, farmData.settings?.farm_name ?? 'AlpasFarm');
      toast('Nakopya na ang tala sa clipboard.', 'success');
    } catch {
      toast('Hindi makopya ang tala.', 'danger');
    }
  };

  const handleAlertClick = (alert: (typeof alertsWithReadState)[0]) => {
    if (alert.matchingNotif) {
      handleNotificationClick(alert.matchingNotif, navigate);
    } else {
      if (alert.link) {
        navigate(alert.link);
      }
    }
  };

  if (farmData.loading) {
    return <LoadingSpinner text="Kinakarga ang mga paalala..." fullScreen />;
  }

  const badgeVariant = (priority: string) => {
    const pr = priority.toLowerCase();
    if (pr === 'critical') return 'danger';
    if (pr === 'warning' || pr === 'high') return 'warning';
    return 'success';
  };

  const typeIcon = (t: string) => {
    const type = (t || '').toLowerCase();
    switch (type) {
      case 'health':
        return <HeartPulse size={18} color="#EF4444" />;
      case 'expiry':
        return <AlertTriangle size={18} color="#F59E0B" />;
      case 'vaccination':
      case 'vaccine':
        return <Syringe size={18} color="#238B45" />;
      case 'breeding':
        return <Heart size={18} color="#238B45" />;
      case 'weight':
        return <Scale size={18} color="#238B45" />;
      case 'inventory':
        return <Package size={18} color="#238B45" />;
      default:
        return <Bell size={18} color="#238B45" />;
    }
  };

  const priorityLabel = (priority: string) => {
    const pr = priority.toLowerCase();
    if (pr === 'critical') return 'Kailangan ng Aksyon';
    if (pr === 'warning' || pr === 'high') return 'Mahalaga';
    if (pr === 'info') return 'Paalala';
    return 'Normal';
  };

  const priorityPills = [
    { id: 'All', label: 'Lahat' },
    { id: 'Unread', label: 'Hindi pa Nababasa' },
    { id: 'Critical', label: 'Kailangan ng Aksyon' },
    { id: 'Warning', label: 'Mahalaga' },
    { id: 'Info', label: 'Paalala' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Mga Paalala</h1>
          <p style={{ color: 'var(--color-text-secondary, #475569)', fontSize: 13, marginTop: 4 }}>
            Mahalagang listahan ng mga gawain, panganib sa kalusugan, at paalala para sa araw na ito.
          </p>
        </div>
        {rawAlerts.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
              leftIcon={<CheckCircle2 size={15} />}
            >
              Markahang Nabasa Lahat
            </Button>
            <Button
              variant="primary"
              onClick={handleSendPushNotifications}
              loading={sending}
              leftIcon={<Bell size={15} />}
            >
              Magpadala ng Notipikasyon
            </Button>
            <Button
              variant="secondary"
              onClick={() => setSummaryOpen(true)}
              leftIcon={<Mail size={15} />}
            >
              Tingnan ang Kalagayan
            </Button>
            <Button
              variant="secondary"
              onClick={handleCopySummary}
              leftIcon={<Copy size={15} />}
            >
              Kopyahin ang mga Paalala
            </Button>
          </div>
        )}
      </div>

      {/* 3-Column Summary Cards: All | Unread | Urgent */}
      <div className="mobile-stats-grid-3" style={{ marginBottom: 16 }}>
        {/* All */}
        <div
          onClick={() => setPriorityFilter('All')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: priorityFilter === 'All' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Lahat
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bell size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {rawAlerts.length}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Kabuuang alerto
            </div>
          </div>
        </div>

        {/* Unread */}
        <div
          onClick={() => setPriorityFilter('Unread')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: priorityFilter === 'Unread' ? '2px solid #238B45' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700 }}>
              Hindi pa Nababasa
            </span>
            <div className="stat-card-icon green" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Mail size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value">
              {unreadCount}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Di pa nababasa
            </div>
          </div>
        </div>

        {/* Urgent */}
        <div
          onClick={() => setPriorityFilter(priorityFilter === 'Critical' ? 'All' : 'Critical')}
          className="stat-card"
          style={{
            cursor: 'pointer',
            border: priorityFilter === 'Critical' ? '2px solid #EF4444' : undefined,
          }}
        >
          <div className="alpas-stat-header">
            <span className="stat-card-label" style={{ fontWeight: 700, color: 'var(--color-danger, #EF4444)' }}>
              Kailangan ng Aksyon
            </span>
            <div className="stat-card-icon red" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={15} />
            </div>
          </div>
          <div>
            <div className="stat-card-value" style={{ color: 'var(--color-danger, #EF4444)' }}>
              {urgentCount}
            </div>
            <div className="alpas-stat-footer" style={{ color: 'var(--color-text-muted)' }}>
              Kailangang aksyonan
            </div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <FilterToolbar>
        {priorityPills.map((pill) => {
          let count = rawAlerts.length;
          if (pill.id === 'Unread') count = alertsWithReadState.filter((a) => !a.isRead).length;
          else if (pill.id !== 'All') count = alertsWithReadState.filter((a) => a.priority === pill.id).length;

          return (
            <FilterPill
              key={pill.id}
              active={priorityFilter === pill.id}
              onClick={() => setPriorityFilter(pill.id)}
              label={pill.label}
              count={count}
            />
          );
        })}
      </FilterToolbar>

      {/* Alerts Card List */}
      <Card variant="glass" padding="none">
        {filteredAlerts.length === 0 ? (
          <EmptyState
            icon={<CheckCircle size={32} />}
            title="Walang bagong paalala sa bukid."
            description="Maayos at ligtas ang kalagayan ng bukid sa kasalukuyan."
          />
        ) : (
          <div style={{ padding: '6px 16px' }}>
            {visibleAlerts.map((alert, idx) => {
              const isUnread = !alert.isRead;

              return (
                <div
                  key={alert.id || idx}
                  onClick={() => handleAlertClick(alert)}
                  className={`alert-row-item ${isUnread ? 'alert-card-unread' : 'alert-card-read'}`}
                  style={{
                    display: 'flex',
                    gap: 14,
                    alignItems: 'flex-start',
                    padding: '16px 14px',
                    margin: '8px 0',
                    borderRadius: '12px',
                    border: isUnread
                      ? '1px solid rgba(67, 160, 71, 0.35)'
                      : '1px solid var(--border-light, rgba(0,0,0,0.06))',
                    background: isUnread
                      ? 'var(--notif-unread-bg, rgba(67, 160, 71, 0.06))'
                      : 'var(--card-bg, rgba(255, 255, 255, 0.6))',
                    cursor: alert.link ? 'pointer' : 'default',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {/* Left Icon */}
                  <div
                    style={{
                      marginTop: 2,
                      width: 36,
                      height: 36,
                      borderRadius: '10px',
                      background: isUnread ? 'rgba(67, 160, 71, 0.12)' : 'rgba(0, 0, 0, 0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {typeIcon(alert.type)}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontWeight: isUnread ? 800 : 600,
                          fontSize: 14.5,
                          color: 'var(--text, #0f172a)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {alert.title}
                      </span>
                      <Badge variant={badgeVariant(alert.priority)} size="sm">
                        {priorityLabel(alert.priority)}
                      </Badge>
                      {isUnread && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            background: '#22C55E',
                            color: '#FFFFFF',
                            fontSize: '10px',
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                          }}
                        >
                          ● BAGO
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: isUnread ? 'var(--text, #1e293b)' : 'var(--color-text-secondary, #64748b)',
                        lineHeight: 1.45,
                      }}
                    >
                      {alert.description}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        fontSize: 11.5,
                        color: 'var(--color-text-secondary, #94a3b8)',
                        marginTop: 6,
                      }}
                    >
                      <span>Takdang Petsa: {alert.dueLabel}</span>
                      {alert.link && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--color-primary, #43A047)', fontWeight: 600 }}>
                          Aksyonan ang paalala <ArrowRight size={12} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {visibleAlerts.length < filteredAlerts.length && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 16px 16px' }}>
            <Button
              variant="secondary"
              onClick={() => setVisibleLimit((limit) => Math.min(limit + 100, filteredAlerts.length))}
            >
              Ipakita pa ({filteredAlerts.length - visibleAlerts.length} paalala)
            </Button>
          </div>
        )}
      </Card>

      {/* SMS/Email Summary Modal */}
      {summaryOpen && (
        <Modal open={summaryOpen} onClose={() => setSummaryOpen(false)} size="lg">
          <ModalHeader
            title="Mga Paalala"
            subtitle="Kopyahin ang mga paalalang ito para maipadala sa SMS, email, o Messenger"
            icon={<Mail size={18} />}
          />
          <ModalBody>
            <pre
              style={{
                background: 'var(--color-surface-elevated, rgba(0, 0, 0, 0.2))',
                padding: 14,
                borderRadius: 8,
                fontSize: 12,
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                maxHeight: 350,
                overflowY: 'auto',
                border: '1px solid var(--border-light, rgba(255,255,255,0.1))',
                color: 'var(--color-text-primary, #0f172a)',
              }}
            >
              {alertSummary}
            </pre>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setSummaryOpen(false)}>
              Isara
            </Button>
            <Button variant="primary" onClick={handleCopySummary} leftIcon={<Copy size={15} />}>
              Kopyahin sa Clipboard
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
