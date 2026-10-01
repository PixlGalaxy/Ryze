import { ArrowLeft, Gamepad2, Lock, ServerOff, Settings, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, CenterScreen, Spinner } from './components/ui';
import type { Access, AuthResult } from './lib/api';
import { connect, isInsideDiscord } from './lib/discord';
import { errorMessage } from './lib/format';
import { useApi } from './lib/useApi';
import type { MeData } from './lib/api';
import { AdminPanel } from './views/admin/AdminPanel';
import { MyChannel } from './views/MyChannel';

type Boot =
  | { state: 'loading' }
  | { state: 'outside' }
  | { state: 'error'; message: string }
  | { state: 'denied'; reason: NonNullable<AuthResult['reason']> }
  | { state: 'ready'; access: Access };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev
    started.current = true;
    if (!isInsideDiscord()) return setBoot({ state: 'outside' });
    connect()
      .then((auth) => setBoot(auth.session ? { state: 'ready', access: auth.access } : { state: 'denied', reason: auth.reason ?? 'not_member' }))
      .catch((e) => setBoot({ state: 'error', message: errorMessage(e) }));
  }, []);

  switch (boot.state) {
    case 'loading':
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3">
          <Spinner />
          <p className="text-muted">Conectando con Discord…</p>
        </div>
      );
    case 'outside':
      return (
        <CenterScreen icon={Gamepad2} title="Abre Ryze desde Discord">
          Este panel funciona como Activity de Discord. En tu servidor abre el lanzador de apps (🚀) y elige Ryze, o usa <code>/panel</code>.
        </CenterScreen>
      );
    case 'error':
      return (
        <CenterScreen icon={TriangleAlert} title="No se pudo cargar el panel">
          {boot.message}
        </CenterScreen>
      );
    case 'denied': {
      const texts = {
        no_guild: ['Solo en servidores', 'Abre el panel desde un canal de un servidor, no desde mensajes directos.'],
        bot_not_in_guild: ['Ryze no está en este servidor', 'Invita al bot al servidor para usar el panel.'],
        not_member: ['Sin acceso', 'No eres miembro de este servidor.'],
      } as const;
      const [title, text] = texts[boot.reason];
      return (
        <CenterScreen icon={boot.reason === 'bot_not_in_guild' ? ServerOff : Lock} title={title}>
          {text}
        </CenterScreen>
      );
    }
    case 'ready':
      return <Shell />;
  }
}

function Shell() {
  const me = useApi<MeData>('/me', 5000);
  const [mode, setMode] = useState<'member' | 'admin'>('member');

  if (!me.data) {
    return me.error ? (
      <CenterScreen icon={TriangleAlert} title="No se pudo cargar el panel">
        {me.error}
      </CenterScreen>
    ) : (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const { guild, user, access } = me.data;
  const isAdmin = access !== null;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-28">
      <header className="flex items-center gap-3 py-4">
        {guild.icon ? (
          <Avatar src={guild.icon} size={40} />
        ) : (
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 font-bold">{guild.name[0]}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{guild.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Avatar src={user.avatar} size={16} />
            <span className="truncate">
              {user.name}
              {access === 'owner' ? ' · Dueño' : access === 'manager' ? ' · Manager de Ryze' : ''}
            </span>
          </div>
        </div>
        {isAdmin &&
          (mode === 'member' ? (
            <Button variant="primary" icon={Settings} onClick={() => setMode('admin')}>
              <span className="max-sm:hidden">Configurar Ryze</span>
            </Button>
          ) : (
            <Button variant="subtle" icon={ArrowLeft} onClick={() => setMode('member')}>
              <span className="max-sm:hidden">Mi canal</span>
            </Button>
          ))}
      </header>

      {mode === 'admin' && isAdmin ? <AdminPanel access={access} /> : <MyChannel me={me.data} reload={me.reload} />}
    </div>
  );
}
