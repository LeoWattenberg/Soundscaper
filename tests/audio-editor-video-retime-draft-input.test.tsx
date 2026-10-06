/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoRetimeDialog from '../src/common/editor/ui/dialogs/VideoRetimeDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('exact retime fields reject absent fraction tokens before invoking the controller', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const calls: unknown[] = [];
	const noop = () => undefined;
	try {
		await act(async () => root.render(<VideoRetimeDialog productId="framescaper" capability editingBlocked={false}
			controller={{ actions: { sequences: { retimeConstant: noop, retimeReset: noop,
				retimeReverse: noop, retimeFreeze: (input) => { calls.push(input); }, retimeRamp: noop, retimeSet: noop } } }}
			snapshot={{ selectedClipId: 'video', project: { schemaFamily: 'framescaper', schemaVersion: 1,
				clips: [{ id: 'video', kind: 'video', sourceInFrame: 3, sourceFrameCount: 10, sequenceFrameCount: 10, retimeMap: null }],
				tracks: [{ id: 'track', type: 'video', clipIds: ['video'] }], selection: { clipIds: ['video'] } } }}
			copy={{}} run={(operation) => operation()} onClose={noop} />));
		const field = dom.one('input');
		const apply = dom.container.querySelectorAll('button').find((button) => button.textContent === 'Apply freeze');
		assert.ok(apply);
		for (const value of ['', ' ', '/2', '3/']) {
			await act(async () => reactProps(field).onChange({ currentTarget: { value } }));
			await act(async () => reactProps(apply).onClick());
			assert.equal(calls.length, 0);
			assert.ok(dom.container.textContent.includes('safe-integer fraction'));
		}
		await act(async () => reactProps(field).onChange({ currentTarget: { value: '3/1' } }));
		await act(async () => reactProps(apply).onClick());
		assert.deepEqual(calls, [{ clipId: 'video', expectedRetimeMap: null, sourceFrame: { num: 3, den: 1 } }]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
