/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createAudioEditorUiActionController } from '../src/common/editor/audacity-action-runtime.js';
import { AUDACITY_ACTION_MANIFEST, AUDACITY_ACTION_STATUS } from '../src/common/editor/audacity-action-parity.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import {
	COMPACT_TRACK_PANEL_WIDTH,
	DESKTOP_TRACK_PANEL_WIDTH,
	resolveTrackPanelGeometry,
} from '../src/common/editor/ui/timeline/constants.ts';
import { TrackHeaderDrawerToggle } from '../src/common/editor/ui/timeline/TrackHeaderDrawerToggle.jsx';
import { isWithinTrackHeaderDrawer } from '../src/common/editor/ui/timeline/useTrackHeaderDrawerDismissal.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

// The .jsx modules compile against the global React the browser build provides.
(globalThis as unknown as { React: unknown }).React = React;

test('the drawer keeps the lane offset at zero while the headers keep their desktop width', () => {
	assert.deepEqual(resolveTrackPanelGeometry({ drawer: false, mobile: false }), {
		panelWidth: DESKTOP_TRACK_PANEL_WIDTH, trackHeaderWidth: DESKTOP_TRACK_PANEL_WIDTH,
	});
	assert.deepEqual(resolveTrackPanelGeometry({ drawer: false, mobile: true }), {
		panelWidth: COMPACT_TRACK_PANEL_WIDTH, trackHeaderWidth: COMPACT_TRACK_PANEL_WIDTH,
	});
	for (const mobile of [false, true]) {
		assert.deepEqual(resolveTrackPanelGeometry({ drawer: true, mobile }), {
			panelWidth: 0, trackHeaderWidth: DESKTOP_TRACK_PANEL_WIDTH,
		}, `drawer at mobile=${mobile}`);
	}
});

test('the track-header drawer is a session UI flag with a local View command', () => {
	const ui = createAudioEditorUiActionController();
	assert.equal(ui.getSnapshot().flags.trackHeaderDrawer, false);
	assert.equal(ui.actions.toggleFlag('trackHeaderDrawer'), true);
	ui.actions.setFlag('trackHeaderDrawer', false);
	assert.equal(ui.getSnapshot().flags.trackHeaderDrawer, false);

	const definition = AUDACITY_ACTION_MANIFEST['local://track-header-drawer'];
	assert.equal(definition.status, AUDACITY_ACTION_STATUS.IMPLEMENTED);
	assert.deepEqual(definition.locations, ['View']);
	assert.equal(definition.handler, 'workspace.toggleTrackHeaderDrawer');
	assert.equal(definition.origin, 'local');
});

test('the View menu offers the track headers toggle only in the compact layout', () => {
	const item = (compactLayout: boolean, open: boolean) => {
		const menus = createApplicationMenus({ ...menuInput(), compactLayout, uiFlags: { trackHeaderDrawer: open } }) as readonly MenuItem[];
		const view = menus.find(({ id }) => id === 'view');
		assert.ok(view);
		return findMenuItemOrNull(view.items ?? [], 'local://track-header-drawer');
	};
	assert.equal(item(false, false), null);
	assert.equal(item(true, false)?.checked, false);
	assert.equal(item(true, true)?.checked, true);
	assert.equal(item(true, true)?.label, ENGLISH_COPY.trackHeaders);
});

test('the drawer handle names its state', () => {
	const drawer = (isOpen: boolean) => ({ isOpen, toggle: () => undefined, close: () => undefined });
	const closed = renderToStaticMarkup(<TrackHeaderDrawerToggle copy={ENGLISH_COPY} drawer={drawer(false)} />);
	assert.match(closed, /data-track-header-toggle[^>]*aria-expanded="false"/u);
	assert.match(closed, new RegExp(`aria-label="${ENGLISH_COPY.trackHeadersShow}"`, 'u'));
	const open = renderToStaticMarkup(<TrackHeaderDrawerToggle copy={ENGLISH_COPY} drawer={drawer(true)} />);
	assert.match(open, /aria-expanded="true"/u);
	assert.match(open, new RegExp(`aria-label="${ENGLISH_COPY.trackHeadersHide}"`, 'u'));
});

test('the ruler corner is the handle and shows its content only while the drawer is open', () => {
	const view = readFileSync(new URL('../src/common/editor/ui/timeline/TimelineWorkspaceView.jsx', import.meta.url), 'utf8');
	assert.match(view, /data-track-header-drawer-strip=\{trackHeaderDrawer \? 'true' : undefined\}/u);
	assert.match(view, /\{trackHeaderDrawer && <TrackHeaderDrawerToggle/u);
	assert.match(view, /\{\(!trackHeaderDrawer \|\| trackHeaderDrawer\.isOpen\) && <TimelineRulerCornerContent/u);
	assert.match(view, /trackHeaderDrawer\.isOpen \? trackHeaderWidth : TRACK_HEADER_DRAWER_HANDLE_WIDTH/u);
});

test('pointer targets inside a header or the handle strip do not dismiss the drawer', () => {
	const target = (matches: string[]) => ({ closest: (selector: string) => (matches.some((m) => selector.includes(m)) ? {} : null) });
	assert.equal(isWithinTrackHeaderDrawer(target(['[data-track-header]'])), true);
	assert.equal(isWithinTrackHeaderDrawer(target(['[data-output-track-header]'])), true);
	assert.equal(isWithinTrackHeaderDrawer(target(['.audio-editor-track-folder-row__panel'])), true);
	assert.equal(isWithinTrackHeaderDrawer(target(['[data-track-header-drawer-strip]'])), true);
	assert.equal(isWithinTrackHeaderDrawer(target([])), false);
	assert.equal(isWithinTrackHeaderDrawer(null), false);
	assert.equal(isWithinTrackHeaderDrawer({}), false);
});

/*
 * With the drawer open the lanes start at x = 0 and the headers slide back over
 * them, so the lane's dimming wash and its sibling header overlap for the
 * header's whole width. Every track row carries `contain: layout paint`, which
 * makes the row a stacking context of its own: the wash and the header are
 * ordered against each other on the row's local scale, where a document-level
 * z-index does not sit under the dock chrome it was picked for - it simply wins
 * and paints the dimming over the header the drawer has just brought back.
 */
test('the drawer dims the lanes under the reopened headers, never over them', () => {
	const styles = (file: string) => readFileSync(
		new URL(`../src/common/editor/ui/audio-editor-design-system/${file}`, import.meta.url),
		'utf8',
	);
	const compact = styles('36-compact-layout.css');
	const tracks = styles('07-timeline-tracks.css');
	assert.match(styleBlock(tracks, '.audio-editor-track-row {'), /contain:\s*layout paint/u);

	const dim = styleZIndex(compact, '.audio-editor-track-lane::after {');
	const headers = [
		'.audio-editor-track-controls {',
		'.audio-editor-label-track-controls {',
		'.audio-editor-video-track-controls {',
	];
	for (const header of headers) {
		assert.ok(dim < styleZIndex(tracks, header), `${header} paints above the drawer dimming, not under it`);
	}
	assert.ok(
		dim < styleZIndex(compact, '.audio-editor-track-folder-row__panel {'),
		'the folder header paints above the drawer dimming, not under it',
	);

	// The wash still covers everything it is meant to darken: the lane's window
	// sits on the row's auto layer and its vertical ruler just above that.
	assert.ok(dim > 0, 'the dimming covers the lane content on the row\'s auto layer');
	assert.ok(
		dim > styleZIndex(styles('08-timeline-clips-effects.css'), '.audio-editor-vertical-ruler {'),
		'the dimming covers the lane\'s vertical ruler',
	);
});

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly checked?: boolean;
	readonly items?: readonly MenuItem[];
}

function findMenuItemOrNull(items: readonly MenuItem[], id: string): MenuItem | null {
	for (const item of items) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItemOrNull(item.items, id) : null;
		if (nested) return nested;
	}
	return null;
}

function menuInput() {
	const track = { id: 'audio-track', type: 'audio', locked: false, clipIds: [], hidden: false };
	return {
		productId: 'soundscaper',
		aboutLabel: 'About',
		capabilities: {},
		locale: 'en',
		copy: ENGLISH_COPY,
		project: {
			id: 'project', sampleRate: 48_000, sources: [], clips: [], tracks: [track],
			selection: null, loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
		},
		snapshot: {
			selectedTrackId: track.id,
			preferences: {
				workspace: {
					activeId: 'editing',
					custom: [],
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
				},
				view: {},
			},
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false,
		editBlocked: false,
		handoffBlocked: false,
		showArmControls: false,
		selectionActive: false,
		selectedClip: null,
		playheadSample: 0,
		durationFrames: 0,
		effectsPanelOpen: false,
		projectBinEffectivelyOpen: false,
		uiFlags: {},
		actionRuntime: null,
		actions: new Proxy({}, { get: () => () => undefined }),
	};
}

/** The declarations of the first rule whose selector contains `selector`. */
function styleBlock(css: string, selector: string): string {
	const start = css.indexOf(selector);
	assert.notEqual(start, -1, `${selector} is declared`);
	const open = css.indexOf('{', start);
	const close = css.indexOf('}', open);
	assert.ok(open !== -1 && close !== -1, `${selector} has a declaration block`);
	return css.slice(open + 1, close);
}

function styleZIndex(css: string, selector: string): number {
	const match = /z-index:\s*(-?\d+)/u.exec(styleBlock(css, selector));
	const value = Number(match?.[1]);
	assert.ok(Number.isInteger(value), `${selector} sets a numeric z-index`);
	return value;
}
