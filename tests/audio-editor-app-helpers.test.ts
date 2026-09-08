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
	isWorkspaceModalShortcutTarget,
	matchAudioEditorShortcut,
	matchesAudioEditorShortcutBinding,
	projectZoomShortcut,
	resolveAudioEditorShortcutHandler,
	videoNavigationShortcut,
} from '../src/common/editor/ui/workspace-shortcuts.ts';
import { AUDIO_EDITOR_DEFAULT_SHORTCUTS, normalizeAudioEditorShortcut } from '../src/common/editor/preferences.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import {
	projectBinItems,
	projectBinPeakRanges,
	projectBinWaveformPath,
} from '../src/common/editor/ui/workspace/project-bin-model.ts';
import { clampFloatingPanelGeometry } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { retainElementSize } from '../src/common/editor/ui/DesignSystemRuntime.jsx';

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

test('the application menubar omits the redundant playback and recording menu', () => {
	assert.deepEqual(AUDACITY_MENU_ORDER.slice(3, 5), ['view', 'tracks']);
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

test('element size snapshots retain identity when observer measurements are unchanged', () => {
	const current = { width: 640, height: 360 };
	assert.equal(retainElementSize(current, 640.2, 359.8), current);
	assert.deepEqual(retainElementSize(current, 800.4, 450.4), { width: 800, height: 450 });
	assert.deepEqual(retainElementSize(current, 0, 0), { width: 1, height: 1 });
});

test('workspace shortcut helpers preserve canonical keyboard behavior', () => {
	assert.equal(projectZoomShortcut({ altKey: false, code: 'NumpadAdd', ctrlKey: true, key: '+', metaKey: false }), 'zoom-in');
	assert.equal(matchAudioEditorShortcut({
		altKey: false,
		code: 'KeyK',
		ctrlKey: true,
		key: 'k',
		metaKey: false,
		shiftKey: true,
	}, { split: ['Ctrl+Shift+K'] }), 'split');
	assert.equal(matchAudioEditorShortcut({
		altKey: false,
		code: 'NumpadEnter',
		ctrlKey: false,
		key: 'Enter',
		metaKey: false,
		shiftKey: false,
	}, { toggle: ['NUMPAD_ENTER'] }), 'toggle');

	const handler = () => undefined;
	assert.deepEqual(findShortcutMenuHandler([{
		id: 'parent',
		items: [{ id: 'split', onClick: handler }],
	}], 'split'), { matched: true, handler });
});

test('workspace shortcut matching recovers Audacity shifted punctuation from browser key codes', () => {
	for (const [key, code, actionId] of [
		['~', 'Backquote', 'track-view-prev-panel'],
		['<', 'Comma', 'cursor-long-jump-left'],
		['>', 'Period', 'cursor-long-jump-right'],
	] as const) {
		assert.equal(matchAudioEditorShortcut({
			altKey: false,
			code,
			ctrlKey: false,
			key,
			metaKey: false,
			shiftKey: true,
		}, AUDIO_EDITOR_DEFAULT_SHORTCUTS), actionId);
	}
});

test('workspace shortcut matching distinguishes Ctrl, Meta, and their exact combination', () => {
	const event = (ctrlKey: boolean, metaKey: boolean) => ({
		altKey: false,
		code: 'KeyK',
		ctrlKey,
		key: 'k',
		metaKey,
		shiftKey: false,
	});
	const shortcuts = {
		primary: ['Ctrl+K'],
		meta: ['Meta+K'],
		combined: ['Ctrl+Meta+K'],
	};
	assert.equal(matchAudioEditorShortcut(event(true, false), shortcuts), 'primary');
	assert.equal(matchAudioEditorShortcut(event(false, true), shortcuts), 'primary');
	assert.equal(matchAudioEditorShortcut(event(true, true), shortcuts), 'combined');
	assert.equal(matchAudioEditorShortcut(event(false, true), { meta: ['Meta+K'] }), 'meta');
	assert.equal(matchAudioEditorShortcut(event(true, false), { meta: ['Meta+K'] }), null);
	assert.equal(matchesAudioEditorShortcutBinding(event(true, false), 'Ctrl+K'), true);
	assert.equal(matchesAudioEditorShortcutBinding(event(false, true), 'Ctrl+K'), true);
	assert.equal(matchesAudioEditorShortcutBinding(event(true, true), 'Ctrl+K'), false);
});

test('every installed Audacity binding round-trips through the browser matcher', () => {
	const browserKeys: Record<string, string> = {
		Space: ' ', Del: 'Delete', Return: 'Enter', NumpadEnter: 'Enter',
		Down: 'ArrowDown', Up: 'ArrowUp', Left: 'ArrowLeft', Right: 'ArrowRight',
	};
	const browserCodes: Record<string, string> = {
		'`': 'Backquote', ',': 'Comma', '.': 'Period', '-': 'Minus', '=': 'Equal',
		'[': 'BracketLeft', ']': 'BracketRight', NumpadEnter: 'NumpadEnter',
	};
	const shiftedKeys: Record<string, string> = { '`': '~', ',': '<', '.': '>' };

	for (const [actionId, bindings] of Object.entries(AUDIO_EDITOR_DEFAULT_SHORTCUTS) as [string, readonly string[]][]) {
		for (const binding of bindings) {
			const parts = normalizeAudioEditorShortcut(binding).split('+');
			const configuredKey = parts.pop() ?? '';
			const modifiers = new Set(parts);
			const key = modifiers.has('Shift')
				? shiftedKeys[configuredKey] ?? browserKeys[configuredKey] ?? configuredKey
				: browserKeys[configuredKey] ?? configuredKey;
			const code = browserCodes[configuredKey]
				?? (/^[A-Z]$/u.test(configuredKey) ? `Key${configuredKey}` : configuredKey);
			assert.equal(matchAudioEditorShortcut({
				altKey: modifiers.has('Alt'),
				code,
				ctrlKey: modifiers.has('Ctrl'),
				key,
				metaKey: modifiers.has('Meta'),
				shiftKey: modifiers.has('Shift'),
			}, AUDIO_EDITOR_DEFAULT_SHORTCUTS), actionId, `${actionId}: ${binding}`);
		}
	}
});

test('workspace shortcut resolution rejects product-disabled actions and submenu containers', () => {
	const disabledActionIds: readonly string[] = Object.freeze(['record']);
	const runtime = {
		recording: { startNewTrack: () => 'recorded' },
		track: { openAlignMenu: () => 'aligned', openSortMenu: () => 'sorted' },
	};
	assert.equal(resolveAudioEditorShortcutHandler('record-on-new-track', {
		actionRuntime: runtime,
		disabledActionIds,
	}), null);
	assert.equal(resolveAudioEditorShortcutHandler('menu-align', { actionRuntime: runtime }), null);
	assert.equal(resolveAudioEditorShortcutHandler('menu-sort', { actionRuntime: runtime }), null);
});

test('workspace shortcut resolution evaluates known manifest enablement against the live runtime', () => {
	let project: object | null = null;
	const save = () => 'saved';
	const custom = () => 'custom';
	const runtime = {
		getActionContext: () => ({ snapshot: { project } }),
		project: { save },
	};
	assert.equal(resolveAudioEditorShortcutHandler('file-save', { actionRuntime: runtime }), null);
	assert.equal(resolveAudioEditorShortcutHandler('file-save', {
		actionRuntime: runtime,
		menus: [{ id: 'file-save', onClick: save }],
	}), null, 'an enabled-looking menu cannot bypass the manifest predicate');
	assert.equal(resolveAudioEditorShortcutHandler('custom-action', {
		actionRuntime: runtime,
		menus: [{ id: 'custom-action', onClick: custom }],
	}), custom, 'local commands outside the manifest retain their menu enablement');
	project = { tracks: [], clips: [], selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] } };
	assert.equal(resolveAudioEditorShortcutHandler('file-save', { actionRuntime: runtime }), save);
});

test('F2 rename and Ctrl+Shift+P pitch shortcuts require their manifest clip state', () => {
	let selected = false;
	const rename = () => 'renamed';
	const pitchSpeed = () => 'pitch-speed';
	const runtime = {
		getActionContext: () => ({ snapshot: {
			project: {
				tracks: [{ id: 'track-1', type: 'audio', clipIds: selected ? ['clip-1'] : [] }],
				clips: selected ? [{ id: 'clip-1' }] : [],
				selection: { startFrame: 0, endFrame: 0, trackIds: ['track-1'], clipIds: selected ? ['clip-1'] : [] },
			},
			selectedTrackId: 'track-1',
			selectedClipId: selected ? 'clip-1' : null,
			readOnly: false,
		} }),
		clip: { rename, openPitchSpeed: pitchSpeed },
	};
	assert.equal(resolveAudioEditorShortcutHandler('rename-item', { actionRuntime: runtime }), null);
	assert.equal(resolveAudioEditorShortcutHandler('clip-pitch-speed', { actionRuntime: runtime }), null);
	selected = true;
	assert.equal(resolveAudioEditorShortcutHandler('rename-item', { actionRuntime: runtime }), rename);
	assert.equal(resolveAudioEditorShortcutHandler('clip-pitch-speed', { actionRuntime: runtime }), pitchSpeed);
});

test('workspace shortcuts never escape an open dialog into editor actions', () => {
	const dom = installReactTestDom();
	try {
		const dialog = document.createElement('section');
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		const panel = document.createElement('div');
		const background = document.createElement('button');
		dialog.appendChild(panel);
		dom.container.appendChild(dialog as never);
		dom.container.appendChild(background as never);
		let calls = 0;
		let prevented = false;
		const event = {
			altKey: false,
			code: 'KeyZ',
			ctrlKey: true,
			defaultPrevented: false,
			key: 'z',
			metaKey: false,
			repeat: false,
			shiftKey: false,
			target: panel,
			preventDefault: () => { prevented = true; },
		};
		assert.equal(isWorkspaceModalShortcutTarget(panel), true);
		assert.equal(
			isWorkspaceModalShortcutTarget(background),
			true,
			'an open modal owns shortcuts before its deferred focus lands',
		);
		handleWorkspaceKeyboard(
			event,
			{ preferences: { shortcuts: { undo: ['Ctrl+Z'] } } },
			(handler) => handler(),
			{ menus: [{ id: 'undo', onClick: () => { calls += 1; } }] },
		);
		assert.equal(calls, 0);
		assert.equal(prevented, false, 'the dialog remains the sole owner of its keystroke');
	} finally {
		dom.restore();
	}
});

test('workspace shortcuts never escape an alert dialog before or after focus moves into it', () => {
	const dom = installReactTestDom();
	try {
		const dialog = document.createElement('section');
		dialog.setAttribute('role', 'alertdialog');
		dialog.setAttribute('aria-modal', 'true');
		const panel = document.createElement('div');
		const background = document.createElement('div');
		dialog.appendChild(panel);
		dom.container.appendChild(dialog as never);
		dom.container.appendChild(background as never);
		assert.equal(isWorkspaceModalShortcutTarget(panel), true);
		assert.equal(isWorkspaceModalShortcutTarget(background), true);
	} finally {
		dom.restore();
	}
});

test('workspace zoom shortcuts leave editable inputs and their Escape behavior alone', () => {
	const dom = installReactTestDom();
	try {
		const input = document.createElement('input');
		dom.container.appendChild(input as never);
		const calls: string[] = [];
		for (const [key, code] of [['=', 'Equal'], ['-', 'Minus'], ['Escape', 'Escape']] as const) {
			let prevented = 0;
			handleWorkspaceKeyboard({
				altKey: false,
				code,
				ctrlKey: key !== 'Escape',
				defaultPrevented: false,
				key,
				metaKey: false,
				repeat: false,
				shiftKey: false,
				target: input,
				preventDefault: () => { prevented += 1; },
			}, { preferences: { shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS } }, (handler) => handler(), {
				menus: [
					{ id: 'zoom-in', onClick: () => calls.push('zoom-in') },
					{ id: 'zoom-out', onClick: () => calls.push('zoom-out') },
				],
			});
			assert.equal(prevented, 0, `${key} remains owned by the input`);
		}
		assert.deepEqual(calls, []);
	} finally {
		dom.restore();
	}
});

test('workspace zoom dispatch follows persisted assignments and removals', () => {
	const calls: string[] = [];
	const shortcuts = { 'zoom-in': ['Alt+='] };
	const dispatch = (ctrlKey: boolean, altKey: boolean) => {
		let prevented = false;
		handleWorkspaceKeyboard({
			altKey,
			code: 'Equal',
			ctrlKey,
			defaultPrevented: false,
			key: '=',
			metaKey: false,
			repeat: false,
			shiftKey: false,
			target: null,
			preventDefault: () => { prevented = true; },
		}, { preferences: { shortcuts } }, (handler) => handler(), {
			menus: [{ id: 'zoom-in', onClick: () => calls.push('zoom-in') }],
		});
		return prevented;
	};

	assert.equal(dispatch(true, false), false, 'the removed Audacity default is not hard-wired');
	assert.deepEqual(calls, []);
	assert.equal(dispatch(false, true), true, 'the customized chord is dispatched');
	assert.deepEqual(calls, ['zoom-in']);
});

test('workspace dispatch preserves Audacity zoom-in aliases without hard-wiring a removed binding', () => {
	const dispatch = (shortcuts: Record<string, readonly string[]>, key: string, code: string, shiftKey: boolean) => {
		let calls = 0;
		let prevented = 0;
		handleWorkspaceKeyboard({
			altKey: false,
			code,
			ctrlKey: true,
			defaultPrevented: false,
			key,
			metaKey: false,
			repeat: false,
			shiftKey,
			target: null,
			preventDefault: () => { prevented += 1; },
		}, { preferences: { shortcuts } }, (handler) => handler(), {
			menus: [{ id: 'zoom-in', onClick: () => { calls += 1; } }],
		});
		return { calls, prevented };
	};

	assert.deepEqual(dispatch({ 'zoom-in': ['Ctrl+='] }, '+', 'Equal', true), { calls: 1, prevented: 1 });
	assert.deepEqual(dispatch({ 'zoom-in': ['Ctrl+='] }, '+', 'NumpadAdd', false), { calls: 1, prevented: 1 });
	assert.deepEqual(dispatch({}, '+', 'Equal', true), { calls: 0, prevented: 0 });
});

test('modified global shortcuts dispatch from controls while native editing and tool gestures remain local', () => {
	const dom = installReactTestDom();
	try {
		const button = document.createElement('button');
		const input = document.createElement('input');
		dom.container.appendChild(button as never);
		dom.container.appendChild(input as never);
		const calls: string[] = [];
		const dispatch = (target: Element, key: string, ctrlKey: boolean, shiftKey = false) => {
			handleWorkspaceKeyboard({
				altKey: false,
				code: `Key${key.toUpperCase()}`,
				ctrlKey,
				defaultPrevented: false,
				key,
				metaKey: false,
				repeat: false,
				shiftKey,
				target,
				preventDefault: () => undefined,
			}, { preferences: { shortcuts: {
				'file-save': ['Ctrl+S'],
				fullscreen: ['F11'],
				'track-view-item-context-menu': ['Shift+F10'],
				'action://copy': ['Ctrl+C'],
				'action://playback/play': ['P'],
				'split-tool': ['Shift+S'],
			} } }, (handler) => handler(), { menus: [
				{ id: 'file-save', onClick: () => calls.push('save') },
				{ id: 'fullscreen', onClick: () => calls.push('fullscreen') },
				{ id: 'track-view-item-context-menu', onClick: () => calls.push('context-menu') },
				{ id: 'action://copy', onClick: () => calls.push('copy') },
				{ id: 'action://playback/play', onClick: () => calls.push('play') },
				{ id: 'split-tool', onClick: () => calls.push('split-tool') },
			] });
		};
		dispatch(button, 's', true);
		dispatch(button, 'p', false);
		dispatch(button, 's', false, true);
		dispatch(input, 's', true);
		dispatch(input, 'c', true);
		dispatch(input, 'F11', false);
		dispatch(input, 'F10', false, true);
		assert.deepEqual(calls, ['save', 'play', 'save', 'fullscreen']);
	} finally {
		dom.restore();
	}
});

test('workspace dispatches imported alternative shortcut bindings exactly once', () => {
	const calls: string[] = [];
	const menus = [
		{ id: 'action://delete', onClick: () => calls.push('action://delete') },
		{ id: 'delete-all-tracks-ripple', onClick: () => calls.push('delete-all-tracks-ripple') },
		{ id: 'track-view-toggle-selection', onClick: () => calls.push('track-view-toggle-selection') },
	];
	const dispatch = (key: string, code: string, ctrlKey: boolean, expectedActionId: string) => {
		let prevented = 0;
		let runs = 0;
		const event = {
			altKey: false,
			code,
			ctrlKey,
			defaultPrevented: false,
			key,
			metaKey: false,
			repeat: false,
			shiftKey: false,
			target: null,
			preventDefault: () => { prevented += 1; },
		};
		assert.equal(matchAudioEditorShortcut(event, AUDIO_EDITOR_DEFAULT_SHORTCUTS), expectedActionId);
		handleWorkspaceKeyboard(event, { preferences: { shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS } }, (handler) => {
			runs += 1;
			return handler();
		}, { menus });
		assert.equal(runs, 1, `${key} invokes one dispatcher handler`);
		assert.equal(prevented, 1, `${key} is consumed once`);
		assert.equal(calls.at(-1), expectedActionId);
	};

	dispatch('Backspace', 'Backspace', false, 'action://delete');
	dispatch('Backspace', 'Backspace', true, 'delete-all-tracks-ripple');
	dispatch('Enter', 'Enter', true, 'track-view-toggle-selection');
	dispatch('Enter', 'Enter', false, 'track-view-toggle-selection');
	assert.deepEqual(calls, [
		'action://delete',
		'delete-all-tracks-ripple',
		'track-view-toggle-selection',
		'track-view-toggle-selection',
	]);
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

test('project-bin peak ranges only read blocks covered by the clip window', () => {
	const length = 1_000_000;
	const reads: number[] = [];
	const channel = (sign: number): ArrayLike<number> => new Proxy({ length } as ArrayLike<number>, {
		get(target, property, receiver) {
			if (property === 'length') return length;
			if (typeof property === 'string' && /^\d+$/u.test(property)) {
				const index = Number(property);
				reads.push(index);
				assert.ok(index >= 400 && index < 408, `read off-window peak block ${index}`);
				return sign * (index - 399) / 10;
			}
			return Reflect.get(target, property, receiver);
		},
	});
	const ranges = projectBinPeakRanges({
		peaks: {
			levels: [{
				blockSize: 10,
				channels: [
					{ minimums: channel(-1), maximums: channel(1) },
					{ minimums: channel(-0.5), maximums: channel(0.5) },
				],
			}],
		},
	}, {
		id: 'windowed',
		sourceStartFrame: 4_000,
		sourceDurationFrames: 80,
	}, 4);

	assert.equal(ranges.length, 4);
	assert.deepEqual(ranges[0], { minimum: -0.2, maximum: 0.2 });
	assert.ok(reads.length <= 32, `expected bounded peak reads, received ${reads.length}`);
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
