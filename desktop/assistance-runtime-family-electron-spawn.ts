/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron utilityProcess transport implementing the runtime-family router's process port. */

import { isAbsolute, resolve } from 'node:path';

import type {
	AssistanceRuntimeFamilyProcess,
	AssistanceRuntimeFamilyProcessWorker,
} from './assistance-runtime-family-host.ts';
import {
	validateAssistanceRuntimeFamilyJobRequestV1,
	type AssistanceRuntimeFamilyAdmittedJob,
	type AssistanceRuntimeFamilyJobRequestV1,
} from './assistance-runtime-family-job-contract.ts';
import {
	type AssistanceRuntimeFamilyDescriptor,
	type AssistanceRuntimeFamilyId,
} from './assistance-runtime-family-manifest.ts';
import {
	validateAssistanceRuntimeFamilyDescriptorV1,
	validateAssistanceRuntimeFamilyHostMessageV1,
	validateAssistanceRuntimeFamilyProcessMessageV1,
} from './assistance-runtime-family-process-protocol.ts';

export interface AssistanceRuntimeFamilyElectronChild {
	readonly pid: number;
	postMessage(message: unknown): void;
	on(event: string, listener: (...values: unknown[]) => void): void;
	off(event: string, listener: (...values: unknown[]) => void): void;
	kill(): unknown;
}

export interface AssistanceRuntimeFamilyElectronSpawnOptions {
	readonly helperPath: string;
	readonly fork: (
		modulePath: string,
		args: readonly string[],
		options: Readonly<{ readonly serviceName: string }>,
	) => AssistanceRuntimeFamilyElectronChild;
	readonly sampleRss?: (pid: number) => number | null;
	readonly handshakeTimeoutMs?: number;
	readonly killWaitMs?: number;
	readonly setTimeoutImpl?: typeof setTimeout;
	readonly clearTimeoutImpl?: typeof clearTimeout;
}

interface ActiveJob {
	readonly request: AssistanceRuntimeFamilyJobRequestV1;
	readonly onProgress?: (value: number) => void;
	readonly completion: Promise<unknown>;
	resolve(value: unknown): void;
	reject(error: Error): void;
	settled: boolean;
	expectedSequence: number;
	terminating: boolean;
	termination: Promise<void> | null;
	resolveTermination: (() => void) | null;
	rejectTermination: ((error: Error) => void) | null;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 2_000;
const DEFAULT_KILL_WAIT_MS = 1_000;

export function createAssistanceRuntimeFamilyElectronSpawns(
	options: AssistanceRuntimeFamilyElectronSpawnOptions,
): Readonly<Record<AssistanceRuntimeFamilyId, (
	descriptor: AssistanceRuntimeFamilyDescriptor,
) => Promise<AssistanceRuntimeFamilyProcess>>> {
	validateOptions(options);
	return Object.freeze({
		'onnxruntime-node': (descriptor) => spawnFamily(options, 'onnxruntime-node', descriptor),
		'whisper-cpp': (descriptor) => spawnFamily(options, 'whisper-cpp', descriptor),
		'llama-cpp': (descriptor) => spawnFamily(options, 'llama-cpp', descriptor),
	});
}

async function spawnFamily(
	options: AssistanceRuntimeFamilyElectronSpawnOptions,
	familyId: AssistanceRuntimeFamilyId,
	descriptorValue: AssistanceRuntimeFamilyDescriptor,
): Promise<AssistanceRuntimeFamilyProcess> {
	const descriptor = validateAssistanceRuntimeFamilyDescriptorV1(descriptorValue);
	if (descriptor.familyId !== familyId) {
		throw new TypeError('The Electron runtime-family spawn selected a foreign descriptor.');
	}
	const child = inspectChild(options.fork(options.helperPath, [], {
		serviceName: `soundscaper-assistance-${familyId}`,
	}));
	const handshakeTimeoutMs = boundedMilliseconds(
		options.handshakeTimeoutMs, DEFAULT_HANDSHAKE_TIMEOUT_MS, 10_000, 'handshake timeout',
	);
	const killWaitMs = boundedMilliseconds(
		options.killWaitMs, DEFAULT_KILL_WAIT_MS, 2_000, 'kill wait',
	);
	const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
	const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
	let ready = false;
	let exited = false;
	let exitCode: number | null = null;
	let active: ActiveJob | null = null;
	let protocolFailure: Error | null = null;
	let processTermination: Promise<void> | null = null;
	const exitListeners = new Set<(code: number | null) => void>();
	const exitWaiters = new Set<Readonly<{ resolve(): void; reject(error: Error): void }>>();
	let resolveHandshake!: (process: AssistanceRuntimeFamilyProcess) => void;
	let rejectHandshake!: (error: Error) => void;
	const handshake = new Promise<AssistanceRuntimeFamilyProcess>((resolveHandshake_, rejectHandshake_) => {
		resolveHandshake = resolveHandshake_; rejectHandshake = rejectHandshake_;
	});
	const handshakeTimer = setTimeoutImpl(() => {
		fault(new Error(`The ${familyId} utility-process handshake timed out.`));
	}, handshakeTimeoutMs);

	const onMessage = (value: unknown): void => {
		if (exited) return;
		try {
			if (!ready) {
				const message = validateAssistanceRuntimeFamilyProcessMessageV1(value);
				if (message.type !== 'ready' || message.familyId !== familyId
					|| message.runtimeVersion !== descriptor.runtimeVersion) {
					throw new Error('The runtime-family handshake returned a foreign identity.');
				}
				ready = true;
				clearTimeoutImpl(handshakeTimer);
				resolveHandshake(processPort);
				return;
			}
			const job = active;
			if (!job) throw new Error('The runtime-family process sent a stale job message.');
			const message = validateAssistanceRuntimeFamilyProcessMessageV1(value, job.request);
			if (message.type === 'ready') throw new Error('The runtime-family process repeated its handshake.');
			if (message.type === 'progress') {
				if (job.terminating || message.sequence !== job.expectedSequence) {
					throw new Error('The runtime-family progress sequence is stale or out of order.');
				}
				job.expectedSequence += 1;
				job.onProgress?.(message.value);
				return;
			}
			if (message.type === 'worker-terminated') {
				if (!job.terminating) throw new Error('The runtime-family worker terminated without a request.');
				settleTerminated(job);
				return;
			}
			if (job.terminating) throw new Error('The runtime-family worker answered after termination began.');
			if (message.type === 'result') settleJob(job, null, message.result);
			else settleJob(job, reviveWireError(message.error));
		} catch (error) {
			fault(new Error(`The ${familyId} utility process violated its protocol: ${errorMessage(error)}`));
		}
	};

	const onExit = (value: unknown): void => {
		if (exited) return;
		exited = true;
		exitCode = Number.isSafeInteger(value) ? Number(value) : null;
		clearTimeoutImpl(handshakeTimer);
		child.off('message', onMessage);
		child.off('exit', onExit);
		const error = protocolFailure ?? new Error(
			`The ${familyId} utility process exited unexpectedly with code ${String(exitCode)}.`,
		);
		if (!ready) rejectHandshake(error);
		if (active) settleJob(active, error);
		for (const waiter of exitWaiters) waiter.resolve();
		exitWaiters.clear();
		for (const listener of exitListeners) listener(exitCode);
	};

	function fault(error: Error): void {
		if (protocolFailure === null) protocolFailure = error;
		if (!ready) {
			clearTimeoutImpl(handshakeTimer);
			rejectHandshake(error);
		}
		if (active) settleJob(active, error);
		try { child.kill(); } catch { /* The protocol failure remains authoritative. */ }
	}

	function startWorker(
		jobValue: AssistanceRuntimeFamilyAdmittedJob,
		runOptions: Readonly<{ readonly onProgress?: (value: number) => void }>,
	): AssistanceRuntimeFamilyProcessWorker {
		if (exited || !ready) throw new Error(`The ${familyId} utility process is unavailable.`);
		if (active) throw new Error(`The ${familyId} utility process already owns one worker.`);
		const jobDescriptor = validateAssistanceRuntimeFamilyDescriptorV1(jobValue?.descriptor);
		const request = validateAssistanceRuntimeFamilyJobRequestV1({
			protocolVersion: jobValue?.protocolVersion, jobId: jobValue?.jobId,
			familyId: jobValue?.familyId, task: jobValue?.task,
			maximumRssBytes: jobValue?.maximumRssBytes,
			maximumDurationMs: jobValue?.maximumDurationMs, grant: jobValue?.grant,
		});
		if (JSON.stringify(jobDescriptor) !== JSON.stringify(descriptor)) {
			throw new TypeError('The runtime-family job changed its authenticated process descriptor.');
		}
		let resolve!: (value: unknown) => void;
		let reject!: (error: Error) => void;
		const completion = new Promise<unknown>((resolve_, reject_) => {
			resolve = resolve_; reject = reject_;
		});
		const job: ActiveJob = {
			request, onProgress: runOptions?.onProgress, completion, resolve, reject,
			settled: false, expectedSequence: 0, terminating: false,
			termination: null, resolveTermination: null, rejectTermination: null,
		};
		active = job;
		try {
			child.postMessage(validateAssistanceRuntimeFamilyHostMessageV1({
				protocolVersion: 1, type: 'job', request,
			}));
		} catch (error) {
			fault(new Error(`The runtime-family job could not be posted: ${errorMessage(error)}`));
		}
		return Object.freeze({
			completion,
			terminate: () => terminateWorker(job),
		});
	}

	function terminateWorker(job: ActiveJob): Promise<void> {
		if (job.settled || active !== job) return Promise.resolve();
		if (job.termination) return job.termination;
		job.terminating = true;
		job.termination = new Promise<void>((resolve, reject) => {
			job.resolveTermination = resolve; job.rejectTermination = reject;
		});
		try {
			child.postMessage(validateAssistanceRuntimeFamilyHostMessageV1({
				protocolVersion: 1, type: 'terminate-worker', jobId: job.request.jobId,
			}));
		} catch (error) {
			fault(new Error(`The runtime-family worker termination could not be posted: ${errorMessage(error)}`));
		}
		return job.termination;
	}

	function settleJob(job: ActiveJob, error: Error | null, result?: unknown): void {
		if (job.settled) return;
		job.settled = true;
		if (active === job) active = null;
		if (error) {
			job.reject(error);
			job.rejectTermination?.(error);
		} else job.resolve(result);
	}

	function settleTerminated(job: ActiveJob): void {
		if (job.settled) return;
		job.settled = true;
		if (active === job) active = null;
		job.reject(new DOMException('The runtime-family worker was terminated.', 'AbortError'));
		job.resolveTermination?.();
	}

	function terminateProcess(): Promise<void> {
		if (exited) return Promise.resolve();
		if (processTermination) return processTermination;
		processTermination = new Promise<void>((resolveTermination, rejectTermination) => {
			const waiter = Object.freeze({ resolve: resolveTermination, reject: rejectTermination });
			exitWaiters.add(waiter);
			const timer = setTimeoutImpl(() => {
				exitWaiters.delete(waiter);
				rejectTermination(new Error(`The ${familyId} utility process missed its kill deadline.`));
			}, killWaitMs);
			const wrapped = Object.freeze({
				resolve: () => { clearTimeoutImpl(timer); resolveTermination(); },
				reject: (error: Error) => { clearTimeoutImpl(timer); rejectTermination(error); },
			});
			exitWaiters.delete(waiter);
			exitWaiters.add(wrapped);
			try { child.kill(); }
			catch (error) { wrapped.reject(new Error(errorMessage(error))); }
		});
		return processTermination;
	}

	const processPort: AssistanceRuntimeFamilyProcess = Object.freeze({
		familyId,
		runtimeVersion: descriptor.runtimeVersion,
		startWorker,
		onExit(listener: (code: number | null) => void): void {
			if (typeof listener !== 'function') throw new TypeError('The runtime-family exit listener is invalid.');
			if (exited) { queueMicrotask(() => listener(exitCode)); return; }
			exitListeners.add(listener);
		},
		sampleRss(): number | null {
			if (exited || options.sampleRss === undefined) return null;
			try {
				const value = options.sampleRss(child.pid);
				return value === null || Number.isSafeInteger(value) && value >= 0 ? value : null;
			} catch { return null; }
		},
		terminate: terminateProcess,
	});

	child.on('message', onMessage);
	child.on('exit', onExit);
	try {
		child.postMessage(validateAssistanceRuntimeFamilyHostMessageV1({
			protocolVersion: 1, type: 'initialize', descriptor,
		}));
	} catch (error) {
		fault(new Error(`The runtime-family initialize message could not be posted: ${errorMessage(error)}`));
	}
	return await handshake;
}

function inspectChild(value: AssistanceRuntimeFamilyElectronChild): AssistanceRuntimeFamilyElectronChild {
	if (!value || typeof value.postMessage !== 'function' || typeof value.on !== 'function'
		|| typeof value.off !== 'function' || typeof value.kill !== 'function'
		|| !Number.isSafeInteger(value.pid) || value.pid < 1) {
		throw new TypeError('Electron returned an invalid runtime-family utility process.');
	}
	return value;
}

function validateOptions(options: AssistanceRuntimeFamilyElectronSpawnOptions): void {
	if (!options || typeof options.fork !== 'function' || typeof options.helperPath !== 'string'
		|| !isAbsolute(options.helperPath) || resolve(options.helperPath) !== options.helperPath
		|| options.helperPath.includes('\0')
		|| options.sampleRss !== undefined && typeof options.sampleRss !== 'function') {
		throw new TypeError('The runtime-family Electron spawn options are invalid.');
	}
}

function boundedMilliseconds(
	value: number | undefined,
	fallback: number,
	maximum: number,
	label: string,
): number {
	const admitted = value ?? fallback;
	if (!Number.isSafeInteger(admitted) || admitted < 1 || admitted > maximum) {
		throw new RangeError(`The runtime-family ${label} is invalid.`);
	}
	return admitted;
}

function reviveWireError(value: Readonly<{ name: string; message: string; code: string }>): Error {
	const error = new Error(value.message) as Error & { code?: string };
	error.name = value.name; error.code = value.code;
	return error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
