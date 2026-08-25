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

import { createAssistanceService } from './assistance-service.ts';
import type { AssistanceModelView, AssistanceService, AssistanceStatusView } from './assistance-service.ts';

const MODEL_ID_PATTERN = /^[a-z\d][a-z\d.-]{0,62}[a-z\d]$/u;

export interface AssistanceIpcChannels {
	readonly listAssistanceModels: string;
	readonly installAssistanceModel: string;
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
}

function assertModelId(value: unknown): string {
	if (typeof value !== 'string' || !MODEL_ID_PATTERN.test(value)) {
		throw new TypeError('Unsupported assistance model id');
	}
	return value;
}

export function registerAssistanceIpc(options: AssistanceIpcOptions): void {
	const { channels, handle, sendToRenderer, createService } = options;
	let service: AssistanceService | null = null;

	const resolve = (): AssistanceService => {
		service ??= createService();
		return service;
	};

	handle(channels.listAssistanceModels, (): Promise<AssistanceStatusView> => resolve().status());

	handle(channels.installAssistanceModel, (_event, modelId): Promise<AssistanceModelView> => {
		const id = assertModelId(modelId);
		return resolve().install(id, (progress) => {
			sendToRenderer(channels.assistanceInstallProgress, progress);
		});
	});

	handle(channels.removeAssistanceModel, (_event, modelId): Promise<number> => {
		// Validate before resolving: argument evaluation would otherwise build the
		// service, and its filesystem access, for an id that is about to be refused.
		const id = assertModelId(modelId);
		return resolve().remove(id);
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
	});
}
