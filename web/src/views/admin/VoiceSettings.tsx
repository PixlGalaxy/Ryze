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
    }, 'Configuración de voz guardada');

  return (
    <>
      <Card
        title="Join to Create"
        icon={DoorOpen}
        description="Cuando alguien entra al canal lobby, Ryze le crea su propio canal de voz en la categoría elegida y lo borra cuando queda vacío. También puedes crearlos con /voice setup."
      >
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Canal lobby" hint="Canal de voz al que entran para crear su canal.">
            <ChannelSelect channels={data.channels} type="voice" value={draft.lobbyChannelId} onChange={(v) => set('lobbyChannelId', v)} />
          </Field>
          <Field label="Categoría" hint="Dónde se crean los canales temporales.">
            <ChannelSelect channels={data.channels} type="category" value={draft.categoryId} onChange={(v) => set('categoryId', v)} />
          </Field>
        </div>
      </Card>

      <Card title="Canales nuevos" icon={Sparkles}>
        <Field
          label="Nombre por defecto"
          hint={
            <>
              Variables: <code>{'{user}'}</code> nombre, <code>{'{nick}'}</code> apodo, <code>{'{username}'}</code> usuario, <code>{'{count}'}</code> número. Vista previa:{' '}
              <b className="text-fg">{preview(draft.nameTemplate)}</b>
            </>
          }
        >
          <TextInput value={draft.nameTemplate} onChange={(v) => set('nameTemplate', v)} placeholder="{user}'s channel" />
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label="Límite de usuarios" hint="0 = sin límite">
            <NumberInput value={draft.defaultLimit} min={0} max={99} onChange={(v) => set('defaultLimit', v)} />
          </Field>
          <Field label="Bitrate" hint="0 = el de Discord">
            <NumberInput value={draft.bitrateKbps} min={0} max={384} onChange={(v) => set('bitrateKbps', v)} suffix="kbps" />
          </Field>
          <Field label="Cooldown" hint="Entre canales por usuario">
            <NumberInput value={draft.cooldownSeconds} min={0} max={600} onChange={(v) => set('cooldownSeconds', v)} suffix="s" />
          </Field>
        </div>
        <Toggle
          label="Bloqueados por defecto"
          hint="Solo entran el dueño y quienes él permita."
          checked={draft.lockedByDefault}
          onChange={(v) => set('lockedByDefault', v)}
        />
        <Toggle
          label="Los miembros pueden personalizar su canal"
          hint="Cambiar nombre y límite desde el panel o con /voice. Ryze recuerda su elección."
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
    <Card title="Canales activos" icon={Volume2}>
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
                  {c.limit ? `/${c.limit}` : ''} conectados · creado {timeAgo(c.createdAt)}
                </div>
              </div>
              <ConfirmButton
                icon={Trash2}
                loading={removing === c.channelId}
                onConfirm={async () => {
                  setRemoving(c.channelId);
                  await run(() => api(`/voice-channels/${c.channelId}`, { method: 'DELETE' }).then(list.reload), 'Canal borrado');
                  setRemoving(null);
                }}
              >
                Borrar
              </ConfirmButton>
            </div>
          );
        })}
        {list.data && list.data.channels.length === 0 && <Empty>No hay canales temporales activos.</Empty>}
        {list.error && <Empty>{list.error}</Empty>}
      </div>
    </Card>
  );
}
