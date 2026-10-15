/* SPDX-License-Identifier: AGPL-3.0-only */
import { configuredSecret, OAuthHttpError, readUpstreamJson, type AudiocomOAuthFunctionContext } from './oauth-http.ts';
import { oauthRedirectUri } from './oauth-application.ts';
import { providerConfiguration } from './provider-config.ts';
import type { OAuthHandlerDependencies } from './oauth-handlers.ts';
import type { AudiocomOAuthProviderBinding } from './oauth-provider-binding-contracts.ts';

export const PROVIDER_ORIGIN_HEADER = 'X-Audiocom-Api-Origin';
const DEFAULT_ORIGIN = 'https://api.audio.com';

/** Preferences select an issuer; only a matching stored grant authorizes it. */
export function selectedProviderContext(context: AudiocomOAuthFunctionContext): AudiocomOAuthFunctionContext {
	const value = context.request.headers.get(PROVIDER_ORIGIN_HEADER);
	if (value === null) return context;
	const origin = selectedOrigin(value, context);
	return withOrigin(context, origin);
}

/** HTML audio requests have no custom headers and use their authenticated grant. */
export function boundProviderContext(context: AudiocomOAuthFunctionContext, binding: AudiocomOAuthProviderBinding | undefined): AudiocomOAuthFunctionContext {
	if (!binding) return selectedProviderContext(context);
	const selected = context.request.headers.get(PROVIDER_ORIGIN_HEADER);
	if (selected !== null && selectedOrigin(selected, context) !== binding.apiOrigin) mismatch();
	if (selected === null && !new URL(context.request.url).pathname.endsWith('/preview')
		&& providerConfiguration(context.env).apiOrigin !== binding.apiOrigin) mismatch();
	return contextWithProviderBinding(context, binding);
}

export function contextWithProviderBinding(context: AudiocomOAuthFunctionContext, binding: AudiocomOAuthProviderBinding): AudiocomOAuthFunctionContext {
	const configured = withOrigin(context, selectedOrigin(binding.apiOrigin, context));
	if (providerConfiguration(configured.env).scope !== binding.scope) mismatch();
	return { ...configured, env: { ...configured.env, AUDIOCOM_CLIENT_ID: binding.clientId, AUDIOCOM_OAUTH_REDIRECT_URI: binding.redirectUri } };
}

export async function registerSelectedProvider(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies): Promise<AudiocomOAuthProviderBinding> {
	const provider = providerConfiguration(context.env);
	const redirectUri = oauthRedirectUri(context);
	if (provider.kind === 'audiocom' || !context.request.headers.has(PROVIDER_ORIGIN_HEADER)) {
		return { apiOrigin: provider.apiOrigin, clientId: configuredSecret(context.env.AUDIOCOM_CLIENT_ID, 'OAuth client'), redirectUri, scope: provider.scope };
	}
	let response: Response;
	try {
		response = await (dependencies.fetchImpl ?? fetch)(new URL('/auth/client', provider.apiOrigin), {
			method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			redirect: 'manual', signal: AbortSignal.any([context.request.signal, AbortSignal.timeout(10_000)]),
			body: JSON.stringify({ client_name: 'Soundscaper', token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: provider.scope, redirect_uris: [redirectUri] }),
		});
	} catch { return unavailable(); }
	if (response.status !== 200 && response.status !== 201) { await response.body?.cancel(); unavailable(); }
	const value = await readUpstreamJson(response);
	if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
	const registration = value as Record<string, unknown>;
	if (typeof registration.client_id !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(registration.client_id)
		|| registration.token_endpoint_auth_method !== 'none' || !Array.isArray(registration.redirect_uris)
		|| registration.redirect_uris.length !== 1 || registration.redirect_uris[0] !== redirectUri) unavailable();
	return { apiOrigin: provider.apiOrigin, clientId: registration.client_id, redirectUri, scope: provider.scope };
}

function withOrigin(context: AudiocomOAuthFunctionContext, origin: string): AudiocomOAuthFunctionContext {
	const custom = origin !== DEFAULT_ORIGIN;
	return { ...context, env: { ...context.env, AUDIOCOM_PROVIDER: custom ? 'audiocity' : undefined,
		AUDIOCOM_API_ORIGIN: custom ? origin : undefined, ...(custom ? { AUDIOCOM_CLIENT_SECRET: undefined } : {}) } };
}

function selectedOrigin(value: string, context: AudiocomOAuthFunctionContext): string {
	let url: URL;
	try { url = new URL(value); } catch { return invalid(); }
	const editor = new URL(context.request.url);
	const local = context.env.AUDIOCOM_LOCAL_DEVELOPMENT === '1'
		&& editor.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(editor.hostname)
		&& url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (value.length > 2_048 || url.username || url.password || url.pathname !== '/' || url.search || url.hash
		|| url.hostname.endsWith('.')
		|| (!local && (url.protocol !== 'https:' || privateHost(url.hostname)))) invalid();
	return url.origin;
}

function privateHost(hostname: string): boolean {
	return !hostname.includes('.') || /^[\d.]+$/u.test(hostname) || hostname.includes(':')
		|| /(?:^|\.)(?:localhost|local|internal|test)$/u.test(hostname) || hostname === 'metadata.google.internal';
}
function invalid(): never { throw new OAuthHttpError(400, 'invalid_provider', 'Enter a public HTTPS audio server origin.'); }
function mismatch(): never { throw new OAuthHttpError(401, 'authentication_required', 'Reconnect to the selected audio server to continue.'); }
function unavailable(): never { throw new OAuthHttpError(502, 'registration_failed', 'The selected audio server could not register Soundscaper.'); }
