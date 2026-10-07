/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackControls } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('track-header pointer and Enter modifiers preserve the range while changing its selected tracks', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let selection = { startFrame: 101, endFrame: 901, trackIds: ['first'] as readonly string[] };
	const controller = { getSnapshot: () => ({ project: { id: 'project', tracks: ['first', 'middle', 'last'].map(id => ({ id })), clips: [], selection } }),
		getTelemetrySnapshot: () => ({ meters: {} }), subscribeTelemetry: () => () => undefined,
		actions: { track: { update() {} }, timeline: { selectTrack() {}, setExactSelection(startFrame: number, endFrame: number, details: { trackIds: readonly string[] }) {
			selection = { startFrame, endFrame, trackIds: details.trackIds };
		} }, mixer: { beginParameterGesture: () => 0, previewParameterGesture() {}, commitParameterGesture() {}, cancelParameterGesture() {} } },
	};
	try {
		await act(async () => root.render(<TrackControls controller={controller} track={{ id: 'last', name: 'Last', gain: 1, pan: 0 }}
			trackHeight={180} panelWidth={240} selected blocked={false} showArmControls={false} displayAudioSupported={false}
			recordingInputs={[]} automationTargets={[]} automationTarget={undefined} automationRuntime={undefined}
			isFlatNavigation={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
			onMenu={() => undefined} onOpenEffects={() => undefined} onAutomationTarget={() => undefined}
			onTabOut={() => undefined} onShiftTabOut={() => undefined} onNavigateVertical={() => undefined} />));
		const panel = dom.one('.track-control-panel');
		const name = dom.one('.track-control-panel__track-name-text');
		const click = async (modifiers: object) => { await act(async () => { reactProps(panel).onClick({ ...modifiers, target: name, currentTarget: panel, stopPropagation() {}, preventDefault() {} }); }); };
		await click({ ctrlKey: true }); assert.deepEqual(selection, { startFrame: 101, endFrame: 901, trackIds: ['first', 'last'] });
		await click({ metaKey: true }); assert.deepEqual(selection.trackIds, ['first']);
		await click({ shiftKey: true }); assert.deepEqual(selection.trackIds, ['first', 'middle', 'last']);
		await click({}); assert.deepEqual(selection.trackIds, ['last']);
		panel.focus();
		await act(async () => { reactProps(panel).onKeyDown({ key: 'Enter', ctrlKey: true, target: panel, currentTarget: panel, preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(selection, { startFrame: 101, endFrame: 901, trackIds: [] });
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.React = previous.react; globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
	}
});
