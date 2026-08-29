/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	cancelDraftEditOnEscape,
	createDraftBlurCommitGuard,
	draftBlurShouldCommit,
} from '../src/common/editor/ui/draft-blur-commit.ts';

test('draft blur commit guard consumes one Escape-triggered blur without blocking later commits', () => {
	const guard = createDraftBlurCommitGuard();
	const sequence: string[] = [];
	let prevented = false;
	let propagationStopped = false;
	let restored = false;
	const target = {
		blur() {
			sequence.push(draftBlurShouldCommit(guard) ? 'commit' : 'cancel');
		},
	};

	assert.equal(draftBlurShouldCommit(guard), true, 'ordinary blur commits');
	cancelDraftEditOnEscape(guard, {
		currentTarget: target,
		preventDefault() { prevented = true; },
		stopPropagation() { propagationStopped = true; },
	}, () => { restored = true; });

	assert.deepEqual(sequence, ['cancel']);
	assert.equal(restored, true);
	assert.equal(prevented, true);
	assert.equal(propagationStopped, true);
	assert.equal(draftBlurShouldCommit(guard), true, 'the next deliberate blur still commits');
});
