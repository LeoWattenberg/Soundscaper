/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { TakeCyclePendingOpenRecovery } from '../src/common/editor/controller/recording/take-cycle-capture-orchestrator.ts';
import TakeCycleRecoveryDialog from '../src/common/editor/ui/dialogs/TakeCycleRecoveryDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const decision of ['recover', 'discard'] as const) test(`a completed ${decision} cannot close a replacement surface`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	let complete!: () => void;
	let delayed = false;
	let closed = 0;
	const finish = () => delayed ? new Promise<void>(resolve => { complete = resolve; }) : Promise.resolve();
	const pending = { kind: 'take-cycle-pending-open-recovery', projectId: 'project', publicationGeneration: 1,
		recoveryToken: 'token', draftCount: 1, requiresDecision: true } as const;
	const copy = { takeCycleRecoveryTitle: 'Interrupted take recording', takeCycleRecoverySummary: '{generation}: {count}',
		takeCycleRecoveryDescription: 'Recover this recording', takeCycleRecoveryCloseHint: 'Close keeps the recording',
		takeCycleRecover: 'Recover takes', takeCycleDiscard: 'Discard takes', takeCycleRecovering: 'Recovering',
		takeCycleDiscarding: 'Discarding', takeCycleRecoveryWorking: 'Working' };
	const render = (authority: TakeCyclePendingOpenRecovery = pending) => root.render(<TakeCycleRecoveryDialog productId="soundscaper" pending={authority}
		controller={{ actions: { recording: { cycle: { recover: finish, discard: finish } } } }}
		copy={copy} run={operation => operation()} onClose={() => { closed++; }} />);
	const submit = () => {
		const button = Array.from(dom.container.querySelectorAll('button')).find(element => element.textContent === (decision === 'recover' ? 'Recover takes' : 'Discard takes'));
		assert.ok(button);
		reactProps(button).onClick?.();
	};
	try {
		await act(async () => render());
		await act(async () => submit());
		assert.equal(closed, 1, 'an ordinary completed decision closes its own recovery dialog');
		delayed = true;
		await act(async () => submit());
		assert.equal(closed, 1, 'the held decision is still pending');
		const retiredCompletion = complete;
		await act(async () => render({ ...pending, recoveryToken: 'retry-token' }));
		await act(async () => submit());
		await act(async () => retiredCompletion());
		assert.equal(closed, 1, 'an earlier decision must not close a refreshed recovery authority');
		const working = Array.from(dom.container.querySelectorAll('button')).find(element => element.textContent === (decision === 'recover' ? 'Recovering' : 'Discarding'));
		assert.ok(working);
		assert.equal(reactProps(working).disabled, true, 'earlier completion must not clear a newer pending decision');
		await act(async () => root.render(<div role="dialog">Preferences</div>));
		await act(async () => complete());
		assert.equal(closed, 1, 'the retired decision must not dismiss a newer surface');
		assert.equal(dom.one('[role="dialog"]').textContent, 'Preferences');
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
