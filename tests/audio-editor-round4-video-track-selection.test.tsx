/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoTrackControls } from '../src/common/editor/ui/timeline/VideoTrackControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('picture header pointer modifiers preserve exact time while replacing, toggling and extending track selection', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let selection = { startFrame: 101, endFrame: 901, trackIds: ['first'] as readonly string[] };
	const controller = { getSnapshot: () => ({ project: { tracks: ['first', 'middle', 'last'].map(id => ({ id })), clips: [], selection } }),
		actions: { track: { update() {} }, timeline: { selectTrack() {}, setExactSelection(startFrame: number, endFrame: number, details: { trackIds: readonly string[] }) {
			selection = { startFrame, endFrame, trackIds: details.trackIds };
		} } } };
	try {
		await act(async () => root.render(<VideoTrackControls controller={controller} track={{ id: 'last', name: 'Last' }}
			panelWidth={240} selected blocked={false} isFlatNavigation={false} copy={ENGLISH_COPY}
			run={(operation: () => unknown) => operation()} onMenu={() => undefined} onOpenEffects={() => undefined}
			effectsAvailable={false} onTabOut={() => undefined} onShiftTabOut={() => undefined} onNavigateVertical={() => undefined} />));
		const panel = dom.one('.track-control-panel');
		const name = dom.one('[data-track-name]');
		const click = async (modifiers: object, target = name) => { await act(async () => {
			reactProps(panel).onClick({ ...modifiers, target, currentTarget: panel, stopPropagation() {}, preventDefault() {} });
		}); };
		await click({ ctrlKey: true }); assert.deepEqual(selection, { startFrame: 101, endFrame: 901, trackIds: ['first', 'last'] });
		await click({ metaKey: true }); assert.deepEqual(selection.trackIds, ['first']);
		await click({ shiftKey: true }); assert.deepEqual(selection.trackIds, ['first', 'middle', 'last']);
		await click({}); assert.deepEqual(selection, { startFrame: 101, endFrame: 901, trackIds: ['last'] });
		await click({ ctrlKey: true }, dom.one('button'));
		assert.deepEqual(selection.trackIds, ['last'], 'a child control must not toggle its track selection');
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.React = previous.react; globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
	}
});
