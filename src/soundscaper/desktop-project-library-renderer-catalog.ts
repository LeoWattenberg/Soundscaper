/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';
import {
	SoundscaperDesktopDeleteIntents,
	type SoundscaperDesktopDeleteIntent,
} from './desktop-project-library-delete-intents.ts';
import {
	snapshotSoundscaperDesktopProject,
	validateSoundscaperDesktopBundle,
	validateSoundscaperDesktopCatalogSnapshot,
	validateSoundscaperDesktopDeleteResult,
	validateSoundscaperDesktopProjectId,
	type SoundscaperDesktopBundleSnapshot,
	type SoundscaperDesktopProjectSummary,
	type SoundscaperDesktopRendererBridge,
} from './desktop-project-library-renderer-contract.ts';
import {
	createSoundscaperDesktopDuplicateProject,
	sameSoundscaperDesktopProject,
	validateSoundscaperDesktopDuplicateOptions,
	type SoundscaperDesktopDuplicateOptions,
	type SoundscaperDesktopWitnessLedger,
} from './desktop-project-library-renderer-lifecycle.ts';

export interface SoundscaperDesktopRawShadowProjectStore {
	loadProject(projectId: string): PromiseLike<unknown> | unknown;
	readonly projectRepository: Readonly<{
		deleteExact(project: SoundscaperProject): PromiseLike<boolean> | boolean;
	}>;
}

export class SoundscaperDesktopProjectLibraryCommittedError extends Error {
	readonly committed = true;
	readonly operation: 'delete' | 'duplicate' | 'publication';
	readonly projectId: string;

	constructor(
		operation: 'delete' | 'duplicate' | 'publication',
		projectId: string,
		cause: unknown,
	) {
		super(`The Soundscaper desktop  ${operation} committed, but renderer reconciliation failed.`, { cause });
		this.name = 'SoundscaperDesktopProjectLibraryCommittedError';
		this.operation = operation;
		this.projectId = projectId;
	}
}

export class SoundscaperDesktopProjectLibraryIndeterminateError extends Error {
	readonly outcome = 'indeterminate';
	readonly operation: 'delete' | 'duplicate' | 'publication';
	readonly projectId: string;

	constructor(
		operation: 'delete' | 'duplicate' | 'publication',
		projectId: string,
		primary: unknown,
		recovery: unknown,
	) {
		super(`The Soundscaper desktop  ${operation} outcome is indeterminate.`, {
			cause: new AggregateError([primary, recovery], 'Main acknowledgement recovery was inconclusive.'),
		});
		this.name = 'SoundscaperDesktopProjectLibraryIndeterminateError';
		this.operation = operation;
		this.projectId = projectId;
	}
}

/** Exact main-catalog lifecycle over private renderer witnesses and a raw production shadow repository. */
export class SoundscaperDesktopRendererCatalog {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #store: SoundscaperDesktopRawShadowProjectStore;
	readonly #bridge: SoundscaperDesktopRendererBridge;
	readonly #ledger: SoundscaperDesktopWitnessLedger;
	readonly #intents: SoundscaperDesktopDeleteIntents;
	readonly #tombstones = new Map<string, SoundscaperDesktopDeleteIntent>();
	readonly #reconcile: (
		snapshot: Readonly<SoundscaperDesktopBundleSnapshot>,
	) => Promise<SoundscaperProject>;

	constructor(options: Readonly<{
		profile: EditorProjectRuntimeProfile;
		store: SoundscaperDesktopRawShadowProjectStore;
		bridge: SoundscaperDesktopRendererBridge;
		ledger: SoundscaperDesktopWitnessLedger;
		intents: SoundscaperDesktopDeleteIntents;
		reconcile(snapshot: Readonly<SoundscaperDesktopBundleSnapshot>): Promise<SoundscaperProject>;
	}>) {
		this.#profile = options.profile;
		this.#store = options.store;
		this.#bridge = options.bridge;
		this.#ledger = options.ledger;
		this.#intents = options.intents;
		this.#reconcile = options.reconcile;
	}

	async listProjects(): Promise<readonly Readonly<SoundscaperDesktopProjectSummary>[]> {
		return (await this.observeCatalog()).projects;
	}

	async observeCatalog() {
		const snapshot = validateSoundscaperDesktopCatalogSnapshot(await this.#bridge.listProjects());
		this.#ledger.observeCatalog(snapshot);
		return snapshot;
	}

	async recoverPublication(
		request: Readonly<{
			project: SoundscaperProject;
			expectedMetadataRevision: number;
			expectedProject: Readonly<{
				projectRevision: number;
				projectSha256: string;
			}> | null;
		}>,
		primary: unknown,
	): Promise<Readonly<SoundscaperDesktopBundleSnapshot> | null> {
		const projectId = String(request.project.id);
		try {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw !== null) {
				const snapshot = validateSoundscaperDesktopBundle(this.#profile, raw, projectId);
				if (snapshot.bundle.metadataRevision === request.expectedMetadataRevision + 1
					&& sameSoundscaperDesktopProject(snapshot.project, request.project)) {
					return snapshot;
				}
				if (request.expectedProject
					&& snapshot.bundle.metadataRevision === request.expectedMetadataRevision
					&& snapshot.bundle.project.projectRevision === request.expectedProject.projectRevision
					&& snapshot.bundle.project.sha256 === request.expectedProject.projectSha256) {
					return null;
				}
				throw new Error('Publication recovery found a divergent project outcome.');
			}
			const catalog = validateSoundscaperDesktopCatalogSnapshot(await this.#bridge.listProjects());
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('Publication recovery found an unreadable catalog project.');
			}
			if (request.expectedProject === null
				&& catalog.metadataRevision === request.expectedMetadataRevision) return null;
			throw new Error('Publication recovery could not prove an unchanged main outcome.');
		} catch (recovery) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryIndeterminateError(
				'publication', projectId, primary, recovery,
			);
		}
	}

	async deleteProject(projectIdValue: string): Promise<void> {
		const projectId = validateSoundscaperDesktopProjectId(projectIdValue);
		await this.observeCatalog();
		const witness = this.#ledger.takeCurrent(projectId);
		const intent = await this.#intents.create(witness);
		let metadataRevision: number;
		try {
			const result = validateSoundscaperDesktopDeleteResult(await this.#bridge.deleteProject({
				projectId,
				expectedMetadataRevision: witness.expectedMetadataRevision,
				expectedProject: witness.expectedProject,
			}), projectId);
			if (result.metadataRevision !== witness.expectedMetadataRevision + 1) {
				throw new Error('The desktop  delete acknowledgement changed its metadata revision.');
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
		catch (error) { throw new SoundscaperDesktopProjectLibraryCommittedError('delete', projectId, error); }
	}

	async cleanupDeletedProject(projectIdValue: string): Promise<boolean> {
		const projectId = validateSoundscaperDesktopProjectId(projectIdValue);
		if (!this.#tombstones.has(projectId)) return false;
		await this.#deleteShadow(projectId);
		return true;
	}

	async settleDeletedProject(projectIdValue: string): Promise<boolean> {
		const projectId = validateSoundscaperDesktopProjectId(projectIdValue);
		const intent = this.#tombstones.get(projectId);
		if (!intent) return false;
		if (await this.#store.loadProject(projectId) !== null) {
			throw new Error('The exact shadow remained after desktop delete reconciliation.');
		}
		await this.#intents.remove(intent);
		this.#tombstones.delete(projectId);
		return true;
	}

	async duplicateProject(
		sourceProjectIdValue: string,
		optionsValue: Readonly<SoundscaperDesktopDuplicateOptions>,
	): Promise<SoundscaperProject> {
		const sourceProjectId = validateSoundscaperDesktopProjectId(sourceProjectIdValue);
		const options = validateSoundscaperDesktopDuplicateOptions(optionsValue);
		await this.observeCatalog();
		const witness = this.#ledger.takeCurrent(sourceProjectId);
		const intended = createSoundscaperDesktopDuplicateProject(this.#profile, witness.project, options);
		let snapshot: Readonly<SoundscaperDesktopBundleSnapshot>;
		try {
			snapshot = validateSoundscaperDesktopBundle(this.#profile, await this.#bridge.duplicateProject({
				sourceProjectId,
				copyProjectId: options.id,
				title: options.title,
				timestamp: options.timestamp,
				expectedMetadataRevision: witness.expectedMetadataRevision,
				expectedSource: witness.expectedProject,
			}), options.id);
			if (snapshot.bundle.metadataRevision !== witness.expectedMetadataRevision + 1
				|| !sameSoundscaperDesktopProject(snapshot.project, intended)) {
				throw new Error('The committed desktop  duplicate changed its requested V21 publication.');
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
			throw new SoundscaperDesktopProjectLibraryCommittedError('duplicate', options.id, error);
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
				validateSoundscaperDesktopBundle(this.#profile, raw, projectId);
				return null;
			}
			const catalog = validateSoundscaperDesktopCatalogSnapshot(await this.#bridge.listProjects());
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('The deleted project remains in the catalog without a readable bundle.');
			}
			if (catalog.metadataRevision !== expectedMetadataRevision + 1) {
				throw new Error('Delete recovery found an inexact catalog revision.');
			}
			return catalog.metadataRevision;
		} catch (recovery) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryIndeterminateError(
				'delete', projectId, primary, recovery,
			);
		}
	}

	async #recoverDuplicate(
		projectId: string,
		intended: SoundscaperProject,
		expectedMetadataRevision: number,
		primary: unknown,
	): Promise<Readonly<SoundscaperDesktopBundleSnapshot> | null> {
		try {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw !== null) {
				const snapshot = validateSoundscaperDesktopBundle(this.#profile, raw, projectId);
				if (snapshot.bundle.metadataRevision !== expectedMetadataRevision + 1
					|| !sameSoundscaperDesktopProject(snapshot.project, intended)) {
					throw new Error('The duplicate recovery destination contains another V21 project.');
				}
				return snapshot;
			}
			const catalog = validateSoundscaperDesktopCatalogSnapshot(await this.#bridge.listProjects());
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('The duplicate destination is catalogued without a readable bundle.');
			}
			return null;
		} catch (recovery) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryIndeterminateError(
				'duplicate', projectId, primary, recovery,
			);
		}
	}

	async #deleteShadow(projectId: string): Promise<void> {
		const intent = this.#tombstones.get(projectId);
		if (!intent) throw new Error('The desktop  delete intent is unavailable.');
		const currentValue = await this.#store.loadProject(projectId);
		if (currentValue === null || currentValue === undefined) return;
		const current = snapshotSoundscaperDesktopProject(this.#profile, currentValue);
		if (Number(current.project.revision) !== intent.projectRevision
			|| current.sha256 !== intent.projectSha256
			|| !await this.#store.projectRepository.deleteExact(current.project)) {
			throw new Error('The V21 shadow changed before exact desktop delete cleanup.');
		}
	}
}
