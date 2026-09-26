/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned bridge from primitive operations to one authenticated runtime family. */

import {
	captureAssistanceRuntimeFamilyJobGrantV1,
	type AssistanceRuntimeFamilyInputCapture,
	type AssistanceRuntimeFamilyModelCapture,
	type AssistanceRuntimeFamilyOutputCapture,
} from './assistance-runtime-family-file-grants.ts';
import {
	AssistanceRuntimeFamilyError,
	type AssistanceRuntimeFamilyErrorCode,
	type AssistanceRuntimeFamilyRunOptions,
} from './assistance-runtime-family-host.ts';
import {
	validateAssistanceRuntimeFamilyJobResultV1,
	type AssistanceRuntimeFamilyJobRequestV1,
	type AssistanceRuntimeFamilyResultOutputV1,
	type AssistanceRuntimeFamilyTask,
} from './assistance-runtime-family-job-contract.ts';
import type { AssistanceRuntimeFamilyId } from './assistance-runtime-family-manifest.ts';

const ONNX_TASKS = new Set<AssistanceRuntimeFamilyTask>([
	'word-alignment', 'speech-enhancement', 'dereverberation', 'source-separation',
	'audio-tagging', 'beat-tracking', 'text-embedding', 'image-text-embedding',
	'optical-character-recognition', 'shot-detection', 'subject-detection',
	'saliency-detection',
	'text-to-speech',
]);
const MAXIMUM_SETTINGS_DEPTH = 16;
const MAXIMUM_SETTINGS_NODES = 1_024;

export interface AssistanceRuntimeFamilyOperationRequest {
	readonly jobId: string;
	readonly task: AssistanceRuntimeFamilyTask;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly maximumRssBytes: number;
	readonly maximumDurationMs: number;
	readonly inputs: readonly AssistanceRuntimeFamilyInputCapture[];
	readonly models: readonly AssistanceRuntimeFamilyModelCapture[];
	readonly outputs: readonly AssistanceRuntimeFamilyOutputCapture[];
	readonly signal?: AbortSignal;
	readonly onProgress?: (value: number) => void;
}

export type AssistanceRuntimeFamilyOperationOutcome = Readonly<{
	readonly outcome: 'completed';
	readonly outputs: readonly AssistanceRuntimeFamilyResultOutputV1[];
}> | Readonly<{
	readonly outcome: 'unavailable';
	readonly reason: 'adapter-unavailable' | 'runtime-unavailable';
}>;

export interface AssistanceRuntimeFamilyOperationAdapter {
	run(request: AssistanceRuntimeFamilyOperationRequest): Promise<AssistanceRuntimeFamilyOperationOutcome>;
}

export interface AssistanceRuntimeFamilyOperationAdapterOptions {
	readonly router: Readonly<{
		run(value: unknown, options?: AssistanceRuntimeFamilyRunOptions): Promise<unknown>;
	}>;
	readonly beforeRun?: (request: AssistanceRuntimeFamilyOperationRequest) => Promise<void>;
	readonly onRuntimeFailure?: (diagnostic: AssistanceRuntimeFamilyFailureDiagnostic) => void;
}

export interface AssistanceRuntimeFamilyFailureDiagnostic {
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly task: AssistanceRuntimeFamilyTask;
	readonly code: AssistanceRuntimeFamilyErrorCode;
	readonly stage: 'router' | 'cli-start' | 'cli-execute' | 'cli-exit'
		| 'cli-stdout-bound' | 'cli-stderr-bound' | 'output-review' | 'worker'
		| 'resource-duration' | 'resource-rss' | 'resource-sample';
	readonly exitCode: number | null;
}

/** A closed, pathless failure summary suitable for nightly process logs. */
export function assistanceRuntimeFamilyFailureDiagnostic(
	error: AssistanceRuntimeFamilyError,
	task: AssistanceRuntimeFamilyTask,
): AssistanceRuntimeFamilyFailureDiagnostic {
	const message = error.message;
	let stage: AssistanceRuntimeFamilyFailureDiagnostic['stage'] = 'router';
	let exitCode: number | null = null;
	if (error.code === 'runtime-exit') {
		const match = /exited unexpectedly with code (-?\d+)\./u.exec(message);
		if (match) {
			const parsed = Number(match[1]);
			if (Number.isSafeInteger(parsed)) exitCode = parsed;
		}
	} else if (error.code === 'resource-violation') {
		if (message === 'The runtime-family job exceeded its admitted duration.') {
			stage = 'resource-duration';
		} else if (message === 'The runtime-family process exceeded its admitted resident-set limit.') {
			stage = 'resource-rss';
		} else if (message === 'The runtime-family process RSS could not be sampled.') {
			stage = 'resource-sample';
		}
	} else if (error.code === 'worker-error') {
		stage = 'worker';
		if (message.startsWith('The authenticated llama.cpp CLI could not be started.')) {
			stage = 'cli-start';
		} else if (message.startsWith('The authenticated llama.cpp CLI failed to execute.')) {
			stage = 'cli-execute';
		} else if (message.startsWith('The authenticated llama.cpp CLI did not complete successfully')) {
			stage = 'cli-exit';
			const match = /\(exit code (-?\d+)\)/u.exec(message);
			if (match) {
				const parsed = Number(match[1]);
				if (Number.isSafeInteger(parsed)) exitCode = parsed;
			}
		} else if (message.startsWith('The llama.cpp stdout exceeded its authenticated output bound.')) {
			stage = 'cli-stdout-bound';
		} else if (message.startsWith('The llama.cpp diagnostic output exceeded its bound.')) {
			stage = 'cli-stderr-bound';
		} else if (message === 'The llama.cpp editorial output failed closed review.') {
			stage = 'output-review';
		}
	}
	return Object.freeze({ familyId: error.familyId, task, code: error.code, stage, exitCode });
}

export function runtimeFamilyForAssistanceTask(
	taskValue: unknown,
): AssistanceRuntimeFamilyId {
	if (typeof taskValue !== 'string') {
		throw new RangeError('The additional runtime-family task is unsupported.');
	}
	const task = taskValue as AssistanceRuntimeFamilyTask;
	if (ONNX_TASKS.has(task)) return 'onnxruntime-node';
	if (task === 'speech-recognition') return 'whisper-cpp';
	if (task === 'editorial-generation') return 'llama-cpp';
	throw new RangeError(`${task} is not an additional runtime-family task.`);
}

export function createAssistanceRuntimeFamilyOperationAdapter(
	options: AssistanceRuntimeFamilyOperationAdapterOptions,
): AssistanceRuntimeFamilyOperationAdapter {
	if (!options || !options.router || typeof options.router.run !== 'function') {
		throw new TypeError('The runtime-family operation adapter needs one router.');
	}
	if (options.onRuntimeFailure !== undefined && typeof options.onRuntimeFailure !== 'function') {
		throw new TypeError('The runtime-family failure reporter is invalid.');
	}
	return Object.freeze({
		async run(request: AssistanceRuntimeFamilyOperationRequest) {
			request.signal?.throwIfAborted();
			const familyId = runtimeFamilyForAssistanceTask(request.task);
			await options.beforeRun?.(request);
			request.signal?.throwIfAborted();
			const settingsJson = canonicalSettings(request.settings);
			const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
				jobId: request.jobId,
				familyId,
				task: request.task,
				settingsJson,
				inputs: request.inputs,
				models: request.models,
				outputs: request.outputs,
				signal: request.signal,
			});
			const familyRequest: AssistanceRuntimeFamilyJobRequestV1 = Object.freeze({
				protocolVersion: 1,
				jobId: request.jobId,
				familyId,
				task: request.task,
				maximumRssBytes: request.maximumRssBytes,
				maximumDurationMs: request.maximumDurationMs,
				grant,
			});
			try {
				const value = await options.router.run(familyRequest, {
					signal: request.signal,
					onProgress: request.onProgress,
				});
				const result = validateAssistanceRuntimeFamilyJobResultV1(value, grant);
				return Object.freeze({ outcome: 'completed' as const, outputs: result.outputs });
			} catch (error) {
				request.signal?.throwIfAborted();
				if (!(error instanceof AssistanceRuntimeFamilyError)) throw error;
				try {
					options.onRuntimeFailure?.(assistanceRuntimeFamilyFailureDiagnostic(error, request.task));
				} catch { /* Diagnostics cannot change an operation outcome. */ }
				if (error.code === 'cancelled' || error.code === 'cancellation-timeout') throw error;
				if (error.code === 'worker-error' && /adapter.*unavailable|no reviewed model adapter/iu
					.test(error.message)) {
					return Object.freeze({ outcome: 'unavailable' as const,
						reason: 'adapter-unavailable' as const });
				}
				if (error.code === 'invalid-request' || error.code === 'unsupported-task'
					|| error.code === 'malformed-message') throw error;
				return Object.freeze({ outcome: 'unavailable' as const,
					reason: 'runtime-unavailable' as const });
			}
		},
	});
}

function canonicalSettings(value: unknown): string {
	let nodes = 0;
	const normalize = (candidate: unknown, depth: number): unknown => {
		if (depth > MAXIMUM_SETTINGS_DEPTH || ++nodes > MAXIMUM_SETTINGS_NODES) {
			throw new RangeError('Runtime-family operation settings exceed their structural bound.');
		}
		if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') {
			return candidate;
		}
		if (typeof candidate === 'number') {
			if (!Number.isFinite(candidate)) {
				throw new TypeError('Runtime-family operation settings numbers must be finite.');
			}
			return candidate;
		}
		if (Array.isArray(candidate)) {
			if (Reflect.ownKeys(candidate).length !== candidate.length + 1) {
				throw new TypeError('Runtime-family operation settings arrays must be dense.');
			}
			return candidate.map((entry) => normalize(entry, depth + 1));
		}
		if (!candidate || typeof candidate !== 'object' || ArrayBuffer.isView(candidate)
			|| Object.getPrototypeOf(candidate) !== Object.prototype) {
			throw new TypeError('Runtime-family operation settings must contain only plain JSON values.');
		}
		const record = candidate as Readonly<Record<string, unknown>>;
		return Object.fromEntries(Object.keys(record).sort().map((key) => [
			key,
			normalize(record[key], depth + 1),
		]));
	};
	const normalized = normalize(value, 0);
	if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
		throw new TypeError('Runtime-family operation settings must be one plain record.');
	}
	return JSON.stringify(normalized);
}
