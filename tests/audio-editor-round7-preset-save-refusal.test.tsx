/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EffectPresetBar from '../src/common/editor/ui/inspector/EffectPresetBar.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

test('the mounted preset name prompt retains a refused save and closes only after successful persistence', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const attempts: string[] = [];
	let finishSave: (success: boolean) => void = () => undefined;
	try {
		await act(async () => { root.render(<EffectPresetBar copy={ENGLISH_COPY}
			presets={[]} onSelect={() => undefined} onSave={() => undefined}
			onSaveAs={(name: string) => {
				attempts.push(name);
				return new Promise<boolean>(resolve => { finishSave = resolve; });
			}} onReset={() => undefined} onDelete={() => undefined}
			onImport={() => undefined} onExport={() => undefined} />); });
		const saveButton = dom.container.querySelectorAll('button').find(button => button.getAttribute('aria-label') === 'Save preset');
		assert.ok(saveButton);
		await act(async () => { reactProps(saveButton).onClick({ currentTarget: saveButton }); });
		const saveAs = dom.container.ownerDocument.body.querySelectorAll('[role="menuitem"]')
			.find(item => item.textContent === 'Save as new preset');
		assert.ok(saveAs);
		await act(async () => { reactProps(saveAs).onClick(); });
		const input = dom.container.querySelectorAll('input').find(item => reactProps(item).value !== undefined);
		assert.ok(input, dom.container.textContent);
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: 'Keep my room' }, target: { value: 'Keep my room' } }); });
		const form = dom.container.querySelectorAll('form')[0];
		assert.ok(form);
		await act(async () => { reactProps(form).onSubmit({ preventDefault() {} }); });
		assert.deepEqual(attempts, ['Keep my room']);
		assert.equal(reactProps(dom.container.querySelectorAll('input').find(item => reactProps(item).value !== undefined)!).disabled, true, 'the draft remains visible during persistence');
		await act(async () => { reactProps(form).onSubmit({ preventDefault() {} }); });
		assert.deepEqual(attempts, ['Keep my room'], 'repeated Enter cannot submit the pending save twice');
		await act(async () => { finishSave(false); await Promise.resolve(); });
		assert.equal(dom.container.querySelectorAll('input').filter(item => reactProps(item).value !== undefined).length, 1, 'a refused save retains the editable name');
		assert.equal(input.value, 'Keep my room');
		await act(async () => { reactProps(form).onSubmit({ preventDefault() {} }); });
		assert.deepEqual(attempts, ['Keep my room', 'Keep my room']);
		await act(async () => { finishSave(true); await Promise.resolve(); });
		assert.equal(dom.container.querySelectorAll('input').filter(item => reactProps(item).value !== undefined).length, 0, 'successful persistence closes the name prompt');
	} finally {
		finishSave(false);
		await act(async () => { root.unmount(); });
		dom.restore();
		globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});
