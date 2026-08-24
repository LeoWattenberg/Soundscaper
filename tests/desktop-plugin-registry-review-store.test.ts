/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { authenticatePluginBinary } from '../desktop/plugin-binary-authentication.mjs';
import { createPluginRegistryReviewStore } from '../desktop/plugin-registry-review-store.mjs';
import {
	DesktopPluginRegistry,
	entryIdFor,
	installationIdFor,
} from '../desktop/plugin-registry.ts';

test('restart lazily rehashes one reviewed candidate without scanning at startup', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-plugin-review-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const binaryPath = join(root, 'effect.clap');
	const reviewPath = join(root, 'native-plugin-review-v1.json');
	const bytes = Buffer.from('exact native plug-in body');
	await writeFile(binaryPath, bytes);
	const identity = await stat(binaryPath);
	const observation = {
		format: 'clap' as const,
		stableId: 'org.example.effect', bundleStableIds: ['org.example.effect'],
		name: 'Effect', vendor: 'Example', version: '1.0.0',
		platform: process.platform, architecture: process.arch,
		binaryPath, binaryBytes: bytes.byteLength,
		binarySha256: createHash('sha256').update(bytes).digest('hex'),
		identity: { dev: Number(identity.dev), ino: Number(identity.ino) },
		classification: 'effect' as const,
		topologies: [{ inputChannels: 2, outputChannels: 2 }],
		realtimeSupported: true, offlineSupported: true, reportedLatencyFrames: 32,
		signature: 'unsigned' as const, compatibility: 'compatible' as const, descriptorVersion: 1,
	};
	const firstRegistry = registry();
	const admission = firstRegistry.record(observation);
	assert.equal(admission.status, 'recorded');
	if (admission.status !== 'recorded') throw new Error('unreachable');
	const fileSystem = { writeFile: (path: string, value: string) => writeFile(path, value) };
	const firstStore = createPluginRegistryReviewStore({
		filePath: reviewPath, fileSystem, authenticateBinary: authenticatePluginBinary,
	});
	firstStore.observe(observation, admission);
	firstRegistry.allow(admission.installationId);
	await firstStore.capture(firstRegistry);
	assert.equal(JSON.parse(await readFile(reviewPath, 'utf8')).records.length, 1);

	const restarted = registry();
	const restartedStore = createPluginRegistryReviewStore({
		filePath: reviewPath, fileSystem, authenticateBinary: authenticatePluginBinary,
	});
	assert.deepEqual(restarted.describe().entries, [], 'opening the store performs no scan or inventory admission');
	assert.equal(await restartedStore.rebind(restarted, admission.installationId), true);
	assert.equal(restarted.describe().entries[0]?.installations[0]?.reviewed, true);
	assert.equal(restarted.hostGrantFor(admission.installationId).binarySha256, observation.binarySha256);

	await writeFile(binaryPath, Buffer.from('changed native plug-in body'));
	const changedRestart = registry();
	assert.equal(await restartedStore.rebind(changedRestart, admission.installationId), false);
	assert.deepEqual(changedRestart.describe().entries, []);
});

test('restart preserves independent reviews for every descriptor in one bundle', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-plugin-review-multi-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const binaryPath = join(root, 'multi.clap');
	const reviewPath = join(root, 'native-plugin-review-v1.json');
	const bytes = Buffer.from('one bundle with two descriptors');
	await writeFile(binaryPath, bytes);
	const metadata = await stat(binaryPath);
	const binarySha256 = createHash('sha256').update(bytes).digest('hex');
	const stableIds = ['org.example.delay', 'org.example.reverb'] as const;
	const observations = stableIds.map((stableId) => ({
		format: 'clap' as const, stableId, bundleStableIds: stableIds,
		name: stableId, vendor: 'Example', version: '1.0.0', platform: process.platform,
		architecture: process.arch, binaryPath, binaryBytes: bytes.byteLength, binarySha256,
		identity: { dev: Number(metadata.dev), ino: Number(metadata.ino) }, classification: 'effect' as const,
		topologies: [{ inputChannels: 2, outputChannels: 2 }], realtimeSupported: true,
		offlineSupported: true, reportedLatencyFrames: 0, signature: 'unsigned' as const,
		compatibility: 'compatible' as const, descriptorVersion: 1,
	}));
	const first = registry();
	const store = createPluginRegistryReviewStore({
		filePath: reviewPath, fileSystem: { writeFile: (path: string, value: string) => writeFile(path, value) },
		authenticateBinary: authenticatePluginBinary,
	});
	const admissions = observations.map((observation) => {
		const admission = first.record(observation);
		assert.equal(admission.status, 'recorded');
		if (admission.status !== 'recorded') throw new Error('unreachable');
		store.observe(observation, admission);
		first.allow(admission.installationId);
		return admission;
	});
	await store.capture(first);
	assert.equal(JSON.parse(await readFile(reviewPath, 'utf8')).records.length, 2);
	const restarted = registry();
	const reopened = createPluginRegistryReviewStore({
		filePath: reviewPath, fileSystem: { writeFile: (path: string, value: string) => writeFile(path, value) },
		authenticateBinary: authenticatePluginBinary,
	});
	for (const admission of admissions) assert.equal(await reopened.rebind(restarted, admission.installationId), true);
	assert.deepEqual(admissions.map(({ installationId }) => restarted.hostGrantFor(installationId).stableId), stableIds);
});

test('a v2 singleton review migrates to the descriptor-specific installation identity', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-plugin-review-v2-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const binaryPath = join(root, 'legacy.clap');
	const reviewPath = join(root, 'native-plugin-review-v1.json');
	const bytes = Buffer.from('legacy reviewed singleton');
	await writeFile(binaryPath, bytes);
	const metadata = await stat(binaryPath);
	const digest = createHash('sha256').update(bytes).digest('hex');
	const stableId = 'org.example.legacy';
	const observation = {
		format: 'clap', stableId, name: 'Legacy', vendor: 'Example', version: '1',
		platform: process.platform, architecture: process.arch, binaryPath,
		binaryBytes: bytes.byteLength, binarySha256: digest,
		identity: { dev: Number(metadata.dev), ino: Number(metadata.ino) }, classification: 'effect',
		topologies: [{ inputChannels: 2, outputChannels: 2 }], realtimeSupported: true,
		offlineSupported: true, reportedLatencyFrames: 0, signature: 'unsigned',
		compatibility: 'compatible', descriptorVersion: 1,
	};
	const oldInstallationId = `i${createHash('sha256').update(digest).digest('hex').slice(0, 15)}`;
	await writeFile(reviewPath, JSON.stringify({ schemaVersion: 2, records: [{
		digest, entryId: entryIdFor('clap', stableId), installationId: oldInstallationId,
		reviewed: true, selected: false, observation,
	}] }));
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const store = createPluginRegistryReviewStore({
		filePath: reviewPath, fileSystem: { writeFile: (path: string, value: string) => writeFile(path, value) },
		authenticateBinary: authenticatePluginBinary,
	});
	const migratedId = installationIdFor(digest, stableId);
	assert.equal(await store.rebind(registry, migratedId), true);
	assert.equal(registry.hostGrantFor(migratedId).stableId, stableId);
});

function registry(): DesktopPluginRegistry {
	return new DesktopPluginRegistry({ isQuarantined: () => false });
}
