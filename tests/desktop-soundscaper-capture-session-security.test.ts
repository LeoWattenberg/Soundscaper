/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	configureSoundscaperCaptureSessionSecurityV1,
} from '../desktop/soundscaper-capture-session-security.ts';

const ORIGIN = 'soundscaper-app://bundle';

interface PermissionDetails {
	readonly requestingUrl?: string;
	readonly securityOrigin?: string;
	readonly isMainFrame?: boolean;
	readonly mediaType?: 'audio' | 'video' | 'unknown';
	readonly mediaTypes?: readonly ('audio' | 'video')[];
}

type PermissionCheck = (
	webContents: unknown,
	permission: string,
	requestingOrigin: string,
	details?: PermissionDetails,
) => boolean;

type PermissionRequest = (
	webContents: unknown,
	permission: string,
	callback: (allowed: boolean) => void,
	details?: PermissionDetails,
) => void;

interface DisplayRequest {
	readonly frame?: unknown;
	readonly securityOrigin?: string;
	readonly userGesture?: boolean;
	readonly videoRequested?: boolean;
	readonly audioRequested?: boolean;
}

interface DesktopSource {
	readonly id: string;
	readonly name: string;
}

type DisplayResult = Readonly<{
	readonly video?: Readonly<{ readonly id?: unknown; readonly name?: unknown }>;
	readonly audio?: 'loopback';
}>;

type DisplayRequestHandler = (
	request: Readonly<DisplayRequest>,
	callback: (value: DisplayResult) => void,
) => void;

type DownloadListener = (
	event: unknown,
	item: Readonly<{ cancel(): void }>,
) => void;

interface CaptureSession {
	setPermissionCheckHandler(value: PermissionCheck | null): void;
	setPermissionRequestHandler(value: PermissionRequest | null): void;
	setDisplayMediaRequestHandler(
		value: DisplayRequestHandler | null,
		options?: Readonly<{ readonly useSystemPicker: boolean }>,
	): void;
	on(name: 'will-download', listener: DownloadListener): void;
	removeListener(name: 'will-download', listener: DownloadListener): void;
}

test('Electron 43 audio and speaker permissions keep the trusted main editor enumerated in the background', () => {
	const harness = captureHarness();
	harness.configure();
	const checkDetails = {
		requestingUrl: `${ORIGIN}/`,
		securityOrigin: ORIGIN,
		isMainFrame: true,
		mediaType: 'audio' as const,
	};
	const requestDetails = {
		requestingUrl: `${ORIGIN}/`,
		securityOrigin: ORIGIN,
		isMainFrame: true,
		mediaTypes: ['audio'] as const,
	};

	assert.equal(harness.permissionCheck(harness.webContents, 'media', ORIGIN, checkDetails), true);
	assert.equal(harness.permissionRequest(harness.webContents, 'media', requestDetails), true);
	assert.equal(harness.permissionCheck(
		harness.webContents,
		'speaker-selection',
		ORIGIN,
		checkDetails,
	), true);
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'speaker-selection',
		{ requestingUrl: `${ORIGIN}/`, isMainFrame: true },
	), true);
	assert.equal(harness.permissionCheck(harness.webContents, 'fullscreen', ORIGIN, checkDetails), true);
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'fullscreen',
		{ requestingUrl: `${ORIGIN}/`, isMainFrame: true },
	), true);

	assert.equal(harness.permissionCheck(
		harness.webContents,
		'media',
		ORIGIN,
		{ ...checkDetails, mediaType: 'video' },
	), false);
	assert.equal(harness.permissionCheck(
		harness.webContents,
		'media',
		ORIGIN,
		{ ...checkDetails, mediaType: 'unknown' },
	), false);
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'media',
		{ ...requestDetails, mediaTypes: ['video'] },
	), false);
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'media',
		{ requestingUrl: `${ORIGIN}/`, securityOrigin: ORIGIN, isMainFrame: true },
	), false);

	for (const permission of ['media', 'speaker-selection']) {
		assert.equal(harness.permissionCheck(
			harness.webContents,
			permission,
			'https://example.com',
			checkDetails,
		), false);
		assert.equal(harness.permissionCheck(
			harness.webContents,
			permission,
			ORIGIN,
			{ ...checkDetails, requestingUrl: 'https://example.com/' },
		), false);
		assert.equal(harness.permissionCheck(
			harness.webContents,
			permission,
			ORIGIN,
			{ ...checkDetails, isMainFrame: false },
		), false);
		assert.equal(harness.permissionRequest(
			harness.webContents,
			permission,
			{ ...requestDetails, requestingUrl: 'https://example.com/' },
		), false);
		assert.equal(harness.permissionRequest(
			harness.webContents,
			permission,
			{ ...requestDetails, isMainFrame: false },
		), false);
	}

	assert.equal(harness.permissionCheck(
		harness.webContents,
		'media',
		ORIGIN,
		{ ...checkDetails, securityOrigin: 'https://example.com' },
	), false);
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'media',
		{ ...requestDetails, securityOrigin: 'https://example.com' },
	), false);
	assert.equal(harness.permissionCheck({}, 'media', ORIGIN, checkDetails), false);
	assert.equal(harness.permissionRequest({}, 'media', requestDetails), false);
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'fullscreen',
		{ requestingUrl: 'https://example.com/', isMainFrame: true },
	), false);

	harness.focused = false;
	assert.equal(harness.permissionCheck(harness.webContents, 'media', ORIGIN, checkDetails), true);
	assert.equal(harness.permissionRequest(harness.webContents, 'media', requestDetails), true);
	assert.equal(harness.permissionCheck(
		harness.webContents,
		'speaker-selection',
		ORIGIN,
		checkDetails,
	), true);
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'speaker-selection',
		requestDetails,
	), true);
	assert.equal(harness.permissionCheck(
		harness.webContents,
		'fullscreen',
		ORIGIN,
		checkDetails,
	), false);
});

test('trusted Windows display capture selects the first screen with loopback audio', async () => {
	const harness = captureHarness();
	harness.configure();
	const permissionDetails = { requestingUrl: `${ORIGIN}/`, isMainFrame: true };
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'display-capture',
		permissionDetails,
	), true);

	const request = {
		frame: harness.mainFrame,
		securityOrigin: ORIGIN,
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
	};
	assert.deepEqual(await harness.displayRequest(request), {
		video: harness.sources[0],
		audio: 'loopback',
	});
	assert.deepEqual(harness.sourceRequests, [{
		types: ['screen'],
		thumbnailSize: { width: 0, height: 0 },
	}]);

	for (const rejected of [
		{ ...request, userGesture: false },
		{ ...request, videoRequested: false },
		{ ...request, securityOrigin: 'https://example.com' },
		{ ...request, securityOrigin: 'soundscaper-app://bundle.evil' },
		{ ...request, frame: { url: `${ORIGIN}/` } },
		{ ...request, audioRequested: false },
	]) {
		assert.deepEqual(await harness.displayRequest(rejected), {});
	}
	assert.equal(harness.sourceRequests.length, 1, 'rejected requests never enumerate screens');

	assert.equal(harness.permissionRequest(
		harness.webContents,
		'display-capture',
		{ ...permissionDetails, requestingUrl: 'https://example.com/' },
	), false);
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'display-capture',
		{ ...permissionDetails, isMainFrame: false },
	), false);
	harness.focused = false;
	assert.equal(harness.permissionRequest(
		harness.webContents,
		'display-capture',
		permissionDetails,
	), false);
	assert.deepEqual(await harness.displayRequest(request), {});
	assert.equal(harness.sourceRequests.length, 1);
});

test('display capture fails closed off Windows and across source enumeration failures', async () => {
	const requestFor = (harness: ReturnType<typeof captureHarness>) => ({
		frame: harness.mainFrame,
		securityOrigin: ORIGIN,
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
	});
	const linux = captureHarness({ platform: 'linux' });
	linux.configure();
	assert.equal(linux.permissionRequest(
		linux.webContents,
		'display-capture',
		{ requestingUrl: `${ORIGIN}/`, isMainFrame: true },
	), false);
	assert.deepEqual(await linux.displayRequest(requestFor(linux)), {});
	assert.deepEqual(linux.sourceRequests, []);

	for (const getSources of [
		() => { throw new Error('source enumeration failed'); },
		() => Promise.reject(new Error('source enumeration failed')),
		() => Promise.resolve([]),
		() => Promise.resolve([{ id: '', name: 'Missing identity' }]),
	]) {
		const harness = captureHarness({ getSources });
		harness.configure();
		assert.deepEqual(await harness.displayRequest(requestFor(harness)), {});
		assert.equal(harness.sourceRequests.length, 1);
	}
});

test('display capture rechecks trust after asynchronous source enumeration', async () => {
	let resolveSources!: (sources: readonly DesktopSource[]) => void;
	const pending = new Promise<readonly DesktopSource[]>((resolve) => { resolveSources = resolve; });
	const harness = captureHarness({ getSources: () => pending });
	const registration = harness.configure();
	const result = harness.displayRequest({
		frame: harness.mainFrame,
		securityOrigin: ORIGIN,
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
	});
	registration.dispose();
	resolveSources(harness.sources);
	assert.deepEqual(await result, {});
});

test('disposal clears every Soundscaper capture handler and listener once', () => {
	const harness = captureHarness();
	const registration = harness.configure();
	assert.equal(harness.downloadListeners.size, 1);
	assert.notEqual(harness.permissionCheckValue, null);
	assert.notEqual(harness.permissionRequestValue, null);
	assert.notEqual(harness.displayRequestValue, null);

	registration.dispose();
	registration.dispose();
	assert.equal(harness.permissionCheckValue, null);
	assert.equal(harness.permissionRequestValue, null);
	assert.equal(harness.displayRequestValue, null);
	assert.equal(harness.downloadListeners.size, 0);
});

interface CaptureHarnessOptions {
	readonly platform?: string;
	readonly getSources?: (
		options: unknown,
	) => PromiseLike<readonly DesktopSource[]>;
}

function captureHarness(options: CaptureHarnessOptions = {}) {
	const mainFrame = { url: `${ORIGIN}/` };
	const webContents = { mainFrame, getURL: () => mainFrame.url };
	const sources: DesktopSource[] = [
		{ id: 'screen:1:0', name: 'Screen 1' },
		{ id: 'screen:2:0', name: 'Screen 2' },
	];
	const harness = {
		focused: true,
		destroyed: false,
		permissionCheckValue: null as PermissionCheck | null,
		permissionRequestValue: null as PermissionRequest | null,
		displayRequestValue: null as DisplayRequestHandler | null,
		downloadListeners: new Set<DownloadListener>(),
		sourceRequests: [] as unknown[],
		mainFrame,
		webContents,
		sources,
		configure() {
			return configureSoundscaperCaptureSessionSecurityV1({
				productId: 'soundscaper',
				trustedOrigin: ORIGIN,
				platform: options.platform ?? 'win32',
				desktopCapturer: {
					getSources(requestOptions: unknown) {
						harness.sourceRequests.push(requestOptions);
						return options.getSources?.(requestOptions) ?? Promise.resolve(sources);
					},
				},
				session: session(harness),
				windowFor: () => ({
					webContents,
					isDestroyed: () => harness.destroyed,
					isFocused: () => harness.focused,
				}),
				isEditorDocumentUrl: (value: string) => value === `${ORIGIN}/`,
			});
		},
		permissionCheck(...args: Parameters<PermissionCheck>) {
			if (!harness.permissionCheckValue) throw new Error('permission check handler missing');
			return harness.permissionCheckValue(...args);
		},
		permissionRequest(webContentsValue: unknown, permission: string, details: PermissionDetails) {
			if (!harness.permissionRequestValue) throw new Error('permission request handler missing');
			let result: boolean | undefined;
			harness.permissionRequestValue(
				webContentsValue,
				permission,
				(allowed) => { result = allowed; },
				details,
			);
			if (result === undefined) throw new Error('permission request did not settle synchronously');
			return result;
		},
		displayRequest(request: DisplayRequest) {
			if (!harness.displayRequestValue) throw new Error('display request handler missing');
			return new Promise<DisplayResult>((resolve) => {
				harness.displayRequestValue?.(request, resolve);
			});
		},
	};
	return harness;
}

function session(harness: ReturnType<typeof captureHarness>): CaptureSession {
	return {
		setPermissionCheckHandler(value) { harness.permissionCheckValue = value; },
		setPermissionRequestHandler(value) { harness.permissionRequestValue = value; },
		setDisplayMediaRequestHandler(value) { harness.displayRequestValue = value; },
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
