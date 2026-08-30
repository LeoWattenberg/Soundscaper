/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { materializeNativeRenderInputFiles } from '../desktop/native-services-render-input-materialization.ts';

test('durable render-input materialization aborts between chunks and removes its partial copy', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-materialize-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'source');
	const targetDirectory = join(root, 'target');
	await mkdir(sourceDirectory);
	await mkdir(targetDirectory);
	const bytes = Buffer.alloc(3 * 1024 * 1024, 0x5a);
	const sourcePath = join(sourceDirectory, 'input-00.frames');
	await writeFile(sourcePath, bytes);
	const details = await lstat(sourcePath);
	let checks = 0;
	const signal = {
		throwIfAborted: () => {
			checks += 1;
			if (checks === 7) throw new DOMException('cancelled', 'AbortError');
		},
	} as AbortSignal;

	await assert.rejects(materializeNativeRenderInputFiles({
		sourceDirectory, targetDirectory, signal,
		files: [Object.freeze({
			name: 'input-00.frames', role: 'evaluated-rgba-frame-pack' as const,
			byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
			identity: Object.freeze({ dev: details.dev, ino: details.ino }),
		})],
	}), /cancelled/u);
	assert.ok(checks >= 7, 'copying checks cancellation repeatedly instead of only at admission');
	assert.deepEqual(await readdir(targetDirectory), [], 'an aborted helper scratch copy is removed');
});
