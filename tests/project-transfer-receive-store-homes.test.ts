/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	ProjectReimportRequiredError,
	readProjectSchemaIdentity,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	type ProjectSchemaFamily,
} from '../src/common/editor/project-schema-identity.ts';
import { importProjectTransferBundle } from '../src/common/transfer/project-transfer-bundle.ts';
import {
	importIntoHomeStore,
	inspectInHomeStore,
	openTransferStore,
	TransferArchiveHomeError,
} from '../src/common/transfer/transfer-archive-runtime.ts';
import type { TransferStoreBaseline } from '../src/common/transfer/transfer-store-baselines.ts';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface ArchiveDocument {
	readonly id: string;
	readonly title: string;
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: number;
}

interface LoadedDocument {
	readonly project: ArchiveDocument;
	readonly migrated: boolean;
	readonly fromVersion: number;
	readonly readOnly: boolean;
	readonly reason: string | null;
}

class FakeFamilyStore {
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

interface ReaderCall {
	readonly storeLabel: string | null;
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: number;
	readonly namedOwner: boolean;
}

function fakeScapeReader() {
	const inspects: ReaderCall[] = [];
	const imports: ReaderCall[] = [];
	const read = async (input: unknown): Promise<ArchiveDocument> => {
		const bytes = input instanceof Blob
			? new Uint8Array(await input.arrayBuffer())
			: input as Uint8Array;
		return JSON.parse(TEXT_DECODER.decode(bytes)) as ArchiveDocument;
	};
	const admit = (document: ArchiveDocument, options: unknown): LoadedDocument => {
		const owner = (options as { loadProject?: unknown } | null)?.loadProject;
		if (typeof owner === 'function') return (owner as (value: unknown) => LoadedDocument)(document);
		const identity = readProjectSchemaIdentity(document);
		return {
			project: document,
			migrated: false,
			fromVersion: identity.schemaVersion,
			readOnly: false,
			reason: null,
		};
	};
	const record = (
		calls: ReaderCall[], store: unknown, document: ArchiveDocument, options: unknown,
	): void => {
		const identity = readProjectSchemaIdentity(document);
		calls.push({
			storeLabel: (store as FakeFamilyStore | null)?.label ?? null,
			...identity,
			namedOwner: typeof (options as { loadProject?: unknown } | null)?.loadProject === 'function',
		});
	};
	return {
		inspects,
		imports,
		inspectProject: async (input: unknown, store: unknown, options: unknown) => {
			const document = await read(input);
			record(inspects, store, document, options);
			const loaded = admit(document, options);
			const existing = await (store as FakeFamilyStore | null)?.loadProject?.(loaded.project.id);
			return {
				id: loaded.project.id,
				title: loaded.project.title,
				schemaFamily: loaded.project.schemaFamily,
				schemaVersion: loaded.project.schemaVersion,
				readOnly: loaded.readOnly,
				reason: loaded.reason,
				exists: Boolean(existing),
			};
		},
		importProject: async (input: unknown, store: unknown, options: unknown) => {
			const document = await read(input);
			record(imports, store, document, options);
			const loaded = admit(document, options);
			if (loaded.readOnly) return { project: null, readOnly: true, reason: loaded.reason };
			const receiving = store as FakeFamilyStore;
			const created = await receiving.createScapeProjectIfAbsent(loaded.project);
			if (!created) throw new Error('A project with this ID already exists.');
			return { project: created, readOnly: false, collision: null };
		},
	};
}

function document(
	schemaFamily: ProjectSchemaFamily,
	id: string,
	version: number = PROJECT_SCHEMA_VERSION,
): ArchiveDocument {
	return Object.freeze({
		id,
		title: `${schemaFamily} ${id}`,
		schemaFamily,
		schemaVersion: version,
	});
}

function archiveEntry(value: unknown): unknown {
	const record = value as { id?: unknown; title?: unknown };
	return {
		projectId: typeof record.id === 'string' ? record.id : null,
		title: typeof record.title === 'string' ? record.title : null,
		bytes: TEXT_ENCODER.encode(JSON.stringify(value)),
	};
}

function fakeBaseline(
	schemaFamily: ProjectSchemaFamily,
	open: TransferStoreBaseline['open'],
): TransferStoreBaseline {
	const id = `${schemaFamily}-v1`;
	const databaseName = `kw-media-${schemaFamily}-editor-v1`;
	return Object.freeze({
		id,
		label: `${schemaFamily} v1 storage`,
		databaseName,
		schemaFamily,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		profileNames: Object.freeze({
			databaseName,
			opfsDirectoryName: `${schemaFamily}-editor-v1-sources`,
			opfsWorkerName: `${schemaFamily}-editor-v1-opfs-storage`,
			projectLockPrefix: `${databaseName}-lock:`,
		}),
		open,
	});
}

test('archives route by family and same project ids land in separate v1 stores', async () => {
	const framescaper = new FakeFamilyStore('framescaper');
	const soundscaper = new FakeFamilyStore('soundscaper');
	const source = await openTransferStore({
		databases: { databases: async () => [] },
		baselines: [
			fakeBaseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, async () => framescaper),
			fakeBaseline(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, async () => soundscaper),
		],
	});
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [
			archiveEntry(document(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, 'same-id')),
			archiveEntry(document(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, 'same-id')),
		],
	});
	assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['imported', 'imported']);
	assert.equal(framescaper.projects.get('same-id')?.schemaFamily, 'framescaper');
	assert.equal(soundscaper.projects.get('same-id')?.schemaFamily, 'soundscaper');
	assert.deepEqual(reader.imports.map(({ storeLabel, namedOwner }) => [storeLabel, namedOwner]), [
		['framescaper', true],
		['soundscaper', true],
	]);
	await source.close();
});

test('a fresh family store opens on demand once and closes with the federation', async () => {
	const framescaper = new FakeFamilyStore('framescaper');
	let opens = 0;
	const source = await openTransferStore({
		databases: { databases: async () => [] },
		baselines: [fakeBaseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, async () => {
			opens += 1;
			return framescaper;
		})],
	});
	assert.deepEqual(source.sources, []);
	assert.equal(opens, 0);
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [
			archiveEntry(document(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, 'video-1')),
			archiveEntry(document(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, 'video-2')),
		],
	});
	assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['imported', 'imported']);
	assert.equal(opens, 1);
	await source.close();
	assert.equal(framescaper.closed, true);
});

test('a failed routed import clears its witnessed family-store publication before retry', async () => {
	const framescaper = new FakeFamilyStore('framescaper');
	const source = await openTransferStore({
		databases: { databases: async () => [] },
		baselines: [fakeBaseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, async () => framescaper)],
	});
	const reader = fakeScapeReader();
	const entry = archiveEntry(document(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, 'retryable'));
	const failed = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(async (input, store, options) => {
			await reader.importProject(input, store, options);
			throw new Error('Post-publication validation failed.');
		}, reader.inspectProject),
		entries: [entry],
	});

	assert.deepEqual(
		failed.entries.map(({ outcome, residue }) => [outcome, residue]),
		[['failed', 'cleared']],
	);
	assert.deepEqual([...framescaper.projects], []);

	const retried = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [entry],
	});
	assert.equal(retried.entries[0].outcome, 'imported');
	assert.equal(framescaper.projects.get('retryable')?.id, 'retryable');
	await source.close();
});

test('a future schema of a known family has no writable home', async () => {
	const framescaper = new FakeFamilyStore('framescaper');
	const source = await openTransferStore({
		databases: { databases: async () => [] },
		baselines: [fakeBaseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, async () => framescaper)],
	});
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [archiveEntry(document(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, 'future', 2))],
	});
	assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['failed']);
	assert.match(result.entries[0].reason ?? '', /framescaper schema 2/u);
	assert.deepEqual([...framescaper.projects], []);
	await source.close();
});

test('the no-home error carries both identity coordinates', async () => {
	const source = await openTransferStore({
		databases: { databases: async () => [] },
		baselines: [],
	});
	const reader = fakeScapeReader();
	const importArchive = importIntoHomeStore(reader.importProject, reader.inspectProject);
	await assert.rejects(
		() => Promise.resolve(importArchive(
			TEXT_ENCODER.encode(JSON.stringify(document(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, 'audio'))),
			source.store,
			{ collision: 'cancel' },
		)),
		(error: unknown) => {
			assert.ok(error instanceof TransferArchiveHomeError);
			assert.equal(error.schemaFamily, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY);
			assert.equal(error.schemaVersion, PROJECT_SCHEMA_VERSION);
			return true;
		},
	);
	await source.close();
});

test('numeric-only transfer documents preserve the shared typed re-import refusal', async () => {
	const framescaper = new FakeFamilyStore('framescaper');
	const source = await openTransferStore({
		databases: { databases: async () => [] },
		baselines: [fakeBaseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, async () => framescaper)],
	});
	const reader = fakeScapeReader();
	const importArchive = importIntoHomeStore(reader.importProject, reader.inspectProject);
	await assert.rejects(
		() => Promise.resolve(importArchive(
			TEXT_ENCODER.encode(JSON.stringify({ id: 'old', title: 'Old', schemaVersion: 31 })),
			source.store,
			{ collision: 'cancel' },
		)),
		(error: unknown) => error instanceof ProjectReimportRequiredError
			&& error.code === 'REIMPORT_REQUIRED',
	);
	await source.close();
});

test('inspection checks existence only in the archive family home', async () => {
	const stranded = document(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, 'same-id');
	const framescaper = new FakeFamilyStore('framescaper');
	const soundscaper = new FakeFamilyStore('soundscaper', [stranded]);
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
	const reader = fakeScapeReader();
	const result = await importProjectTransferBundle({
		store: source.store as Parameters<typeof importProjectTransferBundle>[0]['store'],
		inspectProject: inspectInHomeStore(reader.inspectProject),
		importProject: importIntoHomeStore(reader.importProject, reader.inspectProject),
		entries: [archiveEntry(document(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, 'same-id'))],
	});
	assert.deepEqual(result.entries.map(({ outcome, reasonCode }) => [outcome, reasonCode]), [
		['imported', null],
	]);
	assert.equal(framescaper.projects.get('same-id')?.schemaFamily, 'framescaper');
	assert.equal(soundscaper.projects.get('same-id')?.schemaFamily, 'soundscaper');
	assert.deepEqual(
		reader.inspects.filter(({ storeLabel }) => storeLabel !== null).map(({ storeLabel }) => storeLabel),
		['framescaper'],
	);
	await source.close();
});

test('header and body identity disagreement fails before either family is written', async () => {
	const framescaper = new FakeFamilyStore('framescaper');
	const soundscaper = new FakeFamilyStore('soundscaper');
	const source = await openTransferStore({
		databases: { databases: async () => [] },
		baselines: [
			fakeBaseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, async () => framescaper),
			fakeBaseline(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, async () => soundscaper),
		],
	});
	const header = async () => ({
		id: 'same-id', title: 'Header', schemaFamily: 'framescaper', schemaVersion: 1,
	});
	const importProject = async (_input: unknown, store: unknown, options: unknown) => {
		const owner = (options as { loadProject?: unknown }).loadProject;
		assert.equal(typeof owner, 'function');
		const loaded = (owner as (value: unknown) => LoadedDocument)(
			document(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, 'same-id'),
		);
		await (store as FakeFamilyStore).createScapeProjectIfAbsent(loaded.project);
		return { project: loaded.project, readOnly: false, collision: null };
	};
	const importArchive = importIntoHomeStore(importProject as never, header as never);
	await assert.rejects(
		() => Promise.resolve(importArchive(new Uint8Array(), source.store, { collision: 'cancel' })),
		(error: unknown) => error instanceof TransferArchiveHomeError
			&& /framescaper schema 1/u.test(error.message)
			&& /soundscaper schema 1/u.test(error.message),
	);
	assert.deepEqual([...framescaper.projects], []);
	assert.deepEqual([...soundscaper.projects], []);
	await source.close();
});

test('a plain non-routing store is handed to the reader unchanged', async () => {
	const plain = new FakeFamilyStore('plain');
	const reader = fakeScapeReader();
	const importArchive = importIntoHomeStore(reader.importProject, reader.inspectProject);
	await importArchive(
		TEXT_ENCODER.encode(JSON.stringify(document(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, 'audio'))),
		plain,
		{ collision: 'cancel' },
	);
	assert.equal(plain.projects.get('audio')?.schemaFamily, 'soundscaper');
});
