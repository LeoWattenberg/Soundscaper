/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { TrackAutomationOverlay } from '../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx';
import type { AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { TrackAutomationTargetV21 } from '../src/common/editor/track-automation-targets-v21.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const address = { kind: 'strip' as const, strip: { kind: 'track' as const, id: 'voice' }, parameterId: 'pan' as const };
const descriptor = stripParameterDescriptor(address);
const lane: AutomationLaneV21 = { id: 'pan-lane', address, timebase: 'absolute-samples', points: [
	{ id: 'origin', position: 0, value: -1 }, { id: 'end', position: 100, value: 1 },
], segments: [{ kind: 'bezier', control1: { position: { num: 25, den: 1 }, value: -0.5 },
	control2: { position: { num: 75, den: 1 }, value: 0.5 } }] };
const target: TrackAutomationTargetV21 = { key: descriptor.id, address, descriptor, label: 'Pan', groupLabel: 'Track',
	effectId: null, edgeId: null, currentValue: 0, disabledReason: null, lane };

for (const kind of ['point', 'bezier'] as const) for (const interference of ['none', 'move', 'release', 'cancel', 'restart'] as const) {
	test(`${kind} automation retains its owner during ${interference}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const commands: unknown[] = [], captures: number[] = [];
		try {
			await act(async () => root.render(<TrackAutomationOverlay
				controller={{ actions: { edit: { commit: (value: unknown) => commands.push(value) } } }} target={target}
				clips={[{ id: 'clip', timelineStartFrame: 0, durationFrames: 100 }]} renderViewportStartFrame={0}
				viewportDurationFrames={100} overscanStartFrame={0} overscanEndFrame={100} pixelsPerSecond={100}
				sampleRate={100} width={112} height={100} copy={{}} run={operation => operation()} />));
			const svg = dom.one('[data-track-automation-overlay]');
			Object.assign(svg, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 112, height: 100 }),
				setPointerCapture: (id: number) => captures.push(id) });
			const selector = kind === 'point' ? '[data-automation-point-id="end"]' : '[data-automation-bezier-control="0:control1"]';
			const pointer = (pointerId: number, clientX = 72, clientY = 45) => ({ button: 0, pointerId,
				isPrimary: pointerId === 1, clientX, clientY, preventDefault() {}, stopPropagation() {} });
			await act(async () => reactProps(dom.one(selector)).onPointerDown?.(pointer(1)));
			await act(async () => reactProps(svg).onPointerMove?.(pointer(1)));
			if (interference === 'restart') {
				await act(async () => reactProps(dom.one(selector)).onPointerDown?.(pointer(2)));
				await act(async () => reactProps(svg).onPointerUp?.(pointer(2)));
			} else if (interference === 'move') {
				await act(async () => reactProps(svg).onPointerMove?.(pointer(2, 40, 80)));
			} else if (interference === 'release') {
				await act(async () => reactProps(svg).onPointerUp?.(pointer(2)));
			} else if (interference === 'cancel') {
				await act(async () => reactProps(svg).onPointerCancel?.(pointer(2)));
			}
			assert.equal(commands.length, 0, 'another pointer cannot publish or finish the draft');
			await act(async () => reactProps(svg).onPointerUp?.(pointer(1)));
			assert.equal(commands.length, 1);
			const command = commands[0] as { type: string; expected: AutomationLaneV21; lane: AutomationLaneV21 };
			assert.equal(command.type, 'automation-lane/set');
			assert.equal(command.expected, lane);
			if (kind === 'point') {
				assert.deepEqual(command.lane.points, [lane.points[0], { id: 'end', position: 60, value: 0.38 }]);
			} else {
				assert.deepEqual(command.lane.points, lane.points);
				const segment = command.lane.segments[0];
				assert.equal(segment?.kind, 'bezier');
				if (segment?.kind !== 'bezier') assert.fail('Expected the existing Bézier segment.');
				assert.deepEqual(segment.control1, { position: { num: 60, den: 1 }, value: 0.38 });
				assert.deepEqual(segment.control2, { position: { num: 75, den: 1 }, value: 0.5 });
			}
			assert.deepEqual(captures, [1]);
			assert.deepEqual(lane.points, [{ id: 'origin', position: 0, value: -1 }, { id: 'end', position: 100, value: 1 }]);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
