/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron utilityProcess entry for one lazy authenticated runtime family. */

import type { AssistanceRuntimeFamilyDescriptor } from './assistance-runtime-family-manifest.ts';
import {
	createAssistanceRuntimeFamilyThreadWorkerSpawner,
	type AssistanceRuntimeFamilyThreadPort,
} from './assistance-runtime-family-thread-worker.ts';
import {
	createAssistanceRuntimeFamilyUtilityWorker,
	type AssistanceRuntimeFamilyInnerWorker,
	type AssistanceRuntimeFamilyUtilityWorker,
} from './assistance-runtime-family-utility-worker.ts';
import {
	createAssistanceWhisperCppWorkerSpawnerV1,
} from './assistance-whisper-cpp-worker.ts';
import {
	createAssistanceLlamaCppWorkerSpawnerV1,
} from './assistance-llama-cpp-worker.ts';

export interface AssistanceRuntimeFamilyHelperProcessOptions {
	readonly post: (message: unknown) => void;
	readonly exit: (code: number) => void;
	readonly workerEntry?: string | URL;
	readonly createWorker?: (
		entry: string | URL,
		job: Parameters<ReturnType<typeof createAssistanceRuntimeFamilyThreadWorkerSpawner>>[0],
	) => AssistanceRuntimeFamilyThreadPort;
	readonly verifyDescriptor?: (
		descriptor: AssistanceRuntimeFamilyDescriptor,
	) => Promise<AssistanceRuntimeFamilyDescriptor>;
	readonly spawnWhisperWorker?: (
		job: Parameters<ReturnType<typeof createAssistanceRuntimeFamilyThreadWorkerSpawner>>[0],
		options: Readonly<{ readonly onProgress: (value: number) => void }>,
	) => AssistanceRuntimeFamilyInnerWorker;
	readonly spawnLlamaWorker?: (
		job: Parameters<ReturnType<typeof createAssistanceRuntimeFamilyThreadWorkerSpawner>>[0],
		options: Readonly<{ readonly onProgress: (value: number) => void }>,
	) => AssistanceRuntimeFamilyInnerWorker;
}

export function createAssistanceRuntimeFamilyHelperProcessV1(
	options: AssistanceRuntimeFamilyHelperProcessOptions,
): AssistanceRuntimeFamilyUtilityWorker {
	if (!options || typeof options.post !== 'function' || typeof options.exit !== 'function') {
		throw new TypeError('The runtime-family helper-process ports are invalid.');
	}
	if (options.spawnWhisperWorker !== undefined
		&& typeof options.spawnWhisperWorker !== 'function') {
		throw new TypeError('The whisper.cpp worker-process port is invalid.');
	}
	if (options.spawnLlamaWorker !== undefined
		&& typeof options.spawnLlamaWorker !== 'function') {
		throw new TypeError('The llama.cpp worker-process port is invalid.');
	}
	const spawnThreadWorker = createAssistanceRuntimeFamilyThreadWorkerSpawner({
		workerEntry: options.workerEntry
			?? new URL('./assistance-runtime-family-inference-worker.js', import.meta.url),
		createWorker: options.createWorker,
	});
	const spawnWhisperWorker = options.spawnWhisperWorker
		?? createAssistanceWhisperCppWorkerSpawnerV1();
	const spawnLlamaWorker = options.spawnLlamaWorker
		?? createAssistanceLlamaCppWorkerSpawnerV1();
	return createAssistanceRuntimeFamilyUtilityWorker({
		post: options.post,
		exit: options.exit,
		verifyDescriptor: options.verifyDescriptor,
		spawnWorker: (job, runOptions) => {
			if (job.familyId === 'whisper-cpp') return spawnWhisperWorker(job, runOptions);
			if (job.familyId === 'llama-cpp' && job.task === 'editorial-generation') {
				return spawnLlamaWorker(job, runOptions);
			}
			return spawnThreadWorker(job, runOptions);
		},
	});
}

interface ElectronUtilityParentPort {
	postMessage(message: unknown): void;
	on(event: 'message', listener: (event: unknown) => void): void;
}

const utilityParentPort = (globalThis.process as typeof process & {
	readonly parentPort?: ElectronUtilityParentPort;
}).parentPort;

if (utilityParentPort && typeof utilityParentPort.postMessage === 'function'
	&& typeof utilityParentPort.on === 'function') {
	const helper = createAssistanceRuntimeFamilyHelperProcessV1({
		post: (message) => utilityParentPort.postMessage(message),
		exit: (code) => process.exit(code),
	});
	utilityParentPort.on('message', (event) => {
		try { helper.handleMessage(strictEventData(event)); }
		catch { helper.dispose(1); }
	});
}

function strictEventData(value: unknown): unknown {
	if (typeof value !== 'object' || value === null || !('data' in value)) {
		throw new TypeError('The runtime-family utility process received no message event.');
	}
	const event = value as { readonly data: unknown; readonly ports?: unknown };
	if (event.ports !== undefined
		&& (!Array.isArray(event.ports) || event.ports.length !== 0)) {
		throw new TypeError('Runtime-family messages cannot transfer capability ports.');
	}
	return event.data;
}
