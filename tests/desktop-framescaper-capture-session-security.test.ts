/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	configureFramescaperCaptureSessionSecurityV1,
	type FramescaperCaptureSessionSecuritySession,
	type FramescaperWebVcrDisplaySecurityWitnessV1,
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

test('media permission checks observe and the matching request consumes authority once', () => {
	const harness = sessionHarness();
	harness.configure();
	const details = { requestingUrl: `${ORIGIN}/?project=capture-origin`, mediaTypes: ['audio'] };
	assert.equal(harness.permissionCheck(harness.webContents, 'media', ORIGIN, details), true);
	assert.equal(harness.permissionCheck(harness.webContents, 'media', ORIGIN, details), true);
	assert.deepEqual(harness.mediaConsumeCalls, []);

	const results: boolean[] = [];
	harness.permissionRequest(
		harness.webContents,
		'media',
		(value: boolean) => results.push(value),
		details,
	);
	harness.permissionRequest(
		harness.webContents,
		'media',
		(value: boolean) => results.push(value),
		details,
	);
	harness.permissionRequest(
		harness.webContents,
		'camera',
		(value: boolean) => results.push(value),
		{ requestingUrl: `${ORIGIN}/`, mediaTypes: ['video'] },
	);
	assert.deepEqual(results, [true, false, false]);
	assert.deepEqual(harness.mediaConsumeCalls, [['audio'], ['audio']]);
	assert.equal(harness.permissionCheck(harness.webContents, 'media', ORIGIN, details), false);
});

test('a direct media permission request consumes its exact role without a prior check', () => {
	const harness = sessionHarness();
	harness.configure();
	const results: boolean[] = [];
	harness.permissionRequest(
		harness.webContents,
		'media',
		(value: boolean) => results.push(value),
		{ requestingUrl: `${ORIGIN}/`, mediaTypes: ['video'] },
	);
	assert.deepEqual(results, [true]);
	assert.deepEqual(harness.mediaConsumeCalls, [['video']]);
	assert.equal(harness.permissionCheck(
		harness.webContents,
		'media',
		ORIGIN,
		{ requestingUrl: `${ORIGIN}/`, mediaTypes: ['video'] },
	), false);
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

test('a pending Web VCR guest grant is handled before device capture without fallback', () => {
	const guestFrame = { routingId: 91 };
	const harness = sessionHarness({ webVcr: true, guestFrame });
	harness.configure();
	const permissionDetails = { requestingUrl: `${ORIGIN}/` };
	assert.equal(harness.permissionCheck(
		harness.webContents, 'display-capture', ORIGIN, permissionDetails,
	), true);
	const permissionResults: boolean[] = [];
	harness.permissionRequest(
		harness.webContents, 'display-capture', (allowed) => permissionResults.push(allowed), permissionDetails,
	);
	assert.deepEqual(permissionResults, [true]);
	const invalid: unknown[] = [];
	harness.displayRequest({
		frame: harness.mainFrame,
		securityOrigin: ORIGIN,
		userGesture: false,
		videoRequested: true,
		audioRequested: true,
	}, (value: unknown) => invalid.push(value));
	assert.deepEqual(invalid, [{}]);
	assert.equal(harness.webVcrConsumeCalls, 0, 'outer gesture admission rejects before either authority');

	const granted: unknown[] = [];
	harness.displayRequest({
		frame: harness.mainFrame,
		securityOrigin: ORIGIN,
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
	}, (value: unknown) => granted.push(value));
	assert.deepEqual(granted, [{ video: guestFrame, audio: guestFrame, enableLocalEcho: false }]);
	assert.equal(harness.webVcrConsumeCalls, 1);
	assert.equal(harness.consumeCalls, 0, 'a handled guest grant never falls through to device capture');
});

test('Electron 43 display media video preflight and empty request admit only a pending Web VCR grant', () => {
	const guestFrame = { routingId: 91 };
	const harness = sessionHarness({ webVcr: true, guestFrame, witness: true });
	harness.configure();
	assert.equal(harness.permissionCheck(
		harness.webContents,
		'media',
		ORIGIN,
		{ requestingUrl: `${ORIGIN}/`, securityOrigin: ORIGIN, mediaType: 'video', isMainFrame: true },
	), true);
	const permissions: boolean[] = [];
	harness.permissionRequest(
		harness.webContents,
		'media',
		(allowed) => permissions.push(allowed),
		{ requestingUrl: `${ORIGIN}/`, securityOrigin: ORIGIN, mediaTypes: [], isMainFrame: true },
	);
	assert.deepEqual(permissions, [true]);
	assert.deepEqual(harness.mediaConsumeCalls, [], 'the display sentinel cannot consume device media');

	const results: unknown[] = [];
	harness.displayRequest({
		frame: harness.mainFrame, securityOrigin: ORIGIN, userGesture: true,
		videoRequested: true, audioRequested: true,
	}, (value: unknown) => results.push(value));
	assert.deepEqual(results, [{ video: guestFrame, audio: guestFrame, enableLocalEcho: false }]);
	assert.equal(harness.webVcrConsumeCalls, 1, 'only the display callback consumes the one-shot grant');
	assert.deepEqual(harness.witnesses.map(({ stage }) => stage), [
		'permission-check', 'permission-request', 'display-request',
	]);
});

test('display media sentinels fail closed for subframes, stale grants, focus loss, and system picker', () => {
	for (const mutate of [
		(harness: ReturnType<typeof sessionHarness>) => { harness.focused = false; },
		(harness: ReturnType<typeof sessionHarness>) => { harness.webVcrPending = false; },
	] as const) {
		const harness = sessionHarness({ webVcr: true });
		harness.configure();
		mutate(harness);
		assert.equal(harness.permissionCheck(
			harness.webContents, 'media', ORIGIN,
			{ requestingUrl: `${ORIGIN}/`, securityOrigin: ORIGIN, mediaType: 'video', isMainFrame: true },
		), false);
		const results: boolean[] = [];
		harness.permissionRequest(
			harness.webContents, 'media', (allowed) => results.push(allowed),
			{ requestingUrl: `${ORIGIN}/`, securityOrigin: ORIGIN, mediaTypes: [], isMainFrame: true },
		);
		assert.deepEqual(results, [false]);
		assert.deepEqual(harness.mediaConsumeCalls, []);
	}
	const subframe = sessionHarness({ webVcr: true });
	subframe.configure();
	assert.equal(subframe.permissionCheck(
		subframe.webContents, 'media', ORIGIN,
		{ requestingUrl: `${ORIGIN}/`, securityOrigin: ORIGIN, mediaType: 'video', isMainFrame: false },
	), false);
	const subframeResults: boolean[] = [];
	subframe.permissionRequest(
		subframe.webContents, 'media', (allowed) => subframeResults.push(allowed),
		{ requestingUrl: `${ORIGIN}/`, securityOrigin: ORIGIN, mediaTypes: [], isMainFrame: false },
	);
	assert.deepEqual(subframeResults, [false]);
	for (const [sender, origin, requestingUrl] of [
		[{}, ORIGIN, `${ORIGIN}/`],
		[subframe.webContents, 'https://example.com', 'https://example.com/'],
	] as const) {
		assert.equal(subframe.permissionCheck(
			sender, 'media', origin,
			{ requestingUrl, securityOrigin: origin, mediaType: 'video', isMainFrame: true },
		), false);
		const rejected: boolean[] = [];
		subframe.permissionRequest(
			sender, 'media', (allowed) => rejected.push(allowed),
			{ requestingUrl, securityOrigin: origin, mediaTypes: [], isMainFrame: true },
		);
		assert.deepEqual(rejected, [false]);
	}
	assert.equal(subframe.permissionCheck(
		subframe.webContents, 'media', ORIGIN,
		{ requestingUrl: `${ORIGIN}/`, securityOrigin: 'https://example.com', mediaType: 'video', isMainFrame: true },
	), false);
	const mismatchedSecurityOrigin: boolean[] = [];
	subframe.permissionRequest(
		subframe.webContents, 'media', (allowed) => mismatchedSecurityOrigin.push(allowed),
		{ requestingUrl: `${ORIGIN}/`, securityOrigin: 'https://example.com', mediaTypes: [], isMainFrame: true },
	);
	assert.deepEqual(mismatchedSecurityOrigin, [false]);
	const picker = sessionHarness({ webVcr: true, selectionMode: 'system-picker' });
	picker.configure();
	assert.equal(picker.permissionCheck(
		picker.webContents, 'media', ORIGIN,
		{ requestingUrl: `${ORIGIN}/`, securityOrigin: ORIGIN, mediaType: 'video', isMainFrame: true },
	), false);
});

test('a pending Web VCR video preflight cannot authorize a camera request', () => {
	const harness = sessionHarness({ webVcr: true });
	harness.mediaAllowed = false;
	harness.configure();
	assert.equal(harness.permissionCheck(
		harness.webContents, 'media', ORIGIN,
		{ requestingUrl: `${ORIGIN}/`, securityOrigin: ORIGIN, mediaType: 'video', isMainFrame: true },
	), true, 'Electron erases display provenance at the non-consuming video preflight');
	const permissions: boolean[] = [];
	harness.permissionRequest(
		harness.webContents, 'media', (allowed) => permissions.push(allowed),
		{ requestingUrl: `${ORIGIN}/`, mediaTypes: ['video'], isMainFrame: true },
	);
	assert.deepEqual(permissions, [false]);
	assert.deepEqual(harness.mediaConsumeCalls, [['video']]);
	assert.equal(harness.webVcrConsumeCalls, 0);
	assert.equal(harness.webVcrPending, true, 'camera refusal cannot consume the guest grant');
});

test('packaged diagnostics can observe closed permission and display decisions without changing them', () => {
	const guestFrame = { routingId: 91 };
	const harness = sessionHarness({ webVcr: true, guestFrame, witness: true });
	harness.configure();
	const details = { requestingUrl: `${ORIGIN}/` };
	assert.equal(harness.permissionCheck(
		harness.webContents, 'display-capture', ORIGIN, details,
	), true);
	const permissions: boolean[] = [];
	harness.permissionRequest(
		harness.webContents, 'display-capture', (allowed) => permissions.push(allowed), details,
	);
	const results: unknown[] = [];
	harness.displayRequest({
		frame: harness.mainFrame,
		securityOrigin: ORIGIN,
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
	}, (value: unknown) => results.push(value));

	assert.deepEqual(permissions, [true]);
	assert.deepEqual(results, [{ video: guestFrame, audio: guestFrame, enableLocalEcho: false }]);
	assert.deepEqual(harness.witnesses, [{
		version: 1,
		stage: 'permission-check',
		windowLive: true,
		focused: true,
		senderMatches: true,
		originMatches: true,
		editorDocument: true,
		ownerAvailable: true,
		pending: true,
		systemPicker: false,
		allowed: true,
	}, {
		version: 1,
		stage: 'permission-request',
		windowLive: true,
		focused: true,
		senderMatches: true,
		originMatches: true,
		editorDocument: true,
		ownerAvailable: true,
		pending: true,
		systemPicker: false,
		allowed: true,
	}, {
		version: 1,
		stage: 'display-request',
		windowLive: true,
		focused: true,
		frameMatches: true,
		originMatches: true,
		editorDocument: true,
		ownerAvailable: true,
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
		pending: true,
		systemPicker: false,
		outcome: 'granted-web-vcr',
	}]);
});

test('a packaged witness failure cannot alter fail-closed display admission', () => {
	const harness = sessionHarness({ webVcr: true, witness: true, witnessThrows: true });
	harness.configure();
	const results: unknown[] = [];
	assert.doesNotThrow(() => harness.displayRequest({
		frame: harness.mainFrame,
		securityOrigin: ORIGIN,
		userGesture: false,
		videoRequested: true,
		audioRequested: true,
	}, (value: unknown) => results.push(value)));
	assert.deepEqual(results, [{}]);
	assert.equal(harness.webVcrConsumeCalls, 0);
});

test('system-picker mode rejects an impossible Web VCR grant instead of bypassing the sole callback', () => {
	const harness = sessionHarness({ selectionMode: 'system-picker', webVcr: true });
	harness.configure();
	const details = { requestingUrl: `${ORIGIN}/` };
	assert.equal(harness.permissionCheck(harness.webContents, 'display-capture', ORIGIN, details), false);
	const permissions: boolean[] = [];
	harness.permissionRequest(
		harness.webContents, 'display-capture', (allowed) => permissions.push(allowed), details,
	);
	assert.deepEqual(permissions, [false]);
	const results: unknown[] = [];
	harness.displayRequest({
		frame: harness.mainFrame, securityOrigin: ORIGIN, userGesture: true,
		videoRequested: true, audioRequested: true,
	}, (value: unknown) => results.push(value));
	assert.deepEqual(results, [{}]);
	assert.equal(harness.webVcrConsumeCalls, 0);
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

function sessionHarness(options: {
	readonly selectionMode?: 'source-list' | 'system-picker';
	readonly webVcr?: boolean;
	readonly guestFrame?: object;
	readonly witness?: boolean;
	readonly witnessThrows?: boolean;
} = {}) {
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
		consumedMedia: new Set<string>(),
		mediaConsumeCalls: [] as string[][],
		displayAllowed: true,
		consumeCalls: 0,
		systemPickerConsumeCalls: 0,
		captureDisposeCalls: 0,
		webVcrConsumeCalls: 0,
		webVcrDisposeCalls: 0,
		webVcrPending: options.webVcr === true,
		witnesses: [] as FramescaperWebVcrDisplaySecurityWitnessV1[],
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
					allowsMedia: (_owner, mediaTypes) => harness.mediaAllowed
						&& mediaTypes.every((type) => !harness.consumedMedia.has(type)),
					consumeMediaGrant: (_owner, mediaTypes) => {
						harness.mediaConsumeCalls.push([...mediaTypes]);
						if (!harness.mediaAllowed || mediaTypes.length === 0
							|| mediaTypes.some((type) => harness.consumedMedia.has(type))) return false;
						for (const type of mediaTypes) harness.consumedMedia.add(type);
						return true;
					},
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
				...(options.webVcr ? {
					webVcrCapture: {
						hasPending: () => harness.webVcrPending,
						consumeCurrent: () => {
							harness.webVcrConsumeCalls += 1;
							harness.webVcrPending = false;
							const frame = options.guestFrame ?? {};
							return { video: frame, audio: frame, enableLocalEcho: false as const };
						},
						dispose: () => { harness.webVcrDisposeCalls += 1; },
					},
				} : {}),
				session: session(harness),
				windowFor: () => window,
				currentOwnerFor: (candidate) => {
					if (!harness.current || candidate !== webContents) throw new Error('stale owner');
					return OWNER;
				},
				isAppUrl: (value) => value.startsWith(`${ORIGIN}/`) || value === ORIGIN,
				isEditorDocumentUrl: (value) => value === `${ORIGIN}/`
					|| value === `${ORIGIN}/?project=capture-origin`,
				...(options.witness ? {
					onWebVcrDisplaySecurityWitness: (value: FramescaperWebVcrDisplaySecurityWitnessV1) => {
						if (options.witnessThrows) throw new Error('smoke witness failed');
						harness.witnesses.push(value);
					},
				} : {}),
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
