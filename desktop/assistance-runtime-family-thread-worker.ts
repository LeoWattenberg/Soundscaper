/* SPDX-License-Identifier: AGPL-3.0-only */

/** One authenticated job per terminateable worker_threads instance. */

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
	terminate(): Promise<number>;
}

export interface AssistanceRuntimeFamilyThreadWorkerSpawnerOptions {
	readonly workerEntry: string | URL;
	readonly createWorker?: (
		entry: string | URL,
		job: AssistanceRuntimeFamilyAdmittedJob,
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
	const createWorker = options.createWorker ?? ((entry, job) => (
		new Worker(entry, { workerData: job }) as AssistanceRuntimeFamilyThreadPort
	));
	return (jobValue, runOptions) => {
		if (!runOptions || typeof runOptions.onProgress !== 'function') {
			throw new TypeError('The runtime-family thread progress port is invalid.');
		}
		const job = validateAdmittedJob(jobValue);
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
			try { void worker.terminate().catch(() => undefined); }
			catch { /* The captured protocol error remains authoritative. */ }
		}

		function terminate(): Promise<void> {
			if (exited) return Promise.resolve();
			if (termination) return termination;
			terminating = true;
			try { termination = Promise.resolve(worker.terminate()).then(() => undefined); }
			catch (error) { termination = Promise.reject(error); }
			return termination;
		}

		return Object.freeze({ completion, terminate });
	};
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
