/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

interface Clip {
	readonly id: string;
	readonly kind: 'audio' | 'video';
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}
interface Selection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
	readonly clipIds: readonly string[];
	readonly frequencyRange?: Readonly<{ minimumFrequency: number; maximumFrequency: number }>;
}
interface MenuItem {
	readonly id?: string;
	readonly items?: readonly MenuItem[];
	readonly disabled?: boolean;
}
const recording: Clip = { id: 'recording', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000 };

test('ordinary time selections above the processor Repair limit are unavailable in both menu organizations', () => {
	for (const organization of ['default', 'sortby:name']) {
		for (const length of [129, 48_000]) {
			const menu = menus([recording], range(length), { organization });
			assert.equal(find(menu, 'audacity-repair').disabled, true, `${organization}: ${length} samples`);
			assert.equal(find(menu, 'audacity-invert').disabled, false);
		}
	}
});

test('Repair retains supported positive selections through the exact 128-sample boundary', () => {
	for (const length of [1, 64, 128]) {
		assert.equal(find(menus([recording], range(length)), 'audacity-repair').disabled, false, `${length} samples`);
	}
});

test('a time selection takes precedence over a longer focused recording', () => {
	assert.equal(find(menus([recording], range(128), { focusedClip: recording }), 'audacity-repair').disabled, false);
});

test('Repair retains independent short selected clips despite their long bracketing span', () => {
	const clips: Clip[] = [
		{ ...recording, id: 'first', durationFrames: 64 },
		{ ...recording, id: 'second', timelineStartFrame: 48_000, durationFrames: 128 },
	];
	assert.equal(find(menus(clips, clipSelection(clips)), 'audacity-repair').disabled, false);
	const longer = [clips[0], { ...clips[1], durationFrames: 129 }];
	assert.equal(find(menus(longer, clipSelection(longer)), 'audacity-repair').disabled, true);
});

test('non-audio selected clips do not alter the independent Repair target limit', () => {
	const clips: Clip[] = [{ ...recording, durationFrames: 128 },
		{ ...recording, id: 'camera', kind: 'video', durationFrames: 48_000 }];
	assert.equal(find(menus(clips, clipSelection(clips)), 'audacity-repair').disabled, false);
});

test('source selections retain their own sample clock and override the timeline target', () => {
	assert.equal(find(menus([recording], range(48_000), { sourceSelectionFrames: 128 }), 'audacity-repair').disabled, false);
	assert.equal(find(menus([recording], range(64), { sourceSelectionFrames: 129 }), 'audacity-repair').disabled, true);
});

test('a clip-authored spectral selection uses its independent clip targets', () => {
	const clip = { ...recording, durationFrames: 129 };
	const selection = { ...range(64), clipIds: [clip.id], frequencyRange: { minimumFrequency: 300, maximumFrequency: 600 } };
	assert.equal(find(menus([clip], selection), 'audacity-repair').disabled, true);
});

test('the focused clip fallback suspends a long recording and retains a short clip', () => {
	assert.equal(find(menus([recording], null, { focusedClip: recording }), 'audacity-repair').disabled, true);
	const short = { ...recording, durationFrames: 128 };
	assert.equal(find(menus([short], null, { focusedClip: short }), 'audacity-repair').disabled, false);
});

function range(length: number): Selection {
	return { startFrame: 12_000, endFrame: 12_000 + length, trackIds: ['audio'], clipIds: [] };
}
function clipSelection(clips: readonly Clip[]): Selection {
	return { startFrame: 0, endFrame: 0, trackIds: ['audio'], clipIds: clips.map(({ id }) => id) };
}
function menus(clips: readonly Clip[], selection: Selection | null,
	options: Readonly<{ organization?: string; focusedClip?: Clip; sourceSelectionFrames?: number }> = {}): readonly MenuItem[] {
	const project = {
		id: 'project', sampleRate: 48_000,
		sources: [{ id: 'source', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: clips.map(clip => ({ ...clip, sourceId: 'source', sourceStartFrame: 0, sourceDurationFrames: clip.durationFrames })),
		tracks: [
			{ id: 'audio', type: 'audio', clipIds: clips.filter(({ kind }) => kind === 'audio').map(({ id }) => id), effects: [] },
			{ id: 'video', type: 'video', clipIds: clips.filter(({ kind }) => kind === 'video').map(({ id }) => id), effects: [] },
		],
		selection, loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
	return createApplicationMenus({
		productId: 'soundscaper', aboutLabel: 'About', capabilities: { audioEffects: true }, locale: 'en',
		copy: new Proxy({}, { get: (_target, property) => String(property) }), project,
		snapshot: {
			selectedTrackId: 'audio', selectedClipId: options.focusedClip?.id ?? null,
			preferences: { workspace: { activeId: 'editing', custom: [], panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map(id => [id, { visible: false }])) },
				view: {}, effects: { menuOrganization: options.organization } },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [ { type: 'audacity-repair', label: 'Repair' }, { type: 'audacity-invert', label: 'Invert' } ],
				canRepeatLast: false, sourceSelectionFrames: options.sourceSelectionFrames ?? null },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: Boolean(selection && selection.endFrame > selection.startFrame), selectedClip: options.focusedClip ?? null,
		durationFrames: 96_000, effectsPanelOpen: false, projectBinEffectivelyOpen: false,
		uiFlags: {}, actionRuntime: null, actions: new Proxy({}, { get: () => () => undefined }),
	}) as readonly MenuItem[];
}
function find(items: readonly MenuItem[], id: string): MenuItem {
	for (const item of items) {
		if (item.id === id) return item;
		if (item.items) {
			const nested = flatten(item.items).find(candidate => candidate.id === id);
			if (nested) return nested;
		}
	}
	throw new Error(`Missing ${id}`);
}
function flatten(items: readonly MenuItem[]): readonly MenuItem[] {
	return items.flatMap(item => [item, ...flatten(item.items ?? [])]);
}
