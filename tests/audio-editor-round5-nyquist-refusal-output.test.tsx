/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NyquistDialog from '../src/common/editor/ui/dialogs/NyquistDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const results: readonly Readonly<{ name: string; result: unknown; closes: boolean; output?: string; preview?: boolean }>[] = [
	{ name: 'plugin refusal', result: { type: 'message', message: 'Percentage values cannot be negative.' },
		closes: false, output: 'Percentage values cannot be negative.' },
	{ name: 'numeric report', result: { type: 'number', value: 42 }, closes: false, output: '42' },
	{ name: 'empty labels', result: { type: 'labels', labels: [] }, closes: false, output: '0 label(s)' },
	{ name: 'empty completion', result: null, closes: false },
	{ name: 'evaluation failure', result: new Error('Evaluation failed.'), closes: false },
	{ name: 'audio preview', result: { type: 'audio', frameCount: 48_000 }, closes: false, preview: true },
	{ name: 'applied audio', result: { type: 'audio', frameCount: 48_000 }, closes: true },
	{ name: 'applied labels', result: { type: 'labels', labels: [{ start: 0, end: 1, text: 'Take' }] }, closes: true },
	{ name: 'applied track results', result: { type: 'multiple', results: [
		{ type: 'audio', frameCount: 48_000 }, { type: 'audio', frameCount: 48_000 },
	] }, closes: true },
	{ name: 'partial refusal', result: { type: 'multiple', results: [
		{ type: 'audio', frameCount: 48_000 }, { type: 'message', message: 'Cannot process this track.' },
	] }, closes: false, output: 'Cannot process this track.' },
];

for (const scenario of results) test(`Nyquist ${scenario.name} preserves the correct completion surface`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	const closes: unknown[] = [];
	const controller = { actions: { nyquist: {
		evaluate: () => scenario.result instanceof Error ? Promise.reject(scenario.result) : Promise.resolve(scenario.result),
		preview: () => Promise.resolve(scenario.result), cancel: () => true,
	} } };
	try {
		await act(async () => { root.render(<NyquistDialog controller={controller}
			snapshot={{ project: { sampleRate: 48_000 }, nyquist: {}, effects: {}, readOnly: false }}
			copy={ENGLISH_COPY} target={{ prompt: false, pluginId: 'nyquist:adjustable-fade' }}
			run={(operation: () => unknown) => operation()} onClose={(request?: unknown) => { closes.push(request); }} />); });
		const apply = dom.container.querySelectorAll('button').find(button => button.textContent === (scenario.preview ? ENGLISH_COPY.previewEffect : ENGLISH_COPY.nyquistApply));
		assert.ok(apply);
		await act(async () => { await reactProps(apply).onClick?.({}); });
		assert.equal(closes.length, scenario.closes ? 1 : 0);
		if (scenario.output) assert.ok(dom.one('.kw-audio-editor__nyquist-output').textContent.includes(scenario.output));
		assert.equal(apply.hasAttribute('disabled'), false);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
