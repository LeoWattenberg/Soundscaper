import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioEditorTrackBlockBounds,
	moveAudioEditorTrackBlock,
} from '../src/common/editor/ui/application-menu-model.js';
import { AUDACITY_MENU_ORDER } from '../src/common/editor/ui/application-menu-order.ts';
import {
	DEFAULT_PLAYBACK_METER_SETTINGS,
	normalizeMeterSettings,
	productStorageKey,
} from '../src/common/editor/ui/meter-settings.ts';
import {
	findShortcutMenuHandler,
	handleWorkspaceKeyboard,
	matchAudioEditorShortcut,
	projectZoomShortcut,
	videoNavigationShortcut,
} from '../src/common/editor/ui/workspace-shortcuts.ts';
import {
	projectBinItems,
	projectBinWaveformPath,
} from '../src/common/editor/ui/workspace/project-bin-model.ts';
import { clampFloatingPanelGeometry } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

test('meter settings normalize persisted values at the module boundary', () => {
	assert.deepEqual(normalizeMeterSettings({
		position: 'missing',
		style: 'rms',
		type: 'ebu-r128',
		dbRange: 84,
		ebuScale: 'plus18',
		ebuUnit: 'relative',
		ebuLiveValue: 'short-term',
	}, DEFAULT_PLAYBACK_METER_SETTINGS), {
		position: 'side',
		style: 'rms',
		type: 'ebu-r128',
		dbRange: 84,
		ebuScale: 'plus18',
		ebuUnit: 'relative',
		ebuLiveValue: 'short-term',
	});
	assert.equal(productStorageKey('soundscaper-meter-v2', 'framescaper'), 'framescaper-meter-v2');
});

test('the application menubar keeps Transport reachable in canonical order', () => {
	assert.ok(AUDACITY_MENU_ORDER.includes('transport-menu'));
	assert.ok(AUDACITY_MENU_ORDER.indexOf('transport-menu') > AUDACITY_MENU_ORDER.indexOf('view'));
	assert.ok(AUDACITY_MENU_ORDER.indexOf('transport-menu') < AUDACITY_MENU_ORDER.indexOf('tracks'));
});

test('floating panels are clamped to the visible workspace', () => {
	assert.deepEqual(clampFloatingPanelGeometry({
		x: 900,
		y: -10,
		width: 500,
		height: 400,
	}, { width: 640, height: 360 }), {
		x: 140,
		y: 0,
		width: 500,
		height: 360,
	});
});

test('workspace shortcut helpers preserve canonical keyboard behavior', () => {
	assert.equal(projectZoomShortcut({ altKey: false, code: 'NumpadAdd', ctrlKey: true, key: '+', metaKey: false }), 'zoom-in');
	assert.equal(matchAudioEditorShortcut({
		altKey: false,
		ctrlKey: true,
		key: 'k',
		metaKey: false,
		shiftKey: true,
	}, { split: ['Ctrl+Shift+K'] }), 'split');

	const handler = () => undefined;
	assert.deepEqual(findShortcutMenuHandler([{
		id: 'parent',
		items: [{ id: 'split', onClick: handler }],
	}], 'split'), { matched: true, handler });
});

test('Framescaper video navigation reserves deliberate unmodified J K L and arrow presses', () => {
	const event = (key: string, overrides: Record<string, unknown> = {}) => ({
		altKey: false,
		ctrlKey: false,
		key,
		metaKey: false,
		repeat: false,
		shiftKey: false,
		...overrides,
	});
	assert.equal(videoNavigationShortcut(event('j')), 'shuttleBackward');
	assert.equal(videoNavigationShortcut(event('K')), 'shuttleStop');
	assert.equal(videoNavigationShortcut(event('l')), 'shuttleForward');
	assert.equal(videoNavigationShortcut(event('ArrowUp')), 'previousEdit');
	assert.equal(videoNavigationShortcut(event('ArrowDown')), 'nextEdit');
	assert.equal(videoNavigationShortcut(event('l', { repeat: true })), null);
	assert.equal(videoNavigationShortcut(event('l', { shiftKey: true })), null);
	assert.equal(videoNavigationShortcut(event('ArrowLeft')), null);
});

test('Framescaper ignores held shuttle keys without falling through to Loop', () => {
	const calls: string[] = [];
	let prevented = false;
	const keyboardEvent = (repeat: boolean) => ({
		altKey: false,
		code: 'KeyL',
		ctrlKey: false,
		defaultPrevented: false,
		key: 'l',
		metaKey: false,
		repeat,
		shiftKey: false,
		target: null,
		preventDefault() { prevented = true; },
	});
	const snapshot = { preferences: { shortcuts: { loop: ['L'] } } };
	const registry = {
		videoNavigation: { shuttleForward: () => calls.push('shuttle') },
		menus: [{ id: 'loop', onClick: () => calls.push('loop') }],
	};
	handleWorkspaceKeyboard(keyboardEvent(true), snapshot, (handler) => handler(), registry);
	assert.deepEqual(calls, []);
	assert.equal(prevented, false);
	handleWorkspaceKeyboard(keyboardEvent(false), snapshot, (handler) => handler(), registry);
	assert.deepEqual(calls, ['shuttle']);
	assert.equal(prevented, true);
});

test('project-bin view models deduplicate items and create bounded waveform paths', () => {
	const clips = [
		{ id: 'video', binItemId: 'asset', kind: 'video', durationFrames: 4 },
		{ id: 'audio', binItemId: 'asset', kind: 'audio', durationFrames: 4 },
	];
	const items = projectBinItems(clips);
	assert.equal(items.length, 1);
	assert.equal(items[0].primaryClip.id, 'video');
	assert.equal(items[0].clips.length, 2);

	const path = projectBinWaveformPath({
		peaks: {
			levels: [{
				blockSize: 1,
				channels: [{ minimums: [-0.5, -1, 0], maximums: [0.5, 1, 0] }],
			}],
		},
	}, { id: 'audio', sourceStartFrame: 0, sourceDurationFrames: 3 }, 3, 20);
	assert.match(path, /^M0\.00 /u);
	assert.equal(path.split('M').length - 1, 3);
});

test('application-menu track moves keep linked lane blocks together', () => {
	const tracks = [
		{ id: 'intro' },
		{ id: 'video', laneGroupId: 'linked' },
		{ id: 'audio', laneGroupId: 'linked' },
		{ id: 'outro' },
	];
	assert.deepEqual(audioEditorTrackBlockBounds(tracks, 'audio'), { start: 1, end: 2 });

	const calls: unknown[][] = [];
	const controller = { actions: { track: { reorder: (...args: unknown[]) => calls.push(args) } } };
	moveAudioEditorTrackBlock(controller, tracks, 'video', 'down');
	assert.deepEqual(calls, [['video', 3]]);
});
