/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ClipResampleDialog from '../src/common/editor/ui/inspector/ClipResampleDialog.jsx';
import { parseClipResampleRate } from '../src/common/editor/ui/inspector/clip-resample-rate.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('clip rate admission refuses omitted, fractional and unsupported rates', () => {
	for (const draft of ['', ' ', '0', '7999', '384001', '44100.5', '44,100', 'not a rate']) {
		assert.equal(parseClipResampleRate(draft), null, draft);
	}
	for (const rate of [8000, 24000, 44100, 48000, 384000]) {
		assert.equal(parseClipResampleRate(String(rate)), rate);
	}
});

test('invalid clip rate drafts cannot reach either resample submission path', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const applied: unknown[] = [];
	try {
		await act(async () => root.render(<ClipResampleDialog sampleRate={24000} copy={ENGLISH_COPY}
			disabled={false} onCancel={() => undefined} onApply={(request: unknown) => { applied.push(request); }} />));
		const input = dom.one('input');
		await act(async () => reactProps(input).onChange({ target: { value: '' } }));
		const apply = dom.container.querySelectorAll('button').find((button) => button.textContent === ENGLISH_COPY.resample)!;
		assert.equal(reactProps(apply).disabled, true);
		assert.match(dom.one('[role="alert"]').textContent, /sample rate/u);
		await act(async () => reactProps(apply).onClick());
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		assert.deepEqual(applied, []);
		await act(async () => reactProps(input).onChange({ target: { value: '44100' } }));
		await act(async () => reactProps(apply).onClick());
		assert.deepEqual(applied, [{ sampleRate: 44100 }]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
