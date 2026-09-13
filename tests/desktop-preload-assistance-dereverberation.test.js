/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { LOCAL_MODEL_TASKS } from '../desktop/local-model-catalog.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_CLAIM_ID = '2'.repeat(40);
const OUTPUT_CLAIM_ID = '3'.repeat(40);
const DIGEST = 'a'.repeat(64);
const FENCE = Object.freeze({
	fenceVersion: 1,
	projectId: 'project-1',
	schemaFamily: 'soundscaper',
	schemaVersion: 1,
	revision: 1,
	sequenceId: 'sequence-1',
	sourceRanges: [{
		slotId: 'primary-audio',
		mediaKind: 'audio',
		sourceId: 'source-1',
		sourceSha256: 'b'.repeat(64),
		sourceSampleRate: 44_100,
		occurrenceIds: ['occurrence-1'],
		sourceStartFrame: 0,
		sourceEndFrame: 44_100,
		linkMembershipSha256: 'c'.repeat(64),
		timingAuthoritySha256: 'd'.repeat(64),
		retimeKind: 'identity',
	}],
	transcriptBodySha256: null,
	recipeSha256: '1'.repeat(64),
	settingsSha256: '2'.repeat(64),
	modelBindingsSha256: '3'.repeat(64),
});

test('localAssistance admits every catalog model task through its authenticated choices', async () => {
	const models = LOCAL_MODEL_TASKS.map((task, index) => ({
		modelId: `catalog-task-${String(index)}`,
		version: '1.0.0',
		task,
		artifactSha256s: [DIGEST],
	}));
	const fixture = await loadPreload([models]);

	assert.deepEqual(
		plain(await fixture.bridge.localAssistance.models()).map(({ task }) => task),
		LOCAL_MODEL_TASKS,
	);
});

test('workflow preload closes guided and Advanced dereverberation to their exact recipes', async () => {
	const cases = [
		{ workflowId: 'reduce-reverb', stageId: 'reduce-reverb', modelSlotId: 'dereverberator' },
		{ workflowId: 'advanced:dereverberation', stageId: 'run-dereverberation',
			modelSlotId: 'model' },
	];
	for (const recipe of cases) {
		const request = dereverberationRequest(recipe);
		const unavailable = { contractVersion: 1, jobId: JOB_ID, workflowId: recipe.workflowId,
			outcome: 'unavailable', reason: 'stage-unavailable' };
		const fixture = await loadPreload([unavailable]);

		assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.run(request)), unavailable);
		assert.deepEqual(plain(fixture.invocations[0][1]), plain(request));
	}
});

test('workflow custody binds Reduced Reverb output to enhanced-audio WAV custody', async () => {
	const custody = Object.freeze({
		custodyVersion: 1,
		workflowId: 'reduce-reverb',
		direction: 'output',
		jobId: JOB_ID,
		stageId: 'reduce-reverb',
		slotId: 'dereverberated-audio',
		claimId: OUTPUT_CLAIM_ID,
		role: 'enhanced-audio',
		mediaType: 'audio/wav',
		byteLength: null,
		sha256: null,
		maximumByteLength: 4096,
		producer: null,
	});
	const handle = Object.freeze({ custody, workflowClaim: workflowClaim(
		'output', OUTPUT_CLAIM_ID, 'reduce-reverb', 'dereverberated-audio',
	) });
	const fixture = await loadPreload([handle]);

	assert.deepEqual(plain(await fixture.bridge.localAssistance.workflow.custody.reserveOutput({
		jobId: JOB_ID,
		workflowId: 'reduce-reverb',
		stageId: 'reduce-reverb',
		slotId: 'dereverberated-audio',
		maximumByteLength: 4096,
	})), plain(handle));
});

function dereverberationRequest({ workflowId, stageId, modelSlotId }) {
	return Object.freeze({
		contractVersion: 1,
		jobId: JOB_ID,
		workflowId,
		recipeVersion: 1,
		settingsVersion: 1,
		settings: workflowId === 'reduce-reverb'
			? { settingsVersion: 1, workflowId, placement: 'project-bin' }
			: { settingsVersion: 1, workflowId, operationSettings: {} },
		fence: FENCE,
		stageIds: [stageId],
		models: [{ bindingVersion: 1, stageId, slotId: modelSlotId,
			modelId: 'dereverb-room', version: '1.0.0', artifactSha256s: [DIGEST] }],
		inputs: [workflowClaim('input', INPUT_CLAIM_ID, stageId, 'audio')],
		outputs: [workflowClaim('output', OUTPUT_CLAIM_ID, stageId, 'dereverberated-audio')],
	});
}

function workflowClaim(direction, claimId, stageId, slotId) {
	return Object.freeze({ claimVersion: 1, direction, claimId, jobId: JOB_ID, stageId, slotId });
}

async function loadPreload(responses) {
	let bridge;
	const invocations = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, ArrayBuffer, Array, Blob, clearTimeout, console, crypto: webcrypto, Error, Map,
		MessageChannel, Number, Object, Promise, RangeError, Reflect, setTimeout, String,
		structuredClone, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; },
			},
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					return Promise.resolve(responses.shift());
				},
				postMessage() {}, send() {}, on() {}, removeListener() {},
			},
		}),
	});
	return { bridge, invocations };
}

function plain(value) {
	return JSON.parse(JSON.stringify(value));
}
