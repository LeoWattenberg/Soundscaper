/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import type { TrackAutomationRuntime } from '../src/common/editor/track-automation-runtime.ts';
import { useTrackAutomationControls } from '../src/common/editor/ui/timeline/useTrackAutomationControls.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('hiding controls and reconciling a disappeared route both force the runtime to Read', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const modes: unknown[][] = [];
	const runtime: TrackAutomationRuntime = {
		snapshot: { mode: 'touch', laneId: 'route-lane', gestureActive: false },
		setMode: (mode, laneId) => modes.push([mode, laneId]),
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness project={PROJECT} runtime={runtime} />));
		await act(async () => reactProps(dom.one('[data-toggle-automation]')).onClick?.({}));
		await act(async () => reactProps(dom.one('[data-select-route]')).onClick?.({}));
		await act(async () => reactProps(dom.one('[data-toggle-automation]')).onClick?.({}));
		assert.deepEqual(modes, [['read', null]]);

		modes.length = 0;
		await act(async () => reactProps(dom.one('[data-toggle-automation]')).onClick?.({}));
		await act(async () => reactProps(dom.one('[data-select-route]')).onClick?.({}));
		await act(async () => root.render(<Harness project={PROJECT_WITHOUT_ROUTE} runtime={runtime} />));
		assert.deepEqual(modes, [['read', null]]);
		assert.equal(dom.one('[data-selected-target]').textContent, 'Volume');

		modes.length = 0;
		await act(async () => root.render(<Harness project={PROJECT_B} runtime={runtime} />));
		assert.deepEqual(modes, [['read', null]]);
		assert.equal(dom.one('[data-selected-target]').textContent, '');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function Harness({ project, runtime }: Readonly<{
	project: Readonly<Record<string, unknown>>;
	runtime: TrackAutomationRuntime;
}>) {
	const model = useTrackAutomationControls(project, true, runtime);
	const route = model.targetsByTrackId.get('voice')?.find(({ edgeId }) => edgeId === 'voice-master');
	return <div>
		<button data-toggle-automation onClick={() => model.toggle('voice')}>Toggle</button>
		<button data-select-route onClick={() => route && model.selectTarget('voice', route.key)}>Route</button>
		<span data-selected-target>{model.selectedTargetByTrackId.get('voice')?.label ?? ''}</span>
	</div>;
}

const BASE = Object.freeze({
	id: 'project-a',
	schemaVersion: 21,
	sampleRate: 48_000,
	tracks: Object.freeze([Object.freeze({
		id: 'voice', type: 'audio', name: 'Voice', gain: 1, pan: 0, mute: false,
		effects: Object.freeze([]), clipIds: Object.freeze([]),
	})]),
	automationLanes: Object.freeze([Object.freeze({
		id: 'route-lane',
		address: Object.freeze({ kind: 'edge', edgeId: 'voice-master', parameterId: 'level' }),
		timebase: 'absolute-samples',
		points: Object.freeze([Object.freeze({ id: 'route-origin', position: 0, value: 1 })]),
		segments: Object.freeze([]),
	})]),
});
const PROJECT = Object.freeze({
	...BASE,
	mixer: Object.freeze({
		groups: Object.freeze([]), sends: Object.freeze([]), cues: Object.freeze([]),
		edges: Object.freeze([Object.freeze({
			id: 'voice-master', kind: 'assignment', level: 1,
			source: Object.freeze({ kind: 'track', id: 'voice' }),
			destination: Object.freeze({ kind: 'master' }),
		})]),
	}),
});
const PROJECT_WITHOUT_ROUTE = Object.freeze({
	...BASE,
	mixer: Object.freeze({
		groups: Object.freeze([]), sends: Object.freeze([]), cues: Object.freeze([]),
		edges: Object.freeze([]),
	}),
}) as typeof PROJECT;
const PROJECT_B = Object.freeze({ ...PROJECT, id: 'project-b' });
