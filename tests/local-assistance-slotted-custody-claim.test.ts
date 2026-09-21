/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSlottedCustodyClaim } from
	'../src/common/editor/controller/assistance/internal/local-assistance-slotted-custody-claim.ts';

const claim = {
	claimId: 'claim-one', direction: 'input', jobId: 'job-one',
	stageId: 'stage-one', slotId: 'slot-one',
} as const;
const handle = { custody: { claimId: claim.claimId }, workflowClaim: claim };

test('a custody handle returns only the correlated slotted workflow claim', () => {
	assert.equal(assertSlottedCustodyClaim(handle as never, 'input', 'job-one', 'stage-one',
		'slot-one', 'Guided claim is uncorrelated.'), claim);
	assert.throws(() => assertSlottedCustodyClaim(handle as never, 'output', 'job-one',
		'stage-one', 'slot-one', 'Advanced claim is uncorrelated.'),
		/Advanced claim is uncorrelated/u);
});

test('slotted custody refuses every mismatched correlation and preserves caller wording', () => {
	const invalid = [
		undefined,
		{ custody: null, workflowClaim: claim },
		{ custody: { claimId: 'another-claim' }, workflowClaim: claim },
		{ custody: handle.custody, workflowClaim: { ...claim, jobId: 'another-job' } },
		{ custody: handle.custody, workflowClaim: { ...claim, stageId: 'another-stage' } },
		{ custody: handle.custody, workflowClaim: { ...claim, slotId: 'another-slot' } },
	];
	for (const candidate of invalid) {
		assert.throws(() => assertSlottedCustodyClaim(candidate as never, 'input',
			'job-one', 'stage-one', 'slot-one', 'Aggregate claim is uncorrelated.'),
			{ name: 'TypeError', message: 'Aggregate claim is uncorrelated.' });
	}
});
