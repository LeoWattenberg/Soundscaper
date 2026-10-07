/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { RulerFlyout } from '@soundscaper/design-system/RulerFlyout';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the mounted ruler popup leaves an active text field its own arrow keys', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const changes: number[] = [];
	try {
		await act(async () => { root.render(<RulerFlyout isOpen x={0} y={0} mode="spectrogram"
			onClose={() => undefined} minFreq={0} maxFreq={20_000}
			onMinFreqChange={(value) => { changes.push(value); }} />); });
		const input = dom.container.querySelectorAll('input').find((element) => element.type === 'text');
		assert.ok(input);
		const popup = dom.one('.ruler-flyout');
		await act(async () => { reactProps(input).onClick(); input.focus(); });
		let prevented = false;
		const event = { key: 'ArrowUp', target: input, defaultPrevented: false,
			preventDefault() { prevented = true; this.defaultPrevented = true; }, stopPropagation() {} };
		await act(async () => { reactProps(input).onKeyDown(event); reactProps(popup).onKeyDown(event); });
		assert.deepEqual(changes, [10]);
		assert.equal(dom.container.ownerDocument.activeElement, input);
		assert.equal(prevented, true, 'the number control steps its own value');
		prevented = false;
		await act(async () => { reactProps(popup).onKeyDown({ ...event, key: 'ArrowLeft', defaultPrevented: false }); });
		assert.equal(prevented, false, 'caret navigation is left native');
		assert.equal(dom.container.ownerDocument.activeElement, input);
		await act(async () => { reactProps(input).onBlur(); });
		await act(async () => { reactProps(popup).onKeyDown({ ...event, key: 'ArrowRight', defaultPrevented: false }); });
		assert.equal(prevented, true, 'idle fields retain the popup roving contract');
		assert.equal(dom.container.ownerDocument.activeElement?.nodeName, 'BUTTON');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
