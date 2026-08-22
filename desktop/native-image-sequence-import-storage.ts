/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, open, type FileHandle } from 'node:fs/promises';

import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES,
} from '../src/common/editor/native-media-image-sequence-pack-v25.ts';
import type {
	NativeMediaImageSequenceInventoryReferenceV25,
	NativeMediaImageSequenceSourcePackReferenceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';

export type NativeImageSequenceDurableReference =
	| NativeMediaImageSequenceSourcePackReferenceV25
	| NativeMediaImageSequenceInventoryReferenceV25;

const SHA256 = /^[a-f0-9]{64}$/u;

export function referenceFromImageSequenceStorageKey(storageKey: string): NativeImageSequenceDurableReference {
	const [prefix, digest, extra] = storageKey.split(':');
	if (extra !== undefined || !SHA256.test(digest ?? '')) throw new TypeError('The project body storage key is invalid.');
	if (prefix === 'image-sequence-pack-sha256') return { kind: 'image-sequence-source-pack', storageKey, sha256: digest!, byteLength: 0 };
	if (prefix === 'image-sequence-inventory-sha256') return { kind: 'image-sequence-inventory', version: 1, storageKey, sha256: digest!, byteLength: 0, frameCount: 1, firstFrameNumber: 0, lastFrameNumber: 0 };
	throw new TypeError('The project body storage kind is unsupported.');
}

export async function assertImageSequenceReferenceFile(
	path: string,
	reference: NativeImageSequenceDurableReference,
): Promise<void> {
	await assertImageSequenceRegularFile(path);
	const actual = await digestImageSequencePath(path);
	if (actual.length !== reference.byteLength || actual.digest !== reference.sha256) {
		throw new Error('An existing durable asset fails exact authentication.');
	}
}

export async function assertImageSequenceReferenceHandle(
	handle: FileHandle,
	reference: NativeImageSequenceDurableReference,
): Promise<void> {
	const value = await handle.stat();
	if (!value.isFile() || value.size !== reference.byteLength) {
		throw new Error('The durable source pack changed during admission.');
	}
}

export async function assertImageSequenceRegularFile(path: string): Promise<void> {
	const value = await lstat(path);
	if (!value.isFile() || value.isSymbolicLink()) {
		throw new Error('A durable image-sequence asset is not a regular file.');
	}
}

export async function digestImageSequencePath(
	path: string,
): Promise<Readonly<{ digest: string; length: number }>> {
	const handle = await open(path, 'r');
	const digest = createHash('sha256');
	let offset = 0;
	try {
		const value = await handle.stat();
		if (!value.isFile()) throw new Error('The durable image-sequence asset is not regular.');
		while (offset < value.size) {
			const bytes = new Uint8Array(Math.min(
				NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES, value.size - offset,
			));
			const result = await handle.read(bytes, 0, bytes.byteLength, offset);
			if (result.bytesRead !== bytes.byteLength) throw new Error('The durable image-sequence read was short.');
			digest.update(bytes);
			offset += bytes.byteLength;
		}
		return Object.freeze({ digest: digest.digest('hex'), length: value.size });
	} finally { await handle.close(); }
}

export async function readImageSequenceRange(
	handle: FileHandle,
	offset: number,
	length: number,
): Promise<Uint8Array> {
	const bytes = new Uint8Array(length);
	const result = await handle.read(bytes, 0, length, offset);
	if (result.bytesRead !== length) throw new Error('The durable source-pack range read was short.');
	return bytes;
}

export function imageSequenceStorageSha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function imageSequenceFsErrorHasCode(error: unknown, code: string): boolean {
	return !!error && typeof error === 'object'
		&& (error as Readonly<{ code?: unknown }>).code === code;
}
