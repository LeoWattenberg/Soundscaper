/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { RulerFlyout } from '@soundscaper/design-system/RulerFlyout';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('the ruler field commits complete finite numbers and refuses incomplete or trailing text', async () => {
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
			onMaxFreqChange={(value) => { changes.push(value); }} />); });
		const input = dom.container.querySelectorAll('input').filter((element) => element.type === 'text')[1];
		assert.ok(input?.parentNode?.parentNode instanceof ReactTestElement);
		const field = input.parentNode.parentNode;
		for (const [text, expected] of [['1e3', 1000], ['1200.5', 1200.5]] as const) {
			changes.length = 0;
			await act(async () => { reactProps(input).onChange({ target: { value: text } }); });
			await act(async () => { reactProps(field).onKeyDown({ key: 'Enter' }); });
			assert.deepEqual(changes, [expected], text);
		}
		for (const text of ['', '1e', '1000Hz', 'Infinity', '23000', '-2']) {
			changes.length = 0;
			await act(async () => { reactProps(input).onChange({ target: { value: text } }); });
			await act(async () => { reactProps(field).onBlur(); });
			assert.deepEqual(changes, [], text);
			assert.equal(input.value, '20000', 'refusal restores the saved value');
		}
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
