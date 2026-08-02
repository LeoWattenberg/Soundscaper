/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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

test('linked-video locators fail closed before read admission for the wrong owner or revision', async (context) => {
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

	assert.equal(await store.load(locator.locatorId, {
		owner: {},
		expectedRevision: locator.locatorRevision,
	}), null);
	assert.equal(await store.load(locator.locatorId, {
		owner,
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
	reads.afterRegister = () => { store.release(second.locatorId, { owner }); };
	assert.equal(await store.load(second.locatorId, {
		owner,
		expectedRevision: second.locatorRevision,
	}), null);
	assert.deepEqual(reads.releases, [{ id: 'a'.repeat(64), owner }]);
});

test('linked-video locator admission is bounded and owner revocation removes every grant', async (context) => {
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
	assert.equal(store.revokeOwner(owner), 1);
	assert.equal(await store.load(locator.locatorId, {
		owner,
		expectedRevision: locator.locatorRevision,
	}), null);
	assert.deepEqual(reads.registrations, []);
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
		afterRegister: (() => void) | null;
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
				fixture.afterRegister?.();
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
