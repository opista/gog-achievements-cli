import type { LoginOptions } from './auth-ports.mjs';
// Public Galaxy application parameters, also used by Heroic/gogdl.
export const GALAXY_CLIENT_ID = '46899977096215655';
export const GALAXY_CLIENT_SECRET =
  '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';
export const LOGIN_REDIRECT = 'https://embed.gog.com/on_login_success?origin=client';
export function buildLoginURL({ redirectURI = LOGIN_REDIRECT, state }: LoginOptions = {}) {
  return `https://auth.gog.com/auth?${new URLSearchParams({
    client_id: GALAXY_CLIENT_ID,
    redirect_uri: redirectURI,
    response_type: 'code',
    layout: 'client2',
    ...(state ? { state } : {}),
  })}`;
}
export const LOGIN_URL = buildLoginURL();
