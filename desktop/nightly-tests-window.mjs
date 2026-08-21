/* SPDX-License-Identifier: AGPL-3.0-only */

const ARGUMENT = '--soundscaper-nightly-tests-base-url=';

export async function createDesktopNightlyTestsWindow({ argv, BrowserWindow }) {
	const values = argv.filter((value) => value.startsWith(ARGUMENT)).map((value) => value.slice(ARGUMENT.length));
	if (values.length === 0) return null;
	if (values.length !== 1) throw new Error('Packaged nightly tests require exactly one loopback URL.');
	const baseURL = parseLoopbackURL(values[0]);
	const window = new BrowserWindow({
		width: 1280,
		height: 720,
		show: false,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			devTools: false,
			backgroundThrottling: false,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', (event, candidate) => {
		try {
			if (new URL(candidate).origin !== baseURL.origin) event.preventDefault();
		} catch { event.preventDefault(); }
	});
	try {
		await window.loadURL(baseURL.href);
	} catch (error) {
		if (error?.code !== 'ERR_ABORTED') throw error;
	}
	return window;
}

function parseLoopbackURL(value) {
	let url;
	try { url = new URL(value); } catch { throw new TypeError('Packaged nightly tests require a valid loopback URL.'); }
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
		|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new TypeError('Packaged nightly tests require an HTTP 127.0.0.1 loopback root URL.');
	}
	return url;
}
