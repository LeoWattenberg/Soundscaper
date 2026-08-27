/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The receiving half of "a project has a home store".
 *
 * The sender already exports each project from the store that listed it. The
 * receiver did not have the mirror of that rule: every arriving archive was
 * imported through the federation's writer, which is the shared
 * `kw-media-audio-editor` database. No live editor opens that database for its
 * projects - Framescaper opens `kw-media-framescaper-editor-v<n>` and Soundscaper
 * its own generation stores - so the page reported "Imported 5 of 5" and the
 * visitor opened an empty editor. The transfer appeared to succeed and delivered
 * nothing, which is the one failure a transfer must never have.
 *
 * These tests pin the mirror rule: an archive is read as, and written to, the
 * generation whose schema it carries; a generation this origin has never had is
 * opened (and created) on demand, because that is what the editor's own first
 * run would do; and an archive of a generation this build does not know is
 * refused by name rather than written somewhere convenient.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { importProjectTransferBundle } from '../src/common/transfer/project-transfer-bundle.ts';
import {
	importIntoHomeStore,
	inspectInHomeStore,
	openTransferStore,
	TransferArchiveHomeError,
} from '../src/common/transfer/transfer-archive-runtime.ts';
import {
	TRANSFER_SHARED_EDITOR_STORE,
	type TransferStoreGeneration,
} from '../src/common/transfer/transfer-store-generations.ts';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface ArchiveDocument {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: number;
}

interface LoadedDocument {
	readonly project: ArchiveDocument;
	readonly migrated: boolean;
	readonly fromVersion: number;
	readonly readOnly: boolean;
	readonly reason: string | null;
}

/**
 * `migrateAudioEditorProject()` in miniature - the `.scape` reader's default
 * document owner, and the shared editor store's own.
 *
 * It is why routing alone would not have been enough: with this owner in place a
 * Framescaper V31 archive is not written into the wrong database, it is declared
 * read-only and skipped. The shared store was both the only store that could be
 * written and the only schema that could be read.
 */
function sharedEditorDocumentOwner(value: unknown): LoadedDocument {
	const project = value as ArchiveDocument;
	if (project.schemaVersion > TRANSFER_SHARED_EDITOR_STORE.schemaVersion) {
		return {
			project,
			migrated: false,
			fromVersion: project.schemaVersion,
			readOnly: true,
			reason: 'newer-schema',
		};
	}
	if (project.schemaVersion < TRANSFER_SHARED_EDITOR_STORE.schemaVersion) {
		throw new Error(`Unsupported audio editor schema version: ${project.schemaVersion}.`);
	}
	return { project, migrated: false, fromVersion: project.schemaVersion, readOnly: false, reason: null };
}

/** One generation's database, with the seams a `.scape` import actually uses. */
class FakeGenerationStore {
	readonly projects = new Map<string, ArchiveDocument>();
	readonly fenced = new WeakSet<object>();
	closed = false;

	constructor(readonly label: string, projects: readonly ArchiveDocument[] = []) {
		for (const project of projects) this.projects.set(project.id, project);
	}

	async ready(): Promise<void> {}

	async listProjects(): Promise<readonly unknown[]> {
		return [...this.projects.values()].map((project) => ({ ...project }));
	}

	async loadProject(projectId: string): Promise<unknown> {
		const project = this.projects.get(projectId);
		return project ? { ...project } : null;
	}

	async createScapeProjectIfAbsent(project: ArchiveDocument): Promise<ArchiveDocument | null> {
		if (this.projects.has(project.id)) return null;
		const stored = { ...project };
		this.projects.set(project.id, stored);
		this.fenced.add(stored);
		return stored;
	}

	async deleteProjectIfCurrent(project: ArchiveDocument): Promise<boolean> {
		if (!this.fenced.has(project) || this.projects.get(project.id) !== project) return false;
		this.projects.delete(project.id);
		return true;
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}

interface ScapeReaderCall {
	readonly storeLabel: string | null;
	readonly schemaVersion: number;
	readonly documentOwner: 'this-build' | 'named';
}

/**
 * The `.scape` reader seams, modelled on the two decisions this pass turns on:
 * which store the call was given, and which document owner admitted the archive.
 */
function fakeScapeReader() {
	const inspects: ScapeReaderCall[] = [];
	const imports: ScapeReaderCall[] = [];
	const read = async (input: unknown): Promise<ArchiveDocument> => {
		const bytes = input instanceof Blob
			? new Uint8Array(await input.arrayBuffer())
			: input as Uint8Array;
		return JSON.parse(TEXT_DECODER.decode(bytes)) as ArchiveDocument;
	};
	const admit = (document: ArchiveDocument, options: unknown): LoadedDocument => {
		const owner = (options as { migrateProject?: unknown } | null)?.migrateProject;
		return typeof owner === 'function'
			? (owner as (value: unknown) => LoadedDocument)(document)
			: sharedEditorDocumentOwner(document);
	};
	const record = (
		calls: ScapeReaderCall[],
		store: unknown,
		document: ArchiveDocument,
		options: unknown,
	): void => {
		calls.push({
			storeLabel: (store as FakeGenerationStore | null)?.label ?? null,
			schemaVersion: document.schemaVersion,
			documentOwner: typeof (options as { migrateProject?: unknown } | null)?.migrateProject === 'function'
				? 'named'
				: 'this-build',
		});
	};
	return {
		inspects,
		imports,
		inspectProject: async (input: unknown, store: unknown, options: unknown) => {
			const document = await read(input);
			record(inspects, store, document, options);
			const loaded = admit(document, options);
			if (loaded.readOnly) {
				return {
					id: loaded.project.id,
					title: loaded.project.title,
					schemaVersion: loaded.project.schemaVersion,
					readOnly: true,
					reason: loaded.reason,
					exists: false,
				};
			}
			const existing = await (store as FakeGenerationStore | null)?.loadProject?.(loaded.project.id);
			return {
				id: loaded.project.id,
				title: loaded.project.title,
				schemaVersion: loaded.project.schemaVersion,
				readOnly: false,
				reason: null,
				exists: Boolean(existing),
			};
		},
		importProject: async (input: unknown, store: unknown, options: unknown) => {
			const document = await read(input);
			record(imports, store, document, options);
			const loaded = admit(document, options);
			if (loaded.readOnly) return { project: null, readOnly: true, reason: loaded.reason };
			const receiving = store as FakeGenerationStore;
			const created = await receiving.createScapeProjectIfAbsent(loaded.project);
			if (!created) throw new Error('A project with this ID already exists.');
			return { project: created, readOnly: false, collision: null };
		},
	};
}

function archiveEntry(document: ArchiveDocument): unknown {
	return {
		projectId: document.id,
		title: document.title,
		bytes: TEXT_ENCODER.encode(JSON.stringify(document)),
	};
}

function fakeGeneration(
	id: string,
	schemaVersion: number,
	open: TransferStoreGeneration['open'],
): TransferStoreGeneration {
	const databaseName = `kw-media-${id}`;
	return Object.freeze({
		id,
		label: `${id} storage`,
		databaseName,
		schemaVersion,
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
/* Where an arriving archive is written.                                   */
/* ---------------------------------------------------------------------- */

test('an archive is imported into the store the visitor\'s editor opens', async () => {
	const shared = new FakeGenerationStore('shared');
	const v31 = new FakeGenerationStore('framescaper-v31');
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [{ name: 'kw-media-framescaper-v31' }] },
		generations: [fakeGeneration('framescaper-v31', 31, async () => v31)],
	});
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [archiveEntry({ id: 'video-1', title: 'Interview cut', schemaVersion: 31 })],
	});
	assert.deepEqual(result.entries.map((record) => [record.outcome, record.projectId]), [
		['imported', 'video-1'],
	]);
	// The whole point: the database the editor opens is the database it is in.
	assert.deepEqual([...v31.projects.keys()], ['video-1']);
	assert.deepEqual([...shared.projects.keys()], []);
	assert.equal(v31.projects.get('video-1')?.schemaVersion, 31);
	// And it was read as its own generation, not migrated to the shared schema.
	assert.deepEqual(reader.imports.map((call) => [call.storeLabel, call.documentOwner]), [
		['framescaper-v31', 'named'],
	]);
	await source.close();
});

test('a shared V17 archive still goes to the shared store, on this build\'s own terms', async () => {
	// The one home whose document owner this build can reach. It keeps it: an
	// arriving V17 document is admitted by exactly the rule its editor applies.
	const shared = new FakeGenerationStore('shared');
	const v31 = new FakeGenerationStore('framescaper-v31');
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [{ name: 'kw-media-framescaper-v31' }] },
		generations: [fakeGeneration('framescaper-v31', 31, async () => v31)],
	});
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [archiveEntry({
			id: 'audio-1',
			title: 'Field recording',
			schemaVersion: TRANSFER_SHARED_EDITOR_STORE.schemaVersion,
		})],
	});
	assert.deepEqual(result.entries.map((record) => record.outcome), ['imported']);
	assert.deepEqual([...shared.projects.keys()], ['audio-1']);
	assert.deepEqual([...v31.projects.keys()], []);
	assert.deepEqual(reader.imports.map((call) => [call.storeLabel, call.documentOwner]), [
		['shared', 'this-build'],
	]);
	await source.close();
});

test('a generation this origin has never had is opened for the archive that needs it', async () => {
	// The ordinary case on a receiving origin: `indexedDB.databases()` answers
	// with nothing, so nothing is opened for the listing - and the archive still
	// has to land in the database its editor will open, which means creating it,
	// exactly as that editor's own first run would.
	const shared = new FakeGenerationStore('shared');
	const v31 = new FakeGenerationStore('framescaper-v31');
	let opens = 0;
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [] },
		generations: [fakeGeneration('framescaper-v31', 31, async () => {
			opens += 1;
			return v31;
		})],
	});
	assert.deepEqual(source.sources.map((handle) => handle.id), ['shared-editor-storage']);
	assert.equal(opens, 0, 'listing must not open a generation this device has no database for');
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [
			archiveEntry({ id: 'video-1', title: 'Interview cut', schemaVersion: 31 }),
			archiveEntry({ id: 'video-2', title: 'Second cut', schemaVersion: 31 }),
		],
	});
	assert.deepEqual(result.entries.map((record) => record.outcome), ['imported', 'imported']);
	assert.deepEqual([...v31.projects.keys()], ['video-1', 'video-2']);
	assert.equal(opens, 1, 'two archives of one generation open its database once');
	// And it is closed with the rest: a connection this page left open blocks the
	// editor's own version upgrade, and the visitor is about to open that editor.
	await source.close();
	assert.deepEqual([shared.closed, v31.closed], [true, true]);
});

test('an archive of a generation this build does not know is refused by name', async () => {
	const shared = new FakeGenerationStore('shared');
	const v31 = new FakeGenerationStore('framescaper-v31');
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [] },
		generations: [fakeGeneration('framescaper-v31', 31, async () => v31)],
	});
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [archiveEntry({ id: 'video-9', title: 'From a newer build', schemaVersion: 33 })],
	});
	assert.deepEqual(result.entries.map((record) => record.outcome), ['failed']);
	assert.match(result.entries[0].reason ?? '', /schema 33/u);
	assert.match(result.entries[0].reason ?? '', /nowhere to be imported/u);
	assert.equal(result.entries[0].residue, 'none');
	// Refused, not written somewhere convenient.
	assert.deepEqual([...shared.projects.keys()], []);
	assert.deepEqual([...v31.projects.keys()], []);
	assert.deepEqual(reader.imports, []);
	await source.close();
});

test('the refusal names the schema, and carries it', async () => {
	const shared = new FakeGenerationStore('shared');
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [] },
		generations: [],
	});
	const reader = fakeScapeReader();
	const importArchive = importIntoHomeStore(reader.importProject, reader.inspectProject);
	await assert.rejects(
		() => Promise.resolve(importArchive(
			TEXT_ENCODER.encode(JSON.stringify({ id: 'video-1', title: 'Cut', schemaVersion: 28 })),
			source.store,
			{ collision: 'cancel' },
		)),
		(error: unknown) => {
			assert.ok(error instanceof TransferArchiveHomeError);
			assert.equal(error.schemaVersion, 28);
			return true;
		},
	);
	await source.close();
});

/* ---------------------------------------------------------------------- */
/* What the receiving store is asked about an identity.                    */
/* ---------------------------------------------------------------------- */

test('an archive already present in its own generation is skipped, not imported over', async () => {
	// The skip decision is an answer about a store. Probing the shared database
	// for a project that can only be in a generation answers "not present" every
	// time, which is how a duplicate reaches the import's own collision fence and
	// is reported as a failure rather than the skip it is.
	const shared = new FakeGenerationStore('shared');
	const v31 = new FakeGenerationStore('framescaper-v31', [
		{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 },
	]);
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [{ name: 'kw-media-framescaper-v31' }] },
		generations: [fakeGeneration('framescaper-v31', 31, async () => v31)],
	});
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [archiveEntry({ id: 'video-1', title: 'Interview cut', schemaVersion: 31 })],
	});
	assert.deepEqual(result.entries.map((record) => [record.outcome, record.reasonCode]), [
		['skipped', 'already-present'],
	]);
	assert.deepEqual(reader.imports, [], 'a present project is never handed to the importer');
	await source.close();
});

test('the federation answers for the identity in a home it opened, not only for its writer', async () => {
	// What the import layer's residue guard asks after a failure. Answering only
	// for the shared store would report an untidied import into a generation as
	// nothing left behind at all.
	const shared = new FakeGenerationStore('shared');
	const v31 = new FakeGenerationStore('framescaper-v31');
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [] },
		generations: [fakeGeneration('framescaper-v31', 31, async () => v31)],
	});
	const reader = fakeScapeReader();
	await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [archiveEntry({ id: 'video-1', title: 'Interview cut', schemaVersion: 31 })],
	});
	const federated = source.store as { loadProject(id: string): Promise<{ id: string } | null> };
	assert.equal((await federated.loadProject('video-1'))?.id, 'video-1');
	assert.equal(await federated.loadProject('video-2'), null);
	await source.close();
});

test('a store that cannot route is handed to the reader unchanged', async () => {
	// Every injected-store caller and test keeps working: routing is what a
	// federation offers, not a precondition of importing an archive.
	const plain = new FakeGenerationStore('plain');
	const reader = fakeScapeReader();
	const importArchive = importIntoHomeStore(reader.importProject, reader.inspectProject);
	await importArchive(
		TEXT_ENCODER.encode(JSON.stringify({
			id: 'audio-1',
			title: 'Field recording',
			schemaVersion: TRANSFER_SHARED_EDITOR_STORE.schemaVersion,
		})),
		plain,
		{ collision: 'cancel' },
	);
	assert.deepEqual([...plain.projects.keys()], ['audio-1']);
	assert.deepEqual(reader.imports.map((call) => call.storeLabel), ['plain']);
});

test('the exact schema match is what stands in for the generation\'s own validator', async () => {
	// A generation's document owner lives inside that product's chunk and cannot
	// be reached from this page, so an arriving document is admitted `as-stored`.
	// The whole custody that replaces the owner's validation is this one check:
	// the schema the archive was *routed* on and the schema the document actually
	// carries must be the same number. Without it, `as-stored` means "write
	// whatever arrived into whichever database the header pointed at", and the
	// header is the only thing that chose the database.
	//
	// The two reads are separate reads of the same input - the header probe picks
	// the home, the import re-reads the archive against it - so an input whose
	// bytes are not stable between them (a Blob over a file the visitor replaced,
	// a re-read stream) is exactly the case this closes.
	const shared = new FakeGenerationStore('shared');
	const v31 = new FakeGenerationStore('framescaper-v31');
	const v28 = new FakeGenerationStore('framescaper-v28');
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [] },
		generations: [
			fakeGeneration('framescaper-v31', 31, async () => v31),
			fakeGeneration('framescaper-v28', 28, async () => v28),
		],
	});
	// The header read answers 31, so the V31 database is chosen; the document the
	// importer then reads carries 28.
	const header = async () => ({ id: 'video-1', title: 'Cut', schemaVersion: 31 });
	const importProject = async (_input: unknown, store: unknown, options: unknown) => {
		const owner = (options as { migrateProject?: unknown }).migrateProject;
		assert.equal(typeof owner, 'function', 'a generation store admits through a named owner');
		const loaded = (owner as (value: unknown) => LoadedDocument)({
			id: 'video-1', title: 'Cut', schemaVersion: 28,
		});
		await (store as FakeGenerationStore).createScapeProjectIfAbsent(loaded.project);
		return { project: loaded.project, readOnly: false, collision: null };
	};
	const importArchive = importIntoHomeStore(
		importProject as never,
		header as never,
	);
	await assert.rejects(
		() => Promise.resolve(importArchive(new Uint8Array(), source.store, { collision: 'cancel' })),
		(error: unknown) => {
			assert.ok(error instanceof TransferArchiveHomeError, `saw ${String(error)}`);
			assert.match(error.message, /read as schema 31 and now carries 28/u);
			return true;
		},
	);
	// Neither generation was written, least of all the one the header named.
	assert.deepEqual([...v31.projects.keys()], []);
	assert.deepEqual([...v28.projects.keys()], []);
	assert.deepEqual([...shared.projects.keys()], []);
	await source.close();
});

test('an identity held by a different store does not make an archive look already-present', async () => {
	// The `exists` probe decides whether an archive is skipped as a duplicate,
	// and it is a question about *the store this archive will be written to*.
	// The federation answers `loadProject` for the whole origin on purpose - the
	// residue guard needs that - so inspecting against the federation rather than
	// against the home turns a collision anywhere on the origin into a skip: the
	// generation database the visitor's editor opens stays empty while the page
	// reports the project as already there.
	//
	// The shape is not hypothetical. A visitor who ran the earlier build, whose
	// every archive landed in `kw-media-audio-editor`, has exactly it on their
	// receiving origin - the shared store holds the id, the generation store
	// holds nothing - so the retry that is supposed to rescue them is the run
	// this would silently refuse.
	const shared = new FakeGenerationStore('shared', [
		{ id: 'video-1', title: 'Stranded by the old build', schemaVersion: 31 },
	]);
	const v31 = new FakeGenerationStore('framescaper-v31');
	const source = await openTransferStore({
		openSharedStore: async () => shared,
		databases: { databases: async () => [{ name: 'kw-media-framescaper-v31' }] },
		generations: [fakeGeneration('framescaper-v31', 31, async () => v31)],
	});
	// The federation does answer for the whole origin, which is what makes this a
	// trap rather than a coincidence.
	const federated = source.store as { loadProject(id: string): Promise<{ id: string } | null> };
	assert.equal((await federated.loadProject('video-1'))?.id, 'video-1');
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [archiveEntry({ id: 'video-1', title: 'Interview cut', schemaVersion: 31 })],
	});
	assert.deepEqual(result.entries.map((record) => [record.outcome, record.reasonCode]), [
		['imported', null],
	], 'the archive belongs in the V31 store, which does not hold this id');
	assert.deepEqual([...v31.projects.keys()], ['video-1']);
	// And the stranded copy in the shared store is left exactly as it was.
	assert.equal(shared.projects.get('video-1')?.title, 'Stranded by the old build');
	// The probe that decided it was put to the home store. The store-free calls
	// are the header reads that choose the home in the first place.
	assert.deepEqual(
		reader.inspects.filter((call) => call.storeLabel !== null).map((call) => call.storeLabel),
		['framescaper-v31'],
	);
	await source.close();
});
