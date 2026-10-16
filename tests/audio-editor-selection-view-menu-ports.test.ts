/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceSelectionViewMenuPorts } from '../src/common/editor/ui/workspace/selection-view-menu-ports.ts';

const SELECTION_KEYS = [
	'selectAll', 'selectNone', 'selectAllTracks', 'selectNoTracks',
	'selectPreviousClipBoundaryToCursor', 'selectCursorToNextClipBoundary', 'selectPreviousClip',
	'selectNextClip', 'skipToSelectionStart', 'skipToSelectionEnd', 'selectLeftOfPlayback',
	'selectRightOfPlayback', 'selectTrackStartToCursor', 'selectCursorToTrackEnd',
	'selectTrackStartToEnd', 'zeroCross',
	'extendSelectionLeft', 'extendSelectionRight', 'contractSelectionLeft', 'contractSelectionRight',
	'extendSelectionToProjectStart', 'extendSelectionToProjectEnd',
];
const VIEW_KEYS = [
	'setTimelineView', 'setVideoPreviewResolution', 'toggleRms', 'toggleFadeShapeHandles', 'toggleVerticalRulers',
	'toggleScrollViewToPlayhead', 'togglePinnedPlayhead', 'toggleRulerPlayback', 'setSnap',
	'zoomIn', 'zoomOut', 'zoomDefault', 'zoomSelection', 'zoomToggle', 'zoomFit', 'fitHeight',
	'centerOnPlayhead', 'toggleArmControls', 'toggleMarkers', 'decreaseAllTrackHeights',
	'increaseAllTrackHeights', 'setWorkspace', 'togglePanel', 'openWorkspaceOnboarding',
];

function fixture() {
	const calls: unknown[][] = [];
	const methods = (owner: string) => new Proxy({}, {
		get: (_target, name) => (...args: unknown[]) => { calls.push([owner, name, ...args]); return name; },
	});
	const snapshot = { preferences: { view: { showFadeShapeHandles: true, showMarkers: false } } };
	const togglePanel = (panelId: string) => { calls.push(['panel', panelId]); };
	const ports = createWorkspaceSelectionViewMenuPorts({
		controller: { actions: { timeline: methods('timeline'), track: methods('track'), preferences: methods('preferences') } } as never,
		parityRuntime: { actions: { timeline: methods('parity') } } as never,
		snapshot,
		run: (operation) => { calls.push(['run']); return operation(); },
		zoomProject: (direction, anchor) => { calls.push(['zoom', direction, anchor]); },
		setShowArmControls: (update) => { calls.push(['arm', update(false), update(true)]); },
		toggleWorkspacePanel: togglePanel,
		openSurface: (surface) => { calls.push(['surface', surface]); },
	});
	return { calls, snapshot, togglePanel, ...ports };
}

test('two menu ports expose exact frozen selection and view contracts without resolving actions', () => {
	const f = fixture();
	assert.deepEqual(Object.keys(f.selectionMenu), SELECTION_KEYS);
	assert.deepEqual(Object.keys(f.viewMenu), VIEW_KEYS);
	assert.equal(Object.isFrozen(f.selectionMenu), true);
	assert.equal(Object.isFrozen(f.viewMenu), true);
	assert.deepEqual(f.calls, []);
	assert.equal(f.viewMenu.togglePanel, f.togglePanel);
});

test('menu ports preserve direct zoom, parity operations, snapshot toggles and functional arm updates', () => {
	const f = fixture();
	f.viewMenu.zoomIn();
	f.viewMenu.zoomOut();
	f.viewMenu.zoomDefault();
	f.viewMenu.zoomSelection();
	f.viewMenu.zoomToggle();
	f.viewMenu.centerOnPlayhead();
	f.viewMenu.setVideoPreviewResolution('half');
	f.viewMenu.toggleFadeShapeHandles();
	f.viewMenu.toggleMarkers();
	f.viewMenu.toggleArmControls();
	f.viewMenu.togglePanel('project-bin');
	f.viewMenu.openWorkspaceOnboarding();
	assert.deepEqual(f.calls, [
		['zoom', 'in', 'playhead'], ['zoom', 'out', 'playhead'],
		['run'], ['parity', 'zoomDefault'], ['run'], ['parity', 'zoomSelection'],
		['run'], ['parity', 'zoomToggle'], ['run'], ['parity', 'centerOnPlayhead'],
		['run'], ['preferences', 'update', { view: { videoPreviewResolution: 'half' } }],
		['run'], ['preferences', 'update', { view: { showFadeShapeHandles: false } }],
		['run'], ['preferences', 'update', { view: { showMarkers: true } }],
		['arm', true, false], ['panel', 'project-bin'], ['surface', 'workspace-onboarding'],
	]);
});

test('all selection delegates retain the run boundary and exact controller method', () => {
	const f = fixture();
	for (const action of Object.values(f.selectionMenu)) action();
	const methods = SELECTION_KEYS.map((name) => name === 'selectNone' ? 'clearSelection' : name);
	assert.deepEqual(f.calls, methods.flatMap((name) => [['run'], ['timeline', name]]));
});

test('selection menu failures retain the existing run error publication boundary', () => {
	const failure = new Error('selection refused');
	const published: unknown[] = [];
	const ports = createWorkspaceSelectionViewMenuPorts({
		controller: { actions: { timeline: { selectAll: () => { throw failure; } } } } as never,
		parityRuntime: {} as never, snapshot: {},
		run: (operation) => { try { return operation(); } catch (error) { published.push(error); return false; } },
		zoomProject: () => undefined, setShowArmControls: () => undefined,
		toggleWorkspacePanel: () => undefined, openSurface: () => undefined,
	});
	assert.equal(ports.selectionMenu.selectAll(), false);
	assert.deepEqual(published, [failure]);
});
