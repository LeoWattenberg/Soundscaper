/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
	AssistanceOutputClaim,
	AssistanceStagedInputClaim,
} from '../../desktop/assistance-data-claims.ts';
import type { AssistanceWorkflowOwnedVideoHighlightStageCustodyV1 } from
	'../../desktop/assistance-workflow-owned-video-highlight-stage-runtime.ts';
import {
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowStageExecutionV1,
} from '../../desktop/assistance-workflow-executor.ts';
import {
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
	assistanceWorkflowStageGraph,
	type AssistanceWorkflowClaimV1,
	type AssistanceWorkflowId,
	type AssistanceWorkflowV1,
} from '../../src/common/editor/assistance/workflow.ts';
import { assistanceWorkflowCustodySlotSpec } from
	'../../src/common/editor/assistance/workflow-custody-v1.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	defaultAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from '../../src/common/editor/assistance/workflow-settings-v1.ts';

interface HarnessOptions {
	readonly settings?: AssistanceWorkflowSettingsV1;
	readonly bodies: Readonly<Record<string, unknown>>;
	readonly maximumOutputBytes?: number;
	readonly videoSourceEndFrame?: number;
}

export async function workflowHarness(
	directory: string,
	workflowId: 'index-video' | 'reframe' | 'make-highlights',
	options: HarnessOptions,
) {
	const settings = options.settings ?? defaultAssistanceWorkflowSettingsV1(workflowId);
	const graph = assistanceWorkflowStageGraph(workflowId);
	const stageIds = graph.filter(({ required }) => required).map(({ stageId }) => stageId);
	const selected = graph.filter(({ stageId }) => stageIds.includes(stageId));
	let claimIndex = 1;
	const outputs = selected.flatMap((stage) => stage.outputSlots.filter(({ required }) => required)
		.map(({ slotId }) => claim('output', stage.stageId, slotId, claimIndex++)));
	const inputs = selected.flatMap((stage) => stage.inputSlots.filter(({ slotId, required }) => {
		const producer = [...outputs].reverse().find((candidate) => candidate.slotId === slotId
			&& stageIds.indexOf(candidate.stageId) < stageIds.indexOf(stage.stageId));
		return required || producer !== undefined || Object.hasOwn(options.bodies,
			`${stage.stageId}:${slotId}`);
	}).map(({ slotId }) => {
		const producer = [...outputs].reverse().find((candidate) => candidate.slotId === slotId
			&& stageIds.indexOf(candidate.stageId) < stageIds.indexOf(stage.stageId));
		return claim('input', stage.stageId, slotId, producer
			? Number.parseInt(producer.claimId, 16) : claimIndex++);
	}));
	if (workflowId === 'index-video') {
		inputs.push(claim('input', 'detect-shots', 'video', claimIndex++));
	}
	const models = selected.flatMap((stage) => stage.modelSlots.filter(({ required }) => required)
		.map(({ slotId }, index) => ({ bindingVersion: 1 as const, stageId: stage.stageId, slotId,
			modelId: `fixture-${stage.stageId}-${slotId}`, version: '1.0.0',
			artifactSha256s: [(index + claimIndex).toString(16).padStart(64, '0')] })));
	const jobId = createHash('sha1').update(`${directory}:${workflowId}`).digest('hex');
	const canonicalInputs = inputs.map((candidate) => ({ ...candidate, jobId }));
	const canonicalOutputs = outputs.map((candidate) => ({ ...candidate, jobId }));
	const externalVideo = options.bodies['sample-shot-frames:video'];
	const fence = workflowFence(workflowId, settings, stageIds, models,
		externalVideo === undefined ? undefined : digest(binaryBody(externalVideo, 'video')),
		options.videoSourceEndFrame);
	const request = {
		contractVersion: 1 as const, jobId, workflowId, recipeVersion: 1, settingsVersion: 1,
		settings, fence, stageIds, models, inputs: canonicalInputs, outputs: canonicalOutputs,
	} as AssistanceWorkflowV1;
	const inputRecords = new Map<string, Readonly<{ path: string; body: Uint8Array; media: string }>>();
	for (const [key, value] of Object.entries(options.bodies)) {
		const [stageId, slotId] = key.split(':') as [string, string];
		const body = binaryBody(value, slotId);
		const path = join(directory, `${workflowId}-${stageId}-${slotId}.input`);
		await writeFile(path, body);
		const producer = [...outputs].reverse().find((candidate) => candidate.slotId === slotId
			&& stageIds.indexOf(candidate.stageId) < stageIds.indexOf(stageId));
		const media = (producer ? assistanceWorkflowCustodySlotSpec(
			workflowId, producer.stageId, 'output', producer.slotId,
		) : assistanceWorkflowCustodySlotSpec(workflowId, stageId, 'input', slotId)).mediaTypes[0]!;
		inputRecords.set(`${stageId}:${slotId}`, { path, body, media });
	}
	const outputPaths = new Map(canonicalOutputs.map((candidate) => [
		`${candidate.stageId}:${candidate.slotId}`,
		join(directory, `${workflowId}-${candidate.stageId}-${candidate.slotId}.output`),
	]));
	const authenticatedClaims = new Map<string, AssistanceOutputClaim>();
	const progress: Array<[number, number]> = [];
	const authenticated: string[] = [];
	let openCount = 0;
	let mediaOverride: string | null = null;
	const custody = {
		workflowCustodyClaim(value: unknown) {
			const workflowClaim = value as AssistanceWorkflowClaimV1;
			const stage = selected.find(({ stageId }) => stageId === workflowClaim.stageId)!;
			const producer = workflowClaim.direction === 'input'
				? [...canonicalOutputs].reverse().find((candidate) => candidate.slotId === workflowClaim.slotId
					&& stageIds.indexOf(candidate.stageId) < stageIds.indexOf(stage.stageId)) : undefined;
			const custodySpec = producer
				? assistanceWorkflowCustodySlotSpec(
					workflowId, producer.stageId, 'output', producer.slotId,
				) : assistanceWorkflowCustodySlotSpec(
					workflowId, workflowClaim.stageId, workflowClaim.direction, workflowClaim.slotId,
				);
			const mediaType = mediaOverride ?? custodySpec.mediaTypes[0]!;
			const record = inputRecords.get(`${workflowClaim.stageId}:${workflowClaim.slotId}`);
			return {
				custodyVersion: 1 as const, workflowId, direction: workflowClaim.direction,
				jobId, stageId: workflowClaim.stageId, slotId: workflowClaim.slotId,
				claimId: workflowClaim.claimId,
				role: custodySpec.role, mediaType,
				byteLength: workflowClaim.direction === 'input' && !producer ? record?.body.byteLength ?? 1 : null,
				sha256: workflowClaim.direction === 'input' && !producer && record
					? digest(record.body) : workflowClaim.direction === 'input' && !producer ? '00'.repeat(32) : null,
				maximumByteLength: workflowClaim.direction === 'output' || producer
					? options.maximumOutputBytes ?? 64 * 1024 * 1024 : null,
				producer: producer ? { stageId: producer.stageId, slotId: producer.slotId,
					claimId: producer.claimId } : null,
			};
		},
		async resolveInput(value: unknown) {
			const token = value as { stageId: string; slotId: string; claimId: string;
				producer: unknown; role: string; mediaType: string };
			const seeded = inputRecords.get(`${token.stageId}:${token.slotId}`);
			if (seeded) return { claim: dataClaim(token.claimId, jobId, token.role,
				token.mediaType, seeded.body), path: seeded.path };
			const produced = authenticatedClaims.get(token.claimId);
			if (!produced) throw new Error('The producer fixture is not authenticated.');
			const producerOutput = canonicalOutputs.find(({ claimId }) => claimId === token.claimId)!;
			return { claim: produced, path: outputPaths.get(
				`${producerOutput.stageId}:${producerOutput.slotId}`,
			)! };
		},
		async openOutput(value: unknown) {
			openCount += 1;
			const token = value as { stageId: string; slotId: string };
			return outputPaths.get(`${token.stageId}:${token.slotId}`)!;
		},
		async authenticateOutput(value: unknown) {
			const token = value as { stageId: string; slotId: string; claimId: string; role: string;
				mediaType: string };
			const path = outputPaths.get(`${token.stageId}:${token.slotId}`)!;
			const bytes = await readFile(path);
			const result = dataClaim(token.claimId, jobId, token.role, token.mediaType, bytes) as
				AssistanceOutputClaim;
			authenticatedClaims.set(token.claimId, result);
			authenticated.push(token.slotId);
			return result;
		},
	} as unknown as AssistanceWorkflowOwnedVideoHighlightStageCustodyV1;
	return {
		request, custody, progress, authenticated,
		get openCount() { return openCount; },
		get mediaOverride() { return mediaOverride; },
		set mediaOverride(value: string | null) { mediaOverride = value; },
		execution(stageId: string, signal = new AbortController().signal) {
			const stage = selected.find((candidate) => candidate.stageId === stageId)!;
			const binding = { request, stage, stageIndex: stageIds.indexOf(stageId),
				stageCount: stageIds.length,
				inputs: canonicalInputs.filter((candidate) => candidate.stageId === stageId),
				outputs: canonicalOutputs.filter((candidate) => candidate.stageId === stageId),
				models: models.filter((candidate) => candidate.stageId === stageId), signal };
			return { ...binding, custody: createAssistanceWorkflowStageCustodyToken(binding),
				progress: (completed: number, total: number) => progress.push([completed, total]) } as
				AssistanceWorkflowStageExecutionV1;
		},
		inputPath(stageId: string, slotId: string) {
			return inputRecords.get(`${stageId}:${slotId}`)!.path;
		},
		outputPath(stageId: string, slotId: string) {
			return outputPaths.get(`${stageId}:${slotId}`)!;
		},
		async jsonOutput(stageId: string, slotId: string): Promise<unknown> {
			return JSON.parse((await readFile(outputPaths.get(`${stageId}:${slotId}`)!)).toString()) as unknown;
		},
	};
}

function workflowFence(
	workflowId: AssistanceWorkflowId,
	settings: AssistanceWorkflowSettingsV1,
	stageIds: readonly string[],
	models: AssistanceWorkflowV1['models'],
	videoSourceSha256 = '12'.repeat(32),
	videoSourceEndFrame = 41,
) {
	const audioRange = { slotId: 'audio-main', mediaKind: 'audio' as const,
		sourceId: 'audio-source', sourceSha256: '78'.repeat(32), sourceSampleRate: 48_000,
		occurrenceIds: ['audio-occurrence'], sourceStartFrame: 0, sourceEndFrame: 1_920_000,
		linkMembershipSha256: '34'.repeat(32), timingAuthoritySha256: '9a'.repeat(32),
		retimeKind: 'identity' as const };
	const videoRange = { slotId: 'video-main', mediaKind: 'video' as const,
		sourceId: 'video-source', sourceSha256: videoSourceSha256, sourceSampleRate: null,
		occurrenceIds: ['video-occurrence'], sourceStartFrame: 0,
		sourceEndFrame: videoSourceEndFrame,
		linkMembershipSha256: '34'.repeat(32), timingAuthoritySha256: '56'.repeat(32),
		retimeKind: 'identity' as const };
	return {
		fenceVersion: 1 as const, schemaFamily: 'framescaper' as const,
		projectId: 'project-a', schemaVersion: 1 as const, revision: 1,
		sequenceId: 'sequence-a', sourceRanges: workflowId === 'make-highlights'
			? [audioRange, videoRange] : [videoRange], transcriptBodySha256: null,
		recipeSha256: assistanceWorkflowRecipeSha256V1(workflowId, 1, stageIds),
		settingsSha256: assistanceWorkflowSettingsSha256V1(settings),
		modelBindingsSha256: assistanceWorkflowModelBindingsSha256V1(models),
	};
}

function claim<const Direction extends 'input' | 'output'>(
	direction: Direction, stageId: string, slotId: string, index: number,
) {
	return { claimVersion: 1 as const, direction, claimId: index.toString(16).padStart(40, '0'),
		jobId: '00'.repeat(20), stageId, slotId };
}

function dataClaim(
	claimId: string, jobId: string, role: string, mediaType: string, body: Uint8Array,
): AssistanceStagedInputClaim | AssistanceOutputClaim {
	return { claimVersion: 1 as const, claimId, jobId, role, mediaType,
		byteLength: body.byteLength, sha256: digest(body) } as
		AssistanceStagedInputClaim | AssistanceOutputClaim;
}

function binaryBody(value: unknown, slotId: string): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (slotId === 'embeddings' || slotId === 'visual-embeddings') {
		throw new TypeError('A matrix fixture must be binary.');
	}
	return new TextEncoder().encode(JSON.stringify(value));
}

export function digest(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

export function selectedVideoAuthority(sourceSha256 = '12'.repeat(32)) {
	return { descriptorVersion: 1 as const,
		kind: 'selected-video-source-time-authority' as const,
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		projectId: 'project-a', projectRevision: 1, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
		sourceSha256, timingAuthoritySha256: '56'.repeat(32),
		sourceWidth: 1, sourceHeight: 1, sourceStartFrame: 0, sourceEndFrame: 41,
		sampleRate: 48_000, timescale: 100, selectionStartFrame: 0, selectionEndFrame: 410,
		frames: Array.from({ length: 42 }, (_, sourceFrame) => ({
			sourceFrame, presentationTick: String(sourceFrame), timelineFrame: sourceFrame * 10,
		})) };
}

export function shotBoundaries() {
	return { schemaVersion: 1 as const, detector: 'ffmpeg-scdet' as const, timescale: 100,
		sourceFrameCount: 41, boundaries: [] };
}

export function subjectDetections() {
	const authority = { width: 100, height: 100, timescale: 1_000, frames: [
		{ sourceFrame: 0, presentationTick: '0' },
		{ sourceFrame: 1, presentationTick: '500' },
	] };
	return { schemaVersion: 1, kind: 'subject-detections', authority, shotAnchorFrames: [0],
		result: { schemaVersion: 1, width: 100, height: 100, timescale: 1_000, frames: [
			{ ...authority.frames[0], subjects: [{ kind: 'face', classId: null, label: 'face',
				confidence: 0.9, box: { x: 0.2, y: 0.2, width: 0.2, height: 0.3 } }] },
			{ ...authority.frames[1], subjects: [] },
		] } };
}

export function saliencyMap() {
	return { schemaVersion: 1, width: 100, height: 100, timescale: 1_000, frames: [
		{ sourceFrame: 0, presentationTick: '0', saliency: null },
		{ sourceFrame: 1, presentationTick: '500', saliency: { x: 0.8, y: 0.5, score: 0.8 } },
	] };
}

export function highlightVideoSignals() {
	return { schemaVersion: 1, kind: 'highlight-video-signals', sourceId: 'video-source',
		sampleRate: 1_000, timescale: 1, sourceSize: { width: 1_920, height: 1_080 },
		videoOccurrenceId: 'video-occurrence', audioOccurrenceId: 'audio-occurrence',
		selectionStartFrame: 0, selectionEndFrame: 40_000, reframeEvidence: null,
		sourceTimeAuthority: [0, 20, 40].map((sourceFrame) => ({ sourceFrame,
			presentationTick: String(sourceFrame), timelineFrame: sourceFrame * 1_000 })),
		windows: [{ id: 'highlight-a', startFrame: 0, endFrame: 40_000,
			shotStructure: 0, visualInterest: 0 }] };
}

export function highlightAudioSignals() {
	return { schemaVersion: 1, kind: 'highlight-audio-signals',
		signals: [{ candidateId: 'highlight-a', energyDynamics: 0.75 }] };
}

export async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'assistance-video-owned-'));
	try { await run(directory); }
	finally { await rm(directory, { recursive: true, force: true }); }
}
