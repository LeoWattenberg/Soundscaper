/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { PersistedLinkedVideoLocator } from '../desktop/linked-video-locator-registry.ts';
import {
	DesktopLinkedVideoLocatorStore,
	type DesktopLinkedVideoReadCapabilityStore,
} from '../desktop/linked-video-locator-store.ts';

test('linked-video locators expose only bounded opaque snapshot metadata', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'selected.mp4');
	await writeFile(path, 'linked video body');
	const owner = {};
	const reads = readCapabilities();
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: reads.port,
		randomBytes: deterministicTokens(),
	});

	const locator = await store.registerPath(path, {
		owner,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
	});

	assert.deepEqual(Object.keys(locator), [
		'locatorId', 'locatorRevision', 'name', 'size', 'mimeType', 'lastModified',
	]);
	assert.match(locator.locatorId, /^[a-f0-9]{64}$/u);
	assert.match(locator.locatorRevision, /^[a-f0-9]{64}$/u);
	assert.equal(locator.name, 'selected.mp4');
	assert.equal(locator.size, 17);
	assert.equal(locator.mimeType, 'video/mp4');
	assert.equal('path' in locator, false);
	assert.equal(Object.isFrozen(locator), true);

	const loaded = await store.load(locator.locatorId, {
		owner,
		expectedRevision: locator.locatorRevision,
	});
	assert.ok(loaded);
	assert.equal(loaded.locatorRevision, locator.locatorRevision);
	assert.deepEqual(loaded.descriptor, reads.descriptors[0]);
	assert.deepEqual(reads.registrations, [{
		path,
		owner,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
	}]);
	assert.equal('path' in loaded, false);
});

test('linked-video locators fail closed before read admission for a revoked owner or revision', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-owner-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'selected.webm');
	await writeFile(path, 'webm');
	const owner = {};
	const reads = readCapabilities();
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: reads.port,
		randomBytes: deterministicTokens(),
	});
	const locator = await store.registerPath(path, {
		owner,
		mimeType: 'video/webm',
		displayName: 'selected.webm',
	});

	store.revokeOwner(owner);
	assert.equal(await store.load(locator.locatorId, {
		owner,
		expectedRevision: locator.locatorRevision,
	}), null);
	assert.equal(await store.load(locator.locatorId, {
		owner: {},
		expectedRevision: 'f'.repeat(64),
	}), null);
	assert.deepEqual(reads.registrations, []);
});

test('linked-video locators reject changed files and retire raced read capabilities', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-change-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'selected.mp4');
	await writeFile(path, 'first');
	const owner = {};
	const reads = readCapabilities();
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: reads.port,
		randomBytes: deterministicTokens(),
	});
	const first = await store.registerPath(path, {
		owner,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
	});
	await writeFile(path, 'replacement body');
	assert.equal(await store.load(first.locatorId, {
		owner,
		expectedRevision: first.locatorRevision,
	}), null);
	assert.deepEqual(reads.registrations, []);

	const second = await store.registerPath(path, {
		owner,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
	});
	reads.afterRegister = async () => { await store.release(second.locatorId, { owner }); };
	assert.equal(await store.load(second.locatorId, {
		owner,
		expectedRevision: second.locatorRevision,
	}), null);
	assert.deepEqual(reads.releases, [{ id: 'a'.repeat(64), owner }]);
});

test('linked-video locator admission is bounded and owner revocation fences only that renderer', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-admission-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const firstPath = join(root, 'first.mp4');
	const secondPath = join(root, 'second.mp4');
	await writeFile(firstPath, '1234');
	await writeFile(secondPath, '5678');
	const owner = {};
	const reads = readCapabilities();
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: reads.port,
		randomBytes: deterministicTokens(),
		maximumCount: 1,
		maximumBytes: 4,
	});
	const locator = await store.registerPath(firstPath, {
		owner,
		mimeType: 'video/mp4',
		displayName: 'first.mp4',
	});
	await assert.rejects(
		store.registerPath(secondPath, {
			owner,
			mimeType: 'video/mp4',
			displayName: 'second.mp4',
		}),
		/admission|limit/iu,
	);
	store.revokeOwner(owner);
	assert.equal(await store.load(locator.locatorId, {
		owner,
		expectedRevision: locator.locatorRevision,
	}), null);
	const nextOwner = {};
	assert.ok(await store.load(locator.locatorId, {
		owner: nextOwner,
		expectedRevision: locator.locatorRevision,
	}));
	assert.equal(reads.registrations.length, 1);
});

test('owner revocation during persistent publication rolls the locator record back', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-revoked-publish-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'selected.mp4');
	await writeFile(path, 'video');
	const publicationStarted = deferred<void>();
	const allowPublication = deferred<void>();
	const snapshots: number[] = [];
	let writes = 0;
	const owner = {};
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities().port,
		randomBytes: deterministicTokens(),
		registry: {
			read: () => [],
			async write(entries) {
				snapshots.push(entries.length);
				writes += 1;
				if (writes !== 1) return;
				publicationStarted.resolve(undefined);
				await allowPublication.promise;
			},
		},
	});
	const registration = store.registerPath(path, {
		owner,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
	});
	await publicationStarted.promise;
	store.revokeOwner(owner);
	allowPublication.resolve(undefined);

	await assert.rejects(registration, /revoked/iu);
	assert.deepEqual(snapshots, [1, 0]);
});

test('startup reconciliation prunes only exact unreferenced startup locators', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-reconcile-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const retainedPath = join(root, 'retained.mp4');
	const orphanPath = join(root, 'orphan.mp4');
	const runtimePath = join(root, 'runtime.mp4');
	const afterPath = join(root, 'after.mp4');
	await Promise.all([
		writeFile(retainedPath, 'retained'),
		writeFile(orphanPath, 'orphan'),
		writeFile(runtimePath, 'runtime'),
		writeFile(afterPath, 'after'),
	]);
	const retained = await persistedLocator(retainedPath, 'a', 'b');
	const orphan = await persistedLocator(orphanPath, 'c', 'd');
	const writes: Array<readonly PersistedLinkedVideoLocator[]> = [];
	let statCalls = 0;
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities().port,
		randomBytes: deterministicTokens(),
		maximumCount: 3,
		registry: {
			read: () => [retained, orphan],
			write(entries) { writes.push([...entries]); },
		},
		stat: async (path) => { statCalls += 1; return stat(path); },
	});
	await store.ready();
	const owner = {};
	const runtimeLocator = await store.registerPath(runtimePath, {
		owner, mimeType: 'video/mp4', displayName: 'runtime.mp4',
	});
	await assert.rejects(store.registerPath(afterPath, {
		owner, mimeType: 'video/mp4', displayName: 'after.mp4',
	}), /count.*limit|admission/iu);
	const statCallsBeforeReconciliation = statCalls;

	assert.equal(await store.reconcileStartup([{
		locatorId: retained.locatorId,
		locatorRevision: retained.locatorRevision,
	}], { owner }), 1);
	assert.equal(statCalls, statCallsBeforeReconciliation, 'reconciliation never stats external files');
	assert.deepEqual(writes.at(-1)?.map(({ locatorId }) => locatorId).sort(), [
		retained.locatorId,
		runtimeLocator.locatorId,
	].sort());
	assert.equal(await store.load(orphan.locatorId, {
		owner, expectedRevision: orphan.locatorRevision,
	}), null);
	assert.ok(await store.load(retained.locatorId, {
		owner, expectedRevision: retained.locatorRevision,
	}));
	assert.ok(await store.load(runtimeLocator.locatorId, {
		owner, expectedRevision: runtimeLocator.locatorRevision,
	}));
	assert.ok(await store.registerPath(afterPath, {
		owner, mimeType: 'video/mp4', displayName: 'after.mp4',
	}));
	const writesAfterFirstPass = writes.length;
	assert.equal(await store.reconcileStartup([], { owner }), 0);
	assert.equal(writes.length, writesAfterFirstPass, 'the successful startup pass is one-shot');
	for (const path of [retainedPath, orphanPath, runtimePath, afterPath]) {
		assert.equal((await stat(path)).isFile(), true);
	}
});

test('startup reconciliation rejects incomplete or stale inventories without mutation', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-reconcile-invalid-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'retained.mp4');
	await writeFile(path, 'retained');
	const retained = await persistedLocator(path, 'e', 'f');
	const writes: Array<readonly PersistedLinkedVideoLocator[]> = [];
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities().port,
		registry: {
			read: () => [retained],
			write(entries) { writes.push([...entries]); },
		},
	});
	await store.ready();
	const owner = {};
	for (const references of [[{
		locatorId: '1'.repeat(64),
		locatorRevision: '2'.repeat(64),
	}], [{
		locatorId: retained.locatorId,
		locatorRevision: '3'.repeat(64),
	}]]) {
		await assert.rejects(
			store.reconcileStartup(references, { owner }),
			/unknown|revision|inventory/iu,
		);
	}
	store.revokeOwner(owner);
	await assert.rejects(
		store.reconcileStartup([], { owner }),
		/revoked/iu,
	);
	assert.deepEqual(writes, []);
	assert.ok(await store.load(retained.locatorId, {
		owner: {}, expectedRevision: retained.locatorRevision,
	}));
	assert.equal(await store.reconcileStartup([{
		locatorId: retained.locatorId,
		locatorRevision: retained.locatorRevision,
	}], { owner: {} }), 0);
});

test('failed startup reconciliation restores the complete locator inventory for retry', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-reconcile-rollback-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const retainedPath = join(root, 'retained.mp4');
	const orphanPath = join(root, 'orphan.mp4');
	await Promise.all([writeFile(retainedPath, 'retained'), writeFile(orphanPath, 'orphan')]);
	const retained = await persistedLocator(retainedPath, '4', '5');
	const orphan = await persistedLocator(orphanPath, '6', '7');
	let rejectWrite = true;
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities().port,
		registry: {
			read: () => [retained, orphan],
			write() {
				if (rejectWrite) throw new Error('registry write failed');
			},
		},
	});
	await store.ready();
	const owner = {};
	const references = [{
		locatorId: retained.locatorId,
		locatorRevision: retained.locatorRevision,
	}];

	await assert.rejects(store.reconcileStartup(references, { owner }), /registry write failed/iu);
	assert.ok(await store.load(orphan.locatorId, {
		owner, expectedRevision: orphan.locatorRevision,
	}));
	rejectWrite = false;
	assert.equal(await store.reconcileStartup(references, { owner }), 1);
	assert.equal(await store.load(orphan.locatorId, {
		owner, expectedRevision: orphan.locatorRevision,
	}), null);
});

test('owner revocation during startup reconciliation restores startup metadata', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-reconcile-revoked-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'orphan.mp4');
	await writeFile(path, 'orphan');
	const orphan = await persistedLocator(path, '8', '9');
	const publicationStarted = deferred<void>();
	const allowPublication = deferred<void>();
	const snapshots: string[][] = [];
	let writes = 0;
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities().port,
		registry: {
			read: () => [orphan],
			async write(entries) {
				snapshots.push(entries.map(({ locatorId }) => locatorId));
				writes += 1;
				if (writes !== 1) return;
				publicationStarted.resolve(undefined);
				await allowPublication.promise;
			},
		},
	});
	await store.ready();
	const owner = {};
	const reconciliation = store.reconcileStartup([], { owner });
	await publicationStarted.promise;
	store.revokeOwner(owner);
	allowPublication.resolve(undefined);

	await assert.rejects(reconciliation, /revoked/iu);
	assert.deepEqual(snapshots, [[], [orphan.locatorId]]);
	assert.ok(await store.load(orphan.locatorId, {
		owner: {}, expectedRevision: orphan.locatorRevision,
	}));
});

test('linked-video locator registration rejects directories, empty files, and unsafe metadata', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-video-invalid-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const emptyPath = join(root, 'empty.mp4');
	await writeFile(emptyPath, '');
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities().port,
		randomBytes: deterministicTokens(),
	});
	const request = { owner: {}, mimeType: 'video/mp4', displayName: 'empty.mp4' };

	await assert.rejects(store.registerPath(root, request), /regular file/iu);
	await assert.rejects(store.registerPath(emptyPath, request), /empty/iu);
	await assert.rejects(store.registerPath(emptyPath, {
		...request,
		mimeType: 'text/plain',
	}), /video MIME/iu);
	await assert.rejects(store.registerPath(emptyPath, {
		...request,
		displayName: '../leak.mp4',
	}), /display name/iu);
	await assert.rejects(store.registerPath('relative.mp4', request), /absolute/iu);
	assert.equal((await stat(emptyPath)).isFile(), true);
});

function readCapabilities() {
	const registrations: Array<Record<string, unknown>> = [];
	const releases: Array<Record<string, unknown>> = [];
	const descriptors: Array<Record<string, unknown>> = [];
	const fixture: {
		readonly port: DesktopLinkedVideoReadCapabilityStore;
		readonly registrations: Array<Record<string, unknown>>;
		readonly releases: Array<Record<string, unknown>>;
		readonly descriptors: Array<Record<string, unknown>>;
		afterRegister: (() => Promise<void> | void) | null;
	} = {
		registrations,
		releases,
		descriptors,
		afterRegister: null,
		port: {
			async registerMaterializedPath(path, options) {
				registrations.push({ path, ...options });
				const metadata = await stat(path);
				const descriptor = Object.freeze({
					id: 'a'.repeat(64),
					readProfile: 'materialized-v1',
					url: `soundscaper-app://bundle/read/${'a'.repeat(64)}`,
					name: options.displayName,
					size: metadata.size,
					mimeType: options.mimeType,
					lastModified: Math.max(0, Math.trunc(metadata.mtimeMs)),
				});
				descriptors.push(descriptor);
				await fixture.afterRegister?.();
				return descriptor;
			},
			async registerLinkedVideoPlaybackPath(path, options) {
				registrations.push({ path, ...options });
				const metadata = await stat(path);
				const descriptor = Object.freeze({
					id: 'b'.repeat(64),
					readProfile: 'linked-video-range-v1',
					url: `soundscaper-app://bundle/read/${'b'.repeat(64)}`,
					name: options.displayName,
					size: metadata.size,
					mimeType: options.mimeType,
					lastModified: Math.max(0, Math.trunc(metadata.mtimeMs)),
				});
				descriptors.push(descriptor);
				await fixture.afterRegister?.();
				return descriptor;
			},
			async release(id, options) {
				releases.push({ id, ...options });
				return true;
			},
		},
	};
	return fixture;
}

function deterministicTokens(): (size: number) => Uint8Array {
	let value = 0;
	return (size) => {
		value += 1;
		return new Uint8Array(size).fill(value);
	};
}

async function persistedLocator(
	path: string,
	locatorByte: string,
	revisionByte: string,
): Promise<Readonly<PersistedLinkedVideoLocator>> {
	const metadata = await stat(path);
	return Object.freeze({
		locatorId: locatorByte.repeat(64),
		locatorRevision: revisionByte.repeat(64),
		path,
		name: path.split(/[\\/]/u).at(-1) || 'selected.mp4',
		size: metadata.size,
		mimeType: 'video/mp4',
		lastModified: Math.max(0, Math.trunc(metadata.mtimeMs)),
		identity: Object.freeze({
			dev: metadata.dev,
			ino: metadata.ino,
			size: metadata.size,
			mtimeMs: metadata.mtimeMs,
			ctimeMs: metadata.ctimeMs,
		}),
	});
}

function deferred<Value>() {
	let resolvePromise!: (value: Value | PromiseLike<Value>) => void;
	let rejectPromise!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, resolve: resolvePromise, reject: rejectPromise };
}
