/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Main-process ownership of the desktop window's custom chrome.
 *
 * The renderer may ask for one of the closed actions below, but it never gets
 * a BrowserWindow-shaped capability. Window-owned accelerators are admitted
 * here rather than installed globally; renderer commands remain preference-
 * driven and all focused shortcuts stop existing when their window does.
 */

export const WINDOW_ACTIONS = Object.freeze([
	'minimize',
	'toggle-maximize',
	'toggle-fullscreen',
	'quit',
	'reload',
	'toggle-dev-tools',
]);

export function desktopWindowOptions() {
	return Object.freeze({ titleBarStyle: 'hidden' });
}

/** macOS keeps traffic lights under a hidden title bar unless explicitly told otherwise. */
export function hideNativeWindowButtons(window, platform) {
	if (platform === 'darwin') window.setWindowButtonVisibility(false);
}

/**
 * Windows and Linux have no application menu: the renderer owns the command
 * bar. macOS retains only the global system roles that do not have a sensible
 * HTML equivalent.
 */
export function installDesktopApplicationMenu({ Menu, appName, platform, onPreferences }) {
	if (!Menu || typeof Menu.setApplicationMenu !== 'function' || typeof Menu.buildFromTemplate !== 'function') {
		throw new TypeError('Desktop menu installation requires Electron Menu.');
	}
	if (platform !== 'darwin') {
		Menu.setApplicationMenu(null);
		return null;
	}
	if (typeof appName !== 'string' || appName.length === 0 || typeof onPreferences !== 'function') {
		throw new TypeError('The macOS system menu requires an application name and Preferences action.');
	}
	const menu = Menu.buildFromTemplate([
		{
			label: appName,
			submenu: [
				{ role: 'about' },
				{ type: 'separator' },
				{ label: 'Preferences', click: onPreferences },
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' },
			],
		},
		{ role: 'windowMenu' },
	]);
	Menu.setApplicationMenu(menu);
	return menu;
}

/** Production editor commands, including fullscreen, follow saved renderer preferences. */
export function menuCommandForAccelerator() {
	return null;
}

/** Development chrome reserves unmodified reload and developer-tools keys. */
export function windowActionForAccelerator(input, platform, development) {
	if (development !== true || !input || input.type !== 'keyDown' || input.isAutoRepeat === true) return null;
	const key = String(input.key || '').toLowerCase();
	const control = input.control === true;
	const meta = input.meta === true;
	const alt = input.alt === true;
	const shift = input.shift === true;
	if (control || meta || alt || shift) return null;
	if (key === 'f5') return 'reload';
	return key === 'f12' ? 'toggle-dev-tools' : null;
}

/** Install window-scoped accelerators without creating an OS-global shortcut. */
export function registerFocusedWindowAccelerators({ window, platform, development, dispatch, runAction }) {
	if (!window?.webContents || typeof window.webContents.on !== 'function'
		|| typeof dispatch !== 'function' || typeof runAction !== 'function') {
		throw new TypeError('Focused accelerators require an application window and dispatcher.');
	}
	const listener = (event, input) => {
		if (window.isDestroyed?.() === true || window.isFocused?.() !== true) return;
		const action = windowActionForAccelerator(input, platform, development);
		const command = menuCommandForAccelerator(input, platform);
		if (!action && !command) return;
		event.preventDefault();
		if (action) runAction(action);
		else dispatch(command);
	};
	window.webContents.on('before-input-event', listener);
	let attached = true;
	return () => {
		if (!attached) return;
		attached = false;
		window.webContents.removeListener('before-input-event', listener);
	};
}

export function runWindowAction(action, { windowFor, quit, development }) {
	if (!WINDOW_ACTIONS.includes(action)) throw new TypeError('Unsupported window action.');
	if ((action === 'reload' || action === 'toggle-dev-tools') && development !== true) {
		throw new Error('That window action is available only in a development build.');
	}
	if (action === 'quit') {
		quit();
		return true;
	}
	const window = windowFor();
	if (!window || window.isDestroyed?.() === true) throw new Error('The application window is unavailable.');
	if (action === 'minimize') window.minimize();
	else if (action === 'toggle-maximize') {
		if (window.isMaximized()) window.unmaximize();
		else window.maximize();
	} else if (action === 'toggle-fullscreen') window.setFullScreen(!window.isFullScreen());
	else if (action === 'reload') window.reload();
	else window.webContents.toggleDevTools();
	return true;
}

/** A later application Quit takes precedence over an in-flight window-close confirmation. */
export function upgradePendingCloseRequestForQuit(request, applicationIsQuitting) {
	if (!request || applicationIsQuitting !== true || request.reason === 'quit') return request;
	return Object.freeze({ ...request, reason: 'quit' });
}

/** Publish the authoritative native state after either OS- or renderer-initiated changes. */
export function onWindowStateChanged({ windowFor, send }) {
	const window = windowFor();
	if (!window || window.isDestroyed?.() === true) return false;
	send(Object.freeze({
		maximized: window.isMaximized(),
		fullscreen: window.isFullScreen(),
	}));
	return true;
}
