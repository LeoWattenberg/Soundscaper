/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
	FRAMESCAPER_BOOST_CI_ADMISSION,
	FRAMESCAPER_BOOST_VERSION_HEADER_ADMISSION,
	downloadPinnedFramescaperBoost,
	materializePinnedFramescaperBoostVersionHeader,
	materializeVerifiedFramescaperBoostClosure,
	runFramescaperBoostCiProvisioning,
} from '../scripts/lib/framescaper-boost-ci.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('Framescaper CI pins the official Boost 1.92.0 archive identity', () => {
	assert.deepEqual(FRAMESCAPER_BOOST_CI_ADMISSION, {
		version: '1.92.0',
		requestUrl: 'https://archives.boost.io/release/1.92.0/source/boost_1_92_0.tar.bz2',
		archive: {
			fileName: 'boost_1_92_0.tar.bz2',
			byteLength: 199_030_664,
			sha256: '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c',
		},
		archiveRoot: 'boost_1_92_0',
	});
	assert.equal(Object.isFrozen(FRAMESCAPER_BOOST_CI_ADMISSION), true);
	assert.equal(Object.isFrozen(FRAMESCAPER_BOOST_CI_ADMISSION.archive), true);
	assert.deepEqual(FRAMESCAPER_BOOST_VERSION_HEADER_ADMISSION, {
		path: 'boost/version.hpp',
		byteLength: 1_117,
		sha256: 'cf992d9d2c4f2294b69d8819e334927644a48b978bfea3c525e3f9c6dbc7cb9f',
	});
	assert.equal(Object.isFrozen(FRAMESCAPER_BOOST_VERSION_HEADER_ADMISSION), true);
});

test('the pinned Boost version header is materialized beside the verified closure', async (context) => {
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-boost-version-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const extracted = join(temporary, 'extracted');
	const closureRoot = join(temporary, 'closure');
	const bytes = Buffer.from('#define BOOST_VERSION 109200\n');
	const admission = {
		path: 'boost/version.hpp',
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
	await mkdir(join(extracted, 'boost'), { recursive: true });
	await mkdir(closureRoot);
	await writeFile(join(extracted, 'boost', 'version.hpp'), bytes);
	assert.equal(await materializePinnedFramescaperBoostVersionHeader({
		sourceRoot: extracted, closureRoot, admission,
	}), join(closureRoot, 'boost', 'version.hpp'));
	assert.deepEqual(await readFile(join(closureRoot, 'boost', 'version.hpp')), bytes);
	await assert.rejects(materializePinnedFramescaperBoostVersionHeader({
		sourceRoot: extracted, closureRoot, admission: { ...admission, sha256: '0'.repeat(64) },
	}), /changed after archive admission/iu);
});

test('the Boost downloader publishes only exact URL, length, and digest bytes', async (context) => {
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-boost-download-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const bytes = Buffer.from('closure');
	const admission = Object.freeze({
		requestUrl: 'https://example.test/boost.tar.bz2',
		archive: Object.freeze({
			byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		}),
	});
	const destination = join(temporary, 'boost.tar.bz2');
	const response = (body = [bytes], url = admission.requestUrl) => ({
		ok: true,
		status: 200,
		url,
		headers: { get: (name) => name === 'content-length' ? String(bytes.byteLength) : null },
		body,
	});
	const fetchImpl = async () => response();

	const downloaded = await downloadPinnedFramescaperBoost({
		destination, admission, fetchImpl,
	});
	assert.equal(downloaded.path, destination);
	assert.equal(String(await readFile(destination)), 'closure');
	const preexisting = join(temporary, 'preexisting.tar.bz2');
	await writeFile(preexisting, 'owned by another operation');
	await assert.rejects(downloadPinnedFramescaperBoost({
		destination: preexisting, admission, fetchImpl,
	}), /EEXIST|exist/iu);
	assert.equal(String(await readFile(preexisting)), 'owned by another operation');

	async function rejectsAndRemoves(name, options, pattern) {
		const rejected = join(temporary, `${name}.tar.bz2`);
		await assert.rejects(downloadPinnedFramescaperBoost({
			destination: rejected, admission, ...options,
		}), pattern);
		await assert.rejects(readFile(rejected), /ENOENT/u);
	}
	await rejectsAndRemoves('wrong-url', {
		fetchImpl: async () => response(
			[bytes], 'https://mirror.example.test/boost.tar.bz2',
		),
	}, /URL and length admission/iu);
	await rejectsAndRemoves('wrong-digest', {
		admission: { ...admission, archive: { ...admission.archive, sha256: '0'.repeat(64) } },
		fetchImpl,
	}, /digest admission/iu);
	await rejectsAndRemoves('short', {
		fetchImpl: async () => response([bytes.subarray(1)]),
	}, /digest admission/iu);
	await rejectsAndRemoves('oversize', {
		fetchImpl: async () => response([bytes, Buffer.from('!')]),
	}, /exceeded its exact byte length/iu);
});

test('the exported include root contains only verified closure files', async (context) => {
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-boost-closure-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const extracted = join(temporary, 'extracted');
	const closureRoot = join(temporary, 'closure');
	const bodies = new Map([
		['boost/multiprecision/cpp_int.hpp', Buffer.from('#include <boost/detail/a.hpp>\n')],
		['boost/detail/a.hpp', Buffer.from('// admitted dependency\n')],
	]);
	for (const [path, bytes] of bodies) {
		const directory = path.slice(0, path.lastIndexOf('/'));
		await mkdir(join(extracted, ...directory.split('/')), { recursive: true });
		await writeFile(join(extracted, ...path.split('/')), bytes);
	}
	await writeFile(join(extracted, 'boost', 'not-in-closure.hpp'), '// excluded\n');
	const closure = {
		fileCount: bodies.size,
		files: [...bodies].sort(([left], [right]) => left.localeCompare(right)).map(([path, bytes]) => ({
			path, byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		})),
	};

	assert.equal(await materializeVerifiedFramescaperBoostClosure({
		sourceRoot: extracted, closureRoot, closure,
	}), closureRoot);
	for (const [path, bytes] of bodies) {
		assert.deepEqual(await readFile(join(closureRoot, ...path.split('/'))), bytes);
	}
	await assert.rejects(readFile(join(closureRoot, 'boost', 'not-in-closure.hpp')), /ENOENT/u);
	await assert.rejects(materializeVerifiedFramescaperBoostClosure({
		sourceRoot: extracted,
		closureRoot: join(temporary, 'invalid-closure'),
		closure: { fileCount: 1, files: [{
			path: 'boost\\detail\\a.hpp', byteLength: 1, sha256: '0'.repeat(64),
		}] },
	}), /noncanonical/iu);
});

test('CI verifies the extracted closure before exporting its source root', async (context) => {
	const runnerTemp = await mkdtemp(join(tmpdir(), 'soundscaper-boost-ci-'));
	context.after(() => rm(runnerTemp, { recursive: true, force: true }));
	const githubEnvironmentPath = join(runnerTemp, 'github-env');
	await writeFile(githubEnvironmentPath, 'EXISTING=value\n');
	const calls = [];
	let extractedRoot;
	let verificationCount = 0;
	const closure = Object.freeze({ files: Object.freeze([]) });
	const versionBytes = Buffer.from('#define BOOST_VERSION 109200\n');
	const result = await runFramescaperBoostCiProvisioning({
		repositoryRoot: ROOT,
		runnerTemp,
		githubEnvironmentPath,
	}, {
		async download({ destination, admission }) {
			calls.push('download');
			assert.equal(admission, FRAMESCAPER_BOOST_CI_ADMISSION);
			await writeFile(destination, 'authenticated archive', { flag: 'wx' });
		},
		async extract({ archivePath, sourceRoot }) {
			calls.push('extract');
			assert.equal(String(await readFile(archivePath)), 'authenticated archive');
			extractedRoot = sourceRoot;
			await mkdir(join(sourceRoot, 'boost'), { recursive: true });
			await writeFile(join(sourceRoot, 'boost', 'version.hpp'), versionBytes);
		},
		async verify({ repositoryRoot, boostSourceRoot }) {
			verificationCount += 1;
			calls.push(`verify-${String(verificationCount)}`);
			assert.equal(repositoryRoot, ROOT);
			assert.equal(boostSourceRoot, assertContainedSourceRoot(runnerTemp, boostSourceRoot));
			return closure;
		},
		async materialize({ sourceRoot, closureRoot, closure: admitted }) {
			calls.push('materialize');
			assert.equal(sourceRoot, extractedRoot);
			assert.equal(admitted, closure);
			await mkdir(closureRoot);
			return closureRoot;
		},
		versionHeaderAdmission: {
			path: 'boost/version.hpp',
			byteLength: versionBytes.byteLength,
			sha256: createHash('sha256').update(versionBytes).digest('hex'),
		},
	});

	assert.deepEqual(calls, ['download', 'extract', 'verify-1', 'materialize', 'verify-2']);
	assert.equal(result.sourceRoot, assertContainedSourceRoot(runnerTemp, result.sourceRoot));
	assert.deepEqual(await readFile(join(result.sourceRoot, 'boost', 'version.hpp')), versionBytes);
	await assert.rejects(lstat(extractedRoot), /ENOENT/u,
		'the broader extracted source tree must be removed before export');
	assert.equal(String(await readFile(githubEnvironmentPath)), [
		'EXISTING=value',
		`FRAMESCAPER_BOOST_192_SOURCE_ROOT=${result.sourceRoot}`,
		'',
	].join('\n'));
});

test('CI refuses to publish an environment file outside RUNNER_TEMP', async (context) => {
	const runnerTemp = await mkdtemp(join(tmpdir(), 'soundscaper-boost-contained-'));
	const outside = await mkdtemp(join(tmpdir(), 'soundscaper-boost-outside-'));
	context.after(() => Promise.all([
		rm(runnerTemp, { recursive: true, force: true }),
		rm(outside, { recursive: true, force: true }),
	]));
	const githubEnvironmentPath = join(outside, 'github-env');
	await writeFile(githubEnvironmentPath, '');
	await assert.rejects(runFramescaperBoostCiProvisioning({
		repositoryRoot: ROOT, runnerTemp, githubEnvironmentPath,
	}), /GITHUB_ENV must remain below RUNNER_TEMP/u);
});

function assertContainedSourceRoot(runnerTemp, sourceRoot) {
	const child = relative(runnerTemp, sourceRoot);
	assert.notEqual(child, '');
	assert.equal(isAbsolute(child), false);
	assert.equal(child === '..' || child.startsWith(`..${sep}`), false);
	return sourceRoot;
}
