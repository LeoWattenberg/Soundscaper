/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateDesktopNightlyTestsProgress } from '../scripts/lib/desktop-nightly-tests-presentation.mjs';

const DOCUMENT = join(import.meta.dirname, 'nightly-tests-progress.html');
const DOCUMENT_URL = pathToFileURL(DOCUMENT).href;
const TITLE = 'Soundscaper Nightly Tests';

/** Open the attended runner surface before any test processes are launched. */
export async function createDesktopNightlyTestsProgressWindow({ BrowserWindow, initialProgress, onError = () => undefined }) {
	if (typeof BrowserWindow !== 'function') {
		throw new TypeError('The nightly tests progress window requires Electron BrowserWindow.');
	}
	const first = validateDesktopNightlyTestsProgress(initialProgress);
	const window = new BrowserWindow({
		width: 600,
		height: 320,
		show: false,
		closable: false,
		maximizable: false,
		fullscreenable: false,
		resizable: false,
		autoHideMenuBar: true,
		backgroundColor: '#11131a',
		title: TITLE,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			devTools: false,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', (event, candidate) => {
		if (candidate !== DOCUMENT_URL) event.preventDefault();
	});
	try {
		await window.loadFile(DOCUMENT);
	} catch (error) {
		window.destroy();
		throw error;
	}

	const render = (value, mode) => {
		const progress = validateDesktopNightlyTestsProgress(value);
		if (window.isDestroyed()) return;
		window.setTitle(`${TITLE} — ${progress.label}`);
		try {
			if (mode) window.setProgressBar(progress.completed / progress.total, { mode });
			else window.setProgressBar(progress.completed / progress.total);
		} catch (error) {
			onError(error);
		}
		const payload = JSON.stringify(progress).replaceAll('<', '\\u003c');
		void window.webContents.executeJavaScript(
			`globalThis.renderNightlyTestsProgress(${payload})`,
			false,
		).catch(onError);
	};
	render(first, null);
	window.show();

	return Object.freeze({
		window,
		update: (value) => { render(value, null); },
		finish: (value, status) => { render(value, progressMode(status)); },
	});
}

function progressMode(status) {
	if (status === 'passed') return 'normal';
	if (status === 'interrupted') return 'paused';
	if (status === 'failed' || status === 'error') return 'error';
	throw new TypeError('Nightly tests terminal status is invalid.');
}
