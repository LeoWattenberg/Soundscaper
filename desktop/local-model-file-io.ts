/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared streaming digest and durable path sync for local model custody. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

export function isLocalModelDirectorySyncErrorBenign(error: unknown): boolean {
	const code = typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: '';
	return ['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(code);
}

export async function digestLocalModelFile(path: string, signal?: AbortSignal): Promise<string> {
	const digest = createHash('sha256');
	for await (const chunk of createReadStream(path, signal ? { signal } : undefined)) {
		signal?.throwIfAborted();
		digest.update(chunk as Uint8Array);
	}
	signal?.throwIfAborted();
	return digest.digest('hex');
}

export async function syncLocalModelPath(path: string): Promise<void> {
	let handle = null;
	try {
		handle = await open(path, 'r');
		await handle.sync();
	} catch (error) {
		if (!isLocalModelDirectorySyncErrorBenign(error)) throw error;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}
