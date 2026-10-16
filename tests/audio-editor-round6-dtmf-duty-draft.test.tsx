/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a one-symbol DTMF draft preserves the authored duty cycle for the next full sequence', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let generated: Readonly<Record<string, unknown>> | null = null;
	const controller = { project: { sampleRate: 48_000, tracks: [], clips: [], selection: null },
		actions: { generators: { generate: async (_type: string, options: Readonly<Record<string, unknown>>) => { generated = options; } } } };
	const field = (name: string) => {
		const input = dom.one(`[data-generator-field="${name}"]`).querySelector('input');
		assert.ok(input); return input;
	};
	try {
		await act(async () => root.render(<GeneratorDialog type="dtmf" controller={controller}
			copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()} onClose={() => {}} />));
		await act(async () => reactProps(field('dutyPercent')).onChange({ target: { value: '50' } }));
		await act(async () => reactProps(field('sequence')).onChange({ target: { value: '1' } }));
		assert.equal(reactProps(field('dutyPercent')).value, '50', 'a single tone has no gap but retains the requested ratio');
		await act(async () => reactProps(field('sequence')).onChange({ target: { value: '123' } }));
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		assert.ok(generated);
		assert.equal(Number(generated['toneSeconds']), 6);
		assert.equal(Number(generated['silenceSeconds']), 6);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
