/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	APP_ORIGIN,
	READ_CAPABILITY_PREFIX,
	READ_PROFILE_LINKED_AUDIO_RANGE_V1,
	READ_PROFILE_LINKED_VIDEO_RANGE_V1,
} from './constants.js';
import { createReadCapabilityRangeStream } from './read-capability-range-stream.js';

export async function throwAfterReadCapabilityRollback(store, descriptors, owner, cause) {
	const results = await Promise.allSettled(
		descriptors.map((descriptor) => store.release(descriptor.id, { owner })),
	);
	const cleanupErrors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
	if (!cleanupErrors.length) throw cause;
	throw new AggregateError(
		[cause, ...cleanupErrors],
		'Read capability registration and rollback cleanup both failed',
		{ cause },
	);
}

export function requireReadCapabilityOwner(owner) {
	if ((typeof owner !== 'object' || owner === null) && typeof owner !== 'function') {
		throw new TypeError('Read capabilities require an opaque renderer owner');
	}
	return owner;
}

export function readCapabilityDescriptor(entry) {
	return Object.freeze({
		id: entry.id,
		url: `${APP_ORIGIN}${READ_CAPABILITY_PREFIX}${entry.readProfile}/${entry.id}/${encodeURIComponent(entry.name)}`,
		name: entry.name,
		size: entry.size,
		mimeType: entry.mimeType,
		readProfile: entry.readProfile,
		lastModified: entry.lastModified,
	});
}

export function createReadCapabilityStream(entry, options) {
	return isLinkedOriginalRangeProfile(entry.readProfile)
		? createReadCapabilityRangeStream(entry.handle, options)
		: entry.handle.createReadStream(options);
}

export function linkedOriginalRangeProfile(kind, mimeType, displayName) {
	if (kind === 'video' && typeof mimeType === 'string'
		&& /^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mimeType)) {
		return READ_PROFILE_LINKED_VIDEO_RANGE_V1;
	}
	if (kind === 'audio' && ((/\.wav$/iu.test(displayName) && mimeType === 'audio/wav')
		|| (/\.rf64$/iu.test(displayName) && mimeType === 'audio/rf64'))) {
		return READ_PROFILE_LINKED_AUDIO_RANGE_V1;
	}
	throw new TypeError('Linked-original range kind, MIME type, and name do not match');
}

export function isLinkedOriginalRangeProfile(value) {
	return value === READ_PROFILE_LINKED_AUDIO_RANGE_V1
		|| value === READ_PROFILE_LINKED_VIDEO_RANGE_V1;
}

export function cleanReadCapabilityDisplayName(value) {
	const name = [...String(value || 'file')]
		.map((character) => character === '/' || character === '\\' || character.codePointAt(0) <= 0x1f
			? '-' : character)
		.join('').slice(0, 255);
	return name || 'file';
}

export function safeReadCapabilityTimestamp(value) {
	const timestamp = Math.trunc(value);
	return Number.isSafeInteger(timestamp) ? Math.max(0, timestamp) : 0;
}

export function normalizeReadCapabilityFileIdentity(value) {
	const fields = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'];
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== fields.length) {
		throw new TypeError('A linked-original range capability requires an exact file identity');
	}
	const identity = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		const number = descriptor?.value;
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
			throw new TypeError('A linked-original range capability requires an exact file identity');
		}
		identity[field] = number;
	}
	if (!Number.isSafeInteger(identity.size)) {
		throw new TypeError('A linked-original range capability requires an exact file identity');
	}
	return Object.freeze(identity);
}

export function assertReadCapabilityFileIdentity(details, expected) {
	for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
		if (details?.[field] !== expected[field]) {
			throw new Error('The linked-original file changed before range admission');
		}
	}
}

export function readCapabilityRequestRetiredError() {
	const error = new Error('Desktop read capability request was retired');
	error.name = 'AbortError';
	return error;
}
