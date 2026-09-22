/* SPDX-License-Identifier: AGPL-3.0-only */

/** Generic worker_threads entry; reviewed model math is mounted only through an injected adapter. */

import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';

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

export interface AssistanceRuntimeFamilyInferenceWorkerOptions {
	readonly job: AssistanceRuntimeFamilyAdmittedJob;
	readonly post: (message: unknown) => void;
	readonly signal?: AbortSignal;
	readonly execute?: AssistanceRuntimeFamilyWorkerJobOptions['execute'];
	readonly runJob?: (options: AssistanceRuntimeFamilyWorkerJobOptions) => Promise<unknown>;
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
	if (resourcesPath === undefined) return undefined;
	return createAssistanceKokoroOfflinePhonemizerV1({
		manifestPath: join(resourcesPath, 'app.asar', 'config',
			'assistance-kokoro-g2p-runtime-manifest.json'),
		runtimeRoot: join(resourcesPath, 'runtime'),
	});
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
	const job = workerData as AssistanceRuntimeFamilyAdmittedJob;
	const cancellation = job.task === 'text-to-speech'
		? bindAssistanceRuntimeFamilyCancellationV1(port, job.jobId) : null;
	void runAssistanceRuntimeFamilyInferenceWorkerV1({
		job,
		post: (message) => port.postMessage(message),
		...(cancellation === null ? {} : { signal: cancellation.signal }),
	}).catch(() => { process.exitCode = 1; }).finally(() => {
		cancellation?.dispose();
	});
}
