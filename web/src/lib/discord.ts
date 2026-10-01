import { DiscordSDK } from '@discord/embedded-app-sdk';
import { api, setSession, type AuthResult } from './api';

export function isInsideDiscord(): boolean {
  return new URLSearchParams(location.search).has('frame_id');
}

/** Embedded App SDK handshake + OAuth2 login, then a Ryze session for this server. */
export async function connect(): Promise<AuthResult> {
  const { clientId } = await api<{ clientId: string }>('/public');
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  const auth = await api<AuthResult>('/auth', { method: 'POST', body: { code, guildId: sdk.guildId } });
  await sdk.commands.authenticate({ access_token: auth.accessToken });
  if (auth.session) setSession(auth.session);
  return auth;
}
