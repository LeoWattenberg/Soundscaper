/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMenuActionFixture } from './helpers/application-menu-fixture.ts';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createWorkspaceEditItems } from '../src/common/editor/ui/workspace/workspace-edit-items.js';
import { hasLockedClipboardPasteTarget, planClipboardPasteTargets } from '../src/common/editor/clipboard-paste-targets.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

interface MenuItem { readonly id?: string; readonly disabled?: boolean; readonly items?: readonly MenuItem[] }

function findItem(items: readonly MenuItem[], id: string): MenuItem {
	for (const item of items) {
		if (item.id === id) return item;
		if (item.items) {
			const nested = flatten(item.items).find(candidate => candidate.id === id);
			if (nested) return nested;
		}
	}
	assert.fail(`Missing ${id}`);
}

function flatten(items: readonly MenuItem[]): readonly MenuItem[] {
	return items.flatMap(item => [item, ...flatten(item.items ?? [])]);
}

async function fixture(context: test.TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round6-paste-lock-${context.name}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1, durationSeconds: 0.1, frequency: 440 });
	const source = controller.getSnapshot();
	assert.ok(source.selectedTrackId);
	assert.ok(source.selectedClipId);
	const targetId = controller.actions.track.add({ name: 'Destination' });
	assert.ok(targetId);
	controller.actions.timeline.selectClip(source.selectedClipId);
	await controller.actions.edit.copy();
	controller.actions.timeline.selectTrack(targetId);
	return { controller, sourceTrackId: source.selectedTrackId, sourceClipId: source.selectedClipId, targetId };
}

for (const locked of [false, true]) test(`Paste projects its ${locked ? 'locked' : 'writable'} destination without disabling Copy`, async context => {
	const { controller, targetId, sourceClipId } = await fixture(context);
	if (locked) controller.actions.edit.commit({ type: 'track/update', trackId: targetId, changes: { locked: true } });
	const snapshot = controller.getSnapshot();
	const history = snapshot.history as unknown as Readonly<Record<string, unknown>>;
	assert.equal(Boolean(history.pasteTargetLocked), locked);
	assert.equal(history.hasClipboard, true);
	const menus = createApplicationMenus({ productId: 'soundscaper', aboutLabel: 'About', capabilities: {}, locale: 'en',
		copy: ENGLISH_COPY, project: snapshot.project, snapshot, blocked: false, editBlocked: false,
		showArmControls: false, selectionActive: false, selectedClip: null, durationFrames: 4800,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: null,
		actions: createMenuActionFixture(),
	}) as readonly MenuItem[];
	for (const id of ['action://paste', 'insert', 'action://trackedit/paste-insert-all-tracks-ripple']) {
		assert.equal(findItem(menus, id).disabled, locked, id);
	}
	const input = { copy: ENGLISH_COPY, editBlocked: false, editSelectionActive: true, hasClipboard: true,
		splitAvailable: false, pasteTargetLocked: Boolean(history.pasteTargetLocked) };
	const toolbar = createWorkspaceEditItems(input);
	assert.equal(toolbar.find(item => item.action === 'paste')?.disabled, locked);
	assert.equal(toolbar.find(item => item.action === 'copy')?.disabled, false);
	controller.actions.timeline.selectClip(sourceClipId);
	assert.equal(Boolean((controller.getSnapshot().history as unknown as Readonly<Record<string, unknown>>).pasteTargetLocked), false);
});

test('a copied multi-track range detects a locked later destination despite an unlocked anchor', async context => {
	const { controller, sourceTrackId, targetId } = await fixture(context);
	controller.actions.timeline.selectTrack(targetId);
	controller.actions.timeline.setSelection(0, 0, { trackIds: [targetId], clipIds: [] });
	await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1, durationSeconds: 0.1, frequency: 660 });
	const authored = controller.getSnapshot().project as unknown as SoundscaperProject;
	const generated = authored.tracks.find(track => track.id === targetId);
	assert.ok(generated && Array.isArray(generated.clipIds));
	assert.equal(generated.clipIds.length, 1);
	controller.actions.timeline.setSelection(0, 1000, { trackIds: [sourceTrackId, targetId] });
	assert.deepEqual(controller.getSnapshot().project!.selection?.trackIds, [sourceTrackId, targetId]);
	await controller.actions.edit.copy();
	controller.actions.edit.commit({ type: 'track/update', trackId: targetId, changes: { locked: true } });
	controller.actions.timeline.selectTrack(sourceTrackId);
	const snapshot = controller.getSnapshot();
	assert.equal(Boolean((snapshot.history as unknown as Readonly<Record<string, unknown>>).pasteTargetLocked), true);
	const before = snapshot.project;
	await controller.actions.edit.paste();
	assert.equal(controller.getSnapshot().status.state, 'error');
	assert.deepEqual(controller.getSnapshot().project, before);
});

test('Paste preserves origin fallback and skips an unrelated locked track of the wrong media type', () => {
	const tracks = [
		{ id: 'picture', type: 'video', clipIds: [], locked: true },
		{ id: 'recording', type: 'audio', clipIds: [], locked: false },
	];
	const clipboard = { tracks: [{ sourceTrackId: 'recording', sourceTrackType: 'audio', clips: [] }] };
	assert.equal(hasLockedClipboardPasteTarget({ tracks }, clipboard, 'picture'), false);
	assert.equal(hasLockedClipboardPasteTarget({ tracks }, clipboard, null), false);
	const locked = tracks.map(track => ({ ...track, locked: track.id === 'recording' }));
	assert.equal(hasLockedClipboardPasteTarget({ tracks: locked }, clipboard, null), true);
	assert.equal(hasLockedClipboardPasteTarget({ tracks }, null, 'picture'), false);
});

test('Paste detects both camera lanes and leaves fresh paired destinations writable', () => {
	const tracks = [
		{ id: 'video', type: 'video', laneGroupId: 'camera', clipIds: [], locked: false },
		{ id: 'audio', type: 'audio', laneGroupId: 'camera', clipIds: [], locked: true },
	];
	const clipboard = { tracks: [
		{ sourceTrackId: 'old-video', sourceTrackType: 'video', sourceLaneGroupId: 'old-camera', clips: [] },
		{ sourceTrackId: 'old-audio', sourceTrackType: 'audio', sourceLaneGroupId: 'old-camera', clips: [] },
	] };
	assert.equal(hasLockedClipboardPasteTarget({ tracks }, clipboard, 'video'), true);
	assert.equal(hasLockedClipboardPasteTarget({ tracks }, clipboard, 'audio'), true);
	const pair = planClipboardPasteTargets(tracks, 'audio', clipboard.tracks);
	assert.deepEqual(pair.map(group => group.map(entry => entry.target?.id)), [['video', 'audio']]);
	const fresh = planClipboardPasteTargets(tracks, null, clipboard.tracks);
	assert.deepEqual(fresh.map(group => group.map(entry => entry.target)), [[null, null]]);
	assert.equal(hasLockedClipboardPasteTarget({ tracks }, clipboard, null), false);
	assert.equal(hasLockedClipboardPasteTarget({ tracks: [] }, clipboard, 'missing'), false);
});

test('Paste uses each existing destination once before planning a fresh track', () => {
	const tracks = [{ id: 'audio', type: 'audio', clipIds: [], locked: false }];
	const clipboard = { tracks: [
		{ sourceTrackId: 'first', clips: [] }, { sourceTrackId: 'second', clips: [] },
	] };
	assert.deepEqual(planClipboardPasteTargets(tracks, 'audio', clipboard.tracks)
		.map(group => group.map(entry => entry.target?.id ?? null)), [['audio'], [null]]);
	assert.equal(hasLockedClipboardPasteTarget({ tracks }, clipboard, 'audio'), false);
});
