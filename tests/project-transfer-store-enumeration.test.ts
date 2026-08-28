/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	type ProjectSchemaFamily,
} from '../src/common/editor/project-schema-identity.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from '../src/framescaper/editor-project-storage-profile.ts';
import { SOUNDSCAPER_PROJECT_STORAGE_PROFILE } from '../src/soundscaper/editor-project-storage-profile.ts';
import {
	exportFromOwningStore,
	openTransferStore,
} from '../src/common/transfer/transfer-archive-runtime.ts';
import { listTransferProjects } from '../src/common/transfer/transfer-project-selection.ts';
import {
	buildTransferStoreInventory,
	transferStoreForProject,
	transferStoreInventory,
} from '../src/common/transfer/transfer-store-federation.ts';
import {
	discoverTransferStoreDatabases,
	probeTransferStoreDatabases,
	transferStoreBaselinesPresent,
	TRANSFER_STORE_BASELINES,
	type TransferStoreBaseline,
} from '../src/common/transfer/transfer-store-baselines.ts';

interface FakeStore {
	readonly listProjects: () => Promise<readonly unknown[]>;
	readonly ready: () => Promise<void>;
	readonly close: () => Promise<void>;
	closed: boolean;
}

function fakeStore(projects: readonly unknown[]): FakeStore {
	const store: FakeStore = {
		listProjects: async () => projects,
		ready: async () => undefined,
		close: async () => {
			store.closed = true;
		},
		closed: false,
	};
	return store;
}

function fakeBaseline(
	schemaFamily: ProjectSchemaFamily,
	open: TransferStoreBaseline['open'],
): TransferStoreBaseline {
	const product = schemaFamily;
	const id = `${product}-v1`;
	const databaseName = `kw-media-${product}-editor-v1`;
	return Object.freeze({
		id,
		label: `${product} v1 storage`,
		databaseName,
		schemaFamily,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		profileNames: Object.freeze({
			databaseName,
			opfsDirectoryName: `${product}-editor-v1-sources`,
			opfsWorkerName: `${product}-editor-v1-opfs-storage`,
			projectLockPrefix: `${databaseName}-lock:`,
		}),
		open,
	});
}

test('transfer registry contains exactly the two fresh v1 family stores', () => {
	assert.deepEqual(
		TRANSFER_STORE_BASELINES.map(({ id, schemaFamily, schemaVersion }) => ({
			id,
			schemaFamily,
			schemaVersion,
		})),
		[
			{ id: 'framescaper-v1', schemaFamily: 'framescaper', schemaVersion: 1 },
			{ id: 'soundscaper-v1', schemaFamily: 'soundscaper', schemaVersion: 1 },
		],
	);
	assert.equal(new Set(TRANSFER_STORE_BASELINES.map(
		(entry) => `${entry.schemaFamily}:${String(entry.schemaVersion)}`,
	)).size, 2, 'the family-qualified tuple, not a bare version, owns a store');
});

test('transfer stores use the exact unversioned product storage profiles', () => {
	const profiles = new Map<ProjectSchemaFamily, unknown>([
		[FRAMESCAPER_PROJECT_SCHEMA_FAMILY, FRAMESCAPER_PROJECT_STORAGE_PROFILE],
		[SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, SOUNDSCAPER_PROJECT_STORAGE_PROFILE],
	]);
	for (const baseline of TRANSFER_STORE_BASELINES) {
		assert.deepEqual(
			{ ...baseline.profileNames },
			{ ...editorProjectStorageProfileNames(profiles.get(baseline.schemaFamily) as never) },
		);
	}
});

test('discovery selects fresh baseline databases and ignores every retired name', async () => {
	const present = await discoverTransferStoreDatabases({
		databases: async () => [
			{ name: 'kw-media-framescaper-editor-v1' },
			{ name: 'kw-media-framescaper-editor-v31' },
			{ name: 'kw-media-soundscaper-editor-v30' },
			{ name: 'kw-media-audio-editor' },
		],
	});
	assert.ok(present);
	assert.deepEqual(
		transferStoreBaselinesPresent(present).map(({ id }) => id),
		['framescaper-v1'],
	);
});

test('a browser that cannot enumerate databases probes both baseline stores', async () => {
	assert.equal(await discoverTransferStoreDatabases({}), null);
	assert.equal(await discoverTransferStoreDatabases(null), null);
	assert.equal(await discoverTransferStoreDatabases({
		databases: async () => {
			throw new Error('denied');
		},
	}), null);
	assert.equal(transferStoreBaselinesPresent(null).length, 2);
});

test('the fallback probe aborts creation and never deletes an absent baseline store', async () => {
	const opened: string[] = [];
	const aborted: string[] = [];
	const existing = new Set(['kw-media-framescaper-editor-v1']);
	const factory = {
		open(name: string) {
			opened.push(name);
			const request = {
				onupgradeneeded: null as (() => void) | null,
				onsuccess: null as (() => void) | null,
				onerror: null as (() => void) | null,
				onblocked: null as (() => void) | null,
				error: null,
				result: { close: () => undefined },
				transaction: {
					abort: () => {
						aborted.push(name);
						queueMicrotask(() => request.onerror?.());
					},
				},
			};
			queueMicrotask(() => {
				if (existing.has(name)) request.onsuccess?.();
				else request.onupgradeneeded?.();
			});
			return request;
		},
	};
	const present = await probeTransferStoreDatabases(factory);
	assert.deepEqual([...present ?? []], ['kw-media-framescaper-editor-v1']);
	assert.deepEqual(opened.sort(), [
		'kw-media-framescaper-editor-v1',
		'kw-media-soundscaper-editor-v1',
	]);
	assert.deepEqual(aborted, ['kw-media-soundscaper-editor-v1']);
});

test('the transfer opens only present v1 stores and retains their family ownership', async () => {
	const framescaper = fakeStore([{
		id: 'same-id', schemaFamily: 'framescaper', schemaVersion: 1, title: 'Video cut',
	}]);
	const soundscaper = fakeStore([{
		id: 'same-id', schemaFamily: 'soundscaper', schemaVersion: 1, title: 'Audio mix',
	}]);
	const source = await openTransferStore({
		databases: { databases: async () => [
			{ name: 'kw-media-framescaper-editor-v1' },
			{ name: 'kw-media-soundscaper-editor-v1' },
		] },
		baselines: [
			fakeBaseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, async () => framescaper),
			fakeBaseline(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, async () => soundscaper),
		],
	});
	const listed = await (source.store as {
		listProjects(): Promise<readonly { title: string }[]>;
	}).listProjects();
	assert.deepEqual(listed.map(({ title }) => title), ['Video cut', 'Audio mix']);
	assert.equal(transferStoreForProject(source.store, listed[0]), framescaper);
	assert.equal(transferStoreForProject(source.store, listed[1]), soundscaper);
	const inventory = transferStoreInventory(source.store);
	assert.ok(inventory);
	assert.deepEqual(inventory.rows.map(({ selectionKey, exportable }) => [selectionKey, exportable]), [
		['framescaper:same-id', true],
		['soundscaper:same-id', true],
	]);
	await source.close();
	assert.deepEqual([framescaper.closed, soundscaper.closed], [true, true]);
});

test('a baseline store that cannot open is reported without hiding the other family', async () => {
	const framescaper = fakeStore([{
		id: 'video-1', schemaFamily: 'framescaper', schemaVersion: 1,
	}]);
	const source = await openTransferStore({
		databases: null,
		baselines: [
			fakeBaseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, async () => framescaper),
			fakeBaseline(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, async () => {
				throw new Error('fresh database is corrupt');
			}),
		],
	});
	assert.deepEqual(source.unreadable.map(({ storeId }) => storeId), ['soundscaper-v1']);
	assert.equal((await (source.store as { listProjects(): Promise<unknown[]> }).listProjects()).length, 1);
	await source.close();
});

test('inventory keeps same project ids in different families separate', async () => {
	const inventory = buildTransferStoreInventory([
		{
			storeId: 'framescaper-v1',
			storeLabel: 'Framescaper v1',
			schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
			projects: [{ id: 'same', schemaFamily: 'framescaper', schemaVersion: 1 }],
		},
		{
			storeId: 'soundscaper-v1',
			storeLabel: 'Soundscaper v1',
			schemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
			projects: [{ id: 'same', schemaFamily: 'soundscaper', schemaVersion: 1 }],
		},
	]);
	assert.deepEqual(inventory.rows.map(({ selectionKey, exportable }) => [selectionKey, exportable]), [
		['framescaper:same', true],
		['soundscaper:same', true],
	]);
	const offers = await listTransferProjects({
		store: {
			listProjects: async () => inventory.rows.map(({ project }) => project),
			listTransferInventory: async () => inventory,
		},
		product: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	});
	assert.deepEqual(offers.map(({ projectId, product, preselected }) => ({
		projectId, product, preselected,
	})), [
		{ projectId: 'framescaper:same', product: 'framescaper', preselected: true },
		{ projectId: 'soundscaper:same', product: 'soundscaper', preselected: false },
	]);
});

test('numeric-only projects are never assigned a product by their version', () => {
	assert.deepEqual(buildTransferStoreInventory([{
		storeId: 'unknown',
		storeLabel: 'Unknown storage',
		projects: [
			{ id: 'a', schemaVersion: 1 },
			{ id: 'b', schemaVersion: 31 },
		],
	}]).rows.map(({ selectionKey }) => selectionKey), ['a', 'b']);
});

test('each project is exported from the family store that listed it', async () => {
	const framescaper = fakeStore([{
		id: 'same', schemaFamily: 'framescaper', schemaVersion: 1,
	}]);
	const soundscaper = fakeStore([{
		id: 'same', schemaFamily: 'soundscaper', schemaVersion: 1,
	}]);
	const source = await openTransferStore({
		databases: null,
		baselines: [
			fakeBaseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, async () => framescaper),
			fakeBaseline(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, async () => soundscaper),
		],
	});
	const seen: unknown[] = [];
	const exportProject = exportFromOwningStore(async (_project, store) => {
		seen.push(store);
		return { blob: null };
	});
	const listed = await (source.store as { listProjects(): Promise<readonly unknown[]> }).listProjects();
	for (const project of listed) {
		await exportProject(project as never, source.store, { maximumBlobBytes: 1 });
	}
	assert.deepEqual(seen, [framescaper, soundscaper]);
	await source.close();
});
