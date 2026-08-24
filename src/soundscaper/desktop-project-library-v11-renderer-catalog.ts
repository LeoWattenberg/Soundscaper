/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import type { SoundscaperProductionProject } from './editor-project-production-validation.ts';
import {
	SoundscaperDesktopV11DeleteIntents,
	type SoundscaperDesktopV11DeleteIntent,
} from './desktop-project-library-v11-delete-intents.ts';
import {
	snapshotSoundscaperDesktopV11Project,
	validateSoundscaperDesktopV11Bundle,
	validateSoundscaperDesktopV11CatalogSnapshot,
	validateSoundscaperDesktopV11DeleteResult,
	validateSoundscaperDesktopV11ProjectId,
	type SoundscaperDesktopV11BundleSnapshot,
	type SoundscaperDesktopV11ProjectSummary,
	type SoundscaperDesktopV11RendererBridge,
} from './desktop-project-library-v11-renderer-contract.ts';
import {
	createSoundscaperDesktopV11DuplicateProject,
	sameSoundscaperDesktopV11Project,
	validateSoundscaperDesktopV11DuplicateOptions,
	type SoundscaperDesktopV11DuplicateOptions,
	type SoundscaperDesktopV11WitnessLedger,
} from './desktop-project-library-v11-renderer-lifecycle.ts';

export interface SoundscaperDesktopV11RawShadowProjectStore {
	loadProject(projectId: string): PromiseLike<unknown> | unknown;
	readonly projectRepository: Readonly<{
		deleteExact(project: SoundscaperProductionProject): PromiseLike<boolean> | boolean;
	}>;
}

export class SoundscaperDesktopProjectLibraryV11CommittedError extends Error {
	readonly committed = true;
	readonly operation: 'delete' | 'duplicate' | 'publication';
	readonly projectId: string;

	constructor(
		operation: 'delete' | 'duplicate' | 'publication',
		projectId: string,
		cause: unknown,
	) {
		super(`The Soundscaper desktop V11 ${operation} committed, but renderer reconciliation failed.`, { cause });
		this.name = 'SoundscaperDesktopProjectLibraryV11CommittedError';
		this.operation = operation;
		this.projectId = projectId;
	}
}

export class SoundscaperDesktopProjectLibraryV11IndeterminateError extends Error {
	readonly outcome = 'indeterminate';
	readonly operation: 'delete' | 'duplicate' | 'publication';
	readonly projectId: string;

	constructor(
		operation: 'delete' | 'duplicate' | 'publication',
		projectId: string,
		primary: unknown,
		recovery: unknown,
	) {
		super(`The Soundscaper desktop V11 ${operation} outcome is indeterminate.`, {
			cause: new AggregateError([primary, recovery], 'Main acknowledgement recovery was inconclusive.'),
		});
		this.name = 'SoundscaperDesktopProjectLibraryV11IndeterminateError';
		this.operation = operation;
		this.projectId = projectId;
	}
}

/** Exact main-catalog lifecycle over private renderer witnesses and a raw production shadow repository. */
export class SoundscaperDesktopV11RendererCatalog {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #store: SoundscaperDesktopV11RawShadowProjectStore;
	readonly #bridge: SoundscaperDesktopV11RendererBridge;
	readonly #ledger: SoundscaperDesktopV11WitnessLedger;
	readonly #intents: SoundscaperDesktopV11DeleteIntents;
	readonly #tombstones = new Map<string, SoundscaperDesktopV11DeleteIntent>();
	readonly #reconcile: (
		snapshot: Readonly<SoundscaperDesktopV11BundleSnapshot>,
	) => Promise<SoundscaperProductionProject>;

	constructor(options: Readonly<{
		profile: EditorProjectRuntimeProfile;
		store: SoundscaperDesktopV11RawShadowProjectStore;
		bridge: SoundscaperDesktopV11RendererBridge;
		ledger: SoundscaperDesktopV11WitnessLedger;
		intents: SoundscaperDesktopV11DeleteIntents;
		reconcile(snapshot: Readonly<SoundscaperDesktopV11BundleSnapshot>): Promise<SoundscaperProductionProject>;
	}>) {
		this.#profile = options.profile;
		this.#store = options.store;
		this.#bridge = options.bridge;
		this.#ledger = options.ledger;
		this.#intents = options.intents;
		this.#reconcile = options.reconcile;
	}

	async listProjects(): Promise<readonly Readonly<SoundscaperDesktopV11ProjectSummary>[]> {
		return (await this.observeCatalog()).projects;
	}

	async observeCatalog() {
		const snapshot = validateSoundscaperDesktopV11CatalogSnapshot(await this.#bridge.listProjects());
		this.#ledger.observeCatalog(snapshot);
		return snapshot;
	}

	async recoverPublication(
		request: Readonly<{
			project: SoundscaperProductionProject;
			expectedMetadataRevision: number;
			expectedProject: Readonly<{
				projectRevision: number;
				projectSha256: string;
			}> | null;
		}>,
		primary: unknown,
	): Promise<Readonly<SoundscaperDesktopV11BundleSnapshot> | null> {
		const projectId = String(request.project.id);
		try {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw !== null) {
				const snapshot = validateSoundscaperDesktopV11Bundle(this.#profile, raw, projectId);
				if (snapshot.bundle.metadataRevision === request.expectedMetadataRevision + 1
					&& sameSoundscaperDesktopV11Project(snapshot.project, request.project)) {
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
			const catalog = validateSoundscaperDesktopV11CatalogSnapshot(await this.#bridge.listProjects());
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('Publication recovery found an unreadable catalog project.');
			}
			if (request.expectedProject === null
				&& catalog.metadataRevision === request.expectedMetadataRevision) return null;
			throw new Error('Publication recovery could not prove an unchanged main outcome.');
		} catch (recovery) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryV11IndeterminateError(
				'publication', projectId, primary, recovery,
			);
		}
	}

	async deleteProject(projectIdValue: string): Promise<void> {
		const projectId = validateSoundscaperDesktopV11ProjectId(projectIdValue);
		await this.observeCatalog();
		const witness = this.#ledger.takeCurrent(projectId);
		const intent = await this.#intents.create(witness);
		let metadataRevision: number;
		try {
			const result = validateSoundscaperDesktopV11DeleteResult(await this.#bridge.deleteProject({
				projectId,
				expectedMetadataRevision: witness.expectedMetadataRevision,
				expectedProject: witness.expectedProject,
			}), projectId);
			if (result.metadataRevision !== witness.expectedMetadataRevision + 1) {
				throw new Error('The desktop V11 delete acknowledgement changed its metadata revision.');
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
		catch (error) { throw new SoundscaperDesktopProjectLibraryV11CommittedError('delete', projectId, error); }
	}

	async cleanupDeletedProject(projectIdValue: string): Promise<boolean> {
		const projectId = validateSoundscaperDesktopV11ProjectId(projectIdValue);
		if (!this.#tombstones.has(projectId)) return false;
		await this.#deleteShadow(projectId);
		return true;
	}

	async settleDeletedProject(projectIdValue: string): Promise<boolean> {
		const projectId = validateSoundscaperDesktopV11ProjectId(projectIdValue);
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
		optionsValue: Readonly<SoundscaperDesktopV11DuplicateOptions>,
	): Promise<SoundscaperProductionProject> {
		const sourceProjectId = validateSoundscaperDesktopV11ProjectId(sourceProjectIdValue);
		const options = validateSoundscaperDesktopV11DuplicateOptions(optionsValue);
		await this.observeCatalog();
		const witness = this.#ledger.takeCurrent(sourceProjectId);
		const intended = createSoundscaperDesktopV11DuplicateProject(this.#profile, witness.project, options);
		let snapshot: Readonly<SoundscaperDesktopV11BundleSnapshot>;
		try {
			snapshot = validateSoundscaperDesktopV11Bundle(this.#profile, await this.#bridge.duplicateProject({
				sourceProjectId,
				copyProjectId: options.id,
				title: options.title,
				timestamp: options.timestamp,
				expectedMetadataRevision: witness.expectedMetadataRevision,
				expectedSource: witness.expectedProject,
			}), options.id);
			if (snapshot.bundle.metadataRevision !== witness.expectedMetadataRevision + 1
				|| !sameSoundscaperDesktopV11Project(snapshot.project, intended)) {
				throw new Error('The committed desktop V11 duplicate changed its requested V21 publication.');
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
			throw new SoundscaperDesktopProjectLibraryV11CommittedError('duplicate', options.id, error);
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
				validateSoundscaperDesktopV11Bundle(this.#profile, raw, projectId);
				return null;
			}
			const catalog = validateSoundscaperDesktopV11CatalogSnapshot(await this.#bridge.listProjects());
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('The deleted project remains in the catalog without a readable bundle.');
			}
			if (catalog.metadataRevision !== expectedMetadataRevision + 1) {
				throw new Error('Delete recovery found an inexact catalog revision.');
			}
			return catalog.metadataRevision;
		} catch (recovery) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryV11IndeterminateError(
				'delete', projectId, primary, recovery,
			);
		}
	}

	async #recoverDuplicate(
		projectId: string,
		intended: SoundscaperProductionProject,
		expectedMetadataRevision: number,
		primary: unknown,
	): Promise<Readonly<SoundscaperDesktopV11BundleSnapshot> | null> {
		try {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw !== null) {
				const snapshot = validateSoundscaperDesktopV11Bundle(this.#profile, raw, projectId);
				if (snapshot.bundle.metadataRevision !== expectedMetadataRevision + 1
					|| !sameSoundscaperDesktopV11Project(snapshot.project, intended)) {
					throw new Error('The duplicate recovery destination contains another V21 project.');
				}
				return snapshot;
			}
			const catalog = validateSoundscaperDesktopV11CatalogSnapshot(await this.#bridge.listProjects());
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('The duplicate destination is catalogued without a readable bundle.');
			}
			return null;
		} catch (recovery) {
			this.#ledger.clear();
			throw new SoundscaperDesktopProjectLibraryV11IndeterminateError(
				'duplicate', projectId, primary, recovery,
			);
		}
	}

	async #deleteShadow(projectId: string): Promise<void> {
		const intent = this.#tombstones.get(projectId);
		if (!intent) throw new Error('The desktop V11 delete intent is unavailable.');
		const currentValue = await this.#store.loadProject(projectId);
		if (currentValue === null || currentValue === undefined) return;
		const current = snapshotSoundscaperDesktopV11Project(this.#profile, currentValue);
		if (Number(current.project.revision) !== intent.projectRevision
			|| current.sha256 !== intent.projectSha256
			|| !await this.#store.projectRepository.deleteExact(current.project)) {
			throw new Error('The V21 shadow changed before exact desktop delete cleanup.');
		}
	}
}
