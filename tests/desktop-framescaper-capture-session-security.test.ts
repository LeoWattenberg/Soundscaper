/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	configureFramescaperCaptureSessionSecurityV1,
	type FramescaperCaptureSessionSecuritySession,
} from '../desktop/framescaper-capture-session-security.ts';

const ORIGIN = 'framescaper-app://bundle';
type PermissionCheck = Exclude<Parameters<FramescaperCaptureSessionSecuritySession['setPermissionCheckHandler']>[0], null>;
type PermissionRequest = Exclude<Parameters<FramescaperCaptureSessionSecuritySession['setPermissionRequestHandler']>[0], null>;
type DisplayRequest = Exclude<Parameters<FramescaperCaptureSessionSecuritySession['setDisplayMediaRequestHandler']>[0], null>;
type DownloadListener = Parameters<FramescaperCaptureSessionSecuritySession['on']>[1];

test('session security requires the exact focused Framescaper main document and current grant', () => {
	const harness = sessionHarness();
	harness.configure();
	const details = { requestingUrl: `${ORIGIN}/`, mediaTypes: ['audio', 'video'] };

	assert.equal(harness.permissionCheck(harness.webContents, 'media', ORIGIN, details), true);
	assert.equal(harness.permissionCheck(harness.webContents, 'display-capture', ORIGIN, details), true);
	assert.equal(harness.permissionCheck(harness.webContents, 'fullscreen', ORIGIN, details), true);
	assert.equal(harness.permissionCheck(harness.webContents, 'notifications', ORIGIN, details), false);
	assert.equal(harness.permissionCheck({}, 'media', ORIGIN, details), false);
	assert.equal(harness.permissionCheck(harness.webContents, 'media', 'https://example.com', details), false);
	harness.focused = false;
	assert.equal(harness.permissionCheck(harness.webContents, 'media', ORIGIN, details), false);
	harness.focused = true;
	harness.current = false;
	assert.equal(harness.permissionCheck(harness.webContents, 'media', ORIGIN, details), false);
});

test('permission requests invoke their callback once and remain grant-scoped', () => {
	const harness = sessionHarness();
	harness.configure();
	const results: boolean[] = [];
	harness.permissionRequest(
		harness.webContents,
		'media',
		(value: boolean) => results.push(value),
		{ requestingUrl: `${ORIGIN}/?project=capture-origin`, mediaTypes: ['audio'] },
	);
	harness.mediaAllowed = false;
	harness.permissionRequest(
		harness.webContents,
		'media',
		(value: boolean) => results.push(value),
		{ requestingUrl: `${ORIGIN}/`, mediaTypes: ['audio'] },
	);
	harness.permissionRequest(
		harness.webContents,
		'camera',
		(value: boolean) => results.push(value),
		{ requestingUrl: `${ORIGIN}/`, mediaTypes: ['video'] },
	);
	assert.deepEqual(results, [true, false, false]);
});

test('display delivery is one-shot, gesture-bound, and never falls back to a source', () => {
	const harness = sessionHarness();
	harness.configure();
	const request = {
		frame: harness.mainFrame,
		securityOrigin: ORIGIN,
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
	};
	const rejected: unknown[] = [];
	harness.displayRequest({ ...request, userGesture: false }, (value: unknown) => rejected.push(value));
	assert.deepEqual(rejected[0], {});
	assert.equal(harness.consumeCalls, 0);

	const granted: unknown[] = [];
	harness.displayRequest(request, (value: unknown) => granted.push(value));
	assert.deepEqual(granted[0], { video: { id: 'screen:1:0', name: 'Screen 1' }, audio: 'loopback' });
	assert.equal(harness.consumeCalls, 1);
	harness.displayRequest(request, (value: unknown) => granted.push(value));
	assert.deepEqual(granted[1], {});
	assert.equal(harness.consumeCalls, 2, 'the port remains authoritative for replay refusal');

	harness.focused = false;
	harness.displayRequest(request, (value: unknown) => rejected.push(value));
	assert.deepEqual(rejected[1], {});
	assert.equal(harness.consumeCalls, 2);
});

test('macOS system picker mode is configured explicitly and fallback delivery stays denied', () => {
	const harness = sessionHarness({ selectionMode: 'system-picker' });
	harness.configure();
	assert.deepEqual(harness.displayOptions, { useSystemPicker: true });
	assert.equal(harness.permissionCheck(
		harness.webContents,
		'display-capture',
		ORIGIN,
		{ requestingUrl: `${ORIGIN}/` },
	), false, 'the system picker always reaches the one-shot permission request');
	const permissions: boolean[] = [];
	harness.permissionRequest(
		harness.webContents,
		'display-capture',
		(value: boolean) => permissions.push(value),
		{ requestingUrl: `${ORIGIN}/` },
	);
	harness.permissionRequest(
		harness.webContents,
		'display-capture',
		(value: boolean) => permissions.push(value),
		{ requestingUrl: `${ORIGIN}/` },
	);
	assert.deepEqual(permissions, [true, false]);
	const results: unknown[] = [];
	harness.displayRequest({
		frame: harness.mainFrame,
		securityOrigin: ORIGIN,
		userGesture: true,
		videoRequested: true,
		audioRequested: false,
	}, (value: unknown) => results.push(value));
	assert.deepEqual(results, [{}]);
});

test('teardown removes every handler, download listener, and capture authority once', () => {
	const harness = sessionHarness();
	const registration = harness.configure();
	assert.equal(harness.downloadListeners.size, 1);
	const download = { cancelCalls: 0, cancel() { this.cancelCalls += 1; } };
	for (const listener of harness.downloadListeners) listener({}, download);
	assert.equal(download.cancelCalls, 1);

	registration.dispose();
	registration.dispose();
	assert.equal(harness.captureDisposeCalls, 1);
	assert.equal(harness.permissionCheckValue, null);
	assert.equal(harness.permissionRequestValue, null);
	assert.equal(harness.displayRequestValue, null);
	assert.equal(harness.downloadListeners.size, 0);
});

function sessionHarness(options: { readonly selectionMode?: 'source-list' | 'system-picker' } = {}) {
	const mainFrame = { url: `${ORIGIN}/` };
	const webContents = { mainFrame, getURL: () => mainFrame.url };
	const window = {
		webContents,
		isDestroyed: () => false,
		isFocused: () => harness.focused,
	};
	const harness = {
		focused: true,
		current: true,
		mediaAllowed: true,
		displayAllowed: true,
		consumeCalls: 0,
		systemPickerConsumeCalls: 0,
		captureDisposeCalls: 0,
		permissionCheckValue: null as PermissionCheck | null,
		permissionRequestValue: null as PermissionRequest | null,
		displayRequestValue: null as DisplayRequest | null,
		displayOptions: null as null | Readonly<{ useSystemPicker: boolean }>,
		downloadListeners: new Set<DownloadListener>(),
		mainFrame,
		webContents,
		configure() {
			return configureFramescaperCaptureSessionSecurityV1({
				productId: 'framescaper',
				trustedOrigin: ORIGIN,
				capture: {
					status: () => ({ selectionMode: options.selectionMode ?? 'source-list' }),
					allowsMedia: () => harness.mediaAllowed,
					allowsDisplayPermission: () => harness.displayAllowed,
					consumeSystemPickerGrant: () => {
						harness.systemPickerConsumeCalls += 1;
						return harness.systemPickerConsumeCalls === 1;
					},
					consumeDisplayGrant: () => {
						harness.consumeCalls += 1;
						return harness.consumeCalls === 1 && options.selectionMode !== 'system-picker'
							? { video: { id: 'screen:1:0', name: 'Screen 1' }, audio: 'loopback' as const }
							: null;
					},
					dispose: () => { harness.captureDisposeCalls += 1; },
				},
				session: session(harness),
				windowFor: () => window,
				currentOwnerFor: (candidate) => {
					if (!harness.current || candidate !== webContents) throw new Error('stale owner');
					return OWNER;
				},
				isAppUrl: (value) => value.startsWith(`${ORIGIN}/`) || value === ORIGIN,
				isEditorDocumentUrl: (value) => value === `${ORIGIN}/`
					|| value === `${ORIGIN}/?project=capture-origin`,
			});
		},
		permissionCheck(...args: Parameters<PermissionCheck>) {
			if (!harness.permissionCheckValue) throw new Error('check handler missing');
			return harness.permissionCheckValue(...args);
		},
		permissionRequest(...args: Parameters<PermissionRequest>) {
			if (!harness.permissionRequestValue) throw new Error('request handler missing');
			return harness.permissionRequestValue(...args);
		},
		displayRequest(...args: Parameters<DisplayRequest>) {
			if (!harness.displayRequestValue) throw new Error('display handler missing');
			return harness.displayRequestValue(...args);
		},
	};
	return harness;
}

const OWNER = Object.freeze(Object.create(null)) as object;

function session(harness: ReturnType<typeof sessionHarness>): FramescaperCaptureSessionSecuritySession {
	return {
		setPermissionCheckHandler(value) { harness.permissionCheckValue = value; },
		setPermissionRequestHandler(value) { harness.permissionRequestValue = value; },
		setDisplayMediaRequestHandler(value, options) {
			harness.displayRequestValue = value;
			harness.displayOptions = options ?? null;
		},
		on(name, listener) {
			assert.equal(name, 'will-download');
			harness.downloadListeners.add(listener);
		},
		removeListener(name, listener) {
			assert.equal(name, 'will-download');
			harness.downloadListeners.delete(listener);
		},
	};
}
