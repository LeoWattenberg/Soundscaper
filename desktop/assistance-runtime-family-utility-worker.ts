/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reusable utility-process shell that owns exactly one runtime family and one worker at a time. */

import {
	authenticateAssistanceRuntimeFamilyDescriptorFilesV1,
} from './assistance-runtime-family-file-grants.ts';
import type {
	AssistanceRuntimeFamilyAdmittedJob,
	AssistanceRuntimeFamilyJobRequestV1,
} from './assistance-runtime-family-job-contract.ts';
import type { AssistanceRuntimeFamilyDescriptor } from './assistance-runtime-family-manifest.ts';
import {
	serializeAssistanceRuntimeFamilyWireErrorV1,
	validateAssistanceRuntimeFamilyDescriptorV1,
	validateAssistanceRuntimeFamilyHostMessageV1,
	validateAssistanceRuntimeFamilyProcessMessageV1,
} from './assistance-runtime-family-process-protocol.ts';

export interface AssistanceRuntimeFamilyInnerWorker {
	readonly completion: Promise<unknown>;
	/** Resolves only once worker_threads termination has completed. */
	terminate(): Promise<void>;
}

export interface AssistanceRuntimeFamilyUtilityWorker {
	handleMessage(value: unknown): void;
	dispose(code?: number): void;
}

export interface AssistanceRuntimeFamilyUtilityWorkerOptions {
	readonly post: (message: unknown) => void;
	readonly exit: (code: number) => void;
	readonly verifyDescriptor?: (
		descriptor: AssistanceRuntimeFamilyDescriptor,
	) => Promise<AssistanceRuntimeFamilyDescriptor>;
	readonly spawnWorker: (
		job: AssistanceRuntimeFamilyAdmittedJob,
		options: Readonly<{ readonly onProgress: (value: number) => void }>,
	) => AssistanceRuntimeFamilyInnerWorker;
}

type Phase = 'awaiting-initialize' | 'initializing' | 'ready' | 'running' | 'terminating' | 'disposed';

interface ActiveWorker {
	readonly request: AssistanceRuntimeFamilyJobRequestV1;
	readonly worker: AssistanceRuntimeFamilyInnerWorker;
	sequence: number;
	cancelling: boolean;
	settled: boolean;
}

export function createAssistanceRuntimeFamilyUtilityWorker(
	options: AssistanceRuntimeFamilyUtilityWorkerOptions,
): AssistanceRuntimeFamilyUtilityWorker {
	if (!options || typeof options.post !== 'function' || typeof options.exit !== 'function'
		|| typeof options.spawnWorker !== 'function'
		|| options.verifyDescriptor !== undefined && typeof options.verifyDescriptor !== 'function') {
		throw new TypeError('The runtime-family utility worker ports are invalid.');
	}
	const verifyDescriptor = options.verifyDescriptor
		?? authenticateAssistanceRuntimeFamilyDescriptorFilesV1;
	let phase: Phase = 'awaiting-initialize';
	let descriptor: AssistanceRuntimeFamilyDescriptor | null = null;
	let active: ActiveWorker | null = null;
	let exited = false;

	function handleMessage(value: unknown): void {
		if (isDisposed()) return;
		let message;
		try { message = validateAssistanceRuntimeFamilyHostMessageV1(value); }
		catch { failClosed(); return; }
		if (message.type === 'shutdown') {
			void shutdown();
			return;
		}
		if (message.type === 'initialize') {
			if (phase !== 'awaiting-initialize') { failClosed(); return; }
			phase = 'initializing';
			void initialize(message.descriptor);
			return;
		}
		if (message.type === 'job') {
			if (phase !== 'ready' || descriptor === null
				|| message.request.familyId !== descriptor.familyId) {
				failClosed(); return;
			}
			start(message.request, descriptor);
			return;
		}
		if (phase !== 'running' || active === null || message.jobId !== active.request.jobId) {
			failClosed(); return;
		}
		void terminateActive(active);
	}

	async function initialize(expected: AssistanceRuntimeFamilyDescriptor): Promise<void> {
		try {
			const verified = validateAssistanceRuntimeFamilyDescriptorV1(await verifyDescriptor(expected));
			if (JSON.stringify(verified) !== JSON.stringify(expected)) {
				throw new Error('The utility process reopened a different runtime-family payload.');
			}
			if (phase !== 'initializing') return;
			descriptor = verified;
			phase = 'ready';
			send({
				protocolVersion: 1, type: 'ready',
				familyId: verified.familyId, runtimeVersion: verified.runtimeVersion,
			});
		} catch { failClosed(); }
	}

	function start(
		request: AssistanceRuntimeFamilyJobRequestV1,
		verified: AssistanceRuntimeFamilyDescriptor,
	): void {
		phase = 'running';
		let worker: AssistanceRuntimeFamilyInnerWorker;
		try {
			worker = options.spawnWorker(Object.freeze({ ...request, descriptor: verified }), {
				onProgress: (value) => publishProgress(request, value),
			});
			if (!worker || !(worker.completion instanceof Promise) || typeof worker.terminate !== 'function') {
				throw new TypeError('The runtime-family inner worker is not terminateable.');
			}
		} catch (error) {
			phase = 'ready';
			sendError(request, error);
			return;
		}
		const job: ActiveWorker = {
			request, worker, sequence: 0, cancelling: false, settled: false,
		};
		active = job;
		void worker.completion.then(
			(result) => settleCompletion(job, null, result),
			(error: unknown) => settleCompletion(job, error),
		);
	}

	function publishProgress(request: AssistanceRuntimeFamilyJobRequestV1, value: number): void {
		const job = active;
		if (!job || job.request !== request || job.cancelling || job.settled) return;
		try {
			send({
				protocolVersion: 1, type: 'progress', jobId: request.jobId,
				familyId: request.familyId, task: request.task,
				sequence: job.sequence, value,
			}, request);
			job.sequence += 1;
		} catch { failClosed(); }
	}

	function settleCompletion(job: ActiveWorker, error: unknown, result?: unknown): void {
		if (job.settled || active !== job) return;
		job.settled = true;
		active = null;
		if (job.cancelling) return;
		phase = 'ready';
		if (error !== null) sendError(job.request, error);
		else {
			try {
				send({
					protocolVersion: 1, type: 'result', jobId: job.request.jobId,
					familyId: job.request.familyId, task: job.request.task, result,
				}, job.request);
			} catch { failClosed(); }
		}
	}

	async function terminateActive(job: ActiveWorker): Promise<void> {
		if (job.cancelling || job.settled || active !== job) return;
		job.cancelling = true;
		phase = 'terminating';
		try { await job.worker.terminate(); }
		catch { failClosed(); return; }
		if (isDisposed()) return;
		job.settled = true;
		if (active === job) active = null;
		phase = 'ready';
		send({
			protocolVersion: 1, type: 'worker-terminated', jobId: job.request.jobId,
			familyId: job.request.familyId, task: job.request.task,
		}, job.request);
	}

	function sendError(request: AssistanceRuntimeFamilyJobRequestV1, error: unknown): void {
		try {
			send({
				protocolVersion: 1, type: 'error', jobId: request.jobId,
				familyId: request.familyId, task: request.task,
				error: serializeAssistanceRuntimeFamilyWireErrorV1(error),
			}, request);
		} catch { failClosed(); }
	}

	function send(value: unknown, request?: AssistanceRuntimeFamilyJobRequestV1): void {
		if (phase === 'disposed') return;
		options.post(validateAssistanceRuntimeFamilyProcessMessageV1(value, request));
	}

	async function shutdown(): Promise<void> {
		const job = active;
		if (job && !job.settled) {
			job.cancelling = true;
			try { await job.worker.terminate(); } catch { dispose(1); return; }
		}
		dispose(0);
	}

	function failClosed(): void { dispose(1); }
	function isDisposed(): boolean { return phase === 'disposed'; }

	function dispose(code = 0): void {
		if (phase === 'disposed') return;
		phase = 'disposed';
		const job = active;
		active = null;
		if (job && !job.settled) {
			job.cancelling = true;
			try { void Promise.resolve(job.worker.terminate()).catch(() => undefined); }
			catch { /* The containing utility process is exiting. */ }
		}
		if (!exited) { exited = true; options.exit(code); }
	}

	return Object.freeze({ handleMessage, dispose });
}
