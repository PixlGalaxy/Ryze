import { DoorOpen, Lock, Sparkles, Trash2, Volume2 } from 'lucide-react';
import { useState } from 'react';
import {
  Avatar,
  Card,
  ChannelSelect,
  ConfirmButton,
  Empty,
  Field,
  NumberInput,
  SaveBar,
  TextInput,
  Toggle,
  useAction,
} from '../../components/ui';
import { api, type GuildData, type TempChannelInfo, type UserInfo, type VoiceSettings as Voice } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useApi, useDraft } from '../../lib/useApi';
import type { AdminProps } from './AdminPanel';

const preview = (t: string) =>
  t.replaceAll('{user}', 'Galaxy').replaceAll('{nick}', 'Galaxy').replaceAll('{username}', 'galaxy').replaceAll('{count}', '3') || '—';

export function VoiceSettings({ data, setData }: AdminProps) {
  const { draft, set, dirty, reset } = useDraft<Voice>(data.settings.voice);
  const { run, busy } = useAction();

  const save = () =>
    run(async () => {
      const saved = await api<GuildData['settings']>('/settings/voice', { method: 'PUT', body: draft });
      setData((d) => ({ ...d, settings: saved }));
    }, 'Voice settings saved');

  return (
    <>
      <Card
        title="Join to Create"
        icon={DoorOpen}
        description="When someone joins the lobby channel, Ryze creates their own voice channel in the chosen category and deletes it once it is empty. You can also create both with /voice setup."
      >
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Lobby channel" hint="Voice channel members join to create their channel.">
            <ChannelSelect channels={data.channels} type="voice" value={draft.lobbyChannelId} onChange={(v) => set('lobbyChannelId', v)} />
          </Field>
          <Field label="Category" hint="Where temporary channels are created.">
            <ChannelSelect channels={data.channels} type="category" value={draft.categoryId} onChange={(v) => set('categoryId', v)} />
          </Field>
        </div>
      </Card>

      <Card title="New channels" icon={Sparkles}>
        <Field
          label="Default name"
          hint={
            <>
              Variables: <code>{'{user}'}</code> name, <code>{'{nick}'}</code> nickname, <code>{'{username}'}</code> username, <code>{'{count}'}</code> number. Preview:{' '}
              <b className="text-fg">{preview(draft.nameTemplate)}</b>
            </>
          }
        >
          <TextInput value={draft.nameTemplate} onChange={(v) => set('nameTemplate', v)} placeholder="{user}'s channel" />
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label="User limit" hint="0 = no limit">
            <NumberInput value={draft.defaultLimit} min={0} max={99} onChange={(v) => set('defaultLimit', v)} />
          </Field>
          <Field label="Bitrate" hint="0 = Discord default">
            <NumberInput value={draft.bitrateKbps} min={0} max={384} onChange={(v) => set('bitrateKbps', v)} suffix="kbps" />
          </Field>
          <Field label="Cooldown" hint="Between channels, per user">
            <NumberInput value={draft.cooldownSeconds} min={0} max={600} onChange={(v) => set('cooldownSeconds', v)} suffix="s" />
          </Field>
        </div>
        <Toggle
          label="Locked by default"
          hint="Only the owner and the people they permit can join."
          checked={draft.lockedByDefault}
          onChange={(v) => set('lockedByDefault', v)}
        />
        <Toggle
          label="Members can customize their channel"
          hint="Change the name and limit from the panel or with /voice. Ryze remembers their choice."
          checked={draft.allowUserCustomization}
          onChange={(v) => set('allowUserCustomization', v)}
        />
      </Card>

      <ActiveChannels />
      <SaveBar dirty={dirty} saving={busy} onSave={save} onReset={reset} />
    </>
  );
}

function ActiveChannels() {
  const list = useApi<{ channels: TempChannelInfo[]; users: Record<string, UserInfo> }>('/voice-channels', 10_000);
  const { run } = useAction();
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <Card title="Active channels" icon={Volume2}>
      <div className="mt-2 flex flex-col gap-1">
        {list.data?.channels.map((c) => {
          const owner = list.data!.users[c.ownerId];
          return (
            <div key={c.channelId} className="flex items-center gap-2.5 rounded-lg bg-surface-2 px-2.5 py-2">
              <Avatar src={owner?.avatar} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate">
                  {c.locked ? <Lock className="size-3.5 text-red-300" /> : <Volume2 className="size-3.5 text-muted" />}
                  {c.name}
                </div>
                <div className="truncate text-xs text-muted">
                  {owner?.name ?? c.ownerId} · {c.members}
                  {c.limit ? `/${c.limit}` : ''} connected · created {timeAgo(c.createdAt)}
                </div>
              </div>
              <ConfirmButton
                icon={Trash2}
                loading={removing === c.channelId}
                onConfirm={async () => {
                  setRemoving(c.channelId);
                  await run(() => api(`/voice-channels/${c.channelId}`, { method: 'DELETE' }).then(list.reload), 'Channel deleted');
                  setRemoving(null);
                }}
              >
                Delete
              </ConfirmButton>
            </div>
          );
        })}
        {list.data && list.data.channels.length === 0 && <Empty>No active temporary channels.</Empty>}
        {list.error && <Empty>{list.error}</Empty>}
      </div>
    </Card>
  );
}
