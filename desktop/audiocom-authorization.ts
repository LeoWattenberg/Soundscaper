/* SPDX-License-Identifier: AGPL-3.0-only */

const OAUTH_PARAMETERS = ['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'code_challenge', 'code_challenge_method'];

export interface AudiocomExternalProvider {
	readonly kind: 'audiocity';
	readonly apiOrigin: string;
	readonly webOrigin: string;
	readonly scope: 'public' | 'public projects';
}
export interface AudiocomExternalConfiguration {
	readonly backendOrigin: string;
	readonly provider: AudiocomExternalProvider;
}

/** A custom provider is accepted only from the main process's trusted backend. */
export function assertAudiocomExternalProvider(value: unknown, backendOrigin: string): AudiocomExternalProvider {
	if (!value || typeof value !== 'object') throw new TypeError('Invalid audio provider configuration');
	const provider = value as Record<string, unknown>;
	const backend = configuredOrigin(backendOrigin, true);
	const allowLocal = backend.protocol === 'http:' && isLoopback(backend);
	if (provider.kind !== 'audiocity' || (provider.scope !== 'public' && provider.scope !== 'public projects')
		|| typeof provider.apiOrigin !== 'string' || typeof provider.webOrigin !== 'string'
		|| provider.apiOrigin !== provider.webOrigin) throw new TypeError('Invalid audio provider configuration');
	configuredOrigin(provider.apiOrigin, allowLocal);
	if (provider.authorizationOrigin !== undefined && provider.authorizationOrigin !== provider.apiOrigin) throw new TypeError('Invalid audio provider configuration');
	return { kind: 'audiocity', apiOrigin: provider.apiOrigin, webOrigin: provider.webOrigin, scope: provider.scope };
}

/** The renderer chooses an origin, while the fixed backend retains network admission. */
export function assertAudiocomSelectedApiOrigin(value: string, backendOrigin: string): string {
	const backend = configuredOrigin(backendOrigin, true);
	return configuredOrigin(value, backend.protocol === 'http:' && isLoopback(backend)).origin;
}

export function assertAudiocomAuthorizationUrl(value: unknown, configuration?: AudiocomExternalConfiguration): string {
	try {
		if (typeof value !== 'string' || value.length > 4096) throw new TypeError();
		const provider = configuration ? assertAudiocomExternalProvider(configuration.provider, configuration.backendOrigin) : null;
		const authorizationOrigin = provider?.apiOrigin ?? 'https://api.audio.com';
		const callbackOrigin = configuration?.backendOrigin ?? 'https://soundscaper.org';
		const url = new URL(value);
		if (`${url.origin}${url.pathname}` !== `${authorizationOrigin}/auth/authorize`
			|| url.username || url.password || url.hash
			|| [...url.searchParams.keys()].some((key) => !OAUTH_PARAMETERS.includes(key))
			|| OAUTH_PARAMETERS.some((key) => url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key))
			|| url.searchParams.get('response_type') !== 'code' || url.searchParams.get('scope') !== (provider?.scope ?? 'public')
			|| url.searchParams.get('redirect_uri') !== `${callbackOrigin}/api/audiocom/oauth/callback`
			|| url.searchParams.get('code_challenge_method') !== 'S256'
			|| !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('code_challenge') ?? '')) throw new TypeError();
		return url.href;
	} catch { throw new TypeError('Invalid audio.com authorization URL'); }
}

function configuredOrigin(value: string, allowLocal: boolean): URL {
	const url = new URL(value);
	if (value !== url.origin || url.username || url.password
		|| (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && isLoopback(url)))) throw new TypeError('Invalid audio provider origin');
	return url;
}
function isLoopback(url: URL): boolean { return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); }
