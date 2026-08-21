/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopNightlyTestsWindow } from '../desktop/nightly-tests-window.mjs';

test('packaged diagnostic window is loopback-only, sandboxed, and bridge-free', async () => {
	const observations = { options: null, url: null, openHandler: null };
	class FakeWindow {
		webContents = {
			setWindowOpenHandler: (handler) => { observations.openHandler = handler; },
			on: () => undefined,
		};
		constructor(options) { observations.options = options; }
		on() {}
		async loadURL(url) { observations.url = url; }
	}

	const window = await createDesktopNightlyTestsWindow({
		argv: ['soundscaper', '--soundscaper-nightly-tests-base-url=http://127.0.0.1:4323'],
		BrowserWindow: FakeWindow,
	});
	assert.ok(window);
	assert.equal(observations.url, 'http://127.0.0.1:4323/');
	assert.deepEqual(observations.options.webPreferences, {
		nodeIntegration: false,
		contextIsolation: true,
		sandbox: true,
		webSecurity: true,
		allowRunningInsecureContent: false,
		webviewTag: false,
		devTools: false,
		backgroundThrottling: false,
	});
	assert.equal(Object.hasOwn(observations.options.webPreferences, 'preload'), false);
	assert.deepEqual(observations.openHandler(), { action: 'deny' });
});

test('packaged diagnostic window rejects non-loopback and ambiguous authority', async () => {
	for (const value of [
		'https://127.0.0.1:4323/',
		'http://localhost:4323/',
		'http://127.0.0.1/',
		'http://user@127.0.0.1:4323/',
		'http://127.0.0.1:4323/path',
	]) {
		await assert.rejects(() => createDesktopNightlyTestsWindow({
			argv: ['soundscaper', `--soundscaper-nightly-tests-base-url=${value}`],
			BrowserWindow: class {},
		}), /loopback/iu);
	}
	assert.equal(await createDesktopNightlyTestsWindow({ argv: ['soundscaper'], BrowserWindow: class {} }), null);
});

test('packaged diagnostic window permits the harness to replace its initial navigation', async () => {
	class FakeWindow {
		webContents = {
			setWindowOpenHandler: () => undefined,
			on: () => undefined,
		};
		async loadURL() {
			throw Object.assign(new Error('navigation replaced'), { code: 'ERR_ABORTED' });
		}
	}

	assert.ok(await createDesktopNightlyTestsWindow({
		argv: ['soundscaper', '--soundscaper-nightly-tests-base-url=http://127.0.0.1:4323'],
		BrowserWindow: FakeWindow,
	}));
});
