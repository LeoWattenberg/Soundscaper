/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	digestLocalModelFile,
	isLocalModelDirectorySyncErrorBenign,
	syncLocalModelPath,
} from '../desktop/local-model-file-io.ts';

test('model file digest is streaming and abort-aware for preseed and store callers', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'model-io-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'body');
	const bytes = Buffer.alloc(128 * 1024 + 1, 0x35);
	await writeFile(path, bytes);
	assert.equal(await digestLocalModelFile(path), createHash('sha256').update(bytes).digest('hex'));
	const controller = new AbortController();
	controller.abort(new Error('cancelled'));
	await assert.rejects(digestLocalModelFile(path, controller.signal), { name: 'AbortError' });
	await syncLocalModelPath(path);
	await syncLocalModelPath(root);
});

test('model directory sync only tolerates the established platform error codes', () => {
	for (const code of ['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM']) {
		assert.equal(isLocalModelDirectorySyncErrorBenign({ code }), true);
	}
	for (const code of ['ENOENT', 'EACCES', 'EIO']) {
		assert.equal(isLocalModelDirectorySyncErrorBenign({ code }), false);
	}
});
