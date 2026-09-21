/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared authenticated CPU/session/publication mechanics for visual ONNX adapters. */

import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from './assistance-onnx-runtime-worker.ts';
import {
	assertAssistanceOnnxCpuJobV1,
	createAssistanceOnnxCpuSessionV1,
	publishAssistanceOnnxOutputV1,
	reviewAssistanceOnnxRuntimeModuleV1,
} from './assistance-onnx-worker-common.ts';
import type {
	AssistanceRuntimeFamilyModelGrantV1,
	AssistanceRuntimeFamilyTask,
} from './assistance-runtime-family-job-contract.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';

export type AssistanceOnnxVisualRuntimeLoaderV1 = (
	entrypoint: string,
) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;

export function assertAssistanceOnnxVisualRuntimeJobV1(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	task: AssistanceRuntimeFamilyTask,
): void {
	assertAssistanceOnnxCpuJobV1(context, task,
		'The visual adapter received a foreign authenticated CPU job.');
}

export function exactAssistanceOnnxVisualArtifactsV1<Role extends string>(
	models: readonly AssistanceRuntimeFamilyModelGrantV1[],
	modelId: string,
	version: string,
	roles: readonly Role[],
): Readonly<Record<Role, AssistanceRuntimeFamilyModelGrantV1>> {
	if (models.length !== roles.length || models.some((model) =>
		model.modelId !== modelId || model.version !== version)) {
		throw new TypeError(`Visual ONNX execution requires the exact ${modelId} identity.`);
	}
	const result = {} as Record<Role, AssistanceRuntimeFamilyModelGrantV1>;
	for (const role of roles) {
		const matches = models.filter(({ artifactRole }) => artifactRole === role);
		if (matches.length !== 1) {
			throw new TypeError(`The ${modelId} ${role} artifact is missing or ambiguous.`);
		}
		result[role] = matches[0]!;
	}
	return Object.freeze(result);
}

export async function createAssistanceOnnxVisualCpuSessionV1(
	runtime: AssistanceOnnxRuntimeModuleV1,
	modelPath: string,
	inputNames: readonly string[],
	outputNames: readonly string[],
): Promise<AssistanceOnnxInferenceSessionV1> {
	const session = await createAssistanceOnnxCpuSessionV1(runtime, modelPath, {
		value: 'The visual ONNX inference session surface is invalid.',
		surface: 'The visual ONNX inference session surface is invalid.',
	});
	assertAssistanceOnnxNamesV1(session.inputNames, inputNames, 'input');
	assertAssistanceOnnxNamesV1(session.outputNames, outputNames, 'output');
	return session;
}

export function exactAssistanceOnnxOutputsV1(
	value: Readonly<Record<string, AssistanceOnnxTensorV1>>,
	names: readonly string[],
): Readonly<Record<string, AssistanceOnnxTensorV1>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...names].sort())) {
		throw new TypeError('The visual ONNX result tensor inventory is invalid.');
	}
	return value;
}

export function assistanceOnnxRuntimeValueV1(value: unknown): AssistanceOnnxRuntimeModuleV1 {
	return reviewAssistanceOnnxRuntimeModuleV1(value, {
		value: 'The visual ONNX runtime is invalid.',
		surface: 'The visual ONNX runtime surface is invalid.',
	});
}

export async function publishAssistanceOnnxVisualOutputV1(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	body: Uint8Array,
): Promise<unknown> {
	return publishAssistanceOnnxOutputV1(context, body,
		'The visual ONNX result exceeds its exact output reservation.',
		{ exactOutputCount: 1 });
}

function assertAssistanceOnnxNamesV1(
	actual: readonly string[],
	expected: readonly string[],
	kind: string,
): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError(`The visual ONNX graph ${kind} signature is invalid.`);
	}
}
