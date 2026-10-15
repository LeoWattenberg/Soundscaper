/* SPDX-License-Identifier: AGPL-3.0-only */
import { OAuthHttpError, type AudiocomOAuthEnv } from './oauth-http.ts';

export interface AudiocomProviderConfiguration {
	readonly kind: 'audiocom' | 'audiocity';
	readonly apiOrigin: string;
	readonly webOrigin: string;
	readonly authorizationOrigin: string;
	readonly scope: 'public' | 'public projects';
}
export const DEFAULT_AUDIOCOM_PROVIDER: AudiocomProviderConfiguration = Object.freeze({
	kind: 'audiocom', apiOrigin: 'https://api.audio.com', webOrigin: 'https://audio.com',
	authorizationOrigin: 'https://api.audio.com', scope: 'public',
});
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Only deployment configuration chooses an alternate provider, never a request URL. */
export function providerConfiguration(env: AudiocomOAuthEnv): AudiocomProviderConfiguration {
	const kind = env.AUDIOCOM_PROVIDER?.trim() || 'audiocom';
	if (kind === 'audiocom' && !env.AUDIOCOM_API_ORIGIN?.trim()) return DEFAULT_AUDIOCOM_PROVIDER;
	if (kind !== 'audiocity' || !env.AUDIOCOM_API_ORIGIN?.trim()) configurationError();
	let url: URL;
	try { url = new URL(env.AUDIOCOM_API_ORIGIN.trim()); } catch { return configurationError(); }
	const local = env.AUDIOCOM_LOCAL_DEVELOPMENT === '1' && url.protocol === 'http:'
		&& ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) configurationError();
	return { kind: 'audiocity', apiOrigin: url.origin, webOrigin: url.origin, authorizationOrigin: url.origin, scope: 'public projects' };
}
export function trustedProviderUploadUrl(value: unknown, provider: AudiocomProviderConfiguration): URL {
	const url = providerUrl(value, provider);
	if (!new RegExp(`^/uploads/${UUID}$`, 'u').test(url.pathname) || !tokenQuery(url)) invalid();
	return url;
}
export function trustedProviderMediaUrl(value: unknown, provider: AudiocomProviderConfiguration): URL {
	const url = providerUrl(value, provider);
	if (!new RegExp(`^/media/${UUID}$`, 'u').test(url.pathname) || url.searchParams.size !== 2
		|| !/^[1-9]\d{0,12}$/u.test(url.searchParams.get('expires') ?? '')
		|| !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('signature') ?? '')) invalid();
	return url;
}
export function trustedProviderHookUrl(value: unknown, provider: AudiocomProviderConfiguration, kind: 'success' | 'fail' | 'progress'): URL {
	const url = providerUrl(value, provider);
	if (!new RegExp(`^/uploads/${UUID}/${kind}$`, 'u').test(url.pathname) || !tokenQuery(url)) invalid();
	return url;
}
function providerUrl(value: unknown, provider: AudiocomProviderConfiguration): URL {
	if (provider.kind !== 'audiocity' || typeof value !== 'string' || value.length > 8192) invalid();
	let url: URL;
	try { url = new URL(value); } catch { return invalid(); }
	if (url.origin !== provider.apiOrigin || url.username || url.password || url.hash) invalid();
	return url;
}
function tokenQuery(url: URL): boolean {
	return url.searchParams.size === 1 && /^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('token') ?? '');
}
function configurationError(): never {
	throw new OAuthHttpError(503, 'service_unavailable', 'The audio provider origin is not configured correctly.');
}
function invalid(): never {
	throw new OAuthHttpError(502, 'invalid_upstream_response', 'The audio provider returned an invalid transfer destination.');
}
