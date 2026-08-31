/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { create as createTar } from 'tar';

import {
	MILESTONE_5_NATIVE_SOURCE_IDS,
	auditMilestone5NativeSourceAcquisitions,
	auditMilestone5NativeSourceAcquisitionsForProducts,
	authenticateMilestone5NativeSourceInput,
	isAuditedMilestone5NativeSourceAcquisitions,
	readMilestone5NativeSourceAcquisitions,
	removeMilestone5NativeSourceSnapshot,
	requireMilestone5NativeSource,
	snapshotMilestone5NativeSourceInput,
	verifyMilestone5NativeSourceInput,
} from '../scripts/lib/milestone-5-native-source-acquisitions.mjs';
import { collectExtractedSourceTree } from '../native/framescaper-media-host/build/source-authentication.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const EXPECTED_PINS = {
	'electron-node-api-headers': ['43.1.1', null, 344774,
		'b1112989ad4c4807a6bf59bfc96ce8d0f0b16962efe9818fa768e5908cc24d21'],
	juce: ['9.0.1', 'e18f7f506c0b96f2c738a0bcd7fe6467a5005ad8', 23609832,
		'1c43b675dcf3c99889fed6f68317873048b15449455974e22859275f17b2e69b'],
	clap: ['1.2.4', '00113aabdccf69c2e27ac269c35b369770e8fa73', 2351103,
		'0f937070e51d3ead11316e757995662a3ea846f81573e720b8e8f7fb63a03a35'],
	'vst3-sdk': ['3.8.0_build_66', '9fad9770f2ae8542ab1a548a68c1ad1ac690abe0', 325954,
		'121e1063962aea6e02817fec6bd3066162e22f262904c00b4be4e8a1fb3f826b'],
	'asio-sdk': ['2.3.4', null, 8910208,
		'd5ebf0c20dd2c5f43771fd0c1418f4b361bf52434ee670097cfa6b3a335e2eca'],
	lv2: ['1.18.10', '0bcde338db1c63bbc503b4d1f6d7b55ed43154af', 299434,
		'38d515cf1cb95d6f7d0191b8e383cbd95975a1ccec082d4e729eece7ec6a0c3e'],
	x264: ['stable-b35605ac', 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55', 1040327,
		'cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9'],
	x265: ['4.2', 'e444744c03978c1fb4e037168967020cf2648427', 1833442,
		'40b1ea0453e0309f0eba934e0ddf533f8f6295966679e8894e8f1c1c8d5e1210'],
	libvpx: ['1.16.0', '1024874c5919305883187e2953de8fcb4c3d7fa6', 5635379,
		'7a479a3c66b9f5d5542a4c6a1b7d3768a983b1e5c14c60a9396edc9b649e015c'],
	libopus: ['1.6', 'a8b13e40d751c7b40833b94fc9437c5c3439da89', 36317446,
		'b7637334527201fdfd6dd6a02e67aceffb0e5e60155bbd89175647a80301c92c'],
};
// Every pinned source is available to the build/test path. Human licensing and
// distribution licensing metadata is recorded separately.
const TEST_ACTIVATION_ENABLED = MILESTONE_5_NATIVE_SOURCE_IDS;

const EXPECTED_LICENSE_SELECTIONS = {
	'electron-node-api-headers': 'MIT',
	juce: 'AGPL-3.0-only',
	clap: 'MIT',
	'vst3-sdk': 'MIT',
	'asio-sdk': 'GPL-3.0-only',
	lv2: 'ISC',
	x264: 'GPL-2.0-or-later',
	x265: 'GPL-2.0-or-later',
	libvpx: 'BSD-3-Clause',
	libopus: 'BSD-3-Clause',
};

test('milestone-5 source packet pins and test-enables every native dependency', () => {
	const register = readMilestone5NativeSourceAcquisitions(repositoryRoot);

	assert.equal(register.schemaVersion, 1);
	assert.deepEqual(register.sources.map(({ id }) => id), MILESTONE_5_NATIVE_SOURCE_IDS);
	assert.equal(new Set(register.sources.map(({ id }) => id)).size, register.sources.length);
	for (const source of register.sources) {
		assert.deepEqual([
			source.version, source.git.commit, source.archive.byteLength, source.archive.sha256,
		], EXPECTED_PINS[source.id], source.id);
		assert.equal(source.licenseSelection, EXPECTED_LICENSE_SELECTIONS[source.id], source.id);
		assert.equal(source.authenticationStatus, 'pinned-metadata');
		if (['asio-sdk', 'electron-node-api-headers'].includes(source.id)) {
			assert.equal(source.git.commit, null);
		}
		else assert.match(source.git.commit, /^[a-f\d]{40}$/u, source.id);
		assert.match(source.archive.url, /^https:\/\//u, source.id);
		assert.match(source.archive.fileName, /\.(?:tar\.gz|zip)$/u, source.id);
		assert.ok(Number.isSafeInteger(source.archive.byteLength) && source.archive.byteLength > 0, source.id);
		assert.match(source.archive.sha256, /^[a-f\d]{64}$/u, source.id);
		assert.equal(source.extractedTree.algorithm, 'framescaper-portable-source-tree-sha256-v1');
		assert.ok(source.extractedTree.fileCount > 0, source.id);
		assert.match(source.extractedTree.sha256, /^[a-f\d]{64}$/u, source.id);
		assert.ok(TEST_ACTIVATION_ENABLED.includes(source.id), source.id);
		assert.equal(source.activationStatus, 'accepted', source.id);
		assert.equal(source.blockedBy, null, `${source.id} is test-enabled and cannot still name a blocker`);
		assert.ok(source.license.length > 0, source.id);
		assert.ok(source.licenseSelection.length > 0, source.id);
		assert.ok(source.uses.length > 0, source.id);
	}

	assert.equal(requireMilestone5NativeSource(register, 'juce').version, '9.0.1');
	assert.equal(requireMilestone5NativeSource(register, 'electron-node-api-headers').version, '43.1.1');
	assert.equal(requireMilestone5NativeSource(register, 'clap').version, '1.2.4');
	assert.equal(requireMilestone5NativeSource(register, 'vst3-sdk').version, '3.8.0_build_66');
	assert.equal(requireMilestone5NativeSource(register, 'asio-sdk').version, '2.3.4');
	assert.equal(requireMilestone5NativeSource(register, 'lv2').version, '1.18.10');
	assert.equal(requireMilestone5NativeSource(register, 'x265').version, '4.2');
	assert.equal(requireMilestone5NativeSource(register, 'libvpx').version, '1.16.0');
	assert.equal(requireMilestone5NativeSource(register, 'libopus').version, '1.6');

	assert.deepEqual(register.delegatedSources.map(({ id }) => id), [
		'boost-multiprecision',
		'ffmpeg',
		'ffmpeg-external-libraries',
		'openfx',
		'pipewire-public-headers',
	]);
	for (const source of register.delegatedSources) {
		assert.ok(readFileSync(join(repositoryRoot, source.manifestPath)).byteLength > 0, source.id);
	}
});

test('an absent source cache is audited as pending and cannot inherit checked-in authentication prose', () => {
	const audit = auditMilestone5NativeSourceAcquisitions(repositoryRoot, null);
	assert.equal(isAuditedMilestone5NativeSourceAcquisitions(audit), true);
	assert.equal(isAuditedMilestone5NativeSourceAcquisitions(structuredClone(audit)), false);
	assert.equal(audit.status, 'pending-external');
	assert.equal(audit.cacheRoot, null);
	assert.ok(audit.sources.every(({ authenticationStatus, authenticationBlockedBy }) => (
		authenticationStatus === 'pending-external' && authenticationBlockedBy.length > 0
	)));
});

test('Soundscaper source audit excludes every deferred Framescaper native input', () => {
	const audit = auditMilestone5NativeSourceAcquisitionsForProducts(
		repositoryRoot,
		['soundscaper'],
		null,
	);
	assert.deepEqual(audit.sources.map(({ id }) => id), [
		'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2',
	]);
	assert.deepEqual(audit.delegatedSources, []);
	assert.deepEqual(Object.keys(audit.inputDigests), [
		'config/milestone-5-native-source-acquisitions.json',
	]);
	assert.ok(!audit.sources.some(({ id }) => ['x264', 'x265', 'libvpx', 'libopus'].includes(id)));
});

test('source authentication binds one exact archive and extracted tree and rechecks mutable inputs', () => {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-m5-source-witness-'));
	try {
		const sourceRoot = join(root, 'source');
		mkdirSync(join(sourceRoot, 'include'), { recursive: true });
		writeFileSync(join(sourceRoot, 'README.md'), 'fixture source\n');
		writeFileSync(join(sourceRoot, 'include/api.h'), 'fixture api\n');
		const tree = collectExtractedSourceTree(sourceRoot);
		const archiveName = 'juce-fixture.tar.gz';
		const archivePath = join(root, archiveName);
		createTar({ cwd: root, file: archivePath, gzip: true, sync: true }, ['source']);
		const archiveBytes = readFileSync(archivePath);
		const register = structuredClone(readMilestone5NativeSourceAcquisitions(repositoryRoot));
		const juce = register.sources.find(({ id }) => id === 'juce');
		juce.archive.fileName = archiveName;
		juce.archive.byteLength = archiveBytes.byteLength;
		juce.archive.sha256 = sha256(archiveBytes);
		juce.extractedTree = {
			algorithm: tree.algorithm,
			fileCount: tree.fileCount,
			sha256: tree.sha256,
		};
		const manifestPath = join(root, 'register.json');
		writeFileSync(manifestPath, `${JSON.stringify(register, null, 2)}\n`);
		const witness = authenticateMilestone5NativeSourceInput({
			repositoryRoot,
			manifestPath,
			sourceId: 'juce',
			archivePath,
			sourceRoot,
		});
		assert.equal(witness.id, 'juce');
		assert.equal(witness.archive.sha256, sha256(archiveBytes));
		assert.equal(verifyMilestone5NativeSourceInput(witness).extractedTree.sha256, tree.sha256);
		const snapshot = snapshotMilestone5NativeSourceInput(witness, {
			snapshotRoot: join(root, 'auditor-snapshot'),
		});
		assert.equal(snapshot.extractedTree.root, join(root, 'auditor-snapshot'));
		assert.equal(verifyMilestone5NativeSourceInput(snapshot).extractedTree.sha256, tree.sha256);
		writeFileSync(join(sourceRoot, 'include/api.h'), 'mutable cache changed\n');
		assert.equal(verifyMilestone5NativeSourceInput(snapshot).extractedTree.sha256, tree.sha256);
		chmodSync(join(snapshot.extractedTree.root, 'include/api.h'), 0o600);
		writeFileSync(join(snapshot.extractedTree.root, 'include/api.h'), 'snapshot tampered\n');
		assert.throws(() => verifyMilestone5NativeSourceInput(snapshot), /changed after authentication/iu);
		removeMilestone5NativeSourceSnapshot(snapshot);
		writeFileSync(join(sourceRoot, 'include/api.h'), 'fixture api\n');
		assert.throws(
			() => verifyMilestone5NativeSourceInput(structuredClone(witness)),
			/authenticated in-process witness/iu,
		);
		const foreignRoot = join(root, 'foreign');
		const foreignSource = join(foreignRoot, 'source');
		mkdirSync(foreignSource, { recursive: true });
		writeFileSync(join(foreignSource, 'foreign.txt'), 'different pinned tree\n');
		const foreignArchive = join(foreignRoot, archiveName);
		createTar({ cwd: foreignRoot, file: foreignArchive, gzip: true, sync: true }, ['source']);
		const foreignBytes = readFileSync(foreignArchive);
		juce.archive.byteLength = foreignBytes.byteLength;
		juce.archive.sha256 = sha256(foreignBytes);
		writeFileSync(manifestPath, `${JSON.stringify(register, null, 2)}\n`);
		assert.throws(() => authenticateMilestone5NativeSourceInput({
			repositoryRoot,
			manifestPath,
			sourceId: 'juce',
			archivePath: foreignArchive,
			sourceRoot,
		}), /archive extraction drifted/iu);
		writeFileSync(join(sourceRoot, 'include/api.h'), 'changed api\n');
		assert.throws(() => verifyMilestone5NativeSourceInput(witness), /changed after authentication/iu);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('source packet rejects duplicate, missing, malformed, or activated source records', () => {
	const register = readMilestone5NativeSourceAcquisitions(repositoryRoot);
	for (const mutate of [
		(value) => value.sources.pop(),
		(value) => value.sources.push(structuredClone(value.sources[0])),
		(value) => { value.sources[0].archive.sha256 = '0'.repeat(63); },
		(value) => { value.sources[0].authenticationStatus = 'authenticated'; },
		(value) => { value.sources.find(({ id }) => id === 'x264').archive.sha256 = '0'.repeat(64); },
		(value) => { value.sources[0].activationStatus = 'enabled'; },
		(value) => { value.delegatedSources[0].manifestPath = '../outside.json'; },
	]) {
		const root = mkdtempSync(join(tmpdir(), 'soundscaper-m5-sources-'));
		try {
			const changed = structuredClone(register);
			mutate(changed);
			writeFileSync(join(root, 'register.json'), `${JSON.stringify(changed)}\n`);
			assert.throws(
				() => readMilestone5NativeSourceAcquisitions(root, 'register.json'),
				/Error/u,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
	assert.throws(() => requireMilestone5NativeSource(register, 'not-a-source'), /not pinned/u);
});

test('every pinned archive URL can actually satisfy its byte-exact pin', () => {
	// A Gitiles `+archive` tarball is generated per request and its gzip
	// container is not reproducible, so byteLength/sha256 recorded from one
	// fetch never match the next one and the source can never authenticate —
	// which is how the libvpx row sat permanently unauthenticatable while its
	// extracted-tree identity was correct all along. Pin such upstreams to a
	// byte-stable mirror instead.
	const register = readMilestone5NativeSourceAcquisitions(repositoryRoot);
	const delegated = JSON.parse(readFileSync(
		resolve(repositoryRoot, 'native/framescaper-media-host/build/ffmpeg-9.0.1-external-sources.json'),
		'utf8',
	));
	const pinned = [
		...register.sources.map(({ id, archive }) => [id, archive.url]),
		...delegated.libraries.map(({ id, url }) => [`ffmpeg-external:${id}`, url]),
	];
	for (const [id, url] of pinned) {
		assert.equal(
			/\/\+archive\//u.test(url), false,
			`${id} is pinned to an on-demand Gitiles archive, whose bytes differ per fetch: ${url}`,
		);
	}
});

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
