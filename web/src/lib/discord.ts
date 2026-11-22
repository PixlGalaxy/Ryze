import { DiscordSDK } from '@discord/embedded-app-sdk';
import { api, setSession, type AuthResult } from './api';
import { errorMessage } from './format';

export function isInsideDiscord(): boolean {
  return new URLSearchParams(location.search).has('frame_id');
}

/** Runs one login step and labels its error, so the screen says where it failed. */
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[ryze] ${label} failed`, error);
    throw new Error(`${label}: ${errorMessage(error)}`);
  }
}

/** Embedded App SDK handshake + OAuth2 login, then a Ryze session for this server. */
export async function connect(): Promise<AuthResult> {
  const { clientId } = await step('Configuration', () => api<{ clientId: string }>('/public'));
  const sdk = new DiscordSDK(clientId);
  await step('Connecting to Discord', () => sdk.ready());

  const { code } = await step('Authorization', () =>
    sdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    }),
  );

  const auth = await step('Sign-in', () =>
    api<AuthResult>('/auth', { method: 'POST', body: { code, guildId: sdk.guildId } }),
  );
  await step('Discord authentication', () => sdk.commands.authenticate({ access_token: auth.accessToken }));
  if (auth.session) setSession(auth.session);
  return auth;
}
