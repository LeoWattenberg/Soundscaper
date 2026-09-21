/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assistanceWorkflowCustodyCorrelatesClaimV1,
	sameAssistanceWorkflowClaimIdentityV1,
	sameAssistanceWorkflowClaimSequenceV1,
} from '../src/common/editor/assistance/workflow-claim-correlation-v1.ts';
import type { AssistanceWorkflowClaimV1 } from
	'../src/common/editor/assistance/workflow.ts';
import type { AssistanceWorkflowCustodyClaimV1 } from
	'../src/common/editor/assistance/workflow-custody-v1.ts';

const JOB_ID = '1'.repeat(40);
const CLAIM_ID = '2'.repeat(40);

test('workflow claim identity and ordered sequences share every V1 identity field', () => {
	const expected = claim();
	assert.equal(sameAssistanceWorkflowClaimIdentityV1(expected, claim()), true);
	assert.equal(sameAssistanceWorkflowClaimSequenceV1(
		[expected, claim({ claimId: '3'.repeat(40), slotId: 'video-authority' })],
		[claim(), claim({ claimId: '3'.repeat(40), slotId: 'video-authority' })],
	), true);

	const mismatches: readonly AssistanceWorkflowClaimV1[] = [
		{ ...claim(), claimVersion: 2 } as unknown as AssistanceWorkflowClaimV1,
		claim({ direction: 'output' }),
		claim({ claimId: '3'.repeat(40) }),
		claim({ jobId: '4'.repeat(40) }),
		claim({ stageId: 'publish-video-index' }),
		claim({ slotId: 'video-authority' }),
	];
	for (const mismatch of mismatches) {
		assert.equal(sameAssistanceWorkflowClaimIdentityV1(expected, mismatch), false);
		assert.equal(sameAssistanceWorkflowClaimSequenceV1([expected], [mismatch]), false);
	}
	assert.equal(sameAssistanceWorkflowClaimSequenceV1(
		[expected, claim({ claimId: '3'.repeat(40) })],
		[claim({ claimId: '3'.repeat(40) }), expected],
	), false);
	assert.equal(sameAssistanceWorkflowClaimSequenceV1([expected], [expected, expected]), false);
});

test('workflow custody correlation binds workflow, direction, and exact claim identity', () => {
	const expectedClaim = claim();
	const expectedCustody = custody();
	const scope = Object.freeze({ workflowId: 'index-video' as const,
		jobId: JOB_ID, stageId: 'sample-shot-frames' });
	assert.equal(assistanceWorkflowCustodyCorrelatesClaimV1(
		expectedCustody, scope, expectedClaim, 'input',
	), true);

	const custodyMismatches: readonly AssistanceWorkflowCustodyClaimV1[] = [
		custody({ workflowId: 'make-highlights' }),
		custody({ direction: 'output' }),
		custody({ jobId: '4'.repeat(40) }),
		custody({ stageId: 'publish-video-index' }),
		custody({ slotId: 'video-authority' }),
		custody({ claimId: '3'.repeat(40) }),
	];
	for (const mismatch of custodyMismatches) {
		assert.equal(assistanceWorkflowCustodyCorrelatesClaimV1(
			mismatch, scope, expectedClaim, 'input',
		), false);
	}
	assert.equal(assistanceWorkflowCustodyCorrelatesClaimV1(
		expectedCustody, scope, claim({ slotId: 'video-authority' }), 'input',
	), false);
	assert.equal(assistanceWorkflowCustodyCorrelatesClaimV1(
		expectedCustody, scope, expectedClaim, 'output',
	), false);
});

function claim(
	overrides: Partial<AssistanceWorkflowClaimV1> = {},
): AssistanceWorkflowClaimV1 {
	return Object.freeze({ claimVersion: 1, direction: 'input', claimId: CLAIM_ID,
		jobId: JOB_ID, stageId: 'sample-shot-frames', slotId: 'video', ...overrides });
}

function custody(
	overrides: Partial<AssistanceWorkflowCustodyClaimV1> = {},
): AssistanceWorkflowCustodyClaimV1 {
	return Object.freeze({ custodyVersion: 1, workflowId: 'index-video', direction: 'input',
		jobId: JOB_ID, stageId: 'sample-shot-frames', slotId: 'video', claimId: CLAIM_ID,
		role: 'video', mediaType: 'video/mp4', byteLength: 1, sha256: 'a'.repeat(64),
		maximumByteLength: null, producer: null, ...overrides }) as AssistanceWorkflowCustodyClaimV1;
}
