/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopReadFetch } from './desktop-read-materialization.ts';
import {
	DESKTOP_READ_PROFILE_LINKED_AUDIO_RANGE,
	assertDesktopLinkedAudioReadProfile,
} from './desktop-read-profile.ts';
import {
	readDesktopLinkedOriginalRange,
	type DesktopLinkedOriginalRangeRequest,
} from './storage/desktop-linked-original-range-reader.ts';

export interface DesktopLinkedAudioRangeLease {
	readonly locatorRevision: string;
	readonly byteLength: number;
	readonly mimeType: 'audio/aiff' | 'audio/rf64' | 'audio/wav';
	readRange(request: DesktopLinkedOriginalRangeRequest): Promise<Uint8Array>;
	release(): Promise<void>;
}

export type DesktopReadRelease = (id: string) => PromiseLike<unknown> | unknown;

interface AudioRangeDescriptor {
	readonly id: string;
	readonly url: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: 'audio/aiff' | 'audio/rf64' | 'audio/wav';
	readonly readProfile: typeof DESKTOP_READ_PROFILE_LINKED_AUDIO_RANGE;
	readonly lastModified: number;
}

const LOAD_FIELDS = Object.freeze(['locatorRevision', 'descriptor']);
const DESCRIPTOR_FIELDS = Object.freeze([
	'id', 'url', 'name', 'size', 'mimeType', 'readProfile', 'lastModified',
]);

/** Validate one main-owned audio range response and transfer cleanup to its lease. */
export async function admitDesktopLinkedAudioRange(
	value: unknown,
	expectedRevision: string,
	options: Readonly<{
		fetch: DesktopReadFetch;
		releaseRead: DesktopReadRelease;
		signal?: AbortSignal;
	}>,
): Promise<DesktopLinkedAudioRangeLease> {
	const cleanupId = possibleReadId(value);
	let lease: DesktopLinkedAudioRangeLease | null = null;
	try {
		const response = closedRecord(value, LOAD_FIELDS, 'Linked-audio range response');
		const locatorRevision = locatorToken(response.locatorRevision, 'locator revision');
		if (locatorRevision !== expectedRevision) {
			throw new Error('The linked-audio range locator revision changed during admission.');
		}
		const descriptor = audioRangeDescriptor(response.descriptor);
		lease = audioRangeLease(descriptor, locatorRevision, options.fetch, options.releaseRead);
		throwIfAborted(options.signal);
		return lease;
	} catch (error) {
		return cleanupAdmission(error, lease, cleanupId, options.releaseRead);
	}
}

function audioRangeDescriptor(value: unknown): AudioRangeDescriptor {
	const candidate = closedRecord(value, DESCRIPTOR_FIELDS, 'Linked-audio range descriptor');
	assertDesktopLinkedAudioReadProfile(candidate);
	const id = readToken(candidate.id, 'identifier');
	const name = String(candidate.name);
	const mimeType = candidate.mimeType as AudioRangeDescriptor['mimeType'];
	const url = linkedAudioRangeUrl(candidate.url, { id, name });
	if (!Number.isSafeInteger(candidate.lastModified) || Number(candidate.lastModified) < 0) {
		throw new RangeError('Linked-audio range modification time is invalid.');
	}
	return Object.freeze({
		id,
		url,
		name,
		size: Number(candidate.size),
		mimeType,
		readProfile: DESKTOP_READ_PROFILE_LINKED_AUDIO_RANGE,
		lastModified: Number(candidate.lastModified),
	});
}

function audioRangeLease(
	descriptor: AudioRangeDescriptor,
	locatorRevision: string,
	fetchRange: DesktopReadFetch,
	releaseRead: DesktopReadRelease,
): DesktopLinkedAudioRangeLease {
	let releasePromise: Promise<void> | null = null;
	const release = (): Promise<void> => {
		releasePromise ??= Promise.resolve().then(() => releaseRead(descriptor.id)).then((result) => {
			if (result !== true && result !== false) {
				throw new TypeError('Linked-audio range release returned an invalid result.');
			}
		});
		return releasePromise;
	};
	return Object.freeze({
		locatorRevision,
		byteLength: descriptor.size,
		mimeType: descriptor.mimeType,
		readRange(request: DesktopLinkedOriginalRangeRequest) {
			if (releasePromise) {
				return Promise.reject(new Error('The linked-audio range lease was released.'));
			}
			return readDesktopLinkedOriginalRange(descriptor, request, fetchRange, 'audio');
		},
		release,
	});
}

async function cleanupAdmission(
	error: unknown,
	lease: DesktopLinkedAudioRangeLease | null,
	readId: string | null,
	releaseRead: DesktopReadRelease,
): Promise<never> {
	try {
		if (lease) await lease.release();
		else if (readId) {
			const result = await releaseRead(readId);
			if (result !== true && result !== false) {
				throw new TypeError('Linked-audio range cleanup returned an invalid result.');
			}
		}
	} catch (cleanupError) {
		throw new AggregateError(
			[error, cleanupError],
			'Linked-audio range admission and cleanup both failed.',
			{ cause: cleanupError },
		);
	}
	throw error;
}

function possibleReadId(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const response = value as Readonly<Record<string, unknown>>;
	const descriptorProperty = Object.getOwnPropertyDescriptor(response, 'descriptor');
	const descriptor = descriptorProperty?.value;
	if (!descriptorProperty?.enumerable || !Object.hasOwn(descriptorProperty, 'value')
		|| !descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return null;
	const idProperty = Object.getOwnPropertyDescriptor(descriptor, 'id');
	return idProperty?.enumerable && Object.hasOwn(idProperty, 'value')
		&& typeof idProperty.value === 'string' && /^[a-f0-9]{64}$/u.test(idProperty.value)
		? idProperty.value
		: null;
}

function linkedAudioRangeUrl(
	value: unknown,
	descriptor: Readonly<{ id: string; name: string }>,
): string {
	let url: URL;
	try { url = new URL(String(value ?? '')); } catch {
		throw new TypeError('Linked-audio range capability URL is invalid.');
	}
	const expectedPath = `/_desktop/read/${DESKTOP_READ_PROFILE_LINKED_AUDIO_RANGE}/${descriptor.id}/${encodeURIComponent(descriptor.name)}`;
	if (!['soundscaper-app:', 'framescaper-app:'].includes(url.protocol)
		|| url.hostname !== 'bundle' || url.port || url.username || url.password
		|| url.search || url.hash || url.pathname !== expectedPath) {
		throw new TypeError('Linked-audio range capability URL is invalid.');
	}
	return url.href;
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} contains an unsupported field.`);
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function locatorToken(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`Linked-audio ${label} is invalid.`);
	}
	return value;
}

function readToken(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`Linked-audio range ${label} is invalid.`);
	}
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Linked-audio range admission cancelled.', 'AbortError');
	const error = new Error('Linked-audio range admission cancelled.');
	error.name = 'AbortError';
	throw error;
}
