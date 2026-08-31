/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { access, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { deriveFramescaperMediaHostPayloadManifest } from '../scripts/lib/framescaper-media-host-build.mjs';
import { deriveFramescaperOpenFxPayloadManifest } from '../scripts/lib/framescaper-openfx-host-build.mjs';
import {
	framescaperNativeHostPayloadStageSummary,
	stageVerifiedFramescaperNativeHostPayloads,
	verifyFramescaperNativeHostPayloads,
	verifyStagedFramescaperNativeHostPayloads,
} from '../scripts/lib/framescaper-native-host-payload-staging.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const TARGET = 'linux-x64';
const MEDIA_ROOT = 'native/framescaper-media-host';
const OPENFX_ROOT = 'native/framescaper-openfx-host';
const MEDIA_PATH = `${MEDIA_ROOT}/prebuilt/${TARGET}/framescaper-media-host`;
const MEDIA_FILES = Object.freeze([
	[MEDIA_PATH, Buffer.from('verified-media-host')],
	[`${MEDIA_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-launcher`, Buffer.from('media-launcher')],
	[`${MEDIA_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-profile.json`, Buffer.from('media-profile')],
	[`${MEDIA_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-broker.json`, Buffer.from('media-broker')],
	[`${MEDIA_ROOT}/prebuilt/${TARGET}/lib/libframescaper-media.so`, Buffer.from('media-library')],
]);
const OPENFX_FILES = Object.freeze([
	[`${OPENFX_ROOT}/prebuilt/${TARGET}/bin/framescaper-ofx-scanner`, Buffer.from('verified-ofx-scanner')],
	[`${OPENFX_ROOT}/prebuilt/${TARGET}/bin/framescaper-ofx-runtime-host`, Buffer.from('verified-ofx-runtime')],
	[`${OPENFX_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-launcher`, Buffer.from('ofx-launcher')],
	[`${OPENFX_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-profile.json`, Buffer.from('ofx-profile')],
	[`${OPENFX_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-broker.json`, Buffer.from('ofx-broker')],
	[`${OPENFX_ROOT}/prebuilt/${TARGET}/lib/ld-linux-x86-64.so.2`, Buffer.from('ofx-loader')],
]);

test('pending current targets stage no native-host target directories', async (context) => {
	const repositoryRoot = fixture(context, false);
	const outputRoot = temporaryRoot(context, 'framescaper-pending-stage-');
	const release = await verifyFramescaperNativeHostPayloads({
		repositoryRoot, target: TARGET, targetSource: 'build-host',
	});
	const summary = await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	assert.deepEqual(summary, framescaperNativeHostPayloadStageSummary(release));
	await assert.rejects(access(join(outputRoot, 'native/framescaper-media-host', TARGET)));
	await assert.rejects(access(join(outputRoot, 'native/framescaper-openfx-host', TARGET)));
	await assert.doesNotReject(() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }));
});

test('built targets stage only their closed payload and isolation inventories', async (context) => {
	const repositoryRoot = fixture(context, true);
	const outputRoot = temporaryRoot(context, 'framescaper-built-stage-');
	const release = await verifyFramescaperNativeHostPayloads({ repositoryRoot, target: TARGET });
	const summary = await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	assert.deepEqual(Object.keys(summary.mediaHost).sort(), ['blockedBy', 'payloadManifest', 'payloads', 'status']);
	assert.deepEqual(Object.keys(summary.openFxHost).sort(), ['blockedBy', 'payloadManifest', 'payloads', 'status']);
	assert.deepEqual((await readdir(join(outputRoot, 'native/framescaper-media-host', TARGET))).sort(), [
		'framescaper-media-host', 'libframescaper-media.so',
		'milestone5-native-isolation-broker.json', 'milestone5-native-isolation-launcher',
		'milestone5-native-isolation-profile.json',
	]);
	assert.deepEqual((await readdir(join(outputRoot, 'native/framescaper-openfx-host', TARGET))).sort(), [
		'framescaper-ofx-runtime-host', 'framescaper-ofx-scanner', 'ld-linux-x86-64.so.2',
		'milestone5-native-isolation-broker.json', 'milestone5-native-isolation-launcher',
		'milestone5-native-isolation-profile.json',
	]);
	await assert.doesNotReject(() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }));
	await assert.rejects(
		() => stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot }),
		/already exists/iu,
	);
});

test('source tamper and open manifest rows fail before staging', async (context) => {
	const tampered = fixture(context, true);
	writeFileSync(join(tampered, MEDIA_PATH), 'changed');
	await assert.rejects(
		() => verifyFramescaperNativeHostPayloads({ repositoryRoot: tampered, target: TARGET }),
		/media-host.*(?:byte length|digest)/iu,
	);
	const opened = fixture(context, true);
	const manifestPath = join(opened, 'config/framescaper-openfx-host-payload-manifest.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	manifest.targets[0].productionReadiness = null;
	writeJson(manifestPath, manifest);
	await assert.rejects(
		() => verifyFramescaperNativeHostPayloads({ repositoryRoot: opened, target: TARGET }),
		/OpenFX.*manifest/iu,
	);
});

test('staged substitution, extra files, and an altered stage summary fail closed', async (context) => {
	const repositoryRoot = fixture(context, true);
	const release = await verifyFramescaperNativeHostPayloads({ repositoryRoot, target: TARGET });
	for (const [name, mutate, pattern] of [
		['payload', (root) => writeFile(join(root, 'native/framescaper-media-host', TARGET,
			'framescaper-media-host'), 'changed'), /media-host.*(?:byte length|digest)/iu],
		['inventory', (root) => writeFile(join(root, 'native/framescaper-openfx-host', TARGET,
			'extra'), 'extra'), /inventory/iu],
	]) {
		const outputRoot = temporaryRoot(context, `framescaper-staged-${name}-`);
		await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
		await mutate(outputRoot);
		await assert.rejects(
			() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }), pattern,
		);
	}
	const outputRoot = temporaryRoot(context, 'framescaper-stage-summary-');
	await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	const stageManifestPath = join(outputRoot, 'stage-manifest.json');
	await writeFile(stageManifestPath, JSON.stringify({ framescaperNativeHosts: null }));
	await assert.rejects(
		() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot, stageManifestPath }),
		/stage manifest.*native-host summary/iu,
	);
});

function fixture(context, built) {
	const root = temporaryRoot(context, `framescaper-${built ? 'built' : 'pending'}-fixture-`);
	mkdirSync(join(root, 'config'), { recursive: true });
	cpSync(join(REPOSITORY_ROOT, MEDIA_ROOT), join(root, MEDIA_ROOT), { recursive: true });
	cpSync(join(REPOSITORY_ROOT, OPENFX_ROOT), join(root, OPENFX_ROOT), { recursive: true });
	cpSync(join(REPOSITORY_ROOT, 'config/boost-multiprecision-source-manifest.json'),
		join(root, 'config/boost-multiprecision-source-manifest.json'));
	cpSync(join(REPOSITORY_ROOT, '.gitattributes'), join(root, '.gitattributes'));
	if (built) {
		for (const [path, bytes] of [...MEDIA_FILES, ...OPENFX_FILES]) {
			mkdirSync(resolve(root, path, '..'), { recursive: true });
			writeFileSync(join(root, path), bytes);
		}
	}
	const mediaPath = join(root, MEDIA_ROOT, 'source-manifest.json');
	const media = JSON.parse(readFileSync(mediaPath, 'utf8'));
	if (built) media.targets[TARGET] = {
		runtime: TARGET, status: 'built', blockedBy: null,
		toolchainIdentity: digest(Buffer.from('media-toolchain')),
		payload: descriptor(...MEDIA_FILES[0]),
		isolationPayload: {
			launcherPayload: descriptor(...MEDIA_FILES[1]),
			sandboxProfilePayload: descriptor(...MEDIA_FILES[2]),
			brokerPolicyPayload: descriptor(...MEDIA_FILES[3]),
			runtimeLibraryPayloads: [descriptor(...MEDIA_FILES[4])],
		},
	};
	writeJson(mediaPath, media);
	writeJson(join(root, 'config/framescaper-media-host-payload-manifest.json'),
		deriveFramescaperMediaHostPayloadManifest(media));
	const openFxPath = join(root, OPENFX_ROOT, 'source-manifest.json');
	const openFx = JSON.parse(readFileSync(openFxPath, 'utf8'));
	if (built) openFx.targets[TARGET] = {
		runtime: TARGET, status: 'built', blockedBy: null,
		toolchainIdentity: digest(Buffer.from('openfx-toolchain')),
		scannerPayload: descriptor(...OPENFX_FILES[0]),
		runtimeHostPayload: descriptor(...OPENFX_FILES[1]),
		isolationPayload: {
			launcherPayload: descriptor(...OPENFX_FILES[2]),
			sandboxProfilePayload: descriptor(...OPENFX_FILES[3]),
			brokerPolicyPayload: descriptor(...OPENFX_FILES[4]),
			runtimeLibraryPayloads: [descriptor(...OPENFX_FILES[5])],
		},
	};
	writeJson(openFxPath, openFx);
	writeJson(join(root, 'config/framescaper-openfx-host-payload-manifest.json'),
		deriveFramescaperOpenFxPayloadManifest(openFx));
	return root;
}

function temporaryRoot(context, prefix) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function descriptor(path, bytes) {
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes) };
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}
