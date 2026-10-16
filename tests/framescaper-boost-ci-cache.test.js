/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { runFramescaperBoostCiProvisioning } from '../scripts/lib/framescaper-boost-ci.mjs';
import { boostClosureCacheIdentity } from '../scripts/lib/framescaper-boost-ci-cache.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const headerPath = 'boost/multiprecision/cpp_int.hpp';
const header = Buffer.from('// authenticated exact arithmetic fixture\n');
const version = Buffer.from('#define BOOST_VERSION 109200\n');
const versionHeaderAdmission = { path: 'boost/version.hpp', byteLength: version.length, sha256: hash(version) };
const closure = { fileCount: 1, files: [{ path: headerPath, byteLength: header.length, sha256: hash(header) }] };

async function fixture(context) {
	const temporary = await mkdtemp(join(tmpdir(), 'framescaper-boost-cache-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const runnerTemp = join(temporary, 'runner');
	const cacheRoot = join(temporary, 'cache');
	await mkdir(runnerTemp);
	const githubEnvironmentPath = join(runnerTemp, 'github-env');
	await writeFile(githubEnvironmentPath, '');
	const calls = [];
	const options = { repositoryRoot: ROOT, runnerTemp, githubEnvironmentPath, cacheRoot };
	const dependencies = {
		versionHeaderAdmission,
		async download({ destination }) { calls.push('download'); await writeFile(destination, 'authenticated archive'); },
		async extract({ sourceRoot }) {
			calls.push('extract');
			await mkdir(join(sourceRoot, 'boost', 'multiprecision'), { recursive: true });
			await writeFile(join(sourceRoot, headerPath), header);
			await writeFile(join(sourceRoot, 'boost/version.hpp'), version);
		},
		async verify({ boostSourceRoot }) {
			assert.deepEqual(await readFile(join(boostSourceRoot, headerPath)), header);
			return closure;
		},
	};
	return { calls, options, dependencies, cacheRoot };
}

test('Boost warm provisioning verifies cached headers and exports a new private workspace without downloading', async context => {
	const { calls, options, dependencies } = await fixture(context);
	const first = await runFramescaperBoostCiProvisioning(options, dependencies);
	const second = await runFramescaperBoostCiProvisioning(options, dependencies);
	assert.deepEqual(calls, ['download', 'extract']);
	assert.notEqual(first.sourceRoot, second.sourceRoot);
	assert.notEqual((await lstat(join(first.sourceRoot, headerPath))).ino,
		(await lstat(join(second.sourceRoot, headerPath))).ino);
	const identity = JSON.parse(await readFile(join(second.sourceRoot, '.framescaper-source-identity.json'), 'utf8'));
	assert.equal(identity.root, second.sourceRoot);
	await writeFile(join(first.sourceRoot, headerPath), 'private modification');
	const third = await runFramescaperBoostCiProvisioning(options, dependencies);
	assert.deepEqual(await readFile(join(third.sourceRoot, headerPath)), header);
	assert.deepEqual(calls, ['download', 'extract']);
});

for (const corruption of ['changed', 'missing', 'extra', 'symbolic', 'version']) {
	test(`Boost cached ${corruption} headers are discarded and recovered through authenticated provisioning`, async context => {
		const { calls, options, dependencies, cacheRoot } = await fixture(context);
		await runFramescaperBoostCiProvisioning(options, dependencies);
		const key = (await readdir(cacheRoot))[0];
		const headers = join(cacheRoot, key, 'headers');
		const path = join(headers, headerPath);
		if (corruption === 'changed') await writeFile(path, 'modified');
		if (corruption === 'missing') await rm(path);
		if (corruption === 'extra') await writeFile(join(headers, 'boost/extra.hpp'), 'extra');
		if (corruption === 'version') await writeFile(join(headers, 'boost/version.hpp'), 'wrong version');
		if (corruption === 'symbolic') {
			await rm(path);
			await symlink(join(cacheRoot, 'outside'), path);
		}
		const restored = await runFramescaperBoostCiProvisioning(options, dependencies);
		assert.deepEqual(await readFile(join(restored.sourceRoot, headerPath)), header);
		assert.deepEqual(calls, ['download', 'extract', 'download', 'extract']);
	});
}

test('Boost cache identities change with archive, closure and version-header admissions', () => {
	const admitted = {
		archive: { version: '1.92.0', archive: { sha256: 'a'.repeat(64), byteLength: 20 } },
		closure: { roots: [headerPath], fileCount: 1, sha256: 'b'.repeat(64) },
		versionHeader: versionHeaderAdmission,
	};
	const baseline = boostClosureCacheIdentity(admitted);
	for (const changed of [
		{ ...admitted, archive: { ...admitted.archive, version: '1.93.0' } },
		{ ...admitted, archive: { ...admitted.archive, archive: { sha256: 'c'.repeat(64), byteLength: 20 } } },
		{ ...admitted, closure: { ...admitted.closure, sha256: 'c'.repeat(64) } },
		{ ...admitted, versionHeader: { ...versionHeaderAdmission, sha256: 'c'.repeat(64) } },
	]) assert.notEqual(boostClosureCacheIdentity(changed), baseline);
});
