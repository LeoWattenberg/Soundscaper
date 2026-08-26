/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { AssistanceOperation } from '../assistance/operation.ts';
import {
	createAssistanceAssetReferenceV1,
	type AssistanceTranscriptAssetReferenceV1,
} from '../assistance/assistance-asset-reference-v1.ts';
import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceGuidedWorkflowId,
	type AssistanceWorkflowClaimV1,
	type AssistanceWorkflowFenceV1,
	type AssistanceWorkflowModelBindingV1,
	type AssistanceWorkflowSourceRangeV1,
	type AssistanceWorkflowStageSpec,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import type {
	AssistanceWorkflowCustodyClaimV1,
} from '../assistance/workflow-custody-v1.ts';
import {
	serializeAssistanceWorkflowSettingsV1,
	validateAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from '../assistance/workflow-settings-v1.ts';
import type { LocalAssistanceModel } from '../ui/local-assistance-bridge.ts';
import type {
	LocalAssistanceWorkflowCustodyBridge,
} from '../ui/local-assistance-workflow-bridge.ts';
import type {
	LocalAssistanceGuidedPreparationUnavailableReason,
} from '../ui/local-assistance-preparation.ts';

const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,126}[a-z\d])?$/u;
const AUDIO_OPERATIONS = new Set<AssistanceOperation>([
	'voice-activity-detection', 'speech-recognition', 'speaker-diarization',
	'speech-enhancement', 'source-separation', 'audio-tagging', 'beat-tracking',
]);
export type {
	LocalAssistanceGuidedPreparationUnavailableReason,
} from '../ui/local-assistance-preparation.ts';
export interface LocalAssistanceAggregateCustodyHandle {
	readonly custody: AssistanceWorkflowCustodyClaimV1;
	readonly workflowClaim: AssistanceWorkflowClaimV1;
}

export type LocalAssistanceAggregateCustodyPort = LocalAssistanceWorkflowCustodyBridge;

export interface LocalAssistanceGuidedWorkflowPreparationRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceGuidedWorkflowId;
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly models: readonly LocalAssistanceModel[];
	readonly custody: LocalAssistanceAggregateCustodyPort;
	readonly signal: AbortSignal;
}

export type LocalAssistanceGuidedWorkflowPreparationOutcome = Readonly<{
	outcome: 'prepared';
	workflow: AssistanceWorkflowV1;
}> | Readonly<{
	outcome: 'unavailable';
	reason: LocalAssistanceGuidedPreparationUnavailableReason;
}>;

interface SelectedPreparationPort {
	listSelectedMedia(): Promise<unknown>;
	prepareSelectedMedia(request: Readonly<{
		sourceId: string;
		operation: AssistanceOperation;
		shotDetectionMode?: 'fast' | 'accurate';
		signal?: AbortSignal;
	}>): Promise<unknown>;
}

export interface LocalAssistanceGuidedPreparationDependencies {
	readonly getProject: () => unknown;
	readonly getSelectedClipId: () => string | null;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly preflightStorage: (bytes: number) => Promise<unknown>;
	readonly currentSelectionFence: () => unknown;
	readonly loadTranscriptBody?: (
		storageKey: string,
		signal: AbortSignal,
	) => PromiseLike<unknown> | unknown;
	readonly selected: SelectedPreparationPort;
}

export interface LocalAssistanceGuidedWorkflowPreparation {
	prepareGuidedWorkflow(
		request: LocalAssistanceGuidedWorkflowPreparationRequest,
	): Promise<LocalAssistanceGuidedWorkflowPreparationOutcome>;
}

export function createLocalAssistanceGuidedWorkflowPreparation(
	dependencies: LocalAssistanceGuidedPreparationDependencies,
): Readonly<LocalAssistanceGuidedWorkflowPreparation> {
	assertDependencies(dependencies);

	async function prepareGuidedWorkflow(
		request: LocalAssistanceGuidedWorkflowPreparationRequest,
	): Promise<LocalAssistanceGuidedWorkflowPreparationOutcome> {
		const settings = validateAssistanceWorkflowSettingsV1(request?.settings, request?.workflowId);
		if (!request?.custody || typeof request.custody.stageInput !== 'function'
			|| typeof request.custody.reserveOutput !== 'function'
			|| typeof request.custody.bindProducer !== 'function'
			|| typeof request.custody.release !== 'function') {
			return unavailable('aggregate-custody-unavailable');
		}
		if (!(request.signal instanceof AbortSignal)) {
			throw new TypeError('Guided preparation requires one cancellation signal.');
		}
		const token = dependencies.captureProject();
		try {
			request.signal.throwIfAborted();
			const project = projectRecord(
				dependencies.getProject(), dependencies.getSelectedClipId(),
			);
			assertSafeProjectTopology(project);
			const graph = assistanceWorkflowStageGraph(request.workflowId);
			const stages = selectStages(graph, settings, request.models);
			if (stages === null) throw new UnavailableError('workflow-disabled');
			const models = resolveModelBindings(stages, request.models, settings);
			if (models === null) throw new UnavailableError('model-binding-unavailable');
			const outputCount = stages.reduce((count, stage) => count + stage.outputSlots.length, 0);
			await dependencies.preflightStorage(outputCount * MAXIMUM_OUTPUT_BYTES);
			dependencies.assertProject(token);
			const inventory = normalizeInventory(await dependencies.selected.listSelectedMedia());
			dependencies.assertProject(token);
			const externalByBinding = new Map<string, Awaited<ReturnType<typeof prepareExternalInput>>>();
			const producedSlots = new Set<string>();
			for (const stage of stages) {
				for (const slot of stage.inputSlots) {
					const selectedShotInput = stage.operation === 'shot-detection' && slot.slotId === (shotMode(settings) === 'accurate' ? 'frame-pack' : 'video');
					if ((!slot.required && !selectedShotInput) || producedSlots.has(slot.slotId)) continue;
					const external = await prepareExternalInput(
						dependencies, project, inventory, stage, slot.slotId, settings, request.signal,
					);
					if (external === null) throw new UnavailableError(externalReason(slot.slotId));
					externalByBinding.set(bindingKey(stage.stageId, slot.slotId), external);
					dependencies.assertProject(token);
				}
				for (const slot of stage.outputSlots) if (slot.required) producedSlots.add(slot.slotId);
			}
			const preparedFences = [...externalByBinding.values()].map((external) => external!.fence);
			if (preparedFences.length < 1) throw new UnavailableError('source-custody-unavailable');
			assertSamePrimitiveFences(preparedFences);
			const settingsBody = serializeAssistanceWorkflowSettingsV1(settings);
			const fence = aggregateFence(project, preparedFences[0]!, stages, settingsBody, models);
			const outputBySlot = new Map<string, LocalAssistanceAggregateCustodyHandle>();
			const inputs: AssistanceWorkflowClaimV1[] = [];
			const outputs: AssistanceWorkflowClaimV1[] = [];

			for (const stage of stages) {
				for (const slot of stage.inputSlots) {
					const producer = outputBySlot.get(slot.slotId);
					if (producer) {
						const bound = await request.custody.bindProducer({ jobId: request.jobId,
							workflowId: request.workflowId, stageId: stage.stageId,
							slotId: slot.slotId, producer: producer.custody });
						inputs.push(assertHandle(bound, 'input', request.jobId, stage.stageId, slot.slotId));
						continue;
					}
					if (!slot.required && !externalByBinding.has(bindingKey(stage.stageId, slot.slotId))) continue;
					const external = externalByBinding.get(bindingKey(stage.stageId, slot.slotId)) ?? null;
					if (external === null) throw new UnavailableError(externalReason(slot.slotId));
					const staged = await request.custody.stageInput({ jobId: request.jobId,
						workflowId: request.workflowId, stageId: stage.stageId, slotId: slot.slotId,
						mediaType: external.mediaType, bytes: external.bytes, signal: request.signal });
					inputs.push(assertHandle(staged, 'input', request.jobId, stage.stageId, slot.slotId));
					dependencies.assertProject(token);
				}
				for (const slot of stage.outputSlots) {
					if (!slot.required) continue;
					const reserved = await request.custody.reserveOutput({ jobId: request.jobId,
						workflowId: request.workflowId, stageId: stage.stageId, slotId: slot.slotId,
						maximumByteLength: MAXIMUM_OUTPUT_BYTES });
					outputs.push(assertHandle(reserved, 'output', request.jobId, stage.stageId, slot.slotId));
					outputBySlot.set(slot.slotId, reserved);
				}
			}
			dependencies.assertProject(token);
			const stageIds = Object.freeze(stages.map(({ stageId }) => stageId));
			const workflow = validateAssistanceWorkflow({ contractVersion: 1, jobId: request.jobId,
				workflowId: request.workflowId, recipeVersion: 1,
				settingsVersion: settings.settingsVersion, settings, fence, stageIds,
				models, inputs: Object.freeze(inputs), outputs: Object.freeze(outputs) });
			return Object.freeze({ outcome: 'prepared', workflow });
		} catch (error) {
			await request.custody.release(request.jobId).catch(() => false);
			if (error instanceof UnavailableError) return unavailable(error.reason);
			throw error;
		}
	}

	return Object.freeze({ prepareGuidedWorkflow });
}

interface PrimitiveFence {
	readonly projectId: string; readonly schemaVersion: number; readonly revision: number;
	readonly sequenceId: string; readonly occurrenceIds: readonly string[]; readonly sourceId: string;
	readonly sourceSha256: string; readonly sourceStartFrame: number; readonly sourceEndFrame: number;
	readonly linkMembershipSha256: string; readonly timingAuthoritySha256: string;
}

async function prepareExternalInput(
	dependencies: LocalAssistanceGuidedPreparationDependencies,
	project: Record<string, unknown>,
	inventory: readonly InventorySource[],
	stage: AssistanceWorkflowStageSpec,
	slotId: string,
	settings: AssistanceWorkflowSettingsV1,
	signal: AbortSignal,
): Promise<Readonly<{ mediaType: string; bytes: Blob; fence: PrimitiveFence }> | null> {
	if (slotId === 'transcript') {
		return prepareTranscriptInput(dependencies, project, inventory, signal);
	}
	if (slotId !== 'audio' && slotId !== 'video' && slotId !== 'frame-pack') return null;
	const source = inventory.filter(({ mediaKind }) => mediaKind === (slotId === 'frame-pack' ? 'video' : slotId));
	if (source.length !== 1) return null;
	const operation = slotId === 'video' ? 'shot-detection' : stage.operation;
	if (!operation || (slotId === 'audio' && !AUDIO_OPERATIONS.has(operation))) return null;
	const mode = operation === 'shot-detection' ? shotMode(settings) : undefined;
	const value = await dependencies.selected.prepareSelectedMedia({
		sourceId: source[0]!.sourceId, operation, ...(mode ? { shotDetectionMode: mode } : {}), signal,
	});
	const prepared = primitivePrepared(value, source[0]!.sourceId, operation, mode);
	const matches = prepared.inputs.filter((candidate) => candidate.role === slotId);
	if (matches.length !== 1) {
		throw new UnavailableError('aggregate-custody-unavailable');
	}
	const input = matches[0]!;
	return Object.freeze({ mediaType: input.mediaType, bytes: input.bytes, fence: prepared.fence });
}

async function prepareTranscriptInput(
	dependencies: LocalAssistanceGuidedPreparationDependencies,
	project: Record<string, unknown>,
	inventory: readonly InventorySource[],
	signal: AbortSignal,
): Promise<Readonly<{ mediaType: string; bytes: Blob; fence: PrimitiveFence }> | null> {
	if (!dependencies.loadTranscriptBody) return null;
	signal.throwIfAborted();
	const fence = primitiveFence(dependencies.currentSelectionFence());
	const selectedSources = inventory.filter(({ sourceId }) => sourceId === fence.sourceId);
	if (selectedSources.length !== 1) return null;
	const mediaKind = selectedSources[0]!.mediaKind;
	const references = recordArray(project.assistanceAssets)
		.map(createAssistanceAssetReferenceV1)
		.filter((reference): reference is AssistanceTranscriptAssetReferenceV1 => (
			reference.kind === 'transcript-v1' && reference.sourceId === fence.sourceId
			&& reference.sourceSha256 === fence.sourceSha256
			&& reference.sourceStartFrame <= fence.sourceStartFrame
			&& reference.sourceEndFrame >= fence.sourceEndFrame
			&& (mediaKind === 'video'
				? reference.sourceVideoTimingSha256 === fence.timingAuthoritySha256
				: reference.sourceVideoTimingSha256 === null)
		));
	if (references.length !== 1) return null;
	const reference = references[0]!;
	const loaded = await dependencies.loadTranscriptBody(reference.body.storageKey, signal);
	signal.throwIfAborted();
	if (loaded === null || loaded === undefined) return null;
	const bytes = await immutableBytes(loaded);
	if (bytes.byteLength !== reference.body.byteLength
		|| bytesToHex(sha256(bytes)) !== reference.body.sha256) {
		throw new Error('The selected transcript body changed after project admission.');
	}
	return Object.freeze({
		mediaType: 'application/vnd.soundscaper.transcript+json',
		bytes: new Blob([bytes], { type: 'application/vnd.soundscaper.transcript+json' }),
		fence,
	});
}

async function immutableBytes(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
	if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
	if (value instanceof Uint8Array && !(value.buffer instanceof SharedArrayBuffer)) {
		return Uint8Array.from(value);
	}
	throw new TypeError('Assistance transcript storage returned no immutable body.');
}

function selectStages(
	graph: readonly AssistanceWorkflowStageSpec[],
	settings: AssistanceWorkflowSettingsV1,
	models: readonly LocalAssistanceModel[],
): readonly AssistanceWorkflowStageSpec[] | null {
	if (settings.workflowId === 'generate-editorial-text' && !settings.enabled) return null;
	return Object.freeze(graph.filter((stage) => {
		if (stage.required) return true;
		if (stage.stageId === 'align-words') return settings.workflowId === 'transcribe-captions'
			&& settings.recognizer === 'whisper' && settings.language === 'en'
			&& settings.englishWhisperAlignment === 'when-installed'
			&& models.some(({ task }) => task === 'word-alignment');
		if (stage.stageId === 'recognize-speech') {
			return models.filter(({ task }) => task === 'speech-recognition').length === 1;
		}
		if (stage.stageId === 'rerank-editorial') return settings.workflowId === 'make-highlights'
			&& settings.editorialRerank;
		return false;
	}));
}

function resolveModelBindings(
	stages: readonly AssistanceWorkflowStageSpec[],
	modelsValue: readonly LocalAssistanceModel[],
	settings: AssistanceWorkflowSettingsV1,
): readonly AssistanceWorkflowModelBindingV1[] | null {
	const models = modelsValue.map(normalizeModel);
	const result: AssistanceWorkflowModelBindingV1[] = [];
	for (const stage of stages) {
		for (const slot of stage.modelSlots) {
			if (!slot.required && !optionalModelEnabled(stage.stageId, settings)) continue;
			const matches = models.filter((model) => modelMatchesSlot(stage, slot.slotId, model, settings));
			if (matches.length !== 1) return null;
			const selected = matches[0]!;
			result.push(Object.freeze({ bindingVersion: 1, stageId: stage.stageId,
				slotId: slot.slotId, modelId: selected.modelId, version: selected.version,
				artifactSha256s: Object.freeze([...selected.artifactSha256s].sort()) }));
		}
	}
	return Object.freeze(result);
}

function modelMatchesSlot(
	stage: AssistanceWorkflowStageSpec,
	slotId: string,
	model: LocalAssistanceModel,
	settings: AssistanceWorkflowSettingsV1,
): boolean {
	const task = MODEL_SLOT_TASKS[slotId] ?? stage.operation;
	if (!task || model.task !== task) return false;
	if (slotId === 'enhancer') return model.modelId === 'deepfilternet3' && model.version === '3.0.0';
	if (slotId === 'separator') return model.modelId === 'tiger-dnr' && model.version === '1.0.0';
	if (slotId === 'accurate-shot-detector') return model.modelId === 'transnetv2';
	if (slotId === 'speech-recognizer' && settings.workflowId === 'transcribe-captions') {
		return settings.recognizer === 'whisper'
			? model.modelId.includes('whisper') : model.modelId.includes('parakeet');
	}
	return true;
}

const MODEL_SLOT_TASKS: Readonly<Record<string, string>> = Object.freeze({
	vad: 'voice-activity-detection', 'speech-recognizer': 'speech-recognition',
	alignment: 'word-alignment', diarizer: 'speaker-segmentation',
	'speaker-embedding': 'speaker-embedding', enhancer: 'speech-enhancement',
	separator: 'source-separation', 'audio-tagger': 'audio-tagging',
	'beat-tracker': 'beat-tracking', 'text-embedder': 'text-embedding',
	'accurate-shot-detector': 'shot-detection', 'visual-embedder': 'image-text-embedding',
	'text-detector': 'optical-character-recognition', 'text-recognizer': 'optical-character-recognition',
	'face-detector': 'face-detection', 'object-detector': 'object-detection',
	'saliency-detector': 'saliency-detection', 'editorial-generator': 'editorial-generation',
});

function aggregateFence(
	project: Record<string, unknown>,
	primitive: PrimitiveFence,
	stages: readonly AssistanceWorkflowStageSpec[],
	settingsBody: string,
	models: readonly AssistanceWorkflowModelBindingV1[],
): AssistanceWorkflowFenceV1 {
	if (primitive.projectId !== project.id || primitive.schemaVersion !== project.schemaVersion
		|| primitive.revision !== project.revision) throw new DOMException('stale', 'AbortError');
	const clips = recordArray(project.clips);
	const occurrences = primitive.occurrenceIds.map((occurrenceId) => {
		const matches = clips.filter(({ id }) => id === occurrenceId);
		if (matches.length !== 1) throw new UnavailableError('timing-authority-unavailable');
		return matches[0]!;
	});
	if (occurrences.some(({ sourceId }) => sourceId !== primitive.sourceId)) {
		throw new UnavailableError('timing-authority-unavailable');
	}
	const selected = occurrences.find(({ id }) => id === project.selectedClipId) ?? occurrences[0]!;
	const kind = selected.kind;
	if (kind !== 'audio' && kind !== 'video') throw new UnavailableError('selected-media-unavailable');
	if (selected.reversed === true || (typeof selected.speedRatio === 'number' && selected.speedRatio <= 0)) {
		throw new UnavailableError('timing-authority-unavailable');
	}
	const sources = recordArray(project.sources).filter(({ id }) => id === primitive.sourceId);
	if (sources.length !== 1 || liveSource(sources[0]!)) {
		throw new UnavailableError('source-custody-unavailable');
	}
	const sourceRanges: readonly AssistanceWorkflowSourceRangeV1[] = Object.freeze([Object.freeze({
		slotId: kind === 'audio' ? 'primary-audio' : 'primary-video', mediaKind: kind,
		sourceId: primitive.sourceId, sourceSha256: digest(primitive.sourceSha256),
		sourceSampleRate: kind === 'audio' ? positiveFrame(project.sampleRate, 8_000) : null,
		occurrenceIds: Object.freeze([...primitive.occurrenceIds]),
		sourceStartFrame: primitive.sourceStartFrame, sourceEndFrame: primitive.sourceEndFrame,
		linkMembershipSha256: digest(primitive.linkMembershipSha256),
		timingAuthoritySha256: digest(primitive.timingAuthoritySha256),
		retimeKind: selected.retimeMap == null ? 'identity' : 'monotonic-forward',
	})]);
	return Object.freeze({ fenceVersion: 1, projectId: String(project.id),
		schemaVersion: Number(project.schemaVersion), revision: Number(project.revision),
		sequenceId: primitive.sequenceId, sourceRanges,
		transcriptBodySha256: transcriptDigest(project, primitive.sourceId),
		recipeSha256: hash({ recipeVersion: 1, stages }), settingsSha256: hashJson(settingsBody),
		modelBindingsSha256: hash(models) });
}
function primitivePrepared(
	value: unknown, sourceId: string, operation: AssistanceOperation, mode?: 'fast' | 'accurate',
): Readonly<{ inputs: readonly Readonly<{ role: string; mediaType: string; bytes: Blob }>[];
	fence: PrimitiveFence }> {
	const row = dataRecord(value, 'prepared selected media');
	if (row.sourceId !== sourceId || row.operation !== operation
		|| (mode !== undefined && row.shotDetectionMode !== mode)
		|| !Array.isArray(row.inputs)) throw new TypeError('Prepared media lost exact aggregate authority.');
	const inputs = row.inputs.map((candidate) => {
		const input = dataRecord(candidate, 'prepared aggregate input');
		if (typeof input.role !== 'string' || typeof input.mediaType !== 'string'
			|| !(input.bytes instanceof Blob) || input.bytes.size < 1) {
			throw new TypeError('Prepared aggregate input custody is invalid.');
		}
		return Object.freeze({ role: input.role, mediaType: input.mediaType, bytes: input.bytes });
	});
	return Object.freeze({ inputs: Object.freeze(inputs),
		fence: primitiveFence(row.selectionFence) });
}

function primitiveFence(value: unknown): PrimitiveFence {
	const row = dataRecord(value, 'primitive selection fence');
	const occurrenceIds = Array.isArray(row.occurrenceIds)
		? row.occurrenceIds.map((id) => String(id)) : [];
	if (occurrenceIds.length < 1) throw new TypeError('Primitive selection occurrences are unavailable.');
	return Object.freeze({ projectId: String(row.projectId), schemaVersion: Number(row.schemaVersion),
		revision: Number(row.revision), sequenceId: String(row.sequenceId),
		occurrenceIds: Object.freeze(occurrenceIds), sourceId: String(row.sourceId),
		sourceSha256: digest(row.sourceSha256), sourceStartFrame: positiveFrame(row.sourceStartFrame, 0),
		sourceEndFrame: positiveFrame(row.sourceEndFrame, 1),
		linkMembershipSha256: digest(row.linkMembershipSha256),
		timingAuthoritySha256: digest(row.timingAuthoritySha256) });
}

interface InventorySource { readonly sourceId: string; readonly mediaKind: string }
function normalizeInventory(value: unknown): readonly InventorySource[] {
	const row = dataRecord(value, 'selected-media inventory');
	if (!Array.isArray(row.sources)) throw new TypeError('Selected-media inventory is unavailable.');
	return Object.freeze(row.sources.map((candidate) => {
		const source = dataRecord(candidate, 'selected-media source');
		return Object.freeze({ sourceId: String(source.sourceId), mediaKind: String(source.mediaKind) });
	}));
}

function assertHandle(
	handle: LocalAssistanceAggregateCustodyHandle,
	direction: 'input' | 'output', jobId: string, stageId: string, slotId: string,
): AssistanceWorkflowClaimV1 {
	const claim = handle?.workflowClaim;
	if (!handle?.custody || claim?.direction !== direction || claim.jobId !== jobId
		|| claim.stageId !== stageId || claim.slotId !== slotId
		|| claim.claimId !== handle.custody.claimId) {
		throw new TypeError('Aggregate custody returned an uncorrelated slotted claim.');
	}
	return claim;
}

function assertSamePrimitiveFences(values: readonly PrimitiveFence[]): void {
	const first = JSON.stringify(values[0]);
	if (values.some((value) => JSON.stringify(value) !== first)) {
		throw new DOMException('Selected-media authority changed during aggregate preparation.', 'AbortError');
	}
}

function bindingKey(stageId: string, slotId: string): string { return `${stageId}\0${slotId}`; }
function assertSafeProjectTopology(project: Record<string, unknown>): void {
	if (recordArray(project.subsequences).length > 0 || recordArray(project.multicameraGroups).length > 0) {
		throw new UnavailableError('timing-authority-unavailable');
	}
	const selectedClipId = project.selectedClipId;
	const clips = recordArray(project.clips).filter(({ id }) => id === selectedClipId);
	if (clips.length !== 1) throw new UnavailableError('selected-media-unavailable');
	const clip = clips[0]!;
	if (clip.reversed === true || (typeof clip.speedRatio === 'number' && clip.speedRatio <= 0)
		|| (clip.kind === 'audio' && (clip.speedRatio !== 1 || clip.warpMap != null))) {
		throw new UnavailableError('timing-authority-unavailable');
	}
	const source = recordArray(project.sources).filter(({ id }) => id === clip.sourceId);
	if (source.length !== 1 || liveSource(source[0]!)) {
		throw new UnavailableError('source-custody-unavailable');
	}
}

function projectRecord(value: unknown, selectedClipIdValue: string | null): Record<string, unknown> {
	const row = dataRecord(value, 'aggregate project');
	const selectedClipId = typeof selectedClipIdValue === 'string' && selectedClipIdValue.length > 0
		? selectedClipIdValue : null;
	return { ...row, selectedClipId };
}

function recordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
		Boolean(item) && typeof item === 'object' && !Array.isArray(item)
	)) : [];
}

function transcriptDigest(project: Record<string, unknown>, sourceId: string): string | null {
	const digests = new Set(recordArray(project.assistanceAssets)
		.filter((asset) => asset.kind === 'transcript-v1' && asset.sourceId === sourceId)
		.map((asset) => dataRecord(asset.body, 'transcript body').sha256)
		.map(digest));
	if (digests.size > 1) throw new UnavailableError('transcript-custody-unavailable');
	return [...digests][0] ?? null;
}

function normalizeModel(model: LocalAssistanceModel): LocalAssistanceModel {
	if (!model || typeof model !== 'object' || !MODEL_ID.test(model.modelId)
		|| typeof model.version !== 'string' || model.version.length < 1 || model.version.length > 128
		|| typeof model.task !== 'string' || model.task.length < 1
		|| !Array.isArray(model.artifactSha256s) || model.artifactSha256s.length < 1
		|| model.artifactSha256s.some((value) => !SHA256.test(value))
		|| new Set(model.artifactSha256s).size !== model.artifactSha256s.length) {
		throw new TypeError('Authenticated aggregate model inventory is invalid.');
	}
	return model;
}

function optionalModelEnabled(stageId: string, settings: AssistanceWorkflowSettingsV1): boolean {
	if (stageId !== 'detect-shots') return false;
	return (settings.workflowId === 'mark-cuts' && settings.mode === 'accurate')
		|| (settings.workflowId === 'index-video' && settings.shotMode === 'accurate');
}

function shotMode(settings: AssistanceWorkflowSettingsV1): 'fast' | 'accurate' {
	if (settings.workflowId === 'mark-cuts') return settings.mode;
	if (settings.workflowId === 'index-video') return settings.shotMode;
	return 'fast';
}

function externalReason(slotId: string): LocalAssistanceGuidedPreparationUnavailableReason {
	if (slotId === 'transcript') return 'transcript-custody-unavailable';
	if (slotId === 'editorial-context') return 'editorial-context-custody-unavailable';
	if (slotId === 'frame-pack' || slotId === 'shot-boundaries'
		|| slotId === 'reaction-ranges' || slotId === 'embeddings') {
		return 'derived-custody-unavailable';
	}
	return 'source-custody-unavailable';
}

function hash(value: unknown): string { return hashJson(canonicalJson(value)); }
function hashJson(value: string): string { return bytesToHex(sha256(new TextEncoder().encode(value))); }
function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string'
		|| (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const row = dataRecord(value, 'canonical workflow digest');
	return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`;
}

function liveSource(source: Record<string, unknown>): boolean {
	return source.live === true || source.liveCapture === true || source.captureState === 'live';
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError('Aggregate digest authority is invalid.');
	return value;
}

function positiveFrame(value: unknown, minimum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new RangeError('Aggregate frame authority is invalid.');
	return Number(value);
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}

function assertDependencies(value: LocalAssistanceGuidedPreparationDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.getProject !== 'function'
		|| typeof value.getSelectedClipId !== 'function' || typeof value.captureProject !== 'function'
		|| typeof value.assertProject !== 'function' || typeof value.preflightStorage !== 'function'
		|| typeof value.currentSelectionFence !== 'function'
		|| (value.loadTranscriptBody !== undefined && typeof value.loadTranscriptBody !== 'function')
		|| !value.selected || typeof value.selected.listSelectedMedia !== 'function'
		|| typeof value.selected.prepareSelectedMedia !== 'function') {
		throw new TypeError('Guided preparation requires exact project, storage, and media custody ports.');
	}
}
function unavailable(
	reason: LocalAssistanceGuidedPreparationUnavailableReason,
): LocalAssistanceGuidedWorkflowPreparationOutcome {
	return Object.freeze({ outcome: 'unavailable', reason });
}

class UnavailableError extends Error {
	readonly reason: LocalAssistanceGuidedPreparationUnavailableReason;
	constructor(reason: LocalAssistanceGuidedPreparationUnavailableReason) {
		super(`Guided preparation is unavailable: ${reason}`); this.reason = reason;
	}
}
