/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors, awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import type { ScapeVideoWriter } from './scape-archive-video.ts';
import type { OwnedMediaAssetPublication } from './storage/media-asset-write-contract.ts';
import type { StorageRecord } from './storage/media-records.ts';

interface ScapeProjectDocument {
	readonly id: string;
	readonly revision?: number;
	readonly [field: string]: unknown;
}

interface ScapeProjectRevision {
	readonly revision: number;
	readonly project: ScapeProjectDocument;
}

export interface ScapeImportStore {
	estimateStorage?(): PromiseLike<Readonly<{
		readonly usage: number | null;
		readonly quota: number | null;
	}>> | Readonly<{
		readonly usage: number | null;
		readonly quota: number | null;
	}>;
	loadProject(projectId: string): Promise<ScapeProjectDocument | null>;
	listProjectRevisions(projectId: string): Promise<ScapeProjectRevision[]>;
	getSourceMetadata(sourceId: string): PromiseLike<unknown>;
	getMediaAssetMetadata(sourceId: string): PromiseLike<unknown>;
	loadMediaAsset?(sourceId: string, options?: Readonly<{
		signal?: AbortSignal;
	}>): PromiseLike<Blob | null>;
	beginSourceWrite(sourceId: string, metadata: Readonly<Record<string, unknown>>): PromiseLike<unknown>;
	beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{
			expectedBytes: number;
			expectedSha256: string;
			signal?: AbortSignal;
		}>,
	): PromiseLike<ScapeVideoWriter>;
	createScapeProjectIfAbsent?(project: ScapeProjectDocument): PromiseLike<ScapeProjectDocument | null>;
	createProjectIfAbsent?(project: ScapeProjectDocument): PromiseLike<ScapeProjectDocument | null>;
	deleteProjectIfCurrent?(project: ScapeProjectDocument): PromiseLike<boolean>;
	saveProject(project: ScapeProjectDocument): PromiseLike<unknown>;
	saveProjectIfCurrent?(
		expected: ScapeProjectDocument,
		project: ScapeProjectDocument,
	): PromiseLike<ScapeProjectDocument | null>;
	deleteProject(projectId: string): PromiseLike<unknown>;
	discardSourceIfCurrent(source: StorageRecord): PromiseLike<boolean>;
	/**
	 * Replace only the project's document and revision rows with a captured
	 * snapshot, preserving linked-original bindings and skipping publication
	 * admission. Preferred over delete-then-resave for replace rollback.
	 */
	restoreProjectSnapshot?(projectId: string, snapshot: Readonly<{
		readonly current: ScapeProjectDocument | null;
		readonly revisions: readonly ScapeProjectRevision[];
	}>): PromiseLike<unknown>;
	restoreProjectSnapshotIfCurrent?(projectId: string, expected: ScapeProjectDocument, snapshot: Readonly<{
		readonly current: ScapeProjectDocument | null;
		readonly revisions: readonly ScapeProjectRevision[];
	}>): PromiseLike<boolean>;
}

interface ProjectSnapshot {
	readonly current: ScapeProjectDocument | null;
	readonly revisions: readonly ScapeProjectRevision[];
}

/** Tracks every import mutation until final project publication makes the operation complete. */
export class ScapeImportTransaction {
	readonly #store: ScapeImportStore;
	readonly #signal?: AbortSignal;
	readonly #sourcePublications: StorageRecord[] = [];
	readonly #mediaPublications: OwnedMediaAssetPublication[] = [];
	#projectId: string | null = null;
	#projectSnapshot: ProjectSnapshot | null = null;
	#createdProject: ScapeProjectDocument | null = null;
	#publishedProject: ScapeProjectDocument | null = null;
	#createOnlyPublicationAttempted = false;
	#projectWriteAttempted = false;
	#complete = false;

	constructor(store: ScapeImportStore, signal?: AbortSignal) {
		this.#store = store;
		this.#signal = signal;
	}

	trackProvisionalSource(source: StorageRecord): void {
		if (this.#complete) throw new Error('The Scape import transaction is already complete.');
		if (!isOwnedScapeSource(source)) {
			throw new TypeError('A Scape provisional PCM source requires exact storage ownership.');
		}
		if (!this.#sourcePublications.some((candidate) => (
			candidate.id === source.id && candidate.sourceToken === source.sourceToken
		))) {
			this.#sourcePublications.push(Object.freeze({ ...source }));
		}
	}

	trackProvisionalMedia(publication: OwnedMediaAssetPublication): void {
		if (this.#complete) throw new Error('The Scape import transaction is already complete.');
		if (!publication || typeof publication !== 'object'
			|| typeof publication.discardIfCurrent !== 'function') {
			throw new TypeError('A Scape provisional media publication requires exact ownership.');
		}
		if (!this.#mediaPublications.includes(publication)) this.#mediaPublications.push(publication);
	}

	async captureProject(projectId: string): Promise<void> {
		if (this.#projectSnapshot) throw new Error('The Scape target project was already captured.');
		throwIfScapeAborted(this.#signal);
		const current = await awaitScapeOperation(this.#store.loadProject(projectId), this.#signal);
		const revisions = await awaitScapeOperation(this.#store.listProjectRevisions(projectId), this.#signal);
		this.#projectId = projectId;
		this.#projectSnapshot = { current, revisions };
	}

	async publishProject(project: ScapeProjectDocument): Promise<void> {
		if (this.#projectId !== project.id || !this.#projectSnapshot) {
			throw new Error('The Scape target project was not captured before publication.');
		}
		throwIfScapeAborted(this.#signal);
		const createExactly = this.#store.createScapeProjectIfAbsent ?? this.#store.createProjectIfAbsent;
		const canCreateExactly = typeof createExactly === 'function';
		const canDeleteExactly = typeof this.#store.deleteProjectIfCurrent === 'function';
		const capturedProject = this.#projectSnapshot.current;
		if (capturedProject === null) {
			if (!canCreateExactly || !canDeleteExactly) {
				throw new TypeError('Create-only Scape publication requires exact-current rollback.');
			}
			this.#createOnlyPublicationAttempted = true;
			this.#projectWriteAttempted = true;
			const created = await createExactly.call(this.#store, project);
			if (created === null) throw new Error('The Scape target project was created concurrently.');
			if (created.id !== project.id) {
				throw new Error('Create-only Scape publication changed the target project identity.');
			}
			// Retain the repository's creation-fence token as the committed result.
			this.#createdProject = created;
			this.#complete = true;
			return;
		}
		if (typeof this.#store.restoreProjectSnapshotIfCurrent !== 'function') {
			throw new TypeError('Replace-import publication requires exact-current snapshot rollback.');
		}
		if (typeof this.#store.saveProjectIfCurrent !== 'function') {
			throw new TypeError('Replace-import publication requires exact-current project storage.');
		}
		this.#publishedProject = project;
		this.#projectWriteAttempted = true;
		const published = await this.#store.saveProjectIfCurrent(capturedProject, project);
		if (published === null) {
			this.#publishedProject = null;
			// A competing publisher can adopt this transaction's same-ID staging.
			throw new Error('The Scape target project changed concurrently during import.');
		}
		if (isScapeProjectDocument(published, project.id)) this.#publishedProject = published;
		this.#complete = true;
	}

	complete(): void {
		this.#complete = true;
	}

	async rollback(primary: unknown): Promise<never> {
		if (this.#complete) throw primary;
		const cleanupErrors: unknown[] = [];
		let mayDiscardProjectAssets = true;
		if (this.#projectWriteAttempted && this.#projectId && this.#projectSnapshot) {
			try {
				mayDiscardProjectAssets = await this.#restoreProject(this.#projectId, this.#projectSnapshot);
			} catch (error) {
				cleanupErrors.push(error);
				mayDiscardProjectAssets = false;
			}
		}
		if (mayDiscardProjectAssets) {
			for (const publication of [...this.#mediaPublications].reverse()) {
				try {
					await publication.discardIfCurrent();
				} catch (error) {
					cleanupErrors.push(error);
				}
			}
			for (const source of [...this.#sourcePublications].reverse()) {
				try {
					await this.#store.discardSourceIfCurrent(source);
				} catch (error) {
					cleanupErrors.push(error);
				}
			}
		}
		throw aggregateScapeErrors(primary, cleanupErrors, 'The Scape import and rollback both failed.');
	}

	async #restoreProject(projectId: string, snapshot: ProjectSnapshot): Promise<boolean> {
		if (this.#createdProject) {
			if (typeof this.#store.deleteProjectIfCurrent !== 'function') {
				throw new TypeError('Create-only Scape publication lost its exact-current rollback capability.');
			}
			return this.#store.deleteProjectIfCurrent(this.#createdProject);
		}
		// A competing creator can publish this transaction's same-ID staged assets;
		// without project ownership they must be left for reachability maintenance.
		if (snapshot.current === null && this.#createOnlyPublicationAttempted) return false;
		if (this.#publishedProject) {
			if (typeof this.#store.restoreProjectSnapshotIfCurrent !== 'function') {
				throw new TypeError('Replace-import rollback lost its exact-current restore capability.');
			}
			// The exact atomic restore preserves both linked-original bindings and
			// any project document a later writer published after the import.
			return this.#store.restoreProjectSnapshotIfCurrent(
				projectId,
				this.#publishedProject,
				snapshot,
			);
		}
		return false;
	}
}

function isScapeProjectDocument(value: unknown, projectId: string): value is ScapeProjectDocument {
	return Boolean(value && typeof value === 'object'
		&& 'id' in value && value.id === projectId);
}

function isOwnedScapeSource(value: unknown): value is StorageRecord {
	return Boolean(value && typeof value === 'object'
		&& 'id' in value && typeof value.id === 'string' && value.id.length
		&& 'sourceToken' in value && typeof value.sourceToken === 'string' && value.sourceToken.length);
}

export function assertScapeImportStore(value: unknown): asserts value is ScapeImportStore {
	const store = value as Partial<ScapeImportStore> | null;
	for (const method of [
		'loadProject',
		'listProjectRevisions',
		'getSourceMetadata',
		'getMediaAssetMetadata',
		'beginSourceWrite',
		'beginMediaAssetWrite',
		'saveProject',
		'deleteProject',
		'discardSourceIfCurrent',
	] as const) {
		if (typeof store?.[method] !== 'function') throw new TypeError('A transactional project store is required.');
	}
}
