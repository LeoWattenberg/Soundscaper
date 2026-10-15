/* SPDX-License-Identifier: AGPL-3.0-only */
import { AudiocomOAuthContractError, normalizeTokenPair, type AudiocomTokenPair } from './oauth-contracts.ts';
import { decryptOAuthSecret } from './oauth-crypto.ts';
import { configuredSecret, OAuthHttpError, readUpstreamJson, type AudiocomOAuthFunctionContext } from './oauth-http.ts';
import type { OAuthHandlerDependencies } from './oauth-handlers.ts';
import type { OAuthGrantRecord } from './oauth-repository.ts';
import { providerConfiguration } from './provider-config.ts';
import { oauthRedirectUri } from './oauth-application.ts';

export async function exchangeAuthorizationCode(context: AudiocomOAuthFunctionContext, code: string, verifier: string, dependencies: OAuthHandlerDependencies): Promise<AudiocomTokenPair> {
	return tokenRequest(context, {
		grant_type: 'authorization_code', code, code_verifier: verifier,
		redirect_uri: oauthRedirectUri(context),
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
	const response = await (dependencies.fetchImpl ?? fetch)(new URL('/auth/token', providerConfiguration(context.env).apiOrigin), {
		method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: form.toString(), redirect: 'manual', signal: AbortSignal.any([context.request.signal, AbortSignal.timeout(10_000)]),
	});
	if (!response.ok) {
		const errorCode = await tokenErrorCode(response);
		console.warn(JSON.stringify({ event: 'audiocom_oauth_token_rejected',
			provider: providerConfiguration(context.env).kind, grantType: fields.grant_type, status: response.status, errorCode }));
		if (fields.grant_type === 'refresh_token' && [400, 401].includes(response.status)) throw new OAuthHttpError(401, 'authentication_expired', 'Reconnect audio.com to continue.');
		throw new OAuthHttpError(502, 'authorization_failed', 'audio.com rejected the authorization response.');
	}
	let value: unknown;
	try { value = await readUpstreamJson(response); }
	catch {
		console.warn(JSON.stringify({ event: 'audiocom_oauth_token_unreadable', status: response.status }));
		throw new OAuthHttpError(502, 'oauth_token_response_unreadable', 'audio.com returned an unreadable authorization response.');
	}
	try { return normalizeTokenPair(value, providerConfiguration(context.env).scope.split(' ')); }
	catch (error) {
		if (error instanceof AudiocomOAuthContractError) {
			const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
			console.warn(JSON.stringify({ event: 'audiocom_oauth_token_invalid',
				provider: providerConfiguration(context.env).kind, reason: error.message,
				expiresInSeconds: Number.isSafeInteger(source.expires_in) ? source.expires_in : null,
				fieldTypes: Object.fromEntries(['token_type', 'access_token', 'refresh_token', 'expires_in', 'scope'].map(key => [key, typeof source[key]])),
			}));
			throw new OAuthHttpError(502, error.diagnosticCode, 'audio.com returned invalid authorization data.');
		}
		throw error;
	}
}

async function tokenErrorCode(response: Response): Promise<string> {
	try {
		const value = await readUpstreamJson(response, 8_192);
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
		const code = (value as Record<string, unknown>).error;
		return typeof code === 'string' && ['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client',
			'unsupported_grant_type', 'invalid_scope', 'temporarily_unavailable'].includes(code) ? code : 'unknown';
	} catch { return 'unknown'; }
}
