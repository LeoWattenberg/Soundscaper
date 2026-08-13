/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

export const FRAMESCAPER_DESKTOP_LIBRARY_PROXY_MEDIA_ENCODING = 'video-proxy-v1' as const;

const BINDING_ID = /^p[a-f0-9]{64}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAXIMUM_IDENTITY_BYTES = 4 * 1024;

export interface FramescaperDesktopLibraryProxyMediaBinding {
	readonly id: string;
	readonly relativeFile: string;
	readonly category: 'proxy';
}

export function createFramescaperDesktopLibraryProxyMediaBinding(
	projectId: string,
	storageKey: string,
	projectRevision: number,
	projectSha256: string,
): Readonly<FramescaperDesktopLibraryProxyMediaBinding> {
	const projectIdentity = boundedIdentity(
		projectId,
		'Framescaper desktop V10 proxy project identity',
	);
	const proxyStorageKey = boundedIdentity(
		storageKey,
		'Framescaper desktop V10 proxy storage key',
	);
	const revision = nonNegativeSafeInteger(projectRevision);
	if (typeof projectSha256 !== 'string' || !DIGEST.test(projectSha256)) {
		throw new TypeError('Framescaper desktop V10 proxy project digest is invalid');
	}
	const digest = createHash('sha256')
		.update(JSON.stringify([
			FRAMESCAPER_DESKTOP_LIBRARY_PROXY_MEDIA_ENCODING,
			projectIdentity,
			revision,
			projectSha256,
			proxyStorageKey,
		]), 'utf8')
		.digest('hex');
	const id = `p${digest}`;
	return Object.freeze({
		id,
		relativeFile: proxyRelativeFileForFramescaperDesktopLibraryBinding(id),
		category: 'proxy',
	});
}

export function isFramescaperDesktopLibraryProxyMediaBindingId(
	value: unknown,
): value is string {
	return typeof value === 'string' && BINDING_ID.test(value);
}

export function proxyRelativeFileForFramescaperDesktopLibraryBinding(
	value: unknown,
): string {
	if (!isFramescaperDesktopLibraryProxyMediaBindingId(value)) {
		throw new TypeError('Framescaper desktop V10 proxy binding id is invalid');
	}
	return `proxy/${value.slice(1, 3)}/${value}.bin`;
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
		throw new RangeError('Framescaper desktop V10 proxy revision must be a non-negative safe integer');
	}
	return value;
}
