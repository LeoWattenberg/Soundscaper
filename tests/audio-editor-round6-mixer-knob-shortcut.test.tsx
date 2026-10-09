/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Knob } from '../vendor/audacity-design-system/components/src/Knob/Knob.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['ArrowUp', 'Home', 'End']) for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented'] as const) {
	test(`native mixer knob releases ${key} owned by ${modifier}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		const events: [string, number][] = [];
		try {
			await act(async () => root.render(<Knob value={0} min={-100} max={100} label="Pan" step={1}
				onGestureStart={value => { events.push(['start', value]); }}
				onChange={value => { events.push(['change', value]); }}
				onGestureEnd={value => { events.push(['end', value]); }} />));
			const knob = dom.one('.knob');
			let prevented = false;
			await act(async () => reactProps(knob).onKeyDown({ key, [modifier]: true,
				preventDefault() { prevented = true; }, stopPropagation() {} }));
			assert.equal(prevented, false);
			assert.deepEqual(events, [], 'a workspace chord does not begin a parameter gesture');
			await act(async () => reactProps(knob).onKeyDown({ key: 'End', preventDefault() {}, stopPropagation() {} }));
			await act(async () => reactProps(knob).onKeyUp({ key: 'End' }));
			assert.deepEqual(events, [['start', 0], ['change', 100], ['end', 100]], 'ordinary endpoint completes one gesture');
		} finally {
			await act(async () => root.unmount());
			dom.restore(); environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		}
	});
}
