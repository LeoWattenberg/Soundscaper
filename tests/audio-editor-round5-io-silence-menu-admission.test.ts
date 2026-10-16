/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMenuActionFixture } from './helpers/application-menu-fixture.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { PRODUCT_PROFILES } from '../src/common/products.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { resolveAudioEditorShortcutHandler } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

interface MenuItem {
	readonly id?: string;
	readonly disabled?: boolean;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

function menu(productId: 'framescaper' | 'soundscaper', editBlocked = false, selected = true) {
	const source = createAudioSource({ id: 'recording', storageKey: 'recording',
		sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Dialogue',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 });
	const soundProject = createSoundscaperProject({ id: 'project', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })],
		selection: { startFrame: 0, endFrame: selected ? 48_000 : 0,
			trackIds: selected ? ['track'] : [], clipIds: selected ? [clip.id] : [] },
	});
	const project = productId === 'soundscaper' ? soundProject : createFramescaperProject(undefined, {
		...framescaperV20Options(),
		selection: { startFrame: 0, endFrame: selected ? 4_800 : 0,
			trackIds: selected ? ['audio-track'] : [], clipIds: selected ? ['audio-clip'] : [] },
	});
	const selectedClip = selected ? project.clips.find(candidate => candidate.kind !== 'video') : null;
	assert.ok(!selected || selectedClip);
	const selectedTrackId = project.tracks.find(track => selectedClip
		&& Array.isArray(track.clipIds) && track.clipIds.includes(selectedClip.id))?.id ?? null;
	const called: string[] = [];
	const menus = createApplicationMenus({ productId, aboutLabel: 'About',
		capabilities: PRODUCT_PROFILES[productId].capabilities, locale: 'en', copy: ENGLISH_COPY,
		project, snapshot: { project, selectedTrackId,
			preferences: createAudioEditorPreferencesV1(),
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		}, blocked: false, editBlocked, showArmControls: false, selectionActive: selected,
		selectedClip, durationFrames: 48_000, effectsPanelOpen: false,
		projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: null,
		actions: createMenuActionFixture({ executeEdit: (action: string) => { called.push(action); } }),
	}) as readonly MenuItem[];
	const removeSpecial = menus.find(item => item.id === 'edit')?.items?.find(item => item.id === 'remove-special');
	const silence = removeSpecial?.items?.find(item => item.id === 'silence-audio');
	const trim = removeSpecial?.items?.find(item => item.id === 'trim-audio-outside-selection');
	assert.ok(silence); assert.ok(trim);
	return { menus, silence, trim, called };
}

test('the actual Edit menu refuses unavailable audio generation while preserving supported trim', () => {
	const fixture = menu('framescaper');
	assert.equal(fixture.silence.disabled, true);
	assert.equal(fixture.trim.disabled, false);
});

test('an unsupported Silence action cannot resolve through the same shortcut menu', () => {
	assert.equal(resolveAudioEditorShortcutHandler('silence-audio', { menus: menu('framescaper').menus }), null);
});

test('Soundscaper retains the exact enabled Silence action', () => {
	const fixture = menu('soundscaper');
	assert.equal(fixture.silence.disabled, false);
	fixture.silence.onClick?.();
	assert.deepEqual(fixture.called, ['silenceSelection']);
	assert.equal(typeof resolveAudioEditorShortcutHandler('silence-audio', { menus: fixture.menus }), 'function');
});

test('existing editing and selection guards still prevent Soundscaper generation', () => {
	assert.equal(menu('soundscaper', true).silence.disabled, true);
	assert.equal(menu('soundscaper', false, false).silence.disabled, true);
});
