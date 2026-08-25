/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	AssistanceOperationCancelledError,
	createAssistanceOperationService,
	type AssistanceOperationServiceOptions,
} from '../desktop/assistance-operation-service.ts';
import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import type { SpeechRuntimeAdapter } from '../desktop/assistance-speech-runtime.ts';
import type { VoiceActivityRuntimeAdapter } from '../desktop/assistance-vad-runtime.ts';

const MODEL_ID = 'parakeet-tdt-0.6b-v3';
const VERSION = '3.0.0';
const DIGESTS = Object.freeze(['1', '2', '3', '4'].map((value) => value.repeat(64)));
const FENCE = Object.freeze({
	projectId: 'project-1', schemaVersion: 28, revision: 7, sequenceId: 'sequence-1',
	occurrenceIds: Object.freeze(['occurrence-1']), sourceId: 'source-1',
	sourceSha256: 'a'.repeat(64), sourceStartFrame: 0, sourceEndFrame: 48_000,
	linkMembershipSha256: 'b'.repeat(64), timingAuthoritySha256: 'c'.repeat(64),
});

async function fixture(t: TestContext, overrides: Readonly<{
	runtime?: SpeechRuntimeAdapter;
	voiceActivityRuntime?: VoiceActivityRuntimeAdapter;
	availability?: 'installed' | 'installable' | 'unsupported-platform' | 'insufficient-memory';
	models?: AssistanceOperationServiceOptions['models'];
}> = {}) {
	const temporary = await mkdtemp(join(tmpdir(), 'assistance-operation-service-'));
	const stagingRoot = join(temporary, 'private-staging');
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const registry = new AssistanceStagingRegistry({ root: stagingRoot });
	const runtime = overrides.runtime ?? Object.freeze({
		status: async () => ({ available: true, reason: null, moduleId: 'test-runtime' }),
		recognize: async () => ({ language: 'en', segments: [{ startSeconds: 0, endSeconds: 1, text: 'hello' }] }),
	});
	const artifacts = Object.freeze([
		{ fileName: 'encoder.int8.onnx', byteLength: 1, sha256: DIGESTS[0]! },
		{ fileName: 'decoder.int8.onnx', byteLength: 1, sha256: DIGESTS[1]! },
		{ fileName: 'joiner.int8.onnx', byteLength: 1, sha256: DIGESTS[2]! },
		{ fileName: 'tokens.txt', byteLength: 1, sha256: DIGESTS[3]! },
	]);
	const modelPaths = Object.freeze({ encoder: '/models/encoder', decoder: '/models/decoder', joiner: '/models/joiner', tokens: '/models/tokens' });
	const models = overrides.models ?? Object.freeze({
		status: async () => ({
			runtimeAvailable: true, runtimeReason: null,
			models: [{ modelId: MODEL_ID, version: VERSION, task: 'speech-recognition',
				availability: overrides.availability ?? 'installed', downloadBytes: 4, installedBytes: 4,
				attributionRequired: true }],
		}),
		listInstalled: async () => [{ modelId: MODEL_ID, version: VERSION, artifacts, totalBytes: 4 }],
		resolveModelPaths: async () => modelPaths,
	});
	const progress: unknown[] = [];
	const service = createAssistanceOperationService({ registry, models, runtime,
		...(overrides.voiceActivityRuntime ? { voiceActivityRuntime: overrides.voiceActivityRuntime } : {}),
		onProgress: (value) => progress.push(value) });
	return { service, registry, runtime, stagingRoot, modelPaths, progress };
}

async function voiceActivityRequest(
	service: ReturnType<typeof createAssistanceOperationService>,
	modelId: string,
	version: string,
	digests: readonly string[],
) {
	const { jobId } = await service.createJob();
	const input = await service.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 8, bytes: bytes('RIFF-vad'),
	});
	const output = await service.reserveOutput({
		jobId, role: 'voice-activity', mediaType: 'application/json', maximumByteLength: 8_192,
	});
	return Object.freeze({
		contractVersion: 1 as const, jobId, operation: 'voice-activity-detection' as const,
		selectionFence: FENCE,
		models: Object.freeze([{ modelId, version, artifactSha256s: digests }]),
		inputs: Object.freeze([input]), outputs: Object.freeze([output]),
	});
}

function bytes(value: string): AsyncIterable<Uint8Array> {
	return Object.freeze({ async *[Symbol.asyncIterator]() { yield Buffer.from(value); } });
}

async function speechRequest(
	service: ReturnType<typeof createAssistanceOperationService>,
	inputText = 'RIFF-test-audio',
) {
	const { jobId } = await service.createJob();
	const input = await service.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: Buffer.byteLength(inputText),
		bytes: bytes(inputText),
	});
	const output = await service.reserveOutput({
		jobId, role: 'transcript', mediaType: 'application/json', maximumByteLength: 8_192,
	});
	return Object.freeze({
		contractVersion: 1 as const, jobId, operation: 'speech-recognition' as const,
		selectionFence: FENCE,
		models: Object.freeze([{ modelId: MODEL_ID, version: VERSION, artifactSha256s: DIGESTS }]),
		inputs: Object.freeze([input]), outputs: Object.freeze([output]),
	});
}

test('speech recognition consumes only authenticated claims and returns a pathless exact result', async (t) => {
	const recognized = { language: 'en', segments: [{ startSeconds: 0, endSeconds: 1, text: 'hello' }] };
	const recognitionRequests: Array<Parameters<SpeechRuntimeAdapter['recognize']>[0]> = [];
	const runtime: SpeechRuntimeAdapter = Object.freeze({
		status: async () => ({ available: true, reason: null, moduleId: 'test-runtime' }),
		recognize: async (request: Parameters<SpeechRuntimeAdapter['recognize']>[0]) => {
			recognitionRequests.push(request); return recognized;
		},
	});
	const { service, modelPaths, progress } = await fixture(t, { runtime });
	const request = await speechRequest(service);

	const outcome = await service.run(request);

	assert.equal(outcome.outcome, 'completed');
	if (outcome.outcome !== 'completed') return;
	const recognitionRequest = recognitionRequests[0];
	assert.equal(recognitionRequest?.modelId, MODEL_ID);
	assert.deepEqual(recognitionRequest?.model, modelPaths);
	assert.match(recognitionRequest?.audioPath ?? '', /private-staging/u);
	assert.deepEqual(outcome.result, {
		contractVersion: 1, jobId: request.jobId, operation: 'speech-recognition',
		outputs: [{ claimVersion: 1, claimId: request.outputs[0]!.claimId, jobId: request.jobId,
			role: 'transcript', mediaType: 'application/json',
			byteLength: Buffer.byteLength(JSON.stringify(recognized)),
			sha256: createHash('sha256').update(JSON.stringify(recognized)).digest('hex') }],
	});
	assert.doesNotMatch(JSON.stringify(outcome), /private-staging|\/models\//u);
	const opened = await service.openOutput({ jobId: request.jobId, claim: outcome.result.outputs[0] });
	assert.equal(await readFile(opened.path, 'utf8'), JSON.stringify(recognized));
	assert.equal(opened.binding.byteLength, outcome.result.outputs[0]!.byteLength);
	assert.deepEqual((progress as Array<{ phase: string }>).map(({ phase }) => phase),
		['queued', 'staging-input', 'loading-model', 'running', 'staging-output', 'finalizing']);
});

test('voice activity executes the authenticated Silero model through the native helper', async (t) => {
	const modelId = 'silero-vad-v6';
	const version = '6.2.1';
	const digest = '9'.repeat(64);
	const detected = { sampleRate: 16_000, segments: [{ startSample: 512, sampleCount: 1_024 }] };
	const requests: Array<Parameters<VoiceActivityRuntimeAdapter['detect']>[0]> = [];
	const voiceActivityRuntime: VoiceActivityRuntimeAdapter = Object.freeze({
		status: async () => ({ available: true, reason: null, moduleId: 'test-runtime' }),
		detect: async (request: Parameters<VoiceActivityRuntimeAdapter['detect']>[0]) => {
			requests.push(request); return detected;
		},
	});
	const models: AssistanceOperationServiceOptions['models'] = Object.freeze({
		status: async () => ({ runtimeAvailable: true, runtimeReason: null, models: [{
			modelId, version, task: 'voice-activity-detection', availability: 'installed' as const,
			downloadBytes: 1, installedBytes: 1, attributionRequired: false,
		}] }),
		listInstalled: async () => [{ modelId, version, totalBytes: 1,
			artifacts: [{ fileName: 'silero_vad.onnx', byteLength: 1, sha256: digest }] }],
		resolveModelPaths: async () => ({ silero_vad: '/models/silero_vad.onnx' }),
	});
	const { service, progress } = await fixture(t, { models, voiceActivityRuntime });
	const request = await voiceActivityRequest(service, modelId, version, [digest]);

	const outcome = await service.run(request);

	assert.equal(outcome.outcome, 'completed');
	if (outcome.outcome !== 'completed') return;
	assert.equal(requests[0]?.modelId, modelId);
	assert.deepEqual(requests[0]?.model, { model: '/models/silero_vad.onnx' });
	assert.match(requests[0]?.audioPath ?? '', /private-staging/u);
	const opened = await service.openOutput({ jobId: request.jobId, claim: outcome.result.outputs[0] });
	assert.equal(await readFile(opened.path, 'utf8'), JSON.stringify(detected));
	assert.deepEqual((progress as Array<{ phase: string }>).map(({ phase }) => phase),
		['queued', 'staging-input', 'loading-model', 'running', 'staging-output', 'finalizing']);
});

test('model choices expose exact authenticated bindings without filesystem paths', async (t) => {
	const { service } = await fixture(t);
	assert.deepEqual(await service.models(), [{
		modelId: MODEL_ID, version: VERSION, task: 'speech-recognition', artifactSha256s: DIGESTS,
	}]);
	assert.doesNotMatch(JSON.stringify(await service.models()), /\/models|path/iu);
});

test('model choices omit only an externally deleted or tampered model', async (t) => {
	const secondId = 'parakeet-tdt-0.6b-v2';
	const model = (modelId: string) => ({ modelId, version: VERSION,
		task: 'speech-recognition', availability: 'installed' as const, downloadBytes: 4,
		installedBytes: 4, attributionRequired: true });
	const installation = (modelId: string) => ({ modelId, version: VERSION,
		artifacts: [{ fileName: 'encoder.onnx', byteLength: 1, sha256: DIGESTS[0]! }], totalBytes: 1 });
	const { service } = await fixture(t, { models: {
		status: async () => ({ runtimeAvailable: true, runtimeReason: null,
			models: [model(MODEL_ID), model(secondId)] }),
		listInstalled: async () => [installation(MODEL_ID), installation(secondId)],
		resolveModelPaths: async (modelId) => {
			if (modelId === MODEL_ID) throw new Error(`${modelId} artifact encoder failed its integrity check.`);
			return { encoder: '/models/encoder', decoder: '/models/decoder',
				joiner: '/models/joiner', tokens: '/models/tokens' };
		},
	} });

	assert.deepEqual(await service.models(), [{ modelId: secondId, version: VERSION,
		task: 'speech-recognition', artifactSha256s: [DIGESTS[0]!] }]);
});

test('model choices surface systemic store failures', async (t) => {
	const { service } = await fixture(t, { models: {
		status: async () => ({ runtimeAvailable: true, runtimeReason: null,
			models: [{ modelId: MODEL_ID, version: VERSION, task: 'speech-recognition',
				availability: 'installed', downloadBytes: 4, installedBytes: 4, attributionRequired: true }] }),
		listInstalled: async () => [{ modelId: MODEL_ID, version: VERSION,
			artifacts: [{ fileName: 'encoder.onnx', byteLength: 1, sha256: DIGESTS[0]! }], totalBytes: 1 }],
		resolveModelPaths: async () => { throw Object.assign(new Error('store unavailable'), { code: 'EACCES' }); },
	} });
	await assert.rejects(service.models(), /store unavailable/iu);
});

test('unsupported operation adapters return a typed unavailable outcome without invoking a runtime', async (t) => {
	let calls = 0;
	const { service } = await fixture(t, { runtime: Object.freeze({
		status: async () => { calls += 1; return { available: true, reason: null, moduleId: 'test' }; },
		recognize: async () => { calls += 1; throw new Error('must not run'); },
	}) });
	const { jobId } = await service.createJob();
	const input = await service.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 1, bytes: bytes('x'),
	});
	const output = await service.reserveOutput({
		jobId, role: 'audio-tags', mediaType: 'application/json', maximumByteLength: 64,
	});
	const outcome = await service.run({
		contractVersion: 1, jobId, operation: 'audio-tagging', selectionFence: FENCE,
		models: [{ modelId: MODEL_ID, version: VERSION, artifactSha256s: DIGESTS }],
		inputs: [input], outputs: [output],
	});

	assert.deepEqual(outcome, { contractVersion: 1, jobId, operation: 'audio-tagging',
		outcome: 'unavailable', reason: 'adapter-unavailable' });
	assert.equal(calls, 0);
});

test('missing current model and unavailable runtime are distinct pathless outcomes', async (t) => {
	const missing = await fixture(t, { availability: 'installable' });
	const missingRequest = await speechRequest(missing.service);
	assert.deepEqual(await missing.service.run(missingRequest), {
		contractVersion: 1, jobId: missingRequest.jobId, operation: 'speech-recognition',
		outcome: 'unavailable', reason: 'model-unavailable',
	});
	const unavailable = await fixture(t, { runtime: Object.freeze({
		status: async () => ({ available: false, reason: '/private/runtime failed', moduleId: 'test' }),
		recognize: async () => { throw new Error('must not run'); },
	}) });
	const unavailableRequest = await speechRequest(unavailable.service);
	assert.deepEqual(await unavailable.service.run(unavailableRequest), {
		contractVersion: 1, jobId: unavailableRequest.jobId, operation: 'speech-recognition',
		outcome: 'unavailable', reason: 'runtime-unavailable',
	});
});

test('platform- and memory-incompatible models are not advertised for execution', async (t) => {
	for (const availability of ['unsupported-platform', 'insufficient-memory'] as const) {
		const incompatible = await fixture(t, { availability });
		assert.deepEqual(await incompatible.service.models(), []);
		const request = await speechRequest(incompatible.service);
		assert.deepEqual(await incompatible.service.run(request), {
			contractVersion: 1, jobId: request.jobId, operation: 'speech-recognition',
			outcome: 'unavailable', reason: 'model-unavailable',
		});
	}
});

test('an authenticated but incompatible speech model is a typed model-unavailable outcome', async (t) => {
	const { service } = await fixture(t, { models: {
		status: async () => ({ runtimeAvailable: true, runtimeReason: null,
			models: [{ modelId: MODEL_ID, version: VERSION, task: 'speech-recognition',
				availability: 'installed', downloadBytes: 4, installedBytes: 4, attributionRequired: true }] }),
		listInstalled: async () => [{ modelId: MODEL_ID, version: VERSION,
			artifacts: [{ fileName: 'model.onnx', byteLength: 1, sha256: DIGESTS[0]! }], totalBytes: 1 }],
		resolveModelPaths: async () => ({ model: '/models/whisper/model.onnx' }),
	} });
	const request = await speechRequest(service);
	const bound = { ...request, models: [{ ...request.models[0]!, artifactSha256s: [DIGESTS[0]!] }] };
	assert.deepEqual(await service.run(bound), { contractVersion: 1, jobId: request.jobId,
		operation: 'speech-recognition', outcome: 'unavailable', reason: 'model-unavailable' });
});

test('model disappearance is unavailable while catalog and artifact integrity failures remain hard', async (t) => {
	for (const [message, unavailable] of [
		[`${MODEL_ID} is not installed.`, true],
		[`${MODEL_ID} does not match the current authenticated catalog entry.`, false],
		[`${MODEL_ID} artifact model.onnx failed its integrity check.`, false],
	] as const) {
		const next = await fixture(t, { models: {
			status: async () => ({ runtimeAvailable: true, runtimeReason: null,
				models: [{ modelId: MODEL_ID, version: VERSION, task: 'speech-recognition',
					availability: 'installed', downloadBytes: 4, installedBytes: 4, attributionRequired: true }] }),
			listInstalled: async () => [{ modelId: MODEL_ID, version: VERSION,
				artifacts: [{ fileName: 'model.onnx', byteLength: 1, sha256: DIGESTS[0]! }], totalBytes: 1 }],
			resolveModelPaths: async () => { throw new Error(message); },
		} });
		const request = await speechRequest(next.service);
		const bound = { ...request, models: [{ ...request.models[0]!, artifactSha256s: [DIGESTS[0]!] }] };
		if (unavailable) assert.equal((await next.service.run(bound)).outcome, 'unavailable');
		else await assert.rejects(next.service.run(bound), new RegExp(message.replaceAll('.', '\\.'), 'u'));
	}
});

test('a forged model digest binding and unregistered claims are rejected before runtime execution', async (t) => {
	let recognized = false;
	const { service } = await fixture(t, { runtime: Object.freeze({
		status: async () => ({ available: true, reason: null, moduleId: 'test' }),
		recognize: async () => { recognized = true; return { language: null, segments: [] }; },
	}) });
	const request = await speechRequest(service);
	await assert.rejects(service.run({ ...request, models: [{ ...request.models[0]!,
		artifactSha256s: ['f'.repeat(64)] }] }), /model binding|artifact/iu);
	assert.equal(recognized, false);
	const next = await fixture(t, { runtime: Object.freeze({
		status: async () => ({ available: true, reason: null, moduleId: 'test' }),
		recognize: async () => { recognized = true; return { language: null, segments: [] }; },
	}) });
	const nextRequest = await speechRequest(next.service);
	await assert.rejects(next.service.run({ ...nextRequest, inputs: [{ ...nextRequest.inputs[0]!,
		claimId: 'f'.repeat(40) }] }), /registered|claim/iu);
});

test('cancellation waits for speech helper quiescence and removes private staging', async (t) => {
	let started!: () => void;
	const began = new Promise<void>((resolve) => { started = resolve; });
	let quiesced = false;
	const runtime: SpeechRuntimeAdapter = Object.freeze({
		status: async () => ({ available: true, reason: null, moduleId: 'test' }),
		recognize: (request: Parameters<SpeechRuntimeAdapter['recognize']>[0]) => new Promise<never>((_resolve, reject) => {
			started();
			request.signal?.addEventListener('abort', () => setTimeout(() => {
				quiesced = true;
				reject(new DOMException('cancelled', 'AbortError'));
			}, 5), { once: true });
		}),
	});
	const { service, stagingRoot } = await fixture(t, { runtime });
	const request = await speechRequest(service);
	const running = service.run(request);
	const refused = assert.rejects(running, AssistanceOperationCancelledError);
	await began;
	const cancellation = await service.cancel(request.jobId);

	assert.equal(quiesced, true);
	assert.deepEqual(cancellation, { contractVersion: 1, jobId: request.jobId, outcome: 'cancelled' });
	await refused;
	await assert.rejects(lstat(join(stagingRoot, request.jobId)), /ENOENT/u);
	assert.deepEqual(await service.cancel(request.jobId), {
		contractVersion: 1, jobId: request.jobId, outcome: 'not-active',
	});
});
