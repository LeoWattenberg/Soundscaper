/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

const JOB_ID = '1'.repeat(40);
const CLAIM_ID = '2'.repeat(40);
const STREAM_ID = '3'.repeat(40);
const DIGEST = 'a'.repeat(64);
const FENCE = Object.freeze({ projectId: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1, revision: 1,
	sequenceId: 'sequence-1', occurrenceIds: ['occurrence-1'], sourceId: 'source-1',
	sourceSha256: 'b'.repeat(64), sourceStartFrame: 0, sourceEndFrame: 48_000,
	linkMembershipSha256: 'c'.repeat(64), timingAuthoritySha256: 'd'.repeat(64) });
const INPUT = Object.freeze({ claimVersion: 1, claimId: CLAIM_ID, jobId: JOB_ID,
	role: 'audio', mediaType: 'audio/wav', byteLength: 4, sha256: DIGEST });
const OUTPUT = Object.freeze({ claimVersion: 1, claimId: '4'.repeat(40), jobId: JOB_ID,
	role: 'transcript', mediaType: 'application/json', maximumByteLength: 4096 });
const REQUEST = Object.freeze({ contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition',
	selectionFence: FENCE, models: [{ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0',
		artifactSha256s: [DIGEST] }], inputs: [INPUT], outputs: [OUTPUT] });
const WORKFLOW_REQUEST = Object.freeze({ contractVersion: 1, jobId: JOB_ID,
	workflowId: 'enhance-dialogue', recipeVersion: 1, settingsVersion: 1,
	settings: { settingsVersion: 1, workflowId: 'enhance-dialogue', placement: 'project-bin' },
	fence: { fenceVersion: 1, projectId: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1, revision: 1,
		sequenceId: 'sequence-1', sourceRanges: [{ slotId: 'primary-audio', mediaKind: 'audio',
			sourceId: 'source-1', sourceSha256: 'b'.repeat(64), sourceSampleRate: 48_000,
			occurrenceIds: ['occurrence-1'],
			sourceStartFrame: 0, sourceEndFrame: 48_000, linkMembershipSha256: 'c'.repeat(64),
			timingAuthoritySha256: 'd'.repeat(64), retimeKind: 'identity' }],
		transcriptBodySha256: null, recipeSha256: '1'.repeat(64), settingsSha256: '2'.repeat(64),
		modelBindingsSha256: '3'.repeat(64) },
	stageIds: ['enhance-dialogue'], models: [{ bindingVersion: 1, stageId: 'enhance-dialogue',
		slotId: 'enhancer', modelId: 'deepfilternet3', version: '3.0.0', artifactSha256s: [DIGEST] }],
	inputs: [{ claimVersion: 1, direction: 'input', claimId: CLAIM_ID, jobId: JOB_ID,
		stageId: 'enhance-dialogue', slotId: 'audio' }],
	outputs: [{ claimVersion: 1, direction: 'output', claimId: '4'.repeat(40), jobId: JOB_ID,
		stageId: 'enhance-dialogue', slotId: 'enhanced-audio' }] });

test('localAssistance exposes authenticated model choices and pathless control outcomes', async () => {
	const resultClaim = { ...OUTPUT, maximumByteLength: undefined, byteLength: 2, sha256: DIGEST };
	delete resultClaim.maximumByteLength;
	const fixture = await loadPreload({ responses: [
		[{ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0', task: 'speaker-segmentation',
			artifactSha256s: [DIGEST], path: '/private/model' }],
		{ contractVersion: 1, jobId: JOB_ID, path: '/private/staging' },
		OUTPUT,
		{ contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition', outcome: 'completed',
			result: { contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition', outputs: [resultClaim] },
			path: '/private/result' },
		{ contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled', path: '/private' },
		true,
	] });

	assert.deepEqual(plain(await fixture.bridge.localAssistance.models()), [{ modelId: 'parakeet-tdt-0.6b-v3',
		version: '3.0.0', task: 'speaker-segmentation', artifactSha256s: [DIGEST] }]);
	assert.deepEqual(plain(await fixture.bridge.localAssistance.createJob()), { contractVersion: 1, jobId: JOB_ID });
	assert.deepEqual(plain(await fixture.bridge.localAssistance.reserveOutput({ jobId: JOB_ID,
		role: 'transcript', mediaType: 'application/json', maximumByteLength: 4096 })), OUTPUT);
	const outcome = await fixture.bridge.localAssistance.run(REQUEST);
	assert.equal(outcome.outcome, 'completed');
	assert.doesNotMatch(JSON.stringify(outcome), /path|private/u);
	assert.deepEqual(plain(await fixture.bridge.localAssistance.cancel(JOB_ID)),
		{ contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled' });
	assert.equal(await fixture.bridge.localAssistance.release(JOB_ID), true);
});

test('stageInput transfers Blob bytes through a negotiated MessagePort, never control IPC', async () => {
	const body = new Blob(['RIFF']);
	const sha256 = createHash('sha256').update('RIFF').digest('hex');
	const reservation = { dataPlaneVersion: 1, transport: 'message-port', streamId: STREAM_ID,
		direction: 'host-to-helper', authentication: 'trailer-sha256-v1', byteLength: 4,
		maximumChunkBytes: 2, maximumInFlightChunks: 1 };
	const claim = { ...INPUT, sha256 };
	const transferred = [];
	const fixture = await loadPreload({ responses: [
		{ contractVersion: 1, jobId: JOB_ID, streamId: STREAM_ID, reservation }, claim,
	], onPostMessage(channel, control, ports) {
		assert.equal(channel, 'soundscaper:v1:assistance:operation:input-port');
		assert.deepEqual(plain(control), { jobId: JOB_ID, streamId: STREAM_ID, reservation });
		const port = ports[0];
		port.on('message', (message) => {
			if (message.type === 'chunk') {
				transferred.push(message.bytes);
				port.postMessage({ dataPlaneVersion: 1, type: 'ack', streamId: STREAM_ID,
					sequence: message.sequence, receivedBytes: message.offset + message.bytes.byteLength });
			} else assert.deepEqual(message, { dataPlaneVersion: 1, type: 'complete', streamId: STREAM_ID,
				byteLength: 4, sha256 });
		});
	} });

	assert.deepEqual(plain(await fixture.bridge.localAssistance.stageInput({ jobId: JOB_ID,
		role: 'audio', mediaType: 'audio/wav', sha256, bytes: body })), claim);
	assert.equal(Buffer.concat(transferred).toString(), 'RIFF');
	assert.equal(fixture.invocations[0][1].bytes, undefined);
});

test('readOutput receives exact bytes through a negotiated MessagePort and returns a typed Blob', async () => {
	const body = Buffer.from('{"segments":[]}');
	const sha256 = createHash('sha256').update(body).digest('hex');
	const claim = { claimVersion: 1, claimId: CLAIM_ID, jobId: JOB_ID,
		role: 'transcript', mediaType: 'application/json', byteLength: body.byteLength, sha256 };
	const binding = { dataPlaneVersion: 1, transport: 'message-port', streamId: STREAM_ID,
		direction: 'helper-to-host', byteLength: body.byteLength, sha256,
		maximumChunkBytes: 1024, maximumInFlightChunks: 1 };
	const fixture = await loadPreload({ responses: [{ contractVersion: 1, jobId: JOB_ID, binding }],
		onPostMessage(channel, control, ports) {
			assert.equal(channel, 'soundscaper:v1:assistance:operation:output-port');
			assert.deepEqual(plain(control), { jobId: JOB_ID, streamId: STREAM_ID, binding });
			const port = ports[0];
			port.on('message', (message) => {
				if (message.type === 'ack') port.postMessage({ dataPlaneVersion: 1, type: 'complete',
					streamId: STREAM_ID, byteLength: body.byteLength, sha256 });
			});
			port.postMessage({ dataPlaneVersion: 1, type: 'chunk', streamId: STREAM_ID,
				sequence: 0, offset: 0, bytes: body });
		} });

	const result = await fixture.bridge.localAssistance.readOutput({ jobId: JOB_ID, claim });
	assert.equal(result.type, 'application/json');
	assert.equal(Buffer.from(await result.arrayBuffer()).toString(), body.toString());
});

test('operation progress and unavailable outcomes are strict, correlated, and pathless', async () => {
	const fixture = await loadPreload({ responses: [{ contractVersion: 1, jobId: JOB_ID,
		operation: 'audio-tagging', outcome: 'unavailable', reason: 'adapter-unavailable', path: '/private' }] });
	const unavailable = await fixture.bridge.localAssistance.run({ ...REQUEST, operation: 'audio-tagging',
		outputs: [{ ...OUTPUT, role: 'audio-tags' }] });
	assert.deepEqual(plain(unavailable), { contractVersion: 1, jobId: JOB_ID,
		operation: 'audio-tagging', outcome: 'unavailable', reason: 'adapter-unavailable' });
	const seen = [];
	fixture.bridge.localAssistance.onProgress((value) => seen.push(value));
	fixture.emit('soundscaper:v1:event:assistance-operation-progress', { contractVersion: 1,
		jobId: JOB_ID, operation: 'audio-tagging', sequence: 0, phase: 'queued', completed: null,
		total: null, path: '/private' });
	assert.deepEqual(plain(seen), [{ contractVersion: 1, jobId: JOB_ID, operation: 'audio-tagging',
		sequence: 0, phase: 'queued', completed: null, total: null }]);
});

test('main-owned consent decline remains a closed correlated outcome', async () => {
	const fixture = await loadPreload({ responses: [{ contractVersion: 1, jobId: JOB_ID,
		operation: 'speech-recognition', outcome: 'consent-declined' }] });
	assert.deepEqual(plain(await fixture.bridge.localAssistance.run(REQUEST)), {
		contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition', outcome: 'consent-declined',
	});

	const malformed = await loadPreload({ responses: [{ contractVersion: 1, jobId: JOB_ID,
		operation: 'speech-recognition', outcome: 'consent-declined', path: '/private' }] });
	await assert.rejects(malformed.bridge.localAssistance.run(REQUEST), /Malformed unavailable assistance operation/u);
});

test('the shared preload exposes strict workflow create, run, cancel, and progress methods', async () => {
	const result = { contractVersion: 1, jobId: JOB_ID, workflowId: 'enhance-dialogue',
		stageIds: ['enhance-dialogue'], outputs: WORKFLOW_REQUEST.outputs };
	const fixture = await loadPreload({ responses: [
		{ contractVersion: 1, jobId: JOB_ID },
		{ contractVersion: 1, jobId: JOB_ID, workflowId: 'enhance-dialogue', outcome: 'completed', result },
		{ contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled' },
	] });
	assert.equal(typeof fixture.bridge.localAssistance.run, 'function', 'operation-v1 remains unchanged');
	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.createJob()), {
		contractVersion: 1, jobId: JOB_ID,
	});
	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.run(WORKFLOW_REQUEST)), {
		contractVersion: 1, jobId: JOB_ID, workflowId: 'enhance-dialogue', outcome: 'completed', result,
	});
	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.cancel(JOB_ID)), {
		contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled',
	});
	assert.deepEqual(fixture.invocations.map(([channel]) => channel), [
		'soundscaper:v1:assistance:workflow:create',
		'soundscaper:v1:assistance:workflow:run',
		'soundscaper:v1:assistance:workflow:cancel',
	]);
	const seen = [];
	fixture.bridge.localAssistance.workflow.onProgress((value) => seen.push(value));
	fixture.emit('soundscaper:v1:event:assistance-workflow-progress', { contractVersion: 1,
		jobId: JOB_ID, workflowId: 'enhance-dialogue', sequence: 0, stageId: 'enhance-dialogue',
		stageIndex: 0, stageCount: 1, phase: 'running', completed: 1, total: 2 });
	assert.deepEqual(plain(seen), [{ contractVersion: 1, jobId: JOB_ID,
		workflowId: 'enhance-dialogue', sequence: 0, stageId: 'enhance-dialogue', stageIndex: 0,
		stageCount: 1, phase: 'running', completed: 1, total: 2 }]);
});

test('workflow preload validation rejects renderer stage injection and path-bearing main answers', async () => {
	const injected = await loadPreload({ responses: [] });
	await assert.rejects(injected.bridge.localAssistance.workflow.run({
		...WORKFLOW_REQUEST, operations: ['execute-shell'],
	}), /workflow|schema|fields/iu);
	assert.equal(injected.invocations.length, 0);

	const malformed = await loadPreload({ responses: [{ contractVersion: 1, jobId: JOB_ID,
		workflowId: 'enhance-dialogue', outcome: 'consent-declined', path: '/private/source.wav' }] });
	await assert.rejects(malformed.bridge.localAssistance.workflow.run(WORKFLOW_REQUEST),
		/workflow|schema|fields|outcome/iu);
});

test('workflow preload closes every Advanced primitive to its exact single-stage recipe', async () => {
	const stageId = 'run-speech-recognition';
	const advanced = Object.freeze({ ...WORKFLOW_REQUEST,
		workflowId: 'advanced:speech-recognition',
		settings: { settingsVersion: 1, workflowId: 'advanced:speech-recognition', operationSettings: {} },
		stageIds: [stageId],
		models: [{ ...WORKFLOW_REQUEST.models[0], stageId, slotId: 'model' }],
		inputs: [{ ...WORKFLOW_REQUEST.inputs[0], stageId, slotId: 'audio' }],
		outputs: [{ ...WORKFLOW_REQUEST.outputs[0], stageId, slotId: 'transcript' }],
	});
	const unavailable = { contractVersion: 1, jobId: JOB_ID,
		workflowId: advanced.workflowId, outcome: 'unavailable', reason: 'stage-unavailable' };
	const fixture = await loadPreload({ responses: [unavailable] });
	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.run(advanced)), unavailable);
	assert.deepEqual(plain(fixture.invocations[0][1]), plain(advanced));

	const invalid = [
		{ ...advanced, workflowId: 'advanced:not-an-operation' },
		{ ...advanced, stageIds: ['recognize-speech'] },
		{ ...advanced, inputs: [{ ...advanced.inputs[0], slotId: 'input' }] },
		{ ...advanced, models: [{ ...advanced.models[0], slotId: 'embedder' }] },
		{ ...advanced, outputs: [{ ...advanced.outputs[0], slotId: 'output' }] },
	];
	for (const request of invalid) {
		const rejected = await loadPreload({ responses: [] });
		await assert.rejects(rejected.bridge.localAssistance.workflow.run(request),
			/workflow|stage|slot|operation/iu);
		assert.equal(rejected.invocations.length, 0);
	}
});

test('workflow preload admits repeated frame-pack claims only for one input slot', async () => {
	const stageId = 'run-saliency-detection';
	const claim = (direction, claimId, slotId) => Object.freeze({ claimVersion: 1,
		direction, claimId, jobId: JOB_ID, stageId, slotId });
	const request = Object.freeze({ ...WORKFLOW_REQUEST,
		workflowId: 'advanced:saliency-detection',
		settings: { settingsVersion: 1, workflowId: 'advanced:saliency-detection',
			operationSettings: {} },
		stageIds: [stageId],
		models: [{ ...WORKFLOW_REQUEST.models[0], stageId, slotId: 'model' }],
		inputs: [claim('input', '5'.repeat(40), 'frame-pack'),
			claim('input', '6'.repeat(40), 'frame-pack')],
		outputs: [claim('output', '7'.repeat(40), 'saliency-map')],
	});
	const unavailable = { contractVersion: 1, jobId: JOB_ID,
		workflowId: request.workflowId, outcome: 'unavailable', reason: 'stage-unavailable' };
	const fixture = await loadPreload({ responses: [unavailable] });
	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.run(request)), unavailable);
	assert.deepEqual(plain(fixture.invocations[0][1].inputs), plain(request.inputs));
	const duplicate = await loadPreload({ responses: [] });
	await assert.rejects(duplicate.bridge.localAssistance.workflow.run({ ...request,
		inputs: [request.inputs[0], { ...request.inputs[1], claimId: request.inputs[0].claimId }],
	}), /repeat|slot|workflow/iu);
	assert.equal(duplicate.invocations.length, 0);

	const rejected = await loadPreload({ responses: [] });
	await assert.rejects(rejected.bridge.localAssistance.workflow.run({ ...request,
		workflowId: 'advanced:speech-enhancement',
		settings: { settingsVersion: 1, workflowId: 'advanced:speech-enhancement',
			operationSettings: {} },
		stageIds: ['run-speech-enhancement'],
		models: request.models.map((model) => ({ ...model,
			stageId: 'run-speech-enhancement' })),
		inputs: request.inputs.map((input) => ({ ...input,
			stageId: 'run-speech-enhancement', slotId: 'audio' })),
		outputs: request.outputs.map((output) => ({ ...output,
			stageId: 'run-speech-enhancement', slotId: 'enhanced-audio' })),
	}), /repeat|slot|workflow/iu);
	assert.equal(rejected.invocations.length, 0);
});

test('workflow preload keeps Index Video OCR optional end to end', async () => {
	const claim = (direction, claimId, stageId, slotId) => Object.freeze({ claimVersion: 1,
		direction, claimId, jobId: JOB_ID, stageId, slotId });
	const request = Object.freeze({ ...WORKFLOW_REQUEST, workflowId: 'index-video',
		settings: { settingsVersion: 1, workflowId: 'index-video', shotMode: 'fast', includeOcr: false },
		stageIds: ['detect-shots', 'sample-shot-frames', 'embed-visuals', 'publish-video-index'],
		models: [{ ...WORKFLOW_REQUEST.models[0], stageId: 'embed-visuals',
			slotId: 'visual-embedder' }],
		inputs: [
			claim('input', '5'.repeat(40), 'detect-shots', 'video'),
			claim('input', '6'.repeat(40), 'sample-shot-frames', 'video'),
			claim('input', '7'.repeat(40), 'sample-shot-frames', 'video-authority'),
			claim('input', '8'.repeat(40), 'sample-shot-frames', 'shot-boundaries'),
			claim('input', '9'.repeat(40), 'embed-visuals', 'frame-pack'),
			claim('input', 'a'.repeat(40), 'publish-video-index', 'visual-embeddings'),
		],
		outputs: [
			claim('output', '8'.repeat(40), 'detect-shots', 'shot-boundaries'),
			claim('output', '9'.repeat(40), 'sample-shot-frames', 'frame-pack'),
			claim('output', 'a'.repeat(40), 'embed-visuals', 'visual-embeddings'),
			claim('output', 'b'.repeat(40), 'publish-video-index', 'video-index'),
		],
	});
	const unavailable = { contractVersion: 1, jobId: JOB_ID,
		workflowId: request.workflowId, outcome: 'unavailable', reason: 'stage-unavailable' };
	const fixture = await loadPreload({ responses: [unavailable] });
	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.run(request)), unavailable);
	assert.equal(fixture.invocations.length, 1);
});

test('workflow preload requires transcript chunks beside embeddings for index publication', async () => {
	const claim = (direction, claimId, stageId, slotId) => Object.freeze({ claimVersion: 1,
		direction, claimId, jobId: JOB_ID, stageId, slotId });
	const request = Object.freeze({ ...WORKFLOW_REQUEST, workflowId: 'index-transcript',
		settings: { settingsVersion: 1, workflowId: 'index-transcript' },
		stageIds: ['chunk-transcript', 'embed-transcript', 'publish-transcript-index'],
		models: [{ bindingVersion: 1, stageId: 'embed-transcript', slotId: 'text-embedder',
			modelId: 'nomic-embed-text-v1.5', version: '1.5.0', artifactSha256s: [DIGEST] }],
		inputs: [
			claim('input', '5'.repeat(40), 'chunk-transcript', 'transcript'),
			claim('input', '6'.repeat(40), 'embed-transcript', 'text-chunks'),
			claim('input', '7'.repeat(40), 'publish-transcript-index', 'text-chunks'),
			claim('input', '8'.repeat(40), 'publish-transcript-index', 'embeddings'),
		],
		outputs: [
			claim('output', '9'.repeat(40), 'chunk-transcript', 'text-chunks'),
			claim('output', 'a'.repeat(40), 'embed-transcript', 'embeddings'),
			claim('output', 'b'.repeat(40), 'publish-transcript-index', 'transcript-index'),
		],
	});
	const fixture = await loadPreload({ responses: [{ contractVersion: 1, jobId: JOB_ID,
		workflowId: 'index-transcript', outcome: 'unavailable', reason: 'stage-unavailable' }] });
	await fixture.bridge.localAssistance.workflow.run(request);
	assert.deepEqual(plain(fixture.invocations[0][1].inputs), plain(request.inputs));

	const omitted = await loadPreload({ responses: [] });
	await assert.rejects(omitted.bridge.localAssistance.workflow.run({ ...request,
		inputs: request.inputs.filter(({ stageId, slotId }) =>
			stageId !== 'publish-transcript-index' || slotId !== 'text-chunks'),
	}), /required workflow input|workflow/iu);
	assert.equal(omitted.invocations.length, 0);
});

test('workflow custody stages exact Blobs and reserves pathless slotted outputs', async () => {
	const body = new Blob(['RIFF'], { type: 'audio/wav' });
	const sha256 = createHash('sha256').update('RIFF').digest('hex');
	const reservation = { dataPlaneVersion: 1, transport: 'message-port', streamId: STREAM_ID,
		direction: 'host-to-helper', authentication: 'trailer-sha256-v1', byteLength: 4,
		maximumChunkBytes: 2, maximumInFlightChunks: 1 };
	const inputCustody = workflowCustody({ direction: 'input', claimId: CLAIM_ID,
		stageId: 'enhance-dialogue', slotId: 'audio', role: 'audio', mediaType: 'audio/wav',
		byteLength: 4, sha256, maximumByteLength: null });
	const outputCustody = workflowCustody({ direction: 'output', claimId: '4'.repeat(40),
		stageId: 'enhance-dialogue', slotId: 'enhanced-audio', role: 'enhanced-audio',
		mediaType: 'audio/wav', byteLength: null, sha256: null, maximumByteLength: 4096 });
	const transferred = [];
	const fixture = await loadPreload({ responses: [
		{ contractVersion: 1, jobId: JOB_ID, streamId: STREAM_ID, reservation },
		workflowCustodyHandle(inputCustody), workflowCustodyHandle(outputCustody), true,
	], onPostMessage(channel, control, ports) {
		assert.equal(channel, 'soundscaper:v1:assistance:workflow:input-port');
		assert.deepEqual(plain(control), { jobId: JOB_ID, streamId: STREAM_ID, reservation });
		const port = ports[0];
		port.on('message', (message) => {
			if (message.type === 'chunk') {
				transferred.push(message.bytes);
				port.postMessage({ dataPlaneVersion: 1, type: 'ack', streamId: STREAM_ID,
					sequence: message.sequence, receivedBytes: message.offset + message.bytes.byteLength });
			}
		});
	} });

	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.custody.stageInput({
		jobId: JOB_ID, workflowId: 'enhance-dialogue', stageId: 'enhance-dialogue', slotId: 'audio',
		mediaType: 'audio/wav', byteLength: 4, sha256, bytes: body,
	})), plain(workflowCustodyHandle(inputCustody)));
	assert.equal(Buffer.concat(transferred).toString(), 'RIFF');
	assert.equal(fixture.invocations[0][1].bytes, undefined);
	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.custody.reserveOutput({
		jobId: JOB_ID, workflowId: 'enhance-dialogue', stageId: 'enhance-dialogue',
		slotId: 'enhanced-audio', maximumByteLength: 4096,
	})), plain(workflowCustodyHandle(outputCustody)));
	assert.equal(await fixture.bridge.localAssistance.workflow.custody.release(JOB_ID), true);
});

test('workflow preload admits selected-video authority only through its closed Index Video slot', async () => {
	const text = '{"schemaVersion":1}';
	const body = new Blob([text], { type: 'application/vnd.soundscaper.video-authority+json' });
	const bytes = Buffer.from(text);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const reservation = { dataPlaneVersion: 1, transport: 'message-port', streamId: STREAM_ID,
		direction: 'host-to-helper', authentication: 'trailer-sha256-v1',
		byteLength: bytes.byteLength, maximumChunkBytes: bytes.byteLength, maximumInFlightChunks: 1 };
	const custody = workflowCustody({ workflowId: 'index-video', direction: 'input',
		claimId: CLAIM_ID, stageId: 'sample-shot-frames', slotId: 'video-authority',
		role: 'video-authority', mediaType: body.type, byteLength: bytes.byteLength,
		sha256, maximumByteLength: null });
	const fixture = await loadPreload({ responses: [
		{ contractVersion: 1, jobId: JOB_ID, streamId: STREAM_ID, reservation },
		workflowCustodyHandle(custody),
	], onPostMessage(_channel, _control, ports) {
		ports[0].on('message', (message) => {
			if (message.type === 'chunk') ports[0].postMessage({ dataPlaneVersion: 1, type: 'ack',
				streamId: STREAM_ID, sequence: message.sequence,
				receivedBytes: message.offset + message.bytes.byteLength });
		});
	} });
	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.custody.stageInput({
		jobId: JOB_ID, workflowId: 'index-video', stageId: 'sample-shot-frames',
		slotId: 'video-authority', mediaType: body.type, byteLength: bytes.byteLength,
		sha256, bytes: body,
	})), plain(workflowCustodyHandle(custody)));
});

test('workflow preload closes Highlight raw stages and normalized gather signal custody', async () => {
	const cases = [
		{ stageId: 'detect-highlight-shots', slotId: 'video', role: 'video',
			mediaType: 'video/mp4', text: 'ftyp' },
		{ stageId: 'tag-highlight-reactions', slotId: 'audio', role: 'audio',
			mediaType: 'audio/wav', text: 'RIFF' },
		{ stageId: 'gather-signals', slotId: 'video', role: 'highlight-video-signals',
			mediaType: 'application/vnd.soundscaper.highlight-video-signals+json', text: '{}' },
		{ stageId: 'gather-signals', slotId: 'audio', role: 'highlight-audio-signals',
			mediaType: 'application/vnd.soundscaper.highlight-audio-signals+json', text: '{}' },
		{ stageId: 'gather-signals', slotId: 'transcript', role: 'highlight-transcript-signals',
			mediaType: 'application/vnd.soundscaper.highlight-transcript-signals+json', text: '{}' },
	];
	const prepared = cases.map((item, index) => {
		const bytes = Buffer.from(item.text);
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		const custody = workflowCustody({ workflowId: 'make-highlights', direction: 'input',
			claimId: (index + 5).toString(16).repeat(40), stageId: item.stageId, slotId: item.slotId,
			role: item.role, mediaType: item.mediaType, byteLength: bytes.byteLength,
			sha256, maximumByteLength: null });
		const reservation = { dataPlaneVersion: 1, transport: 'message-port', streamId: STREAM_ID,
			direction: 'host-to-helper', authentication: 'trailer-sha256-v1',
			byteLength: bytes.byteLength, maximumChunkBytes: bytes.byteLength,
			maximumInFlightChunks: 1 };
		return { ...item, bytes, sha256, custody, reservation };
	});
	const fixture = await loadPreload({
		responses: prepared.flatMap(({ reservation, custody }) => [
			{ contractVersion: 1, jobId: JOB_ID, streamId: STREAM_ID, reservation },
			workflowCustodyHandle(custody),
		]),
		onPostMessage(_channel, _control, ports) {
			ports[0].on('message', (message) => {
				if (message.type === 'chunk') ports[0].postMessage({ dataPlaneVersion: 1, type: 'ack',
					streamId: STREAM_ID, sequence: message.sequence,
					receivedBytes: message.offset + message.bytes.byteLength });
			});
		},
	});
	for (const item of prepared) {
		const result = await fixture.bridge.localAssistance.workflow.custody.stageInput({
			jobId: JOB_ID, workflowId: 'make-highlights', stageId: item.stageId,
			slotId: item.slotId, mediaType: item.mediaType, byteLength: item.bytes.byteLength,
			sha256: item.sha256, bytes: new Blob([item.bytes], { type: item.mediaType }),
		});
		assert.equal(result.custody.role, item.role);
	}

	const generic = await loadPreload({ responses: [] });
	const bytes = Buffer.from('{}');
	await assert.rejects(generic.bridge.localAssistance.workflow.custody.stageInput({
		jobId: JOB_ID, workflowId: 'make-highlights', stageId: 'gather-signals', slotId: 'video',
		mediaType: 'application/json', byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		bytes: new Blob([bytes], { type: 'application/json' }),
	}), /Blob|slot|media/iu);
	assert.equal(generic.invocations.length, 0);
});

test('workflow custody binds only one exact earlier producer and strips no hidden path', async () => {
	const producer = workflowCustody({ workflowId: 'transcribe-captions', direction: 'output',
		claimId: '5'.repeat(40), stageId: 'recognize-speech', slotId: 'transcript', role: 'transcript',
		mediaType: 'application/json', byteLength: null, sha256: null, maximumByteLength: 4096 });
	const input = workflowCustody({ workflowId: 'transcribe-captions', direction: 'input',
		claimId: producer.claimId, stageId: 'assemble-captions', slotId: 'transcript',
		role: 'transcript', mediaType: 'application/json', byteLength: null, sha256: null,
		maximumByteLength: 4096, producer: { stageId: producer.stageId, slotId: producer.slotId,
			claimId: producer.claimId } });
	const fixture = await loadPreload({ responses: [workflowCustodyHandle(input)] });
	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.custody.bindProducer({
		jobId: JOB_ID, workflowId: 'transcribe-captions', stageId: 'assemble-captions',
		slotId: 'transcript', producer,
	})), plain(workflowCustodyHandle(input)));
	assert.deepEqual(plain(fixture.invocations[0]), [
		'soundscaper:v1:assistance:workflow:bind-producer', {
			jobId: JOB_ID, workflowId: 'transcribe-captions', stageId: 'assemble-captions',
			slotId: 'transcript', producerStageId: 'recognize-speech', producerSlotId: 'transcript',
			producerClaimId: producer.claimId,
		},
	]);

	const injected = await loadPreload({ responses: [] });
	await assert.rejects(injected.bridge.localAssistance.workflow.custody.bindProducer({
		jobId: JOB_ID, workflowId: 'transcribe-captions', stageId: 'assemble-captions',
		slotId: 'transcript', producer: { ...producer, path: '/private/result.json' },
	}), /custody|fields|invalid/iu);
	assert.equal(injected.invocations.length, 0);
});

test('workflow output review revalidates exact slotted bytes over a pathless MessagePort', async () => {
	const body = Buffer.from('RIFF-reviewed');
	const sha256 = createHash('sha256').update(body).digest('hex');
	const workflowClaim = WORKFLOW_REQUEST.outputs[0];
	const binding = { dataPlaneVersion: 1, transport: 'message-port', streamId: STREAM_ID,
		direction: 'helper-to-host', byteLength: body.byteLength, sha256,
		maximumChunkBytes: 1024, maximumInFlightChunks: 1 };
	const offer = { contractVersion: 1, jobId: JOB_ID, workflowId: 'enhance-dialogue',
		workflowClaim, mediaType: 'audio/wav', binding };
	const fixture = await loadPreload({ responses: [offer],
		onPostMessage(channel, control, ports) {
			assert.equal(channel, 'soundscaper:v1:assistance:workflow:output-port');
			assert.deepEqual(plain(control), { jobId: JOB_ID, workflowId: 'enhance-dialogue',
				workflowClaim, streamId: STREAM_ID, binding });
			const port = ports[0];
			port.on('message', (message) => {
				if (message.type === 'ack') port.postMessage({ dataPlaneVersion: 1, type: 'complete',
					streamId: STREAM_ID, byteLength: body.byteLength, sha256 });
			});
			port.postMessage({ dataPlaneVersion: 1, type: 'chunk', streamId: STREAM_ID,
				sequence: 0, offset: 0, bytes: body });
		} });
	const reviewed = await fixture.bridge.localAssistance.workflow.readOutput({ jobId: JOB_ID,
		workflowId: 'enhance-dialogue', claim: workflowClaim });
	assert.equal(reviewed.type, 'audio/wav');
	assert.equal(Buffer.from(await reviewed.arrayBuffer()).toString(), body.toString());
	assert.doesNotMatch(JSON.stringify(fixture.invocations), /path|private/iu);

	const malformed = await loadPreload({ responses: [{ ...offer, path: '/private/result.wav' }] });
	await assert.rejects(malformed.bridge.localAssistance.workflow.readOutput({ jobId: JOB_ID,
		workflowId: 'enhance-dialogue', claim: workflowClaim }), /workflow|offer|fields/iu);

	const corrupt = await loadPreload({ responses: [offer], onPostMessage(_channel, _control, ports) {
		const port = ports[0];
		const bytes = Buffer.alloc(body.byteLength, 120);
		port.on('message', (message) => {
			if (message.type === 'ack') port.postMessage({ dataPlaneVersion: 1, type: 'complete',
				streamId: STREAM_ID, byteLength: body.byteLength, sha256 });
		});
		port.postMessage({ dataPlaneVersion: 1, type: 'chunk', streamId: STREAM_ID,
			sequence: 0, offset: 0, bytes });
	} });
	await assert.rejects(corrupt.bridge.localAssistance.workflow.readOutput({ jobId: JOB_ID,
		workflowId: 'enhance-dialogue', claim: workflowClaim }), /digest/iu);
});

async function loadPreload({ responses, onPostMessage = () => {} }) {
	let bridge;
	const invocations = [];
	const listeners = new Map();
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, { AggregateError, ArrayBuffer, Array, Blob, clearTimeout, console,
		crypto: webcrypto, Error, Map, MessageChannel, Number, Object, Promise, RangeError, Reflect,
		setTimeout, String, structuredClone, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; } },
			ipcRenderer: {
				invoke(channel, value) { invocations.push([channel, value]); return Promise.resolve(responses.shift()); },
				postMessage: onPostMessage, send() {}, on: (channel, handler) => listeners.set(channel, handler),
				removeListener: (channel) => listeners.delete(channel),
			},
		}),
	});
	return { bridge, invocations, emit: (channel, value) => listeners.get(channel)?.(null, value) };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function workflowCustody(value) {
	return Object.freeze({ custodyVersion: 1, workflowId: 'enhance-dialogue', jobId: JOB_ID,
		producer: null, ...value });
}

function workflowCustodyHandle(custody) {
	return Object.freeze({ custody, workflowClaim: Object.freeze({ claimVersion: 1,
		direction: custody.direction, claimId: custody.claimId, jobId: custody.jobId,
		stageId: custody.stageId, slotId: custody.slotId }) });
}
