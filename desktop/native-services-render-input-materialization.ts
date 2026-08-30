/* SPDX-License-Identifier: AGPL-3.0-only */

/** Abort-aware copy and authentication of durable renderer inputs into helper scratch. */

import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { HelperNativeInputGrant } from './helper-native-job-contract.ts';
import type { NativeRenderInputStagedFile } from './native-services-render-input-manifest.ts';
import { nativeRenderInputFileIdentity } from './native-services-render-input-validation.ts';

const COPY_CHUNK_BYTES = 1024 * 1024;

export async function materializeNativeRenderInputFiles(options: Readonly<{
	readonly sourceDirectory: string;
	readonly targetDirectory: string;
	readonly files: readonly NativeRenderInputStagedFile[];
	readonly signal?: AbortSignal;
}>): Promise<readonly HelperNativeInputGrant[]> {
	options.signal?.throwIfAborted();
	const grants: HelperNativeInputGrant[] = [];
	for (const [index, file] of options.files.entries()) {
		options.signal?.throwIfAborted();
		if (basename(file.name) !== file.name) {
			throw new Error('A durable native render input has an invalid file name.');
		}
		const source = join(options.sourceDirectory, file.name);
		const path = join(options.targetDirectory,
			`derived-${String(index).padStart(2, '0')}${file.role === 'staged-audio-mix' ? '.wav' : '.frames'}`);
		await copyAuthenticatedFile(source, path, file, options.signal);
		grants.push(Object.freeze({
			type: 'file', role: file.role, path, bytes: file.byteLength,
			sha256: file.sha256, identity: await nativeRenderInputFileIdentity(path),
		}));
	}
	return Object.freeze(grants);
}

async function copyAuthenticatedFile(
	source: string,
	target: string,
	file: NativeRenderInputStagedFile,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	const sourceHandle = await open(source, 'r');
	let targetHandle: Awaited<ReturnType<typeof open>> | null = null;
	let created = false;
	let completed = false;
	try {
		targetHandle = await open(target, 'wx', 0o600);
		created = true;
		const details = await sourceHandle.stat();
		if (!details.isFile() || details.size !== file.byteLength
			|| details.dev !== file.identity.dev || details.ino !== file.identity.ino) {
			throw new Error('A durable native render input changed before materialization.');
		}
		signal?.throwIfAborted();
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(Math.min(COPY_CHUNK_BYTES, file.byteLength));
		let offset = 0;
		while (offset < file.byteLength) {
			signal?.throwIfAborted();
			const length = Math.min(buffer.byteLength, file.byteLength - offset);
			const read = await sourceHandle.read(buffer, 0, length, offset);
			if (read.bytesRead !== length) throw new Error('A durable native render input ended early.');
			signal?.throwIfAborted();
			const write = await targetHandle.write(buffer, 0, length, offset);
			if (write.bytesWritten !== length) throw new Error('A helper scratch copy ended early.');
			signal?.throwIfAborted();
			hash.update(buffer.subarray(0, length));
			offset += length;
		}
		if (hash.digest('hex') !== file.sha256) {
			throw new Error('A durable native render input changed digest during materialization.');
		}
		completed = true;
	} finally {
		await targetHandle?.close().catch(() => undefined);
		await sourceHandle.close().catch(() => undefined);
		if (created && !completed) await rm(target, { force: true }).catch(() => undefined);
	}
}
