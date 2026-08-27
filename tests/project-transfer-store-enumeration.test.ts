/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The transfer has to be able to see the projects it exists to move.
 *
 * `openTransferStore()` opened one database - the shared `kw-media-audio-editor`
 * that `createProjectStore()` opens with no storage profile - and offered what
 * it found there as "your projects". Framescaper keeps none of its work there:
 * every generation from V18 to V32 has its own database, and Soundscaper's
 * V21/V23/V29/V30 do too. A visitor who clicked "move my Framescaper projects"
 * was shown the one store that could not contain them, and the feature's whole
 * purpose went unmet without a single error anywhere.
 */

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { exportProjectTransferBundle } from '../src/common/transfer/project-transfer-bundle.ts';
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
	transferStoreGenerationsPresent,
	TRANSFER_SHARED_EDITOR_STORE,
	TRANSFER_STORE_GENERATIONS,
	type TransferStoreGeneration,
} from '../src/common/transfer/transfer-store-generations.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';

/**
 * The generation this file uses as the one whose database is not there.
 *
 * Read off the registry rather than spelled out. The four names of a generation
 * belong to that generation's own storage profile, and
 * `tests/audio-editor-framescaper-project-storage-profile.test.ts` keeps the
 * exact Framescaper V18 selector to a closed set of owners - a transfer test that
 * copies that generation's database name into itself both joins that set and
 * pins a name the module under test derives.
 */
const ABSENT_GENERATION = (() => {
	const generation = TRANSFER_STORE_GENERATIONS.find(({ id }) => id === 'framescaper-v18');
	assert.ok(generation, 'the oldest Framescaper generation must still be enumerated');
	return generation;
})();

const PRODUCT_DIRECTORIES = ['framescaper', 'soundscaper'] as const;
const STORE_MODULE = /^editor-project-store-v(\d+)\.ts$/u;

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

function fakeGeneration(
	id: string,
	databaseName: string,
	open: TransferStoreGeneration['open'],
): TransferStoreGeneration {
	return Object.freeze({
		id,
		label: `${id} storage`,
		databaseName,
		schemaVersion: 0,
		profileNames: Object.freeze({
			databaseName,
			opfsDirectoryName: `${id}-sources`,
			opfsWorkerName: `${id}-opfs-storage`,
			projectLockPrefix: `${databaseName}-lock:`,
		}),
		open,
	});
}

/* ---------------------------------------------------------------------- */
/* The registry itself.                                                    */
/* ---------------------------------------------------------------------- */

test('every product generation store module is enumerated by the transfer', () => {
	const shipped: string[] = [];
	for (const product of PRODUCT_DIRECTORIES) {
		const directory = fileURLToPath(new URL(`../src/${product}/`, import.meta.url));
		for (const entry of readdirSync(directory)) {
			const match = STORE_MODULE.exec(entry);
			if (match) shipped.push(`${product}-v${match[1]}`);
		}
	}
	const enumerated = TRANSFER_STORE_GENERATIONS.map((generation) => generation.id);
	assert.deepEqual(
		shipped.filter((id) => !enumerated.includes(id)).sort(),
		[],
		'a generation store that no transfer entry opens is a library the page cannot see',
	);
	assert.deepEqual(
		enumerated.filter((id) => !shipped.includes(id)).sort(),
		[],
		'the transfer must not claim to open a generation that no longer exists',
	);
	assert.equal(new Set(enumerated).size, enumerated.length, 'generation ids must be unique');
});

test('exactly one store claims each project schema, so an archive has exactly one home', () => {
	// The receiving half routes every arriving archive by the one number its
	// `project.json` carries, and `createTransferStoreFederation()` resolves a
	// second claim on one schema by keeping the first silently. So a duplicate
	// here is not a registry tidiness problem: it is a whole generation of
	// projects written into a database no editor opens, reported as imported,
	// with nothing anywhere saying otherwise. It is the same defect this feature
	// has now shipped twice, and this is the assertion that sees it coming.
	const claims = [
		...TRANSFER_STORE_GENERATIONS.map((generation) => generation.schemaVersion),
		TRANSFER_SHARED_EDITOR_STORE.schemaVersion,
	];
	assert.equal(
		new Set(claims).size,
		claims.length,
		`two stores claim one schema; the later claim is dropped without a word: ${JSON.stringify(claims)}`,
	);
	// And a schema is a real number, because `transferStoreHomeForSchema()`
	// refuses anything that is not a safe integer before it consults the map.
	for (const claim of claims) {
		assert.ok(Number.isSafeInteger(claim) && claim > 0, `${claim} is not a project schema number`);
	}
});

test('each generation is opened under exactly the names its own storage profile declares', async () => {
	// The transfer builds each generation's storage profile from its own four
	// derived names rather than importing the product's - see the module
	// docblock for the build-graph reason. This is what pins that derivation: a
	// generation whose real profile ever breaks the pattern fails here, rather
	// than being read out of the wrong database, or - worse - out of the right
	// database with the wrong OPFS directory, which yields archives whose media
	// is silently absent.
	for (const generation of TRANSFER_STORE_GENERATIONS) {
		const [product, version] = generation.id.split('-');
		const module = await import(
			`../src/${product}/editor-project-storage-profile-${version}.ts`
		) as Record<string, unknown>;
		const key = `${product.toUpperCase()}_${version.toUpperCase()}_PROJECT_STORAGE_PROFILE`;
		const profile = module[key];
		assert.ok(profile, `${generation.id} must expose ${key}`);
		assert.deepEqual(
			{ ...editorProjectStorageProfileNames(profile) },
			{ ...generation.profileNames },
			`${generation.id} would be opened under names its editor does not use`,
		);
		assert.equal(generation.databaseName, generation.profileNames.databaseName);
	}
});

test('the two copies of the inventory rule answer the same for one store', async () => {
	// The federation and the selection layer sit on opposite sides of the
	// transfer page's chunk boundary, so the id test and the one-distinct-key
	// rule are written twice on purpose. This is what keeps the copies honest:
	// a single store's listing must produce the same rows either way.
	const projects = [
		{ id: 'audio-1', title: 'Field recording', schemaVersion: 30 },
		{ title: 'Nameless', schemaVersion: 31 },
		{ id: '', title: 'Empty id', schemaVersion: 31 },
		{ id: 'x'.repeat(257), title: 'Overlong id', schemaVersion: 31 },
		{ id: 'audio-1', title: 'Same id again', schemaVersion: 30 },
		'not a record at all',
		// Its id reads exactly like the key generated for row 1, which is listed
		// first. Both copies must move the generated key, not this project.
		{ id: 'origin-storage#1', title: 'Looks generated', schemaVersion: 31 },
	];
	const federated = buildTransferStoreInventory([{
		storeId: 'origin-storage',
		storeLabel: 'this origin\'s project storage',
		projects,
	}]);
	const single = await listTransferProjects({
		store: { listProjects: () => projects },
		product: null,
	});
	assert.deepEqual(
		single.map((offer) => [offer.projectId, offer.storeProjectId, offer.refusal !== null]),
		federated.rows.map((row) => [row.selectionKey, row.projectId, row.refusal !== null]),
	);
	assert.deepEqual(federated.rows.map((row) => row.exportable), [
		true, false, false, false, false, false, true,
	]);
	assert.deepEqual(federated.rows.map((row) => row.selectionKey), [
		'audio-1',
		'origin-storage#1~',
		'origin-storage#2',
		'origin-storage#3',
		'origin-storage#4',
		'origin-storage#5',
		'origin-storage#1',
	]);
});

/* ---------------------------------------------------------------------- */
/* Discovery: what exists on this device.                                  */
/* ---------------------------------------------------------------------- */

test('discovery reads indexedDB.databases() and skips the generations that are absent', async () => {
	const present = await discoverTransferStoreDatabases({
		databases: async () => [
			{ name: 'kw-media-framescaper-editor-v31', version: 1 },
			{ name: 'kw-media-audio-editor', version: 4 },
			{ name: null },
		],
	});
	assert.ok(present);
	assert.equal(present.has('kw-media-framescaper-editor-v31'), true);
	const opened = transferStoreGenerationsPresent(present).map((generation) => generation.id);
	assert.deepEqual(opened, ['framescaper-v31']);
});

test('a browser that will not say which databases exist gets every generation opened', async () => {
	// Firefox implements no `databases()`, and IndexedDB has no way to ask
	// whether a database exists without creating it. Guessing would hide a
	// visitor's projects, so the fallback opens everything.
	assert.equal(await discoverTransferStoreDatabases({}), null);
	assert.equal(await discoverTransferStoreDatabases(null), null);
	assert.equal(await discoverTransferStoreDatabases({
		databases: async () => {
			throw new Error('denied');
		},
	}), null);
	assert.equal(
		transferStoreGenerationsPresent(null).length,
		TRANSFER_STORE_GENERATIONS.length,
		'"I cannot tell" must open everything; only "I asked and it is not there" may skip',
	);
});

/* ---------------------------------------------------------------------- */
/* Opening: the union, and what it stays attributable to.                  */
/* ---------------------------------------------------------------------- */

test('the page offers the union of every store a visitor\'s projects can be in', async () => {
	const shared = fakeStore([{ id: 'audio-1', title: 'Field recording', schemaVersion: 30 }]);
	const v31 = fakeStore([{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 }]);
	const v27 = fakeStore([{ id: 'video-0', title: 'Old cut', schemaVersion: 27 }]);
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: {
			databases: async () => [
				{ name: 'kw-media-framescaper-editor-v31' },
				{ name: 'kw-media-framescaper-editor-v27' },
			],
		},
		generations: [
			fakeGeneration('framescaper-v31', 'kw-media-framescaper-editor-v31', async () => v31),
			fakeGeneration('framescaper-v27', 'kw-media-framescaper-editor-v27', async () => v27),
			fakeGeneration(ABSENT_GENERATION.id, ABSENT_GENERATION.databaseName, async () => {
				throw new Error('this generation has no database and must never be opened');
			}),
		],
	});
	const listed = await (source.store as { listProjects(): Promise<readonly { id: string }[]> }).listProjects();
	// Home order: newest generation first, and the shared editor store last - see
	// `openTransferStore()` for how that order is derived from which copy the
	// visitor's editor opens.
	assert.deepEqual(listed.map((project) => project.id), ['video-1', 'video-0', 'audio-1']);
	// And every one of them still knows which store it came from, because the
	// archive writer has to read each project's media out of that store.
	assert.equal(transferStoreForProject(source.store, listed[0]), v31);
	assert.equal(transferStoreForProject(source.store, listed[1]), v27);
	assert.equal(transferStoreForProject(source.store, listed[2]), shared);
	await source.close();
	assert.deepEqual([shared.closed, v31.closed, v27.closed], [true, true, true]);
});

test('one generation that cannot be opened is reported, and the rest still transfer', async () => {
	const shared = fakeStore([]);
	const v31 = fakeStore([{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 }]);
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: null,
		generations: [
			fakeGeneration('framescaper-v31', 'kw-media-framescaper-editor-v31', async () => v31),
			fakeGeneration('framescaper-v28', 'kw-media-framescaper-editor-v28', async () => {
				throw new Error('the database is corrupt');
			}),
			// Opens, but will not list: read failures are reported the same way.
			fakeGeneration('framescaper-v27', 'kw-media-framescaper-editor-v27', async () => ({
				listProjects: async () => {
					throw new Error('the object store is missing');
				},
			})),
		],
	});
	assert.deepEqual(source.unreadable.map((fault) => fault.storeId), ['framescaper-v28']);
	const listed = await (source.store as { listProjects(): Promise<readonly { id: string }[]> }).listProjects();
	assert.deepEqual(listed.map((project) => project.id), ['video-1']);
	const inventory = transferStoreInventory(source.store);
	assert.ok(inventory);
	assert.deepEqual(inventory.unreadable.map((fault) => fault.storeId), [
		'framescaper-v28',
		'framescaper-v27',
	]);
	assert.match(inventory.unreadable[0].reason, /the database is corrupt/u);
	assert.match(inventory.unreadable[1].reason, /the object store is missing/u);
	await source.close();
});

test('the shared editor store is opened whether or not its database exists', async () => {
	// It is the store every write this page makes goes to, so the receiving half
	// of the transfer needs it open even on an origin that has never had one.
	const shared = fakeStore([]);
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [] },
		generations: TRANSFER_STORE_GENERATIONS,
	});
	assert.deepEqual(source.sources.map((handle) => handle.id), ['shared-editor-storage']);
	await source.close();
	assert.equal(shared.closed, true);
});

test('the copy the visitor\'s editor opens is the copy that crosses', async () => {
	// A project id can sit in two databases at once - a project reimported into a
	// newer generation keeps its identity - and only one of them may cross, so the
	// listing order decides which. The shared editor store used to sit first, so
	// the copy that crossed was the one in `kw-media-audio-editor`: the database no
	// generation-isolated editor opens, holding the copy the visitor stopped
	// editing. Their live work was reported as "shadowed" and left behind.
	const shared = fakeStore([{ id: 'video-1', title: 'Interview cut (stale)', schemaVersion: 31 }]);
	const v31 = fakeStore([{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 }]);
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: null,
		generations: [fakeGeneration('framescaper-v31', 'kw-media-framescaper-editor-v31', async () => v31)],
	});
	const listed = await (source.store as { listProjects(): Promise<readonly unknown[]> }).listProjects();
	const inventory = transferStoreInventory(source.store);
	assert.ok(inventory);
	assert.deepEqual(
		inventory.rows.map((row) => [row.storeId, (row.project as { title: string }).title, row.exportable]),
		[
			['framescaper-v31', 'Interview cut', true],
			['shared-editor-storage', 'Interview cut (stale)', false],
		],
	);
	assert.deepEqual(inventory.rows[1].refusal, {
		code: 'shadowed',
		holder: 'framescaper-v31 storage',
	});
	assert.equal(listed.length, 1, 'one identity crosses once');
	assert.equal(transferStoreForProject(source.store, listed[0]), v31);
	await source.close();
});

test('a browser with no databases() creates no database to find out', async () => {
	// The Firefox path. `open()` is the only way to ask, and it creates the
	// database as a side effect - so the answer is taken from the creation itself:
	// `upgradeneeded` fires exactly when the database was not there, and aborting
	// that version-change transaction discards what the request created.
	const opened: string[] = [];
	const aborted: string[] = [];
	const existing = new Set(['kw-media-framescaper-editor-v31']);
	const factory = {
		open(name: string) {
			opened.push(name);
			const request = {
				onupgradeneeded: null as ((event: unknown) => void) | null,
				onsuccess: null as ((event: unknown) => void) | null,
				onerror: null as ((event: unknown) => void) | null,
				onblocked: null as ((event: unknown) => void) | null,
				error: null as unknown,
				result: { close: () => undefined },
				transaction: {
					abort: () => {
						aborted.push(name);
						queueMicrotask(() => request.onerror?.({}));
					},
				},
			};
			queueMicrotask(() => {
				if (existing.has(name)) request.onsuccess?.({});
				else request.onupgradeneeded?.({});
			});
			return request;
		},
	};
	const shared = fakeStore([]);
	const v31 = fakeStore([{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 }]);
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: factory,
		generations: [
			fakeGeneration('framescaper-v31', 'kw-media-framescaper-editor-v31', async () => v31),
			fakeGeneration('framescaper-v27', 'kw-media-framescaper-editor-v27', async () => {
				throw new Error('an absent generation must not be opened to be counted absent');
			}),
		],
	});
	assert.deepEqual(source.sources.map((handle) => handle.id), [
		'framescaper-v31',
		'shared-editor-storage',
	]);
	assert.deepEqual(opened.sort(), [
		'kw-media-framescaper-editor-v27',
		'kw-media-framescaper-editor-v31',
	]);
	assert.deepEqual(aborted, ['kw-media-framescaper-editor-v27'],
		'the database that was not there is the one the probe rolled back');
	assert.deepEqual(source.unreadable, []);
	await source.close();
});

test('a probe that cannot answer opens everything rather than hiding projects', async () => {
	const shared = fakeStore([]);
	const v31 = fakeStore([{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 }]);
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: {
			open() {
				throw new Error('storage is denied to this document');
			},
		},
		generations: [
			fakeGeneration('framescaper-v31', 'kw-media-framescaper-editor-v31', async () => v31),
		],
	});
	assert.deepEqual(source.sources.map((handle) => handle.id), [
		'framescaper-v31',
		'shared-editor-storage',
	]);
	await source.close();
});

/* ---------------------------------------------------------------------- */
/* Export: the right store, and never a refused run.                       */
/* ---------------------------------------------------------------------- */

test('each project is exported from the store that listed it', async () => {
	const shared = fakeStore([{ id: 'audio-1', schemaVersion: 30 }]);
	const v31 = fakeStore([{ id: 'video-1', schemaVersion: 31 }]);
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: null,
		generations: [fakeGeneration('framescaper-v31', 'kw-media-framescaper-editor-v31', async () => v31)],
	});
	const seen: unknown[] = [];
	const exportProject = exportFromOwningStore(async (project: unknown, store: unknown) => {
		seen.push(store);
		void project;
		return { blob: null };
	});
	const listed = await (source.store as { listProjects(): Promise<readonly unknown[]> }).listProjects();
	for (const project of listed) {
		await exportProject(project as never, source.store, { maximumBlobBytes: 1 });
	}
	assert.deepEqual(seen, [v31, shared], 'the wrong store yields an archive with no media in it');
	// A project no enumerated store listed has no store to be read from, and
	// saying so is better than exporting it against whichever store was handed in.
	assert.throws(
		() => exportProject({ id: 'ghost' } as never, source.store, { maximumBlobBytes: 1 }),
		/No enumerated project store listed ghost/u,
	);
	await source.close();
});

test('a single row with no id no longer refuses the whole export run', async () => {
	// `selectProjectTransferProjects()` admits every listed row before it
	// consults the caller's selection, so one unaddressable row used to stop
	// every other project from crossing - ticked or not, download or handshake.
	const shared = fakeStore([
		{ id: 'audio-1', title: 'Field recording', schemaVersion: 30 },
		{ title: 'Nameless', schemaVersion: 31 },
		{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 },
	]);
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [] },
		generations: TRANSFER_STORE_GENERATIONS,
	});
	const exported: string[] = [];
	const events = exportProjectTransferBundle({
		store: source.store as Parameters<typeof exportProjectTransferBundle>[0]['store'],
		exportProject: (project) => {
			exported.push((project as { id: string }).id);
			return { blob: new Blob([new Uint8Array([1, 2, 3])]) };
		},
	});
	let summary: { exported: number; failed: number } | null = null;
	for await (const event of events) {
		if (event.kind === 'summary') summary = { exported: event.exported, failed: event.failed };
	}
	assert.deepEqual(exported, ['audio-1', 'video-1']);
	assert.deepEqual(summary, { exported: 2, failed: 0 });
	// Excluded from the run, and still recorded, so the page can say so.
	const inventory = transferStoreInventory(source.store);
	assert.ok(inventory);
	assert.deepEqual(inventory.rows.map((row) => row.exportable), [true, false, true]);
	await source.close();
});
