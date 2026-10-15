/* SPDX-License-Identifier: AGPL-3.0-only */

export interface AudiocomProvider {
	readonly kind: 'audiocom' | 'audiocity';
	readonly apiOrigin: string;
	readonly webOrigin: string;
	readonly scope: 'public' | 'public projects';
}

export const DEFAULT_AUDIOCOM_PROVIDER: AudiocomProvider = Object.freeze({
	kind: 'audiocom', apiOrigin: 'https://api.audio.com', webOrigin: 'https://audio.com', scope: 'public',
});

/** Provider origins come only from the editor's own configured backend. */
export function audiocomProvider(value: unknown, location?: Pick<Location, 'origin' | 'protocol'>): AudiocomProvider {
	if (value === undefined) return DEFAULT_AUDIOCOM_PROVIDER;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid audio provider configuration.');
	const source = value as Record<string, unknown>;
	if (source.kind === 'audiocom' && source.apiOrigin === DEFAULT_AUDIOCOM_PROVIDER.apiOrigin
		&& source.webOrigin === DEFAULT_AUDIOCOM_PROVIDER.webOrigin && source.scope === 'public') return DEFAULT_AUDIOCOM_PROVIDER;
	if (source.kind !== 'audiocity' || source.apiOrigin !== source.webOrigin
		|| (source.scope !== 'public' && source.scope !== 'public projects')) throw new Error('Invalid audio provider configuration.');
	const origin = providerOrigin(source.apiOrigin, location);
	return Object.freeze({ kind: 'audiocity', apiOrigin: origin, webOrigin: origin, scope: source.scope });
}

function providerOrigin(value: unknown, location?: Pick<Location, 'origin' | 'protocol'>): string {
	if (typeof value !== 'string') throw new Error('Invalid audio provider origin.');
	const url = new URL(value);
	const localEditor = location?.protocol === 'soundscaper-app:' || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(location?.origin ?? '');
	const localProvider = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && localEditor;
	if ((!localProvider && url.protocol !== 'https:') || url.origin !== value || url.username || url.password) throw new Error('Invalid audio provider origin.');
	return url.origin;
}
