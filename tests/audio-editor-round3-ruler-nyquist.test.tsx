/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { RulerFlyout } from '@soundscaper/design-system/RulerFlyout';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('the mounted frequency ruler admits values using its supplied sample rate', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const changes: number[] = [];
	try {
		for (const [sampleRate, maximum, accepted, rejected] of [
			[48_000, 20_000, 23_000, 24_001], [44_100, 20_000, 22_050, 22_051], [8_000, 3_000, 4_000, 4_001],
		]) {
			changes.length = 0;
			await act(async () => { root.render(<RulerFlyout {...{ sampleRate }} isOpen x={0} y={0}
				mode="spectrogram" onClose={() => undefined} minFreq={0} maxFreq={maximum}
				onMaxFreqChange={(value) => { changes.push(value); }} />); });
			const input = dom.container.querySelectorAll('input').filter((element) => element.type === 'text')[1];
			assert.ok(input?.parentNode?.parentNode);
			const field = input.parentNode.parentNode;
			assert.ok(field instanceof ReactTestElement);
			await act(async () => { reactProps(input).onChange({ target: { value: String(accepted) } }); });
			await act(async () => { reactProps(field).onKeyDown({ key: 'Enter' }); });
			assert.ok(changes.length > 0, `${sampleRate} Hz admits ${accepted} Hz`);
			assert.ok(changes.every((value) => value === accepted));
			changes.length = 0;
			await act(async () => { reactProps(input).onChange({ target: { value: String(rejected) } }); });
			await act(async () => { reactProps(field).onKeyDown({ key: 'Enter' }); });
			assert.deepEqual(changes, [], `${sampleRate} Hz rejects values above Nyquist`);
			assert.equal(input.value, String(maximum));
		}
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
