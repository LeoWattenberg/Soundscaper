/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { TrackAutomationOverlay } from '../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const address = { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' } as const;

for (const control of ['point', 'curve', 'bezier'] as const) test(`automation ${control} leaves modified shortcuts to the workspace`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commands: unknown[] = [];
	const lane: AutomationLaneV21 = {
		id: 'lane', address, timebase: 'absolute-samples',
		points: [{ id: 'first', position: 0, value: 1 }, { id: 'second', position: 48_000, value: 0.5 }],
		segments: control === 'bezier' ? [{ kind: 'bezier',
			control1: { position: { num: 12_000, den: 1 }, value: 0.9 },
			control2: { position: { num: 36_000, den: 1 }, value: 0.6 } }] : [{ kind: 'linear' }],
	};
	try {
		await act(async () => root.render(<TrackAutomationOverlay
			controller={{ actions: { edit: { commit: command => commands.push(command) } } }}
			target={{ key: 'gain', label: 'Volume', groupLabel: 'Track', effectId: null,
				edgeId: null, disabledReason: null, currentValue: 1, lane, address, descriptor: stripParameterDescriptor(address) }}
			clips={[{ id: 'clip', timelineStartFrame: 0, durationFrames: 48_000 }]}
			renderViewportStartFrame={0} viewportDurationFrames={48_000} overscanStartFrame={0}
			overscanEndFrame={48_000} pixelsPerSecond={100} sampleRate={48_000}
			width={124} height={100} copy={{}} run={operation => operation()} />));
		const selector = control === 'point' ? '[data-automation-point-id="first"]'
			: control === 'curve' ? '[data-automation-insert-point]' : '[data-automation-bezier-control="0:control1"]';
		const element = dom.one(selector);
		const key = control === 'point' ? 'b' : control === 'curve' ? 'i' : 'ArrowUp';
		let prevented = 0;
		for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
			await act(async () => reactProps(element).onKeyDown({ key, [modifier]: true,
				currentTarget: element, preventDefault() { prevented += 1; }, stopPropagation() {} }));
			assert.equal(commands.length, 0);
			assert.equal(prevented, 0);
		}
		await act(async () => reactProps(element).onKeyDown({ key, currentTarget: element,
			preventDefault() { prevented += 1; }, stopPropagation() {} }));
		assert.equal(commands.length, 1);
		assert.equal(prevented, 1);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
