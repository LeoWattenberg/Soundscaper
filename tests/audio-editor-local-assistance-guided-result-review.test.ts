/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import {
	reviewLocalAssistanceGuidedResult,
} from '../src/common/editor/ui/local-assistance-guided-result-review.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

test('Guided review reads only the closed terminal slot and strictly reviews captions', async () => {
	const workflow = assistanceWorkflowFixture();
	const captions = {
		schemaVersion: 1, kind: 'captions', sourceId: 'source-a', sampleRate: 48_000,
		alignmentApplied: false,
		cues: [{ cueId: 'caption:0', startFrame: 0, endFrame: 24_000, text: 'Hello', words: [] }],
	};
	const calls: string[] = [];
	const reviewed = await reviewLocalAssistanceGuidedResult({
		workflow, result: completedResult(workflow),
		readOutput: async ({ claim }) => {
			calls.push(`${claim.stageId}:${claim.slotId}`);
			return jsonBlob(captions, claim.slotId);
		},
	});
	assert.deepEqual(calls, ['assemble-captions:captions']);
	assert.equal(reviewed.workflowId, 'transcribe-captions');
	assert.equal(reviewed.outputs.length, 1);
	assert.equal(reviewed.outputs[0]?.slotId, 'captions');
	assert.deepEqual(reviewed.outputs[0]?.semantic, captions);
	assert.deepEqual(reviewed.choices, [{
		id: 'captions', kind: 'captions', label: '1 caption cue', selected: false, enabled: true,
	}]);
	assert.match(reviewed.outputs[0]?.sha256 ?? '', /^[a-f\d]{64}$/u);
});

test('Guided review rejects malformed terminal proposal bodies before they reach UI state', async () => {
	const workflow = assistanceWorkflowFixture();
	await assert.rejects(reviewLocalAssistanceGuidedResult({
		workflow, result: completedResult(workflow),
		readOutput: async ({ claim }) => jsonBlob({
			schemaVersion: 1, kind: 'captions', sourceId: 'source-a', sampleRate: 48_000,
			alignmentApplied: false,
			cues: [{ cueId: 'caption:0', startFrame: 5, endFrame: 4, text: 'bad', words: [] }],
		}, claim.slotId),
	}), /end frame|range|invalid/iu);

	await assert.rejects(reviewLocalAssistanceGuidedResult({
		workflow, result: { ...completedResult(workflow), outputs: workflow.outputs.slice(0, -1) },
		readOutput: async () => jsonBlob({}, 'captions'),
	}), /correlated|claims|outputs/iu);
});

test('Guided enhancement review requires exact adapter-owned WAV geometry authority', async () => {
	const workflow = enhancementWorkflow();
	const bytes = encodeWav([
		Float32Array.of(0.25, -0.25, 0.5),
		Float32Array.of(-0.5, 0.75, 0),
	], { sampleRate: 48_000, bitDepth: 32, float: true, dither: false });
	const body = new Blob([bytes.slice().buffer], { type: 'audio/wav' });
	await assert.rejects(reviewLocalAssistanceGuidedResult({
		workflow, result: completedResult(workflow), readOutput: async () => body,
	}), /geometry authority/iu);
	const reviewed = await reviewLocalAssistanceGuidedResult({
		workflow, result: completedResult(workflow), readOutput: async () => body,
		authority: { reviewAuthorityVersion: 1,
			audioWave: { sampleRate: 48_000, channelCount: 2, frameCount: 3 },
			editorialCandidateIds: null },
	});
	assert.deepEqual(reviewed.outputs[0]?.semantic, {
		kind: 'audio-wave', role: 'enhanced-audio', sampleRate: 48_000,
		channelCount: 2, frameCount: 3, sampleFormat: 'float32',
	});
	assert.deepEqual(reviewed.choices, [{
		id: 'enhanced-audio', kind: 'audio', label: 'Enhanced Dialogue',
		selected: false, enabled: true,
	}]);
});

function completedResult(workflow: AssistanceWorkflowV1) {
	return Object.freeze({ contractVersion: 1 as const, jobId: workflow.jobId,
		workflowId: workflow.workflowId, stageIds: workflow.stageIds, outputs: workflow.outputs });
}

function jsonBlob(value: unknown, slotId: string): Blob {
	return new Blob([JSON.stringify(value)], {
		type: `application/vnd.soundscaper.${slotId}+json`,
	});
}

function enhancementWorkflow(): AssistanceWorkflowV1 {
	const stageId = 'enhance-dialogue';
	const model = { bindingVersion: 1 as const, stageId, slotId: 'enhancer',
		modelId: 'deepfilternet3', version: '3.0.6', artifactSha256s: ['03'.repeat(32)] };
	const input = workflowClaim('input', stageId, 'audio', 1);
	const output = workflowClaim('output', stageId, 'enhanced-audio', 2);
	return assistanceWorkflowFixture({
		workflowId: 'enhance-dialogue', stageIds: [stageId], models: [model],
		inputs: [input], outputs: [output],
	});
}

function workflowClaim(
	direction: 'input' | 'output', stageId: string, slotId: string, index: number,
) {
	return Object.freeze({ claimVersion: 1 as const, direction,
		claimId: index.toString(16).padStart(40, '0'), jobId: WORKFLOW_JOB_ID, stageId, slotId });
}
