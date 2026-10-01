import { History, LayoutDashboard, ShieldAlert, Users, Volume2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { CenterScreen, Spinner, cx } from '../../components/ui';
import type { Access, GuildData } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ActivityLog } from './ActivityLog';
import { AntiSpamSettings } from './AntiSpamSettings';
import { Overview } from './Overview';
import { Permissions } from './Permissions';
import { VoiceSettings } from './VoiceSettings';

export type AdminTab = 'overview' | 'voice' | 'antispam' | 'permissions' | 'activity';

const TABS: { id: AdminTab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
  { id: 'voice', label: 'Canales de voz', icon: Volume2 },
  { id: 'antispam', label: 'Anti-spam', icon: ShieldAlert },
  { id: 'permissions', label: 'Permisos', icon: Users },
  { id: 'activity', label: 'Actividad', icon: History },
];

export interface AdminProps {
  data: GuildData;
  setData: (update: (d: GuildData) => GuildData) => void;
  go: (tab: AdminTab) => void;
}

export function AdminPanel({ access }: { access: Exclude<Access, null> }) {
  const guild = useApi<GuildData>('/guild');
  const [tab, setTab] = useState<AdminTab>('overview');

  if (!guild.data) {
    return guild.error ? (
      <CenterScreen icon={TriangleAlert} title="No se pudo cargar la configuración">
        {guild.error}
      </CenterScreen>
    ) : (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const props: AdminProps = {
    data: { ...guild.data, me: { ...guild.data.me, access } },
    setData: (update) => guild.setData((d) => (d ? update(d) : d)),
    go: setTab,
  };

  return (
    <>
      <nav className="sticky top-0 z-30 flex gap-1 overflow-x-auto rounded-xl bg-surface p-1 [scrollbar-width:none]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition',
              tab === t.id ? 'bg-surface-3 text-fg shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-muted hover:bg-surface-3 hover:text-fg',
            )}
          >
            <t.icon className="size-4" />
            <span className="max-sm:hidden">{t.label}</span>
          </button>
        ))}
      </nav>
      <main className="flex flex-col gap-3.5 pt-4">
        {tab === 'overview' && <Overview {...props} />}
        {tab === 'voice' && <VoiceSettings {...props} />}
        {tab === 'antispam' && <AntiSpamSettings {...props} />}
        {tab === 'permissions' && <Permissions {...props} />}
        {tab === 'activity' && <ActivityLog {...props} />}
      </main>
    </>
  );
}
