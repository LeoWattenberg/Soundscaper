/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The main-process owner of optional local assistance.
 *
 * It composes the pieces the renderer must never touch directly: the models
 * directory on the real filesystem, the catalog and its licensing binding, the
 * digest-verified downloader, and the speech runtime. The renderer sees model
 * state and job results, never paths it could ask the helper to read.
 *
 * Every operation is explicitly requested. Nothing here installs, downloads, or
 * loads a model as a side effect of starting up, because assistance is optional
 * and a user who never opens it should pay nothing for it.
 */

import { describeModelAvailability, validateLocalModelCatalog } from './local-model-catalog.ts';
import type {
	LocalModelAvailability,
	LocalModelCatalog,
	LocalModelCatalogEntry,
} from './local-model-catalog.ts';
import type { LocalModelCatalogSignatureOptions } from './local-model-catalog-signature.ts';
import { LocalModelCapacity } from './local-model-capacity.ts';
import { downloadLocalModelArtifact } from './local-model-download.ts';
import { collectLocalModelGarbage } from './local-model-garbage-collection.ts';
import type { LocalModelGarbageCollectionReport } from './local-model-garbage-collection.ts';
import { planLocalModelTransfers } from './local-model-install-plan.ts';
import { createInstalledLocalModelNotices } from './local-model-notices.ts';
import type { InstalledLocalModelNotice } from './local-model-notices.ts';
import {
	installPreseededLocalModel,
	reconcilePreseededLocalModels,
} from './local-model-preseed.ts';
import type { PreseededLocalModelReconciliation } from './local-model-preseed.ts';
import { relocateLocalModelStore } from './local-model-relocation.ts';
import type { LocalModelRelocationResult } from './local-model-relocation.ts';
import { FileLocalModelStore, resolveLocalModelRoot } from './local-model-store.ts';
import type { InstalledLocalModel } from './local-model-store.ts';
import type { SpeechRuntimeAdapter } from './assistance-speech-runtime.ts';

/** What the renderer is told about one model. Paths are deliberately absent. */
export interface AssistanceModelView {
	readonly modelId: string;
	readonly version: string;
	readonly task: string;
	readonly availability: LocalModelAvailability;
	readonly downloadBytes: number;
	readonly installedBytes: number | null;
	readonly attributionRequired: boolean;
}

export interface AssistanceStatusView {
	readonly runtimeAvailable: boolean;
	readonly runtimeReason: string | null;
	readonly models: readonly AssistanceModelView[];
}

export interface AssistanceInstallProgress {
	readonly modelId: string;
	readonly fileName: string;
	readonly completedBytes: number;
	readonly totalBytes: number;
}

export const ASSISTANCE_INSTALL_CANCELLATION_CONTRACT_VERSION = 1;

export interface AssistanceInstallCancellation {
	readonly contractVersion: typeof ASSISTANCE_INSTALL_CANCELLATION_CONTRACT_VERSION;
	readonly modelId: string;
	readonly outcome: 'cancelled' | 'not-active';
}

export class AssistanceInstallCancelledError extends Error {
	readonly code = 'ASSISTANCE_INSTALL_CANCELLED';
	readonly modelId: string;

	constructor(modelId: string, options: ErrorOptions = {}) {
		super(`Local model ${modelId} installation was cancelled.`, options);
		this.name = 'AssistanceInstallCancelledError';
		this.modelId = modelId;
	}
}

function cancellation(
	modelId: string,
	outcome: AssistanceInstallCancellation['outcome'],
): AssistanceInstallCancellation {
	return Object.freeze({
		contractVersion: ASSISTANCE_INSTALL_CANCELLATION_CONTRACT_VERSION,
		modelId,
		outcome,
	});
}

interface ActiveAssistanceInstall {
	readonly controller: AbortController;
	readonly digests: ReadonlySet<string>;
	readonly quiesced: Promise<void>;
	settle(): void;
	outcome: 'active' | 'completed' | 'cancelled' | 'failed';
}

export interface AssistanceServiceOptions {
	readonly userDataPath: string;
	readonly settingsDirectory?: string | null;
	readonly catalog: unknown;
	readonly licensingEvidence: readonly unknown[];
	readonly refusedIds?: readonly string[];
	readonly catalogSignatureOptions?: LocalModelCatalogSignatureOptions;
	readonly runtime: SpeechRuntimeAdapter;
	readonly platform?: string;
	readonly totalMemoryBytes?: number;
	readonly fetchImpl?: typeof fetch;
	readonly capacity?: LocalModelCapacity;
	/** Atomically persists a verified relocation target. */
	readonly persistModelsDirectory?: (directory: string) => PromiseLike<void> | void;
}

function entryView(
	entry: LocalModelCatalogEntry,
	availability: LocalModelAvailability,
	installedBytes: number | null,
	attributionRequired: boolean,
): AssistanceModelView {
	return Object.freeze({
		modelId: entry.modelId,
		version: entry.version,
		task: entry.task,
		availability,
		downloadBytes: entry.artifacts.reduce((total, artifact) => total + artifact.byteLength, 0),
		installedBytes,
		attributionRequired,
	});
}

function currentInstallation(
	entry: LocalModelCatalogEntry,
	installed: readonly InstalledLocalModel[],
): InstalledLocalModel | null {
	const candidate = installed.find(({ modelId }) => modelId === entry.modelId);
	if (!candidate || candidate.version !== entry.version
		|| candidate.artifacts.length !== entry.artifacts.length) return null;
	for (const artifact of candidate.artifacts) {
		const expected = entry.artifacts.find(({ fileName }) => fileName === artifact.fileName);
		if (!expected || expected.byteLength !== artifact.byteLength || expected.sha256 !== artifact.sha256) {
			return null;
		}
	}
	return candidate;
}

/**
 * Creates the service. The catalog is validated against the licensing register
 * at construction, so a build whose catalog and register disagree fails at
 * startup rather than when a user first tries to install something.
 */
export function createAssistanceService(options: AssistanceServiceOptions) {
	const catalog: LocalModelCatalog = validateLocalModelCatalog(options.catalog, {
		licensingEvidence: options.licensingEvidence,
		refusedIds: options.refusedIds,
	}, options.catalogSignatureOptions);
	let rootPath = resolveLocalModelRoot({
		userDataPath: options.userDataPath,
		settingsDirectory: options.settingsDirectory ?? null,
	});
	let store = new FileLocalModelStore(rootPath);
	const capacity = options.capacity ?? new LocalModelCapacity();
	const platform = options.platform ?? `${process.platform}-${process.arch}`;
	const totalMemoryBytes = options.totalMemoryBytes ?? 0;
	const activeInstalls = new Map<string, ActiveAssistanceInstall>();
	let exclusiveMutation = false;
	const attributionById = new Map(options.licensingEvidence.flatMap((value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
		const row = value as Readonly<Record<string, unknown>>;
		return typeof row.id === 'string' ? [[row.id, row.attributionRequired === true] as const] : [];
	}));

	function entryFor(modelId: string): LocalModelCatalogEntry {
		const entry = catalog.entries.find((candidate) => candidate.modelId === modelId);
		if (!entry) throw new Error(`${modelId} is not offered by this build.`);
		return entry;
	}

	function assertMachineCompatible(entry: LocalModelCatalogEntry): void {
		const availability = describeModelAvailability(entry, {
			platform, totalMemoryBytes, installedModelIds: [],
		});
		if (availability === 'unsupported-platform') {
			throw new Error(`Local model ${entry.modelId} is not supported on this platform.`);
		}
		if (availability === 'insufficient-memory') {
			throw new Error(`Local model ${entry.modelId} cannot run with this machine's available memory.`);
		}
	}

	async function withInstall<T>(
		entry: LocalModelCatalogEntry,
		externalSignal: AbortSignal | undefined,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		if (exclusiveMutation || activeInstalls.has(entry.modelId)) {
			throw new Error(`A local-model operation for ${entry.modelId} is already active.`);
		}
		const digests = new Set(entry.artifacts.map(({ sha256 }) => sha256));
		for (const active of activeInstalls.values()) {
			if ([...digests].some((digest) => active.digests.has(digest))) {
				throw new Error('A shared local-model artifact is already being installed.');
			}
		}
		const controller = new AbortController();
		let settle: () => void = () => undefined;
		const quiesced = new Promise<void>((resolve) => { settle = resolve; });
		const active: ActiveAssistanceInstall = {
			controller, digests, quiesced, settle, outcome: 'active',
		};
		activeInstalls.set(entry.modelId, active);
		const signal = externalSignal
			? AbortSignal.any([controller.signal, externalSignal])
			: controller.signal;
		try {
			const result = await operation(signal);
			active.outcome = 'completed';
			return result;
		} catch (error) {
			if (signal.aborted) {
				active.outcome = 'cancelled';
				if (error instanceof AssistanceInstallCancelledError) throw error;
				throw new AssistanceInstallCancelledError(entry.modelId, {
					cause: signal.reason ?? error,
				});
			}
			active.outcome = 'failed';
			throw error;
		} finally {
			activeInstalls.delete(entry.modelId);
			active.settle();
		}
	}

	async function withExclusiveMutation<T>(operation: () => Promise<T>): Promise<T> {
		if (exclusiveMutation || activeInstalls.size > 0) {
			throw new Error('Another local-model operation is already active.');
		}
		exclusiveMutation = true;
		try {
			return await operation();
		} finally {
			exclusiveMutation = false;
		}
	}

	async function status(): Promise<AssistanceStatusView> {
		const installed = await store.listInstalled();
		const currentById = new Map(catalog.entries.flatMap((entry) => {
			const installation = currentInstallation(entry, installed);
			return installation ? [[entry.modelId, installation] as const] : [];
		}));
		const installedIds = [...currentById.keys()];
		const runtime = await options.runtime.status();
		const runtimeReason = runtime.available || runtime.reason === null
			? null
			: runtime.reason === 'The optional speech runtime is not installed.'
				? runtime.reason
				: 'The optional speech runtime failed to load.';
		return Object.freeze({
			runtimeAvailable: runtime.available,
			runtimeReason,
			models: Object.freeze(catalog.entries.map((entry) => entryView(
				entry,
				describeModelAvailability(entry, {
					platform,
					totalMemoryBytes,
					installedModelIds: installedIds,
				}),
				currentById.get(entry.modelId)?.totalBytes ?? null,
				attributionById.get(entry.modelId) === true,
			))),
		});
	}

	/**
	 * Installs one model. Artifacts are fetched and digest-verified before the
	 * manifest is written, so an interrupted install leaves no model claiming
	 * bytes the store does not hold.
	 */
	async function install(
		modelId: string,
		onProgress?: (progress: AssistanceInstallProgress) => void,
		signal?: AbortSignal,
	): Promise<AssistanceModelView> {
		const entry = entryFor(modelId);
		assertMachineCompatible(entry);
		return withInstall(entry, signal, async (installSignal) => {
			installSignal.throwIfAborted();
			await store.initialize();
			const plan = await planLocalModelTransfers(store, entry.artifacts);
			const reservation = await capacity.reserve(rootPath, plan.totalBytes);
			const plannedByDigest = new Map(plan.artifacts.map((item) => [item.artifact.sha256, item]));
			const consumedByDigest = new Map<string, number>();
			try {
				for (const artifact of entry.artifacts) {
					const planned = plannedByDigest.get(artifact.sha256);
					if (!planned) throw new Error('The local-model transfer plan omitted an artifact.');
					await downloadLocalModelArtifact({
						store,
						artifact,
						url: artifact.url,
						signal: installSignal,
						fetchImpl: options.fetchImpl,
						onProgress: ({ completedBytes, totalBytes }) => {
							const desiredConsumption = Math.min(
								planned.transferBytes,
								Math.max(0, completedBytes - planned.resumedFromBytes),
							);
							const consumed = consumedByDigest.get(artifact.sha256) ?? 0;
							if (desiredConsumption > consumed) {
								reservation.consume(desiredConsumption - consumed);
								consumedByDigest.set(artifact.sha256, desiredConsumption);
							}
							onProgress?.(Object.freeze({
								modelId, fileName: artifact.fileName, completedBytes, totalBytes,
							}));
						},
					});
				}
				installSignal.throwIfAborted();
				const installed = await store.commitInstall({
					modelId: entry.modelId, version: entry.version, artifacts: entry.artifacts,
				});
				return entryView(
					entry,
					'installed',
					installed.totalBytes,
					attributionById.get(entry.modelId) === true,
				);
			} finally {
				reservation.release();
			}
		});
	}

	/** Removes a model and reports the bytes reclaimed. */
	async function remove(modelId: string): Promise<number> {
		entryFor(modelId);
		return withExclusiveMutation(() => store.removeModel(modelId));
	}

	/** Imports one explicitly selected offline seed directory without a network fallback. */
	async function installPreseeded(
		modelId: string,
		sourceDirectory: string,
	): Promise<AssistanceModelView> {
		const entry = entryFor(modelId);
		assertMachineCompatible(entry);
		return withInstall(entry, undefined, async (signal) => {
			const installed = await installPreseededLocalModel({
				store, entry, sourceDirectory, capacity, signal,
			});
			return entryView(
				entry, 'installed', installed.totalBytes,
				attributionById.get(entry.modelId) === true,
			);
		});
	}

	/** Cancels one active install and resolves only after its body and handles quiesce. */
	async function cancelInstall(modelId: string): Promise<AssistanceInstallCancellation> {
		entryFor(modelId);
		const active = activeInstalls.get(modelId);
		if (!active) return cancellation(modelId, 'not-active');
		active.controller.abort(new AssistanceInstallCancelledError(modelId));
		await active.quiesced;
		return cancellation(modelId, active.outcome === 'cancelled' ? 'cancelled' : 'not-active');
	}

	/** Reconciles complete content-addressed blobs the user pre-seeded directly. */
	function reconcilePreseeded(): Promise<PreseededLocalModelReconciliation> {
		return withExclusiveMutation(() => reconcilePreseededLocalModels(store, catalog.entries, {
			admitEntry: ({ modelId }) => assertMachineCompatible(entryFor(modelId)),
		}));
	}

	/** Garbage collection is never implicit; callers must request it explicitly. */
	function garbageCollect(): Promise<LocalModelGarbageCollectionReport> {
		return withExclusiveMutation(() => collectLocalModelGarbage({
			store,
			offeredArtifacts: catalog.entries.flatMap(({ artifacts }) => artifacts),
		}));
	}

	/** Current installed notices are rebuilt from the authenticated catalog binding. */
	async function installedNotices(): Promise<readonly InstalledLocalModelNotice[]> {
		return createInstalledLocalModelNotices({
			catalog, licensingEvidence: options.licensingEvidence, installed: await store.listInstalled(),
		});
	}

	/** Copies and verifies first; only the injected settings callback swaps authority. */
	function relocate(targetDirectory: string): Promise<LocalModelRelocationResult> {
		const persistTarget = options.persistModelsDirectory;
		if (!persistTarget) {
			return Promise.reject(new Error('Local-model directory relocation is unavailable without settings persistence.'));
		}
		return withExclusiveMutation(async () => {
			const result = await relocateLocalModelStore({
				source: store,
				targetDirectory,
				capacity,
				persistTarget,
			});
			rootPath = result.modelsDirectory;
			store = new FileLocalModelStore(rootPath);
			return result;
		});
	}

	/**
	 * Resolves the artifact paths a recognizer needs. Named by role rather than
	 * by file name so the runtime contract does not depend on how an upstream
	 * happens to name its graphs.
	 */
	async function resolveModelPaths(modelId: string): Promise<Record<string, string>> {
		if (exclusiveMutation) throw new Error('Another local-model operation is already active.');
		const manifest = await store.readManifest(modelId);
		if (!manifest) throw new Error(`${modelId} is not installed.`);
		const entry = entryFor(modelId);
		assertMachineCompatible(entry);
		if (!currentInstallation(entry, [manifest])) {
			throw new Error(`${modelId} does not match the current authenticated catalog entry.`);
		}
		const paths: Record<string, string> = {};
		for (const artifact of manifest.artifacts) {
			if (!await store.verifyArtifact(artifact)) {
				throw new Error(`${modelId} artifact ${artifact.fileName} failed its integrity check.`);
			}
			const role = artifact.fileName.split('.')[0] as string;
			paths[role] = store.blobPath(artifact.sha256);
		}
		return Object.freeze(paths);
	}

	return Object.freeze({
		get modelsDirectory() { return rootPath; },
		status,
		install,
		cancelInstall,
		installPreseeded,
		reconcilePreseeded,
		remove,
		garbageCollect,
		installedNotices,
		relocate,
		resolveModelPaths,
		listInstalled: () => store.listInstalled(),
	});
}

export type AssistanceService = ReturnType<typeof createAssistanceService>;
