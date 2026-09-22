/* SPDX-License-Identifier: AGPL-3.0-only */

type WebLocation = Readonly<Pick<Location, 'origin' | 'protocol'>>;

function apiBaseUrl(location: WebLocation | undefined): string {
	return location && ['http:', 'https:'].includes(location.protocol)
		? location.origin
		: 'https://soundscaper.org';
}

function assertSoundId(soundId: number): void {
	if (!Number.isSafeInteger(soundId) || soundId <= 0) throw new TypeError('A valid Freesound sound ID is required.');
}

export function freesoundPreviewUrl(
	soundId: number,
	location: WebLocation | undefined = globalThis.location,
): string {
	assertSoundId(soundId);
	return new URL(`/api/freesound/sounds/${String(soundId)}/preview`, apiBaseUrl(location)).href;
}

export function freesoundWaveformUrl(
	soundId: number,
	path: string,
	location: WebLocation | undefined = globalThis.location,
): string {
	assertSoundId(soundId);
	const expectedPath = `/api/freesound/sounds/${String(soundId)}/waveform`;
	if (!path.startsWith(`${expectedPath}?`)) throw new TypeError('A valid Freesound waveform path is required.');
	const url = new URL(path, apiBaseUrl(location));
	if (url.pathname !== expectedPath || url.hash) throw new TypeError('A valid Freesound waveform path is required.');
	return url.href;
}
