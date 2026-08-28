/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Host affordances the renderer asks the main process for: opening an external
 * destination in the user's browser, and running a text edit command against
 * the window's contents.
 *
 * Both are allow-listed rather than passed through. The renderer names a
 * destination key and an edit command, never a URL or an arbitrary method, so
 * a compromised renderer cannot navigate the user anywhere it likes or reach
 * the rest of the contents API. The preload validates the same values; this is
 * the main process refusing to trust its own renderer, as it does for every
 * other channel.
 */

import { shell } from 'electron/main';

import { EXTERNAL_DESTINATIONS } from './constants.js';

const TEXT_EDIT_COMMANDS = Object.freeze(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);

export function registerHostAffordances({ channels, handle, windowFor }) {
	handle(channels.openExternal, async (_event, destination) => {
		const key = String(destination || '');
		if (!Object.hasOwn(EXTERNAL_DESTINATIONS, key)) throw new TypeError('Unsupported external destination');
		const url = EXTERNAL_DESTINATIONS[key];
		await shell.openExternal(url);
	});
	handle(channels.editText, (_event, value) => {
		const command = String(value || '');
		if (!TEXT_EDIT_COMMANDS.includes(command)) throw new TypeError('Unsupported text edit command');
		const window = windowFor();
		if (!window || window.isDestroyed?.() === true) throw new Error('The application window is unavailable.');
		window.webContents[command]();
		return true;
	});
}
