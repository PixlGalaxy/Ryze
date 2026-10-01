import {
  Ban,
  Check,
  Crown,
  DoorOpen,
  Lock,
  LockOpen,
  LogOut,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserX,
  Users,
  Volume2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  ConfirmButton,
  Empty,
  Field,
  IconButton,
  MemberSearch,
  NumberInput,
  SectionLabel,
  TextInput,
  UserRow,
  cx,
  useAction,
} from '../components/ui';
import { api, type ChannelState, type MeData } from '../lib/api';
import { timeAgo } from '../lib/format';

const QUICK_LIMITS = [0, 2, 3, 4, 5, 10];

export function MyChannel({ me, reload }: { me: MeData; reload: () => Promise<void> }) {
  return me.channel ? <OwnedChannel me={me} channel={me.channel} reload={reload} /> : <NoChannel me={me} reload={reload} />;
}

// --------------------------------------------------------------- owner

function OwnedChannel({ me, channel, reload }: { me: MeData; channel: ChannelState; reload: () => Promise<void> }) {
  const { run, busy } = useAction();
  const patch = (body: Partial<Pick<ChannelState, 'name' | 'limit' | 'locked'>>, success?: string) =>
    run(async () => {
      const res = await api<{ renamed: boolean }>('/me/channel', { method: 'PATCH', body });
      await reload();
      return res;
    }, success);

  const access = (userId: string, mode: 'permit' | 'reject' | 'clear', success: string) =>
    run(() => api('/me/channel/access', { method: 'POST', body: { userId, mode } }).then(reload), success);

  const others = channel.members.filter((m) => m.id !== me.user.id);
  const knownIds = [me.user.id, ...channel.permitted.map((u) => u.id), ...channel.rejected.map((u) => u.id)];

  return (
    <div className="flex flex-col gap-3.5">
      {/* Header */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-gradient-to-br from-surface to-surface-2 p-4">
        <div className={cx('grid size-12 place-items-center rounded-xl', channel.locked ? 'bg-danger/20 text-red-300' : 'bg-ok/20 text-green-300')}>
          {channel.locked ? <Lock className="size-6" /> : <Volume2 className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{channel.name}</div>
          <div className="text-xs text-muted">
            <Users className="mr-1 inline size-3.5" />
            {channel.members.length}
            {channel.limit ? ` / ${channel.limit}` : ''} conectados · {channel.locked ? 'Bloqueado' : 'Abierto'} · creado {timeAgo(channel.createdAt)}
          </div>
        </div>
        <Button
          variant={channel.locked ? 'secondary' : 'subtle'}
          icon={channel.locked ? LockOpen : Lock}
          loading={busy}
          onClick={() => patch({ locked: !channel.locked }, channel.locked ? 'Canal desbloqueado' : 'Canal bloqueado')}
        >
          {channel.locked ? 'Desbloquear' : 'Bloquear'}
        </Button>
      </section>

      <div className="grid gap-3.5 md:grid-cols-2">
        <SettingsCard me={me} channel={channel} patch={patch} />

        {/* Members */}
        <Card title="En el canal" icon={Users}>
          <div className="mt-2 flex flex-col gap-1">
            {channel.members.map((m) => (
              <UserRow
                key={m.id}
                user={m}
                badge={m.id === channel.ownerId && <Crown className="ml-1.5 inline size-3.5 text-warn" aria-label="Dueño" />}
              >
                {m.id !== me.user.id && !m.bot && (
                  <>
                    <IconButton
                      icon={Crown}
                      label="Hacer dueño"
                      onClick={() =>
                        run(() => api('/me/channel/transfer', { method: 'POST', body: { userId: m.id } }).then(reload), `${m.name} ahora es el dueño`)
                      }
                    />
                    <IconButton
                      icon={LogOut}
                      label="Expulsar"
                      onClick={() => run(() => api('/me/channel/kick', { method: 'POST', body: { userId: m.id } }).then(reload), `${m.name} expulsado`)}
                    />
                    <IconButton icon={Ban} label="Expulsar y bloquear" className="hover:!text-red-400" onClick={() => access(m.id, 'reject', `${m.name} bloqueado`)} />
                  </>
                )}
              </UserRow>
            ))}
            {others.length === 0 && <Empty>Estás solo por ahora.</Empty>}
          </div>
        </Card>
      </div>

      {/* Access */}
      <Card
        title="Quién puede entrar"
        icon={ShieldCheck}
        description={
          channel.locked
            ? 'El canal está bloqueado: solo pueden entrar tú y las personas permitidas.'
            : 'El canal está abierto para todos menos los bloqueados. Bloquéalo para que solo entren los permitidos.'
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <SectionLabel>Permitidos</SectionLabel>
            <div className="flex flex-col gap-1">
              {channel.permitted.map((u) => (
                <UserRow key={u.id} user={u}>
                  <IconButton icon={UserX} label="Quitar permiso" onClick={() => access(u.id, 'clear', 'Permiso quitado')} />
                </UserRow>
              ))}
              {channel.permitted.length === 0 && <Empty>Nadie todavía.</Empty>}
            </div>
          </div>
          <div>
            <SectionLabel>Bloqueados</SectionLabel>
            <div className="flex flex-col gap-1">
              {channel.rejected.map((u) => (
                <UserRow key={u.id} user={u}>
                  <IconButton icon={Check} label="Desbloquear" onClick={() => access(u.id, 'clear', 'Desbloqueado')} />
                </UserRow>
              ))}
              {channel.rejected.length === 0 && <Empty>Nadie bloqueado.</Empty>}
            </div>
          </div>
        </div>
        <SectionLabel>Agregar persona</SectionLabel>
        <MemberSearch
          exclude={knownIds}
          actions={(u, clear) => (
            <>
              <Button size="sm" variant="secondary" icon={UserCheck} onClick={() => access(u.id, 'permit', `${u.name} permitido`).then(clear)}>
                Permitir
              </Button>
              <Button size="sm" variant="danger" icon={Ban} onClick={() => access(u.id, 'reject', `${u.name} bloqueado`).then(clear)}>
                Bloquear
              </Button>
            </>
          )}
        />
      </Card>
    </div>
  );
}

function SettingsCard({
  me,
  channel,
  patch,
}: {
  me: MeData;
  channel: ChannelState;
  patch: (body: Partial<Pick<ChannelState, 'name' | 'limit'>>, success?: string) => Promise<{ renamed: boolean } | undefined>;
}) {
  const [name, setName] = useState(channel.name);
  const [limit, setLimit] = useState(channel.limit);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Follow changes made elsewhere (commands, Discord UI) unless the user is editing.
  const [base, setBase] = useState({ name: channel.name, limit: channel.limit });
  useEffect(() => {
    if (name === base.name) setName(channel.name);
    if (limit === base.limit) setLimit(channel.limit);
    setBase({ name: channel.name, limit: channel.limit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.name, channel.limit]);

  const dirty = name.trim() !== channel.name || limit !== channel.limit;

  if (!me.canCustomize) {
    return (
      <Card title="Ajustes" icon={Pencil} description="Los administradores desactivaron el cambio de nombre y límite en este servidor.">
        <p className="text-sm">
          Límite actual: <b>{channel.limit || 'sin límite'}</b>
        </p>
      </Card>
    );
  }

  return (
    <Card title="Ajustes" icon={Pencil}>
      <Field label="Nombre" hint="Discord permite 2 cambios de nombre cada 10 minutos.">
        <TextInput value={name} onChange={setName} maxLength={100} />
      </Field>
      <Field label="Límite de usuarios" hint="0 = sin límite.">
        <NumberInput value={limit} min={0} max={99} onChange={setLimit} />
      </Field>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK_LIMITS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setLimit(n)}
            className={cx(
              'cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition',
              limit === n ? 'bg-accent text-bg' : 'bg-surface-3 text-muted hover:text-fg',
            )}
          >
            {n === 0 ? '∞' : n}
          </button>
        ))}
      </div>
      {notice && <p className="mt-3 rounded-lg bg-warn/15 px-3 py-2 text-xs text-warn">{notice}</p>}
      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          icon={Check}
          disabled={!dirty || !name.trim()}
          loading={saving}
          onClick={async () => {
            setSaving(true);
            setNotice(null);
            const res = await patch(
              { ...(name.trim() !== channel.name && { name: name.trim() }), ...(limit !== channel.limit && { limit }) },
              'Cambios guardados',
            );
            if (res && !res.renamed) setNotice('Discord está limitando los cambios de nombre: se aplicará en unos minutos.');
            setSaving(false);
          }}
        >
          Guardar
        </Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ no channel

function NoChannel({ me, reload }: { me: MeData; reload: () => Promise<void> }) {
  const { run, busy } = useAction();

  return (
    <div className="flex flex-col gap-3.5">
      {me.claimable ? (
        <Card title="Canal sin dueño" icon={Crown}>
          <p className="text-muted">
            El dueño de <b className="text-fg">{me.claimable.name}</b> se fue. Puedes quedártelo y gestionarlo tú.
          </p>
          <Button className="mt-3" variant="primary" icon={Crown} loading={busy} onClick={() => run(() => api('/me/claim', { method: 'POST' }).then(reload), 'Ahora eres el dueño')}>
            Reclamar canal
          </Button>
        </Card>
      ) : (
        <Card title="Todavía no tienes canal" icon={Sparkles}>
          {!me.lobby ? (
            <p className="text-muted">Los administradores todavía no configuraron Ryze en este servidor.</p>
          ) : me.inVoice && !me.inVoice.isLobby ? (
            <>
              <p className="text-muted">
                Estás en <b className="text-fg">{me.inVoice.name}</b>. Crea tu propio canal y Ryze te moverá ahí.
              </p>
              <Button className="mt-3" variant="primary" icon={Plus} loading={busy} onClick={() => run(() => api('/me/create', { method: 'POST' }).then(reload), 'Canal creado')}>
                Crear mi canal
              </Button>
            </>
          ) : (
            <p className="flex items-start gap-2 text-muted">
              <DoorOpen className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                Entra al canal de voz <b className="text-fg">🔊 {me.lobby.name}</b> y Ryze creará un canal solo para ti. Se borra cuando queda vacío.
              </span>
            </p>
          )}
        </Card>
      )}
      {me.canCustomize && <PreferencesCard me={me} reload={reload} />}
    </div>
  );
}

function PreferencesCard({ me, reload }: { me: MeData; reload: () => Promise<void> }) {
  const { run, busy } = useAction();
  const [name, setName] = useState(me.preferences.channelName ?? '');
  const [limit, setLimit] = useState(me.preferences.channelLimit ?? 0);
  const dirty = name.trim() !== (me.preferences.channelName ?? '') || limit !== (me.preferences.channelLimit ?? 0);

  return (
    <Card title="Mis preferencias" icon={Pencil} description="Se usan cada vez que Ryze te crea un canal.">
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Nombre" hint="Vacío = el nombre por defecto del servidor.">
          <TextInput value={name} onChange={setName} placeholder={`Canal de ${me.user.name}`} />
        </Field>
        <Field label="Límite de usuarios" hint="0 = el del servidor.">
          <NumberInput value={limit} min={0} max={99} onChange={setLimit} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {(me.preferences.channelName || me.preferences.channelLimit) && (
          <ConfirmButton
            confirmLabel="¿Borrar preferencias?"
            onConfirm={() =>
              run(async () => {
                await api('/me/preferences', { method: 'PUT', body: { channelName: null, channelLimit: null } });
                setName('');
                setLimit(0);
                await reload();
              }, 'Preferencias borradas')
            }
          >
            Restablecer
          </ConfirmButton>
        )}
        <Button
          variant="primary"
          icon={Check}
          disabled={!dirty}
          loading={busy}
          onClick={() =>
            run(
              () => api('/me/preferences', { method: 'PUT', body: { channelName: name.trim() || null, channelLimit: limit || null } }).then(reload),
              'Preferencias guardadas',
            )
          }
        >
          Guardar
        </Button>
      </div>
    </Card>
  );
}
