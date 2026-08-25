/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Registers the main-process side of the assistance bridge.
 *
 * The service is built on first use rather than at startup. Assistance is
 * optional, so a user who never opens it should pay no filesystem access, no
 * catalog validation, and no runtime probe for it.
 *
 * Model ids are validated here as well as in the preload. The preload is the
 * renderer's own code and a compromised renderer can call these channels
 * directly, so the main process treats every argument as untrusted.
 */

import { isAbsolute, resolve as resolvePath } from 'node:path';

import { createAssistanceService } from './assistance-service.ts';
import type {
	AssistanceInstallCancellation,
	AssistanceModelView,
	AssistanceService,
	AssistanceStatusView,
} from './assistance-service.ts';
import type { LocalModelGarbageCollectionReport } from './local-model-garbage-collection.ts';
import type { InstalledLocalModelNotice } from './local-model-notices.ts';
import type { PreseededLocalModelReconciliation } from './local-model-preseed.ts';

const MODEL_ID_PATTERN = /^[a-z\d][a-z\d.-]{0,62}[a-z\d]$/u;

export interface AssistanceIpcChannels {
	readonly listAssistanceModels: string;
	readonly installAssistanceModel: string;
	readonly cancelAssistanceModelInstall: string;
	readonly installPreseededAssistanceModel: string;
	readonly reconcileAssistanceModels: string;
	readonly collectAssistanceModelGarbage: string;
	readonly listAssistanceModelNotices: string;
	readonly relocateAssistanceModels: string;
	readonly removeAssistanceModel: string;
	readonly assistanceInstallProgress: string;
}

export interface AssistanceIpcOptions {
	readonly channels: AssistanceIpcChannels;
	/** The trusted-sender wrapper main already applies to every channel. */
	readonly handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
	/** Sends an event to the renderer, or does nothing when none is attached. */
	readonly sendToRenderer: (channel: string, payload: unknown) => void;
	/** Builds the service on first use. */
	readonly createService: () => AssistanceService;
	/** Native main-process selection; a renderer-supplied path is never accepted. */
	readonly choosePreseedDirectory: (modelId: string) => PromiseLike<string | null>;
	/** Native main-process selection of a not-yet-existing relocation target. */
	readonly chooseRelocationDirectory: () => PromiseLike<string | null>;
}

export const ASSISTANCE_RELOCATION_CONTRACT_VERSION = 1;

export interface AssistanceRelocationView {
	readonly contractVersion: typeof ASSISTANCE_RELOCATION_CONTRACT_VERSION;
	readonly totalBytes: number;
	readonly fileCount: number;
	readonly sourceRemoved: boolean;
}

export type AssistanceInstalledModelNoticeView = Omit<InstalledLocalModelNotice, 'noticeDocument'>;

function assertModelId(value: unknown): string {
	if (typeof value !== 'string' || !MODEL_ID_PATTERN.test(value)) {
		throw new TypeError('Unsupported assistance model id');
	}
	return value;
}

function selectedDirectory(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' || value.length === 0 || value.length > 4_096
		|| value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError('The native assistance directory selection is invalid.');
	}
	return resolvePath(value);
}

function noticeView(notice: InstalledLocalModelNotice): AssistanceInstalledModelNoticeView {
	return Object.freeze({
		schemaVersion: notice.schemaVersion,
		modelId: notice.modelId,
		version: notice.version,
		purpose: notice.purpose,
		codeLicense: notice.codeLicense,
		weightsLicense: notice.weightsLicense,
		attributionRequired: notice.attributionRequired,
		provenanceSources: Object.freeze([...notice.provenanceSources]),
		upstreamRevision: notice.upstreamRevision,
		distributionKind: notice.distributionKind,
	});
}

async function pathlessOperation<T>(operation: () => PromiseLike<T>, message: string): Promise<T> {
	try {
		return await operation();
	} catch {
		// Native selections and store paths remain main-process-only, including in errors.
		throw new Error(message);
	}
}

export function registerAssistanceIpc(options: AssistanceIpcOptions): void {
	const {
		channels,
		handle,
		sendToRenderer,
		createService,
		choosePreseedDirectory,
		chooseRelocationDirectory,
	} = options;
	let service: AssistanceService | null = null;

	const resolve = (): AssistanceService => {
		service ??= createService();
		return service;
	};

	handle(channels.listAssistanceModels, (): Promise<AssistanceStatusView> =>
		pathlessOperation(() => resolve().status(), 'Local-model status could not be read.'));

	handle(channels.installAssistanceModel, (_event, modelId): Promise<AssistanceModelView> => {
		const id = assertModelId(modelId);
		return pathlessOperation(() => resolve().install(id, (progress) => {
			sendToRenderer(channels.assistanceInstallProgress, progress);
		}), 'The local model could not be installed.');
	});

	handle(channels.cancelAssistanceModelInstall, (_event, modelId): Promise<AssistanceInstallCancellation> => {
		const id = assertModelId(modelId);
		return pathlessOperation(() => resolve().cancelInstall(id),
			'The local-model installation could not be cancelled.');
	});

	handle(channels.installPreseededAssistanceModel, async (_event, modelId): Promise<AssistanceModelView | null> => {
		const id = assertModelId(modelId);
		return pathlessOperation(async () => {
			const sourceDirectory = selectedDirectory(await choosePreseedDirectory(id));
			return sourceDirectory === null ? null : resolve().installPreseeded(id, sourceDirectory);
		}, 'The selected offline model files could not be authenticated or installed.');
	});

	handle(channels.reconcileAssistanceModels, (): Promise<PreseededLocalModelReconciliation> =>
		pathlessOperation(() => resolve().reconcilePreseeded(),
			'Pre-seeded local-model files could not be reconciled.'));

	handle(channels.collectAssistanceModelGarbage, (): Promise<LocalModelGarbageCollectionReport> =>
		pathlessOperation(() => resolve().garbageCollect(),
			'Unused local-model files could not be collected.'));

	handle(channels.listAssistanceModelNotices, async (): Promise<readonly AssistanceInstalledModelNoticeView[]> =>
		pathlessOperation(async () =>
			Object.freeze((await resolve().installedNotices()).map(noticeView)),
		'Installed local-model notices could not be read.'));

	handle(channels.relocateAssistanceModels, async (): Promise<AssistanceRelocationView | null> => {
		return pathlessOperation(async () => {
			const targetDirectory = selectedDirectory(await chooseRelocationDirectory());
			if (targetDirectory === null) return null;
			const result = await resolve().relocate(targetDirectory);
			return Object.freeze({
				contractVersion: ASSISTANCE_RELOCATION_CONTRACT_VERSION,
				totalBytes: result.totalBytes,
				fileCount: result.fileCount,
				sourceRemoved: result.sourceRemoved,
			});
		}, 'Local-model storage could not be relocated safely.');
	});

	handle(channels.removeAssistanceModel, (_event, modelId): Promise<number> => {
		// Validate before resolving: argument evaluation would otherwise build the
		// service, and its filesystem access, for an id that is about to be refused.
		const id = assertModelId(modelId);
		return pathlessOperation(() => resolve().remove(id), 'The local model could not be removed.');
	});
}

export interface AssistanceServiceFactoryOptions {
	readonly userDataPath: string;
	readonly settingsDirectory: string | null;
	readonly catalog: unknown;
	readonly licensingMatrix: unknown;
	readonly runtime: Parameters<typeof createAssistanceService>[0]['runtime'];
	readonly totalMemoryBytes: number;
	readonly catalogSignatureOptions?: Parameters<typeof createAssistanceService>[0]['catalogSignatureOptions'];
	readonly persistModelsDirectory?: (directory: string) => PromiseLike<void> | void;
}

/**
 * Derives the licensing binding from the register the build ships, so the
 * catalog is checked against the same evidence a reviewer reads rather than
 * against a list duplicated for the runtime.
 */
export function assistanceServiceFrom(options: AssistanceServiceFactoryOptions): AssistanceService {
	const register = options.licensingMatrix as {
		localModelEvidence?: unknown[];
		refusedLocalModels?: { id: string }[];
	};
	if (!Array.isArray(register?.localModelEvidence)) {
		throw new TypeError('The licensing register carries no local model evidence.');
	}
	return createAssistanceService({
		userDataPath: options.userDataPath,
		settingsDirectory: options.settingsDirectory,
		catalog: options.catalog,
		licensingEvidence: register.localModelEvidence,
		refusedIds: (register.refusedLocalModels ?? []).map(({ id }) => id),
		...(options.catalogSignatureOptions
			? { catalogSignatureOptions: options.catalogSignatureOptions }
			: {}),
		runtime: options.runtime,
		totalMemoryBytes: options.totalMemoryBytes,
		...(options.persistModelsDirectory
			? { persistModelsDirectory: options.persistModelsDirectory }
			: {}),
	});
}
