/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAssistanceOperationService } from '../desktop/assistance-operation-service.ts';
import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';

const DIGESTS = Object.freeze(['1', '2', '3', '4'].map((value) => value.repeat(64)));
const FENCE = Object.freeze({
	projectId: 'project-1', schemaVersion: 28, revision: 7, sequenceId: 'sequence-1',
	occurrenceIds: Object.freeze(['occurrence-1']), sourceId: 'source-1',
	sourceSha256: 'a'.repeat(64), sourceStartFrame: 0, sourceEndFrame: 48_000,
	linkMembershipSha256: 'b'.repeat(64), timingAuthoritySha256: 'c'.repeat(64),
});

test('main-owned aggregate custody can execute a staged primitive without claiming its job', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'assistance-staged-execution-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const registry = new AssistanceStagingRegistry({ root: join(temporary, 'staging') });
	const jobId = await registry.createJob();
	const input = await registry.stageInput({ jobId, role: 'audio', mediaType: 'audio/wav',
		byteLength: 10, bytes: chunks('RIFF-audio') });
	const output = await registry.reserveOutput({ jobId, role: 'transcript',
		mediaType: 'application/json', maximumByteLength: 8_192 });
	const recognized = Object.freeze({ language: 'en', segments: Object.freeze([
		Object.freeze({ startSeconds: 0, endSeconds: 1, text: 'hello' }),
	]) });
	const service = createAssistanceOperationService({
		registry,
		models: Object.freeze({
			status: async () => ({ runtimeAvailable: true, runtimeReason: null, models: [
				{ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0', task: 'speech-recognition',
					availability: 'installed' as const, downloadBytes: 4, installedBytes: 4,
					attributionRequired: true },
			] }),
			listInstalled: async () => [{ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0',
				totalBytes: 4, artifacts: [
					{ fileName: 'encoder.int8.onnx', byteLength: 1, sha256: DIGESTS[0]! },
					{ fileName: 'decoder.int8.onnx', byteLength: 1, sha256: DIGESTS[1]! },
					{ fileName: 'joiner.int8.onnx', byteLength: 1, sha256: DIGESTS[2]! },
					{ fileName: 'tokens.txt', byteLength: 1, sha256: DIGESTS[3]! },
				] }],
			resolveModelPaths: async () => ({ encoder: '/models/encoder', decoder: '/models/decoder',
				joiner: '/models/joiner', tokens: '/models/tokens' }),
		}),
		runtime: Object.freeze({
			status: async () => ({ available: true, reason: null, moduleId: 'test-runtime' }),
			recognize: async () => recognized,
		}),
	});
	const request = Object.freeze({
		contractVersion: 1 as const, jobId, operation: 'speech-recognition' as const,
		selectionFence: FENCE,
		models: Object.freeze([{ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0',
			artifactSha256s: DIGESTS }]),
		inputs: Object.freeze([input]), outputs: Object.freeze([output]),
	});

	await assert.rejects(service.run(request), /unknown|released/iu);
	const outcome = await service.executeStaged(request, new AbortController().signal);

	assert.equal(outcome.outcome, 'completed');
	if (outcome.outcome !== 'completed') return;
	const path = await registry.resolveOutputClaimPathForMain(jobId, outcome.result.outputs[0]!);
	assert.equal(await readFile(path, 'utf8'), JSON.stringify(recognized));
	await registry.releaseJob(jobId);
});

test('staged primitive execution obeys the aggregate cancellation authority', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'assistance-staged-cancel-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const registry = new AssistanceStagingRegistry({ root: join(temporary, 'staging') });
	const service = createAssistanceOperationService({
		registry,
		models: Object.freeze({ status: async () => ({ runtimeAvailable: true, runtimeReason: null,
			models: [] }), listInstalled: async () => [], resolveModelPaths: async () => ({}) }),
		runtime: Object.freeze({
			status: async () => ({ available: true, reason: null, moduleId: 'test-runtime' }),
			recognize: async () => { throw new Error('must not run'); },
		}),
	});
	const controller = new AbortController();
	controller.abort(new DOMException('cancelled', 'AbortError'));

	await assert.rejects(
		service.executeStaged(null, controller.signal),
		(error: unknown) => error instanceof DOMException && error.name === 'AbortError',
	);
});

function chunks(value: string): AsyncIterable<Uint8Array> {
	return Object.freeze({ async *[Symbol.asyncIterator]() { yield Buffer.from(value); } });
}
