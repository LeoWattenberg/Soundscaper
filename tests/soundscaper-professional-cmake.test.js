/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts/ci-install-professional-cmake.sh');

test('the Ubuntu 22 professional builder pins an official CMake meeting every native minimum', async () => {
	const installer = await readFile(SCRIPT, 'utf8');
	assert.match(installer, /cmake_version='3\.31\.10'/u);
	assert.match(installer, /archive_bytes='55010952'/u);
	assert.match(installer, /archive_sha256='3cb3dd247b6a1de2d0f4b20c6fd4326c9024e894cebc9dc8699758887e566ca7'/u);
	assert.match(installer, /https:\/\/cmake\.org\/files\/v3\.31\/cmake-\$\{cmake_version\}-linux-x86_64\.tar\.gz/u);
	for (const nativeRoot of ['soundscaper-professional-host', 'milestone-5-native-isolation-launcher', 'os-audio-codec-host']) {
		const source = await readFile(join(ROOT, 'native', nativeRoot, 'CMakeLists.txt'), 'utf8');
		const minimum = /cmake_minimum_required\(VERSION (?<major>\d+)\.(?<minor>\d+)/u.exec(source);
		assert.ok(minimum?.groups);
		assert.ok(Number(minimum.groups.major) < 3
			|| (Number(minimum.groups.major) === 3 && Number(minimum.groups.minor) <= 31),
			`${nativeRoot} must configure with the authenticated CMake pin`);
	}
});

test('a same-length corrupted CMake archive never extracts or publishes its executable path', async (context) => {
	if (process.platform !== 'linux') return context.skip('Linux builder bootstrap');
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-professional-cmake-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const bin = join(temporary, 'bin');
	await mkdir(bin);
	const archive = join(temporary, 'corrupt.tar.gz');
	const file = await open(archive, 'wx');
	try { await file.truncate(55_010_952); } finally { await file.close(); }
	const githubPath = join(temporary, 'github-path');
	await writeFile(githubPath, '');
	await writeFile(join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; *) exit 1;; esac\n', { mode: 0o755 });
	await writeFile(join(bin, 'curl'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = "--output" ]; then shift; cp "$CMAKE_TEST_ARCHIVE" "$1"; exit; fi\n shift\ndone\nexit 1\n', { mode: 0o755 });
	await writeFile(join(bin, 'tar'), '#!/bin/sh\ntouch "$CMAKE_TEST_EXTRACTED"\nexit 1\n', { mode: 0o755 });
	const extracted = join(temporary, 'extracted');
	const result = spawnSync('bash', [SCRIPT], {
		encoding: 'utf8', timeout: 30_000,
		env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, RUNNER_TEMP: temporary,
			GITHUB_PATH: githubPath, CMAKE_TEST_ARCHIVE: archive, CMAKE_TEST_EXTRACTED: extracted },
	});
	assert.equal(result.error, undefined);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /checksum|SHA256|FAILED/u);
	assert.equal(await readFile(githubPath, 'utf8'), '');
	const remaining = await readdir(temporary);
	assert.ok(!remaining.includes('extracted'), 'untrusted archive must not reach tar');
	assert.ok(!remaining.some((name) => name.startsWith('soundscaper-professional-cmake.')),
		'failed admission must remove the temporary download');
});
