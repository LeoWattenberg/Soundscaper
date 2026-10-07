/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import GraphicEqEditor from '../src/common/editor/ui/inspector/GraphicEqEditor.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Graphic EQ capture leaves modified commands available and keeps ordinary band steps', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: Array<readonly number[]> = [];
	try {
		await act(async () => root.render(<GraphicEqEditor name="gains" label="Gain" descriptor={{ frequencies: [20, 1000],
			default: [0, 0], minimum: -20, maximum: 20, step: 0.1 }} value={[0, 0]} disabled={false} copy={{}}
			gestureFor={() => ({})} onCommit={gains => commits.push(gains)} />));
		const band = dom.one('[data-effect-param="gains.0"]');
		for (const key of ['ArrowUp', 'ArrowDown']) {
			for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
				let prevented = false;
				let stopped = false;
				await act(async () => reactProps(band).onKeyDownCapture?.({ key, [modifier]: true,
					preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
				assert.equal(prevented, false, `${key} with ${modifier} remains available`);
				assert.equal(stopped, false);
			}
		}
		assert.equal(commits.length, 0);
		for (const [key, shiftKey] of [['ArrowUp', false], ['ArrowDown', true]] as const) {
			let prevented = false;
			await act(async () => reactProps(band).onKeyDownCapture?.({ key, shiftKey,
				preventDefault() { prevented = true; }, stopPropagation() {} }));
			assert.equal(prevented, true);
		}
		assert.deepEqual(commits, [[1, 0], [-1, 0]]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
