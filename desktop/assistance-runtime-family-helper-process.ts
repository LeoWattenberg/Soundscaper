/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron utilityProcess entry for one lazy authenticated runtime family. */

import type { AssistanceRuntimeFamilyDescriptor } from './assistance-runtime-family-manifest.ts';
import {
	createAssistanceRuntimeFamilyThreadWorkerSpawner,
	type AssistanceRuntimeFamilyThreadPort,
} from './assistance-runtime-family-thread-worker.ts';
import {
	createAssistanceRuntimeFamilyUtilityWorker,
	type AssistanceRuntimeFamilyUtilityWorker,
} from './assistance-runtime-family-utility-worker.ts';

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
}

export function createAssistanceRuntimeFamilyHelperProcessV1(
	options: AssistanceRuntimeFamilyHelperProcessOptions,
): AssistanceRuntimeFamilyUtilityWorker {
	if (!options || typeof options.post !== 'function' || typeof options.exit !== 'function') {
		throw new TypeError('The runtime-family helper-process ports are invalid.');
	}
	const spawnWorker = createAssistanceRuntimeFamilyThreadWorkerSpawner({
		workerEntry: options.workerEntry
			?? new URL('./assistance-runtime-family-inference-worker.js', import.meta.url),
		createWorker: options.createWorker,
	});
	return createAssistanceRuntimeFamilyUtilityWorker({
		post: options.post,
		exit: options.exit,
		verifyDescriptor: options.verifyDescriptor,
		spawnWorker,
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
