/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ClipResampleDialog from '../src/common/editor/ui/inspector/ClipResampleDialog.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const scenario of ['valid', 'omitted', 'disabled', 'modified', 'spinner'] as const) {
	test(`completed resample field Enter respects ${scenario} admission`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = global.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		global.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const applied: unknown[] = [];
		try {
			await act(async () => { root.render(<ClipResampleDialog sampleRate={48000} copy={ENGLISH_COPY}
				disabled={scenario === 'disabled'} onCancel={() => undefined}
				onApply={(request: unknown) => { applied.push(request); }} />); });
			const input = dom.one('input');
			await act(async () => { reactProps(input).onChange?.({ target: { value: scenario === 'omitted' ? '' : '24000' } }); });
			let prevented = false; let stopped = false;
			const event = { key: 'Enter', target: scenario === 'spinner' ? dom.one('[aria-label="Increase value"]') : input,
				ctrlKey: scenario === 'modified', metaKey: false, altKey: false, defaultPrevented: false,
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
			await act(async () => { reactProps(dom.one('form')).onKeyDownCapture?.(event); });
			assert.deepEqual(applied, scenario === 'valid' ? [{ sampleRate: 24000 }] : []);
			assert.equal(prevented, scenario !== 'modified' && scenario !== 'spinner');
			assert.equal(stopped, prevented);
		} finally {
			await act(async () => { root.unmount(); });
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore(); global.IS_REACT_ACT_ENVIRONMENT = priorAct;
		}
	});
}
