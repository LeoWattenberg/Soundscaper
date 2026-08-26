/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

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

const FENCE = Object.freeze({
	projectId: 'project-1', schemaVersion: 30, revision: 4, sequenceId: 'sequence-1',
	occurrenceIds: Object.freeze(['clip-1']), sourceId: 'source-1',
	sourceSha256: '1'.repeat(64), sourceStartFrame: 0, sourceEndFrame: 48_000,
	linkMembershipSha256: '2'.repeat(64), timingAuthoritySha256: '3'.repeat(64),
});

function sha256(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

function bytes(value: string): AsyncIterable<Uint8Array> {
	return Object.freeze({ async *[Symbol.asyncIterator]() { yield Buffer.from(value); } });
}

async function fixture(t: TestContext, value: Readonly<{
	modelId: string;
	version: string;
	task: string;
	fileName: string;
	additionalRuntime: AssistanceRuntimeFamilyOperationAdapter;
}>) {
	const root = await mkdtemp(join(tmpdir(), 'assistance-family-service-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const modelPath = join(root, value.fileName);
	await writeFile(modelPath, 'model');
	const digest = sha256('model');
	const registry = new AssistanceStagingRegistry({ root: join(root, 'staging') });
	const models: AssistanceOperationServiceOptions['models'] = Object.freeze({
		status: async () => ({ runtimeAvailable: true, runtimeReason: null, models: [{
			modelId: value.modelId, version: value.version, task: value.task,
			availability: 'installed' as const, downloadBytes: 5, installedBytes: 5,
			attributionRequired: false,
		}] }),
		listInstalled: async () => [{
			modelId: value.modelId, version: value.version, totalBytes: 5,
			artifacts: [{ fileName: value.fileName, byteLength: 5, sha256: digest }],
		}],
		resolveModelPaths: async () => ({ [value.fileName.split('.')[0]!]: modelPath }),
	});
	const speechRuntime: SpeechRuntimeAdapter = Object.freeze({
		status: async () => ({ available: false, reason: 'not used', moduleId: 'unused' }),
		recognize: async () => { throw new Error('Sherpa must not receive an additional-family job.'); },
	});
	const progress: Array<{ phase: string }> = [];
	const service = createAssistanceOperationService({
		registry, models, runtime: speechRuntime, additionalRuntime: value.additionalRuntime,
		onProgress: (entry) => progress.push(entry),
	});
	return { service, digest, progress };
}

async function subjectFixture(
	t: TestContext,
	additionalRuntime: AssistanceRuntimeFamilyOperationAdapter,
	objectTask = 'object-detection',
) {
	const root = await mkdtemp(join(tmpdir(), 'assistance-subject-family-service-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const artifacts = Object.freeze([
		Object.freeze({ modelId: 'yunet-face-detection-2026may', version: '2026.5.0',
			task: 'face-detection', fileName: 'face_detection_yunet_2026may.onnx', body: 'yunet' }),
		Object.freeze({ modelId: 'dfine-nano-coco', version: '1.0.0',
			task: objectTask, fileName: 'model.onnx', body: 'dfine-network' }),
		Object.freeze({ modelId: 'dfine-nano-coco', version: '1.0.0',
			task: objectTask, fileName: 'config.json', body: 'dfine-config' }),
		Object.freeze({ modelId: 'dfine-nano-coco', version: '1.0.0',
			task: objectTask, fileName: 'preprocessor_config.json', body: 'dfine-preprocessor' }),
	]);
	await Promise.all(artifacts.map(async ({ modelId, fileName, body }) => {
		const directory = join(root, modelId);
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, fileName), body);
	}));
	const byModel = new Map(['yunet-face-detection-2026may', 'dfine-nano-coco'].map((modelId) => [
		modelId,
		artifacts.filter((artifact) => artifact.modelId === modelId),
	] as const));
	const registry = new AssistanceStagingRegistry({ root: join(root, 'staging') });
	const models: AssistanceOperationServiceOptions['models'] = Object.freeze({
		status: async () => ({ runtimeAvailable: true, runtimeReason: null, models: [
			{ modelId: 'yunet-face-detection-2026may', version: '2026.5.0',
				task: 'face-detection', availability: 'installed' as const,
				downloadBytes: 5, installedBytes: 5, attributionRequired: false },
			{ modelId: 'dfine-nano-coco', version: '1.0.0', task: objectTask,
				availability: 'installed' as const, downloadBytes: 40, installedBytes: 40,
				attributionRequired: false },
		] }),
		listInstalled: async () => [...byModel].map(([modelId, entries]) => ({
			modelId, version: entries[0]!.version,
			totalBytes: entries.reduce((total, { body }) => total + Buffer.byteLength(body), 0),
			artifacts: entries.map(({ fileName, body }) => ({ fileName,
				byteLength: Buffer.byteLength(body), sha256: sha256(body) })),
		})),
		resolveModelPaths: async (modelId) => Object.fromEntries(
			(byModel.get(modelId) ?? []).map(({ fileName }) => [
				fileName.split('.')[0]!, join(root, modelId, fileName),
			]),
		),
	});
	const speechRuntime: SpeechRuntimeAdapter = Object.freeze({
		status: async () => ({ available: false, reason: 'not used', moduleId: 'unused' }),
		recognize: async () => { throw new Error('Sherpa must not receive subject detection.'); },
	});
	const service = createAssistanceOperationService({
		registry, models, runtime: speechRuntime, additionalRuntime,
		onProgress: () => undefined,
	});
	return {
		service,
		bindings: Object.freeze([...byModel].map(([modelId, entries]) => Object.freeze({
			modelId, version: entries[0]!.version,
			artifactSha256s: Object.freeze(entries.map(({ body }) => sha256(body)).sort()),
		}))),
	};
}

async function subjectRequest(
	service: ReturnType<typeof createAssistanceOperationService>,
	models: readonly Readonly<{ modelId: string; version: string;
		artifactSha256s: readonly string[] }>[],
) {
	const { jobId } = await service.createJob();
	const input = await service.stageInput({
		jobId, role: 'frame-pack', mediaType: 'application/vnd.soundscaper.frame-pack',
		byteLength: 6, bytes: bytes('frames'),
	});
	const output = await service.reserveOutput({
		jobId, role: 'subject-tracks',
		mediaType: 'application/vnd.soundscaper.subject-tracks+json',
		maximumByteLength: 8_192,
	});
	return Object.freeze({
		contractVersion: 1 as const, jobId, operation: 'subject-detection' as const,
		selectionFence: FENCE, models: Object.freeze(models),
		inputs: Object.freeze([input]), outputs: Object.freeze([output]),
	});
}

async function request(
	service: ReturnType<typeof createAssistanceOperationService>,
	value: Readonly<{
		operation: 'speech-enhancement' | 'source-separation' | 'speech-recognition';
		modelId: string;
		version: string;
		digest: string;
		outputs: readonly Readonly<{ role: 'enhanced-audio' | 'separated-audio' | 'transcript';
			mediaType: string }>[];
	}>,
) {
	const { jobId } = await service.createJob();
	const input = await service.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 9, bytes: bytes('RIFFinput'),
	});
	const outputs = await Promise.all(value.outputs.map((output) => service.reserveOutput({
		jobId, role: output.role, mediaType: output.mediaType, maximumByteLength: 8_192,
	})));
	return Object.freeze({
		contractVersion: 1 as const, jobId, operation: value.operation, selectionFence: FENCE,
		models: Object.freeze([{ modelId: value.modelId, version: value.version,
			artifactSha256s: Object.freeze([value.digest]) }]),
		inputs: Object.freeze([input]), outputs: Object.freeze(outputs),
	});
}

function writingRuntime(
	seen: AssistanceRuntimeFamilyOperationRequest[],
	bodies: readonly string[],
): AssistanceRuntimeFamilyOperationAdapter {
	return Object.freeze({
		async run(value: AssistanceRuntimeFamilyOperationRequest) {
			seen.push(value);
			value.onProgress?.(0.5);
			await Promise.all(value.outputs.map(({ path }, index) => writeFile(path, bodies[index]!)));
			return Object.freeze({
				outcome: 'completed' as const,
				outputs: Object.freeze(value.outputs.map(({ reservation }, index) => Object.freeze({
					claimId: reservation.claimId, role: reservation.role,
					mediaType: reservation.mediaType,
					byteLength: Buffer.byteLength(bodies[index]!), sha256: sha256(bodies[index]!),
				}))),
			});
		},
	});
}

test('enhancement executes through private runtime-family grants and authenticates its WAV', async (t) => {
	const seen: AssistanceRuntimeFamilyOperationRequest[] = [];
	const modelId = 'deepfilternet3';
	const version = '3.0.0';
	const { service, digest, progress } = await fixture(t, {
		modelId, version, task: 'speech-enhancement', fileName: 'deepfilter.onnx',
		additionalRuntime: writingRuntime(seen, ['RIFFenhanced']),
	});
	const operation = await request(service, {
		operation: 'speech-enhancement', modelId, version, digest,
		outputs: [{ role: 'enhanced-audio', mediaType: 'audio/wav' }],
	});
	const outcome = await service.run(operation);
	assert.equal(outcome.outcome, 'completed');
	if (outcome.outcome !== 'completed') return;
	assert.equal(seen[0]?.task, 'speech-enhancement');
	assert.equal(seen[0]?.models[0]?.artifactRole, 'deepfilter');
	assert.doesNotMatch(JSON.stringify(outcome), /assistance-family-service|deepfilter\.onnx/u);
	const opened = await service.openOutput({ jobId: operation.jobId, claim: outcome.result.outputs[0] });
	assert.equal(await readFile(opened.path, 'utf8'), 'RIFFenhanced');
	assert.deepEqual(progress.map(({ phase }) => phase), [
		'queued', 'staging-input', 'loading-model', 'running', 'running',
		'staging-output', 'finalizing',
	]);
});

test('separation permits three exact authenticated stem reservations in one job', async (t) => {
	const seen: AssistanceRuntimeFamilyOperationRequest[] = [];
	const modelId = 'tiger-dnr';
	const version = '1.0.0';
	const bodies = ['RIFFdialogue', 'RIFFmusic', 'RIFFeffects'];
	const { service, digest } = await fixture(t, {
		modelId, version, task: 'source-separation', fileName: 'network.onnx',
		additionalRuntime: writingRuntime(seen, bodies),
	});
	const operation = await request(service, {
		operation: 'source-separation', modelId, version, digest,
		outputs: bodies.map(() => ({ role: 'separated-audio' as const, mediaType: 'audio/wav' })),
	});
	const outcome = await service.run(operation);
	assert.equal(outcome.outcome, 'completed');
	if (outcome.outcome !== 'completed') return;
	assert.equal(outcome.result.outputs.length, 3);
	assert.equal(seen[0]?.outputs.length, 3);
});

test('Whisper speech dispatch never substitutes the existing Sherpa recognizer', async (t) => {
	const seen: AssistanceRuntimeFamilyOperationRequest[] = [];
	const modelId = 'whisper-large-v3-turbo-ggml';
	const version = '1.0.0';
	const transcript = '{"language":"en","segments":[]}';
	const { service, digest } = await fixture(t, {
		modelId, version, task: 'speech-recognition', fileName: 'ggml-large-v3-turbo-q5_0.bin',
		additionalRuntime: writingRuntime(seen, [transcript]),
	});
	const operation = await request(service, {
		operation: 'speech-recognition', modelId, version, digest,
		outputs: [{ role: 'transcript', mediaType: 'application/json' }],
	});
	assert.equal((await service.run(operation)).outcome, 'completed');
	assert.equal(seen[0]?.task, 'speech-recognition');
});

test('wrong additional model task roles fail before a worker receives file grants', async (t) => {
	const seen: AssistanceRuntimeFamilyOperationRequest[] = [];
	const modelId = 'wrong-role';
	const version = '1.0.0';
	const { service, digest } = await fixture(t, {
		modelId, version, task: 'audio-tagging', fileName: 'model.onnx',
		additionalRuntime: writingRuntime(seen, ['RIFFwrong']),
	});
	const operation = await request(service, {
		operation: 'speech-enhancement', modelId, version, digest,
		outputs: [{ role: 'enhanced-audio', mediaType: 'audio/wav' }],
	});
	await assert.rejects(service.run(operation), /wrong model task role|exact DeepFilterNet3/iu);
	assert.equal(seen.length, 0);
});

test('subject detection resolves exact YuNet and D-FINE bindings into one canonical ONNX job', async (t) => {
	const seen: AssistanceRuntimeFamilyOperationRequest[] = [];
	const { service, bindings } = await subjectFixture(t, writingRuntime(seen, ['{"frames":[]}']));
	const operation = await subjectRequest(service, [...bindings].reverse());
	assert.equal((await service.run(operation)).outcome, 'completed');
	assert.equal(seen.length, 1);
	assert.equal(seen[0]?.task, 'subject-detection');
	assert.deepEqual(seen[0]?.models.map(({ modelId }) => modelId), [
		'yunet-face-detection-2026may', 'dfine-nano-coco', 'dfine-nano-coco', 'dfine-nano-coco',
	]);
	assert.deepEqual(seen[0]?.models.map(({ artifactRole }) => artifactRole), [
		'face_detection_yunet_2026may', 'model', 'config', 'preprocessor_config',
	]);
});

test('subject detection refuses an incomplete, substituted, or wrong-role pair before runtime', async (t) => {
	const seen: AssistanceRuntimeFamilyOperationRequest[] = [];
	const valid = await subjectFixture(t, writingRuntime(seen, ['{"frames":[]}']));
	await assert.rejects(valid.service.run(await subjectRequest(valid.service, [valid.bindings[0]!])),
		/exact YuNet|D-FINE|two/iu);
	await assert.rejects(valid.service.run(await subjectRequest(valid.service, [
		valid.bindings[0]!, { ...valid.bindings[1]!, modelId: 'substitute-object-detector' },
	])), /exact YuNet|D-FINE|binding/iu);

	const wrongRole = await subjectFixture(t, writingRuntime(seen, ['{"frames":[]}']),
		'face-detection');
	await assert.rejects(wrongRole.service.run(await subjectRequest(
		wrongRole.service, wrongRole.bindings,
	)), /wrong model task role|object-detection/iu);
	assert.equal(seen.length, 0);
});

test('subject detection exposes typed adapter unavailability without substituting another route', async (t) => {
	let calls = 0;
	const { service, bindings } = await subjectFixture(t, Object.freeze({
		run: (request: AssistanceRuntimeFamilyOperationRequest) => {
			calls += 1;
			assert.equal(request.task, 'subject-detection');
			return Promise.resolve(Object.freeze({ outcome: 'unavailable' as const,
				reason: 'adapter-unavailable' as const }));
		},
	}));
	const operation = await subjectRequest(service, bindings);
	const outcome = await service.run(operation);
	assert.equal(calls, 1);
	assert.equal(outcome.outcome, 'unavailable');
	if (outcome.outcome === 'unavailable') assert.equal(outcome.reason, 'adapter-unavailable');
});
