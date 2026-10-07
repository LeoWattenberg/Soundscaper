/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MixerFader } from '../vendor/audacity-design-system/components/src/MixerFader/MixerFader.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const modified of [true, false]) {
	test(`mixer fader ${modified ? 'preserves command chords without changing gain' : 'retains complete plain keyboard gestures'}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const events: [string, number][] = [];
		try {
			await act(async () => { root.render(<MixerFader value={50} min={0} max={100} ariaLabel="Volume"
				onGestureStart={value => { events.push(['start', value]); }}
				onChange={value => { events.push(['preview', value]); }}
				onGestureEnd={value => { events.push(['end', value]); }}
				onChangeEnd={value => { events.push(['commit', value]); }} />); });
			const fader = dom.one('[role="slider"]');
			for (const [key, value] of [['ArrowUp', 52], ['ArrowDown', 48], ['PageUp', 60],
				['PageDown', 40], ['Home', 0], ['End', 100]] as const) {
				for (const modifier of modified ? ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented'] : ['']) {
					let prevented = false; events.length = 0;
					await act(async () => { reactProps(fader).onKeyDown?.({ key, [modifier]: true,
						preventDefault() { prevented = true; } }); });
					assert.equal(prevented, !modified);
					assert.deepEqual(events, modified ? [] : [['start', 50], ['preview', value], ['end', value], ['commit', value]]);
				}
			}
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
