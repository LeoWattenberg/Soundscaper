/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lazy desktop composition for authenticated additional assistance runtimes. */

import { isAbsolute, resolve } from 'node:path';

import {
	createAssistanceRuntimeFamilyElectronSpawns,
	type AssistanceRuntimeFamilyElectronSpawnOptions,
} from './assistance-runtime-family-electron-spawn.ts';
import {
	createAssistanceRuntimeFamilyRouter,
	type AssistanceRuntimeFamilySnapshot,
} from './assistance-runtime-family-host.ts';
import {
	ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	describeAssistanceRuntimeFamilyAvailability,
	type AssistanceRuntimeFamilyAvailability,
	type AssistanceRuntimeFamilyId,
} from './assistance-runtime-family-manifest.ts';
import {
	createAssistanceRuntimeFamilyOperationAdapter,
	type AssistanceRuntimeFamilyOperationAdapter,
} from './assistance-runtime-family-operation-adapter.ts';
import type { AssistancePowerEtiquettePort } from './assistance-power-etiquette-v1.ts';

export interface AssistanceRuntimeFamilyDesktopStartupOptions {
	readonly runtimeRoot: string;
	readonly helperPath: string;
	readonly manifests?: Readonly<Partial<Record<AssistanceRuntimeFamilyId, unknown>>>;
	/** First-use archive preparation; never invoked during startup. */
	readonly ensureRuntime?: (familyId: AssistanceRuntimeFamilyId, signal?: AbortSignal) => Promise<void>;
	readonly ensureKokoroRuntime?: (signal?: AbortSignal) => Promise<void>;
	readonly platform?: string;
	readonly architecture?: string;
	readonly fork: AssistanceRuntimeFamilyElectronSpawnOptions['fork'];
	readonly sampleRss?: (pid: number) => number | null;
	readonly applyBackgroundPriority?: (pid: number) => void;
	readonly powerEtiquette?: AssistancePowerEtiquettePort;
	readonly totalMemoryBytes: () => number;
	readonly availableMemoryBytes: () => number;
}

export interface AssistanceRuntimeFamilyDesktopStartup {
	readonly operations: AssistanceRuntimeFamilyOperationAdapter;
	availability(familyId: AssistanceRuntimeFamilyId, signal?: AbortSignal): Promise<AssistanceRuntimeFamilyAvailability>;
	snapshot(familyId: AssistanceRuntimeFamilyId): AssistanceRuntimeFamilySnapshot;
	dispose(): void;
	shutdown(): Promise<void>;
}

export function createAssistanceRuntimeFamilyDesktopStartup(
	options: AssistanceRuntimeFamilyDesktopStartupOptions,
): AssistanceRuntimeFamilyDesktopStartup {
	validateOptions(options);
	const manifests = manifestInventory(options.manifests);
	const availability = async (
		familyId: AssistanceRuntimeFamilyId,
		signal?: AbortSignal,
	): Promise<AssistanceRuntimeFamilyAvailability> => {
		if (!Object.hasOwn(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS, familyId)) {
			throw new TypeError('The runtime-family availability id is invalid.');
		}
		const check = () => describeAssistanceRuntimeFamilyAvailability({
			familyId,
			manifest: manifests[familyId],
			runtimeRoot: options.runtimeRoot,
			totalMemoryBytes: options.totalMemoryBytes(),
			...(options.platform === undefined ? {} : { platform: options.platform }),
			...(options.architecture === undefined ? {} : { architecture: options.architecture }),
		});
		const current = await check();
		if (current.status === 'available' || options.ensureRuntime === undefined
			|| !['payload-missing', 'payload-digest-mismatch'].includes(current.reason)) return current;
		await options.ensureRuntime(familyId, signal);
		signal?.throwIfAborted();
		return check();
	};
	const spawns = createAssistanceRuntimeFamilyElectronSpawns({
		helperPath: options.helperPath,
		runtimeRoot: options.runtimeRoot,
		fork: options.fork,
		...(options.sampleRss === undefined ? {} : { sampleRss: options.sampleRss }),
		...(options.applyBackgroundPriority === undefined
			? {} : { applyBackgroundPriority: options.applyBackgroundPriority }),
	});
	const router = createAssistanceRuntimeFamilyRouter({
		availability,
		spawns,
		totalMemoryBytes: options.totalMemoryBytes,
		availableMemoryBytes: options.availableMemoryBytes,
		...(options.powerEtiquette === undefined ? {} : { powerEtiquette: options.powerEtiquette }),
	});
	return Object.freeze({
		operations: createAssistanceRuntimeFamilyOperationAdapter({
			router,
			...(options.ensureKokoroRuntime === undefined ? {} : {
				beforeRun: async (request) => {
					if (request.task === 'text-to-speech') await options.ensureKokoroRuntime?.(request.signal);
				},
			}),
		}),
		availability,
		snapshot: router.snapshot,
		dispose: router.dispose,
		shutdown: router.shutdown,
	});
}

function manifestInventory(
	value: AssistanceRuntimeFamilyDesktopStartupOptions['manifests'],
): Readonly<Partial<Record<AssistanceRuntimeFamilyId, unknown>>> {
	if (value === undefined) return Object.freeze({});
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('The runtime-family manifest inventory must be one plain record.');
	}
	for (const familyId of Object.keys(value)) {
		if (!Object.hasOwn(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS, familyId)) {
			throw new TypeError('The runtime-family manifest inventory has a foreign family key.');
		}
	}
	return Object.freeze({ ...value });
}

function validateOptions(options: AssistanceRuntimeFamilyDesktopStartupOptions): void {
	if (!options || typeof options.runtimeRoot !== 'string'
		|| !isAbsolute(options.runtimeRoot) || resolve(options.runtimeRoot) !== options.runtimeRoot
		|| typeof options.helperPath !== 'string'
		|| !isAbsolute(options.helperPath) || resolve(options.helperPath) !== options.helperPath
		|| typeof options.fork !== 'function'
		|| typeof options.totalMemoryBytes !== 'function'
		|| typeof options.availableMemoryBytes !== 'function'
		|| options.ensureRuntime !== undefined && typeof options.ensureRuntime !== 'function'
		|| options.ensureKokoroRuntime !== undefined && typeof options.ensureKokoroRuntime !== 'function'
		|| options.sampleRss !== undefined && typeof options.sampleRss !== 'function'
		|| options.applyBackgroundPriority !== undefined
			&& typeof options.applyBackgroundPriority !== 'function'
		|| options.platform !== undefined && (typeof options.platform !== 'string' || options.platform === '')
		|| options.architecture !== undefined
			&& (typeof options.architecture !== 'string' || options.architecture === '')) {
		throw new TypeError('The runtime-family desktop startup options are invalid.');
	}
}
