/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TimelineRuler } from '../vendor/audacity-design-system/components/src/TimelineRuler/TimelineRuler.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const button of [0, 1, 2]) test(`playback loop ruler admission, mouse button ${String(button)}`, async () => {
	await mounted(async (surface, toggles) => {
		await act(async () => reactProps(surface).onMouseDown?.(mouse(button)));
		await act(async () => reactProps(surface).onMouseUp?.(mouse(button)));
		assert.equal(toggles.length, button === 0 ? 1 : 0);
		await act(async () => reactProps(surface).onMouseUp?.(mouse(0)));
		assert.equal(toggles.length, button === 0 ? 1 : 0, 'the completed click cannot be reused');
	});
});

test('a secondary release cannot complete an active primary ruler click', async () => {
	await mounted(async (surface, toggles) => {
		await act(async () => reactProps(surface).onMouseDown?.(mouse(0)));
		await act(async () => reactProps(surface).onMouseUp?.(mouse(2)));
		assert.equal(toggles.length, 0);
		await act(async () => reactProps(surface).onMouseUp?.(mouse(0)));
		assert.equal(toggles.length, 1);
	});
});

function mouse(button: number) { return { button, clientX: 112, clientY: 5 }; }

async function mounted(check: (surface: ReturnType<ReturnType<typeof installReactTestDom>['one']>, toggles: boolean[]) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = globals.React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.React = React;
	const document = dom.container.ownerDocument;
	const create = document.createElement.bind(document);
	document.createElement = tag => {
		const element = create(tag);
		if (tag === 'canvas') Object.assign(element, { getContext: () => null });
		return element;
	};
	const root = createRoot(dom.container as unknown as Element);
	const toggles: boolean[] = [];
	try {
		await act(async () => root.render(<TimelineRuler pixelsPerSecond={100} totalDuration={5} width={500}
			loopRegionStart={0} loopRegionEnd={2} onLoopRegionEnabledToggle={() => toggles.push(true)} />));
		const surface = dom.one('canvas');
		Object.assign(surface, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 40 }) });
		await check(surface, toggles);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		globals.React = priorReact;
		dom.restore();
	}
}
