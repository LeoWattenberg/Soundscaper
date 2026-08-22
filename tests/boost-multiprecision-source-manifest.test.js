/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	collectBoostHeaderClosure,
	verifyBoostHeaderClosureManifest,
} from '../scripts/lib/boost-header-closure.mjs';

const manifestUrl = new URL('../config/boost-multiprecision-source-manifest.json', import.meta.url);

test('pins the non-runtime Boost 1.92.0 cpp_int header closure and upstream archive', async () => {
	const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.component.name, 'Boost.Multiprecision');
	assert.equal(manifest.component.version, '1.92.0');
	assert.equal(manifest.component.runtimePayload, false);
	assert.equal(manifest.source.archiveByteLength, 199_030_664);
	assert.equal(manifest.source.sha256, '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c');
	assert.deepEqual(manifest.headerClosure.roots, ['boost/multiprecision/cpp_int.hpp']);
	assert.equal(manifest.headerClosure.algorithm, 'boost-include-closure-sha256-v1');
	assert.ok(manifest.headerClosure.fileCount > 10);
	assert.match(manifest.headerClosure.sha256, /^[a-f0-9]{64}$/u);

	const notices = await readFile(new URL('../THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8');
	assert.match(notices, /Boost\.Multiprecision 1\.92\.0[\s\S]*Boost Software License 1\.0[\s\S]*5c1d40cb/iu);
});

test('the closure digest follows every Boost include without trusting preprocessor branches', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-boost-closure-'));
	try {
		await mkdir(join(root, 'boost', 'multiprecision'), { recursive: true });
		await mkdir(join(root, 'boost', 'detail'), { recursive: true });
		await writeFile(join(root, 'boost', 'multiprecision', 'cpp_int.hpp'), [
			'#include <boost/detail/a.hpp>',
			'#if defined(_WIN32)',
			'#include <boost/detail/windows.hpp>',
			'#endif',
		].join('\n'));
		await writeFile(join(root, 'boost', 'detail', 'a.hpp'), '#include <boost/detail/b.hpp>\n');
		await writeFile(join(root, 'boost', 'detail', 'b.hpp'), '#include <boost/detail/a.hpp>\n');
		await writeFile(join(root, 'boost', 'detail', 'windows.hpp'), '// platform branch\n');

		const closure = await collectBoostHeaderClosure(root, ['boost/multiprecision/cpp_int.hpp']);
		assert.deepEqual(closure.files.map(({ path }) => path), [
			'boost/detail/a.hpp',
			'boost/detail/b.hpp',
			'boost/detail/windows.hpp',
			'boost/multiprecision/cpp_int.hpp',
		]);
		assert.doesNotThrow(() => verifyBoostHeaderClosureManifest({
			algorithm: 'boost-include-closure-sha256-v1',
			roots: ['boost/multiprecision/cpp_int.hpp'],
			fileCount: closure.fileCount,
			sha256: closure.sha256,
		}, closure));
		assert.throws(() => verifyBoostHeaderClosureManifest({
			algorithm: 'boost-include-closure-sha256-v1',
			roots: ['boost/multiprecision/cpp_int.hpp'],
			fileCount: closure.fileCount,
			sha256: '0'.repeat(64),
		}, closure), /digest|closure/iu);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
