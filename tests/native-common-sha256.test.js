/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const COMMON = join(ROOT, 'native/common');
const MEDIA = join(ROOT, 'native/framescaper-media-host/src');
const OPENFX = join(ROOT, 'native/framescaper-openfx-host/src');
const PROFESSIONAL = join(ROOT, 'native/soundscaper-professional-host/src');

test('the neutral native SHA-256 core preserves every domain adapter boundary', (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return;
	}
	const directory = mkdtempSync(join(tmpdir(), 'native-common-sha256-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const executable = join(directory, 'sha256-fixture');
	const compiled = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		join(COMMON, 'sha256.cpp'),
		join(MEDIA, 'sha256.cpp'),
		join(OPENFX, 'sha256.cpp'),
		join(PROFESSIONAL, 'delivery_fs_sha256.cpp'),
		join(ROOT, 'tests/fixtures/native-common-sha256.cpp'),
		'-o', executable,
	], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);

	const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz\n');
	const path = join(directory, 'authenticated.bin');
	writeFileSync(path, bytes);
	const run = spawnSync(executable, [
		path, digest(bytes), digest(bytes.subarray(0, 7)), digest(bytes.subarray(11, 24)),
	], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(run.status, 0, run.stderr || run.stdout);
});

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
