/* SPDX-License-Identifier: AGPL-3.0-only */

/** One authenticated job per terminateable worker_threads instance. */

import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { Worker } from 'node:worker_threads';

import type {
	AssistanceRuntimeFamilyAdmittedJob,
	AssistanceRuntimeFamilyJobRequestV1,
} from './assistance-runtime-family-job-contract.ts';
import { validateAssistanceRuntimeFamilyJobRequestV1 } from './assistance-runtime-family-job-contract.ts';
import {
	validateAssistanceRuntimeFamilyDescriptorV1,
	validateAssistanceRuntimeFamilyProcessMessageV1,
} from './assistance-runtime-family-process-protocol.ts';
import type { AssistanceRuntimeFamilyInnerWorker } from './assistance-runtime-family-utility-worker.ts';

export interface AssistanceRuntimeFamilyThreadPort {
	on(event: string, listener: (...values: unknown[]) => void): this;
	once(event: string, listener: (...values: unknown[]) => void): this;
	postMessage?(value: unknown): void;
	terminate(): Promise<number>;
}

export interface AssistanceRuntimeFamilyThreadWorkerSpawnerOptions {
	readonly workerEntry: string | URL;
	readonly residentOnnx?: boolean;
	readonly createWorker?: (
		entry: string | URL,
		job: AssistanceRuntimeFamilyAdmittedJob,
		residentOnnx?: boolean,
	) => AssistanceRuntimeFamilyThreadPort;
}

type Terminal =
	| Readonly<{ readonly kind: 'result'; readonly value: unknown }>
	| Readonly<{ readonly kind: 'error'; readonly error: Error }>;

export function createAssistanceRuntimeFamilyThreadWorkerSpawner(
	options: AssistanceRuntimeFamilyThreadWorkerSpawnerOptions,
): (
	job: AssistanceRuntimeFamilyAdmittedJob,
	options: Readonly<{ readonly onProgress: (value: number) => void }>,
) => AssistanceRuntimeFamilyInnerWorker {
	const workerEntry = validateWorkerEntry(options?.workerEntry);
	if (options?.createWorker !== undefined && typeof options.createWorker !== 'function') {
		throw new TypeError('The runtime-family thread factory is invalid.');
	}
	const createWorker = options.createWorker ?? ((entry, job, residentOnnx) => (
		new Worker(entry, { workerData: residentOnnx ? { residentOnnx: true, job } : job }) as AssistanceRuntimeFamilyThreadPort
	));
	if (options.residentOnnx !== undefined && typeof options.residentOnnx !== 'boolean') throw new TypeError('The resident ONNX policy is invalid.');
	const spawnResident = createResidentOnnxSpawner(workerEntry, createWorker);
	return (jobValue, runOptions) => {
		if (!runOptions || typeof runOptions.onProgress !== 'function') {
			throw new TypeError('The runtime-family thread progress port is invalid.');
		}
		const job = validateAdmittedJob(jobValue);
		if (options.residentOnnx && job.familyId === 'onnxruntime-node') return spawnResident(job, runOptions);
		const request = requestFrom(job);
		const worker = inspectWorker(createWorker(workerEntry, job));
		let expectedSequence = 0;
		let terminal: Terminal | null = null;
		let exited = false;
		let terminating = false;
		let termination: Promise<void> | null = null;
		let resolveCompletion!: (value: unknown) => void;
		let rejectCompletion!: (error: Error) => void;
		const completion = new Promise<unknown>((resolve, reject) => {
			resolveCompletion = resolve; rejectCompletion = reject;
		});

		worker.on('message', (value: unknown) => {
			if (exited || terminating) return;
			try {
				if (terminal !== null) throw new Error('The runtime-family thread repeated its terminal message.');
				const message = validateAssistanceRuntimeFamilyProcessMessageV1(value, request);
				if (message.type === 'progress') {
					if (message.sequence !== expectedSequence) {
						throw new Error('The runtime-family thread progress is out of sequence.');
					}
					expectedSequence += 1;
					runOptions.onProgress(message.value);
					return;
				}
				if (message.type === 'result') terminal = Object.freeze({ kind: 'result', value: message.result });
				else if (message.type === 'error') {
					terminal = Object.freeze({ kind: 'error', error: reviveWireError(message.error) });
				} else throw new Error('The runtime-family thread sent a process-only message.');
			} catch (error) {
				failProtocol(error);
			}
		});
		worker.once('error', (value: unknown) => {
			if (exited || terminal !== null) return;
			terminal = Object.freeze({
				kind: 'error', error: value instanceof Error ? value : new Error(String(value)),
			});
		});
		worker.once('exit', (value: unknown) => {
			if (exited) return;
			exited = true;
			const code = Number.isSafeInteger(value) ? Number(value) : null;
			if (terminating) {
				rejectCompletion(new DOMException('The runtime-family thread was terminated.', 'AbortError'));
				return;
			}
			if (terminal?.kind === 'result' && code === 0) resolveCompletion(terminal.value);
			else if (terminal?.kind === 'error') rejectCompletion(terminal.error);
			else rejectCompletion(new Error(
				`The runtime-family thread exited without a valid result (code ${String(code)}).`,
			));
		});

		function failProtocol(value: unknown): void {
			if (terminal !== null || terminating || exited) return;
			terminal = Object.freeze({
				kind: 'error',
				error: new Error(`The runtime-family thread violated its protocol: ${errorMessage(value)}`),
			});
			try { termination = stopWorker().catch(() => undefined); }
			catch { /* The captured protocol error remains authoritative. */ }
		}

		function terminate(): Promise<void> {
			if (exited) return Promise.resolve();
			if (termination) return termination;
			terminating = true;
			try { termination = stopWorker(); }
			catch (error) { termination = Promise.reject(error); }
			return termination;
		}

		function stopWorker(): Promise<void> {
			if (job.task === 'text-to-speech' && typeof worker.postMessage === 'function') {
				return new Promise<void>((resolveTermination, rejectTermination) => {
					let settled = false;
					const settle = (error?: unknown): void => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						if (error) rejectTermination(error);
						else resolveTermination();
					};
					worker.once('exit', () => settle());
					const timer = setTimeout(() => {
						void Promise.resolve(worker.terminate()).then(() => settle(), settle);
					}, 1_500);
					try { worker.postMessage?.({ type: 'cancel', jobId: job.jobId }); }
					catch { void Promise.resolve(worker.terminate()).then(() => settle(), settle); }
				});
			}
			return Promise.resolve(worker.terminate()).then(() => undefined);
		}

		return Object.freeze({ completion, terminate });
	};
}

interface ResidentRun {
	readonly job: AssistanceRuntimeFamilyAdmittedJob;
	readonly onProgress: (value: number) => void;
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	sequence: number;
	terminal: Terminal | null;
	expectExit: boolean;
	cancelled: boolean;
	done: boolean;
}

interface ResidentThread {
	readonly port: AssistanceRuntimeFamilyThreadPort;
	readonly key: string;
	run: ResidentRun | null;
	timer: ReturnType<typeof setTimeout> | null;
	retiring: boolean;
	exited: boolean;
}

/** One resident thread and one native lease, retired before a different authenticated model is admitted. */
function createResidentOnnxSpawner(
	entry: string | URL,
	factory: NonNullable<AssistanceRuntimeFamilyThreadWorkerSpawnerOptions['createWorker']>,
) {
	let resident: ResidentThread | null = null;
	let active: ResidentRun | null = null;
	let retirement = Promise.resolve();

	function settle(run: ResidentRun, error?: Error, value?: unknown): void {
		if (run.done) return;
		run.done = true;
		if (active === run) active = null;
		if (error) run.reject(error); else run.resolve(value);
	}

	function retire(thread: ResidentThread, cooperative = false): Promise<void> {
		if (thread.timer) clearTimeout(thread.timer);
		thread.timer = null;
		if (resident === thread) resident = null;
		if (thread.retiring || thread.exited) return retirement;
		thread.retiring = true;
		retirement = retirement.then(async () => {
			if (cooperative && thread.run && thread.port.postMessage) {
				await stopResidentSpeechThread(thread.port, thread.run.job.jobId);
			} else await thread.port.terminate();
		});
		return retirement;
	}

	function fail(thread: ResidentThread, error: Error): void {
		const run = thread.run;
		if (run && !run.done) run.terminal = { kind: 'error', error };
		void retire(thread).then(() => {
			if (run) settle(run, error);
		}, (cleanup: unknown) => {
			if (run) settle(run, new AggregateError([error, cleanup], 'Resident ONNX retirement failed.', { cause: cleanup }));
		});
	}

	function create(job: AssistanceRuntimeFamilyAdmittedJob, key: string): ResidentThread {
		const port = inspectWorker(factory(entry, job, true));
		if (!port.postMessage) {
			void port.terminate().catch(() => undefined);
			throw new TypeError('Resident ONNX threads require a message port.');
		}
		const thread: ResidentThread = { port, key, run: null, timer: null, retiring: false, exited: false };
		port.on('message', (value: unknown) => {
			if (thread.retiring || thread.exited) return;
			try {
				const run = thread.run;
				if (!run || run.done) throw new Error('The resident thread sent a message outside its request.');
				if (value && typeof value === 'object' && !Array.isArray(value)
					&& (value as { type?: unknown }).type === 'resident-idle') {
					const idle = value as { jobId?: unknown; reusable?: unknown };
					if (Object.keys(value).length !== 3 || idle.jobId !== run.job.jobId || typeof idle.reusable !== 'boolean'
						|| run.terminal?.kind !== 'result' || run.expectExit) throw new Error('The resident idle handshake is invalid.');
					if (!idle.reusable) { run.expectExit = true; return; }
					const result = run.terminal.value;
					thread.run = null;
					settle(run, undefined, result);
					thread.timer = setTimeout(() => { void retire(thread).catch(() => undefined); }, 30_000);
					thread.timer.unref();
					return;
				}
				if (run.terminal) throw new Error('The resident thread repeated its terminal message.');
				const message = validateAssistanceRuntimeFamilyProcessMessageV1(value, requestFrom(run.job));
				if (message.type === 'progress') {
					if (message.sequence !== run.sequence) throw new Error('Resident ONNX progress is out of sequence.');
					run.sequence += 1; run.onProgress(message.value);
				} else if (message.type === 'result') run.terminal = { kind: 'result', value: message.result };
				else if (message.type === 'error') fail(thread, reviveWireError(message.error));
				else throw new Error('The resident thread sent a process-only message.');
			} catch (error) {
				fail(thread, new Error(`The resident ONNX thread violated its protocol: ${errorMessage(error)}`, { cause: error }));
			}
		});
		port.once('error', (error: unknown) => fail(thread, error instanceof Error ? error : new Error(String(error))));
		port.once('exit', (code: unknown) => {
			thread.exited = true;
			if (thread.timer) clearTimeout(thread.timer);
			if (resident === thread) resident = null;
			const run = thread.run;
			if (!run || run.done) return;
			if (run.cancelled) settle(run, new DOMException('The resident ONNX job was cancelled.', 'AbortError'));
			else if (run.terminal?.kind === 'error') settle(run, run.terminal.error);
			else if (run.expectExit && run.terminal?.kind === 'result' && code === 0) settle(run, undefined, run.terminal.value);
			else settle(run, new Error('The resident ONNX thread exited before its authenticated idle handshake.'));
		});
		return thread;
	}

	return (job: AssistanceRuntimeFamilyAdmittedJob, options: Readonly<{ onProgress: (value: number) => void }>): AssistanceRuntimeFamilyInnerWorker => {
		if (active) throw new Error('A resident ONNX job is already active.');
		let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
		const completion = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
		const run: ResidentRun = { job, onProgress: options.onProgress, resolve, reject, sequence: 0,
			terminal: null, expectExit: false, cancelled: false, done: false };
		active = run;
		const key = createHash('sha256').update(JSON.stringify([job.descriptor, job.task, job.grant.settingsJson, job.grant.models])).digest('hex');
		void (async () => {
			if (resident && resident.key !== key) await retire(resident);
			await retirement;
			if (run.cancelled) { settle(run, new DOMException('The resident ONNX job was cancelled.', 'AbortError')); return; }
			const reused = resident;
			if (reused?.timer) clearTimeout(reused.timer);
			const thread = reused ?? create(job, key);
			resident = thread; thread.timer = null; thread.run = run;
			if (reused) thread.port.postMessage?.({ type: 'resident-run', job });
		})().catch((error: unknown) => {
			if (resident?.run === run) fail(resident, error instanceof Error ? error : new Error(String(error)));
			else settle(run, error instanceof Error ? error : new Error(String(error)));
		});
		return Object.freeze({ completion, terminate: async () => {
			if (run.done) return;
			run.cancelled = true;
			const thread = resident?.run === run ? resident : null;
			if (thread) await retire(thread, job.task === 'text-to-speech');
			else await retirement;
			settle(run, new DOMException('The resident ONNX job was cancelled.', 'AbortError'));
		} });
	};
}

function stopResidentSpeechThread(port: AssistanceRuntimeFamilyThreadPort, jobId: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let done = false;
		const settle = (error?: unknown): void => {
			if (done) return; done = true; clearTimeout(timer);
			if (error) reject(error); else resolve();
		};
		port.once('exit', () => settle());
		const timer = setTimeout(() => { void port.terminate().then(() => settle(), settle); }, 1_500);
		try { port.postMessage?.({ type: 'cancel', jobId }); }
		catch { void port.terminate().then(() => settle(), settle); }
	});
}

function validateAdmittedJob(value: AssistanceRuntimeFamilyAdmittedJob): AssistanceRuntimeFamilyAdmittedJob {
	const descriptor = validateAssistanceRuntimeFamilyDescriptorV1(value?.descriptor);
	const request = requestFrom(value);
	if (descriptor.familyId !== request.familyId) {
		throw new TypeError('The runtime-family thread received a foreign runtime descriptor.');
	}
	return Object.freeze({ ...request, descriptor });
}

function requestFrom(value: AssistanceRuntimeFamilyAdmittedJob): AssistanceRuntimeFamilyJobRequestV1 {
	return validateAssistanceRuntimeFamilyJobRequestV1({
		protocolVersion: value?.protocolVersion, jobId: value?.jobId,
		familyId: value?.familyId, task: value?.task,
		maximumRssBytes: value?.maximumRssBytes, maximumDurationMs: value?.maximumDurationMs,
		grant: value?.grant,
	});
}

function validateWorkerEntry(value: unknown): string | URL {
	if (value instanceof URL && value.protocol === 'file:') return value;
	if (typeof value === 'string' && isAbsolute(value) && !value.includes('\0')) return value;
	throw new TypeError('The runtime-family thread entry must be one absolute local file.');
}

function inspectWorker(value: AssistanceRuntimeFamilyThreadPort): AssistanceRuntimeFamilyThreadPort {
	if (!value || typeof value.on !== 'function' || typeof value.once !== 'function'
		|| typeof value.terminate !== 'function') {
		throw new TypeError('The runtime-family thread factory returned an invalid worker.');
	}
	return value;
}

function reviveWireError(value: Readonly<{ name: string; message: string; code: string }>): Error {
	const error = new Error(value.message) as Error & { code?: string };
	error.name = value.name; error.code = value.code;
	return error;
}

function errorMessage(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}
