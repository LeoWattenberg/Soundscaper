/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1,
	updateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import { createApplicationViewMenu } from '../src/common/editor/ui/application-view-menu.js';
import { resolveVideoPreviewCompositorSize } from '../src/common/editor/ui/video-preview-compositor-size.js';
import { createVideoPreviewResolutionMenu } from '../src/common/editor/ui/video-preview-resolution-menu.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

test('video preview resolution defaults to full, preserves saved choices and refuses invalid values', () => {
	const defaults = createAudioEditorPreferencesV1();
	assert.equal(defaults.view.videoPreviewResolution, 'full');
	for (const resolution of ['half', 'quarter'] as const) {
		const reduced = updateAudioEditorPreferencesV1(defaults, { view: { videoPreviewResolution: resolution } });
		assert.equal(loadAudioEditorPreferencesV1(reduced).preferences.view.videoPreviewResolution, resolution);
		assert.equal(reduced.view.showFadeShapeHandles, defaults.view.showFadeShapeHandles);
	}
	const legacy = { ...defaults, view: { showMasterTrack: false, showMarkers: false } };
	assert.equal(loadAudioEditorPreferencesV1(legacy).preferences.view.videoPreviewResolution, 'full');
	for (const invalid of ['eighth', 0.5, null]) {
		assert.throws(() => createAudioEditorPreferencesV1({ view: { videoPreviewResolution: invalid } }),
			/view\.videoPreviewResolution/u);
		assert.throws(() => loadAudioEditorPreferencesV1({
			...defaults, view: { ...defaults.view, videoPreviewResolution: invalid },
		}), /view\.videoPreviewResolution/u);
	}
});

test('video preview resolution menu selects one saved choice and delegates all three values', () => {
	const selected: string[] = [];
	const menu = createVideoPreviewResolutionMenu(ENGLISH_COPY, 'half', (value) => { selected.push(value); });
	assert.equal(menu.label, 'Video preview resolution');
	assert.deepEqual(menu.items.map(({ label, checked }) => ({ label, checked })), [
		{ label: 'Full resolution', checked: false },
		{ label: 'Half resolution', checked: true },
		{ label: 'Quarter resolution', checked: false },
	]);
	for (const item of menu.items) item.onClick();
	assert.deepEqual(selected, ['full', 'half', 'quarter']);
	const german = createVideoPreviewResolutionMenu(GERMAN_COPY, undefined, () => {});
	assert.equal(german.label, 'Auflösung der Videovorschau');
	assert.equal(german.items[0]?.checked, true);
});

test('video preview resolution is reachable through View when video playback is available', () => {
	const preferences = createAudioEditorPreferencesV1({ view: { videoPreviewResolution: 'quarter' } });
	const menu = (videoPlayback: boolean) => createApplicationViewMenu({
		capabilities: { videoPlayback }, clipSelectionNavigationMenus: { skip: { id: 'skip' } },
		compactLayout: false, copy: ENGLISH_COPY, desktopHost: { view: [] }, divider: () => ({ id: 'divider' }),
		editBlocked: false, effectsPanelOpen: false, preferences, productItems: { view: [], mixer: [] },
		project: null, projectBinEffectivelyOpen: false, selectedAudioTrack: null, editSelectionActive: false,
		showArmControls: false, snapshot: { preferences }, uiFlags: {},
	}, { setVideoPreviewResolution: () => {} } as never);
	const entry = menu(true).items.find((item: { id?: string }) => item.id === 'video-preview-resolution');
	assert.ok(entry);
	assert.equal(entry.items[2]?.checked, true);
	assert.equal(menu(false).items.some((item: { id?: string }) => item.id === 'video-preview-resolution'), false);
});

const CANVAS = Object.freeze({ getBoundingClientRect: () => ({ width: 1_920, height: 1_080 }) });

test('preview resolution reduces displayed GPU dimensions with full-resolution default', () => {
	assert.deepEqual(resolveVideoPreviewCompositorSize(CANVAS), { width: 1_920, height: 1_080 });
	assert.deepEqual(resolveVideoPreviewCompositorSize(CANVAS, { previewResolution: 'half' }),
		{ width: 960, height: 540 });
	assert.deepEqual(resolveVideoPreviewCompositorSize(CANVAS, { previewResolution: 'quarter' }),
		{ width: 480, height: 270 });
});

test('exact rendering and export dimensions ignore preview resolution', () => {
	assert.deepEqual(resolveVideoPreviewCompositorSize(CANVAS, {
		outputWidth: 3_840, outputHeight: 2_160, previewResolution: 'quarter',
	}), { width: 3_840, height: 2_160 });
});
