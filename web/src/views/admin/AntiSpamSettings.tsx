import { Ban, Copy, Gavel, ShieldAlert } from 'lucide-react';
import { Card, ChannelSelect, Field, NumberInput, RolePicker, SaveBar, TagEditor, Toggle, useAction } from '../../components/ui';
import { api, type AntiSpamSettings as AntiSpam, type GuildData } from '../../lib/api';
import { useDraft } from '../../lib/useApi';
import type { AdminProps } from './AdminPanel';

export function AntiSpamSettings({ data, setData }: AdminProps) {
  const { draft, set, dirty, reset } = useDraft<AntiSpam>(data.settings.antiSpam);
  const { run, busy } = useAction();

  const save = () =>
    run(async () => {
      const saved = await api<GuildData['settings']>('/settings/antispam', { method: 'PUT', body: draft });
      setData((d) => ({ ...d, settings: saved }));
    }, 'Anti-spam guardado');

  return (
    <>
      <Card
        title="Anti-spam"
        icon={ShieldAlert}
        description="Detecta cuentas comprometidas que mandan el mismo enlace (ej. sorteos falsos de MrBeast o Nitro gratis) en varios canales: borra los mensajes, aplica timeout y avisa a los admins."
      >
        <Toggle label="Activado" checked={draft.enabled} onChange={(v) => set('enabled', v)} />
      </Card>

      <Card title="Mismo mensaje en varios canales" icon={Copy}>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Canales distintos" hint="A partir de cuántos canales se considera spam.">
            <NumberInput value={draft.channelThreshold} min={2} max={25} onChange={(v) => set('channelThreshold', v)} />
          </Field>
          <Field label="Ventana de tiempo" hint="Tiempo en el que se cuentan los mensajes.">
            <NumberInput value={draft.windowSeconds} min={5} max={900} onChange={(v) => set('windowSeconds', v)} suffix="s" />
          </Field>
        </div>
        <Toggle
          label="Solo mensajes con enlaces o archivos"
          hint='Evita castigar a quien repite un "hola" en varios canales.'
          checked={draft.linksOnly}
          onChange={(v) => set('linksOnly', v)}
        />
      </Card>

      <Card
        title="Palabras y enlaces bloqueados"
        icon={Ban}
        description="Si un mensaje contiene alguno de estos textos se actúa al primer mensaje. No distingue mayúsculas, espacios ni puntos."
      >
        <TagEditor value={draft.blockedPatterns} onChange={(v) => set('blockedPatterns', v)} placeholder="ej. mrbeast, free nitro, dominio-falso.com" />
        <Toggle
          label="Solo si el mensaje tiene un enlace"
          hint="Recomendado: así alguien puede hablar de MrBeast sin ser castigado."
          checked={draft.blockedPatternsRequireLink}
          onChange={(v) => set('blockedPatternsRequireLink', v)}
        />
      </Card>

      <Card title="Castigo y aviso" icon={Gavel}>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Duración del timeout" hint="Máximo 28 días (40320 min).">
            <NumberInput value={draft.timeoutMinutes} min={1} max={40320} onChange={(v) => set('timeoutMinutes', v)} suffix="min" />
          </Field>
          <Field label="Canal de alertas" hint="Si no eliges uno, se usa el canal de sistema o #general.">
            <ChannelSelect channels={data.channels} type="text" value={draft.alertChannelId} onChange={(v) => set('alertChannelId', v)} emptyLabel="Automático (#general)" />
          </Field>
        </div>
        <Toggle label="Borrar los mensajes de spam" checked={draft.deleteMessages} onChange={(v) => set('deleteMessages', v)} />
        <Toggle label="Mencionar al dueño y a los managers en la alerta" checked={draft.pingAdmins} onChange={(v) => set('pingAdmins', v)} />
        <Field label="Roles exentos" hint="El dueño, los managers, los administradores y los bots siempre están exentos.">
          <RolePicker roles={data.roles} value={draft.exemptRoleIds} onChange={(ids) => set('exemptRoleIds', ids)} />
        </Field>
      </Card>

      <SaveBar dirty={dirty} saving={busy} onSave={save} onReset={reset} />
    </>
  );
}
