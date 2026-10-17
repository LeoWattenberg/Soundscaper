/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { handleClipPointerClick, markClipPointerDrag } from '../src/common/editor/ui/timeline/clip-pointer-selection.ts';
import { useTimelineMenuActions } from '../src/common/editor/ui/timeline/useTimelineMenuActions.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const project = { tracks: [{ id: 'track', clipIds: ['a', 'b'] }],
	clips: [{ id: 'a', timelineStartFrame: 10, durationFrames: 100 }, { id: 'b', timelineStartFrame: 200, durationFrames: 50 }] };

test('clip body clicks toggle, select audio, ignore controls and consume completed drag clicks', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commands: unknown[] = [];
	const actions = { selectClip: (...args: unknown[]) => commands.push(['clip', ...args]), setExactSelection: (...args: unknown[]) => commands.push(['range', ...args]) };
	try {
		await act(async () => root.render(<div data-track-lane><div data-clip-id="a"><span data-body /><button type="button">Menu</button></div></div>));
		const lane = dom.one('[data-track-lane]') as unknown as HTMLElement;
		const body = dom.one('[data-body]') as unknown as HTMLElement;
		let prevented = false;
		const event = (target = body, detail = 1, ctrlKey = false) => ({ target, currentTarget: lane, detail, ctrlKey, metaKey: false, shiftKey: false,
			preventDefault() { prevented = true; }, stopPropagation() {} });
		handleClipPointerClick(event(body, 1, true), project, actions, operation => operation());
		assert.deepEqual(commands, [['clip', 'a', { toggle: true }]]);
		commands.length = 0;
		handleClipPointerClick(event(body, 2), project, actions, operation => operation());
		assert.equal((commands[0] as unknown[])[0], 'range');
		commands.length = 0;
		handleClipPointerClick(event(dom.one('button') as unknown as HTMLElement, 2), project, actions, operation => operation());
		assert.deepEqual(commands, []);
		markClipPointerDrag(lane.ownerDocument);
		handleClipPointerClick(event(body, 1, true), project, actions, operation => operation());
		assert.deepEqual(commands, []);
		assert.equal(prevented, true);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});

test('opening an unselected clip context menu does not replace the current selection', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const selected: unknown[] = [], menus: unknown[] = [];
	let open: ((id: string, x: number, y: number) => void) | undefined;
	function Harness() {
		open = useTimelineMenuActions({ controller: { actions: { timeline: { selectClip: (id: string) => selected.push(id) } } }, copy: {}, onError: (error: unknown) => { throw error; },
			state: { addTrackFlyout: null, setAddTrackFlyout() {}, setClipMenu: (menu: unknown) => menus.push(menu), setTimelineRulerMenu() {}, setTrackRulerFlyout() {} },
			model: { project: { ...project, selection: { clipIds: ['a'], startFrame: 10, endFrame: 110 } }, showMasterTrack: false, showMarkers: false } }).openClipMenu;
		return null;
	}
	try {
		await act(async () => root.render(<Harness />));
		assert.ok(open); open('b', 30, 40);
		assert.deepEqual(selected, []);
		assert.deepEqual(menus, [{ clipId: 'b', x: 30, y: 40, autoFocus: false }]);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
