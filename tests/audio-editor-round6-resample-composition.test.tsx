/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ClipResampleDialog from '../src/common/editor/ui/inspector/ClipResampleDialog.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'ArrowUp', 'Escape']) {
	test(`the clip resample form releases native composing ${key} before its application handlers`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const applied: unknown[] = [];
		try {
			await act(async () => { root.render(<ClipResampleDialog sampleRate={48000} copy={ENGLISH_COPY}
				disabled={false} onCancel={() => undefined}
				onApply={(request: unknown) => { applied.push(request); }} />); });
			const input = dom.one('input');
			await act(async () => { reactProps(input).onChange({ target: { value: '32000' } }); });
			let prevented = false; let stopped = false;
			await act(async () => { reactProps(dom.one('form')).onKeyDownCapture({
				key, target: input, nativeEvent: { isComposing: true }, defaultPrevented: false,
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
			}); });
			assert.deepEqual(applied, [], 'an unfinished native numeric draft cannot resample its source');
			assert.equal(prevented, false, 'the input method retains its native default');
			assert.equal(stopped, true, 'the child stepper cannot reinterpret native composition');
			await act(async () => { reactProps(dom.one('form')).onKeyDownCapture({
				key: 'Enter', target: input, nativeEvent: { isComposing: false }, defaultPrevented: false,
				ctrlKey: false, metaKey: false, altKey: false,
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
			}); });
			assert.deepEqual(applied, [{ sampleRate: 32000 }], 'completed Enter still applies the authored rate');
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
