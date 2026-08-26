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

export type AssistanceRuntimeFamilyModelService = Pick<
	AssistanceService,
	'status' | 'listInstalled' | 'resolveModelPaths'
>;

export interface AssistanceOperationFamilyExecutionOptions {
	readonly request: AssistanceOperationRequest;
	readonly inputPaths: readonly string[];
	readonly models: AssistanceRuntimeFamilyModelService;
	readonly registry: AssistanceStagingRegistry;
	readonly runtime: AssistanceRuntimeFamilyOperationAdapter;
	readonly signal: AbortSignal;
	readonly onProgress?: (value: number) => void;
}

export type AssistanceOperationFamilyExecutionOutcome =
	| AssistanceRuntimeFamilyOperationOutcome
	| Readonly<{ readonly outcome: 'unavailable'; readonly reason: 'model-unavailable' }>;

export interface AssistanceResolvedRuntimeFamilyModel {
	readonly task: AssistanceRuntimeFamilyTask;
	readonly captures: readonly AssistanceRuntimeFamilyModelCapture[];
}

interface AssistanceOperationModelSelection {
	readonly operation: AssistanceOperationRequest['operation'];
	readonly models: readonly AssistanceOperationModelBinding[];
}

const DIRECT_ADDITIONAL_OPERATIONS = new Set<AssistanceOperationRequest['operation']>([
	'word-alignment', 'speech-enhancement', 'source-separation', 'audio-tagging',
	'beat-tracking', 'text-embedding', 'image-text-embedding',
	'optical-character-recognition', 'subject-detection', 'saliency-detection',
	'editorial-generation',
]);
const GIB = 1024 ** 3;
const WAV2VEC2_BASE_960H_SHA256 =
	'b73fe60ddcd3fd07f91d65d50b4f10ba99039104c4fb5db5bdafbb27610bb6eb';
const SUBJECT_MODEL_REQUIREMENTS = Object.freeze([
	Object.freeze({ modelId: 'yunet-face-detection-2026may', version: '2026.5.0',
		task: 'face-detection', artifactSha256s: Object.freeze([
			'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
		]) }),
	Object.freeze({ modelId: 'dfine-nano-coco', version: '1.0.0',
		task: 'object-detection', artifactSha256s: Object.freeze([
			'0f684f409618ee8a822410e754a29caa817d1aa16283ce89cad936d0a48e2f35',
			'a5c7533f3b72be6bb102b93e1b34ca3643af4e0590408a7881543cbb0aa80c4c',
			'cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1',
		].sort()) }),
] as const);
const VISUAL_SINGLE_MODEL_REQUIREMENTS = Object.freeze({
	'image-text-embedding': Object.freeze({ modelId: 'siglip2-base-patch16-224',
		version: '2.0.0', artifactSha256s: Object.freeze([
			'0dd31785a2713f1113ef2272472165c69d580473dae38d7b47568ac587795e70',
			'3a0603d3a00c05a80a6ded4743c16aaac7b1e62cdcc7e362e7ce418659b96400',
			'9b36b57ebaf20f09bf4c22100ccc21877ea6bfe5aead0c00c59f8af8ccefacfc',
			'cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322',
			'e43a9f7692d3819886a82cb2097048258d444f123c67d37ec825f9345b019cf2',
		].sort()) }),
	'optical-character-recognition': Object.freeze({ modelId: 'ppocr-v4-mobile',
		version: '4.0.0', artifactSha256s: Object.freeze([
			'48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b',
			'a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492',
			'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9',
			'e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c',
		].sort()) }),
	'saliency-detection': Object.freeze({ modelId: 'u2netp-saliency', version: '1.0.0',
		artifactSha256s: Object.freeze([
			'309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
		]) }),
} as const);
type ModelStatus = Awaited<ReturnType<AssistanceRuntimeFamilyModelService['status']>>;
type InstalledModels = Awaited<ReturnType<AssistanceRuntimeFamilyModelService['listInstalled']>>;

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
	request: AssistanceOperationModelSelection,
	models: AssistanceRuntimeFamilyModelService,
	signal: AbortSignal,
): Promise<AssistanceResolvedRuntimeFamilyModel | null> {
	const subjectBindings = request.operation === 'subject-detection'
		? exactSubjectBindings(request.models) : null;
	if (subjectBindings === null && request.models.length !== 1) {
		throw new TypeError(`${request.operation} requires one exact additional-runtime model binding.`);
	}
	if (subjectBindings === null && (request.operation === 'audio-tagging'
		|| request.operation === 'beat-tracking')) {
		assertAssistanceOnnxAudioModelBindingV1(request.operation, request.models[0]!);
	}
	if (subjectBindings === null && (request.operation === 'speech-enhancement'
		|| request.operation === 'source-separation')) {
		assertAssistanceOnnxEnhancementSeparationModelBindingV1(
			request.operation, request.models[0]!,
		);
	}
	if (subjectBindings === null && request.operation === 'word-alignment') {
		assertAssistanceWav2Vec2EnglishAlignmentModelBindingV1(request.models[0]!);
	}
	if (subjectBindings === null && request.operation === 'text-embedding') {
		assertAssistanceOnnxTextEmbeddingModelBindingV1(request.models[0]!);
	}
	if (request.operation === 'subject-detection'
		|| request.operation === 'image-text-embedding'
		|| request.operation === 'optical-character-recognition'
		|| request.operation === 'saliency-detection') {
		assertAssistanceOnnxVisualModelBindingsV1(request.operation, request.models);
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

/** Resolve only the pinned, already-installed text tower used by indexed search. */
export async function resolveAssistanceSemanticQueryRuntimeModelV1(
	provider: 'transcript' | 'visual',
	models: AssistanceRuntimeFamilyModelService,
	signal: AbortSignal,
): Promise<AssistanceResolvedRuntimeFamilyModel | null> {
	if (provider !== 'transcript' && provider !== 'visual') {
		throw new TypeError('The semantic-query provider is unsupported.');
	}
	signal.throwIfAborted();
	const requirement = provider === 'transcript'
		? { operation: 'text-embedding' as const, modelId: 'nomic-embed-text-v1.5', version: '1.5.0' }
		: { operation: 'image-text-embedding' as const,
			modelId: 'siglip2-base-patch16-224', version: '2.0.0' };
	const installed = await models.listInstalled();
	signal.throwIfAborted();
	const matches = installed.filter(({ modelId, version }) => modelId === requirement.modelId
		&& version === requirement.version);
	if (matches.length > 1) {
		throw new TypeError('The semantic-query installed model identity is ambiguous.');
	}
	const installation = matches[0];
	if (!installation) return null;
	const binding: AssistanceOperationModelBinding = Object.freeze({
		modelId: requirement.modelId,
		version: requirement.version,
		artifactSha256s: Object.freeze(installation.artifacts.map(({ sha256 }) => sha256).sort()),
	});
	return resolveExactModel(Object.freeze({
		operation: requirement.operation, models: Object.freeze([binding]),
	}), models, signal);
}

/** Close model substitution before status lookup can collapse it into ordinary unavailability. */
export function assertAssistanceOnnxAudioModelBindingV1(
	operation: 'audio-tagging' | 'beat-tracking',
	binding: AssistanceOperationModelBinding,
): void {
	if (operation === 'audio-tagging') {
		if (binding.modelId !== 'panns-cnn10') {
			throw new TypeError('Audio tagging requires the exact PANNs Cnn10 model identity.');
		}
		return;
	}
	if ((binding.modelId !== 'beat-this-small0' && binding.modelId !== 'beat-this-final0')
		|| binding.version !== '1.1.0') {
		throw new TypeError('Beat tracking requires an exact Beat This v1.1.0 model identity.');
	}
}

/** Close enhancement and separation substitution before catalog/status lookup. */
export function assertAssistanceOnnxEnhancementSeparationModelBindingV1(
	operation: 'speech-enhancement' | 'source-separation',
	binding: AssistanceOperationModelBinding,
): void {
	if (operation === 'speech-enhancement') {
		if (binding.modelId !== 'deepfilternet3' || binding.version !== '3.0.0') {
			throw new TypeError('Speech enhancement requires the exact DeepFilterNet3 3.0.0 identity.');
		}
		return;
	}
	if (binding.modelId !== 'tiger-dnr' || binding.version !== '1.0.0') {
		throw new TypeError('Source separation requires the exact TIGER-DnR 1.0.0 identity.');
	}
}

/** Close transcript semantic-search substitution before catalog/status lookup. */
export function assertAssistanceOnnxTextEmbeddingModelBindingV1(
	binding: AssistanceOperationModelBinding,
): void {
	if (binding.modelId !== 'nomic-embed-text-v1.5' || binding.version !== '1.5.0') {
		throw new TypeError('Text embedding requires the exact nomic-embed-text-v1.5 identity.');
	}
}

/** Close English forced-alignment substitution against the existing direct artifact pin. */
export function assertAssistanceWav2Vec2EnglishAlignmentModelBindingV1(
	binding: AssistanceOperationModelBinding,
): void {
	if (binding.modelId !== 'wav2vec2-base-960h'
		|| binding.artifactSha256s.length !== 1
		|| binding.artifactSha256s[0] !== WAV2VEC2_BASE_960H_SHA256) {
		throw new TypeError('Word alignment requires the exact pinned wav2vec2-base-960h revision identity and digest.');
	}
}

/** Close every cataloged visual model and artifact substitution before path resolution. */
export function assertAssistanceOnnxVisualModelBindingsV1(
	operation: 'image-text-embedding' | 'optical-character-recognition'
		| 'subject-detection' | 'saliency-detection',
	bindings: readonly AssistanceOperationModelBinding[],
): void {
	if (operation === 'subject-detection') {
		const exact = exactSubjectBindings(bindings);
		for (let index = 0; index < SUBJECT_MODEL_REQUIREMENTS.length; index += 1) {
			assertPinnedBinding(exact[index]!, SUBJECT_MODEL_REQUIREMENTS[index]!,
				'Subject detection');
		}
		return;
	}
	if (bindings.length !== 1) {
		throw new TypeError(`${operation} requires one exact visual model binding.`);
	}
	assertPinnedBinding(bindings[0]!, VISUAL_SINGLE_MODEL_REQUIREMENTS[operation],
		operation === 'image-text-embedding' ? 'Image/text embedding'
			: operation === 'optical-character-recognition' ? 'OCR' : 'Saliency detection');
}

function assertPinnedBinding(
	binding: AssistanceOperationModelBinding,
	requirement: Readonly<{ modelId: string; version: string; artifactSha256s: readonly string[] }>,
	label: string,
): void {
	if (binding.modelId !== requirement.modelId || binding.version !== requirement.version
		|| JSON.stringify(binding.artifactSha256s)
			!== JSON.stringify(requirement.artifactSha256s)) {
		throw new TypeError(`${label} requires its exact pinned model identity and artifact inventory.`);
	}
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
	models: AssistanceRuntimeFamilyModelService,
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
	request: AssistanceOperationModelSelection,
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
