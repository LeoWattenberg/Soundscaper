/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors, awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import type { ScapeVideoWriter } from './scape-archive-video.ts';
import type { OwnedMediaAssetPublication } from './storage/media-asset-write-contract.ts';

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
	saveProject(project: ScapeProjectDocument): PromiseLike<unknown>;
	deleteProject(projectId: string): PromiseLike<unknown>;
	deleteSource(sourceId: string): PromiseLike<unknown>;
}

interface ProjectSnapshot {
	readonly current: ScapeProjectDocument | null;
	readonly revisions: readonly ScapeProjectRevision[];
}

/** Tracks every import mutation until archive closure makes the operation complete. */
export class ScapeImportTransaction {
	readonly #store: ScapeImportStore;
	readonly #signal?: AbortSignal;
	readonly #sourceIds: string[] = [];
	readonly #mediaPublications: OwnedMediaAssetPublication[] = [];
	#projectId: string | null = null;
	#projectSnapshot: ProjectSnapshot | null = null;
	#projectWriteAttempted = false;
	#complete = false;

	constructor(store: ScapeImportStore, signal?: AbortSignal) {
		this.#store = store;
		this.#signal = signal;
	}

	trackProvisionalSource(sourceId: string): void {
		if (this.#complete) throw new Error('The .scape import transaction is already complete.');
		if (!this.#sourceIds.includes(sourceId)) this.#sourceIds.push(sourceId);
	}

	trackProvisionalMedia(publication: OwnedMediaAssetPublication): void {
		if (this.#complete) throw new Error('The .scape import transaction is already complete.');
		if (!publication || typeof publication !== 'object'
			|| typeof publication.discardIfCurrent !== 'function') {
			throw new TypeError('A .scape provisional media publication requires exact ownership.');
		}
		if (!this.#mediaPublications.includes(publication)) this.#mediaPublications.push(publication);
	}

	async captureProject(projectId: string): Promise<void> {
		if (this.#projectSnapshot) throw new Error('The .scape target project was already captured.');
		throwIfScapeAborted(this.#signal);
		const current = await awaitScapeOperation(this.#store.loadProject(projectId), this.#signal);
		const revisions = await awaitScapeOperation(this.#store.listProjectRevisions(projectId), this.#signal);
		this.#projectId = projectId;
		this.#projectSnapshot = { current, revisions };
	}

	async publishProject(project: ScapeProjectDocument): Promise<void> {
		if (this.#projectId !== project.id || !this.#projectSnapshot) {
			throw new Error('The .scape target project was not captured before publication.');
		}
		throwIfScapeAborted(this.#signal);
		this.#projectWriteAttempted = true;
		await this.#store.saveProject(project);
		throwIfScapeAborted(this.#signal);
	}

	complete(): void {
		throwIfScapeAborted(this.#signal);
		this.#complete = true;
	}

	async rollback(primary: unknown): Promise<never> {
		if (this.#complete) throw primary;
		const cleanupErrors: unknown[] = [];
		if (this.#projectWriteAttempted && this.#projectId && this.#projectSnapshot) {
			try {
				await this.#restoreProject(this.#projectId, this.#projectSnapshot);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		for (const publication of [...this.#mediaPublications].reverse()) {
			try {
				await publication.discardIfCurrent();
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		for (const sourceId of [...this.#sourceIds].reverse()) {
			try {
				await this.#store.deleteSource(sourceId);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		throw aggregateScapeErrors(primary, cleanupErrors, 'The .scape import and rollback both failed.');
	}

	async #restoreProject(projectId: string, snapshot: ProjectSnapshot): Promise<void> {
		await this.#store.deleteProject(projectId);
		const revisions = [...snapshot.revisions]
			.sort((left, right) => left.revision - right.revision);
		for (const revision of revisions) await this.#store.saveProject(revision.project);
		if (snapshot.current) await this.#store.saveProject(snapshot.current);
	}
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
		'deleteSource',
	] as const) {
		if (typeof store?.[method] !== 'function') throw new TypeError('A transactional project store is required.');
	}
}
