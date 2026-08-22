/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('the native exact ordinal source is Boost-backed, bounded, lazy, and has a compile fixture', async () => {
	const header = await readFile(new URL(
		'../native/framescaper-media-host/src/exact_retime_ordinal.hpp', import.meta.url,
	), 'utf8');
	const fixture = await readFile(new URL(
		'../native/framescaper-media-host/tests/exact_retime_ordinal_fixture.cpp', import.meta.url,
	), 'utf8');

	assert.match(header, /boost\/multiprecision\/cpp_int\.hpp/u);
	assert.match(header, /kMaximumExactBits\s*=\s*4096/u);
	assert.match(header, /exact_picture_ordinal\(/u);
	assert.match(header, /exact_picture_ordinal_at_time\(/u);
	assert.match(header, /exact_output_sample\(/u);
	assert.doesNotMatch(header, /\b(?:double|float)\b/u);
	assert.doesNotMatch(header, /output_(?:frames|schedule)|std::vector<[^>]*ordinal/iu);
	assert.match(fixture, /90071992547409909/u);
	assert.match(fixture, /1'999'999/u);
});

test('CMake requires Boost 1.92.0 exactly and compiles the oracle into host and test targets', async (context) => {
	const cmake = await readFile(new URL(
		'../native/framescaper-media-host/CMakeLists.txt', import.meta.url,
	), 'utf8');
	assert.match(cmake, /find_package\(Boost\s+1\.92\.0\s+EXACT\s+REQUIRED/u);
	assert.match(cmake, /target_link_libraries\(framescaper-media-host[\s\S]*Boost::headers/u);
	assert.match(cmake, /add_executable\(framescaper-exact-retime-ordinal-test[\s\S]*exact_retime_ordinal_fixture\.cpp/u);
	assert.match(cmake, /add_test\([\s\S]*framescaper-exact-retime-ordinal-test/u);

	const compiler = spawnSync('c++', ['--version'], { encoding: 'utf8' });
	if (compiler.status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return;
	}
	const boost = spawnSync('c++', ['-std=c++20', '-E', '-x', 'c++', '-'], {
		encoding: 'utf8', input: '#include <boost/multiprecision/cpp_int.hpp>\n',
	});
	if (boost.status !== 0) {
		context.skip('The pinned Boost closure is not provisioned on this source-audit host.');
		return;
	}
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-exact-retime-'));
	try {
		const executable = join(directory, 'exact-retime');
		const built = spawnSync('c++', [
			'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
			'-I', new URL('../native/framescaper-media-host/src/', import.meta.url).pathname,
			new URL('../native/framescaper-media-host/tests/exact_retime_ordinal_fixture.cpp', import.meta.url).pathname,
			'-o', executable,
		], { encoding: 'utf8' });
		assert.equal(built.status, 0, built.stderr);
		const executed = spawnSync(executable, [], { encoding: 'utf8' });
		assert.equal(executed.status, 0, executed.stderr);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
