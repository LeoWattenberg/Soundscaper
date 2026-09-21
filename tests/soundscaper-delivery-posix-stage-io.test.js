/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'native/soundscaper-professional-host/src');

test('one POSIX staged I/O and cross-platform identity authority preserves offsets and typed errors', {
	skip: process.platform === 'win32',
}, async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-stage-io-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const executable = join(directory, 'stage-io');
	const compiler = process.platform === 'darwin' ? 'clang++' : 'g++';
	const compilation = spawnSync(compiler, [
		'-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror',
		join(SOURCE, 'delivery_fs_posix.cpp'),
		join(SOURCE, 'delivery_fs_protocol.cpp'),
		join(ROOT, 'tests/fixtures/soundscaper-delivery-posix-stage-io.cpp'),
		'-o', executable,
	], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(compilation.status, 0, compilation.stderr || compilation.stdout);
	const file = join(directory, 'stage.bin');
	const executed = spawnSync(executable, [file], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(executed.status, 0, executed.stderr || `fixture exited ${String(executed.status)}`);
	assert.deepEqual(await readFile(file), Buffer.from([0, 0, 0, 0x11, 0x22, 0x33, 0x44]));
});
