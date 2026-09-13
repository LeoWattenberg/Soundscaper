/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
	createFramescaperMediaHostBuildResult,
	FRAMESCAPER_MEDIA_HOST_SOURCE_IDENTITY,
	framescaperMediaHostTestReceipt,
	verifyFramescaperMediaHostBuildResult,
} from '../scripts/lib/framescaper-media-host-build-result.mjs';
import {
	stageFramescaperMediaHostBuildResult,
} from '../scripts/lib/framescaper-media-host-build-result-staging.mjs';
import {
	deriveFramescaperMediaHostPayloadManifest,
} from '../scripts/lib/framescaper-media-host-build.mjs';

const TARGET = 'linux-x64';
const SOURCE_IDENTITY = FRAMESCAPER_MEDIA_HOST_SOURCE_IDENTITY;
const NOTICES = [
	'# Media host notices', 'FFmpeg GPL-2.0-or-later', 'Boost BSL-1.0',
	'x264 GPL-2.0-or-later', 'x265 GPL-2.0-or-later', 'libvpx BSD-3-Clause',
	'Opus BSD-3-Clause', 'zlib Zlib',
].join('\n');

test('the result identity matches every source actually compiled and linked', async () => {
	const host = JSON.parse(await readFile(join(
		resolve(import.meta.dirname, '..'), 'native/framescaper-media-host/source-manifest.json',
	), 'utf8'));
	const external = JSON.parse(await readFile(join(
		resolve(import.meta.dirname, '..'), 'native/framescaper-media-host/build/ffmpeg-9.0.1-external-sources.json',
	), 'utf8'));
	const boost = JSON.parse(await readFile(join(
		resolve(import.meta.dirname, '..'), 'config/boost-multiprecision-source-manifest.json',
	), 'utf8'));
	assert.deepEqual(SOURCE_IDENTITY.ffmpeg, {
		version: host.ffmpeg.version, url: host.ffmpeg.url,
		archiveByteLength: host.ffmpeg.byteLength, archiveSha256: host.ffmpeg.sha256,
		extractedTreeSha256: host.ffmpeg.extractedTree.sha256, license: host.ffmpeg.licenceMode,
	});
	assert.deepEqual(SOURCE_IDENTITY.boost, {
		version: boost.component.version, url: boost.source.archiveUrl,
		archiveByteLength: boost.source.archiveByteLength, archiveSha256: boost.source.sha256,
		headerClosureSha256: boost.headerClosure.sha256, license: boost.component.license,
	});
	for (const source of external.libraries) assert.deepEqual(SOURCE_IDENTITY[source.id], {
		version: source.version, revision: source.revision, url: source.url,
		archiveByteLength: source.byteLength, archiveSha256: source.sha256,
		extractedTreeSha256: source.extractedTree.sha256,
		license: { x264: 'GPL-2.0-or-later', x265: 'GPL-2.0-or-later', libvpx: 'BSD-3-Clause',
			libopus: 'BSD-3-Clause', zlib: 'Zlib' }[source.id],
	});
});

test('a target-native result authenticates its exact files, tests, sources, and dependencies', async (context) => {
	const fixture = await buildFixture(context);
	const verified = await verifyFramescaperMediaHostBuildResult({
		buildResultRoot: fixture.result.buildResultRoot,
	});
	assert.equal(verified.receipt.target, TARGET);
	assert.deepEqual(verified.receipt.sourceIdentity, SOURCE_IDENTITY);
	assert.deepEqual(verified.receipt.tests.map(({ id }) => id), [
		'framescaper-media-host-ctest',
		'framescaper-media-host-self-test',
		'framescaper-media-host-capabilities',
		'isolation-launcher-refusal',
	]);
	assert.equal(verified.receipt.dependencyInspections.length, 2);
	assert.equal(verified.receipt.compliance.thirdPartyNotices, NOTICES);
	assert.equal(Object.keys(verified.receipt.sourceIdentity).length, 7);
	assert.equal(Object.isFrozen(fixture.result.receipt), true);

	await writeFile(join(fixture.result.buildResultRoot, 'payload/framescaper-media-host'), 'drift');
	await assert.rejects(
		verifyFramescaperMediaHostBuildResult({ buildResultRoot: fixture.result.buildResultRoot }),
		/digest authentication/iu,
	);
});

test('a verified result stages into its exact checkout and derives a built package manifest', async (context) => {
	const repositoryRoot = await repositoryFixture(context);
	const sourcePath = join(repositoryRoot, 'native/framescaper-media-host/source-manifest.json');
	const sourceBytes = await readFile(sourcePath);
	const fixture = await buildFixture(context, {
		sourceRevision: git(repositoryRoot, ['rev-parse', 'HEAD']),
		sourceManifestSha256: digest(sourceBytes),
	});
	const stale = await buildFixture(context, {
		sourceRevision: 'f'.repeat(40), sourceManifestSha256: digest(sourceBytes),
	});
	await assert.rejects(stageFramescaperMediaHostBuildResult({
		repositoryRoot, buildResultRoot: stale.result.buildResultRoot,
	}), /checkout revision/iu);
	const staged = await stageFramescaperMediaHostBuildResult({
		repositoryRoot, buildResultRoot: fixture.result.buildResultRoot,
	});
	assert.equal(staged.status, 'staged');
	const source = JSON.parse(await readFile(sourcePath, 'utf8'));
	const target = source.targets[TARGET];
	assert.equal(target.status, 'built');
	assert.equal(target.blockedBy, null);
	assert.match(target.toolchainIdentity, /^[a-f\d]{64}$/u);
	assert.equal(target.buildResult.path,
		'native/framescaper-media-host/prebuilt/linux-x64/framescaper-media-host-build-result.json');
	const payload = JSON.parse(await readFile(
		join(repositoryRoot, 'config/framescaper-media-host-payload-manifest.json'), 'utf8',
	));
	assert.equal(payload.targets[0].status, 'built');
	assert.equal(payload.payloads[0].buildResult.sha256, target.buildResult.sha256);
	await assert.rejects(stageFramescaperMediaHostBuildResult({
		repositoryRoot, buildResultRoot: fixture.result.buildResultRoot,
	}), /source manifest|CI-generated/iu);
});

test('result creation refuses failed installed tests and incomplete dependency evidence', async (context) => {
	const fixture = await installFixture(context);
	await assert.rejects(createResult(fixture, {
		runSelfTest: async (request) => ({
			status: request.id === 'framescaper-media-host-self-test' ? 1 : request.status,
			output: Buffer.from('failed'),
		}),
	}), /installed media-host test/iu);
	await assert.rejects(createResult(fixture, {
		inspectDependencies: async () => ({ imports: [], rpaths: [] }),
	}), /architecture|inspection/iu);
});

async function buildFixture(context, overrides = {}) {
	const fixture = await installFixture(context);
	fixture.result = await createResult(fixture, overrides);
	return fixture;
}

async function installFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-media-result-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const hostInstallRoot = join(root, 'host-install');
	const isolationInstallRoot = join(root, 'isolation-install');
	await mkdir(join(hostInstallRoot, 'bin'), { recursive: true });
	await mkdir(join(isolationInstallRoot, 'bin'), { recursive: true });
	await mkdir(join(isolationInstallRoot, 'profiles'), { recursive: true });
	await Promise.all([
		writeFile(join(hostInstallRoot, 'bin/framescaper-media-host'), 'synthetic host'),
		writeFile(join(isolationInstallRoot, 'bin/milestone5-native-isolation-launcher'),
			'synthetic launcher'),
		writeFile(join(isolationInstallRoot, 'profiles/linux-v1.json'), '{}\n'),
		writeFile(join(isolationInstallRoot, 'profiles/linux-broker-v1.json'), '{}\n'),
	]);
	return {
		root, hostInstallRoot, isolationInstallRoot,
		buildResultRoot: join(root, 'result'),
	};
}

async function createResult(fixture, overrides = {}) {
	return createFramescaperMediaHostBuildResult({
		target: TARGET,
		buildResultRoot: fixture.buildResultRoot,
		hostInstallRoot: fixture.hostInstallRoot,
		isolationInstallRoot: fixture.isolationInstallRoot,
		runtimeRoot: null,
		sourceRevision: overrides.sourceRevision ?? 'a'.repeat(40),
		sourceManifestSha256: overrides.sourceManifestSha256 ?? 'b'.repeat(64),
		buildRecipeSha256: 'c'.repeat(64),
		toolchainIdentity: 'd'.repeat(64),
		thirdPartyNotices: NOTICES,
		buildTests: [framescaperMediaHostTestReceipt(
			'framescaper-media-host-ctest', 'cmake', ['--build', 'host-build', '--target', 'test'],
		)],
		inspectDependencies: overrides.inspectDependencies ?? (async ({ path }) => ({
			architecture: {
				schemaVersion: 1, target: TARGET, format: 'elf64-le', architecture: 'x64',
				machine: 'EM_X86_64',
			},
			imports: [], rpaths: [], path,
		})),
		runSelfTest: overrides.runSelfTest ?? (async (request) => ({
			status: request.status,
			output: Buffer.from(request.id === 'framescaper-media-host-self-test'
				? '{"professionalComponentSetPresent":true}' : request.id === 'framescaper-media-host-capabilities'
					? '{"rawFfmpegArguments":false}' : ''),
		})),
	});
}

async function repositoryFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-media-checkout-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'native/framescaper-media-host'), { recursive: true });
	await mkdir(join(root, 'config'), { recursive: true });
	const targets = Object.fromEntries([
		['linux-x64', 'linux-x64'], ['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
		['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
	].map(([id, runtime]) => [id, {
		runtime, status: 'ci-generated', blockedBy: null, toolchainIdentity: null,
		buildResult: null, payload: null, isolationPayload: null,
	}]));
	const source = {
		hostVersion: '1.0.0', ffmpeg: { version: '9.0.1', sha256: SOURCE_IDENTITY.ffmpeg.archiveSha256 },
		targets,
	};
	await writeJson(join(root, 'native/framescaper-media-host/source-manifest.json'), source);
	await writeFile(join(root, 'native/framescaper-media-host/THIRD_PARTY_NOTICES.md'), NOTICES);
	await writeJson(join(root, 'config/framescaper-media-host-payload-manifest.json'),
		deriveFramescaperMediaHostPayloadManifest(source));
	git(root, ['init']);
	git(root, ['config', 'user.name', 'Test']);
	git(root, ['config', 'user.email', 'test@example.invalid']);
	git(root, ['add', '.']);
	git(root, ['commit', '-m', 'fixture']);
	return resolve(root);
}

function git(root, args) {
	const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`);
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
