/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createRecordingActionFacade,
	type RecordingActionScope,
} from '../src/common/editor/controller/recording/recording-action-facade.ts';

test('recording cycle actions expose the pinned nested contract and exact authority argument', () => {
	const calls: unknown[][] = [];
	const scope = cycleScope(calls);
	const actions = createRecordingActionFacade(scope, (_capability, action) => action);
	const authority = recoveryAuthority();

	void actions.cycle.start();
	void actions.cycle.recover(authority);
	void actions.cycle.discard(authority);
	assert.deepEqual(calls, [['start'], ['recover', authority], ['discard', authority]]);
	assert.equal(Object.isFrozen(actions.cycle), true);
});

test('recording cycle actions enforce takeComp capability before controller mutation', () => {
	const calls: unknown[][] = [];
	const actions = createRecordingActionFacade(cycleScope(calls), (capability, action) => (...args) => {
		if (capability === 'takeComp') throw new RangeError('unsupported takeComp');
		return action(...args);
	});
	assert.throws(() => actions.cycle.start(), /unsupported takeComp/u);
	assert.throws(() => actions.cycle.recover(recoveryAuthority()), /unsupported takeComp/u);
	assert.throws(() => actions.cycle.discard(recoveryAuthority()), /unsupported takeComp/u);
	assert.deepEqual(calls, []);
});

function cycleScope(calls: unknown[][]): RecordingActionScope {
	return {
		startTakeCycleRecording: () => { calls.push(['start']); },
		recoverTakeCycleRecording: (authority: unknown) => { calls.push(['recover', authority]); },
		discardTakeCycleRecording: (authority: unknown) => { calls.push(['discard', authority]); },
		soundActivationPolicyService: {
			setEnabled() {}, setThresholdDb() {}, setHysteresisDb() {}, setHoldMilliseconds() {},
		} as never,
	} as unknown as RecordingActionScope;
}

function recoveryAuthority() {
	return Object.freeze({ kind: 'take-cycle-pending-open-recovery' as const, projectId: 'project',
		publicationGeneration: 1, recoveryToken: 'exact-token', draftCount: 1, requiresDecision: true as const });
}
