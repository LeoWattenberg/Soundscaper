/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { IPC, MENU_COMMANDS } from '../desktop/constants.js';
import {
	WINDOW_ACTIONS,
	desktopWindowOptions,
	hideNativeWindowButtons,
	installDesktopApplicationMenu,
	menuCommandForAccelerator,
	onWindowStateChanged,
	registerFocusedWindowAccelerators,
	runWindowAction,
	upgradePendingCloseRequestForQuit,
	windowActionForAccelerator,
} from '../desktop/window-chrome.mjs';

test('main wires the custom chrome channels and no longer owns an application command template', async () => {
	assert.equal(IPC.windowAction, 'soundscaper:v1:window:action');
	assert.equal(IPC.windowStateChanged, 'soundscaper:v1:event:window-state-changed');
	assert.equal('setFullscreen' in IPC, false);
	assert.equal('fullscreenChanged' in IPC, false);
	assert.ok(MENU_COMMANDS.includes('preferences'));
	assert.ok(MENU_COMMANDS.includes('view:toggle-fullscreen'));

	const source = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
	assert.match(source, /\.\.\.desktopWindowOptions\(\)/u);
	assert.match(source, /hideNativeWindowButtons\(mainWindow, process\.platform\)/u);
	assert.match(source, /installDesktopApplicationMenu\(\{/u);
	assert.match(source, /registerFocusedWindowAccelerators\(\{/u);
	assert.match(source, /handle\(IPC\.windowAction, \(_event, action\) => runCurrentWindowAction\(action\)\)/u);
	assert.match(source, /mainWindow\.on\('maximize', publishWindowState\)/u);
	assert.match(source, /mainWindow\.on\('unmaximize', publishWindowState\)/u);
	assert.match(source, /mainWindow\.on\('enter-full-screen', publishWindowState\)/u);
	assert.match(source, /mainWindow\.on\('leave-full-screen', publishWindowState\)/u);
	assert.match(source, /on\(IPC\.rendererReady,[\s\S]*publishWindowState\(\)/u);
	assert.doesNotMatch(source, /function installMenu|desktopNativeTierMenu|IPC\.setFullscreen|IPC\.fullscreenChanged/u);
});

test('desktop windows replace the system title bar and macOS traffic lights', () => {
	assert.deepEqual(desktopWindowOptions(), { titleBarStyle: 'hidden' });

	const calls = [];
	const window = { setWindowButtonVisibility: (visible) => calls.push(visible) };
	hideNativeWindowButtons(window, 'linux');
	hideNativeWindowButtons(window, 'darwin');
	assert.deepEqual(calls, [false]);
});

test('only macOS keeps a minimal system application menu', () => {
	const installations = [];
	let template = null;
	const Menu = {
		buildFromTemplate(value) {
			template = value;
			return { value };
		},
		setApplicationMenu: (menu) => installations.push(menu),
	};
	let preferences = 0;

	assert.equal(installDesktopApplicationMenu({
		Menu, appName: 'Soundscaper', platform: 'linux', onPreferences: () => { preferences += 1; },
	}), null);
	assert.deepEqual(installations, [null]);
	assert.equal(template, null);

	const menu = installDesktopApplicationMenu({
		Menu, appName: 'Soundscaper', platform: 'darwin', onPreferences: () => { preferences += 1; },
	});
	assert.equal(installations.at(-1), menu);
	assert.deepEqual(template.map(({ label, role }) => label ?? role), ['Soundscaper', 'windowMenu']);
	assert.deepEqual(
		template[0].submenu.map(({ label, role, type }) => label ?? role ?? type),
		['about', 'separator', 'Preferences', 'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit'],
	);
	template[0].submenu.find(({ label }) => label === 'Preferences').click();
	assert.equal(preferences, 1);
});

test('the accelerator map preserves the removed native File, Edit, Preferences and fullscreen shortcuts', () => {
	const keyDown = (key, modifiers = {}) => ({
		type: 'keyDown', key, alt: false, control: false, meta: false, shift: false, isAutoRepeat: false, ...modifiers,
	});
	assert.equal(menuCommandForAccelerator(keyDown('o', { control: true }), 'linux'), 'project:open');
	assert.equal(menuCommandForAccelerator(keyDown('S', { control: true }), 'linux'), 'project:save');
	assert.equal(menuCommandForAccelerator(keyDown('s', { control: true, shift: true }), 'linux'), 'project:save-as');
	assert.equal(menuCommandForAccelerator(keyDown('e', { control: true, shift: true }), 'linux'), 'audio:export');
	assert.equal(menuCommandForAccelerator(keyDown('z', { meta: true }), 'darwin'), 'edit:undo');
	assert.equal(menuCommandForAccelerator(keyDown('z', { meta: true, shift: true }), 'darwin'), 'edit:redo');
	assert.equal(menuCommandForAccelerator(keyDown('y', { control: true }), 'win32'), 'edit:redo');
	assert.equal(menuCommandForAccelerator(keyDown('x', { control: true }), 'linux'), 'edit:cut');
	assert.equal(menuCommandForAccelerator(keyDown('c', { meta: true }), 'darwin'), 'edit:copy');
	assert.equal(menuCommandForAccelerator(keyDown('v', { control: true }), 'linux'), 'edit:paste');
	assert.equal(menuCommandForAccelerator(keyDown('a', { control: true }), 'linux'), 'edit:select-all');
	assert.equal(menuCommandForAccelerator(keyDown(',', { control: true }), 'linux'), 'preferences');
	assert.equal(menuCommandForAccelerator(keyDown(',', { meta: true }), 'darwin'), 'preferences');
	assert.equal(menuCommandForAccelerator(keyDown('F11'), 'linux'), 'view:toggle-fullscreen');
	assert.equal(menuCommandForAccelerator(keyDown('F11'), 'darwin'), 'view:toggle-fullscreen');
	assert.equal(menuCommandForAccelerator(keyDown('f', { control: true, meta: true }), 'darwin'), 'view:toggle-fullscreen');
	assert.equal(menuCommandForAccelerator(keyDown('s', { control: true, alt: true }), 'linux'), null);
	assert.equal(menuCommandForAccelerator(keyDown('s', { control: true, isAutoRepeat: true }), 'linux'), null);
	assert.equal(menuCommandForAccelerator({ ...keyDown('s', { control: true }), type: 'keyUp' }, 'linux'), null);
});

test('development accelerator actions preserve reload and developer tools only in development', () => {
	const keyDown = (key, modifiers = {}) => ({
		type: 'keyDown', key, alt: false, control: false, meta: false, shift: false, isAutoRepeat: false, ...modifiers,
	});
	assert.equal(windowActionForAccelerator(keyDown('r', { control: true }), 'linux', true), 'reload');
	assert.equal(windowActionForAccelerator(keyDown('r', { meta: true }), 'darwin', true), 'reload');
	assert.equal(windowActionForAccelerator(keyDown('i', { control: true, shift: true }), 'win32', true), 'toggle-dev-tools');
	assert.equal(windowActionForAccelerator(keyDown('i', { meta: true, alt: true }), 'darwin', true), 'toggle-dev-tools');
	assert.equal(windowActionForAccelerator(keyDown('r', { control: true }), 'linux', false), null);
	assert.equal(windowActionForAccelerator(keyDown('i', { control: true }), 'linux', true), null);
	assert.equal(windowActionForAccelerator(keyDown('i', { meta: true, shift: true }), 'darwin', true), null);
});

test('accelerators dispatch only while their owning window is focused and can be detached', () => {
	let listener = null;
	const removed = [];
	let focused = false;
	const window = {
		isDestroyed: () => false,
		isFocused: () => focused,
		webContents: {
			on: (name, callback) => { assert.equal(name, 'before-input-event'); listener = callback; },
			removeListener: (name, callback) => removed.push([name, callback]),
		},
	};
	const commands = [];
	const actions = [];
	const detach = registerFocusedWindowAccelerators({
		window,
		platform: 'linux',
		development: true,
		dispatch: (command) => commands.push(command),
		runAction: (action) => actions.push(action),
	});
	let prevented = 0;
	const event = { preventDefault: () => { prevented += 1; } };
	const input = { type: 'keyDown', key: 's', control: true, meta: false, alt: false, shift: false };
	listener(event, input);
	focused = true;
	listener(event, input);
	assert.deepEqual(commands, ['project:save']);
	listener(event, { ...input, key: 'r' });
	listener(event, { ...input, key: 'i', shift: true });
	listener(event, { ...input, key: 'i' });
	assert.deepEqual(actions, ['reload', 'toggle-dev-tools']);
	assert.equal(prevented, 3);
	detach();
	assert.deepEqual(removed, [['before-input-event', listener]]);
});

test('window actions form a closed enum and act on the current live window', () => {
	assert.deepEqual(WINDOW_ACTIONS, [
		'minimize', 'toggle-maximize', 'toggle-fullscreen', 'quit', 'reload', 'toggle-dev-tools',
	]);
	const calls = [];
	let maximized = false;
	let fullscreen = false;
	let current = {
		isDestroyed: () => false,
		isMaximized: () => maximized,
		isFullScreen: () => fullscreen,
		minimize: () => calls.push('minimize'),
		maximize: () => { calls.push('maximize'); maximized = true; },
		unmaximize: () => { calls.push('unmaximize'); maximized = false; },
		setFullScreen: (value) => { calls.push(['fullscreen', value]); fullscreen = value; },
		reload: () => calls.push('reload'),
		webContents: { toggleDevTools: () => calls.push('toggle-dev-tools') },
	};
	const options = { windowFor: () => current, quit: () => calls.push('quit'), development: true };

	for (const action of WINDOW_ACTIONS) runWindowAction(action, options);
	runWindowAction('toggle-maximize', options);
	runWindowAction('toggle-fullscreen', options);
	assert.deepEqual(calls, [
		'minimize', 'maximize', ['fullscreen', true], 'quit', 'reload', 'toggle-dev-tools',
		'unmaximize', ['fullscreen', false],
	]);

	current = null;
	assert.throws(() => runWindowAction('minimize', options), /window is unavailable/iu);
	assert.throws(() => runWindowAction('not-an-action', options), /unsupported window action/iu);
});

test('reload and developer tools are refused in packaged builds', () => {
	const calls = [];
	const options = {
		windowFor: () => ({ reload: () => calls.push('reload'), webContents: { toggleDevTools: () => calls.push('devtools') } }),
		quit: () => calls.push('quit'),
		development: false,
	};
	assert.throws(() => runWindowAction('reload', options), /development build/iu);
	assert.throws(() => runWindowAction('toggle-dev-tools', options), /development build/iu);
	assert.deepEqual(calls, []);
});

test('whole-app Quit upgrades an already pending window-close confirmation', () => {
	const pending = { requestId: 'close-1', reason: 'window-close' };
	assert.equal(upgradePendingCloseRequestForQuit(pending, false), pending);
	const upgraded = upgradePendingCloseRequestForQuit(pending, true);
	assert.deepEqual(upgraded, { requestId: 'close-1', reason: 'quit' });
	assert.equal(Object.isFrozen(upgraded), true);
	assert.equal(upgradePendingCloseRequestForQuit(upgraded, true), upgraded);
});

test('window state notifications describe the current window and ignore a missing one', () => {
	const states = [];
	let current = null;
	const options = { windowFor: () => current, send: (state) => states.push(state) };
	assert.equal(onWindowStateChanged(options), false);
	current = { isDestroyed: () => false, isMaximized: () => true, isFullScreen: () => false };
	assert.equal(onWindowStateChanged(options), true);
	assert.deepEqual(states, [{ maximized: true, fullscreen: false }]);
	assert.equal(Object.isFrozen(states[0]), true);
});
