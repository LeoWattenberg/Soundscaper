/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	ASSISTANCE_WORKFLOW_OWNED_VIDEO_HIGHLIGHT_STAGE_IDS,
	createAssistanceWorkflowOwnedVideoHighlightStageRuntime,
	type AssistanceWorkflowOwnedVideoHighlightStageCustodyV1,
} from '../desktop/assistance-workflow-owned-video-highlight-stage-runtime.ts';
import type {
	AssistanceOutputClaim,
	AssistanceStagedInputClaim,
} from '../desktop/assistance-data-claims.ts';
import {
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowStageExecutionV1,
} from '../desktop/assistance-workflow-executor.ts';
import {
	createAssistanceEmbeddingMatrixV1,
	createAssistanceFramePackV1,
	reviewAssistanceFramePackV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import type { AssistanceOwnedFramePackPlanV1 } from
	'../src/common/editor/assistance/owned-video-highlight-transform-types-v1.ts';
import {
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
	assistanceWorkflowStageGraph,
	type AssistanceWorkflowClaimV1,
	type AssistanceWorkflowId,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import { assistanceWorkflowCustodySlotSpec } from
	'../src/common/editor/assistance/workflow-custody-v1.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	defaultAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import {
	reviewFramescaperAssistanceHighlightsV1,
} from '../src/framescaper/editor-local-assistance-highlight-review.ts';

const MATRIX_MEDIA = 'application/vnd.soundscaper.embedding-matrix-v1';

test('the main bridge executes all seven closed transforms through authenticated custody', async () => {
	assert.deepEqual(ASSISTANCE_WORKFLOW_OWNED_VIDEO_HIGHLIGHT_STAGE_IDS, [
		'sample-shot-frames', 'publish-video-index', 'track-subjects', 'plan-crops',
		'gather-signals', 'rank-highlights', 'assemble-highlights',
	]);
	await withDirectory(async (directory) => {
		const indexSettings = defaultAssistanceWorkflowSettingsV1('index-video');
		if (indexSettings.workflowId !== 'index-video') assert.fail('Index settings changed identity.');
		const index = await workflowHarness(directory, 'index-video', {
			settings: { ...indexSettings, includeOcr: false },
			bodies: {
				'sample-shot-frames:video': Uint8Array.of(0, 0, 0, 20, 102, 116, 121, 112),
				'sample-shot-frames:video-authority': selectedVideoAuthority(
					digest(Uint8Array.of(0, 0, 0, 20, 102, 116, 121, 112))),
				'sample-shot-frames:shot-boundaries': shotBoundaries(),
				'publish-video-index:visual-embeddings': createAssistanceEmbeddingMatrixV1({
					dimensions: 2, vectors: [[1, 0]],
				}),
				'publish-video-index:recognized-text': null,
			},
			});
			const materializer = {
				materializeFramePack: ({ plan }: Readonly<{ plan: AssistanceOwnedFramePackPlanV1 }>) =>
				createAssistanceFramePackV1({ width: plan.width, height: plan.height,
					timescale: plan.timescale, frames: plan.frames.map((frame) => ({
						sourceFrame: frame.sourceFrame, presentationTick: frame.presentationTick,
						rgba: Uint8Array.of(1, 2, 3, 255),
					})) }),
			resolveVisualTags: ({ plan }: Readonly<{ plan: AssistanceOwnedFramePackPlanV1 }>) =>
				({ matrix: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1, 0]] }),
					tags: plan.frames.map(({ resultId }) => ({ resultId, tags: [] })) }),
		};
		const indexHandlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: index.custody, materializer,
		});
		assert.deepEqual(await indexHandlers['sample-shot-frames'](
			index.execution('sample-shot-frames'),
		), { outcome: 'completed' });
		const frameBytes = await readFile(index.outputPath('sample-shot-frames', 'frame-pack'));
		const reviewedFrames = reviewAssistanceFramePackV1(frameBytes);
		assert.equal(reviewedFrames.frameCount, 1);
		assert.equal(new TextDecoder().decode(frameBytes).includes('frame-pack-plan'), false);
		assert.deepEqual(await indexHandlers['publish-video-index'](
			index.execution('publish-video-index'),
		), { outcome: 'completed' });
		const videoIndex = await index.jsonOutput('publish-video-index', 'video-index') as {
			kind: string; embedding: { rowCount: number };
		};
		assert.equal(videoIndex.kind, 'video-index');
		assert.equal(videoIndex.embedding.rowCount, 1);

		const reframe = await workflowHarness(directory, 'reframe', { bodies: {
			'track-subjects:subject-tracks': subjectDetections(),
			'plan-crops:saliency-map': saliencyMap(),
		} });
		const reframeHandlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: reframe.custody,
		});
		assert.deepEqual(await reframeHandlers['track-subjects'](
			reframe.execution('track-subjects'),
		), { outcome: 'completed' });
		assert.deepEqual(await reframeHandlers['plan-crops'](
			reframe.execution('plan-crops'),
		), { outcome: 'completed' });
		assert.equal((await reframe.jsonOutput('plan-crops', 'reframe-path') as { kind: string }).kind,
			'reframe-path');

		const highlights = await workflowHarness(directory, 'make-highlights', { bodies: {
			'gather-signals:video': highlightVideoSignals(),
			'gather-signals:audio': highlightAudioSignals(),
			'gather-signals:shot-boundaries': { ...shotBoundaries(), timescale: 1 },
		} });
		const highlightHandlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: highlights.custody,
		});
		for (const stageId of ['gather-signals', 'rank-highlights', 'assemble-highlights'] as const) {
			assert.deepEqual(await highlightHandlers[stageId](highlights.execution(stageId)),
				{ outcome: 'completed' });
		}
		const publication = reviewFramescaperAssistanceHighlightsV1(
			await highlights.jsonOutput('assemble-highlights', 'highlight-proposals'),
		);
		assert.deepEqual(publication.fence, highlights.request.fence);
		assert.deepEqual(publication.proposals.map(({ selected }) => selected), [false]);
		assert.deepEqual(index.progress, [
			[1, 4], [2, 4], [3, 4], [4, 4], [1, 4], [2, 4], [3, 4], [4, 4],
		]);
	});
});

test('shot sampling is typed unavailable without real RGBA materialization', async () => {
	await withDirectory(async (directory) => {
		const harness = await workflowHarness(directory, 'index-video', { bodies: {
			'sample-shot-frames:video': Uint8Array.of(1, 2, 3),
			'sample-shot-frames:video-authority': selectedVideoAuthority(
				digest(Uint8Array.of(1, 2, 3))),
			'sample-shot-frames:shot-boundaries': shotBoundaries(),
		} });
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: harness.custody,
			materializer: {},
		});
		assert.deepEqual(await handlers['sample-shot-frames'](
			harness.execution('sample-shot-frames'),
		), { outcome: 'unavailable', reason: 'stage-unavailable' });
		assert.equal(harness.openCount, 0);
		assert.deepEqual(harness.authenticated, []);
		await assert.rejects(stat(harness.outputPath('sample-shot-frames', 'frame-pack')));
	});
});

test('the bridge rechecks media, bounds, digests, and output reservations before publication', async () => {
	await withDirectory(async (directory) => {
		const corrupt = await workflowHarness(directory, 'reframe', { bodies: {
			'track-subjects:subject-tracks': subjectDetections(),
		} });
		await writeFile(corrupt.inputPath('track-subjects', 'subject-tracks'), '{}');
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: corrupt.custody,
		});
		await assert.rejects(async () => await handlers['track-subjects'](
			corrupt.execution('track-subjects')),
			/digest|length|changed|stale/iu);
		assert.equal(corrupt.openCount, 0);

		const tooSmall = await workflowHarness(directory, 'reframe', {
			bodies: { 'track-subjects:subject-tracks': subjectDetections() },
			maximumOutputBytes: 8,
		});
		const bounded = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: tooSmall.custody,
		});
		await assert.rejects(async () => await bounded['track-subjects'](
			tooSmall.execution('track-subjects')),
			/reservation|exceeds/iu);
		assert.equal(tooSmall.openCount, 0);
		assert.deepEqual(tooSmall.authenticated, []);

		const wrongMedia = await workflowHarness(directory, 'reframe', { bodies: {
			'track-subjects:subject-tracks': subjectDetections(),
		} });
		wrongMedia.mediaOverride = MATRIX_MEDIA;
		const mediaHandlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: wrongMedia.custody,
		});
		await assert.rejects(async () => await mediaHandlers['track-subjects'](
			wrongMedia.execution('track-subjects')),
		/media|custody/iu);
	});
});

test('materialized semantics remain inside the exact aggregate source fence', async () => {
	await withDirectory(async (directory) => {
		const harness = await workflowHarness(directory, 'index-video', { bodies: {
			'sample-shot-frames:video': Uint8Array.of(1, 2, 3),
			'sample-shot-frames:video-authority': {
				...selectedVideoAuthority(digest(Uint8Array.of(1, 2, 3))),
				sourceId: 'outside-fence',
			},
			'sample-shot-frames:shot-boundaries': shotBoundaries(),
		} });
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: harness.custody,
			materializer: {
				materializeFramePack: ({ plan }) => createAssistanceFramePackV1({
					width: plan.width, height: plan.height, timescale: plan.timescale,
					frames: plan.frames.map((frame) => ({ sourceFrame: frame.sourceFrame,
						presentationTick: frame.presentationTick, rgba: Uint8Array.of(0, 0, 0, 255) })),
				}),
			},
		});
		await assert.rejects(async () => await handlers['sample-shot-frames'](
			harness.execution('sample-shot-frames')),
		/source|fence|authority/iu);
		assert.equal(harness.openCount, 0);
		assert.deepEqual(harness.authenticated, []);
	});
});

test('cancellation and stale stage identity cannot publish', async () => {
	await withDirectory(async (directory) => {
		const cancelled = await workflowHarness(directory, 'reframe', { bodies: {
			'track-subjects:subject-tracks': subjectDetections(),
		} });
		const controller = new AbortController();
		controller.abort(new DOMException('cancelled', 'AbortError'));
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: cancelled.custody,
		});
		await assert.rejects(async () => await handlers['track-subjects'](
			cancelled.execution('track-subjects', controller.signal)), /cancelled/iu);
		assert.equal(cancelled.openCount, 0);

		const stale = cancelled.execution('track-subjects');
		const staleExecution = { ...stale, stageIndex: stale.stageIndex + 1 };
		await assert.rejects(async () => await handlers['track-subjects'](staleExecution),
			/stale|uncorrelated/iu);
		const staleCustody = { ...stale, custody: { ...stale.custody, outputClaimIds: [] } };
		await assert.rejects(async () => await handlers['track-subjects'](staleCustody),
			/stale|uncorrelated|custody/iu);
		assert.equal(cancelled.openCount, 0);
	});
});

interface HarnessOptions {
	readonly settings?: AssistanceWorkflowSettingsV1;
	readonly bodies: Readonly<Record<string, unknown>>;
	readonly maximumOutputBytes?: number;
}

async function workflowHarness(
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
		externalVideo === undefined ? undefined : digest(binaryBody(externalVideo, 'video')));
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
) {
	const audioRange = { slotId: 'audio-main', mediaKind: 'audio' as const,
		sourceId: 'audio-source', sourceSha256: '78'.repeat(32), sourceSampleRate: 48_000,
		occurrenceIds: ['audio-occurrence'], sourceStartFrame: 0, sourceEndFrame: 1_920_000,
		linkMembershipSha256: '34'.repeat(32), timingAuthoritySha256: '9a'.repeat(32),
		retimeKind: 'identity' as const };
	const videoRange = { slotId: 'video-main', mediaKind: 'video' as const,
		sourceId: 'video-source', sourceSha256: videoSourceSha256, sourceSampleRate: null,
		occurrenceIds: ['video-occurrence'], sourceStartFrame: 0, sourceEndFrame: 41,
		linkMembershipSha256: '34'.repeat(32), timingAuthoritySha256: '56'.repeat(32),
		retimeKind: 'identity' as const };
	return {
		fenceVersion: 1 as const, projectId: 'project-a', schemaVersion: 31, revision: 1,
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

function digest(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function selectedVideoAuthority(sourceSha256 = '12'.repeat(32)) {
	return { schemaVersion: 1 as const, kind: 'selected-video-source-time-authority' as const,
		projectId: 'project-a', projectRevision: 1, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
		sourceSha256, timingAuthoritySha256: '56'.repeat(32),
		sourceWidth: 1, sourceHeight: 1, sourceStartFrame: 0, sourceEndFrame: 41,
		sampleRate: 48_000, timescale: 100, selectionStartFrame: 0, selectionEndFrame: 410,
		frames: Array.from({ length: 42 }, (_, sourceFrame) => ({
			sourceFrame, presentationTick: String(sourceFrame), timelineFrame: sourceFrame * 10,
		})) };
}

function shotBoundaries() {
	return { schemaVersion: 1 as const, detector: 'ffmpeg-scdet' as const, timescale: 100,
		sourceFrameCount: 41, boundaries: [] };
}

function subjectDetections() {
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

function saliencyMap() {
	return { schemaVersion: 1, width: 100, height: 100, timescale: 1_000, frames: [
		{ sourceFrame: 0, presentationTick: '0', saliency: null },
		{ sourceFrame: 1, presentationTick: '500', saliency: { x: 0.8, y: 0.5, score: 0.8 } },
	] };
}

function highlightVideoSignals() {
	return { schemaVersion: 1, kind: 'highlight-video-signals', sourceId: 'video-source',
		sampleRate: 1_000, timescale: 1, sourceSize: { width: 1_920, height: 1_080 },
		videoOccurrenceId: 'video-occurrence', audioOccurrenceId: 'audio-occurrence',
		selectionStartFrame: 0, selectionEndFrame: 40_000,
		sourceTimeAuthority: [0, 20, 40].map((sourceFrame) => ({ sourceFrame,
			presentationTick: String(sourceFrame), timelineFrame: sourceFrame * 1_000 })),
		windows: [{ id: 'highlight-a', startFrame: 0, endFrame: 40_000,
			shotStructure: 0, visualInterest: 0 }] };
}

function highlightAudioSignals() {
	return { schemaVersion: 1, kind: 'highlight-audio-signals',
		signals: [{ candidateId: 'highlight-a', energyDynamics: 0.75 }] };
}

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'assistance-video-owned-'));
	try { await run(directory); }
	finally { await rm(directory, { recursive: true, force: true }); }
}
