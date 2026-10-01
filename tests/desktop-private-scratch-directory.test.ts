/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { createPrivateScratchDirectory } from '../desktop/private-scratch-directory.ts';
import { withOwnedPrivateScratchInput } from '../desktop/private-scratch-directory.ts';

test('one desktop scratch authority creates a private root and prefixed private child', async (context) => {
	const parent = await mkdtemp(join(tmpdir(), 'soundscaper-private-scratch-test-'));
	context.after(() => rm(parent, { recursive: true, force: true }));
	const root = join(parent, 'missing-root');
	const directory = await createPrivateScratchDirectory(root, 'codec-operation-');
	assert.equal(basename(directory).startsWith('codec-operation-'), true);
	assert.equal((await stat(root)).mode & 0o777, 0o700);
	assert.equal((await stat(directory)).mode & 0o777, 0o700);
});

test('owned private scratch writes exclusively at mode 0600 and cleans after success', async () => {
	const calls: unknown[] = [];
	const result = await withOwnedPrivateScratchInput({
		root: '/private-root', prefix: 'codec-', inputFileName: 'input.bin',
		input: Uint8Array.of(1, 2, 3),
		run: async (custody) => { calls.push(['run', custody]); return 'complete'; },
		failed: () => 'failed', cleanupFailed: () => 'cleanup-failed',
	}, {
		createDirectory: async (root, prefix) => {
			calls.push(['create', root, prefix]);
			return '/private-root/codec-owned';
		},
		writeInput: async (...arguments_) => { calls.push(['write', ...arguments_]); },
		removeDirectory: async (...arguments_) => { calls.push(['remove', ...arguments_]); },
	});
	assert.equal(result, 'complete');
	assert.deepEqual(calls, [
		['create', '/private-root', 'codec-'],
		['write', '/private-root/codec-owned/input.bin', Uint8Array.of(1, 2, 3), { flag: 'wx', mode: 0o600 }],
		['run', { directory: '/private-root/codec-owned', inputPath: '/private-root/codec-owned/input.bin' }],
		['remove', '/private-root/codec-owned', {
			recursive: true, force: true, maxRetries: 2, retryDelay: 25,
		}],
	]);
});

test('owned private scratch cleanup failure replaces callback and preparation results', async () => {
	for (const run of [
		async () => 'complete',
		async (): Promise<string> => { throw new Error('run failed'); },
	]) {
		const result = await withOwnedPrivateScratchInput({
			root: '/private-root', prefix: 'codec-', inputFileName: 'input.bin',
			input: Uint8Array.of(1), run,
			failed: () => 'failed', cleanupFailed: () => 'cleanup-failed',
		}, {
			createDirectory: async () => '/private-root/codec-owned',
			writeInput: async () => undefined,
			removeDirectory: async () => { throw new Error('cleanup failed'); },
		});
		assert.equal(result, 'cleanup-failed');
	}
});
