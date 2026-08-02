/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileDesktopLinkedVideoLocatorRegistry } from '../desktop/linked-video-locator-registry.ts';
import {
	DesktopLinkedVideoLocatorStore,
	type DesktopLinkedVideoReadCapabilityStore,
} from '../desktop/linked-video-locator-store.ts';

test('linked WAV audio shares the persisted locator inventory and only materializes exact snapshots', async (context) => {
	const root = await temporaryRoot(context);
	const wavPath = join(root, 'selected.wav');
	const registryPath = join(root, 'linked-originals.json');
	await writeFile(wavPath, 'RIFF linked WAV body');
	const reads = readCapabilities();
	const first = new DesktopLinkedVideoLocatorStore({
		readCapabilities: reads.port,
		registry: new FileDesktopLinkedVideoLocatorRegistry(registryPath),
		randomBytes: deterministicTokens(),
	});
	const owner = {};
	const locator = await first.registerPath(wavPath, {
		kind: 'audio', owner, mimeType: 'audio/wav', displayName: 'selected.wav',
	});

	assert.deepEqual(Object.keys(locator), [
		'locatorId', 'locatorRevision', 'name', 'size', 'mimeType', 'lastModified',
	]);
	assert.equal('path' in locator, false);
	const loaded = await first.load(locator.locatorId, {
		owner, expectedRevision: locator.locatorRevision, expectedKind: 'audio',
	});
	assert.ok(loaded);
	assert.equal(loaded.descriptor.readProfile, 'materialized-v1');
	assert.deepEqual(reads.materialized, [{
		path: wavPath, owner, mimeType: 'audio/wav', displayName: 'selected.wav',
	}]);
	assert.deepEqual(reads.playback, []);
	await assert.rejects(first.leasePlayback(locator.locatorId, {
		owner, expectedRevision: locator.locatorRevision,
	}), /audio|kind|playback/iu);
	await assert.rejects(first.load(locator.locatorId, {
		owner, expectedRevision: locator.locatorRevision,
	}), /audio|kind|video/iu);
	await assert.rejects(first.release(locator.locatorId, {
		owner, expectedRevision: locator.locatorRevision, expectedKind: 'video',
	}), /audio|kind|video/iu);
	assert.deepEqual(reads.playback, []);

	const persisted = JSON.parse(await readFile(registryPath, 'utf8')) as {
		schemaVersion: unknown; entries: Array<Record<string, unknown>>;
	};
	assert.equal(persisted.schemaVersion, 2);
	assert.equal(persisted.entries[0]?.kind, 'audio');
	await first.dispose();

	const reopenedReads = readCapabilities();
	const reopened = new DesktopLinkedVideoLocatorStore({
		readCapabilities: reopenedReads.port,
		registry: new FileDesktopLinkedVideoLocatorRegistry(registryPath),
	});
	assert.ok(await reopened.load(locator.locatorId, {
		owner: {}, expectedRevision: locator.locatorRevision, expectedKind: 'audio',
	}));
	await reopened.dispose();
});

test('legacy schema-1 locator rows reopen as video while new audio and video share one quota', async (context) => {
	const root = await temporaryRoot(context);
	const videoPath = join(root, 'legacy.mp4');
	const wavPath = join(root, 'selected.rf64');
	const registryPath = join(root, 'linked-originals.json');
	await Promise.all([writeFile(videoPath, 'legacy video'), writeFile(wavPath, 'RF64 audio')]);
	const metadata = await stat(videoPath);
	const legacy = {
		locatorId: 'a'.repeat(64), locatorRevision: 'b'.repeat(64), path: videoPath,
		name: 'legacy.mp4', size: metadata.size, mimeType: 'video/mp4',
		lastModified: Math.max(0, Math.trunc(metadata.mtimeMs)),
		identity: {
			dev: metadata.dev, ino: metadata.ino, size: metadata.size,
			mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs,
		},
	};
	await writeFile(registryPath, `${JSON.stringify({ schemaVersion: 1, entries: [legacy] })}\n`);
	const registry = new FileDesktopLinkedVideoLocatorRegistry(registryPath);
	assert.equal((await registry.read())[0]?.kind, 'video');

	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities().port,
		registry,
		maximumCount: 1,
	});
	await assert.rejects(store.reconcileStartup([{
		kind: 'audio', locatorId: legacy.locatorId, locatorRevision: legacy.locatorRevision,
	}], { owner: {} }), /kind/iu);
	assert.ok(await store.load(legacy.locatorId, {
		owner: {}, expectedRevision: legacy.locatorRevision,
	}));
	await assert.rejects(store.registerPath(wavPath, {
		kind: 'audio', owner: {}, mimeType: 'audio/rf64', displayName: 'selected.rf64',
	}), /count|admission|limit/iu);
	await store.dispose();
});

test('linked-audio locator admission is closed to canonical WAV and RF64 files within the hard cap', async (context) => {
	const root = await temporaryRoot(context);
	const wavPath = join(root, 'selected.wav');
	await writeFile(wavPath, 'wav');
	const request = { kind: 'audio' as const, owner: {}, mimeType: 'audio/wav', displayName: 'selected.wav' };
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities().port,
		randomBytes: deterministicTokens(),
	});
	await assert.rejects(store.registerPath(wavPath, {
		...request, mimeType: 'audio/mpeg',
	}), /WAV|audio MIME|media type/iu);
	await assert.rejects(store.registerPath(wavPath, {
		...request, displayName: 'selected.mp3',
	}), /WAV|extension|name/iu);
	await assert.rejects(store.registerPath(wavPath, {
		...request, kind: 'image' as never,
	}), /kind|media/iu);

	const oversized = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities().port,
		stat: async () => ({
			dev: 1, ino: 2, size: 512 * 1024 ** 2 + 1, mtimeMs: 3, ctimeMs: 4,
			isFile: () => true,
		}),
	});
	await assert.rejects(oversized.registerPath(wavPath, request), /bytes|limit/iu);
});

async function temporaryRoot(context: test.TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-audio-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	return root;
}

function readCapabilities() {
	const materialized: Array<Record<string, unknown>> = [];
	const playback: Array<Record<string, unknown>> = [];
	const port: DesktopLinkedVideoReadCapabilityStore = {
		async registerMaterializedPath(path, options) {
			materialized.push({ path, ...options });
			const metadata = await stat(path);
			return descriptor('c', 'materialized-v1', metadata.size, metadata.mtimeMs, options);
		},
		async registerLinkedVideoPlaybackPath(path, options) {
			playback.push({ path, ...options });
			const metadata = await stat(path);
			return descriptor('d', 'linked-video-range-v1', metadata.size, metadata.mtimeMs, options);
		},
		release: () => true,
	};
	return { materialized, playback, port };
}

function descriptor(
	byte: string,
	readProfile: string,
	size: number,
	mtimeMs: number,
	options: Readonly<{ displayName: string; mimeType: string }>,
) {
	return Object.freeze({
		id: byte.repeat(64),
		url: `soundscaper-app://bundle/read/${byte.repeat(64)}`,
		name: options.displayName,
		size,
		mimeType: options.mimeType,
		readProfile,
		lastModified: Math.max(0, Math.trunc(mtimeMs)),
	});
}

function deterministicTokens(): (size: number) => Uint8Array {
	let value = 0;
	return (size) => new Uint8Array(size).fill(++value);
}
