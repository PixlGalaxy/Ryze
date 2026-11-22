import {
  Ban,
  ChevronRight,
  CircleCheck,
  Crown,
  History,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Settings,
  TriangleAlert,
  Trash2,
  UserCheck,
  Users,
  Volume2,
  VolumeX,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Button, Card, ConfirmButton, Empty, cx, useAction, useToast } from '../../components/ui';
import { api, type ActivityEvent, type EventsPage, type UserInfo } from '../../lib/api';
import { errorMessage, timeAgo } from '../../lib/format';
import type { AdminProps } from './AdminPanel';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'spam', label: 'Spam' },
  { id: 'voice', label: 'Channels' },
  { id: 'config', label: 'Settings' },
] as const;

const SETTING_LABELS: Record<string, string> = {
  lobbyChannelId: 'lobby channel',
  categoryId: 'category',
  nameTemplate: 'default name',
  defaultLimit: 'limit',
  bitrateKbps: 'bitrate',
  lockedByDefault: 'locked by default',
  allowUserCustomization: 'customization',
  cooldownSeconds: 'cooldown',
  enabled: 'enabled',
  channelThreshold: 'channel threshold',
  windowSeconds: 'time window',
  linksOnly: 'links only',
  blockedPatterns: 'blocked words',
  blockedPatternsRequireLink: 'requires link',
  timeoutMinutes: 'timeout length',
  deleteMessages: 'delete messages',
  alertChannelId: 'alert channel',
  pingAdmins: 'ping admins',
  exemptRoleIds: 'exempt roles',
};

type Tone = 'danger' | 'warn' | undefined;

export function ActivityLog({ data }: AdminProps) {
  const [filter, setFilter] = useState('');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [users, setUsers] = useState<Record<string, UserInfo>>({});
  const [timedOut, setTimedOut] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toast = useToast();
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(
    async (before?: number) => {
      try {
        const f = filterRef.current;
        const page = await api<EventsPage>(`/events?group=${f}${before ? `&before=${before}` : ''}`);
        if (filterRef.current !== f) return;
        setEvents((prev) => (before ? [...prev, ...page.events] : page.events));
        setUsers((prev) => ({ ...prev, ...page.users }));
        setTimedOut(new Set(page.currentlyTimedOut));
        setHasMore(page.events.length === 50);
      } catch (e) {
        toast(errorMessage(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [filter, load]);

  // Refresh the first page every 15 s.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && events.length <= 50) void load();
    }, 15_000);
    return () => clearInterval(t);
  }, [load, events.length]);

  const name = (id: string | null | undefined) => (id ? (users[id]?.name ?? `@${id}`) : 'Ryze');
  const channelName = (id: unknown) => {
    const c = data.channels.find((x) => x.id === id);
    return c ? `#${c.name}` : 'deleted channel';
  };

  function describe(e: ActivityEvent): { icon: LucideIcon; text: string; tone?: Tone } {
    const d = e.data;
    switch (e.type) {
      case 'spam.timeout':
        return { icon: VolumeX, tone: 'danger', text: `${name(e.targetId)} got a ${d.timeoutMinutes} min timeout for spam` };
      case 'spam.timeout_failed':
        return { icon: TriangleAlert, tone: 'warn', text: `Spam from ${name(e.targetId)} detected, but the timeout could not be applied` };
      case 'spam.untimeout':
        return { icon: CircleCheck, text: `${name(e.actorId)} removed the timeout from ${name(e.targetId)}` };
      case 'voice.created':
        return { icon: Plus, text: `${name(e.actorId)} created "${d.name}"` };
      case 'voice.deleted':
        return { icon: Trash2, text: d.byAdmin ? `${name(e.actorId)} deleted "${d.name}" from the panel` : `"${d.name}" was deleted (empty)` };
      case 'voice.claimed':
        return {
          icon: Crown,
          text: d.transfer ? `${name(String(d.previousOwner))} handed their channel to ${name(e.actorId)}` : `${name(e.actorId)} claimed ${name(String(d.previousOwner))}'s channel`,
        };
      case 'voice.locked':
        return { icon: Lock, text: `${name(e.actorId)} locked their channel` };
      case 'voice.unlocked':
        return { icon: LockOpen, text: `${name(e.actorId)} unlocked their channel` };
      case 'voice.permit':
        return { icon: UserCheck, text: `${name(e.actorId)} permitted ${name(e.targetId)}` };
      case 'voice.reject':
        return { icon: Ban, text: `${name(e.actorId)} blocked ${name(e.targetId)} from their channel` };
      case 'voice.rename':
        return { icon: Pencil, text: `${name(e.actorId)} renamed their channel to "${d.name}"` };
      case 'voice.limit':
        return { icon: Users, text: `${name(e.actorId)} set the limit to ${d.limit || 'unlimited'}` };
      case 'setup':
        return { icon: Wrench, text: `${name(e.actorId)} ran /voice setup` };
      case 'config.voice':
      case 'config.antispam': {
        const changed = (Array.isArray(d.changed) ? d.changed : []).map((k) => SETTING_LABELS[String(k)] ?? String(k)).join(', ');
        return { icon: Settings, text: `${name(e.actorId)} changed ${e.type === 'config.voice' ? 'voice' : 'anti-spam'}: ${changed}` };
      }
      case 'config.managers':
        return { icon: Users, text: `${name(e.actorId)} updated the managers` };
      default:
        return { icon: Volume2, text: e.type };
    }
  }

  return (
    <Card
      title="Activity"
      icon={History}
      actions={
        <div className="flex flex-wrap gap-0.5 rounded-lg bg-bg p-[3px]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cx('cursor-pointer rounded-md px-2.5 py-1 text-xs transition', filter === f.id ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg')}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="mt-3 flex flex-col gap-1">
        {events.map((e) => {
          const { icon: Icon, text, tone } = describe(e);
          const isSpam = e.type === 'spam.timeout' || e.type === 'spam.timeout_failed';
          const subject = isSpam ? e.targetId : e.actorId;
          const expanded = open.has(e.id);
          return (
            <div
              key={e.id}
              className={cx('rounded-lg border-l-[3px] bg-surface-2', tone === 'danger' ? 'border-danger' : tone === 'warn' ? 'border-warn' : 'border-transparent')}
            >
              <button
                type="button"
                disabled={!isSpam}
                onClick={() => setOpen((s) => (s.has(e.id) ? new Set([...s].filter((x) => x !== e.id)) : new Set([...s, e.id])))}
                className={cx('flex w-full items-center gap-2.5 px-2.5 py-2 text-left', isSpam && 'cursor-pointer')}
              >
                <Icon className={cx('size-4 shrink-0', tone === 'danger' ? 'text-red-400' : tone === 'warn' ? 'text-warn' : 'text-muted')} />
                {subject && <Avatar src={users[subject]?.avatar} size={22} />}
                <span className="min-w-0 flex-1">{text}</span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted" title={new Date(e.createdAt).toLocaleString('en')}>
                  {timeAgo(e.createdAt)}
                </span>
                {isSpam && <ChevronRight className={cx('size-4 shrink-0 text-muted transition', expanded && 'rotate-90')} />}
              </button>
              {isSpam && expanded && <SpamDetails event={e} channelName={channelName} timedOut={!!e.targetId && timedOut.has(e.targetId)} onChange={() => load()} />}
            </div>
          );
        })}
        {!loading && events.length === 0 && <Empty>No activity yet.</Empty>}
      </div>
      {hasMore && (
        <Button variant="ghost" className="mt-2 w-full" onClick={() => load(events.at(-1)?.id)}>
          Load more
        </Button>
      )}
    </Card>
  );
}

function SpamDetails({
  event: e,
  channelName,
  timedOut,
  onChange,
}: {
  event: ActivityEvent;
  channelName: (id: unknown) => string;
  timedOut: boolean;
  onChange: () => void;
}) {
  const { run } = useAction();
  const d = e.data;
  const links = Array.isArray(d.links) ? (d.links as string[]) : [];
  const channels = Array.isArray(d.channelIds) ? (d.channelIds as string[]) : [];
  const rows: [string, React.ReactNode][] = [
    ['Reason', String(d.reasonText ?? d.reason)],
    ['User', `${d.userTag ?? ''} (${e.targetId})`],
    ['Channels', channels.map(channelName).join(', ') || '—'],
    ['Messages deleted', String(d.messagesDeleted ?? 0)],
  ];
  if (d.error) rows.push(['Error', <span className="text-warn">{String(d.error)}</span>]);
  if (links.length) rows.push(['Links', <span className="whitespace-pre-wrap break-all font-mono text-xs">{links.join('\n')}</span>]);

  return (
    <div className="flex flex-col gap-1.5 px-3.5 pb-3.5 pl-10 text-[13px] max-sm:pl-3.5">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[130px_1fr] gap-2.5 max-sm:grid-cols-1 max-sm:gap-0">
          <span className="text-muted">{k}</span>
          <span>{v}</span>
        </div>
      ))}
      {typeof d.content === 'string' && d.content && (
        <div>
          <div className="text-xs text-muted">Original message</div>
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg p-2.5 text-xs">{d.content}</pre>
        </div>
      )}
      {e.type === 'spam.timeout' && timedOut && e.targetId && (
        <div>
          <ConfirmButton
            icon={CircleCheck}
            confirmLabel="Sure? Remove timeout"
            onConfirm={() => run(() => api(`/members/${e.targetId}/untimeout`, { method: 'POST' }).then(onChange), 'Timeout removed')}
          >
            Remove timeout
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
