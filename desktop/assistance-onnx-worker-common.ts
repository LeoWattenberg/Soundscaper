/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared CPU-session, runtime-validation, and single-output ONNX worker mechanics. */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
} from './assistance-onnx-runtime-worker.ts';
import type {
	AssistanceRuntimeFamilyJobResultV1,
} from './assistance-runtime-family-job-contract.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';

export interface AssistanceOnnxSurfaceErrorsV1 {
	readonly value: string;
	readonly surface: string;
}

export interface AssistanceOnnxOutputPublicationOptionsV1 {
	readonly exactOutputCount?: number;
}

export function reviewAssistanceOnnxRuntimeModuleV1(
	value: unknown,
	errors: AssistanceOnnxSurfaceErrorsV1,
): AssistanceOnnxRuntimeModuleV1 {
	if (!value || typeof value !== 'object') throw new TypeError(errors.value);
	const candidate = value as Partial<AssistanceOnnxRuntimeModuleV1>;
	if (typeof candidate.Tensor !== 'function' || !candidate.InferenceSession
		|| typeof candidate.InferenceSession.create !== 'function') {
		throw new TypeError(errors.surface);
	}
	return candidate as AssistanceOnnxRuntimeModuleV1;
}

export async function createAssistanceOnnxCpuSessionV1(
	runtime: AssistanceOnnxRuntimeModuleV1,
	modelPath: string,
	errors: AssistanceOnnxSurfaceErrorsV1,
): Promise<AssistanceOnnxInferenceSessionV1> {
	const value = await runtime.InferenceSession.create(modelPath, {
		executionProviders: ['cpu'], graphOptimizationLevel: 'all',
		interOpNumThreads: 1, intraOpNumThreads: 4,
	});
	if (!value || typeof value !== 'object') throw new TypeError(errors.value);
	const session = value as Partial<AssistanceOnnxInferenceSessionV1>;
	if (!Array.isArray(session.inputNames) || !Array.isArray(session.outputNames)
		|| typeof session.run !== 'function'
		|| session.release !== undefined && typeof session.release !== 'function') {
		throw new TypeError(errors.surface);
	}
	return session as AssistanceOnnxInferenceSessionV1;
}

export async function publishAssistanceOnnxOutputV1(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	bodyValue: Uint8Array | (() => Uint8Array),
	reservationError: string,
	options: AssistanceOnnxOutputPublicationOptionsV1 = {},
): Promise<AssistanceRuntimeFamilyJobResultV1> {
	context.signal?.throwIfAborted();
	const body = typeof bodyValue === 'function' ? bodyValue() : bodyValue;
	const output = context.grant.outputs[0]!;
	if (options.exactOutputCount !== undefined
		&& context.grant.outputs.length !== options.exactOutputCount
		|| body.byteLength < 1 || body.byteLength > output.maximumByteLength) {
		throw new RangeError(reservationError);
	}
	await writeFile(output.path, body);
	context.signal?.throwIfAborted();
	context.onProgress(1);
	return Object.freeze({
		resultVersion: 1, jobId: context.grant.jobId,
		familyId: context.grant.familyId, task: context.grant.task,
		outputs: Object.freeze([Object.freeze({
			claimId: output.claimId, role: output.role, mediaType: output.mediaType,
			byteLength: body.byteLength,
			sha256: createHash('sha256').update(body).digest('hex'),
		})]),
	});
}
