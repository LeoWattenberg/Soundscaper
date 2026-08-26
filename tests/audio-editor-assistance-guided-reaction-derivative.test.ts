/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	retainLocalAssistanceGuidedReactionScores,
} from '../src/common/editor/controller/local-assistance-guided-reaction-derivative.ts';
import { AssistanceDerivativeRepository } from
	'../src/common/editor/storage/assistance-derivative-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from
	'./helpers/assistance-workflow-fixture.ts';

const MEDIA_TYPE = 'application/vnd.soundscaper.audio-tags+json';

test('reviewed PANNs windows are retained only in authenticated disposable project custody', async () => {
	const workflow = reactionWorkflow();
	const repository = derivativeRepository();
	const semantic = audioTags();
	const record = await retainLocalAssistanceGuidedReactionScores({ workflow, repository,
		currentProject: () => ({ projectId: 'project-a', projectRevision: 8 }),
		readOutput: async ({ claim }) => {
			assert.equal(`${claim.stageId}:${claim.slotId}`, 'tag-reactions:audio-tags');
			return new Blob([` ${JSON.stringify(semantic)} `], { type: MEDIA_TYPE });
		},
	});
	assert.equal(record.kind, 'audio-tags');
	assert.equal(record.mediaType, MEDIA_TYPE);
	assert.deepEqual(JSON.parse(new TextDecoder().decode(record.bytes)), semantic);
	assert.deepEqual((await repository.listProject('project-a')).map(({ kind }) => kind),
		['audio-tags']);
});

test('reaction score retention refuses stale, malformed, and foreign workflow custody', async () => {
	const workflow = reactionWorkflow();
	const repository = derivativeRepository();
	const base = { workflow, repository,
		currentProject: () => ({ projectId: 'project-a', projectRevision: 8 }),
		readOutput: async () => new Blob([JSON.stringify(audioTags())], { type: MEDIA_TYPE }) };
	await assert.rejects(retainLocalAssistanceGuidedReactionScores({ ...base,
		currentProject: () => ({ projectId: 'project-a', projectRevision: 9 }),
	}), /stale|revision|authority/iu);
	await assert.rejects(retainLocalAssistanceGuidedReactionScores({ ...base,
		readOutput: async () => new Blob([JSON.stringify({ ...audioTags(), sampleRate: 16_000 })],
			{ type: MEDIA_TYPE }),
	}), /sample rate|audio-tags/iu);
	await assert.rejects(retainLocalAssistanceGuidedReactionScores({ ...base,
		workflow: assistanceWorkflowFixture(),
	}), /reaction/iu);
	assert.deepEqual(await repository.listProject('project-a'), []);
});

function reactionWorkflow(): AssistanceWorkflowV1 {
	const stageIds = ['tag-reactions', 'merge-reaction-ranges'];
	const models = [{ bindingVersion: 1 as const, stageId: 'tag-reactions', slotId: 'audio-tagger',
		modelId: 'panns-cnn10', version: '1.0.0', artifactSha256s: ['78'.repeat(32)] }];
	return assistanceWorkflowFixture({ workflowId: 'mark-reactions', stageIds, models,
		inputs: [claim('input', 'tag-reactions', 'audio', 1),
			claim('input', 'merge-reaction-ranges', 'audio-tags', 2)],
		outputs: [claim('output', 'tag-reactions', 'audio-tags', 3),
			claim('output', 'merge-reaction-ranges', 'reaction-ranges', 4)],
	});
}

function audioTags() {
	return { schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000, windows: [
		{ startSample: 0, scores: { laughter: 0.75, applause: 0.1, cheering: 0 } },
		{ startSample: 32_000, scores: { laughter: 0.65, applause: 0.2, cheering: 0.4 } },
	] };
}

function derivativeRepository(): AssistanceDerivativeRepository {
	const memory = getMemoryDatabase(`guided-reactions-${String(Date.now())}-${Math.random().toString(16)}`);
	const port: StorageRepositoryPort = { memory, database: async () => null };
	return new AssistanceDerivativeRepository(port);
}

function claim(direction: 'input' | 'output', stageId: string, slotId: string, index: number) {
	return { claimVersion: 1 as const, direction, claimId: index.toString(16).padStart(40, '0'),
		jobId: WORKFLOW_JOB_ID, stageId, slotId };
}
