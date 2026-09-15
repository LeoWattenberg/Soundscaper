/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	NIGHTLY_ASSISTANCE_DOCUMENT_URL, NIGHTLY_ASSISTANCE_HOST_FLAG,
	NIGHTLY_ASSISTANCE_SCHEME, registerNightlyAssistanceScheme,
	resolveNightlyAssistanceHostPlan, startNightlyAssistanceHost,
} from '../desktop/nightly-tests-assistance-host.mjs';

const ARGV = [NIGHTLY_ASSISTANCE_HOST_FLAG, '--user-data-dir=/tmp/model-profile',
	'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=45000'];
const ENVIRONMENT = {
	SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS: '1', SOUNDSCAPER_LOCAL_ASSISTANCE_PRODUCT_ID: 'soundscaper',
	SOUNDSCAPER_PACKAGED_PRODUCT_ROOT: '/opt/products', SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE: '/tmp/model-cache',
};

test('the diagnostic host requires explicit model mode, an isolated profile, and loopback debugging', () => {
	const options = { argv: ARGV, environment: ENVIRONMENT, platform: 'linux', arch: 'x64' };
	const plan = resolveNightlyAssistanceHostPlan(options);
	assert.equal(plan.productApp, '/opt/products/soundscaper.asar');
	assert.equal(plan.runtimeRoot, '/opt/products/soundscaper/linux-unpacked/resources/runtime');
	assert.equal(plan.preload, '/opt/products/soundscaper.asar/desktop/preload.mjs');
	assert.equal(plan.profile, '/tmp/model-profile');
	assert.equal(plan.modelCache, '/tmp/model-cache');
	assert.throws(() => resolveNightlyAssistanceHostPlan({ ...options, environment: { ...ENVIRONMENT, SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS: '0' } }), /explicit/u);
	assert.throws(() => resolveNightlyAssistanceHostPlan({ ...options, argv: ARGV.map((arg) => arg.replace('address=127.0.0.1', 'address=0.0.0.0')) }), /127\.0\.0\.1/u);
	assert.throws(() => resolveNightlyAssistanceHostPlan({ ...options, argv: [...ARGV, '--remote-debugging-port=45001'] }), /exactly one/u);
	assert.throws(() => resolveNightlyAssistanceHostPlan({ ...options, argv: ARGV.map((arg) => arg.replace('=/tmp/model-profile', '=relative')) }), /absolute/u);
});

test('the diagnostic document scheme is registered before Electron becomes ready', () => {
	let registrations;
	registerNightlyAssistanceScheme({ registerSchemesAsPrivileged: (value) => { registrations = value; } });
	assert.deepEqual(registrations, [{
		scheme: NIGHTLY_ASSISTANCE_SCHEME,
		privileges: { standard: true, secure: true },
	}]);
});

test('the isolated host uses production registration and preload with guarded real IPC', async (context) => {
	let window;
	let registration;
	let windowOptions;
	let documentHandler;
	let loadedUrl;
	let removed = 0;
	let protocolRemoved = 0;
	const verifiedFiles = [];
	const handlers = new Map();
	const reportedErrors = [];
	context.mock.method(console, 'error', (...args) => { reportedErrors.push(args); });
	const mainFrame = { url: '' };
	class Window {
		constructor(options) {
			window = this; windowOptions = options;
			this.webContents = { mainFrame, setWindowOpenHandler: () => undefined,
				on: () => undefined, session: { setPermissionRequestHandler: () => undefined } };
		}
		on() {}
		async loadURL(url) { loadedUrl = url; mainFrame.url = url; }
	}
	const hosted = await startNightlyAssistanceHost({
		app: { setPath: () => undefined, whenReady: async () => undefined }, BrowserWindow: Window,
		ipcMain: { handle: (channel, listener) => handlers.set(channel, listener),
			on: () => undefined, removeHandler: () => { removed += 1; }, removeListener: () => undefined },
		session: { defaultSession: { protocol: {
			handle: (scheme, handler) => { assert.equal(scheme, NIGHTLY_ASSISTANCE_SCHEME); documentHandler = handler; },
			unhandle: (scheme) => { assert.equal(scheme, NIGHTLY_ASSISTANCE_SCHEME); protocolRemoved += 1; },
		} } },
	}, {
		argv: ARGV, environment: ENVIRONMENT, access: async (path) => { verifiedFiles.push(path); }, mkdir: async () => undefined,
		loadProductModules: async () => ({ IPC: {}, registerAssistance: (options) => {
			registration = options;
			options.handle('model-test', () => 'real handler');
			return { dispose: async () => undefined };
		} }),
	});
	assert.equal(windowOptions.webPreferences.preload, hosted.plan.preload);
	assert.equal(loadedUrl, NIGHTLY_ASSISTANCE_DOCUMENT_URL);
	const documentResponse = await documentHandler({ method: 'GET', url: NIGHTLY_ASSISTANCE_DOCUMENT_URL });
	assert.equal(documentResponse.status, 200);
	assert.equal(documentResponse.headers.get('content-type'), 'text/html; charset=utf-8');
	assert.match(await documentResponse.text(), /Local assistance real model tests/u);
	assert.equal((await documentHandler({ method: 'GET', url: `${NIGHTLY_ASSISTANCE_DOCUMENT_URL}missing` })).status, 404);
	assert.equal((await documentHandler({ method: 'POST', url: NIGHTLY_ASSISTANCE_DOCUMENT_URL })).status, 405);
	assert.deepEqual(verifiedFiles, [hosted.plan.preload], 'Electron can access archive entries, not the empty archive root');
	for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(windowOptions.webPreferences[key], true);
	assert.equal(windowOptions.webPreferences.nodeIntegration, false);
	assert.equal(registration.runtimeRoot, hosted.plan.runtimeRoot);
	assert.equal(registration.settings.snapshot().modelsDirectory, '/tmp/model-cache');
	const operationError = new Error('The runtime-family model failed authentication.');
	registration.onOperationError(operationError);
	assert.deepEqual(reportedErrors, [['Local assistance operation failed:', operationError]]);
	const invoke = handlers.get('model-test');
	assert.equal(invoke({ sender: window.webContents, senderFrame: mainFrame }), 'real handler');
	assert.throws(() => invoke({ sender: {}, senderFrame: mainFrame }), /sender/u);
	assert.throws(() => invoke({ sender: window.webContents, senderFrame: { url: mainFrame.url } }), /sender/u);
	mainFrame.url = 'https://example.org/';
	assert.throws(() => invoke({ sender: window.webContents, senderFrame: mainFrame }), /sender/u);
	assert.deepEqual(await registration.dialog.showMessageBox({ title: 'Local Assistance consent' }), { response: 0 });
	await assert.rejects(() => registration.dialog.showMessageBox({ title: 'Unrelated action' }), /Unexpected/u);
	await hosted.dispose();
	await hosted.dispose();
	assert.equal(removed, 1);
	assert.equal(protocolRemoved, 1);
});

test('production assistance keeps its real runtime root as the default and no test consent branch', async () => {
	const source = await readFile(new URL('../desktop/assistance-registration.mjs', import.meta.url), 'utf8');
	assert.match(source, /runtimeRoot = join\(process\.resourcesPath, 'runtime'\)/u);
	assert.match(source, /onError: onOperationError/u);
	assert.doesNotMatch(source, /SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS|nightly-assistance-host/u);
});

test('the diagnostic document admits only locally supplied data images', async () => {
	const source = await readFile(new URL('../desktop/nightly-tests-assistance.html', import.meta.url), 'utf8');
	assert.match(source, /default-src 'none'; img-src data:;/u);
	assert.doesNotMatch(source, /<script|https?:/u);
});
