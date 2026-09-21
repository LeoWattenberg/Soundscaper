/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const SOURCE = resolve(import.meta.dirname, '../native/soundscaper-professional-host');

test('portable OS codec ABI request and status kernel preserves exact boundaries', async (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++20 compiler is unavailable.');
		return;
	}
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-os-codec-contract-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const executable = join(temporaryRoot, 'contract-self-test');
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', join(SOURCE, 'src'),
		join(SOURCE, 'tests/os_audio_codec_contract_self_test.cpp'), '-o', executable,
	], { encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr || built.stdout);
	const executed = spawnSync(executable, [], { encoding: 'utf8' });
	assert.equal(executed.status, 0, executed.stderr || executed.stdout);
});

test('both native addons project statuses through the same ABI names', async () => {
	for (const bridge of [
		resolve(SOURCE, 'src/node_api_bridge.cpp'),
		resolve(SOURCE, '../os-audio-codec-host/src/node_api_bridge.cpp'),
	]) {
		const source = await readFile(bridge, 'utf8');
		assert.match(source, /#include "os_audio_codec_contract\.h"/u);
		assert.match(source, /codecStatusName\(outcome\.status, "decoded", "decode-failed"\)/u);
		assert.match(source, /codecStatusName\(outcome\.status, "encoded", "encode-failed"\)/u);
	}
});
