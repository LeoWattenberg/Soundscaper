/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
		status: async () => ({ available: false, reason: 'not used', moduleId: null }),
		recognize: async () => { throw new Error('Sherpa must not receive an additional-family job.'); },
	});
	const progress: Array<{ phase: string }> = [];
	const service = createAssistanceOperationService({
		registry, models, runtime: speechRuntime, additionalRuntime: value.additionalRuntime,
		onProgress: (entry) => progress.push(entry),
	});
	return { service, digest, progress };
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
	await assert.rejects(service.run(operation), /wrong model task role/iu);
	assert.equal(seen.length, 0);
});
