/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateDesktopNightlyTestsProgress } from '../scripts/lib/desktop-nightly-tests-presentation.mjs';

export const NIGHTLY_TESTS_PROGRESS_SCHEME = 'soundscaper-nightly-progress';
export const NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL = `${NIGHTLY_TESTS_PROGRESS_SCHEME}://runner/`;
const ASSETS = Object.freeze([
	['', 'nightly-tests-progress.html', 'text/html'],
	['nightly-tests-progress-renderer.js', 'nightly-tests-progress-renderer.js', 'text/javascript'],
	['nightly-tests-progress.css', 'nightly-tests-progress.css', 'text/css'],
]);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'";
const TITLE = 'Soundscaper Nightly Tests';

/** Open the attended runner surface before any test processes are launched. */
export async function createDesktopNightlyTestsProgressWindow({ BrowserWindow, protocol, initialProgress, onError = () => undefined }) {
	if (typeof BrowserWindow !== 'function') {
		throw new TypeError('The nightly tests progress window requires Electron BrowserWindow.');
	}
	if (typeof protocol?.handle !== 'function' || typeof protocol.unhandle !== 'function') {
		throw new TypeError('The nightly tests progress protocol is unavailable.');
	}
	const first = validateDesktopNightlyTestsProgress(initialProgress);
	// Read through Electron's ASAR-aware fs API. The hardened launcher disables
	// file protocol privileges, so Chromium cannot navigate into app.asar directly.
	const assets = new Map(await Promise.all(ASSETS.map(async ([path, filename, contentType]) => [
		`${NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL}${path}`,
		{ body: await readFile(join(import.meta.dirname, filename)), contentType },
	])));
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
		if (candidate !== NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL) event.preventDefault();
	});
	let registered = false;
	const dispose = () => {
		if (!registered) return;
		registered = false;
		protocol.unhandle(NIGHTLY_TESTS_PROGRESS_SCHEME);
	};
	window.once('closed', dispose);
	try {
		protocol.handle(NIGHTLY_TESTS_PROGRESS_SCHEME, (request) => {
			if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
			const asset = assets.get(request.url);
			if (!asset) return new Response(null, { status: 404 });
			return new Response(asset.body, { headers: {
				'Cache-Control': 'no-store',
				'Content-Security-Policy': CSP,
				'Content-Type': `${asset.contentType}; charset=utf-8`,
				'X-Content-Type-Options': 'nosniff',
			} });
		});
		registered = true;
		await window.loadURL(NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL);
	} catch (error) {
		dispose();
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
