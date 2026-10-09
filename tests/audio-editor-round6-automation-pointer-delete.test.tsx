/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { TrackAutomationOverlay } from '../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx';
import type { TrackAutomationTargetV21 } from '../src/common/editor/track-automation-targets-v21.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const button of [0, 1, 2]) test(`automation Alt deletion admits hardware button ${String(button)} only when primary`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commands: unknown[] = [];
	const address = { kind: 'strip' as const, strip: { kind: 'track' as const, id: 'voice' }, parameterId: 'pan' as const };
	const descriptor = stripParameterDescriptor(address);
	const target: TrackAutomationTargetV21 = { key: descriptor.id, address, descriptor, label: 'Pan', groupLabel: 'Track',
		effectId: null, edgeId: null, currentValue: 0, disabledReason: null,
		lane: { id: 'pan-lane', address, timebase: 'absolute-samples', points: [
			{ id: 'origin', position: 0, value: -1 }, { id: 'end', position: 100, value: 1 },
		], segments: [{ kind: 'linear' }] } };
	const claims: string[] = [];
	try {
		await act(async () => root.render(<TrackAutomationOverlay
			controller={{ actions: { edit: { commit: (value: unknown) => commands.push(value) } } }} target={target}
			clips={[{ id: 'clip', timelineStartFrame: 0, durationFrames: 100 }]} renderViewportStartFrame={0}
			viewportDurationFrames={100} overscanStartFrame={0} overscanEndFrame={100} pixelsPerSecond={100}
			sampleRate={100} width={112} height={100} copy={{}} run={operation => operation()} />));
		await act(async () => reactProps(dom.one('[data-automation-point-id="end"]')).onPointerDown?.({
			button, altKey: true, pointerId: 1,
			preventDefault() { claims.push('prevent'); }, stopPropagation() { claims.push('stop'); },
		}));
		assert.equal(commands.length, button === 0 ? 1 : 0);
		assert.deepEqual(claims, button === 0 ? ['prevent', 'stop'] : []);
		if (button === 0) {
			const command = commands[0] as { type: string; expected: unknown; lane: { points: { id: string }[] } };
			assert.equal(command.type, 'automation-lane/set');
			assert.equal(command.expected, target.lane);
			assert.deepEqual(command.lane.points.map(point => point.id), ['origin']);
		}
		assert.deepEqual(target.lane?.points.map(point => point.id), ['origin', 'end']);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
