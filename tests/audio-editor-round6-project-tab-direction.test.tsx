/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectTabs from '../src/common/editor/ui/workspace/ProjectTabs.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const direction of ['rtl', 'ltr'] as const) test(`project arrows follow the rendered ${direction} order`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorStyle = Object.getOwnPropertyDescriptor(window, 'getComputedStyle');
	Object.defineProperty(window, 'getComputedStyle', { configurable: true, value: () => ({ direction }) });
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const selected: string[] = [];
	try {
		await act(async () => root.render(<ProjectTabs activeProjectId="second" disabled={false} copy={ENGLISH_COPY}
			projects={[{ id: 'first', title: 'First' }, { id: 'second', title: 'Second' }, { id: 'third', title: 'Third' }]}
			onSelect={(id: string) => { selected.push(id); }} onClose={() => undefined} onNew={() => undefined} />));
		const middle = dom.container.querySelectorAll('[role="tab"]')[1]!;
		for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
			await act(async () => reactProps(middle).onKeyDown({ key, currentTarget: middle, preventDefault() {} }));
		}
		assert.deepEqual(selected, direction === 'rtl'
			? ['first', 'third', 'first', 'third'] : ['third', 'first', 'first', 'third']);
		for (const key of ['ArrowRight', 'ArrowLeft']) {
			await act(async () => reactProps(middle).onKeyDown({ key, currentTarget: middle, ctrlKey: true,
				preventDefault: () => assert.fail('modified commands retain their owner') }));
		}
		assert.equal(selected.length, 4);
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		if (priorStyle) Object.defineProperty(window, 'getComputedStyle', priorStyle);
		else Reflect.deleteProperty(window, 'getComputedStyle');
		dom.restore();
	}
});
