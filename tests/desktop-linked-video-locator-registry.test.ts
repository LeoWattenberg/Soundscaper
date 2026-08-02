/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	FileDesktopLinkedVideoLocatorRegistry,
	type PersistedLinkedVideoLocator,
} from '../desktop/linked-video-locator-registry.ts';
import {
	DesktopLinkedVideoLocatorStore,
	type DesktopLinkedVideoReadCapabilityStore,
} from '../desktop/linked-video-locator-store.ts';

test('file locator registry atomically persists a private closed v1 document', async (context) => {
	const root = await temporaryRoot(context, 'soundscaper-linked-registry-');
	const registryPath = join(root, 'private', 'linked-video-locators-v1.json');
	const targetPath = join(root, 'selected.mp4');
	await writeFile(targetPath, 'persistent video');
	const registry = new FileDesktopLinkedVideoLocatorRegistry(registryPath, {
		randomBytes: () => new Uint8Array(16).fill(7),
	});
	assert.deepEqual(await registry.read(), []);
	const entry = await persistedLocator(targetPath, 'a', 'b');

	await registry.write([entry]);
	const metadata = await lstat(registryPath);
	assert.equal(metadata.isFile(), true);
	assert.equal(metadata.isSymbolicLink(), false);
	assert.equal(metadata.mode & 0o777, 0o600);
	const document = JSON.parse(await readFile(registryPath, 'utf8')) as Record<string, unknown>;
	assert.deepEqual(Object.keys(document), ['schemaVersion', 'entries']);
	assert.equal(document.schemaVersion, 1);
	assert.deepEqual(await registry.read(), [entry]);
	assert.equal(Object.isFrozen(await registry.read()), true);

	await registry.write([]);
	assert.deepEqual(await registry.read(), []);
	assert.equal((await stat(targetPath)).isFile(), true, 'forgetting metadata never deletes the external file');
});

test('file locator registry rejects symbolic, malformed, open, and duplicate state', async (context) => {
	const root = await temporaryRoot(context, 'soundscaper-linked-registry-invalid-');
	const registryPath = join(root, 'registry.json');
	const targetPath = join(root, 'selected.mp4');
	await writeFile(targetPath, 'video');
	const entry = await persistedLocator(targetPath, 'c', 'd');
	const registry = new FileDesktopLinkedVideoLocatorRegistry(registryPath);

	for (const document of [
		'{',
		JSON.stringify({ schemaVersion: 2, entries: [] }),
		JSON.stringify({ schemaVersion: 1, entries: [], extra: true }),
		JSON.stringify({ schemaVersion: 1, entries: [{ ...entry, path: 'relative.mp4' }] }),
		JSON.stringify({ schemaVersion: 1, entries: [entry, entry] }),
	]) {
		await writeFile(registryPath, document);
		await assert.rejects(registry.read(), /JSON|schema|unsupported|path|duplicate/iu);
	}

	const actualPath = join(root, 'actual.json');
	await writeFile(actualPath, JSON.stringify({ schemaVersion: 1, entries: [] }));
	await rm(registryPath, { force: true });
	await symlink(actualPath, registryPath);
	await assert.rejects(registry.read(), /regular non-symbolic/iu);
});

test('linked-video locator grants survive store restart and release only registry metadata', async (context) => {
	const root = await temporaryRoot(context, 'soundscaper-linked-registry-restart-');
	const registryPath = join(root, 'state', 'linked-video-locators-v1.json');
	const targetPath = join(root, 'selected.webm');
	await writeFile(targetPath, 'restart video');
	const registry = () => new FileDesktopLinkedVideoLocatorRegistry(registryPath);
	const firstReads = readCapabilities();
	const first = new DesktopLinkedVideoLocatorStore({
		readCapabilities: firstReads,
		registry: registry(),
		randomBytes: deterministicTokens(),
	});
	const initialOwner = {};
	const locator = await first.registerPath(targetPath, {
		owner: initialOwner,
		mimeType: 'video/webm',
		displayName: 'selected.webm',
	});
	first.revokeOwner(initialOwner);
	await first.dispose();

	const secondReads = readCapabilities();
	const second = new DesktopLinkedVideoLocatorStore({
		readCapabilities: secondReads,
		registry: registry(),
	});
	const nextOwner = {};
	const loaded = await second.load(locator.locatorId, {
		owner: nextOwner,
		expectedRevision: locator.locatorRevision,
	});
	assert.ok(loaded);
	assert.equal(loaded.locatorRevision, locator.locatorRevision);
	assert.equal(secondReads.registrations, 1);
	assert.equal(await second.release(locator.locatorId, { owner: nextOwner }), true);
	assert.equal((await stat(targetPath)).isFile(), true);
	await second.dispose();

	const third = new DesktopLinkedVideoLocatorStore({
		readCapabilities: readCapabilities(),
		registry: registry(),
	});
	assert.equal(await third.load(locator.locatorId, {
		owner: {},
		expectedRevision: locator.locatorRevision,
	}), null);
	await third.dispose();
});

async function temporaryRoot(
	context: test.TestContext,
	prefix: string,
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	return root;
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
		name: 'selected.mp4',
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

function readCapabilities(): DesktopLinkedVideoReadCapabilityStore & { registrations: number } {
	let registrations = 0;
	return {
		get registrations() { return registrations; },
		async registerMaterializedPath(path, options) {
			registrations += 1;
			const metadata = await stat(path);
			return Object.freeze({
				id: 'e'.repeat(64),
				url: `soundscaper-app://bundle/read/${'e'.repeat(64)}`,
				name: options.displayName,
				size: metadata.size,
				mimeType: options.mimeType,
				readProfile: 'materialized-v1',
				lastModified: Math.max(0, Math.trunc(metadata.mtimeMs)),
			});
		},
		async registerLinkedVideoPlaybackPath(path, options) {
			const metadata = await stat(path);
			return Object.freeze({
				id: 'f'.repeat(64),
				url: `soundscaper-app://bundle/read/${'f'.repeat(64)}`,
				name: options.displayName,
				size: metadata.size,
				mimeType: options.mimeType,
				readProfile: 'linked-video-range-v1',
				lastModified: Math.max(0, Math.trunc(metadata.mtimeMs)),
			});
		},
		async release() { return true; },
	};
}

function deterministicTokens(): (size: number) => Uint8Array {
	let value = 0;
	return (size) => new Uint8Array(size).fill(++value);
}
