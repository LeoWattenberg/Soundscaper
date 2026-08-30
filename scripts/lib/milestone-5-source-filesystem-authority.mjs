/* SPDX-License-Identifier: AGPL-3.0-only */

/** Race-resistant file and directory authority for Milestone 5 source inputs. */

import { createHash } from 'node:crypto';
import {
	closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export function authenticateMilestone5SourceArchive(pathValue, expected, sourceId) {
	const path = canonicalMilestone5SourceFile(pathValue, `${sourceId} source archive`);
	const before = lstatSync(path);
	if (before.size !== expected.byteLength) {
		throw new Error(`${sourceId}: source archive byte length drifted from its pin.`);
	}
	const handle = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = fstatSync(handle);
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error(`${sourceId}: source archive changed while opening.`);
		}
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		const chunks = [];
		let byteLength = 0;
		for (;;) {
			const bytesRead = readSync(handle, buffer, 0, buffer.byteLength, null);
			if (bytesRead === 0) break;
			byteLength += bytesRead;
			if (byteLength > expected.byteLength) {
				throw new Error(`${sourceId}: source archive exceeds its pinned byte length.`);
			}
			hash.update(buffer.subarray(0, bytesRead));
			chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
		}
		const after = fstatSync(handle);
		const sha256 = hash.digest('hex');
		if (byteLength !== expected.byteLength || sha256 !== expected.sha256
			|| after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
			|| after.ctimeMs !== opened.ctimeMs) {
			throw new Error(`${sourceId}: source archive bytes drifted from their pin.`);
		}
		return {
			descriptor: Object.freeze({ path, byteLength, sha256 }),
			bytes: Buffer.concat(chunks, byteLength),
		};
	} finally { closeSync(handle); }
}

export function canonicalMilestone5SourceDirectory(value, label) {
	return canonicalSourcePath(value, label, 'directory');
}

function canonicalMilestone5SourceFile(value, label) {
	return canonicalSourcePath(value, label, 'file');
}

function canonicalSourcePath(value, label, kind) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`${label} must be an absolute normalized path.`);
	}
	const metadata = lstatSync(value);
	const admitted = kind === 'file' ? metadata.isFile() : metadata.isDirectory();
	if (!admitted || metadata.isSymbolicLink() || realpathSync(value) !== value) {
		throw new Error(`${label} must be one canonical regular non-symbolic ${kind}.`);
	}
	return value;
}
