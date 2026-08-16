/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	NATIVE_ADDON_PAYLOAD_MANIFEST_PATH,
	NATIVE_HELPER_ADDON_TARGETS,
	canonicalJson,
	deriveNativeAddonPayloadManifest,
	nativeAddonPayloadStageSummary,
	repinNativeAddonPayloadManifest,
	serializeNativeAddonPayloadManifest,
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
	verifyStagedNativeAddonPayload,
} from '../scripts/lib/native-addon-payload-manifest.mjs';
import {
	NATIVE_HELPER_ADDON_ROOT,
	readNativeHelperAddonSourceManifest,
} from '../scripts/lib/native-helper-addon-build.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const BUILT_TARGET = 'linux-x64';
const PENDING_TARGET = 'win-arm64';

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-payload-manifest-'));
	mkdirSync(join(root, 'config'), { recursive: true });
	cpSync(join(repositoryRoot, NATIVE_HELPER_ADDON_ROOT), join(root, NATIVE_HELPER_ADDON_ROOT), { recursive: true });
	cpSync(
		join(repositoryRoot, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH),
		join(root, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH),
	);
	return root;
}

async function withFixture(body) {
	const root = createFixture();
	try {
		return await body(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

async function stageRoot(release) {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-payload-stage-'));
	const outputRoot = join(root, 'runtime', 'native', release.target.id);
	await stageVerifiedNativeAddonPayload({ release, outputRoot });
	return { root, outputRoot };
}

test('the checked-in payload manifest verifies for every claimed target', async () => {
	for (const target of NATIVE_HELPER_ADDON_TARGETS) {
		const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: target.id });
		assert.equal(release.target.id, target.id);
		assert.equal(release.target.status === 'built', release.payload !== null);
	}
});

test('the shipped manifest is exactly the manifest derived from the pinned source manifest', () => {
	const derived = deriveNativeAddonPayloadManifest(readNativeHelperAddonSourceManifest(repositoryRoot));
	const shipped = readFileSync(join(repositoryRoot, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH), 'utf8');
	assert.equal(shipped, serializeNativeAddonPayloadManifest(derived));
});

test('a target is required and is never inferred from the build host', async () => {
	await assert.rejects(
		() => verifyNativeAddonPayloadManifest({ repositoryRoot }),
		/target is required and never inferred/u,
	);
	await assert.rejects(
		() => verifyNativeAddonPayloadManifest({ repositoryRoot, target: 'mac-x64' }),
		/has no mac-x64 target/u,
	);
});

test('a payload manifest that drifts from the source manifest is rejected', async () => {
	await withFixture(async (root) => {
		const path = join(root, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH);
		const manifest = JSON.parse(readFileSync(path, 'utf8'));
		manifest.addon.version = '9.9.9';
		writeFileSync(path, serializeNativeAddonPayloadManifest(manifest));
		await assert.rejects(
			() => verifyNativeAddonPayloadManifest({ repositoryRoot: root, target: BUILT_TARGET }),
			/disagrees with the pinned source manifest/u,
		);
	});
});

test('a tampered payload on disk fails verification before anything is staged', async () => {
	await withFixture(async (root) => {
		const payload = join(root, NATIVE_HELPER_ADDON_ROOT, 'prebuilt', BUILT_TARGET, 'soundscaper_helper.node');
		const bytes = readFileSync(payload);
		bytes[bytes.length - 1] ^= 0xff;
		writeFileSync(payload, bytes);
		await assert.rejects(
			() => verifyNativeAddonPayloadManifest({ repositoryRoot: root, target: BUILT_TARGET }),
			/native addon payload linux-x64 digest mismatch/u,
		);
	});
});

test('a built target stages its payload and its manifest, and the staged tree re-verifies', async () => {
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: BUILT_TARGET });
	const { root, outputRoot } = await stageRoot(release);
	try {
		assert.deepEqual(
			(await readdir(outputRoot)).sort(),
			['native-addon-payload-manifest.json', 'soundscaper_helper.node'],
		);
		const summary = await verifyStagedNativeAddonPayload({ release, outputRoot });
		assert.equal(summary.target, BUILT_TARGET);
		assert.equal(summary.status, 'built');
		assert.equal(summary.payload.sha256, release.payload.sha256);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a pending-external target stages no payload and reports its named blocker', async () => {
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: PENDING_TARGET });
	assert.equal(release.payload, null);
	const { root, outputRoot } = await stageRoot(release);
	try {
		assert.deepEqual(await readdir(outputRoot), ['native-addon-payload-manifest.json']);
		const summary = await verifyStagedNativeAddonPayload({ release, outputRoot });
		assert.equal(summary.payload, null);
		assert.equal(summary.status, 'pending-external');
		assert.match(summary.blockedBy, /build host is provisioned/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('tampering the staged payload, manifest or inventory each fails closed', async () => {
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: BUILT_TARGET });
	for (const [label, mutate, pattern] of [
		['payload', (dir) => {
			const path = join(dir, 'soundscaper_helper.node');
			const bytes = readFileSync(path);
			bytes[0] ^= 0xff;
			writeFileSync(path, bytes);
		}, /staged native addon payload linux-x64 digest mismatch/u],
		['manifest', (dir) => {
			writeFileSync(join(dir, 'native-addon-payload-manifest.json'), '{"schemaVersion":1}\n');
		}, /does not match the verified policy manifest/u],
		['inventory', (dir) => {
			writeFileSync(join(dir, 'extra.node'), 'extra');
		}, /Staged native addon payload inventory mismatch/u],
	]) {
		const { root, outputRoot } = await stageRoot(release);
		try {
			mutate(outputRoot);
			await assert.rejects(
				() => verifyStagedNativeAddonPayload({ release, outputRoot }),
				pattern,
				`the ${label} tamper must be rejected`,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

test('a stage manifest that omits or alters the native addon summary is rejected', async () => {
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: BUILT_TARGET });
	const { root, outputRoot } = await stageRoot(release);
	try {
		const stageManifestPath = join(root, 'stage-manifest.json');
		await writeFile(stageManifestPath, JSON.stringify({ nativeAddons: nativeAddonPayloadStageSummary(release) }));
		assert.equal((await verifyStagedNativeAddonPayload({ release, outputRoot, stageManifestPath })).target, BUILT_TARGET);
		await writeFile(stageManifestPath, JSON.stringify({ nativeAddons: null }));
		await assert.rejects(
			() => verifyStagedNativeAddonPayload({ release, outputRoot, stageManifestPath }),
			/does not retain the verified native addon payload summary/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a hand-built release object cannot stand in for a verified one', async () => {
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: BUILT_TARGET });
	const forged = { ...release };
	assert.equal(Object.getOwnPropertySymbols(release).length, 0);
	assert.throws(() => nativeAddonPayloadStageSummary(forged), /verified native addon payload release is required/u);
	await assert.rejects(
		() => stageVerifiedNativeAddonPayload({ release: forged, outputRoot: join(tmpdir(), 'never-created') }),
		/verified native addon payload release is required/u,
	);
});

test('repinning the payload manifest is a no-op while the source manifest is unchanged', async () => {
	await withFixture(async (root) => {
		const before = readFileSync(join(root, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH), 'utf8');
		await repinNativeAddonPayloadManifest({ repositoryRoot: root });
		assert.equal(readFileSync(join(root, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH), 'utf8'), before);
	});
});

test('the stage summary carries the manifest digest so a swapped policy is detectable', async () => {
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: BUILT_TARGET });
	const summary = nativeAddonPayloadStageSummary(release);
	assert.equal(summary.payloadManifest.sha256, createHash('sha256').update(release.manifestBytes).digest('hex'));
	assert.equal(canonicalJson(summary), canonicalJson(nativeAddonPayloadStageSummary(release)));
});
