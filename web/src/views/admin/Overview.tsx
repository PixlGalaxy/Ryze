import { ChevronRight, ShieldAlert, TriangleAlert, Users, Volume2 } from 'lucide-react';
import { Card, cx } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import type { AdminProps, AdminTab } from './AdminPanel';

interface Stats {
  activeChannels: number;
  spam24h: number;
  created24h: number;
}

export function Overview({ data, go }: AdminProps) {
  const stats = useApi<Stats>('/stats', 20_000);
  const { voice, antiSpam, managers } = data.settings;
  const lobby = data.channels.find((c) => c.id === voice.lobbyChannelId);

  const tiles: [string, number | undefined, AdminTab][] = [
    ['Canales activos', stats.data?.activeChannels, 'voice'],
    ['Spam bloqueado (24 h)', stats.data?.spam24h, 'activity'],
    ['Canales creados (24 h)', stats.data?.created24h, 'activity'],
  ];

  const checks = [
    { ok: !!lobby, icon: Volume2, title: 'Canal lobby', text: lobby ? `🔊 ${lobby.name}` : 'Elige un canal o usa /voice setup', tab: 'voice' as const },
    {
      ok: antiSpam.enabled,
      icon: ShieldAlert,
      title: 'Anti-spam',
      text: antiSpam.enabled ? `Timeout de ${antiSpam.timeoutMinutes} min · ${antiSpam.blockedPatterns.length} palabras bloqueadas` : 'Desactivado',
      tab: 'antispam' as const,
    },
    { ok: true, icon: Users, title: 'Managers', text: `${managers.userIds.length} usuario(s) · ${managers.roleIds.length} rol(es)`, tab: 'permissions' as const },
  ];

  return (
    <>
      {data.warnings.length > 0 && (
        <Card title="Faltan permisos al bot" icon={TriangleAlert} className="border-warn" description="Sin estos permisos algunas funciones no van a funcionar. Dáselos al rol de Ryze en Ajustes del servidor → Roles.">
          <ul className="list-disc pl-5">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {tiles.map(([label, value, tab]) => (
          <button key={label} type="button" onClick={() => go(tab)} className="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition hover:border-accent">
            <div className="text-2xl font-bold tabular-nums">{value ?? '…'}</div>
            <div className="text-xs text-muted">{label}</div>
          </button>
        ))}
      </div>
      <Card title="Estado">
        <div className="mt-2 flex flex-col gap-1">
          {checks.map((c) => (
            <button key={c.title} type="button" onClick={() => go(c.tab)} className="flex cursor-pointer items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-left transition hover:bg-surface-3">
              <span className={cx('size-2.5 shrink-0 rounded-full', c.ok ? 'bg-ok' : 'bg-[#80848e]')} />
              <c.icon className="size-4 text-muted" />
              <div className="min-w-0 flex-1">
                <div>{c.title}</div>
                <div className="truncate text-xs text-muted">{c.text}</div>
              </div>
              <ChevronRight className="size-4 text-muted" />
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}
