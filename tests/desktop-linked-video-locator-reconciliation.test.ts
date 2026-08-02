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
import { createProjectStore } from '../src/common/editor/storage.js';
import type {
	LinkedVideoOriginalPort,
	LinkedVideoOriginalSource,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('canonical project reachability retains a live locator and prunes a crash-left binding', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-reconciliation-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const registryPath = join(root, 'profile', 'linked-video-locators-v1.json');
	const livePath = join(root, 'live.mp4');
	const orphanPath = join(root, 'orphan.mp4');
	const liveBytes = Buffer.from('durable linked video body');
	await Promise.all([
		writeFile(livePath, liveBytes),
		writeFile(orphanPath, 'unbound chooser body'),
	]);
	const registry = () => new FileDesktopLinkedVideoLocatorRegistry(registryPath);
	const firstReads = readCapabilities();
	const firstMain = new DesktopLinkedVideoLocatorStore({
		readCapabilities: firstReads,
		registry: registry(),
		randomBytes: deterministicTokens(),
	});
	const firstOwner = {};
	const live = await firstMain.registerPath(livePath, {
		owner: firstOwner, mimeType: 'video/mp4', displayName: 'live.mp4',
	});
	const orphan = await firstMain.registerPath(orphanPath, {
		owner: firstOwner, mimeType: 'video/mp4', displayName: 'orphan.mp4',
	});
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-reconciliation-${Date.now()}-${Math.random()}`;
	const initialRenderer = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
		linkedVideoOriginalPort: platformPort(firstMain, firstReads, firstOwner),
	});
	await initialRenderer.ready();
	const source = videoSource();
	await initialRenderer.saveProject({ id: 'linked-reconciliation-project' });
	const binding = await initialRenderer.bindLinkedVideoOriginal(
		'linked-reconciliation-project',
		source,
		live.locatorId,
		{ expectedLocatorRevision: live.locatorRevision },
	);
	assert.equal(binding.locatorId, live.locatorId);
	const orphanSource = videoSource({
		id: 'linked-reconciliation-orphan-source',
		storageKey: 'linked-reconciliation-orphan-storage',
	});
	assert.ok(await initialRenderer.bindLinkedVideoOriginal(
		'linked-reconciliation-unpublished-project',
		orphanSource,
		orphan.locatorId,
		{ expectedLocatorRevision: orphan.locatorRevision },
	));
	await initialRenderer.close();
	firstMain.revokeOwner(firstOwner);
	await firstMain.dispose();

	const nextReads = readCapabilities();
	const nextMain = new DesktopLinkedVideoLocatorStore({
		readCapabilities: nextReads,
		registry: registry(),
	});
	await nextMain.ready();
	const nextOwner = {};
	const submitted: unknown[] = [];
	const port = platformPort(nextMain, nextReads, nextOwner, submitted);
	const nextRenderer = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
		linkedVideoOriginalPort: port,
	});
	context.after(async () => {
		await nextRenderer.close();
		await nextMain.dispose();
	});
	await nextRenderer.ready();

	assert.equal(await nextRenderer.reconcileLinkedVideoOriginalLocators(), true);
	assert.deepEqual(submitted, [[{
		locatorId: live.locatorId,
		locatorRevision: live.locatorRevision,
	}]]);
	assert.equal(await nextMain.load(orphan.locatorId, {
		owner: nextOwner,
		expectedRevision: orphan.locatorRevision,
	}), null);
	assert.equal(await nextRenderer.getLinkedVideoOriginalBinding(
		'linked-reconciliation-unpublished-project',
		orphanSource.id,
	), null);
	const resolved = await nextRenderer.resolveLinkedVideoOriginal(
		'linked-reconciliation-project',
		source,
	);
	assert.ok(resolved);
	assert.deepEqual(Buffer.from(await resolved.blob.arrayBuffer()), liveBytes);
	assert.equal((await stat(livePath)).isFile(), true);
	assert.equal((await stat(orphanPath)).isFile(), true);
	assert.deepEqual((await registry().read()).map(({ locatorId }) => locatorId), [live.locatorId]);
});

function platformPort(
	main: DesktopLinkedVideoLocatorStore,
	reads: ReturnType<typeof readCapabilities>,
	owner: object,
	submitted: unknown[] = [],
): LinkedVideoOriginalPort {
	return {
		async load(locatorId, { expectedRevision }) {
			const loaded = await main.load(locatorId, { owner, expectedRevision });
			if (!loaded) return null;
			const path = reads.paths.get(loaded.descriptor.id);
			if (!path) throw new Error('The composed read descriptor lost its main-private path.');
			return {
				blob: new Blob([await readFile(path)], { type: loaded.descriptor.mimeType }),
				locatorRevision: loaded.locatorRevision,
			};
		},
		async reconcile(references) {
			submitted.push(references.map((reference) => ({ ...reference })));
			return main.reconcileStartup(references, { owner });
		},
		release: (reference) => main.release(reference.locatorId, {
			owner, expectedRevision: reference.locatorRevision,
		}),
	};
}

function readCapabilities(): DesktopLinkedVideoReadCapabilityStore & Readonly<{
	paths: Map<string, string>;
}> {
	const paths = new Map<string, string>();
	let nextId = 0;
	return {
		paths,
		async registerMaterializedPath(path, options) {
			const metadata = await stat(path);
			const id = (++nextId).toString(16).padStart(64, '0');
			paths.set(id, path);
			return {
				id,
				url: `soundscaper-app://bundle/read/${id}`,
				name: options.displayName,
				size: metadata.size,
				mimeType: options.mimeType,
				readProfile: 'materialized-v1',
				lastModified: Math.max(0, Math.trunc(metadata.mtimeMs)),
			};
		},
		async registerLinkedOriginalRangePath(path, options) {
			const metadata = await stat(path);
			const id = (++nextId).toString(16).padStart(64, '0');
			paths.set(id, path);
			return {
				id,
				url: `soundscaper-app://bundle/read/${id}`,
				name: options.displayName,
				size: metadata.size,
				mimeType: options.mimeType,
				readProfile: 'linked-video-range-v1',
				lastModified: Math.max(0, Math.trunc(metadata.mtimeMs)),
			};
		},
		release(id) { return paths.delete(id); },
	};
}

function deterministicTokens(): (size: number) => Uint8Array {
	let value = 0;
	return (size) => new Uint8Array(size).fill(++value);
}

function videoSource(
	overrides: Partial<LinkedVideoOriginalSource> = {},
): LinkedVideoOriginalSource {
	return Object.freeze({
		kind: 'video',
		id: 'linked-reconciliation-source',
		storageKey: 'linked-reconciliation-storage',
		mimeType: 'video/mp4',
		frameCount: 48_000,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
		...overrides,
	});
}
