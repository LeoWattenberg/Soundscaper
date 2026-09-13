/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { authenticatePluginBinary } from '../desktop/plugin-binary-authentication.mjs';
import { createPluginRegistryAllowanceStore } from '../desktop/plugin-registry-allowance-store.mjs';
import {
	DesktopPluginRegistry,
	entryIdFor,
	installationIdFor,
} from '../desktop/plugin-registry.ts';

test('restart lazily rehashes one allowed candidate without scanning at startup', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-plugin-allowance-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const binaryPath = join(root, 'effect.clap');
	const allowancePath = join(root, 'native-plugin-allowance-v1.json');
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
		compatibility: 'compatible' as const, descriptorVersion: 1,
	};
	const firstRegistry = registry();
	const admission = firstRegistry.record(observation);
	assert.equal(admission.status, 'recorded');
	if (admission.status !== 'recorded') throw new Error('unreachable');
	const fileSystem = { writeFile: (path: string, value: string) => writeFile(path, value) };
	const firstStore = createPluginRegistryAllowanceStore({
		filePath: allowancePath, fileSystem, authenticateBinary: authenticatePluginBinary,
	});
	firstStore.observe(observation, admission);
	firstRegistry.allow(admission.installationId);
	await firstStore.capture(firstRegistry);
	const stored = JSON.parse(await readFile(allowancePath, 'utf8'));
	assert.equal(stored.schemaVersion, 4);
	assert.equal(stored.records.length, 1);
	assert.equal(stored.records[0].allowed, true);
	assert.equal(Object.hasOwn(stored.records[0], 'reviewed'), false);
	assert.equal(Object.hasOwn(stored.records[0].observation, 'signature'), false);

	const restarted = registry();
	const restartedStore = createPluginRegistryAllowanceStore({
		filePath: allowancePath, fileSystem, authenticateBinary: authenticatePluginBinary,
	});
	assert.deepEqual(restarted.describe().entries, [], 'opening the store performs no scan or inventory admission');
	assert.equal(await restartedStore.rebind(restarted, admission.installationId), true);
	assert.equal(restarted.describe().entries[0]?.installations[0]?.allowed, true);
	assert.equal(restarted.hostGrantFor(admission.installationId).binarySha256, observation.binarySha256);

	await writeFile(binaryPath, Buffer.from('changed native plug-in body'));
	const changedRestart = registry();
	assert.equal(await restartedStore.rebind(changedRestart, admission.installationId), false);
	assert.deepEqual(changedRestart.describe().entries, []);
});

test('restart preserves independent allowances for every descriptor in one bundle', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-plugin-allowance-multi-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const binaryPath = join(root, 'multi.clap');
	const allowancePath = join(root, 'native-plugin-allowance-v1.json');
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
		offlineSupported: true, reportedLatencyFrames: 0,
		compatibility: 'compatible' as const, descriptorVersion: 1,
	}));
	const first = registry();
	const store = createPluginRegistryAllowanceStore({
		filePath: allowancePath, fileSystem: { writeFile: (path: string, value: string) => writeFile(path, value) },
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
	assert.equal(JSON.parse(await readFile(allowancePath, 'utf8')).records.length, 2);
	const restarted = registry();
	const reopened = createPluginRegistryAllowanceStore({
		filePath: allowancePath, fileSystem: { writeFile: (path: string, value: string) => writeFile(path, value) },
		authenticateBinary: authenticatePluginBinary,
	});
	for (const admission of admissions) assert.equal(await reopened.rebind(restarted, admission.installationId), true);
	assert.deepEqual(admissions.map(({ installationId }) => restarted.hostGrantFor(installationId).stableId), stableIds);
});

test('a v2 singleton allowance migrates to the descriptor-specific installation identity', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-plugin-review-v2-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const binaryPath = join(root, 'legacy.clap');
	const reviewPath = join(root, 'native-plugin-review-v1.json');
	const allowancePath = join(root, 'native-plugin-allowance-v1.json');
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
	const store = createPluginRegistryAllowanceStore({
		filePath: allowancePath, legacyFilePath: reviewPath,
		fileSystem: { writeFile: (path: string, value: string) => writeFile(path, value) },
		authenticateBinary: authenticatePluginBinary,
	});
	const migratedId = installationIdFor(digest, stableId);
	assert.equal(await store.rebind(registry, migratedId), true);
	assert.equal(registry.hostGrantFor(migratedId).stableId, stableId);
	await store.capture(registry);
	const migrated = JSON.parse(await readFile(allowancePath, 'utf8'));
	assert.equal(migrated.schemaVersion, 4);
	assert.equal(migrated.records[0].allowed, true);
	assert.equal(Object.hasOwn(migrated.records[0], 'reviewed'), false);
	assert.equal(Object.hasOwn(migrated.records[0].observation, 'signature'), false);
});

test('a v3 allowance keeps its descriptor identity while discarding legacy signature data', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-plugin-allowance-v3-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const binaryPath = join(root, 'legacy.clap');
	const legacyFilePath = join(root, 'native-plugin-review-v1.json');
	const filePath = join(root, 'native-plugin-allowance-v1.json');
	const bytes = Buffer.from('legacy descriptor allowance');
	await writeFile(binaryPath, bytes);
	const metadata = await stat(binaryPath);
	const digest = createHash('sha256').update(bytes).digest('hex');
	const stableId = 'org.example.legacy-v3';
	const observation = {
		format: 'clap', stableId, bundleStableIds: [stableId], name: 'Legacy', vendor: 'Example', version: '1',
		platform: process.platform, architecture: process.arch, binaryPath,
		binaryBytes: bytes.byteLength, binarySha256: digest,
		identity: { dev: Number(metadata.dev), ino: Number(metadata.ino) }, classification: 'effect',
		topologies: [{ inputChannels: 2, outputChannels: 2 }], realtimeSupported: true,
		offlineSupported: true, reportedLatencyFrames: 0, signature: 'signed-valid',
		compatibility: 'compatible', descriptorVersion: 1,
	};
	const installationId = installationIdFor(digest, stableId);
	await writeFile(legacyFilePath, JSON.stringify({ schemaVersion: 3, records: [{
		digest, entryId: entryIdFor('clap', stableId), installationId,
		reviewed: true, selected: false, observation,
	}] }));
	const reopened = registry();
	const store = createPluginRegistryAllowanceStore({
		filePath, legacyFilePath,
		fileSystem: { writeFile: (path: string, value: string) => writeFile(path, value) },
		authenticateBinary: authenticatePluginBinary,
	});
	assert.equal(await store.rebind(reopened, installationId), true);
	assert.equal(reopened.describe().entries[0]?.installations[0]?.allowed, true);
	await store.capture(reopened);
	const migrated = JSON.parse(await readFile(filePath, 'utf8'));
	assert.equal(migrated.schemaVersion, 4);
	assert.equal(Object.hasOwn(migrated.records[0].observation, 'signature'), false);
});

test('an existing allowance file never falls back to the legacy store', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-plugin-allowance-precedence-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	context.mock.method(console, 'error', () => undefined);
	const filePath = join(root, 'native-plugin-allowance-v1.json');
	const legacyFilePath = join(root, 'native-plugin-review-v1.json');
	const installationId = `i${'1'.repeat(15)}`;
	await writeFile(legacyFilePath, JSON.stringify({ schemaVersion: 3, records: [{
		digest: 'a'.repeat(64), entryId: `e${'2'.repeat(15)}`, installationId,
		reviewed: true, selected: false,
		observation: { binaryPath: '/legacy', binaryBytes: 1, binarySha256: 'a'.repeat(64),
			stableId: 'legacy', bundleStableIds: ['legacy'], signature: 'signed-valid' },
	}] }));
	let authentications = 0;
	const open = () => createPluginRegistryAllowanceStore({
		filePath, legacyFilePath, fileSystem: { writeFile: () => Promise.resolve() },
		authenticateBinary: async () => { authentications += 1; return { dev: 1, ino: 1 }; },
	});
	await writeFile(filePath, JSON.stringify({ schemaVersion: 4, records: [] }));
	assert.equal(await open().rebind(registry(), installationId), false);
	await writeFile(filePath, '{malformed');
	assert.equal(await open().rebind(registry(), installationId), false);
	assert.equal(authentications, 0, 'neither an empty nor refused primary may resurrect a legacy allowance');
});

function registry(): DesktopPluginRegistry {
	return new DesktopPluginRegistry({ isQuarantined: () => false });
}
