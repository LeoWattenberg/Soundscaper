/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('DTMF timing admission guards the native footer and form submission, and recovers with a legal ratio', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let generated = 0;
	const controller = { project: { sampleRate: 48_000, tracks: [], clips: [],
		selection: { startFrame: 0, endFrame: 48 } },
		actions: { generators: { generate: async () => { generated++; } } } };
	const generateButton = () => {
		const button = dom.container.querySelectorAll('button').find(value => value.textContent?.trim() === ENGLISH_COPY.generate);
		assert.ok(button); return button;
	};
	try {
		await act(async () => root.render(<GeneratorDialog type="dtmf" controller={controller}
			copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()} onClose={() => {}} />));
		const duty = dom.one('[data-generator-field="dutyPercent"]').querySelector('input');
		assert.ok(duty);
		await act(async () => reactProps(duty).onChange({ target: { value: '1' } }));
		assert.equal(reactProps(generateButton()).disabled, true, 'a sub-sample tone cannot be submitted');
		assert.match(dom.one('[role="alert"]').textContent ?? '', /at least one sample/u);
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		assert.equal(generated, 0, 'Enter uses the same timing admission');
		await act(async () => reactProps(duty).onChange({ target: { value: '100' } }));
		assert.equal(reactProps(generateButton()).disabled, false);
		await act(async () => reactProps(generateButton()).onClick());
		assert.equal(generated, 1);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
