/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoTrackControls } from '../src/common/editor/ui/timeline/VideoTrackControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { applyAudacityItemNavigationAction } from '../src/common/editor/audacity-shortcut-actions/item-navigation.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('picture header lets modified navigation reach the existing contextual track action and retains plain navigation', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const project: ControllerProject = { id: 'project', title: 'Pictures', schemaVersion: 3, sampleRate: 48_000,
		tracks: ['first', 'last'].map(id => ({ id, name: id, type: 'video' })), clips: [], sources: [],
		mixer: { groups: [], sends: [] }, selection: { startFrame: 101, endFrame: 901, trackIds: ['last'], clipIds: [] } };
	const trackMoves: string[] = [];
	const navigation: string[] = [];
	const noop = () => undefined;
	const controller = { getSnapshot: () => ({ project, selectedTrackId: 'last', selectedClipId: null }), actions: {
		clip: { move: noop, trim: noop }, edit: { commit: noop }, labels: { update: noop }, transport: { seek: noop },
		track: { update: noop, moveUp: (id: string) => trackMoves.push(`up:${id}`), moveDown: (id: string) => trackMoves.push(`down:${id}`) },
		timeline: { selectTrack: noop, setSelection: noop, setExactSelection: noop },
	} };
	try {
		await act(async () => root.render(<VideoTrackControls controller={controller} track={project.tracks[1]}
			panelWidth={240} selected blocked={false} isFlatNavigation={false} copy={ENGLISH_COPY}
			run={(operation: () => unknown) => operation()} onMenu={noop} onOpenEffects={noop}
			effectsAvailable={false} onTabOut={noop} onShiftTabOut={noop}
			onNavigateVertical={(direction: string) => navigation.push(direction)} />));
		const panel = dom.one('[data-track-header]');
		const button = dom.one('button');
		button.focus();
		for (const [key, modifiers, action] of [
			['ArrowUp', { ctrlKey: true }, 'track-view-item-move-up'],
			['ArrowDown', { metaKey: true }, 'track-view-item-move-down'],
		] as const) {
			const event = { key, code: key, target: button as unknown as EventTarget, defaultPrevented: false,
				altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers,
				preventDefault() { this.defaultPrevented = true; } };
			await act(async () => { reactProps(panel).onKeyDownCapture(event); });
			assert.equal(event.defaultPrevented, false, 'the header does not own modified navigation');
			handleWorkspaceKeyboard(event, { preferences: { shortcuts: { [action]: [key === 'ArrowUp' ? 'Ctrl+Up' : 'Meta+Down'] } } }, handler => handler(), {
				menus: [{ id: action, onClick: () => applyAudacityItemNavigationAction(action, controller, null) }],
			});
			assert.equal(event.defaultPrevented, true, 'the workspace owns the admitted track command');
		}
		assert.deepEqual(trackMoves, ['up:last', 'down:last']);
		assert.deepEqual(navigation, []);
		let prevented = 0;
		for (const [key, modifiers] of [['ArrowUp', { altKey: true }], ['Tab', { ctrlKey: true }], ['Tab', { metaKey: true }]] as const) {
			await act(async () => { reactProps(panel).onKeyDownCapture({ key, target: button, ...modifiers, preventDefault() { prevented += 1; } }); });
		}
		assert.equal(prevented, 0);
		await act(async () => { reactProps(panel).onKeyDownCapture({ key: 'ArrowDown', target: button, preventDefault() { prevented += 1; } }); });
		assert.equal(prevented, 1);
		assert.deepEqual(navigation, ['down']);
		assert.deepEqual(project.selection, { startFrame: 101, endFrame: 901, trackIds: ['last'], clipIds: [] });
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.React = previous.react; globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
	}
});
