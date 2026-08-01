/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { MAX_LIBRARY_PROJECT_ID_BYTES } from './project-library-contract.ts';

export const DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING = 'audio-f32le-chunks-v1' as const;
export const DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING = 'video-original-v1' as const;

export type DesktopLibraryManagedMediaEncoding =
	| typeof DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING
	| typeof DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING;

const BINDING_ID = /^[mv][a-f0-9]{64}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAXIMUM_STORAGE_KEY_BYTES = 4 * 1024;

export interface DesktopLibraryMediaBinding {
	readonly id: string;
	readonly relativeFile: string;
}

export function createDesktopLibraryMediaBinding(
	encoding: DesktopLibraryManagedMediaEncoding,
	projectId: string,
	storageKey: string,
	projectRevision: number,
	projectSha256: string,
): DesktopLibraryMediaBinding {
	const mediaEncoding = managedMediaEncoding(encoding);
	const projectIdentity = boundedIdentity(
		projectId,
		'Desktop library managed-media project identity',
		MAX_LIBRARY_PROJECT_ID_BYTES,
	);
	const sourceStorageKey = boundedIdentity(
		storageKey,
		'Desktop library managed-media storage key',
		MAXIMUM_STORAGE_KEY_BYTES,
	);
	const revision = nonNegativeSafeInteger(
		projectRevision,
		'Desktop library managed-media project revision',
	);
	if (typeof projectSha256 !== 'string' || !DIGEST.test(projectSha256)) {
		throw new TypeError('Desktop library managed-media project digest is invalid');
	}
	const digest = createHash('sha256')
		.update(JSON.stringify([
			mediaEncoding,
			projectIdentity,
			revision,
			projectSha256,
			sourceStorageKey,
		]), 'utf8')
		.digest('hex');
	const id = `${mediaEncoding === DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING ? 'm' : 'v'}${digest}`;
	return Object.freeze({ id, relativeFile: relativeFileForManagedMediaBinding(id) });
}

export function createDesktopLibraryAudioMediaBinding(
	projectId: string,
	storageKey: string,
	projectRevision: number,
	projectSha256: string,
): DesktopLibraryMediaBinding {
	return createDesktopLibraryMediaBinding(
		DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
		projectId,
		storageKey,
		projectRevision,
		projectSha256,
	);
}

export function createDesktopLibraryVideoMediaBinding(
	projectId: string,
	storageKey: string,
	projectRevision: number,
	projectSha256: string,
): DesktopLibraryMediaBinding {
	return createDesktopLibraryMediaBinding(
		DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
		projectId,
		storageKey,
		projectRevision,
		projectSha256,
	);
}

export function relativeFileForManagedMediaBinding(idValue: unknown): string {
	const id = validatedManagedMediaBindingId(idValue);
	return id.startsWith('m')
		? `audio/${id.slice(1, 3)}/${id}.f32c`
		: `video/${id.slice(1, 3)}/${id}.bin`;
}

export function managedMediaCategoryForBinding(idValue: unknown): 'audio' | 'video' {
	return validatedManagedMediaBindingId(idValue).startsWith('m') ? 'audio' : 'video';
}

export function isDesktopLibraryManagedMediaBindingId(value: unknown): value is string {
	return typeof value === 'string' && BINDING_ID.test(value);
}

export function validatedManagedMediaBindingId(value: unknown): string {
	if (!isDesktopLibraryManagedMediaBindingId(value)) {
		throw new TypeError('Desktop library managed-media binding id is invalid');
	}
	return value;
}

function managedMediaEncoding(value: unknown): DesktopLibraryManagedMediaEncoding {
	if (value !== DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING
		&& value !== DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING) {
		throw new TypeError('Desktop library managed-media encoding is unsupported');
	}
	return value;
}

function boundedIdentity(value: unknown, label: string, maximumBytes: number): string {
	if (typeof value !== 'string' || value.length === 0 || !value.trim()) {
		throw new TypeError(`${label} must be a non-empty string`);
	}
	if (Buffer.byteLength(value, 'utf8') > maximumBytes) throw new RangeError(`${label} exceeds its byte limit`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Desktop library ${label} must be a non-negative safe integer`);
	}
	return value;
}
