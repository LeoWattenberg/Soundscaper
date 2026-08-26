/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateAssistanceOutputClaim } from '../desktop/assistance-data-claims.ts';
import {
	createAssistanceOperationService,
	type AssistanceOperationServiceOptions,
} from '../desktop/assistance-operation-service.ts';
import type {
	AssistanceRuntimeFamilyOperationAdapter,
	AssistanceRuntimeFamilyOperationRequest,
} from '../desktop/assistance-runtime-family-operation-adapter.ts';
import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import type { SpeechRuntimeAdapter } from '../desktop/assistance-speech-runtime.ts';
import {
	createAssistanceWorkflowOperationStageRuntime,
} from '../desktop/assistance-workflow-operation-stage-runtime.ts';
import {
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowStageExecutionV1,
} from '../desktop/assistance-workflow-executor.ts';
import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceWorkflowModelBindingV1,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

interface ArtifactFixture {
	readonly fileName: string;
	readonly sha256: string;
}

interface ModelFixture {
	readonly modelId: string;
	readonly version: string;
	readonly task: string;
	readonly artifacts: readonly ArtifactFixture[];
}

interface VisualStageCase {
	readonly workflowId: 'index-video' | 'reframe';
	readonly stageId: 'embed-visuals' | 'recognize-text' | 'detect-subjects' | 'detect-saliency';
	readonly operation: 'image-text-embedding' | 'optical-character-recognition'
		| 'subject-detection' | 'saliency-detection';
	readonly outputRole: 'embeddings' | 'recognized-text' | 'subject-tracks' | 'saliency-map';
	readonly outputMediaType: string;
}

const SIGLIP = model('siglip2-base-patch16-224', '2.0.0', 'image-text-embedding', [
	['vision_model_int8.onnx', '0dd31785a2713f1113ef2272472165c69d580473dae38d7b47568ac587795e70'],
	['text_model_int8.onnx', '3a0603d3a00c05a80a6ded4743c16aaac7b1e62cdcc7e362e7ce418659b96400'],
	['tokenizer.json', 'cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322'],
	['config.json', 'e43a9f7692d3819886a82cb2097048258d444f123c67d37ec825f9345b019cf2'],
	['preprocessor_config.json', '9b36b57ebaf20f09bf4c22100ccc21877ea6bfe5aead0c00c59f8af8ccefacfc'],
]);
const OCR = model('ppocr-v4-mobile', '4.0.0', 'optical-character-recognition', [
	['text_detection.onnx', 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9'],
	['text_recognition.onnx', '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b'],
	['text_orientation.onnx', 'e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c'],
	['character_dictionary.txt', 'a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492'],
]);
const YUNET = model('yunet-face-detection-2026may', '2026.5.0', 'face-detection', [
	['face_detection_yunet_2026may.onnx',
		'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0'],
]);
const DFINE = model('dfine-nano-coco', '1.0.0', 'object-detection', [
	['model.onnx', '0f684f409618ee8a822410e754a29caa817d1aa16283ce89cad936d0a48e2f35'],
	['config.json', 'a5c7533f3b72be6bb102b93e1b34ca3643af4e0590408a7881543cbb0aa80c4c'],
	['preprocessor_config.json', 'cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1'],
]);
const SALIENCY = model('u2netp-saliency', '1.0.0', 'saliency-detection', [
	['u2netp.onnx', '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'],
]);
const MODELS = Object.freeze([SIGLIP, OCR, YUNET, DFINE, SALIENCY]);
const CASES: readonly VisualStageCase[] = Object.freeze([
	Object.freeze({ workflowId: 'index-video', stageId: 'embed-visuals',
		operation: 'image-text-embedding', outputRole: 'embeddings',
		outputMediaType: 'application/vnd.soundscaper.embedding-matrix-v1' }),
	Object.freeze({ workflowId: 'index-video', stageId: 'recognize-text',
		operation: 'optical-character-recognition', outputRole: 'recognized-text',
		outputMediaType: 'application/vnd.soundscaper.recognized-text+json' }),
	Object.freeze({ workflowId: 'reframe', stageId: 'detect-subjects',
		operation: 'subject-detection', outputRole: 'subject-tracks',
		outputMediaType: 'application/vnd.soundscaper.subject-tracks+json' }),
	Object.freeze({ workflowId: 'reframe', stageId: 'detect-saliency',
		operation: 'saliency-detection', outputRole: 'saliency-map',
		outputMediaType: 'application/vnd.soundscaper.saliency-map+json' }),
]);

test('prepared Guided visual stages reach the main runtime-family operation port', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-visual-workflow-route-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const modelService = await createModelService(root);
	const seen: AssistanceRuntimeFamilyOperationRequest[] = [];
	const additionalRuntime = writingRuntime(seen);
	for (const [index, stageCase] of CASES.entries()) {
		await runVisualStage(root, index, stageCase, modelService, additionalRuntime);
	}
	assert.deepEqual(seen.map(({ task }) => task), CASES.map(({ operation }) => operation));
	assert.deepEqual(seen.map(({ models }) => models.map(({ modelId }) => modelId)), [
		Array(5).fill(SIGLIP.modelId),
		Array(4).fill(OCR.modelId),
		[YUNET.modelId, DFINE.modelId, DFINE.modelId, DFINE.modelId],
		[SALIENCY.modelId],
	]);
	assert.ok(seen.every(({ settings }) => settings.schemaVersion === 1));
});

async function runVisualStage(
	root: string,
	index: number,
	stageCase: VisualStageCase,
	models: AssistanceOperationServiceOptions['models'],
	additionalRuntime: AssistanceRuntimeFamilyOperationAdapter,
): Promise<void> {
	let ordinal = index * 20;
	const staging = new AssistanceStagingRegistry({ root: join(root, `staging-${String(index)}`),
		mintId: () => (++ordinal).toString(16).padStart(40, '0') });
	const jobId = await staging.createJob();
	const body = new TextEncoder().encode(`frame-pack-${stageCase.stageId}`);
	const input = await staging.stageInput({ jobId, role: 'frame-pack',
		mediaType: 'application/vnd.soundscaper.frame-pack', byteLength: body.byteLength,
		bytes: chunks(body) });
	const reservation = await staging.reserveOutput({ jobId, role: stageCase.outputRole,
		mediaType: stageCase.outputMediaType, maximumByteLength: 64 * 1024 });
	const service = createAssistanceOperationService({ registry: staging, models,
		runtime: unusedSpeechRuntime(), additionalRuntime });
	const request = visualWorkflow(jobId, stageCase, input.claimId, reservation.claimId);
	const stage = assistanceWorkflowStageGraph(request.workflowId)
		.find(({ stageId }) => stageId === stageCase.stageId)!;
	const stageIndex = request.stageIds.indexOf(stage.stageId);
	const base = Object.freeze({ request, stage, stageIndex, stageCount: request.stageIds.length,
		inputs: request.inputs.filter(({ stageId }) => stageId === stage.stageId),
		outputs: request.outputs.filter(({ stageId }) => stageId === stage.stageId),
		models: request.models.filter(({ stageId }) => stageId === stage.stageId),
		signal: new AbortController().signal });
	let recorded = false;
	const runtime = createAssistanceWorkflowOperationStageRuntime({
		operations: { executeStaged: (value, signal) => service.executeStaged(value, signal) },
		custody: {
			operationInputClaim: async (claim: unknown, operation) => {
				assert.equal(claimIdentity(claim), input.claimId);
				assert.equal(operation, stageCase.operation);
				return input;
			},
			outputReservationForClaim: (claim: unknown) => {
				assert.equal(claimIdentity(claim), reservation.claimId);
				return reservation;
			},
			recordAuthenticatedOutputForClaim: async (claim: unknown, output: unknown) => {
				assert.equal(claimIdentity(claim), reservation.claimId);
				const reviewed = validateAssistanceOutputClaim(output, reservation);
				assert.equal(reviewed.claimId, reservation.claimId);
				recorded = true;
				return reviewed;
			},
		},
	});
	const progress: number[][] = [];
	const execution: AssistanceWorkflowStageExecutionV1 = Object.freeze({ ...base,
		custody: createAssistanceWorkflowStageCustodyToken(base),
		progress: (completed: number, total: number) => progress.push([completed, total]),
	});
	assert.deepEqual(await runtime(execution), { outcome: 'completed' });
	assert.equal(recorded, true);
	assert.deepEqual(progress, [[1, 1]]);
	await staging.releaseJob(jobId);
}

function visualWorkflow(
	jobId: string,
	stageCase: VisualStageCase,
	inputClaimId: string,
	outputClaimId: string,
): AssistanceWorkflowV1 {
	const graph = assistanceWorkflowStageGraph(stageCase.workflowId);
	const stageIds = graph.map(({ stageId }) => stageId);
	const models = workflowBindings(stageCase.workflowId);
	let ordinal = 100;
	const claimId = () => (++ordinal).toString(16).padStart(40, '0');
	const inputs = graph.flatMap((stage) => stage.inputSlots
		.filter((slot) => slot.required || stage.stageId === 'detect-shots' && slot.slotId === 'video')
		.map((slot) => ({ claimVersion: 1 as const, direction: 'input' as const,
			claimId: stage.stageId === stageCase.stageId ? inputClaimId : claimId(), jobId,
			stageId: stage.stageId, slotId: slot.slotId })));
	const outputs = graph.flatMap((stage) => stage.outputSlots.filter(({ required }) => required)
		.map((slot) => ({ claimVersion: 1 as const, direction: 'output' as const,
			claimId: stage.stageId === stageCase.stageId ? outputClaimId : claimId(), jobId,
			stageId: stage.stageId, slotId: slot.slotId })));
	const settings = defaultAssistanceWorkflowSettingsV1(stageCase.workflowId);
	const draft = assistanceWorkflowFixture({ jobId, workflowId: stageCase.workflowId,
		settings, stageIds, models, inputs, outputs });
	return validateAssistanceWorkflow({ ...draft, fence: { ...draft.fence, sourceRanges: [{
		...draft.fence.sourceRanges[0]!, slotId: 'primary-video', mediaKind: 'video',
		sourceSampleRate: null,
	}] } });
}

function workflowBindings(
	workflowId: 'index-video' | 'reframe',
): readonly AssistanceWorkflowModelBindingV1[] {
	const binding = (stageId: string, slotId: string, fixture: ModelFixture) => Object.freeze({
		bindingVersion: 1 as const, stageId, slotId, modelId: fixture.modelId,
		version: fixture.version,
		artifactSha256s: Object.freeze(fixture.artifacts.map(({ sha256 }) => sha256).sort()),
	});
	return workflowId === 'index-video' ? Object.freeze([
		binding('embed-visuals', 'visual-embedder', SIGLIP),
		binding('recognize-text', 'text-detector', OCR),
		binding('recognize-text', 'text-recognizer', OCR),
	]) : Object.freeze([
		binding('detect-subjects', 'face-detector', YUNET),
		binding('detect-subjects', 'object-detector', DFINE),
		binding('detect-saliency', 'saliency-detector', SALIENCY),
	]);
}

async function createModelService(
	root: string,
): Promise<AssistanceOperationServiceOptions['models']> {
	const bodies = new Map<string, Uint8Array>();
	for (const fixture of MODELS) {
		const directory = join(root, fixture.modelId);
		await mkdir(directory, { recursive: true });
		for (const artifact of fixture.artifacts) {
			const body = new TextEncoder().encode(`${fixture.modelId}:${artifact.fileName}`);
			bodies.set(`${fixture.modelId}\0${artifact.fileName}`, body);
			await writeFile(join(directory, artifact.fileName), body);
		}
	}
	return Object.freeze({
		status: async () => ({ runtimeAvailable: true, runtimeReason: null,
			models: MODELS.map((fixture) => ({ modelId: fixture.modelId, version: fixture.version,
				task: fixture.task, availability: 'installed' as const,
				downloadBytes: 1, installedBytes: 1, attributionRequired: false })) }),
		listInstalled: async () => MODELS.map((fixture) => ({ modelId: fixture.modelId,
			version: fixture.version, totalBytes: fixture.artifacts.reduce((sum, artifact) =>
				sum + bodies.get(`${fixture.modelId}\0${artifact.fileName}`)!.byteLength, 0),
			artifacts: fixture.artifacts.map((artifact) => ({ fileName: artifact.fileName,
				byteLength: bodies.get(`${fixture.modelId}\0${artifact.fileName}`)!.byteLength,
				sha256: artifact.sha256 })) })),
		resolveModelPaths: async (modelId: string) => {
			const fixture = MODELS.find((candidate) => candidate.modelId === modelId)!;
			return Object.fromEntries(fixture.artifacts.map(({ fileName }) => [
				fileName.split('.')[0]!, join(root, fixture.modelId, fileName),
			]));
		},
	});
}

function writingRuntime(
	seen: AssistanceRuntimeFamilyOperationRequest[],
): AssistanceRuntimeFamilyOperationAdapter {
	return Object.freeze({ async run(request: AssistanceRuntimeFamilyOperationRequest) {
		seen.push(request);
		const body = request.task === 'image-text-embedding'
			? Uint8Array.of(1, 2, 3, 4) : new TextEncoder().encode('{"frames":[]}');
		await writeFile(request.outputs[0]!.path, body);
		return Object.freeze({ outcome: 'completed' as const, outputs: Object.freeze([
			Object.freeze({ claimId: request.outputs[0]!.reservation.claimId,
				role: request.outputs[0]!.reservation.role,
				mediaType: request.outputs[0]!.reservation.mediaType,
				byteLength: body.byteLength,
				sha256: createHash('sha256').update(body).digest('hex') }),
		]) });
	} });
}

function unusedSpeechRuntime(): SpeechRuntimeAdapter {
	return Object.freeze({
		status: async () => ({ available: false, reason: 'unused', moduleId: 'unused' }),
		recognize: async () => { throw new Error('Visual workflow routing reached the speech runtime.'); },
	});
}

function model(
	modelId: string,
	version: string,
	task: string,
	artifacts: readonly (readonly [string, string])[],
): ModelFixture {
	return Object.freeze({ modelId, version, task, artifacts: Object.freeze(artifacts.map(
		([fileName, sha256]) => Object.freeze({ fileName, sha256 }),
	)) });
}

async function* chunks(body: Uint8Array): AsyncIterable<Uint8Array> { yield body.slice(); }

function claimIdentity(value: unknown): string {
	if (!value || typeof value !== 'object' || !('claimId' in value)
		|| typeof value.claimId !== 'string') {
		throw new TypeError('The workflow route received no claim identity.');
	}
	return value.claimId;
}
