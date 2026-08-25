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
import { downloadLocalModelArtifact } from './local-model-download.ts';
import { FileLocalModelStore, resolveLocalModelRoot } from './local-model-store.ts';
import type { SpeechRuntimeAdapter } from './assistance-speech-runtime.ts';

/** What the renderer is told about one model. Paths are deliberately absent. */
export interface AssistanceModelView {
	readonly modelId: string;
	readonly version: string;
	readonly task: string;
	readonly availability: LocalModelAvailability;
	readonly downloadBytes: number | null;
	readonly installedBytes: number | null;
	readonly attributionRequired: boolean;
}

export interface AssistanceStatusView {
	readonly modelsDirectory: string;
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

export interface AssistanceServiceOptions {
	readonly userDataPath: string;
	readonly settingsDirectory?: string | null;
	readonly catalog: unknown;
	readonly evidenceIds: readonly string[];
	readonly refusedIds?: readonly string[];
	readonly runtime: SpeechRuntimeAdapter;
	readonly platform?: string;
	readonly totalMemoryBytes?: number;
	readonly fetchImpl?: typeof fetch;
}

function entryView(
	entry: LocalModelCatalogEntry,
	availability: LocalModelAvailability,
	installedBytes: number | null,
): AssistanceModelView {
	return Object.freeze({
		modelId: entry.modelId,
		version: entry.version,
		task: entry.task,
		availability,
		downloadBytes: entry.artifacts === null
			? null
			: entry.artifacts.reduce((total, artifact) => total + artifact.byteLength, 0),
		installedBytes,
		attributionRequired: false,
	});
}

/**
 * Creates the service. The catalog is validated against the licensing register
 * at construction, so a build whose catalog and register disagree fails at
 * startup rather than when a user first tries to install something.
 */
export function createAssistanceService(options: AssistanceServiceOptions) {
	const catalog: LocalModelCatalog = validateLocalModelCatalog(options.catalog, {
		evidenceIds: options.evidenceIds,
		refusedIds: options.refusedIds,
	});
	const rootPath = resolveLocalModelRoot({
		userDataPath: options.userDataPath,
		settingsDirectory: options.settingsDirectory ?? null,
	});
	const store = new FileLocalModelStore(rootPath);
	const platform = options.platform ?? `${process.platform}-${process.arch}`;
	const totalMemoryBytes = options.totalMemoryBytes ?? 0;

	function entryFor(modelId: string): LocalModelCatalogEntry {
		const entry = catalog.entries.find((candidate) => candidate.modelId === modelId);
		if (!entry) throw new Error(`${modelId} is not offered by this build.`);
		return entry;
	}

	async function status(): Promise<AssistanceStatusView> {
		const installed = await store.listInstalled();
		const installedIds = installed.map(({ modelId }) => modelId);
		const runtime = await options.runtime.status();
		return Object.freeze({
			modelsDirectory: rootPath,
			runtimeAvailable: runtime.available,
			runtimeReason: runtime.reason,
			models: Object.freeze(catalog.entries.map((entry) => entryView(
				entry,
				describeModelAvailability(entry, {
					platform,
					totalMemoryBytes,
					installedModelIds: installedIds,
				}),
				installed.find(({ modelId }) => modelId === entry.modelId)?.totalBytes ?? null,
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
		if (entry.artifacts === null) {
			throw new Error(`${modelId} has no mirrored artifacts to install.`);
		}
		await store.initialize();
		for (const artifact of entry.artifacts) {
			await downloadLocalModelArtifact({
				store,
				artifact,
				url: artifact.url,
				signal,
				fetchImpl: options.fetchImpl,
				onProgress: ({ completedBytes, totalBytes }) => onProgress?.(Object.freeze({
					modelId, fileName: artifact.fileName, completedBytes, totalBytes,
				})),
			});
		}
		const installed = await store.commitInstall({
			modelId: entry.modelId, version: entry.version, artifacts: entry.artifacts,
		});
		return entryView(entry, 'installed', installed.totalBytes);
	}

	/** Removes a model and reports the bytes reclaimed. */
	async function remove(modelId: string): Promise<number> {
		entryFor(modelId);
		return store.removeModel(modelId);
	}

	/**
	 * Resolves the artifact paths a recognizer needs. Named by role rather than
	 * by file name so the runtime contract does not depend on how an upstream
	 * happens to name its graphs.
	 */
	async function resolveModelPaths(modelId: string): Promise<Record<string, string>> {
		const manifest = await store.readManifest(modelId);
		if (!manifest) throw new Error(`${modelId} is not installed.`);
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
		modelsDirectory: rootPath,
		status,
		install,
		remove,
		resolveModelPaths,
		listInstalled: () => store.listInstalled(),
	});
}

export type AssistanceService = ReturnType<typeof createAssistanceService>;
