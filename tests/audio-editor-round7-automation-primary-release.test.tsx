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

for (const kind of ['point', 'bezier'] as const) for (const buttons of [4, 2]) {
	for (const phase of ['release', 'auxiliary', 'foreign', 'touch', 'pen'] as const) {
		test(`${kind} automation respects ${phase} with buttons ${String(buttons)}`, async () => {
			const dom = installReactTestDom();
			const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
			globals.IS_REACT_ACT_ENVIRONMENT = true;
			const document = dom.container.ownerDocument as unknown as Document;
			const events = new EventTarget();
			document.addEventListener = events.addEventListener.bind(events);
			document.removeEventListener = events.removeEventListener.bind(events);
			const root = createRoot(dom.container as unknown as Element);
			const commands: unknown[] = [];
			try {
				await act(async () => root.render(<TrackAutomationOverlay
					controller={{ actions: { edit: { commit: (value: unknown) => commands.push(value) } } }} target={target}
					clips={[{ id: 'clip', timelineStartFrame: 0, durationFrames: 100 }]} renderViewportStartFrame={0}
					viewportDurationFrames={100} overscanStartFrame={0} overscanEndFrame={100} pixelsPerSecond={100}
					sampleRate={100} width={112} height={100} copy={{}} run={operation => operation()} />));
				const svg = dom.one('[data-track-automation-overlay]');
				Object.assign(svg, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 112, height: 100 }),
					setPointerCapture() {} });
				const selector = kind === 'point' ? '[data-automation-point-id="end"]' : '[data-automation-bezier-control="0:control1"]';
				const pointer = (clientX = 72, clientY = 45) => ({ button: 0, pointerId: 1,
					isPrimary: true, clientX, clientY, preventDefault() {}, stopPropagation() {} });
				await act(async () => reactProps(dom.one(selector)).onPointerDown?.(pointer()));
				await act(async () => reactProps(svg).onPointerMove?.(pointer()));
				assert.equal(commands.length, 0);
				const released = Object.assign(new Event('pointermove', { cancelable: true }), {
					pointerType: phase === 'touch' || phase === 'pen' ? phase : 'mouse',
					pointerId: phase === 'foreign' ? 2 : 1, button: phase === 'auxiliary' ? 1 : 0,
					buttons: phase === 'auxiliary' ? buttons | 1 : buttons, clientX: 72, clientY: 45,
				});
				await act(async () => { events.dispatchEvent(released); });
				assert.equal(commands.length, phase === 'release' ? 1 : 0, 'only the owning mouse primary release publishes');
				if (phase === 'release') await act(async () => reactProps(svg).onPointerMove?.(pointer(80, 80)));
				await act(async () => reactProps(svg).onPointerUp?.(pointer()));
				assert.equal(commands.length, 1, 'later auxiliary motion/release cannot publish again');
				const command = commands[0] as { type: string; expected: AutomationLaneV21; lane: AutomationLaneV21 };
				assert.equal(command.type, 'automation-lane/set');
				assert.equal(command.expected, lane);
				if (kind === 'point') {
					assert.deepEqual(command.lane.points, [lane.points[0], { id: 'end', position: 60, value: 0.38 }]);
				} else {
					assert.deepEqual(command.lane.points, lane.points);
					const segment = command.lane.segments[0];
					if (segment?.kind !== 'bezier') assert.fail('Expected the existing Bézier segment.');
					assert.deepEqual(segment.control1, { position: { num: 60, den: 1 }, value: 0.38 });
					assert.deepEqual(segment.control2, { position: { num: 75, den: 1 }, value: 0.5 });
				}
				assert.deepEqual(lane.points, [{ id: 'origin', position: 0, value: -1 }, { id: 'end', position: 100, value: 1 }]);
			} finally {
				await act(async () => root.unmount());
				globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
				dom.restore();
			}
		});
	}
}
