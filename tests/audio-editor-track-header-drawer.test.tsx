/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
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
import { TrackHeaderDrawerStrip } from '../src/common/editor/ui/timeline/TrackHeaderDrawerStrip.jsx';
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

test('the drawer strip names its state and hosts the corner content only while open', () => {
	const closed = renderToStaticMarkup(
		<TrackHeaderDrawerStrip copy={ENGLISH_COPY} drawer={{ isOpen: false, toggle: () => undefined, close: () => undefined }} height={34} width={268}>
			<span data-test-corner="true" />
		</TrackHeaderDrawerStrip>,
	);
	assert.match(closed, /data-track-header-toggle[^>]*aria-expanded="false"/u);
	assert.match(closed, new RegExp(`aria-label="${ENGLISH_COPY.trackHeadersShow}"`, 'u'));
	assert.doesNotMatch(closed, /data-test-corner/u);
	assert.doesNotMatch(closed, /width:268px/u);

	const open = renderToStaticMarkup(
		<TrackHeaderDrawerStrip copy={ENGLISH_COPY} drawer={{ isOpen: true, toggle: () => undefined, close: () => undefined }} height={34} width={268}>
			<span data-test-corner="true" />
		</TrackHeaderDrawerStrip>,
	);
	assert.match(open, /aria-expanded="true"/u);
	assert.match(open, new RegExp(`aria-label="${ENGLISH_COPY.trackHeadersHide}"`, 'u'));
	assert.match(open, /data-test-corner/u);
	assert.match(open, /width:268px/u);
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
