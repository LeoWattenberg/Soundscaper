/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Injected fakes for the bulk project transfer tests: a minimal project store
 * and a stand-in .scape archive whose documents are plain JSON, so the
 * transfer module's own behaviour is what the tests observe.
 */

import assert from 'node:assert/strict';
import {
	PROJECT_TRANSFER_ENTRY_MIME_TYPE,
	type ProjectTransferEntry,
	type ProjectTransferExportEvent,
} from '../src/common/transfer/project-transfer-bundle.ts';

export interface FakeProjectDocument {
	readonly id: string;
	readonly title: string;
	readonly product?: string;
}

export interface FakeArchiveDocument {
	readonly id: string;
	readonly title: string;
	readonly readOnly?: boolean;
	readonly reason?: string;
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function archiveBytes(document: FakeArchiveDocument): Uint8Array<ArrayBuffer> {
	return TEXT_ENCODER.encode(JSON.stringify(document));
}

async function readArchive(input: unknown): Promise<FakeArchiveDocument> {
	const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input as Uint8Array;
	assert.ok(bytes instanceof Uint8Array, 'the archive input must resolve to bytes');
	return JSON.parse(TEXT_DECODER.decode(bytes)) as FakeArchiveDocument;
}

/**
 * A minimal project store: the seam the transfer module actually uses.
 *
 * It publishes new identities the way the real editor store does - through a
 * create-only fence that hands back the exact stored document, removable only
 * by an exact-current compare-and-delete. That fence is the evidence the
 * transfer module needs to prove authorship of a residue project, so the fake
 * has to model it rather than expose a blind delete.
 */
export class FakeStore {
	readonly projects = new Map<string, FakeProjectDocument>();
	readonly deletions: string[] = [];
	readonly fencedCreations = new WeakSet<object>();
	/** Test hook: runs on every load, so a concurrent writer can be simulated. */
	onLoad: ((projectId: string) => void) | null = null;

	constructor(projects: readonly FakeProjectDocument[] = []) {
		for (const project of projects) this.projects.set(project.id, project);
	}

	async listProjects(): Promise<readonly unknown[]> {
		return [...this.projects.values()].map((project) => ({ ...project }));
	}

	async loadProject(projectId: string): Promise<unknown> {
		this.onLoad?.(projectId);
		const project = this.projects.get(projectId);
		return project ? { ...project } : null;
	}

	async createScapeProjectIfAbsent(project: FakeProjectDocument): Promise<FakeProjectDocument | null> {
		if (this.projects.has(project.id)) return null;
		const stored = { ...project };
		this.projects.set(project.id, stored);
		this.fencedCreations.add(stored);
		return stored;
	}

	/**
	 * The blind delete the real store also exposes. It is kept here on purpose:
	 * a residue guard that reaches for it destroys whatever sits at the id, and
	 * these tests must be able to observe that rather than be protected from it
	 * by a fake that happens to lack the method.
	 */
	async deleteProject(projectId: string): Promise<void> {
		this.deletions.push(projectId);
		this.projects.delete(projectId);
	}

	/** Removes only the exact document this store handed back at creation. */
	async deleteProjectIfCurrent(project: FakeProjectDocument): Promise<boolean> {
		if (!this.fencedCreations.has(project)) return false;
		if (this.projects.get(project.id) !== project) return false;
		this.projects.delete(project.id);
		this.deletions.push(project.id);
		return true;
	}
}

export interface FakeArchiveRuntime {
	readonly exportProject: (project: unknown, store: unknown, options: unknown) => Promise<{ blob: Blob }>;
	readonly inspectProject: (input: unknown, store: unknown, options: unknown) => Promise<unknown>;
	readonly importProject: (input: unknown, store: unknown, options: unknown) => Promise<unknown>;
	readonly exportCalls: string[];
	readonly importCalls: string[];
	readonly inspectCalls: string[];
	readonly collisions: unknown[];
}

export interface FakeArchiveOptions {
	/** Bytes produced for a project, when the default document is not wanted. */
	readonly bytesFor?: (project: FakeProjectDocument) => Uint8Array<ArrayBuffer>;
	readonly failExport?: (project: FakeProjectDocument) => Error | null;
	/** Called before the receiving store is written, to fail an import mid-way. */
	readonly failImport?: (document: FakeArchiveDocument) => Error | null;
	readonly partialWriteOnFailure?: boolean;
	readonly failInspect?: (bytes: Uint8Array) => Error | null;
	/**
	 * Runs inside the import, after the transfer module inspected the archive
	 * and before the import takes its own collision fence: the window another
	 * tab, popup or file import can write into.
	 */
	readonly beforeImport?: (document: FakeArchiveDocument, store: FakeStore) => void | Promise<void>;
}

export function createFakeArchive(options: FakeArchiveOptions = {}): FakeArchiveRuntime {
	const exportCalls: string[] = [];
	const importCalls: string[] = [];
	const inspectCalls: string[] = [];
	const collisions: unknown[] = [];
	return {
		exportCalls,
		importCalls,
		inspectCalls,
		collisions,
		async exportProject(project: unknown, _store: unknown, exportOptions: unknown) {
			const document = project as FakeProjectDocument;
			exportCalls.push(document.id);
			const settings = exportOptions as { maximumBlobBytes?: unknown };
			assert.equal(typeof settings.maximumBlobBytes, 'number');
			const failure = options.failExport?.(document) ?? null;
			if (failure) throw failure;
			const bytes = options.bytesFor?.(document)
				?? archiveBytes({ id: document.id, title: document.title });
			return { blob: new Blob([bytes], { type: PROJECT_TRANSFER_ENTRY_MIME_TYPE }) };
		},
		async inspectProject(input: unknown, store: unknown, _options: unknown) {
			const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input as Uint8Array;
			const failure = options.failInspect?.(bytes) ?? null;
			if (failure) throw failure;
			const document = await readArchive(bytes);
			inspectCalls.push(document.id);
			const receiving = store as FakeStore;
			return {
				id: document.id,
				title: document.title,
				readOnly: document.readOnly === true,
				reason: document.reason,
				exists: Boolean(await receiving.loadProject(document.id)),
			};
		},
		async importProject(input: unknown, store: unknown, importOptions: unknown) {
			const document = await readArchive(input);
			importCalls.push(document.id);
			collisions.push((importOptions as { collision?: unknown }).collision);
			const receiving = store as FakeStore;
			await options.beforeImport?.(document, receiving);
			// The 'cancel' collision fence the real .scape import takes for itself.
			if (await receiving.loadProject(document.id)) {
				throw new Error('A project with this ID already exists.');
			}
			if (document.readOnly === true) return { project: null, readOnly: true, reason: document.reason };
			const failure = options.failImport?.(document) ?? null;
			if (failure && !options.partialWriteOnFailure) throw failure;
			const published = await publishFakeProject(receiving, document);
			// A store that failed to roll its own write back leaves residue.
			if (failure) throw failure;
			return { project: published, readOnly: false, collision: null };
		},
	};
}

/**
 * Publish through the store's create-only fence when it has one, so the
 * document the store hands back is the only removable trace of this import.
 * A store without the fence is modelled too: it writes blind, and nothing
 * afterwards can attribute the row to this import.
 */
async function publishFakeProject(
	store: FakeStore,
	document: FakeArchiveDocument,
): Promise<FakeProjectDocument> {
	const project = { id: document.id, title: document.title };
	if (typeof store.createScapeProjectIfAbsent !== 'function') {
		store.projects.set(project.id, project);
		return project;
	}
	const created = await store.createScapeProjectIfAbsent(project);
	if (!created) throw new Error('A project with this ID already exists.');
	return created;
}

export interface CollectedExport {
	readonly entries: ProjectTransferEntry[];
	readonly failures: Extract<ProjectTransferExportEvent, { kind: 'failed' }>[];
	readonly summary: Extract<ProjectTransferExportEvent, { kind: 'summary' }> | null;
}

export async function collectExport(
	events: AsyncIterable<ProjectTransferExportEvent>,
): Promise<CollectedExport> {
	const entries: ProjectTransferEntry[] = [];
	const failures: Extract<ProjectTransferExportEvent, { kind: 'failed' }>[] = [];
	let summary: Extract<ProjectTransferExportEvent, { kind: 'summary' }> | null = null;
	for await (const event of events) {
		if (event.kind === 'entry') entries.push(event.entry);
		else if (event.kind === 'failed') failures.push(event);
		else summary = event;
	}
	return { entries, failures, summary };
}

export function transferEntries(entries: readonly ProjectTransferEntry[]): readonly unknown[] {
	return entries.map((entry) => ({
		projectId: entry.projectId,
		title: entry.title,
		bytes: entry.bytes,
		byteLength: entry.byteLength,
	}));
}
