/* SPDX-License-Identifier: AGPL-3.0-only */

/** Generic worker_threads entry; reviewed model math is mounted only through an injected adapter. */

import { parentPort, workerData } from 'node:worker_threads';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	validateAssistanceRuntimeFamilyJobRequestV1,
	type AssistanceRuntimeFamilyAdmittedJob,
	type AssistanceRuntimeFamilyJobRequestV1,
} from './assistance-runtime-family-job-contract.ts';
import {
	serializeAssistanceRuntimeFamilyWireErrorV1,
	validateAssistanceRuntimeFamilyDescriptorV1,
	validateAssistanceRuntimeFamilyProcessMessageV1,
} from './assistance-runtime-family-process-protocol.ts';
import {
	runAssistanceRuntimeFamilyWorkerJobV1,
	unavailableAssistanceRuntimeFamilyWorkerAdapter,
	type AssistanceRuntimeFamilyWorkerJobOptions,
} from './assistance-runtime-family-worker-entry.ts';
import {
	createAssistanceOnnxRuntimeWorkerAdapterV1,
} from './assistance-onnx-runtime-worker.ts';
import { createAssistanceKokoroOfflinePhonemizerV1 } from './assistance-kokoro-g2p-runtime.ts';
import { bindAssistanceRuntimeFamilyCancellationV1 } from './assistance-runtime-family-cancellation.ts';
import { authenticateAssistanceRuntimeFamilyDescriptorFilesV1 } from './assistance-runtime-family-file-grants.ts';
import { createAssistanceOnnxSessionLeaseCacheV1, type AssistanceOnnxSessionLeaseCacheV1 } from './assistance-onnx-worker-common.ts';

export interface AssistanceRuntimeFamilyInferenceWorkerOptions {
	readonly job: AssistanceRuntimeFamilyAdmittedJob;
	readonly post: (message: unknown) => void;
	readonly signal?: AbortSignal;
	readonly execute?: AssistanceRuntimeFamilyWorkerJobOptions['execute'];
	readonly runJob?: (options: AssistanceRuntimeFamilyWorkerJobOptions) => Promise<unknown>;
	readonly sessionCache?: AssistanceOnnxSessionLeaseCacheV1;
}

export async function runAssistanceRuntimeFamilyInferenceWorkerV1(
	options: AssistanceRuntimeFamilyInferenceWorkerOptions,
): Promise<void> {
	if (!options || typeof options.post !== 'function'
		|| options.execute !== undefined && typeof options.execute !== 'function'
		|| options.runJob !== undefined && typeof options.runJob !== 'function') {
		throw new TypeError('The runtime-family inference-worker ports are invalid.');
	}
	const job = validateAdmittedJob(options.job);
	const request = requestFrom(job);
	const runJob = options.runJob ?? runAssistanceRuntimeFamilyWorkerJobV1;
	const execute = options.execute ?? (job.familyId === 'onnxruntime-node'
		? createAssistanceOnnxRuntimeWorkerAdapterV1({
			sessionCache: options.sessionCache,
			...(job.task === 'text-to-speech' ? {
				phonemizeKokoro: packagedKokoroPhonemizer(),
			} : {}),
		})
		: unavailableAssistanceRuntimeFamilyWorkerAdapter);
	let sequence = 0;
	const send = (message: unknown): void => {
		options.post(validateAssistanceRuntimeFamilyProcessMessageV1(message, request));
	};
	try {
		if (options.sessionCache) {
			await authenticateAssistanceRuntimeFamilyDescriptorFilesV1(job.descriptor, options.signal);
			options.signal?.throwIfAborted();
		}
		const result = await runJob({
			job,
			execute,
			...(options.signal === undefined ? {} : { signal: options.signal }),
			onProgress: (value) => {
				send({
					protocolVersion: 1, type: 'progress', jobId: request.jobId,
					familyId: request.familyId, task: request.task, sequence, value,
				});
				sequence += 1;
			},
		});
		send({
			protocolVersion: 1, type: 'result', jobId: request.jobId,
			familyId: request.familyId, task: request.task, result,
		});
	} catch (error) {
		await options.sessionCache?.dispose();
		send({
			protocolVersion: 1, type: 'error', jobId: request.jobId,
			familyId: request.familyId, task: request.task,
			error: serializeAssistanceRuntimeFamilyWireErrorV1(error),
		});
	}
}

function packagedKokoroPhonemizer() {
	const resourcesPath = (process as typeof process & { readonly resourcesPath?: string })
		.resourcesPath;
	const manifestPath = packagedKokoroManifestPath(fileURLToPath(import.meta.url));
	if (resourcesPath === undefined || manifestPath === undefined) return undefined;
	return createAssistanceKokoroOfflinePhonemizerV1({
		manifestPath,
		runtimeRoot: process.env.SOUNDSCAPER_ASSISTANCE_RUNTIME_ROOT
			?? join(resourcesPath, 'runtime'),
	});
}

export function packagedKokoroManifestPath(workerPath: string): string | undefined {
	let directory = dirname(workerPath);
	while (true) {
		if (basename(directory).endsWith('.asar')) {
			return join(directory, 'config', 'assistance-kokoro-g2p-runtime-manifest.json');
		}
		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

function validateAdmittedJob(value: AssistanceRuntimeFamilyAdmittedJob): AssistanceRuntimeFamilyAdmittedJob {
	const descriptor = validateAssistanceRuntimeFamilyDescriptorV1(value?.descriptor);
	const request = requestFrom(value);
	if (descriptor.familyId !== request.familyId) {
		throw new TypeError('The runtime-family inference worker received a foreign descriptor.');
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

if (parentPort !== null) {
	const port = parentPort;
	const data: unknown = workerData;
	if (data && typeof data === 'object' && !Array.isArray(data)
		&& Object.keys(data).length === 2 && (data as { residentOnnx?: unknown }).residentOnnx === true
		&& 'job' in data) {
		bindResidentOnnxThread(port, validateAdmittedJob(data.job as AssistanceRuntimeFamilyAdmittedJob));
	} else {
		const job = validateAdmittedJob(data as AssistanceRuntimeFamilyAdmittedJob);
		const cancellation = job.task === 'text-to-speech'
			? bindAssistanceRuntimeFamilyCancellationV1(port, job.jobId) : null;
		void runAssistanceRuntimeFamilyInferenceWorkerV1({
			job, post: (message) => port.postMessage(message),
			...(cancellation === null ? {} : { signal: cancellation.signal }),
		}).catch(() => { process.exitCode = 1; }).finally(() => { cancellation?.dispose(); });
	}
}

function bindResidentOnnxThread(port: NonNullable<typeof parentPort>, initial: AssistanceRuntimeFamilyAdmittedJob): void {
	if (initial.familyId !== 'onnxruntime-node') throw new TypeError('Only ONNX jobs may retain an inner thread.');
	const cache = createAssistanceOnnxSessionLeaseCacheV1();
	let busy = false;
	let closed = false;
	let currentJobId: string | null = null;
	async function close(code = 0): Promise<void> {
		closed = true;
		let exitCode = code;
		try { await cache.dispose(); }
		catch { exitCode = 1; }
		finally { process.exitCode = exitCode; port.close(); }
	}
	async function run(job: AssistanceRuntimeFamilyAdmittedJob): Promise<void> {
		if (busy || closed || job.familyId !== 'onnxruntime-node') throw new Error('Resident ONNX requests must be serial and task-bound.');
		busy = true;
		currentJobId = job.jobId;
		const cancellation = bindAssistanceRuntimeFamilyCancellationV1(port, job.jobId);
		let succeeded = false;
		try {
			await runAssistanceRuntimeFamilyInferenceWorkerV1({ job, sessionCache: cache,
				signal: cancellation.signal, post: (message) => {
					const checked = validateAssistanceRuntimeFamilyProcessMessageV1(message, requestFrom(job));
					if (checked.type === 'result') succeeded = true;
					port.postMessage(checked);
				},
			});
			const reusable = succeeded && !cancellation.signal.aborted && cache.idleSessionCount === 1;
			if (succeeded) port.postMessage({ type: 'resident-idle', jobId: job.jobId, reusable });
			if (!reusable) await close();
		} catch { await close(1); }
		finally { cancellation.dispose(); busy = false; currentJobId = null; }
	}
	port.on('message', (value: unknown) => {
		if (closed) return;
		try {
			if (value && typeof value === 'object' && !Array.isArray(value)
				&& Object.keys(value).length === 2 && (value as { type?: unknown }).type === 'cancel'
				&& busy && (value as { jobId?: unknown }).jobId === currentJobId) return;
			if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2
				|| (value as { type?: unknown }).type !== 'resident-run' || !('job' in value) || busy) {
				throw new Error('The resident ONNX request message is invalid.');
			}
			void run(validateAdmittedJob(value.job as AssistanceRuntimeFamilyAdmittedJob)).catch(() => { void close(1); });
		} catch { void close(1); }
	});
	void run(initial).catch(() => { void close(1); });
}
