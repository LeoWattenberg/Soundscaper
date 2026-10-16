/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the actual Selection duration measures a local musical interval while endpoints remain absolute', async () => {
	const dom = installReactTestDom();
	window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' }) as CSSStyleDeclaration;
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = globals.React;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.React = React;
	const root = createRoot(dom.container as unknown as Element);
	const project = createSoundscaperProject({ id: 'selection-musical-duration',
		tempoMap: { mode: 'musical', events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
			{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
		] },
	});
	const snapshot = { project };
	const telemetry = { taskProgress: null };
	const controller = {
		getSnapshot: () => snapshot, subscribe: () => () => undefined,
		getTelemetrySnapshot: () => telemetry, subscribeTelemetry: () => () => undefined,
	};
	const renderRange = (startFrame: number, endFrame: number) => root.render(
		<EditorMusicalTimeCodeProvider controller={controller}>
			<AccessibleSelectionToolbar controller={controller}
				snapshot={{ project, selection: { startFrame, endFrame } }} copy={ENGLISH_COPY}
				statusMessage="Ready" statusState="success" durationFrames={384000} disabled={false}
				showSelectionToolbar showStatusbar run={() => undefined} />
		</EditorMusicalTimeCodeProvider>,
	);
	const group = (name: string) => {
		const node = dom.container.querySelectorAll('.timecode')[['start', 'end', 'duration'].indexOf(name)];
		assert.ok(node);
		return node;
	};
	const digits = (name: string) => group(name).querySelectorAll('.timecode-digit').map(node => node.textContent).join('');
	try {
		await act(async () => { renderRange(0, 192000); });
		const format = group('duration').querySelector('.timecode__format-button');
		assert.ok(format);
		await act(async () => { reactProps(format).onClick({ detail: 1 }); });
		const beats = dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent === 'beats:bars');
		assert.ok(beats);
		await act(async () => { reactProps(beats).onClick({}); });
		assert.equal(digits('duration'), '0011', 'the healthy zero-origin interval counts a full bar');
		assert.equal(digits('start'), '000000000');
		assert.equal(digits('end'), '000004000');
		await act(async () => { renderRange(192000, 288000); });
		assert.equal(digits('start'), '000004000');
		assert.equal(digits('end'), '000006000');
		assert.equal(digits('duration'), '0011', 'the selected two seconds are one bar at their own 120 BPM');
		const startFormat = group('start').querySelector('.timecode__format-button');
		assert.ok(startFormat);
		await act(async () => { reactProps(startFormat).onClick({ detail: 1 }); });
		const endpointBeats = dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent === 'beats:bars');
		assert.ok(endpointBeats);
		await act(async () => { reactProps(endpointBeats).onClick({}); });
		assert.equal(digits('start'), '0011', 'the endpoint retains its absolute bar position');
		assert.equal(digits('end'), '0021', 'the end remains in the next absolute bar');
		assert.equal(digits('duration'), '0011', 'only the duration uses the local origin');
		await act(async () => { renderRange(0, 192000); });
		assert.equal(digits('start'), '0001');
		assert.equal(digits('end'), '0011');
		assert.equal(digits('duration'), '0011', 'a later selection refresh uses its new start');
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		globals.React = priorReact;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
