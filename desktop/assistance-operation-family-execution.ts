/* SPDX-License-Identifier: AGPL-3.0-only */

/** Additional-model resolution and private staging for runtime-family operations. */

import type {
	AssistanceOperationRequest,
} from './assistance-operation-contract.ts';
import type {
	AssistanceRuntimeFamilyOperationAdapter,
	AssistanceRuntimeFamilyOperationOutcome,
} from './assistance-runtime-family-operation-adapter.ts';
import type {
	AssistanceRuntimeFamilyModelCapture,
} from './assistance-runtime-family-file-grants.ts';
import type { AssistanceRuntimeFamilyTask } from './assistance-runtime-family-job-contract.ts';
import type { AssistanceStagingRegistry } from './assistance-staging-registry.ts';
import type { AssistanceService } from './assistance-service.ts';

type ModelService = Pick<AssistanceService, 'status' | 'listInstalled' | 'resolveModelPaths'>;

export interface AssistanceOperationFamilyExecutionOptions {
	readonly request: AssistanceOperationRequest;
	readonly inputPaths: readonly string[];
	readonly models: ModelService;
	readonly registry: AssistanceStagingRegistry;
	readonly runtime: AssistanceRuntimeFamilyOperationAdapter;
	readonly signal: AbortSignal;
	readonly onProgress?: (value: number) => void;
}

export type AssistanceOperationFamilyExecutionOutcome =
	| AssistanceRuntimeFamilyOperationOutcome
	| Readonly<{ readonly outcome: 'unavailable'; readonly reason: 'model-unavailable' }>;

interface ResolvedModel {
	readonly task: AssistanceRuntimeFamilyTask;
	readonly captures: readonly AssistanceRuntimeFamilyModelCapture[];
}

const DIRECT_ADDITIONAL_OPERATIONS = new Set<AssistanceOperationRequest['operation']>([
	'word-alignment', 'speech-enhancement', 'source-separation', 'audio-tagging',
	'beat-tracking', 'text-embedding', 'image-text-embedding',
	'optical-character-recognition', 'subject-detection', 'saliency-detection',
	'editorial-generation',
]);
const GIB = 1024 ** 3;

export function isAssistanceRuntimeFamilyOperationRequest(
	request: AssistanceOperationRequest,
): boolean {
	if (DIRECT_ADDITIONAL_OPERATIONS.has(request.operation)) return true;
	if (request.operation === 'shot-detection') return request.models.length === 1;
	return request.operation === 'speech-recognition' && request.models.length === 1
		&& request.models[0]!.modelId.startsWith('whisper-');
}

export async function executeAssistanceOperationWithRuntimeFamily(
	options: AssistanceOperationFamilyExecutionOptions,
): Promise<AssistanceOperationFamilyExecutionOutcome> {
	options.signal.throwIfAborted();
	if (!isAssistanceRuntimeFamilyOperationRequest(options.request)) {
		throw new TypeError('This assistance operation does not select an additional runtime family.');
	}
	if (options.inputPaths.length !== options.request.inputs.length) {
		throw new TypeError('Runtime-family input paths lost their exact claim geometry.');
	}
	const model = await resolveExactModel(options.request, options.models, options.signal);
	if (model === null) return Object.freeze({ outcome: 'unavailable', reason: 'model-unavailable' });
	const outputPaths = await Promise.all(options.request.outputs.map((reservation) =>
		options.registry.resolveOutputReservationPathForMain(
			options.request.jobId, reservation, options.signal,
		)));
	const limits = resourceLimits(model.task);
	return options.runtime.run({
		jobId: options.request.jobId,
		task: model.task,
		settings: Object.freeze({
			schemaVersion: 1,
			operation: options.request.operation,
			selectionFence: options.request.selectionFence,
			inputRoles: Object.freeze(options.request.inputs.map(({ role }) => role)),
			outputRoles: Object.freeze(options.request.outputs.map(({ role }) => role)),
		}),
		maximumRssBytes: limits.maximumRssBytes,
		maximumDurationMs: limits.maximumDurationMs,
		inputs: Object.freeze(options.request.inputs.map((claim, index) => Object.freeze({
			claim,
			path: options.inputPaths[index]!,
		}))),
		models: model.captures,
		outputs: Object.freeze(options.request.outputs.map((reservation, index) => Object.freeze({
			reservation,
			path: outputPaths[index]!,
		}))),
		signal: options.signal,
		onProgress: options.onProgress,
	});
}

async function resolveExactModel(
	request: AssistanceOperationRequest,
	models: ModelService,
	signal: AbortSignal,
): Promise<ResolvedModel | null> {
	if (request.models.length !== 1) {
		throw new TypeError(`${request.operation} requires one exact additional-runtime model binding.`);
	}
	const binding = request.models[0]!;
	const [status, installed] = await Promise.all([models.status(), models.listInstalled()]);
	signal.throwIfAborted();
	const view = status.models.find((candidate) => candidate.modelId === binding.modelId
		&& candidate.version === binding.version);
	if (!view || view.availability !== 'installed') return null;
	const task = taskFor(request, view.task, binding.modelId);
	const installation = installed.find((candidate) => candidate.modelId === binding.modelId
		&& candidate.version === binding.version);
	if (!installation) return null;
	const expectedDigests = installation.artifacts.map(({ sha256 }) => sha256).sort();
	if (expectedDigests.length !== binding.artifactSha256s.length
		|| expectedDigests.some((digest, index) => digest !== binding.artifactSha256s[index])) {
		throw new Error('The runtime-family model binding disagrees with its installed artifact inventory.');
	}
	let paths: Readonly<Record<string, string>>;
	try { paths = await models.resolveModelPaths(binding.modelId); }
	catch (error) { if (modelUnavailable(error)) return null; throw error; }
	signal.throwIfAborted();
	const captures = installation.artifacts.map((artifact) => {
		const artifactRole = artifact.fileName.split('.')[0]!;
		const path = paths[artifactRole];
		if (typeof path !== 'string' || path === '') {
			throw new Error(`The runtime-family model artifact role ${artifactRole} has no authenticated path.`);
		}
		return Object.freeze({
			modelId: binding.modelId,
			version: binding.version,
			artifactRole,
			path,
			byteLength: artifact.byteLength,
			sha256: artifact.sha256,
		});
	});
	if (new Set(captures.map(({ artifactRole }) => artifactRole)).size !== captures.length) {
		throw new TypeError('The runtime-family model artifact roles are ambiguous.');
	}
	return Object.freeze({ task, captures: Object.freeze(captures) });
}

function taskFor(
	request: AssistanceOperationRequest,
	modelTask: string,
	modelId: string,
): AssistanceRuntimeFamilyTask {
	if (request.operation === 'subject-detection') {
		if (modelTask === 'face-detection' || modelTask === 'object-detection') return modelTask;
		throw new TypeError('Subject detection requires an exact face- or object-detection model role.');
	}
	if (request.operation === 'speech-recognition') {
		if (modelTask === 'speech-recognition' && modelId.startsWith('whisper-')) return modelTask;
		throw new TypeError('The whisper.cpp route requires an exact Whisper speech model role.');
	}
	if (modelTask !== request.operation) {
		throw new TypeError(`The ${request.operation} operation received the wrong model task role.`);
	}
	return modelTask as AssistanceRuntimeFamilyTask;
}

function resourceLimits(task: AssistanceRuntimeFamilyTask): Readonly<{
	maximumRssBytes: number;
	maximumDurationMs: number;
}> {
	return Object.freeze({
		maximumRssBytes: task === 'editorial-generation' ? 12 * GIB : 8 * GIB,
		maximumDurationMs: 4 * 60 * 60_000,
	});
}

function modelUnavailable(error: unknown): boolean {
	return error instanceof Error
		&& /is not installed|does not match the current authenticated catalog entry|failed its integrity check/u
			.test(error.message);
}
