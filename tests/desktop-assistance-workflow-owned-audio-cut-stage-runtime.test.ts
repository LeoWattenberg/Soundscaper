/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	ASSISTANCE_WORKFLOW_OWNED_AUDIO_CUT_STAGE_IDS,
	createAssistanceWorkflowOwnedAudioCutStageRuntime,
} from '../desktop/assistance-workflow-owned-audio-cut-stage-runtime.ts';
import type { AssistanceOutputClaim } from '../desktop/assistance-data-claims.ts';
import {
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowStageExecutionV1,
} from '../desktop/assistance-workflow-executor.ts';
import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import { createAssistanceTranscript } from '../src/common/editor/assistance/transcript.ts';
import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceWorkflowId,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

const MAXIMUM_BYTES = 64 * 1024 * 1024;

const CASES = Object.freeze([
	Object.freeze({ workflowId: 'transcribe-captions', stageId: 'assemble-captions', inputs: {
		transcript: { language: 'en', segments: [] },
	}, outputs: ['captions'] }),
	Object.freeze({ workflowId: 'clean-filler-silence', stageId: 'propose-cleanup', inputs: {
		'voice-activity': { sampleRate: 16_000, segments: [] },
	}, outputs: ['cleanup-proposals'] }),
	Object.freeze({ workflowId: 'identify-speakers', stageId: 'attribute-speakers', inputs: {
		transcript: transcript(),
		'speaker-turns': { sampleRate: 16_000, turns: [] },
	}, outputs: ['attributed-transcript'] }),
	Object.freeze({ workflowId: 'mark-reactions', stageId: 'merge-reaction-ranges', inputs: {
		'audio-tags': { schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000, windows: [] },
	}, outputs: ['reaction-ranges'] }),
	Object.freeze({ workflowId: 'index-transcript', stageId: 'chunk-transcript', inputs: {
		transcript: transcript([]),
	}, outputs: ['text-chunks'] }),
	Object.freeze({ workflowId: 'index-transcript', stageId: 'publish-transcript-index', inputs: {
		'text-chunks': { schemaVersion: 1, kind: 'text-chunks', sourceId: 'source-a',
			sampleRate: 48_000, chunks: [] },
		embeddings: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [] }),
	}, outputs: ['transcript-index'] }),
	Object.freeze({ workflowId: 'detect-beats-tempo', stageId: 'propose-tempo-map', inputs: {
		'beat-grid': { schemaVersion: 1, sampleRate: 22_050, points: [], tempoProposal: null },
	}, outputs: ['beat-labels', 'tempo-map-diff'] }),
	Object.freeze({ workflowId: 'mark-cuts', stageId: 'normalize-cuts', inputs: {
		'shot-boundaries': { schemaVersion: 1, detector: 'ffmpeg-scdet', timescale: 1_000,
			sourceFrameCount: 50, boundaries: [] },
	}, outputs: ['cut-proposals'] }),
] as const);

test('the main-owned runtime executes all eight transforms through exact authenticated custody', async () => {
	assert.deepEqual(ASSISTANCE_WORKFLOW_OWNED_AUDIO_CUT_STAGE_IDS, CASES.map(({ stageId }) => stageId));
	await withTempDirectory('workflow-owned-stage-', async (directory) => {
		for (const candidate of CASES) {
			const harness = await createHarness(directory, candidate.workflowId, candidate.stageId,
				candidate.inputs);
			const handlers = createAssistanceWorkflowOwnedAudioCutStageRuntime({ custody: harness.custody });
			const handler = handlers[candidate.stageId];
			assert.ok(handler);
			assert.deepEqual(await handler(harness.stage), { outcome: 'completed' }, candidate.stageId);
			assert.deepEqual(harness.authenticated, candidate.outputs);
			for (const slotId of candidate.outputs) {
				const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
					await readFile(harness.outputPaths.get(slotId)!),
				)) as unknown;
				assert.equal(typeof body, 'object');
				assert.doesNotMatch(JSON.stringify(body), /workflow-owned-stage-|\.output|path/iu);
			}
		}
	});
});

test('nonempty transcript chunking is unavailable until its exact tokenizer resolves', async () => {
	await withTempDirectory('workflow-owned-tokenizer-', async (directory) => {
		const source = transcript([{ startFrame: 100, endFrame: 200, text: 'hello world',
			words: [], speaker: null }]);
		const missing = await createHarness(directory, 'index-transcript', 'chunk-transcript',
			{ transcript: source });
		const unavailable = createAssistanceWorkflowOwnedAudioCutStageRuntime({ custody: missing.custody });
		assert.deepEqual(await unavailable['chunk-transcript'](missing.stage), {
			outcome: 'unavailable', reason: 'stage-unavailable',
		});
		assert.deepEqual(missing.authenticated, []);
		assert.equal((await readFile(missing.outputPaths.get('text-chunks')!)).byteLength, 0);

		const available = await createHarness(directory, 'index-transcript', 'chunk-transcript',
			{ transcript: source });
		let resolvedModel = '';
		const handlers = createAssistanceWorkflowOwnedAudioCutStageRuntime({ custody: available.custody,
			resolveTokenizer: ({ model }) => {
				resolvedModel = model.slotId;
				return Object.freeze({ encode: (value: string) => value === '\n' ? [10] : [1, 2] });
			},
		});
		assert.deepEqual(await handlers['chunk-transcript'](available.stage), { outcome: 'completed' });
		assert.equal(resolvedModel, 'text-embedder');
		assert.deepEqual(available.authenticated, ['text-chunks']);
	});
});

test('raw source-bound results use only exact audio source-rate authority', async () => {
	await withTempDirectory('workflow-owned-origin-', async (directory) => {
		const audio = await createHarness(directory, 'transcribe-captions', 'assemble-captions', {
			transcript: { language: 'en', segments: [{ startSeconds: 0, endSeconds: 1,
				text: 'hello', words: [] }] },
		});
		const handlers = createAssistanceWorkflowOwnedAudioCutStageRuntime({ custody: audio.custody });
		assert.deepEqual(await handlers['assemble-captions'](audio.stage), { outcome: 'completed' });
		const captions = JSON.parse((await readFile(audio.outputPaths.get('captions')!)).toString()) as
			{ sourceId: string; sampleRate: number; cues: Array<{ startFrame: number }> };
		assert.deepEqual(captions, { schemaVersion: 1, kind: 'captions', sourceId: 'source-a',
			sampleRate: 48_000, alignmentApplied: false,
			cues: [{ cueId: 'caption:0', startFrame: 0, endFrame: 48_000, text: 'hello',
				words: [{ text: 'hello', startFrame: 0, endFrame: 0, confidence: null }] }] });

		const video = await createHarness(directory, 'transcribe-captions', 'assemble-captions', {
			transcript: { language: 'en', segments: [] },
		}, { mediaKind: 'video' });
		const refused = createAssistanceWorkflowOwnedAudioCutStageRuntime({ custody: video.custody });
		assert.deepEqual(await refused['assemble-captions'](video.stage), {
			outcome: 'unavailable', reason: 'stage-unavailable',
		});
		assert.deepEqual(video.authenticated, []);
	});
});

test('slot media, byte bounds, and digests are revalidated before output paths open', async () => {
	await withTempDirectory('workflow-owned-refusal-', async (directory) => {
		const corrupt = await createHarness(directory, 'mark-reactions', 'merge-reaction-ranges', {
			'audio-tags': { schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000, windows: [] },
		});
		await writeFile(corrupt.inputPaths.get('audio-tags')!, '{}');
		const handlers = createAssistanceWorkflowOwnedAudioCutStageRuntime({ custody: corrupt.custody });
		await assert.rejects(async () => handlers['merge-reaction-ranges'](corrupt.stage),
			/digest|changed/iu);
		assert.equal(corrupt.openedOutputs, 0);

		const wrongMedia = await createHarness(directory, 'index-transcript',
			'publish-transcript-index', {
				'text-chunks': { schemaVersion: 1, kind: 'text-chunks', sourceId: 'source-a',
					sampleRate: 48_000, chunks: [] },
				embeddings: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [] }),
			}, { mediaOverrides: { embeddings: 'application/json' } });
		const wrong = createAssistanceWorkflowOwnedAudioCutStageRuntime({ custody: wrongMedia.custody });
		await assert.rejects(async () => wrong['publish-transcript-index'](wrongMedia.stage),
			/media|embedding/iu);
		assert.equal(wrongMedia.openedOutputs, 0);

		const oversized = await createHarness(directory, 'mark-reactions', 'merge-reaction-ranges', {
			'audio-tags': { schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000, windows: [] },
		}, { byteLengthOverrides: { 'audio-tags': MAXIMUM_BYTES + 1 } });
		const bounded = createAssistanceWorkflowOwnedAudioCutStageRuntime({ custody: oversized.custody });
		await assert.rejects(async () => bounded['merge-reaction-ranges'](oversized.stage),
			/byte|bound|large/iu);
		assert.equal(oversized.openedOutputs, 0);

		const outputBound = await createHarness(directory, 'detect-beats-tempo',
			'propose-tempo-map', {
				'beat-grid': { schemaVersion: 1, sampleRate: 22_050, points: [], tempoProposal: null },
			}, { maximumByteLengthOverrides: { 'tempo-map-diff': 1 } });
		const preflighted = createAssistanceWorkflowOwnedAudioCutStageRuntime({
			custody: outputBound.custody,
		});
		await assert.rejects(async () => preflighted['propose-tempo-map'](outputBound.stage),
			/reservation|exceeds/iu);
		assert.equal(outputBound.openedOutputs, 0);
	});
});

test('stale aggregate stage authority is refused before any custody is resolved', async () => {
	await withTempDirectory('workflow-owned-stale-', async (directory) => {
		const harness = await createHarness(directory, 'mark-reactions', 'merge-reaction-ranges', {
			'audio-tags': { schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000, windows: [] },
		});
		let resolved = 0;
		const handlers = createAssistanceWorkflowOwnedAudioCutStageRuntime({ custody: {
			...harness.custody,
			resolveInput: async (claim: Readonly<{ claimId: string }>) => { resolved += 1;
				return harness.custody.resolveInput(claim); },
		} });
		const stale = Object.freeze({ ...harness.stage, stageIndex: harness.stage.stageIndex - 1 });
		await assert.rejects(async () => handlers['merge-reaction-ranges'](stale),
			/stale|uncorrelated/iu);
		assert.equal(resolved, 0);
		assert.equal(harness.openedOutputs, 0);
	});
});

interface HarnessOptions {
	readonly mediaKind?: 'audio' | 'video';
	readonly mediaOverrides?: Readonly<Record<string, string>>;
	readonly byteLengthOverrides?: Readonly<Record<string, number>>;
	readonly maximumByteLengthOverrides?: Readonly<Record<string, number>>;
}

async function createHarness(
	directory: string,
	workflowId: AssistanceWorkflowId,
	stageId: string,
	bodies: Readonly<Record<string, unknown>>,
	options: HarnessOptions = {},
) {
	const request = workflow(workflowId);
	const stageIndex = request.stageIds.indexOf(stageId);
	const spec = assistanceWorkflowStageGraph(workflowId).find((stage) => stage.stageId === stageId)!;
	const inputs = request.inputs.filter((claim) => claim.stageId === stageId);
	const outputs = request.outputs.filter((claim) => claim.stageId === stageId);
	const models = request.models.filter((claim) => claim.stageId === stageId);
	const signal = new AbortController().signal;
	const binding = Object.freeze({ request: options.mediaKind === 'video'
		? videoAuthority(request) : request, stage: spec, stageIndex,
		stageCount: request.stageIds.length, inputs, outputs, models, signal });
	const stage: AssistanceWorkflowStageExecutionV1 = Object.freeze({ ...binding,
		custody: createAssistanceWorkflowStageCustodyToken(binding), progress: () => undefined });
	const inputPaths = new Map<string, string>();
	const resolved = new Map<string, Readonly<{ claim: AssistanceOutputClaim; path: string }>>();
	const inputCustody = new Map<string, ReturnType<typeof inputToken>>();
	for (const claim of inputs) {
		const body = bodies[claim.slotId];
		if (body === undefined) continue;
		const bytes = body instanceof Uint8Array ? Uint8Array.from(body)
			: new TextEncoder().encode(JSON.stringify(body));
		const path = join(directory, `${workflowId}-${stageId}-${claim.slotId}-${claim.claimId}.input`);
		await writeFile(path, bytes);
		inputPaths.set(claim.slotId, path);
		const resolvedClaim = Object.freeze({ claimVersion: 1 as const,
			claimId: claim.claimId, jobId: request.jobId, role: role(claim.slotId),
			mediaType: options.mediaOverrides?.[claim.slotId] ?? mediaType(claim.slotId),
			byteLength: options.byteLengthOverrides?.[claim.slotId] ?? bytes.byteLength,
			sha256: digest(bytes),
		});
		resolved.set(claim.claimId, Object.freeze({ path, claim: resolvedClaim }));
		inputCustody.set(claim.claimId, inputToken(request, claim, resolvedClaim));
	}
	const outputPaths = new Map<string, string>();
	const outputCustody = new Map<string, ReturnType<typeof outputToken>>();
	for (const claim of outputs) {
		const path = join(directory, `${workflowId}-${stageId}-${claim.slotId}-${claim.claimId}.output`);
		await writeFile(path, new Uint8Array());
		outputPaths.set(claim.slotId, path);
		outputCustody.set(claim.claimId, outputToken(request, claim, role(claim.slotId),
			'application/json', options.maximumByteLengthOverrides?.[claim.slotId]));
	}
	const authenticated: string[] = [];
	let openedOutputs = 0;
	return {
		stage, inputPaths, outputPaths, authenticated,
		get openedOutputs() { return openedOutputs; },
		custody: Object.freeze({
			resolveInput: async (claim: Readonly<{ claimId: string }>) => {
				const value = resolved.get(claim.claimId);
				if (!value) throw new Error('unknown exact input');
				return value;
			},
			workflowCustodyClaim: (claim: Readonly<{ claimId: string }>) => {
				const value = inputCustody.get(claim.claimId) ?? outputCustody.get(claim.claimId);
				if (!value) throw new Error('unknown exact workflow claim');
				return value;
			},
			openOutput: async (custody: ReturnType<typeof outputToken>) => {
				openedOutputs += 1;
				return outputPaths.get(custody.slotId)!;
			},
			authenticateOutput: async (custody: ReturnType<typeof outputToken>) => {
				const bytes = await readFile(outputPaths.get(custody.slotId)!);
				authenticated.push(custody.slotId);
				return Object.freeze({ claimVersion: 1 as const, claimId: custody.claimId,
					jobId: custody.jobId, role: custody.role as AssistanceOutputClaim['role'],
					mediaType: custody.mediaType, byteLength: bytes.byteLength, sha256: digest(bytes) });
			},
		}),
	};
}

function workflow(workflowId: AssistanceWorkflowId): AssistanceWorkflowV1 {
	const graph = assistanceWorkflowStageGraph(workflowId);
	const stages = graph.filter(({ required }) => required);
	const stageIds = stages.map(({ stageId }) => stageId);
	const settings = defaultAssistanceWorkflowSettingsV1(workflowId);
	let ordinal = 1;
	const claim = (direction: 'input' | 'output', stageId: string, slotId: string) => Object.freeze({
		claimVersion: 1 as const, direction, claimId: (++ordinal).toString(16).padStart(40, '0'),
		jobId: '01'.repeat(20), stageId, slotId,
	});
	const produced = new Set<string>();
	const inputs = stages.flatMap((stage) => stage.inputSlots.flatMap((slot) => {
		const included = slot.required || produced.has(slot.slotId)
			|| stage.stageId === 'detect-shots' && slot.slotId === 'video'
				&& settings.workflowId === 'mark-cuts' && settings.mode === 'fast';
		return included ? [claim('input', stage.stageId, slot.slotId)] : [];
	}));
	const outputs = stages.flatMap((stage) => stage.outputSlots.flatMap((slot) => {
		if (!slot.required) return [];
		produced.add(slot.slotId);
		return [claim('output', stage.stageId, slot.slotId)];
	}));
	const models = stages.flatMap((stage) => stage.modelSlots.flatMap((slot) => slot.required
		? [Object.freeze({ bindingVersion: 1 as const, stageId: stage.stageId, slotId: slot.slotId,
			modelId: slot.slotId === 'speech-recognizer' ? 'whisper-large-v3-turbo'
				: `${slot.slotId}-model`, version: '1.0.0',
			artifactSha256s: Object.freeze([(++ordinal).toString(16).padStart(64, '0')]) })]
		: []));
	return validateAssistanceWorkflow(assistanceWorkflowFixture({ workflowId, stageIds, settings,
		models, inputs, outputs }));
}

function videoAuthority(request: AssistanceWorkflowV1): AssistanceWorkflowV1 {
	const source = request.fence.sourceRanges[0]!;
	return validateAssistanceWorkflow({ ...request, fence: { ...request.fence, sourceRanges: [{ ...source,
		slotId: 'primary-video', mediaKind: 'video', sourceSampleRate: null }] } });
}

function transcript(segments: readonly Readonly<Record<string, unknown>>[] = []) {
	return createAssistanceTranscript({ sourceId: 'source-a', sampleRate: 48_000, language: 'en',
		modelId: 'recognizer-model', segments: segments as never });
}

function inputToken(
	request: AssistanceWorkflowV1,
	claim: AssistanceWorkflowV1['inputs'][number],
	resolved: AssistanceOutputClaim,
) {
	const external = ['transcript', 'shot-boundaries', 'reaction-ranges', 'embeddings']
		.includes(resolved.role);
	return Object.freeze({ custodyVersion: 1 as const, workflowId: request.workflowId,
		direction: 'input' as const, jobId: request.jobId, stageId: claim.stageId,
		slotId: claim.slotId, claimId: claim.claimId, role: resolved.role,
		mediaType: resolved.mediaType, byteLength: external ? resolved.byteLength : null,
		sha256: external ? resolved.sha256 : null,
		maximumByteLength: external ? null : MAXIMUM_BYTES,
		producer: external ? null : Object.freeze({ stageId: 'producer-stage', slotId: claim.slotId,
			claimId: claim.claimId }) });
}

function outputToken(
	request: AssistanceWorkflowV1,
	claim: AssistanceWorkflowV1['outputs'][number],
	claimRole: string,
	claimMediaType: string,
	maximumByteLength = MAXIMUM_BYTES,
) {
	return Object.freeze({ custodyVersion: 1 as const, workflowId: request.workflowId,
		direction: 'output' as const, jobId: request.jobId, stageId: claim.stageId,
		slotId: claim.slotId, claimId: claim.claimId, role: claimRole, mediaType: claimMediaType,
		byteLength: null, sha256: null, maximumByteLength, producer: null });
}

function role(slotId: string): AssistanceOutputClaim['role'] {
	if (slotId === 'dialogue' || slotId === 'music' || slotId === 'effects') return 'separated-audio';
	if (slotId === 'visual-embeddings') return 'embeddings';
	return slotId as AssistanceOutputClaim['role'];
}

function mediaType(slotId: string): string {
	return slotId === 'embeddings' || slotId === 'visual-embeddings'
		? 'application/vnd.soundscaper.embedding-matrix-v1' : 'application/json';
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function withTempDirectory(
	prefix: string,
	operation: (directory: string) => Promise<void>,
): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	try { await operation(directory); }
	finally { await rm(directory, { recursive: true, force: true }); }
}
