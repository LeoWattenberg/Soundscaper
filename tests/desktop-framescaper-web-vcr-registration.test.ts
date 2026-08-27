/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { FRAMESCAPER_WEB_VCR_CHANNELS } from '../desktop/framescaper-web-vcr-main-channels.ts';
import { registerFramescaperWebVcrDesktopV1 } from '../desktop/framescaper-web-vcr-registration.ts';

const CERTIFICATE_DATA = readFileSync(new URL('fixtures/web-vcr/fixture-cert.pem', import.meta.url), 'utf8');
const CERTIFICATE_FINGERPRINT = new X509Certificate(CERTIFICATE_DATA).fingerprint256;

test('disabled raw trusted bridge cannot materialize a guest partition, window, or grant', async () => {
	const harness = registration({ enabled: false });
	assert.deepEqual(invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.handshake), {
		version: 1,
		capability: { status: 'unavailable', reason: 'roadmap-gate', detail: null },
		captureGrantTtlMs: 10_000,
	});
	await assert.rejects(async () => invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.open, {
		resolution: '1080p',
	}), /unavailable|gate/iu);
	assert.throws(() => invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.prepareCapture, {
		version: 1, sessionId: 'a'.repeat(32), generation: 1,
	}), /owner|session|stale/iu);
	assert.equal(harness.partitionRequests.length, 0);
	assert.equal(harness.windows.length, 0);
	assert.equal(harness.value.captureAuthority.hasPending(harness.owner), false);
	assert.deepEqual(harness.preloads, [{
		type: 'frame', filePath: `${harness.desktopRoot}/framescaper-web-vcr-sandbox-preload.cjs`,
	}]);
	harness.value.dispose();
});

test('enabled production Web VCR lazily installs generic guest security without certificate trust', async () => {
	const harness = registration({ enabled: true });
	assert.equal(harness.partitionRequests.length, 0, 'registration and handshake stay partition-lazy');
	assert.equal((invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.handshake) as {
		capability: { status: string };
	}).capability.status, 'available');
	assert.equal(harness.partitionRequests.length, 0);
	const opened = await invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.open, { resolution: '1080p' }) as {
		phase: string;
	};
	assert.equal(opened.phase, 'ready');
	assert.deepEqual(harness.partitionRequests, ['persist:framescaper-web-vcr-v1']);
	assert.equal(harness.security.permissionCheck?.({}, 'camera', '', {}), false);
	let requested: boolean | null = null;
	harness.security.permissionRequest?.({}, 'media', (allowed: boolean) => { requested = allowed; }, {});
	assert.equal(requested, false);
	assert.equal(harness.security.devicePermission?.({ deviceType: 'usb' }), false);
	assert.equal(harness.security.certificate, null, 'production HTTPS keeps Chromium certificate trust');
	harness.value.dispose();
	assert.equal(harness.security.permissionCheck, null);
});

test('optional smoke trust lazily installs its exact certificate trust beside generic security', async () => {
	const fingerprint = CERTIFICATE_FINGERPRINT;
	const harness = registration({
		enabled: true,
		smokeTrust: {
			kind: 'packaged-smoke-v1',
			certificate: { enabled: true, origin: 'https://127.0.0.1:4443', fingerprint },
		},
	});
	assert.equal(harness.partitionRequests.length, 0, 'registration and handshake stay partition-lazy');
	harness.setFocused(false);
	assert.equal((invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.handshake) as {
		capability: { status: string };
	}).capability.status, 'available');
	assert.equal(harness.partitionRequests.length, 0);
	await assert.rejects(async () => invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.open, {
		resolution: '1080p',
	}), /focused|trusted/iu);
	assert.equal(harness.partitionRequests.length, 0);
	harness.setFocused(true);
	const opened = await invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.open, { resolution: '1080p' }) as {
		sessionId: string; generation: number; phase: string;
	};
	assert.equal(opened.phase, 'ready');
	assert.deepEqual(harness.partitionRequests, ['persist:framescaper-web-vcr-v1']);
	assert.equal(harness.windows.length, 1);
	assert.equal(harness.security.permissionCheck?.({}, 'camera', '', {}), false);
	let requested: boolean | null = null;
	harness.security.permissionRequest?.({}, 'media', (allowed: boolean) => { requested = allowed; }, {});
	assert.equal(requested, false);
	assert.equal(harness.security.devicePermission?.({ deviceType: 'usb' }), false);
	let verifyResult: number | null = null;
	harness.security.certificate?.({
		hostname: '127.0.0.1', certificate: { data: CERTIFICATE_DATA, fingerprint: 'not-authoritative' },
	}, (result: number) => { verifyResult = result; });
	assert.equal(verifyResult, 0);
	harness.security.certificate?.({
		hostname: '127.0.0.1', certificate: { data: 'not a certificate' },
	}, (result: number) => { verifyResult = result; });
	assert.equal(verifyResult, -3);

	const grant = invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.prepareCapture, {
		version: 1, sessionId: opened.sessionId, generation: opened.generation,
	}) as { grantId: string };
	assert.match(grant.grantId, /^[a-f0-9]{32}$/u);
	assert.equal(harness.value.captureAuthority.hasPending(harness.owner), true);
	harness.value.dispose();
	assert.equal(harness.security.permissionCheck, null);
	assert.equal(harness.security.certificate, null);
});

test('smoke trust cannot enable a disabled Web VCR', async () => {
	const harness = registration({
		enabled: false,
		smokeTrust: {
			kind: 'packaged-smoke-v1',
			certificate: {
				enabled: true,
				origin: 'https://127.0.0.1:4443',
				fingerprint: CERTIFICATE_FINGERPRINT,
			},
		},
	});
	assert.deepEqual((invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.handshake) as {
		capability: unknown;
	}).capability, { status: 'unavailable', reason: 'roadmap-gate', detail: null });
	await assert.rejects(async () => invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.open, {
		resolution: '1080p',
	}), /unavailable|gate/iu);
	assert.equal(harness.partitionRequests.length, 0);
	assert.equal(harness.security.certificate, null);
	harness.value.dispose();
});

test('system-picker delivery keeps an enabled Web VCR unavailable and partition-free', async () => {
	const fingerprint = CERTIFICATE_FINGERPRINT;
	const harness = registration({
		enabled: true,
		smokeTrust: {
			kind: 'packaged-smoke-v1',
			certificate: { enabled: true, origin: 'https://127.0.0.1:4443', fingerprint },
		},
	}, 'system-picker');
	const handshake = invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.handshake) as {
		capability: { status: string; reason?: string };
	};
	assert.deepEqual(handshake.capability, { status: 'unavailable', reason: 'unsupported-platform', detail: null });
	await assert.rejects(async () => invoke(harness, FRAMESCAPER_WEB_VCR_CHANNELS.open, {
		resolution: '1080p',
	}), /unavailable|gate/iu);
	assert.equal(harness.partitionRequests.length, 0);
	assert.equal(harness.windows.length, 0);
	harness.value.dispose();
});

function registration(
	options: Readonly<{
		readonly enabled: boolean;
		readonly smokeTrust?: Parameters<typeof registerFramescaperWebVcrDesktopV1>[0]['smokeTrust'];
	}>,
	displaySelectionMode: 'owned-callback' | 'system-picker' = 'owned-callback',
) {
	const handlers = new Map<string, (event: never, value?: unknown) => unknown>();
	const partitionRequests: string[] = [];
	const windows: ReturnType<typeof fakeWindow>[] = [];
	const preloads: unknown[] = [];
	const owner = Object.freeze(Object.create(null)) as object;
	const desktopRoot = '/opt/Framescaper/resources/app/desktop';
	const mainFrame = Object.freeze({ url: 'soundscaper://app/' });
	let focused = true;
	const sent: unknown[] = [];
	const webContents = Object.freeze({
		mainFrame,
		getURL: () => 'soundscaper://app/',
		send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
	});
	const mainWindow = {
		webContents,
		isDestroyed: () => false,
		isFocused: () => focused,
	};
	const security = fakeGuestSession();
	let nextId = 1;
	const value = registerFramescaperWebVcrDesktopV1({
		productId: 'framescaper',
		desktopRoot,
		trustedAppSession: {
			registerPreloadScript: (options) => { preloads.push(options); return 'web-vcr-preload'; },
			unregisterPreloadScript: () => undefined,
		},
		enabled: options.enabled,
		smokeTrust: options.smokeTrust ?? null,
		displaySelectionMode,
		sessionFromPartition: (partition) => { partitionRequests.push(partition); return security; },
		createWindow: () => { const window = fakeWindow(); windows.push(window); return window; },
		handle: (channel, listener) => handlers.set(channel, listener as never),
		removeHandler: (channel) => { handlers.delete(channel); },
		ownerFor: () => owner,
		currentOwnerFor: () => owner,
		windowFor: () => mainWindow,
		isEditorDocumentUrl: (url) => url === 'soundscaper://app/',
		now: () => 1_000,
		createOpaqueId: () => (nextId++).toString(16).padStart(32, '0'),
	});
	return {
		value, handlers, owner, partitionRequests, windows, preloads, desktopRoot, security,
		setFocused: (value: boolean) => { focused = value; },
		event: { sender: webContents, senderFrame: mainFrame },
	};
}

function invoke(
	harness: ReturnType<typeof registration>,
	channel: string,
	value?: unknown,
): unknown {
	const listener = harness.handlers.get(channel);
	if (!listener) throw new Error(`missing handler: ${channel}`);
	return listener(harness.event as never, value);
}

function fakeGuestSession() {
	type PermissionCheck = (webContents: unknown, permission: string, origin: string, details: unknown) => boolean;
	type PermissionRequest = (
		webContents: unknown,
		permission: string,
		callback: (allowed: boolean) => void,
		details: unknown,
	) => void;
	type DevicePermission = (details: unknown) => boolean;
	type Certificate = (
		request: Readonly<{
			hostname?: string;
			certificate?: Readonly<{ data?: string; fingerprint?: string }>;
		}>,
		callback: (result: number) => void,
	) => void;
	type Download = (event: Readonly<{ preventDefault(): void }>, item: Readonly<{ cancel(): void }>) => void;
	interface FakeGuestSession {
		permissionCheck: PermissionCheck | null;
		permissionRequest: PermissionRequest | null;
		devicePermission: DevicePermission | null;
		certificate: Certificate | null;
		download: Download | null;
		setPermissionCheckHandler(handler: PermissionCheck | null): void;
		setPermissionRequestHandler(handler: PermissionRequest | null): void;
		setDevicePermissionHandler(handler: DevicePermission | null): void;
		setCertificateVerifyProc(handler: Certificate | null): void;
		on(name: 'will-download', handler: Download): void;
		removeListener(name: 'will-download', handler: Download): void;
		clearCache(): Promise<void>;
		clearAuthCache(): Promise<void>;
		clearStorageData(): Promise<void>;
	}
	const value: FakeGuestSession = {
		permissionCheck: null,
		permissionRequest: null,
		devicePermission: null,
		certificate: null,
		download: null,
		setPermissionCheckHandler: (handler: typeof value.permissionCheck) => { value.permissionCheck = handler; },
		setPermissionRequestHandler: (handler: typeof value.permissionRequest) => { value.permissionRequest = handler; },
		setDevicePermissionHandler: (handler: typeof value.devicePermission) => { value.devicePermission = handler; },
		setCertificateVerifyProc: (handler: typeof value.certificate) => { value.certificate = handler; },
		on: (_name: 'will-download', handler: typeof value.download) => { value.download = handler; },
		removeListener: (_name: 'will-download', handler: typeof value.download) => {
			if (value.download === handler) value.download = null;
		},
		clearCache: async () => undefined,
		clearAuthCache: async () => undefined,
		clearStorageData: async () => undefined,
	};
	return value;
}

function fakeWindow() {
	let destroyed = false;
	let attached = false;
	const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
	return {
		webContents: {
			mainFrame: {},
			debugger: {
				isAttached: () => attached,
				attach: () => { attached = true; },
				detach: () => { attached = false; },
				sendCommand: async (method: string) => method === 'Page.getFrameTree'
					? { frameTree: { frame: { id: 'main-frame' } } } : {},
				on: () => undefined,
				removeListener: () => undefined,
			},
			navigationHistory: {
				canGoBack: () => false, canGoForward: () => false,
				goBack: () => undefined, goForward: () => undefined,
			},
			getURL: () => 'about:blank',
			reload: () => undefined,
			setAudioMuted: () => undefined,
			sendInputEvent: () => undefined,
			setWindowOpenHandler: () => undefined,
			on: (name: string, listener: (...args: unknown[]) => void) => add(listeners, name, listener),
			removeListener: (name: string, listener: (...args: unknown[]) => void) => listeners.get(name)?.delete(listener),
		},
		loadURL: async () => undefined,
		isDestroyed: () => destroyed,
		destroy: () => { destroyed = true; },
		on: (name: string, listener: (...args: unknown[]) => void) => add(listeners, name, listener),
		removeListener: (name: string, listener: (...args: unknown[]) => void) => listeners.get(name)?.delete(listener),
	};
}

function add(
	values: Map<string, Set<(...args: unknown[]) => void>>,
	name: string,
	listener: (...args: unknown[]) => void,
) {
	let listeners = values.get(name);
	if (!listeners) { listeners = new Set(); values.set(name, listeners); }
	listeners.add(listener);
}
