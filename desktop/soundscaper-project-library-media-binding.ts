/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

export const SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING = 'audio-f32le-chunks-v1' as const;
export const SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_MIME_TYPE =
	'application/vnd.soundscaper.audio-f32le-chunks' as const;

const BINDING_ID = /^f[a-f0-9]{64}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAXIMUM_IDENTITY_BYTES = 4 * 1024;

export interface SoundscaperDesktopLibraryFreezeMediaBinding {
	readonly id: string;
	readonly relativeFile: string;
	readonly category: 'audio-freeze';
}

export function createSoundscaperDesktopLibraryFreezeMediaBinding(
	sourceId: string,
	storageKey: string,
	byteLength: number,
	contentSha256: string,
): Readonly<SoundscaperDesktopLibraryFreezeMediaBinding> {
	const sourceIdentity = boundedIdentity(
		sourceId,
		'Soundscaper desktop baseline freeze source identity',
	);
	const freezeStorageKey = boundedIdentity(
		storageKey,
		'Soundscaper desktop baseline freeze storage key',
	);
	const length = positiveSafeInteger(byteLength);
	if (typeof contentSha256 !== 'string' || !DIGEST.test(contentSha256)) {
		throw new TypeError('Soundscaper desktop baseline freeze content digest is invalid');
	}
	const digest = createHash('sha256')
		.update(JSON.stringify([
			SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING,
			sourceIdentity,
			freezeStorageKey,
			length,
			contentSha256,
		]), 'utf8')
		.digest('hex');
	const id = `f${digest}`;
	return Object.freeze({
		id,
		relativeFile: freezeRelativeFileForSoundscaperDesktopLibraryBinding(id),
		category: 'audio-freeze',
	});
}

/** Read compatibility for freeze bodies published before content addressing. */
export function createLegacySoundscaperDesktopLibraryFreezeMediaBinding(
	projectId: string,
	storageKey: string,
	projectRevision: number,
	projectSha256: string,
): Readonly<SoundscaperDesktopLibraryFreezeMediaBinding> {
	const projectIdentity = boundedIdentity(
		projectId,
		'Soundscaper desktop baseline freeze project identity',
	);
	const freezeStorageKey = boundedIdentity(
		storageKey,
		'Soundscaper desktop baseline freeze storage key',
	);
	const revision = nonNegativeSafeInteger(projectRevision);
	if (typeof projectSha256 !== 'string' || !DIGEST.test(projectSha256)) {
		throw new TypeError('Soundscaper desktop baseline freeze project digest is invalid');
	}
	const digest = createHash('sha256')
		.update(JSON.stringify([
			SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING,
			projectIdentity,
			revision,
			projectSha256,
			freezeStorageKey,
		]), 'utf8')
		.digest('hex');
	const id = `f${digest}`;
	return Object.freeze({
		id,
		relativeFile: freezeRelativeFileForSoundscaperDesktopLibraryBinding(id),
		category: 'audio-freeze',
	});
}

export function isSoundscaperDesktopLibraryFreezeMediaBindingId(
	value: unknown,
): value is string {
	return typeof value === 'string' && BINDING_ID.test(value);
}

export function freezeRelativeFileForSoundscaperDesktopLibraryBinding(
	value: unknown,
): string {
	if (!isSoundscaperDesktopLibraryFreezeMediaBindingId(value)) {
		throw new TypeError('Soundscaper desktop baseline freeze binding id is invalid');
	}
	return `freeze/${value.slice(1, 3)}/${value}.scaf`;
}

function boundedIdentity(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0 || !value.trim()) {
		throw new TypeError(`${name} must be a non-empty string`);
	}
	if (Buffer.byteLength(value, 'utf8') > MAXIMUM_IDENTITY_BYTES) {
		throw new RangeError(`${name} exceeds its byte limit`);
	}
	return value;
}

function nonNegativeSafeInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('Soundscaper desktop baseline freeze revision must be a non-negative safe integer');
	}
	return value;
}

function positiveSafeInteger(value: unknown): number {
	const result = nonNegativeSafeInteger(value);
	if (result === 0) throw new RangeError('Soundscaper desktop baseline freeze byte length must be positive');
	return result;
}
