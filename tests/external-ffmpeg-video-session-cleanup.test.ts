/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { cleanupExternalFfmpegVideoSessionFiles } from '../desktop/external-ffmpeg-video-session-cleanup.ts';

test('video session cleanup still removes scratch when retained output close fails', async () => {
	const scratchDirectory = await mkdtemp(join(tmpdir(), 'soundscaper-video-cleanup-'));
	const closeFailure = new Error('close failed');
	const target = {
		output: { close: async () => { throw closeFailure; } } as unknown as FileHandle,
		scratchDirectory,
	};
	try {
		await assert.rejects(cleanupExternalFfmpegVideoSessionFiles(target), (error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.strictEqual(error.errors[0], closeFailure);
			return true;
		});
		await assert.rejects(access(scratchDirectory), /ENOENT/u);
	} finally {
		await rm(scratchDirectory, { recursive: true, force: true });
	}
});
