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
    }, 'Anti-spam saved');

  return (
    <>
      <Card
        title="Anti-spam"
        icon={ShieldAlert}
        description="Catches compromised accounts that post the same link (e.g. fake MrBeast giveaways or free Nitro) in several channels: deletes the messages, applies a timeout and alerts the admins."
      >
        <Toggle label="Enabled" checked={draft.enabled} onChange={(v) => set('enabled', v)} />
      </Card>

      <Card title="Same message in several channels" icon={Copy}>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Channel threshold" hint="How many different channels count as spam.">
            <NumberInput value={draft.channelThreshold} min={2} max={25} onChange={(v) => set('channelThreshold', v)} />
          </Field>
          <Field label="Time window" hint="Period in which messages are counted.">
            <NumberInput value={draft.windowSeconds} min={5} max={900} onChange={(v) => set('windowSeconds', v)} suffix="s" />
          </Field>
        </div>
        <Toggle
          label="Only messages with links or files"
          hint='Avoids punishing someone who says "hi" in several channels.'
          checked={draft.linksOnly}
          onChange={(v) => set('linksOnly', v)}
        />
      </Card>

      <Card
        title="Blocked words and links"
        icon={Ban}
        description="If a message contains any of these, Ryze acts on the first message. Ignores case, spaces and dots."
      >
        <TagEditor value={draft.blockedPatterns} onChange={(v) => set('blockedPatterns', v)} placeholder="e.g. mrbeast, free nitro, fake-domain.com" />
        <Toggle
          label="Only if the message has a link"
          hint="Recommended: lets people talk about MrBeast without being punished."
          checked={draft.blockedPatternsRequireLink}
          onChange={(v) => set('blockedPatternsRequireLink', v)}
        />
      </Card>

      <Card title="Punishment and alerts" icon={Gavel}>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Timeout length" hint="Up to 28 days (40320 min).">
            <NumberInput value={draft.timeoutMinutes} min={1} max={40320} onChange={(v) => set('timeoutMinutes', v)} suffix="min" />
          </Field>
          <Field label="Alert channel" hint="If none is chosen, the system channel or #general is used.">
            <ChannelSelect channels={data.channels} type="text" value={draft.alertChannelId} onChange={(v) => set('alertChannelId', v)} emptyLabel="Automatic (#general)" />
          </Field>
        </div>
        <Toggle label="Delete spam messages" checked={draft.deleteMessages} onChange={(v) => set('deleteMessages', v)} />
        <Toggle label="Ping the server owner and managers in the alert" checked={draft.pingAdmins} onChange={(v) => set('pingAdmins', v)} />
        <Field label="Exempt roles" hint="The server owner, managers, administrators and bots are always exempt.">
          <RolePicker roles={data.roles} value={draft.exemptRoleIds} onChange={(ids) => set('exemptRoleIds', ids)} />
        </Field>
      </Card>

      <SaveBar dirty={dirty} saving={busy} onSave={save} onReset={reset} />
    </>
  );
}
