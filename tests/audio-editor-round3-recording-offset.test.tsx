/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import AudioSettingsPreferencesPage from '../src/common/editor/ui/dialogs/AudioSettingsPreferencesPage.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('Escape cancels the recording offset without publishing through its subsequent blur', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const writes: number[] = [];
	let prevented = false;
	let stopped = false;
	try {
		await act(async () => {
			root.render(<AudioSettingsPreferencesPage copy={ENGLISH_COPY} displayAudioSupported
				snapshot={{ monitor: { latencyOffsetMs: 0 }, recordingInputs: { offsets: {} } }}
				controller={{ actions: { recording: { setLatencyOffset: (value: number) => writes.push(value),
					setSourceOffset: () => undefined }, audioDevices: {} } }}
				run={(operation: () => unknown) => operation()} />);
		});
		const input = dom.container.querySelectorAll('input').find((candidate) => (
			(reactProps(candidate) as unknown as { readonly type?: string }).type === 'number'
		));
		assert.ok(input, 'the page exposes its offset number field');
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: '123' } }); });
		await act(async () => {
			const handlers = reactProps(input);
			handlers.onKeyDown({ key: 'Escape', currentTarget: input,
				preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
			handlers.onBlur({});
		});
		assert.deepEqual(writes, []);
		assert.equal(input.value, '0');
		assert.ok(prevented && stopped, 'the field owns cancellation before modal dismissal');
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: '-25.5' } }); });
		await act(async () => { reactProps(input).onBlur({}); });
		assert.deepEqual(writes, [-25.5]);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
