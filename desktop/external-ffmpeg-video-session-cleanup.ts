/* SPDX-License-Identifier: AGPL-3.0-only */

/** Close retained output authority and remove private video-operation scratch. */

import { rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

export async function cleanupExternalFfmpegVideoSessionFiles(target: {
	output: FileHandle | null;
	readonly scratchDirectory: string;
}): Promise<void> {
	const failures: unknown[] = [];
	if (target.output) {
		try { await target.output.close(); target.output = null; }
		catch (error) { failures.push(error); }
	}
	await rm(target.scratchDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 })
		.catch((error: unknown) => { failures.push(error); });
	if (failures.length > 0) throw new AggregateError(failures, 'Desktop video session cleanup failed.');
}
