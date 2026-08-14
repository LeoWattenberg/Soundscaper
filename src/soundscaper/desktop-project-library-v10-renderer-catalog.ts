/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import type { SoundscaperProjectV21 } from './editor-project-v21.ts';
import {
	SoundscaperDesktopV10DeleteIntents,
	type SoundscaperDesktopV10DeleteIntent,
} from './desktop-project-library-v10-delete-intents.ts';
import {
	snapshotSoundscaperDesktopV10Project,
	validateSoundscaperDesktopV10Bundle,
	validateSoundscaperDesktopV10CatalogSnapshot,
	validateSoundscaperDesktopV10DeleteResult,
	validateSoundscaperDesktopV10ProjectId,
	type SoundscaperDesktopV10BundleSnapshot,
	type SoundscaperDesktopV10ProjectSummary,
	type SoundscaperDesktopV10RendererBridge,
} from './desktop-project-library-v10-renderer-contract.ts';
import {
	createSoundscaperDesktopV10DuplicateProject,
	sameSoundscaperDesktopV10Project,
	validateSoundscaperDesktopV10DuplicateOptions,
	type SoundscaperDesktopV10DuplicateOptions,
	type SoundscaperDesktopV10WitnessLedger,
} from './desktop-project-library-v10-renderer-lifecycle.ts';

export interface SoundscaperDesktopV10RawShadowProjectStore {
	loadProject(projectId: string): PromiseLike<unknown> | unknown;
	readonly projectRepository: Readonly<{
		deleteExact(project: SoundscaperProjectV21): PromiseLike<boolean> | boolean;
	}>;
}

export class SoundscaperDesktopProjectLibraryV10CommittedError extends Error {
	readonly committed = true;
	readonly operation: 'delete' | 'duplicate' | 'publication';
	readonly projectId: string;

	constructor(
		operation: 'delete' | 'duplicate' | 'publication',
		projectId: string,
		cause: unknown,
	) {
		super(`The Soundscaper desktop V10 ${operation} committed, but renderer reconciliation failed.`, { cause });
		this.name = 'SoundscaperDesktopProjectLibraryV10CommittedError';
		this.operation = operation;
		this.projectId = projectId;
	}
}

export class SoundscaperDesktopProjectLibraryV10IndeterminateError extends Error {
	readonly outcome = 'indeterminate';
	readonly operation: 'delete' | 'duplicate' | 'publication';
	readonly projectId: string;

	constructor(
		operation: 'delete' | 'duplicate' | 'publication',
		projectId: string,
		primary: unknown,
		recovery: unknown,
	) {
		super(`The Soundscaper desktop V10 ${operation} outcome is indeterminate.`, {
			cause: new AggregateError([primary, recovery], 'Main acknowledgement recovery was inconclusive.'),
		});
		this.name = 'SoundscaperDesktopProjectLibraryV10IndeterminateError';
		this.operation = operation;
		this.projectId = projectId;
	}
}

/** Exact main-catalog lifecycle over private renderer witnesses and a raw V21 shadow repository. */
export class SoundscaperDesktopV10RendererCatalog {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #store: SoundscaperDesktopV10RawShadowProjectStore;
	readonly #bridge: SoundscaperDesktopV10RendererBridge;
	readonly #ledger: SoundscaperDesktopV10WitnessLedger;
	readonly #intents: SoundscaperDesktopV10DeleteIntents;
	readonly #tombstones = new Map<string, SoundscaperDesktopV10DeleteIntent>();
	readonly #reconcile: (
		snapshot: Readonly<SoundscaperDesktopV10BundleSnapshot>,
	) => Promise<SoundscaperProjectV21>;

	constructor(options: Readonly<{
		profile: EditorProjectRuntimeProfile;
		store: SoundscaperDesktopV10RawShadowProjectStore;
		bridge: SoundscaperDesktopV10RendererBridge;
		ledger: SoundscaperDesktopV10WitnessLedger;
		intents: SoundscaperDesktopV10DeleteIntents;
		reconcile(snapshot: Readonly<SoundscaperDesktopV10BundleSnapshot>): Promise<SoundscaperProjectV21>;
	}>) {
		this.#profile = options.profile;
		this.#store = options.store;
		this.#bridge = options.bridge;
		this.#ledger = options.ledger;
		this.#intents = options.intents;
		this.#reconcile = options.reconcile;
	}

	async listProjects(): Promise<readonly Readonly<SoundscaperDesktopV10ProjectSummary>[]> {
		return (await this.observeCatalog()).projects;
	}

	async observeCatalog() {
		const snapshot = validateSoundscaperDesktopV10CatalogSnapshot(await this.#bridge.listProjects());
		this.#ledger.observeCatalog(snapshot);
		return snapshot;
	}

	async recoverPublication(
		request: Readonly<{
			project: SoundscaperProjectV21;
			expectedMetadataRevision: number;
			expectedProject: Readonly<{
				projectRevision: number;
				projectSha256: string;
			}> | null;
		}>,
		primary: unknown,
	): Promise<Readonly<SoundscaperDesktopV10BundleSnapshot> | null> {
		const projectId = String(request.project.id);
		try {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw !== null) {
				const snapshot = validateSoundscaperDesktopV10Bundle(this.#profile, raw, projectId);
				if (snapshot.bundle.metadataRevision === request.expectedMetadataRevision + 1
					&& sameSoundscaperDesktopV10Project(snapshot.project, request.project)) {
					return snapshot;
				}
				if (request.expectedProject
					&& snapshot.bundle.metadataRevision === request.expectedMetadataRevision
					&& snapshot.bundle.project.projectRevision === request.expectedProject.projectRevision
					&& snapshot.bundle.project.sha256 === request.expectedProject.projectSha256) {
					return null;
				}
				throw new Error('Publication recovery found a divergent V21 project outcome.');
			}
			const catalog = validateSoundscaperDesktopV10CatalogSnapshot(await this.#bridge.listProjects());
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('Publication recovery found an unreadable catalog project.');
			}
			if (request.expectedProject === null
				&& catalog.metadataRevision === request.expectedMetadataRevision) return null;
			throw new Error('Publication recovery could not prove an unchanged main outcome.');
		} catch (recovery) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryV10IndeterminateError(
				'publication', projectId, primary, recovery,
			);
		}
	}

	async deleteProject(projectIdValue: string): Promise<void> {
		const projectId = validateSoundscaperDesktopV10ProjectId(projectIdValue);
		await this.observeCatalog();
		const witness = this.#ledger.takeCurrent(projectId);
		const intent = await this.#intents.create(witness);
		let metadataRevision: number;
		try {
			const result = validateSoundscaperDesktopV10DeleteResult(await this.#bridge.deleteProject({
				projectId,
				expectedMetadataRevision: witness.expectedMetadataRevision,
				expectedProject: witness.expectedProject,
			}), projectId);
			if (result.metadataRevision !== witness.expectedMetadataRevision + 1) {
				throw new Error('The desktop V10 delete acknowledgement changed its metadata revision.');
			}
			metadataRevision = result.metadataRevision;
		} catch (primary) {
			let recovered: number | null;
			try {
				recovered = await this.#recoverDelete(
					projectId, witness.expectedMetadataRevision, primary,
				);
			} catch (error) {
				throw error;
			}
			if (recovered === null) {
				await this.#intents.remove(intent);
				this.#ledger.clear();
				throw primary;
			}
			metadataRevision = recovered;
		}
		this.#ledger.commitDelete(projectId, witness.expectedMetadataRevision, metadataRevision);
		this.#tombstones.set(projectId, intent);
		try { await this.cleanupDeletedProject(projectId); }
		catch (error) { throw new SoundscaperDesktopProjectLibraryV10CommittedError('delete', projectId, error); }
	}

	async cleanupDeletedProject(projectIdValue: string): Promise<boolean> {
		const projectId = validateSoundscaperDesktopV10ProjectId(projectIdValue);
		if (!this.#tombstones.has(projectId)) return false;
		await this.#deleteShadow(projectId);
		return true;
	}

	async settleDeletedProject(projectIdValue: string): Promise<boolean> {
		const projectId = validateSoundscaperDesktopV10ProjectId(projectIdValue);
		const intent = this.#tombstones.get(projectId);
		if (!intent) return false;
		if (await this.#store.loadProject(projectId) !== null) {
			throw new Error('The exact V21 shadow remained after desktop delete reconciliation.');
		}
		await this.#intents.remove(intent);
		this.#tombstones.delete(projectId);
		return true;
	}

	async duplicateProject(
		sourceProjectIdValue: string,
		optionsValue: Readonly<SoundscaperDesktopV10DuplicateOptions>,
	): Promise<SoundscaperProjectV21> {
		const sourceProjectId = validateSoundscaperDesktopV10ProjectId(sourceProjectIdValue);
		const options = validateSoundscaperDesktopV10DuplicateOptions(optionsValue);
		await this.observeCatalog();
		const witness = this.#ledger.takeCurrent(sourceProjectId);
		const intended = createSoundscaperDesktopV10DuplicateProject(this.#profile, witness.project, options);
		let snapshot: Readonly<SoundscaperDesktopV10BundleSnapshot>;
		try {
			snapshot = validateSoundscaperDesktopV10Bundle(this.#profile, await this.#bridge.duplicateProject({
				sourceProjectId,
				copyProjectId: options.id,
				title: options.title,
				timestamp: options.timestamp,
				expectedMetadataRevision: witness.expectedMetadataRevision,
				expectedSource: witness.expectedProject,
			}), options.id);
			if (snapshot.bundle.metadataRevision !== witness.expectedMetadataRevision + 1
				|| !sameSoundscaperDesktopV10Project(snapshot.project, intended)) {
				throw new Error('The committed desktop V10 duplicate changed its requested V21 publication.');
			}
		} catch (primary) {
			const recovered = await this.#recoverDuplicate(
				options.id, intended, witness.expectedMetadataRevision, primary,
			);
			if (recovered === null) {
				this.#ledger.clear();
				throw primary;
			}
			snapshot = recovered;
		}
		try {
			const project = await this.#reconcile(snapshot);
			this.#ledger.commitSnapshot(witness.expectedMetadataRevision, snapshot);
			this.#ledger.restoreCurrent(witness, snapshot.bundle.metadataRevision);
			return project;
		} catch (error) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryV10CommittedError('duplicate', options.id, error);
		}
	}

	async #recoverDelete(
		projectId: string,
		expectedMetadataRevision: number,
		primary: unknown,
	): Promise<number | null> {
		try {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw !== null) {
				validateSoundscaperDesktopV10Bundle(this.#profile, raw, projectId);
				return null;
			}
			const catalog = validateSoundscaperDesktopV10CatalogSnapshot(await this.#bridge.listProjects());
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('The deleted project remains in the catalog without a readable bundle.');
			}
			if (catalog.metadataRevision !== expectedMetadataRevision + 1) {
				throw new Error('Delete recovery found an inexact catalog revision.');
			}
			return catalog.metadataRevision;
		} catch (recovery) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryV10IndeterminateError(
				'delete', projectId, primary, recovery,
			);
		}
	}

	async #recoverDuplicate(
		projectId: string,
		intended: SoundscaperProjectV21,
		expectedMetadataRevision: number,
		primary: unknown,
	): Promise<Readonly<SoundscaperDesktopV10BundleSnapshot> | null> {
		try {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw !== null) {
				const snapshot = validateSoundscaperDesktopV10Bundle(this.#profile, raw, projectId);
				if (snapshot.bundle.metadataRevision !== expectedMetadataRevision + 1
					|| !sameSoundscaperDesktopV10Project(snapshot.project, intended)) {
					throw new Error('The duplicate recovery destination contains another V21 project.');
				}
				return snapshot;
			}
			const catalog = validateSoundscaperDesktopV10CatalogSnapshot(await this.#bridge.listProjects());
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('The duplicate destination is catalogued without a readable bundle.');
			}
			return null;
		} catch (recovery) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryV10IndeterminateError(
				'duplicate', projectId, primary, recovery,
			);
		}
	}

	async #deleteShadow(projectId: string): Promise<void> {
		const intent = this.#tombstones.get(projectId);
		if (!intent) throw new Error('The desktop V10 delete intent is unavailable.');
		const currentValue = await this.#store.loadProject(projectId);
		if (currentValue === null || currentValue === undefined) return;
		const current = snapshotSoundscaperDesktopV10Project(this.#profile, currentValue);
		if (Number(current.project.revision) !== intent.projectRevision
			|| current.sha256 !== intent.projectSha256
			|| !await this.#store.projectRepository.deleteExact(current.project)) {
			throw new Error('The V21 shadow changed before exact desktop delete cleanup.');
		}
	}
}
