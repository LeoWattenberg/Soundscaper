/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
	AssistanceRuntimeFamilyError,
	createAssistanceRuntimeFamilyRouter,
	type AssistanceRuntimeFamilyAdmittedJob,
	type AssistanceRuntimeFamilyProcess,
	type AssistanceRuntimeFamilyProcessWorker,
} from '../../desktop/assistance-runtime-family-host.ts';
import type {
	AssistanceRuntimeFamilyAvailability,
	AssistanceRuntimeFamilyDescriptor,
	AssistanceRuntimeFamilyId,
} from '../../desktop/assistance-runtime-family-manifest.ts';
import { waitFor } from './async-test-control.ts';

export const GIB = 1024 ** 3;
export const JOB_ID = 'ab'.repeat(20);

export function descriptor(familyId: AssistanceRuntimeFamilyId): AssistanceRuntimeFamilyDescriptor {
	return Object.freeze({
		familyId,
		runtimeVersion: familyId === 'onnxruntime-node' ? '1.29.0'
			: familyId === 'whisper-cpp' ? 'v1.9.3' : 'b10509',
		target: 'linux-x64', executionProvider: 'cpu',
		entrypoint: `/runtime/${familyId}`,
		files: Object.freeze([Object.freeze({
			path: `/runtime/${familyId}`, relativePath: 'runtime', byteLength: 10,
			sha256: '1'.repeat(64), executable: familyId !== 'onnxruntime-node',
		})]),
	});
}

export function available(familyId: AssistanceRuntimeFamilyId): AssistanceRuntimeFamilyAvailability {
	return Object.freeze({ status: 'available' as const, descriptor: descriptor(familyId) });
}

export class FakeWorker implements AssistanceRuntimeFamilyProcessWorker {
	readonly completion: Promise<unknown>;
	terminations = 0;
	#resolve!: (value: unknown) => void;
	#reject!: (error: Error) => void;
	terminateImpl: () => Promise<void> = () => {
		this.terminations += 1;
		this.#reject(new DOMException('worker terminated', 'AbortError'));
		return Promise.resolve();
	};

	constructor() {
		this.completion = new Promise((resolve, reject) => {
			this.#resolve = resolve;
			this.#reject = reject;
		});
	}

	resolve(value: unknown): void { this.#resolve(value); }
	reject(error: Error): void { this.#reject(error); }
	terminate(): Promise<void> { return this.terminateImpl(); }
}

export class FakeProcess implements AssistanceRuntimeFamilyProcess {
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly runtimeVersion: string;
	readonly jobs: AssistanceRuntimeFamilyAdmittedJob[] = [];
	readonly workers: FakeWorker[] = [];
	terminations = 0;
	shutdowns = 0;
	rss = 0;
	terminateImpl: () => Promise<void> = () => Promise.resolve();
	shutdownImpl: () => Promise<void> = () => Promise.resolve();
	#exit: ((code: number | null) => void) | null = null;

	constructor(familyId: AssistanceRuntimeFamilyId) {
		this.familyId = familyId;
		this.runtimeVersion = descriptor(familyId).runtimeVersion;
	}

	startWorker(job: AssistanceRuntimeFamilyAdmittedJob): FakeWorker {
		this.jobs.push(job);
		const worker = new FakeWorker();
		this.workers.push(worker);
		return worker;
	}
	onExit(listener: (code: number | null) => void): void { this.#exit = listener; }
	sampleRss(): number | null { return this.rss; }
	terminate(): Promise<void> { this.terminations += 1; return this.terminateImpl(); }
	shutdown(): Promise<void> { this.shutdowns += 1; return this.shutdownImpl(); }
	exit(code: number | null): void { this.#exit?.(code); }
}

export function request(
	familyId: AssistanceRuntimeFamilyId = 'onnxruntime-node',
	task = 'shot-detection',
	jobId = JOB_ID,
) {
	const grant = Object.freeze({
		grantVersion: 1 as const, jobId, familyId, task,
		settingsJson: '{}',
		inputs: Object.freeze([Object.freeze({
			claimId: '1'.repeat(40), role: 'video', mediaType: 'video/mp4',
			path: '/private/input', byteLength: 1, sha256: '1'.repeat(64),
			identity: Object.freeze({ dev: 1, ino: 1 }),
		})]),
		models: Object.freeze([Object.freeze({
			modelId: 'model', version: '1.0.0', artifactRole: 'network',
			path: '/private/model', byteLength: 1, sha256: '2'.repeat(64),
			identity: Object.freeze({ dev: 1, ino: 2 }),
		})]),
		outputs: Object.freeze([Object.freeze({
			claimId: '3'.repeat(40), role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
			path: '/private/output', maximumByteLength: 1,
			initialByteLength: 0 as const,
			initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			identity: Object.freeze({ dev: 1, ino: 3 }),
		})]),
	});
	return Object.freeze({
		protocolVersion: ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
		jobId, familyId, task,
		maximumRssBytes: 2 * GIB,
		maximumDurationMs: 60_000,
		grant,
	});
}

export function routerHarness(
	overrides: Partial<Parameters<typeof createAssistanceRuntimeFamilyRouter>[0]> = {},
) {
	const processes: Record<AssistanceRuntimeFamilyId, FakeProcess[]> = {
		'onnxruntime-node': [], 'whisper-cpp': [], 'llama-cpp': [],
	};
	const spawn = (familyId: AssistanceRuntimeFamilyId) => async () => {
		const process = new FakeProcess(familyId);
		processes[familyId].push(process);
		return process;
	};
	const spawns: Parameters<typeof createAssistanceRuntimeFamilyRouter>[0]['spawns'] = {
		'onnxruntime-node': spawn('onnxruntime-node'),
		'whisper-cpp': spawn('whisper-cpp'),
		'llama-cpp': spawn('llama-cpp'),
	};
	const router = createAssistanceRuntimeFamilyRouter({
		availability: async (familyId) => available(familyId),
		spawns,
		totalMemoryBytes: () => 32 * GIB,
		availableMemoryBytes: () => 24 * GIB,
		...overrides,
	});
	return { router, processes };
}

export function typedRuntimeFailure(code: AssistanceRuntimeFamilyError['code']) {
	return (error: unknown): boolean => error instanceof AssistanceRuntimeFamilyError && error.code === code;
}

export async function untilRuntime(predicate: () => boolean): Promise<void> {
	await waitFor(predicate, 'the runtime-family test condition');
}
