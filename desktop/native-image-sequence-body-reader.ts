/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticates immutable published image-sequence bodies once per filesystem identity. */

import { lstat, open } from 'node:fs/promises';

import {
	digestImageSequencePath, readImageSequenceRange,
} from './native-image-sequence-import-storage.ts';

interface FileIdentity {
	readonly dev: number;
	readonly ino: number;
	readonly size: number;
	readonly mtimeMs: number;
	readonly ctimeMs: number;
}

type Authenticate = (
	path: string,
) => Promise<Readonly<{ readonly digest: string; readonly length: number }>>;

export class NativeImageSequenceVerifiedBodyReader {
	readonly #authenticate: Authenticate;
	readonly #verified = new Map<string, Readonly<FileIdentity>>();

	constructor(authenticate: Authenticate = digestImageSequencePath) {
		this.#authenticate = authenticate;
	}

	async read(
		path: string, sha256: string, offset: number, length: number, maximumLength: number,
	): Promise<Uint8Array> {
		const before = await identity(path);
		let verified = this.#verified.get(path);
		if (!verified || !sameIdentity(verified, before)) {
			const actual = await this.#authenticate(path);
			const after = await identity(path);
			if (!sameIdentity(before, after) || actual.length !== after.size
				|| actual.digest !== sha256) {
				throw new Error('The project body changed after publication.');
			}
			verified = after;
			this.#verified.set(path, verified);
		}
		if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
			|| offset < 0 || length < 1 || length > maximumLength
			|| offset + length > verified.size) {
			throw new RangeError('The project-body read is outside its bounded published asset.');
		}
		const handle = await open(path, 'r');
		try {
			const current = identityFromStat(await handle.stat());
			if (!sameIdentity(verified, current)) {
				this.#verified.delete(path);
				throw new Error('The project body changed after publication.');
			}
			return readImageSequenceRange(handle, offset, length);
		} finally { await handle.close(); }
	}
}

async function identity(path: string): Promise<Readonly<FileIdentity>> {
	const value = await lstat(path);
	if (!value.isFile() || value.isSymbolicLink()) {
		throw new Error('A durable image-sequence asset is not a regular file.');
	}
	return identityFromStat(value);
}

function identityFromStat(value: Readonly<FileIdentity>): Readonly<FileIdentity> {
	return Object.freeze({
		dev: value.dev, ino: value.ino, size: value.size,
		mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs,
	});
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
	return left.dev === right.dev && left.ino === right.ino && left.size === right.size
		&& left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
