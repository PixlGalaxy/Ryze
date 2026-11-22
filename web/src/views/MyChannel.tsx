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
            {channel.limit ? ` / ${channel.limit}` : ''} connected · {channel.locked ? 'Locked' : 'Open'} · created {timeAgo(channel.createdAt)}
          </div>
        </div>
        <Button
          variant={channel.locked ? 'secondary' : 'subtle'}
          icon={channel.locked ? LockOpen : Lock}
          loading={busy}
          onClick={() => patch({ locked: !channel.locked }, channel.locked ? 'Channel unlocked' : 'Channel locked')}
        >
          {channel.locked ? 'Unlock' : 'Lock'}
        </Button>
      </section>

      <div className="grid gap-3.5 md:grid-cols-2">
        <SettingsCard me={me} channel={channel} patch={patch} />

        {/* Members */}
        <Card title="In the channel" icon={Users}>
          <div className="mt-2 flex flex-col gap-1">
            {channel.members.map((m) => (
              <UserRow
                key={m.id}
                user={m}
                badge={m.id === channel.ownerId && <Crown className="ml-1.5 inline size-3.5 text-warn" aria-label="Owner" />}
              >
                {m.id !== me.user.id && !m.bot && (
                  <>
                    <IconButton
                      icon={Crown}
                      label="Make owner"
                      onClick={() =>
                        run(() => api('/me/channel/transfer', { method: 'POST', body: { userId: m.id } }).then(reload), `${m.name} is now the owner`)
                      }
                    />
                    <IconButton
                      icon={LogOut}
                      label="Kick"
                      onClick={() => run(() => api('/me/channel/kick', { method: 'POST', body: { userId: m.id } }).then(reload), `${m.name} kicked`)}
                    />
                    <IconButton icon={Ban} label="Kick and block" className="hover:!text-red-400" onClick={() => access(m.id, 'reject', `${m.name} blocked`)} />
                  </>
                )}
              </UserRow>
            ))}
            {others.length === 0 && <Empty>It's just you for now.</Empty>}
          </div>
        </Card>
      </div>

      {/* Access */}
      <Card
        title="Who can join"
        icon={ShieldCheck}
        description={
          channel.locked
            ? 'The channel is locked: only you and permitted people can join.'
            : 'The channel is open to everyone except blocked people. Lock it so only permitted people can join.'
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <SectionLabel>Permitted</SectionLabel>
            <div className="flex flex-col gap-1">
              {channel.permitted.map((u) => (
                <UserRow key={u.id} user={u}>
                  <IconButton icon={UserX} label="Remove permission" onClick={() => access(u.id, 'clear', 'Permission removed')} />
                </UserRow>
              ))}
              {channel.permitted.length === 0 && <Empty>No one yet.</Empty>}
            </div>
          </div>
          <div>
            <SectionLabel>Blocked</SectionLabel>
            <div className="flex flex-col gap-1">
              {channel.rejected.map((u) => (
                <UserRow key={u.id} user={u}>
                  <IconButton icon={Check} label="Unblock" onClick={() => access(u.id, 'clear', 'Unblocked')} />
                </UserRow>
              ))}
              {channel.rejected.length === 0 && <Empty>No one blocked.</Empty>}
            </div>
          </div>
        </div>
        <SectionLabel>Add someone</SectionLabel>
        <MemberSearch
          exclude={knownIds}
          actions={(u, clear) => (
            <>
              <Button size="sm" variant="secondary" icon={UserCheck} onClick={() => access(u.id, 'permit', `${u.name} permitted`).then(clear)}>
                Permit
              </Button>
              <Button size="sm" variant="danger" icon={Ban} onClick={() => access(u.id, 'reject', `${u.name} blocked`).then(clear)}>
                Block
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
      <Card title="Settings" icon={Pencil} description="The admins turned off name and limit changes in this server.">
        <p className="text-sm">
          Current limit: <b>{channel.limit || 'no limit'}</b>
        </p>
      </Card>
    );
  }

  return (
    <Card title="Settings" icon={Pencil}>
      <Field label="Name" hint="Discord allows 2 renames every 10 minutes.">
        <TextInput value={name} onChange={setName} maxLength={100} />
      </Field>
      <Field label="User limit" hint="0 = no limit.">
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
              'Changes saved',
            );
            if (res && !res.renamed) setNotice('Discord is rate-limiting renames: it will apply in a few minutes.');
            setSaving(false);
          }}
        >
          Save
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
        <Card title="Ownerless channel" icon={Crown}>
          <p className="text-muted">
            The owner of <b className="text-fg">{me.claimable.name}</b> left. You can take it over and manage it.
          </p>
          <Button className="mt-3" variant="primary" icon={Crown} loading={busy} onClick={() => run(() => api('/me/claim', { method: 'POST' }).then(reload), 'You are now the owner')}>
            Claim channel
          </Button>
        </Card>
      ) : (
        <Card title="You don't have a channel yet" icon={Sparkles}>
          {!me.lobby ? (
            <p className="text-muted">The admins haven't set up Ryze in this server yet.</p>
          ) : me.inVoice && !me.inVoice.isLobby ? (
            <>
              <p className="text-muted">
                You are in <b className="text-fg">{me.inVoice.name}</b>. Create your own channel and Ryze will move you there.
              </p>
              <Button className="mt-3" variant="primary" icon={Plus} loading={busy} onClick={() => run(() => api('/me/create', { method: 'POST' }).then(reload), 'Channel created')}>
                Create my channel
              </Button>
            </>
          ) : (
            <p className="flex items-start gap-2 text-muted">
              <DoorOpen className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                Join the <b className="text-fg">🔊 {me.lobby.name}</b> voice channel and Ryze will create a channel just for you. It is deleted once it is empty.
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
    <Card title="My preferences" icon={Pencil} description="Used every time Ryze creates a channel for you.">
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Name" hint="Empty = the server's default name.">
          <TextInput value={name} onChange={setName} placeholder={`${me.user.name}'s channel`} />
        </Field>
        <Field label="User limit" hint="0 = the server default.">
          <NumberInput value={limit} min={0} max={99} onChange={setLimit} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {(me.preferences.channelName || me.preferences.channelLimit) && (
          <ConfirmButton
            confirmLabel="Clear preferences?"
            onConfirm={() =>
              run(async () => {
                await api('/me/preferences', { method: 'PUT', body: { channelName: null, channelLimit: null } });
                setName('');
                setLimit(0);
                await reload();
              }, 'Preferences cleared')
            }
          >
            Reset
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
              'Preferences saved',
            )
          }
        >
          Save
        </Button>
      </div>
    </Card>
  );
}
