/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MetadataEditorTabs from '../src/common/editor/ui/MetadataEditorTabs.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const direction of ['rtl', 'ltr']) test(`metadata section arrows use their rendered ${direction} order`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	const priorStyle = Object.getOwnPropertyDescriptor(window, 'getComputedStyle');
	Object.defineProperty(window, 'getComputedStyle', { configurable: true, value: () => ({ direction }) });
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const selected: string[] = [];
	try {
		await act(async () => root.render(<MetadataEditorTabs activeTab="bext" showBext showAdm
			copy={{ metadataGeneralTab: 'General', metadataBextTab: 'BEXT', metadataAdmTab: 'ADM' }}
			onChange={id => { selected.push(id); }} />));
		const middle = dom.container.querySelectorAll('[role="tab"]')[1]!;
		for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
			await act(async () => reactProps(middle).onKeyDown({ key, currentTarget: middle, preventDefault() {} }));
		}
		assert.deepEqual(selected, direction === 'rtl'
			? ['general', 'adm', 'general', 'adm'] : ['adm', 'general', 'general', 'adm']);
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorStyle) Object.defineProperty(window, 'getComputedStyle', priorStyle);
		else Reflect.deleteProperty(window, 'getComputedStyle');
		dom.restore();
	}
});
