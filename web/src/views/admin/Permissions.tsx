import { Crown, UserMinus, UserPlus, Users } from 'lucide-react';
import { Button, Card, Chip, Empty, Field, IconButton, MemberSearch, RolePicker, SaveBar, SectionLabel, UserRow, useAction } from '../../components/ui';
import { api, type GuildData, type Managers, type UserInfo } from '../../lib/api';
import { useDraft } from '../../lib/useApi';
import type { AdminProps } from './AdminPanel';

export function Permissions({ data, setData }: AdminProps) {
  const isOwner = data.me.access === 'owner';
  const { draft, set, dirty, reset } = useDraft<Managers>(data.settings.managers);
  const { run, busy } = useAction();
  const owner = data.users[data.guild.ownerId] ?? { id: data.guild.ownerId };

  const addUser = (u: UserInfo) => {
    setData((d) => ({ ...d, users: { ...d.users, [u.id]: u } }));
    set('userIds', [...draft.userIds, u.id]);
  };

  const save = () =>
    run(async () => {
      const res = await api<{ settings: GuildData['settings']; users: Record<string, UserInfo> }>('/settings/managers', { method: 'PUT', body: draft });
      setData((d) => ({ ...d, settings: res.settings, users: { ...d.users, ...res.users } }));
    }, 'Permissions saved');

  return (
    <>
      <Card
        title="Who can configure Ryze"
        icon={Users}
        description={
          isOwner
            ? 'As the server owner you always have access. Add the people or roles that can also see "Configure Ryze" and use /voice setup. They can configure everything except this section.'
            : 'Only the server owner can change this section.'
        }
      >
        <SectionLabel>Server owner</SectionLabel>
        <UserRow user={owner} badge={<Crown className="ml-1.5 inline size-3.5 text-warn" />} />

        <SectionLabel>Managers</SectionLabel>
        <div className="flex flex-col gap-1">
          {draft.userIds.map((id) => (
            <UserRow key={id} user={data.users[id] ?? { id }}>
              {isOwner && <IconButton icon={UserMinus} label="Remove" onClick={() => set('userIds', draft.userIds.filter((x) => x !== id))} />}
            </UserRow>
          ))}
          {draft.userIds.length === 0 && <Empty>No managers yet.</Empty>}
        </div>
        {isOwner && (
          <MemberSearch
            exclude={[data.guild.ownerId, ...draft.userIds]}
            actions={(u, clear) => (
              <Button
                size="sm"
                variant="secondary"
                icon={UserPlus}
                onClick={() => {
                  addUser(u);
                  clear();
                }}
              >
                Add
              </Button>
            )}
          />
        )}

        <SectionLabel>Roles with access</SectionLabel>
        {isOwner ? (
          <Field hint="Anyone with these roles gets manager access.">
            <RolePicker roles={data.roles} value={draft.roleIds} onChange={(ids) => set('roleIds', ids)} />
          </Field>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {draft.roleIds.length ? (
              draft.roleIds.map((id) => {
                const role = data.roles.find((r) => r.id === id);
                return (
                  <Chip key={id} color={role?.color}>
                    @{role?.name ?? id}
                  </Chip>
                );
              })
            ) : (
              <Empty>None</Empty>
            )}
          </div>
        )}
      </Card>
      {isOwner && <SaveBar dirty={dirty} saving={busy} onSave={save} onReset={reset} />}
    </>
  );
}
