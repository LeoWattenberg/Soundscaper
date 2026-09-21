/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { createPrivateScratchDirectory } from '../desktop/private-scratch-directory.ts';

test('one desktop scratch authority creates a private root and prefixed private child', async (context) => {
	const parent = await mkdtemp(join(tmpdir(), 'soundscaper-private-scratch-test-'));
	context.after(() => rm(parent, { recursive: true, force: true }));
	const root = join(parent, 'missing-root');
	const directory = await createPrivateScratchDirectory(root, 'codec-operation-');
	assert.equal(basename(directory).startsWith('codec-operation-'), true);
	assert.equal((await stat(root)).mode & 0o777, 0o700);
	assert.equal((await stat(directory)).mode & 0o777, 0o700);
});
