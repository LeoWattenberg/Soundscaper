/* SPDX-License-Identifier: AGPL-3.0-only */

/** Additional-model resolution and private staging for runtime-family operations. */

import type {
	AssistanceOperationModelBinding,
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
const SUBJECT_MODEL_REQUIREMENTS = Object.freeze([
	Object.freeze({ modelId: 'yunet-face-detection-2026may', task: 'face-detection' }),
	Object.freeze({ modelId: 'dfine-nano-coco', task: 'object-detection' }),
] as const);
type ModelStatus = Awaited<ReturnType<ModelService['status']>>;
type InstalledModels = Awaited<ReturnType<ModelService['listInstalled']>>;

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
	const subjectBindings = request.operation === 'subject-detection'
		? exactSubjectBindings(request.models) : null;
	if (subjectBindings === null && request.models.length !== 1) {
		throw new TypeError(`${request.operation} requires one exact additional-runtime model binding.`);
	}
	const [status, installed] = await Promise.all([models.status(), models.listInstalled()]);
	signal.throwIfAborted();
	if (subjectBindings !== null) {
		const captures: AssistanceRuntimeFamilyModelCapture[] = [];
		for (let index = 0; index < SUBJECT_MODEL_REQUIREMENTS.length; index += 1) {
			const requirement = SUBJECT_MODEL_REQUIREMENTS[index]!;
			const binding = subjectBindings[index]!;
			const view = exactInstalledView(binding, status);
			if (view === null) return null;
			if (view.task !== requirement.task) {
				throw new TypeError(`Subject detection requires ${requirement.modelId} to carry the exact ${requirement.task} model task role.`);
			}
			const modelCaptures = await resolveModelCaptures(binding, installed, models, signal);
			if (modelCaptures === null) return null;
			captures.push(...modelCaptures);
		}
		return Object.freeze({ task: 'subject-detection', captures: Object.freeze(captures) });
	}
	const binding = request.models[0]!;
	const view = exactInstalledView(binding, status);
	if (view === null) return null;
	const task = taskForSingleModel(request, view.task, binding.modelId);
	const captures = await resolveModelCaptures(binding, installed, models, signal);
	if (captures === null) return null;
	return Object.freeze({ task, captures });
}

function exactSubjectBindings(
	bindings: readonly AssistanceOperationModelBinding[],
): readonly AssistanceOperationModelBinding[] {
	if (bindings.length !== SUBJECT_MODEL_REQUIREMENTS.length
		|| SUBJECT_MODEL_REQUIREMENTS.some((requirement) =>
			bindings.filter(({ modelId }) => modelId === requirement.modelId).length !== 1)) {
		throw new TypeError('Subject detection requires the exact YuNet face-detection and D-FINE object-detection bindings.');
	}
	return Object.freeze(SUBJECT_MODEL_REQUIREMENTS.map((requirement) =>
		bindings.find(({ modelId }) => modelId === requirement.modelId)!));
}

function exactInstalledView(
	binding: AssistanceOperationModelBinding,
	status: ModelStatus,
): ModelStatus['models'][number] | null {
	const matches = status.models.filter((candidate) => candidate.modelId === binding.modelId
		&& candidate.version === binding.version);
	if (matches.length > 1) {
		throw new TypeError('The runtime-family model status has an ambiguous exact catalog binding.');
	}
	const view = matches[0];
	return view?.availability === 'installed' ? view : null;
}

async function resolveModelCaptures(
	binding: AssistanceOperationModelBinding,
	installed: InstalledModels,
	models: ModelService,
	signal: AbortSignal,
): Promise<readonly AssistanceRuntimeFamilyModelCapture[] | null> {
	const installations = installed.filter((candidate) => candidate.modelId === binding.modelId
		&& candidate.version === binding.version);
	if (installations.length > 1) {
		throw new TypeError('The runtime-family model installation inventory is ambiguous.');
	}
	const installation = installations[0];
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
	return Object.freeze(captures);
}

function taskForSingleModel(
	request: AssistanceOperationRequest,
	modelTask: string,
	modelId: string,
): AssistanceRuntimeFamilyTask {
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
