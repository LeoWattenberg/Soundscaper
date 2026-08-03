/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_READ_PROFILE_LINKED_AUDIO_RANGE = 'linked-audio-range-v1';
export const DESKTOP_READ_PROFILE_LINKED_VIDEO_RANGE = 'linked-video-range-v1';
export const DESKTOP_READ_PROFILE_MATERIALIZED = 'materialized-v1';
export const DESKTOP_READ_PROFILE_SCAPE_RANGE = 'scape-range-v1';
export const DESKTOP_SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
export const DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES = 65 * 1024 ** 3;

export type DesktopReadProfile =
	| typeof DESKTOP_READ_PROFILE_LINKED_AUDIO_RANGE
	| typeof DESKTOP_READ_PROFILE_LINKED_VIDEO_RANGE
	| typeof DESKTOP_READ_PROFILE_MATERIALIZED
	| typeof DESKTOP_READ_PROFILE_SCAPE_RANGE;

export interface DesktopReadProfileDescriptor {
	readonly readProfile?: unknown;
	readonly name?: unknown;
	readonly mimeType?: unknown;
	readonly size?: unknown;
}

export function isDesktopReadProfile(value: unknown): value is DesktopReadProfile {
	return value === DESKTOP_READ_PROFILE_LINKED_AUDIO_RANGE
		|| value === DESKTOP_READ_PROFILE_LINKED_VIDEO_RANGE
		|| value === DESKTOP_READ_PROFILE_MATERIALIZED
		|| value === DESKTOP_READ_PROFILE_SCAPE_RANGE;
}

export function assertDesktopLinkedAudioReadProfile(
	descriptor: DesktopReadProfileDescriptor,
): void {
	if (descriptor?.readProfile !== DESKTOP_READ_PROFILE_LINKED_AUDIO_RANGE
		|| typeof descriptor.name !== 'string'
		|| !descriptor.name || descriptor.name !== descriptor.name.trim()
		|| descriptor.name.length > 255 || descriptor.name === '.' || descriptor.name === '..'
		|| descriptor.name.includes('/') || descriptor.name.includes('\\')
		|| /[\u0000-\u001f]/u.test(descriptor.name)) {
		throw new TypeError('A canonical linked-audio desktop read profile is required.');
	}
	const wav = /\.wav$/iu.test(descriptor.name) && descriptor.mimeType === 'audio/wav';
	const rf64 = /\.rf64$/iu.test(descriptor.name) && descriptor.mimeType === 'audio/rf64';
	const aiff = /\.aiff?$/iu.test(descriptor.name) && descriptor.mimeType === 'audio/aiff';
	if (!wav && !rf64 && !aiff) {
		throw new TypeError('A linked-audio range descriptor requires an exact WAV, RF64, or AIFF MIME/name pair.');
	}
	if (!Number.isSafeInteger(descriptor.size) || (descriptor.size as number) < 1
		|| (descriptor.size as number) > 512 * 1024 ** 2) {
		throw new RangeError('The linked-audio desktop read size is outside its admitted range.');
	}
}

export function assertDesktopLinkedVideoReadProfile(
	descriptor: DesktopReadProfileDescriptor,
): void {
	if (descriptor?.readProfile !== DESKTOP_READ_PROFILE_LINKED_VIDEO_RANGE
		|| typeof descriptor.mimeType !== 'string'
		|| !/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(descriptor.mimeType)
		|| isScapeName(descriptor.name)) {
		throw new TypeError('A canonical linked-video desktop read profile is required.');
	}
	if (!Number.isSafeInteger(descriptor.size) || (descriptor.size as number) < 1
		|| (descriptor.size as number) > 512 * 1024 ** 2) {
		throw new RangeError('The linked-video desktop read size is outside its admitted range.');
	}
}

export function assertDesktopMaterializedReadProfile(
	descriptor: DesktopReadProfileDescriptor,
): void {
	if (descriptor?.readProfile !== DESKTOP_READ_PROFILE_MATERIALIZED) {
		throw new TypeError('A materialized desktop read profile is required.');
	}
	if (isScapeName(descriptor.name) || descriptor.mimeType === DESKTOP_SCAPE_MIME_TYPE) {
		throw new TypeError('A Scape descriptor cannot use the materialized desktop read profile.');
	}
}

export function assertDesktopScapeReadProfile(
	descriptor: DesktopReadProfileDescriptor,
	maximumBytes: number,
): void {
	if (descriptor?.readProfile !== DESKTOP_READ_PROFILE_SCAPE_RANGE
		|| !isScapeName(descriptor.name)
		|| descriptor.mimeType !== DESKTOP_SCAPE_MIME_TYPE) {
		throw new TypeError('A canonical desktop Scape range read profile is required.');
	}
	if (!Number.isSafeInteger(descriptor.size) || (descriptor.size as number) < 0) {
		throw new RangeError('The desktop Scape read size must be a non-negative safe integer.');
	}
	if ((descriptor.size as number) > maximumBytes) {
		throw new RangeError('The desktop Scape read exceeds its admitted maximum.');
	}
}

export function desktopScapeReadMaximum(value: unknown): number {
	if (value === undefined) return DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES;
	if (typeof value !== 'number' || !Number.isSafeInteger(value)
		|| value < 0 || value > DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES) {
		throw new RangeError('The desktop Scape read maximum must not exceed its hard limit.');
	}
	return value;
}

function isScapeName(value: unknown): boolean {
	return typeof value === 'string' && /\.scape$/iu.test(value);
}
