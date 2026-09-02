/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { EXPORT_MENU_COPY_BY_LOCALE } from '../src/common/i18n/export-menu-copy.js';
import { projectHasTimelineAudio } from '../src/common/editor/ui/timeline-media-presence.ts';
import { resolveAudioEditorShortcutHandler } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

const AUDIO_CLIP = Object.freeze({
	id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 0,
	durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20,
});
const VIDEO_CLIP = Object.freeze({ id: 'clip-v', kind: 'video', sourceId: 'source-v' });

test('Export audio stays available while the timeline carries an audio clip', () => {
	const item = exportAudioItem(projectWith([AUDIO_CLIP], [{ id: 'track-a', type: 'audio', clipIds: ['clip-a'], effects: [] }]));
	assert.equal(item.disabled, false);
	assert.equal(typeof item.onClick, 'function');
});

test('Export audio greys out when the timeline holds no audio', () => {
	for (const project of [
		null,
		projectWith([], [{ id: 'track-a', type: 'audio', clipIds: [], effects: [] }]),
		projectWith([VIDEO_CLIP], [{ id: 'track-a', type: 'audio', clipIds: ['clip-v'], effects: [] }]),
	]) {
		const item = exportAudioItem(project);
		assert.equal(item.disabled, true);
		assert.equal(item.onClick, undefined);
	}
});

test('the export shortcut stops resolving once the entry is greyed out', () => {
	const menus = createApplicationMenus(menuInput(projectWith([], [])));
	assert.equal(resolveAudioEditorShortcutHandler('export-audio', { menus }), null);
	const live = createApplicationMenus(menuInput(
		projectWith([AUDIO_CLIP], [{ id: 'track-a', type: 'audio', clipIds: ['clip-a'], effects: [] }]),
	));
	assert.equal(typeof resolveAudioEditorShortcutHandler('export-audio', { menus: live }), 'function');
});

test('a picture-only timeline keeps its one route into the export dialog', () => {
	const item = exportAudioItem(projectWith([VIDEO_CLIP], [{ id: 'track-v', type: 'video', clipIds: ['clip-v'] }]));
	assert.equal(item.disabled, false);
	assert.equal(typeof item.onClick, 'function');
});

test('the delivery command carries each product its own name', () => {
	const audio = [AUDIO_CLIP];
	const audioTrack = [{ id: 'track-a', type: 'audio', clipIds: ['clip-a'], effects: [] }];
	assert.equal(exportAudioItem(projectWith(audio, audioTrack)).label, EXPORT_MENU_COPY_BY_LOCALE.en.exportAudio);
	// Framescaper delivers picture from this entry, and the Audacity parity layer
	// must not canonicalize the video product's name back to the audio command.
	assert.equal(
		exportAudioItem(projectWith(audio, audioTrack), 'framescaper').label,
		EXPORT_MENU_COPY_BY_LOCALE.en.exportVideo,
	);
	assert.notEqual(EXPORT_MENU_COPY_BY_LOCALE.en.exportVideo, EXPORT_MENU_COPY_BY_LOCALE.en.exportAudio);
	for (const locale of ['en', 'de'] as const) {
		assert.equal(typeof EXPORT_MENU_COPY_BY_LOCALE[locale].exportVideo, 'string');
		assert.ok(EXPORT_MENU_COPY_BY_LOCALE[locale].exportVideo);
	}
});

test('timeline audio presence counts only audio clips sitting on audio tracks', () => {
	assert.equal(projectHasTimelineAudio(null), false);
	assert.equal(projectHasTimelineAudio({ tracks: [], clips: [] }), false);
	assert.equal(projectHasTimelineAudio({
		tracks: [{ id: 'track-a', type: 'audio', clipIds: [] }],
		clips: [AUDIO_CLIP],
	}), false);
	assert.equal(projectHasTimelineAudio({
		tracks: [{ id: 'track-v', type: 'video', clipIds: ['clip-a'] }],
		clips: [AUDIO_CLIP],
	}), false);
	assert.equal(projectHasTimelineAudio({
		tracks: [{ id: 'track-a', type: 'audio', clipIds: ['clip-a'] }],
		clips: [AUDIO_CLIP],
	}), true);
	// Documents written before clips carried a kind still describe audio.
	assert.equal(projectHasTimelineAudio({
		tracks: [{ id: 'track-a', type: 'audio', clipIds: ['clip-legacy'] }],
		clips: [{ id: 'clip-legacy', sourceId: 'source-a' }],
	}), true);
});

interface MenuItem {
	readonly id?: unknown;
	readonly label?: unknown;
	readonly disabled?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

function exportAudioItem(project: object | null, productId = 'soundscaper'): MenuItem {
	const menus = createApplicationMenus(menuInput(project, productId)) as readonly MenuItem[];
	const file = menus.find((menu) => menu.id === 'file');
	assert.ok(file, 'file');
	const item = file.items?.find((candidate) => candidate.id === 'export-audio');
	assert.ok(item, 'export-audio');
	return item;
}

function projectWith(clips: readonly object[], tracks: readonly object[]): object {
	return {
		id: 'project', sampleRate: 48_000,
		sources: [{ id: 'source-a', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips, tracks,
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
}

function menuInput(project: object | null, productId = 'soundscaper') {
	return {
		productId, aboutLabel: 'About', capabilities: {}, locale: 'en',
		copy: copyValues(), project,
		snapshot: {
			project, selectedTrackId: null,
			preferences: { workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {} },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, durationFrames: 100,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: null, actions: actionPorts(),
	};
}

function actionPorts(): object {
	return new Proxy({}, { get: () => () => undefined });
}

// Real catalog copy, so a label assertion measures the shipped wording rather
// than a stand-in; unrelated keys fall back to their own name.
function copyValues(): object {
	return new Proxy({ ...EXPORT_MENU_COPY_BY_LOCALE.en }, {
		get: (target, property) => Reflect.get(target, property) ?? String(property),
	});
}
