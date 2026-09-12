/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { executeModelOperation, modelOutputReservations } from './electron/local-assistance-models/model-operation.js';

test('nightly IPC harness preserves multiple input claims and ordered, separately authenticated stems', async () => {
	const harness = fixture();
	try {
		const result = await executeModelOperation(harness.page, harness.request);
		assert.equal(harness.runs[0].inputs.length, 2);
		assert.deepEqual(harness.runs[0].inputs.map(({ role }) => role), ['audio', 'transcript']);
		assert.deepEqual(result.outputs.map(({ claim }) => claim.claimId), ['output-0', 'output-1', 'output-2']);
		assert.deepEqual(result.outputs.map(({ bytes }) => bytes), [[0], [1], [2]]);
		assert.equal(harness.released.length, 1);
	} finally { harness.restore(); }
});

test('nightly IPC harness rejects missing, duplicate, and relabelled output claims and releases custody', async () => {
	for (const mutate of [
		(outputs) => outputs.slice(0, 2),
		(outputs) => [outputs[0], outputs[0], outputs[2]],
		(outputs) => outputs.map((row) => ({ ...row, role: 'foreign' })),
	]) {
		const harness = fixture(mutate);
		try {
			await assert.rejects(executeModelOperation(harness.page, harness.request), /output.*(count|identity)/u);
			assert.equal(harness.released.length, 1);
		} finally { harness.restore(); }
	}
});

test('nightly IPC harness rejects a different installed model before creating a job', async () => {
	const harness = fixture();
	try {
		harness.request.expectedModels[0].version = '2.0.0';
		await assert.rejects(executeModelOperation(harness.page, harness.request), /differs from the test catalog/u);
		assert.equal(harness.jobs.length, 0);
	} finally { harness.restore(); }
});

function fixture(mutate = (outputs) => outputs.toReversed()) {
	const previous = globalThis.soundscaperDesktop;
	const runs = [], released = [], jobs = [], reservations = [];
	const model = { modelId: 'test-model', version: '1.0.0', artifactSha256s: ['a'.repeat(64)] };
	globalThis.soundscaperDesktop = { v1: { localAssistance: {
		models: () => [model],
		createJob: () => { jobs.push('job'); return { jobId: 'job' }; },
		onProgress: () => () => {},
		stageInput: (input) => ({ role: input.role, claimId: `input-${input.role}` }),
		reserveOutput: (output) => {
			const reservation = { ...output, claimId: `output-${reservations.length}` };
			reservations.push(reservation); return reservation;
		},
		run: (request) => {
			runs.push(request);
			return { outcome: 'completed', result: { outputs: mutate(request.outputs.map((row) => ({ ...row, byteLength: 1 }))) } };
		},
		readOutput: ({ claim }) => new Blob([Uint8Array.of(Number(claim.claimId.at(-1)))]),
		release: (jobId) => released.push(jobId),
	} } };
	return { page: { evaluate: (callback, request) => callback(request) }, runs, released, jobs,
		request: { operation: 'source-separation', expectedModels: [structuredClone(model)], selectionFence: {},
			inputs: ['audio', 'transcript'].map((role) => ({ role, mediaType: 'application/octet-stream', sha256: 'b'.repeat(64), base64: 'YQ==' })),
			outputs: modelOutputReservations('source-separation') },
		restore: () => { if (previous === undefined) delete globalThis.soundscaperDesktop; else globalThis.soundscaperDesktop = previous; },
	};
}
