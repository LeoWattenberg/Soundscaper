/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { OutputTrackRow } from '../src/common/editor/ui/timeline/OutputTrackRows.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface KeyInput {
	readonly key: string;
	readonly defaultPrevented?: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly altKey?: boolean;
	readonly shiftKey?: boolean;
}

async function navigate(keys: readonly KeyInput[], movable = true) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	let prevented = 0, stopped = 0;
	const telemetry = {};
	const controller = { getTelemetrySnapshot: () => telemetry,
		subscribeTelemetry: () => () => undefined,
		actions: { mixer: { updateMaster() {}, updateBus() {} } } };
	try {
		await act(async () => root.render(<ThemeProvider><OutputTrackRow controller={controller}
			rowKey="send:send-1" scope="send" bus={{ id: 'send-1', name: 'Send 1', envelope: [], gain: 1, pan: 0 }}
			focused onFocus={() => undefined} onMenu={() => calls.push('menu')}
			onFocusPanel={() => { calls.push('panel'); return movable; }}
			onFocusLane={() => movable} onFocusPreviousLane={() => movable}
			onFocusNextPanel={() => { calls.push('next-panel'); return movable; }}
			onNavigatePanel={() => movable} onNavigateLane={(direction: string) => { calls.push(direction); return movable; }}
			panelWidth={240} trackHeaderWidth={240} verticalRulerWidth={20} viewportWidth={600}
			timelineWidth={600} scrollX={0} pixelsPerSecond={100} sampleRate={48000}
			rulerScale={undefined} mappedTicks={[]} durationFrames={48000} selection={null}
			automationToolEnabled={false} stripEnvelopeAvailable={false} blocked={false} mobile={false}
			copy={{ master: 'Master', output: 'Output', trackName: 'Track name' }}
			run={(action: () => void) => action()} onOpenEffects={() => undefined} /></ThemeProvider>));
		const lane = dom.one('[data-output-lane]');
		for (const input of keys) await act(async () => reactProps(lane).onKeyDown({ ...input,
			preventDefault() { prevented++; }, stopPropagation() { stopped++; } }));
		return { calls, prevented, stopped };
	} finally {
		await act(async () => root.unmount());
		globals.React = priorReact;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

for (const input of [
	{ key: 'ArrowUp', ctrlKey: true }, { key: 'ArrowDown', altKey: true },
	{ key: 'Tab', metaKey: true }, { key: 'Escape', defaultPrevented: true },
]) test(`the output lane leaves ${JSON.stringify(input)} with its keyboard owner`, async () => {
	assert.deepEqual(await navigate([input]), { calls: [], prevented: 0, stopped: 0 });
});

test('output lane arrows, Shift navigation, Tab, Escape and context menu retain local actions', async () => {
	assert.deepEqual(await navigate([{ key: 'ArrowUp' }, { key: 'ArrowDown', shiftKey: true },
		{ key: 'Tab' }, { key: 'Tab', shiftKey: true }, { key: 'Escape' },
		{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }, { key: 'Enter' }]), {
		calls: ['up', 'down', 'next-panel', 'panel', 'panel', 'menu', 'menu'], prevented: 7, stopped: 7,
	});
});

test('output lane leaves unhandled navigation available when its destination is absent', async () => {
	assert.deepEqual(await navigate([{ key: 'ArrowUp' }, { key: 'Tab' }], false), {
		calls: ['up', 'next-panel'], prevented: 0, stopped: 0,
	});
});
