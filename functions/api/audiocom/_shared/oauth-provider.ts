/* SPDX-License-Identifier: AGPL-3.0-only */
import { AudiocomOAuthContractError, normalizeTokenPair, type AudiocomTokenPair } from './oauth-contracts.ts';
import { decryptOAuthSecret } from './oauth-crypto.ts';
import { configuredSecret, OAuthHttpError, readUpstreamJson, type AudiocomOAuthFunctionContext } from './oauth-http.ts';
import type { OAuthHandlerDependencies } from './oauth-handlers.ts';
import type { OAuthGrantRecord } from './oauth-repository.ts';

export async function exchangeAuthorizationCode(context: AudiocomOAuthFunctionContext, code: string, verifier: string, dependencies: OAuthHandlerDependencies): Promise<AudiocomTokenPair> {
	return tokenRequest(context, {
		grant_type: 'authorization_code', code, code_verifier: verifier,
		redirect_uri: context.env.AUDIOCOM_OAUTH_REDIRECT_URI?.trim() || new URL('/api/audiocom/oauth/callback', context.request.url).href,
	}, dependencies);
}
export async function refreshAccessToken(context: AudiocomOAuthFunctionContext, grant: OAuthGrantRecord, masterKey: string, dependencies: OAuthHandlerDependencies): Promise<AudiocomTokenPair> {
	return tokenRequest(context, {
		grant_type: 'refresh_token',
		refresh_token: await decryptOAuthSecret(grant.refreshTokenCiphertext, masterKey, `audiocom-oauth:${grant.id}:refresh`),
	}, dependencies);
}
async function tokenRequest(context: AudiocomOAuthFunctionContext, fields: Record<string, string>, dependencies: OAuthHandlerDependencies): Promise<AudiocomTokenPair> {
	const form = new URLSearchParams({ ...fields, client_id: configuredSecret(context.env.AUDIOCOM_CLIENT_ID, 'OAuth client') });
	if (context.env.AUDIOCOM_CLIENT_SECRET?.trim()) form.set('client_secret', configuredSecret(context.env.AUDIOCOM_CLIENT_SECRET, 'OAuth client secret'));
	const response = await (dependencies.fetchImpl ?? fetch)('https://api.audio.com/auth/token', {
		method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: form.toString(), redirect: 'manual', signal: AbortSignal.any([context.request.signal, AbortSignal.timeout(10_000)]),
	});
	if (!response.ok) {
		if (fields.grant_type === 'refresh_token' && [400, 401].includes(response.status)) throw new OAuthHttpError(401, 'authentication_expired', 'Reconnect audio.com to continue.');
		throw new OAuthHttpError(502, 'authorization_failed', 'audio.com rejected the authorization response.');
	}
	try { return normalizeTokenPair(await readUpstreamJson(response)); }
	catch (error) {
		if (error instanceof AudiocomOAuthContractError) throw new OAuthHttpError(502, 'invalid_upstream_response', 'audio.com returned invalid authorization data.');
		throw error;
	}
}
