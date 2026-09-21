/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const fixtures = join(root, 'tests/fixtures');

test('the shared Win32 path kernel keeps C allocation and C++ length policies distinct', async (context) => {
	if (spawnSync('cc', ['--version'], { encoding: 'utf8' }).status !== 0
		|| spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('C and C++ compilers are needed for the target-native path fixture.');
		return;
	}
	const scratch = await mkdtemp(join(tmpdir(), 'soundscaper-winpath-'));
	context.after(() => rm(scratch, { recursive: true, force: true }));
	const fake = join(fixtures, 'windows-utf8-path-fake');
	const object = join(scratch, 'windows_api.o');
	const compiled = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror',
		'-I', fake, '-c', join(fake, 'windows_api.c'), '-o', object], { encoding: 'utf8' });
	assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
	for (const [compiler, standard, source] of [
		['cc', 'c11', 'windows-utf8-path-c.c'],
		['c++', 'c++20', 'windows-utf8-path-cpp.cpp'],
	]) {
		const executable = join(scratch, source);
		const built = spawnSync(compiler, [`-std=${standard}`, '-Wall', '-Wextra', '-Werror',
			'-I', fake, join(fixtures, source), object, '-o', executable], { encoding: 'utf8' });
		assert.equal(built.status, 0, built.stderr || built.stdout);
		const executed = spawnSync(executable, [], { encoding: 'utf8' });
		assert.equal(executed.status, 0, executed.stderr || `${source} exited ${String(executed.status)}`);
	}
});

test('Windows plugin, codec, and delivery callers retain their policy at one conversion authority', async () => {
	const source = join(root, 'native/soundscaper-professional-host/src');
	for (const filename of ['os_audio_codec_windows.cpp', 'os_mp3_encode_windows.cpp']) {
		const caller = await readFile(join(source, filename), 'utf8');
		assert.match(caller, /windows_path::decode_bounded_path\(/u);
		assert.doesNotMatch(caller, /MultiByteToWideChar\(|bool widePath\(/u);
	}
	const delivery = await readFile(join(source, 'delivery_fs_windows.cpp'), 'utf8');
	assert.match(delivery, /windows_path::decode\(output, value\.data\(\)/u);
	assert.match(delivery, /fail_windows\("malformed-control", "utf8-decode"\)/u);
	assert.doesNotMatch(delivery, /MultiByteToWideChar\(/u);
	for (const filename of ['plugin_scan.c', 'plugin_host.c']) {
		const caller = await readFile(join(root, 'native/soundscaper-helper-addon/src', filename), 'utf8');
		assert.match(caller, /soundscaper_windows_wide_path_alloc_nul\(/u);
		assert.doesNotMatch(caller, /MultiByteToWideChar\(/u);
	}
});
