/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import type { AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { TrackAutomationOverlayProps } from '../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx';
import { TrackAutomationOverlay } from '../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const address = { kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'gain' } as const;

for (const deleteLane of [false, true]) test(`keyboard deletion focuses ${deleteLane ? 'the curve after deleting the lane' : 'a surviving point'}`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let lane: AutomationLaneV21 | null = {
		id: 'lane', address,
		timebase: 'absolute-samples', points: [
			{ id: 'first', position: 0, value: 1 },
			...deleteLane ? [] : [{ id: 'second', position: 48_000, value: 2 }],
		], segments: deleteLane ? [] : [{ kind: 'linear' }],
	};
	const commands: unknown[] = [];
	const render = () => root.render(<TrackAutomationOverlay {...props()} />);
	function props(): TrackAutomationOverlayProps {
		return {
			controller: { actions: { edit: { commit(command) {
				commands.push(command);
				lane = (command as { lane: AutomationLaneV21 | null }).lane;
				render();
			} } } },
			target: { key: 'gain', label: 'Volume', groupLabel: 'Track', effectId: null,
				edgeId: null, disabledReason: null, currentValue: 1, lane, address,
				descriptor: stripParameterDescriptor(address) },
			clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 96_000 }],
			renderViewportStartFrame: 0, viewportDurationFrames: 96_000, overscanStartFrame: 0,
			overscanEndFrame: 96_000, pixelsPerSecond: 100, sampleRate: 48_000,
			width: 224, height: 100, copy: {}, run: operation => operation(),
		};
	}
	try {
		await act(async () => render());
		const point = dom.one(`[data-automation-point-id="${deleteLane ? 'first' : 'second'}"]`);
		point.focus();
		await act(async () => reactProps(point).onKeyDown?.({
			key: 'Delete', shiftKey: deleteLane, currentTarget: point,
			preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(commands.length, 1);
		assert.equal(dom.container.ownerDocument.activeElement, dom.one(deleteLane
			? '[data-automation-insert-point]' : '[data-automation-point-id="first"]'));
		assert.equal(lane?.points.length ?? 0, deleteLane ? 0 : 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
