/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import type { AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { TrackAutomationOverlay, type TrackAutomationOverlayProps } from '../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const address = { kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'gain' } as const;

for (const operation of ['move', 'remove-overlap'] as const) test(`automation point identity survives ${operation} across clip presentation owners`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let clips = [{ id: 'left', timelineStartFrame: 0, durationFrames: operation === 'move' ? 100 : 200 },
		{ id: 'right', timelineStartFrame: 100, durationFrames: 100 }];
	let lane: AutomationLaneV21 = { id: 'lane', address, timebase: 'absolute-samples',
		points: [{ id: 'origin', position: 0, value: 1 }, { id: 'edited', position: operation === 'move' ? 95 : 150, value: 1 }],
		segments: [{ kind: 'linear' }] };
	let commands = 0;
	const render = () => root.render(<TrackAutomationOverlay {...props()} />);
	function props(): TrackAutomationOverlayProps {
		return { controller: { actions: { edit: { commit(command) {
			lane = (command as { lane: AutomationLaneV21 }).lane;
			commands += 1; render();
		} } } }, target: { key: 'gain', label: 'Volume', groupLabel: 'Track', effectId: null,
			edgeId: null, disabledReason: null, currentValue: 1, lane, address, descriptor: stripParameterDescriptor(address) },
		clips, renderViewportStartFrame: 0, viewportDurationFrames: 200, overscanStartFrame: 0,
		overscanEndFrame: 200, pixelsPerSecond: 100, sampleRate: 100, width: 224, height: 100,
		copy: {}, run: callback => callback() };
	}
	try {
		await act(async () => render());
		const original = dom.one('[data-automation-point-id="edited"]');
		original.focus();
		if (operation === 'move') await act(async () => reactProps(original).onKeyDown?.({
			key: 'ArrowRight', shiftKey: true, preventDefault() {}, stopPropagation() {},
		}));
		else { clips = clips.slice(1); await act(async () => render()); }
		assert.equal(dom.one('[data-automation-point-id="edited"]') === original, true,
			'The surviving authored point must retain its mounted node when its clip presentation changes.');
		assert.equal(original.isConnected, true);
		assert.equal(dom.container.ownerDocument.activeElement === original, true);
		await act(async () => reactProps(original).onKeyDown?.({
			key: 'ArrowDown', shiftKey: false, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(lane.points.at(-1)?.value, 0.99);
		assert.equal(commands, operation === 'move' ? 2 : 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
