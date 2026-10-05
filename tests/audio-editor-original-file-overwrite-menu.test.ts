/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeApplicationMenu } from '../src/common/editor/ui/application-menu-materialization.ts';
import { createOriginalFileOverwriteMenuItems } from '../src/common/editor/ui/original-file-overwrite-menu.ts';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { AUDIO_EDITOR_DEFAULT_SHORTCUTS } from '../src/common/editor/preferences.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { findMenuItem } from './helpers/application-menu-fixture.ts';

type MenuItem = Record<string, unknown> & { items?: MenuItem[] };

const context = { copy: EDITOR_ENGLISH_COPY, blocked: false, recording: false,
	importing: false, materialAvailable: true };

test('original overwrite is an opt-in desktop File command with a localized filename', () => {
	assert.deepEqual(createOriginalFileOverwriteMenuItems(null, context), []);
	let calls = 0;
	const original = Object.freeze({ name: 'Voice $take.wav' });
	const port = { originalFile: () => original, overwrite: () => { calls += 1; } };
	for (const [copy, label] of [[EDITOR_ENGLISH_COPY, 'Overwrite Voice $take.wav'],
		[EDITOR_GERMAN_COPY, 'Voice $take.wav überschreiben']] as const) {
		const [item] = createOriginalFileOverwriteMenuItems(port, { ...context, copy });
		assert.ok(item);
		assert.equal(item.id, 'overwrite-original-file');
		assert.equal(item.label, label);
		assert.equal(item.preserveLabel, true);
		assert.equal(item.disabled, false);
		item.onClick();
	}
	assert.equal(calls, 2);
});

test('original overwrite remains discoverable but disabled without a supported single original or usable mix', () => {
	const port = { originalFile: () => null, overwrite: () => undefined };
	const [unavailable] = createOriginalFileOverwriteMenuItems(port, context);
	assert.equal(unavailable?.label, 'Overwrite original file');
	assert.equal(unavailable?.disabled, true);
	for (const state of [{ blocked: true }, { recording: true }, { importing: true }, { materialAvailable: false }]) {
		const [item] = createOriginalFileOverwriteMenuItems({ ...port,
			originalFile: () => ({ name: 'Voice.wav' }) }, { ...context, ...state });
		assert.equal(item?.disabled, true);
	}
});

test('original overwrite resolves stale capability availability when the menu opens', () => {
	let original: { name: string } | null = { name: 'Voice.wav' };
	let available = true;
	const [item] = createOriginalFileOverwriteMenuItems({
		originalFile: () => original, available: () => available, overwrite: () => undefined,
	}, context);
	assert.ok(item);
	assert.equal(materializeApplicationMenu(item).disabled, false);
	available = false;
	assert.equal(materializeApplicationMenu(item).disabled, true);
	available = true;
	original = null;
	assert.equal(materializeApplicationMenu(item).disabled, true);
	const replacement = Object.freeze({ name: 'Interview.wav' });
	const [rebuilt] = createOriginalFileOverwriteMenuItems({
		originalFile: () => replacement, overwrite: () => undefined,
	}, context);
	assert.equal(rebuilt?.label, 'Overwrite Interview.wav');
});

test('an already open overwrite item cannot replace a different original with the same filename', () => {
	const initial = Object.freeze({ id: 'first', name: 'Voice.wav' });
	let original: Readonly<{ id: string; name: string }> = initial;
	let calls = 0;
	const [item] = createOriginalFileOverwriteMenuItems({
		originalFile: () => original, overwrite: () => { calls += 1; },
	}, context);
	assert.ok(item);
	const openItem = materializeApplicationMenu(item);
	assert.equal(openItem.disabled, false);
	original = Object.freeze({ id: 'second', name: 'Voice.wav' });
	assert.equal(materializeApplicationMenu(item).disabled, true);
	openItem.onClick();
	assert.equal(calls, 0, 'the cached menu cannot retarget an overwrite');
	original = initial;
	openItem.onClick();
	openItem.onClick();
	assert.equal(calls, 2, 'the same imported original permits repeated overwrites');
});

function workspaceMenus(productId: string, isDesktop: boolean, overwrite: () => unknown): MenuItem[] {
	const original = Object.freeze({ name: 'Voice.wav' });
	const source = createAudioSource({ id: 'source', name: 'Voice', storageKey: 'source', mimeType: 'audio/wav',
		frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000,
		sourceDurationFrames: 48_000, timelineStartFrame: 0, sourceStartFrame: 0 });
	const track = createAudioTrack({ id: 'track', name: 'Voice', clipIds: [clip.id] });
	const project = { id: 'project', sampleRate: 48_000, sources: [source], clips: [clip], tracks: [track],
		selection: { trackIds: [], clipIds: [] }, loop: { enabled: false }, snap: { enabled: false } };
	const snapshot = { project, selectedTrackId: null,
		preferences: { workspace: { activeId: 'editing', custom: [],
			panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])) },
			view: {}, shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS },
		history: { canUndo: false, canRedo: false, hasClipboard: false },
		effects: { selectionTypes: [], canRepeatLast: false } };
	const input = { productId, aboutLabel: 'About', locale: 'en', copy: EDITOR_ENGLISH_COPY,
		project, snapshot, capabilities: { audioGenerators: true, audioEffects: true, audioAnalysis: true },
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, selectedAudioTrack: null, durationFrames: 0,
		projectBinEffectivelyOpen: false, uiFlags: {}, desktopHostRuntime: null,
		controller: { engine: null, actions: { export: { originalFile: () => original,
			overwriteOriginalAvailable: () => true, overwriteOriginal: overwrite } } },
		fileService: { isDesktop }, parityRuntime: { actions: null },
		run: (operation: () => unknown) => operation() };
	return createWorkspaceApplicationMenus(new Proxy(input, {
		get: (target, property, receiver) => Reflect.has(target, property)
			? Reflect.get(target, property, receiver) : () => undefined,
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0]) as MenuItem[];
}

test('both products wire original overwrite into the desktop File menu only', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		let calls = 0;
		assert.equal(findMenuItem(workspaceMenus(productId, false, () => undefined), 'overwrite-original-file'), null);
		const file = findMenuItem(workspaceMenus(productId, true, () => { calls += 1; }), 'file');
		assert.ok(file);
		const overwrite = findMenuItem(file.items ?? [], 'overwrite-original-file');
		assert.ok(overwrite);
		assert.equal(overwrite.label, 'Overwrite Voice.wav');
		assert.equal(overwrite.disabled, false);
		(overwrite.onClick as () => void)();
		assert.equal(calls, 1);
	}
});
