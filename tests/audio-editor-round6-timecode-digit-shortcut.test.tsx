/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { TimeCode } from '../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'handled'] as const) test(`active time digits release ${modifier} navigation after an ordinary edit`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) listeners.add(listener); };
	document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) listeners.delete(listener); };
	const values: number[] = [];
	let commits = 0;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const dispatch = async (event: Event) => {
		await act(async () => {
			for (const listener of [...listeners]) {
				if (typeof listener === 'function') listener(event);
				else listener.handleEvent(event);
			}
		});
	};
	try {
		await act(async () => { root.render(<TimeCode value={30} format="hh:mm:ss+milliseconds"
			showFormatSelector={false} onChange={(value) => { values.push(value); }}
			onCommit={() => { commits += 1; }} />); });
		const digits = dom.container.querySelectorAll('.timecode-digit');
		const digit = digits[digits.length - 1]!;
		digit.focus();
		await act(async () => { reactProps(digit).onClick(); });
		const ordinary = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowUp' });
		await dispatch(ordinary);
		assert.equal(ordinary.defaultPrevented, true);
		assert.ok(Math.abs(values[0]! - 30.001) < 1e-9);
		values.length = 0;
		const modified = Object.assign(new Event('keydown', { cancelable: true }), {
			key: 'ArrowUp', ctrlKey: modifier === 'ctrlKey', altKey: modifier === 'altKey', metaKey: modifier === 'metaKey',
		});
		if (modifier === 'handled') modified.preventDefault();
		await dispatch(modified);
		assert.deepEqual(values, [], 'a configured or already claimed key cannot edit the preceding digit');
		assert.equal(modified.defaultPrevented, modifier === 'handled');
		assert.equal(digit.getAttribute('data-state'), 'active');
		await dispatch(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Enter' }));
		assert.equal(commits, 1);
		assert.equal(dom.find('[data-state="active"]'), null);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
