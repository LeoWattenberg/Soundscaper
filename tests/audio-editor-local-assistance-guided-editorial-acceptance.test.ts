/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	acknowledgeLocalAssistanceGuidedEditorialSelection,
} from '../src/common/editor/controller/local-assistance-guided-editorial-acceptance.ts';
import type { AssistanceWorkflowV1 } from
	'../src/common/editor/assistance/workflow.ts';
import type { LocalAssistanceGuidedReviewedResult } from
	'../src/common/editor/ui/local-assistance-guided-result-review.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from
	'./helpers/assistance-workflow-fixture.ts';

const FIRST_ID = 'selection:121212121212121212121212';
const SECOND_ID = 'selection:343434343434343434343434';

test('editorial acceptance acknowledges an authorized reviewed subset without a persistence port', () => {
	const workflow = editorialWorkflow();
	const review = editorialReview(workflow);
	const outcome = acknowledgeLocalAssistanceGuidedEditorialSelection({
		workflow, reviewedResult: review, selectedChoiceIds: [SECOND_ID],
	});

	assert.deepEqual(outcome, { outcome: 'accepted', selectedIds: [SECOND_ID] });
	assert.equal(Object.isFrozen(outcome), true);
	assert.equal(Object.isFrozen(outcome.selectedIds), true);
	assert.notEqual(outcome.selectedIds, review.choices);
	assert.deepEqual(Object.keys(outcome).sort(), ['outcome', 'selectedIds']);
});

test('editorial acceptance rejects absent, repeated, disabled, or foreign selections', () => {
	const workflow = editorialWorkflow();
	const review = editorialReview(workflow);
	for (const selectedChoiceIds of [[], [FIRST_ID, FIRST_ID], ['selection:unknown']]) {
		assert.throws(() => acknowledgeLocalAssistanceGuidedEditorialSelection({
			workflow, reviewedResult: review, selectedChoiceIds,
		}), /selected|selection|candidate|unique|reviewed/iu);
	}
	const disabled = { ...review, choices: review.choices.map((choice, index) => (
		index === 0 ? { ...choice, enabled: false } : choice
	)) };
	assert.throws(() => acknowledgeLocalAssistanceGuidedEditorialSelection({
		workflow, reviewedResult: disabled, selectedChoiceIds: [FIRST_ID],
	}), /choice|candidate|authority|enabled/iu);
});

test('editorial acceptance correlates the exact workflow, review, and terminal claim', () => {
	const workflow = editorialWorkflow();
	const review = editorialReview(workflow);
	const wrongWorkflow = assistanceWorkflowFixture();
	assert.throws(() => acknowledgeLocalAssistanceGuidedEditorialSelection({
		workflow: wrongWorkflow, reviewedResult: review, selectedChoiceIds: [FIRST_ID],
	}), /editorial/iu);
	assert.throws(() => acknowledgeLocalAssistanceGuidedEditorialSelection({
		workflow, reviewedResult: { ...review, jobId: 'ff'.repeat(20) },
		selectedChoiceIds: [FIRST_ID],
	}), /correlate|authority|workflow/iu);
	const alteredClaim = { ...review.outputs[0]!, claim: {
		...review.outputs[0]!.claim, claimId: 'ff'.repeat(20),
	} };
	assert.throws(() => acknowledgeLocalAssistanceGuidedEditorialSelection({
		workflow, reviewedResult: { ...review, outputs: [alteredClaim] },
		selectedChoiceIds: [FIRST_ID],
	}), /claim|authority|terminal/iu);
});

test('editorial acceptance re-admits reviewed semantics against exact candidate authority', () => {
	const workflow = editorialWorkflow();
	const review = editorialReview(workflow);
	const candidates = (review.outputs[0]!.semantic as Readonly<{
		candidates: readonly unknown[];
	}>).candidates;
	const omittedCandidate = { ...review.outputs[0]!, semantic: {
		schemaVersion: 1, candidates: [candidates[0]],
	} } as unknown;
	assert.throws(() => acknowledgeLocalAssistanceGuidedEditorialSelection({
		workflow, reviewedResult: { ...review, outputs: [omittedCandidate] },
		selectedChoiceIds: [FIRST_ID],
	}), /candidate|rerank|authorized|inventory/iu);
	const reorderedChoices = { ...review, choices: [...review.choices].reverse() };
	assert.throws(() => acknowledgeLocalAssistanceGuidedEditorialSelection({
		workflow, reviewedResult: reorderedChoices, selectedChoiceIds: [FIRST_ID],
	}), /candidate|choice|authority|order/iu);
});

function editorialWorkflow(): AssistanceWorkflowV1 {
	const workflow = assistanceWorkflowFixture({
		workflowId: 'generate-editorial-text',
		stageIds: ['generate-editorial-text'],
		settings: { settingsVersion: 1, workflowId: 'generate-editorial-text', enabled: true,
			fields: ['title', 'hook', 'chapters', 'explanation'] },
		models: [{ bindingVersion: 1, stageId: 'generate-editorial-text',
			slotId: 'editorial-generator', modelId: 'qwen3-4b-q4-k-m', version: '1.0.0',
			artifactSha256s: ['78'.repeat(32)] }],
		inputs: [claim('input', 'editorial-context', 1)],
		outputs: [claim('output', 'editorial-proposal', 2)],
	});
	return { ...workflow, fence: { ...workflow.fence,
		transcriptBodySha256: '90'.repeat(32) } };
}

function editorialReview(workflow: AssistanceWorkflowV1): LocalAssistanceGuidedReviewedResult {
	const semanticCandidates = Object.freeze([
		Object.freeze({ candidateId: FIRST_ID, title: 'First title', hook: 'First hook',
			chapters: Object.freeze(['Opening']), explanation: 'First explanation' }),
		Object.freeze({ candidateId: SECOND_ID, title: 'Second title', hook: null,
			chapters: Object.freeze([]), explanation: null }),
	]);
	const semantic = Object.freeze({ schemaVersion: 1, candidates: semanticCandidates });
	const body = new Blob([JSON.stringify(semantic)], {
		type: 'application/vnd.soundscaper.editorial-proposal+json',
	});
	const claimValue = workflow.outputs[0]!;
	return Object.freeze({
		reviewVersion: 1, jobId: workflow.jobId, workflowId: 'generate-editorial-text',
		outputs: Object.freeze([Object.freeze({
			stageId: claimValue.stageId, slotId: claimValue.slotId, claim: claimValue,
			mediaType: body.type, byteLength: body.size, sha256: 'ab'.repeat(32), body,
			semantic,
		})]),
		choices: Object.freeze([
			Object.freeze({ id: FIRST_ID, kind: 'editorial', label: 'Editorial text 1',
				selected: false as const, enabled: true }),
			Object.freeze({ id: SECOND_ID, kind: 'editorial', label: 'Editorial text 2',
				selected: false as const, enabled: true }),
		]),
	});
}

function claim(direction: 'input' | 'output', slotId: string, index: number) {
	return { claimVersion: 1 as const, direction,
		claimId: index.toString(16).padStart(40, '0'), jobId: WORKFLOW_JOB_ID,
		stageId: 'generate-editorial-text', slotId };
}
