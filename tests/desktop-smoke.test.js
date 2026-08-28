import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
	DESKTOP_SMOKE_EXPECTED_BRIDGE,
	FRAMESCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE,
	assertDesktopSmokePayload,
	packagedExecutableCandidates,
	resolveSmokeArchitecture,
} from '../scripts/lib/desktop-smoke.mjs';
import { FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY } from '../desktop/framescaper-baseline-artifact-smoke.js';

const EXPECTED_BRIDGE = DESKTOP_SMOKE_EXPECTED_BRIDGE;
const FRAMESCAPER_EXPECTED_BRIDGE = FRAMESCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop smoke pins the complete sorted preload v1 bridge contract', () => {
	assert.equal(Object.isFrozen(DESKTOP_SMOKE_EXPECTED_BRIDGE), true);
	assert.deepEqual(DESKTOP_SMOKE_EXPECTED_BRIDGE, [
		'abortWrite',
		'applyNativeTierControl',
		'awaitVideoSourceProbe',
		'beginDesktopVideoCodecOperation',
		'beginVideoSourceProbe',
		'beginWrite',
		'bindNativeAudioSession',
		'calibrateNativeAudioSession',
		'cancelAssistanceModelInstall',
		'cancelDesktopAudioCodecOperation',
		'cancelDesktopVideoCodecOperation',
		'cancelVideoSourceProbe',
		'checkForUpdates',
		'chooseExternalFfmpeg',
		'chooseFiles',
		'chooseLinkedAudioOriginal',
		'chooseLinkedVideoOriginal',
		'chooseSaveTarget',
		'clearExternalFfmpeg',
		'clearNativePluginQuarantine',
		'closeDesktopVideoCodecInput',
		'closeNativeAudioSession',
		'closeNativePluginInstance',
		'closeNativePluginVendorUi',
		'collectAssistanceModelGarbage',
		'deleteDesktopVideoCodecOperation',
		'describeNativeAudioBackend',
		'editText',
		'executeDesktopVideoCodecOperation',
		'finishWrite',
		'getDesktopAudioCodecCapabilities',
		'getDesktopVideoExportCapabilities',
		'getEnvironment',
		'getExternalFfmpegStatus',
		'installAssistanceModel',
		'installExternalFfmpeg',
		'installPreseededAssistanceModel',
		'instantiateNativePlugin',
		'listAssistanceModelNotices',
		'listAssistanceModels',
		'listNativePlugins',
		'loadLinkedAudioOriginal',
		'loadLinkedVideoOriginal',
		'localAssistance',
		'nativeAudioHelperAvailability',
		'nativeAudioSessionStatus',
		'nativePluginAvailability',
		'nativeServices',
		'onAssistanceInstallProgress',
		'onCloseRequested',
		'onMenuCommand',
		'onOpenProject',
		'onWindowStateChanged',
		'openExternal',
		'openNativeAudioSession',
		'openNativePluginVendorUi',
		'patchFinalPrefix',
		'persistNativePluginState',
		'probeHelperAvailability',
		'readDesktopVideoCodecOutput',
		'readNativeTierControls',
		'reconcileAssistanceModels',
		'reconcileLinkedOriginals',
		'reconcileLinkedVideoOriginals',
		'releaseLinkedOriginal',
		'releaseLinkedVideoOriginal',
		'releaseRead',
		'relocateAssistanceModels',
		'removeAssistanceModel',
		'reportNativeAudioSessionLoss',
		'reportNativeAudioSessionTransfer',
		'rescanExternalFfmpeg',
		'respondToClose',
		'restoreNativePluginState',
		'reviewNativePluginInstallation',
		'runDesktopAudioCodecOperation',
		'runNativePluginOffline',
		'runWindowAction',
		'scanNativePlugins',
		'setLocale',
		'setNativeAudioHelperEnabled',
		'setNativePluginBypassed',
		'setNativePluginConsent',
		'signalReady',
		'statDesktopVideoCodecOutput',
		'writeChunk',
		'writeDesktopVideoCodecInput',
	]);
});

test('desktop smoke bridge inventory equals the sandbox preload surface', async () => {
	let bridge;
	let framescaperBridge;
	const source = await readFile(resolve(ROOT, 'desktop', 'preload.mjs'), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer, Object, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) {
					if (name === 'scapeDesktop') bridge = value.v1;
					if (name === 'framescaperDesktop') framescaperBridge = value.v1;
				},
			},
			ipcRenderer: { invoke: () => Promise.resolve(), send: () => {}, on: () => {}, removeListener: () => {} },
		}),
	});
	assert.deepEqual(Object.keys(bridge).sort(), DESKTOP_SMOKE_EXPECTED_BRIDGE);
	assert.equal(Object.isFrozen(FRAMESCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE), true);
	assert.deepEqual(Object.keys(framescaperBridge).sort(), FRAMESCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE);
	assert.deepEqual(FRAMESCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE, [
		...DESKTOP_SMOKE_EXPECTED_BRIDGE,
		'projectLibrary',
	].sort());
});

test('desktop smoke resolves an explicit package architecture independently of the Node host', () => {
	assert.equal(resolveSmokeArchitecture('arm64', 'x64'), 'arm64');
	assert.equal(resolveSmokeArchitecture(undefined, 'arm64'), 'arm64');
	assert.throws(() => resolveSmokeArchitecture('', 'x64'), /Unsupported desktop smoke architecture/u);
	assert.throws(() => resolveSmokeArchitecture('ia32', 'x64'), /Unsupported desktop smoke architecture: ia32/u);

	const candidates = packagedExecutableCandidates({
		arch: 'arm64',
		outputRoot: '/release/desktop',
		platform: 'win32',
		productId: 'soundscaper',
		productName: 'Soundscaper',
	});
	assert.deepEqual(candidates, [
		resolve('/release/desktop', 'win-arm64-unpacked', 'Soundscaper.exe'),
		resolve('/release/desktop', 'win-unpacked', 'Soundscaper.exe'),
	]);
});

test('desktop smoke selects the platform-specific unpacked executable convention', () => {
	const base = {
		arch: 'arm64',
		outputRoot: '/release/desktop',
		productId: 'framescaper',
		productName: 'Framescaper',
	};
	assert.deepEqual(packagedExecutableCandidates({ ...base, platform: 'darwin' }), [
		resolve('/release/desktop', 'mac-arm64', 'Framescaper.app', 'Contents', 'MacOS', 'Framescaper'),
		resolve('/release/desktop', 'mac', 'Framescaper.app', 'Contents', 'MacOS', 'Framescaper'),
	]);
	assert.deepEqual(packagedExecutableCandidates({ ...base, platform: 'linux' }), [
		resolve('/release/desktop', 'linux-arm64-unpacked', 'framescaper'),
		resolve('/release/desktop', 'linux-unpacked', 'framescaper'),
	]);
	assert.throws(
		() => packagedExecutableCandidates({ ...base, platform: 'freebsd' }),
		/Unsupported desktop smoke platform: freebsd/u,
	);
});

test('desktop smoke validates the application-reported platform and target architecture', () => {
	const expected = {
		arch: 'arm64',
		bridge: EXPECTED_BRIDGE,
		platform: 'win32',
		productId: 'soundscaper',
		title: 'Soundscaper',
		url: 'soundscaper-app://bundle/',
	};
	const payload = {
		bridge: [...EXPECTED_BRIDGE],
		desktopChrome: validDesktopChromePayload('win32'),
		environment: { arch: 'arm64', platform: 'win32', version: '1.0.0' },
		hasEditor: true,
		nodeExposed: false,
		saveOwnerReady: true,
		title: 'Soundscaper',
		url: 'soundscaper-app://bundle/',
	};
	assert.doesNotThrow(() => assertDesktopSmokePayload(payload, expected));
	assert.doesNotThrow(() => assertDesktopSmokePayload({
		...payload,
		desktopChrome: { ...payload.desktopChrome, fileAccessKey: 'Alt+D' },
	}, expected));
	assert.throws(
		() => assertDesktopSmokePayload({ ...payload, environment: undefined }, expected),
		/target platform/u,
	);
	assert.throws(
		() => assertDesktopSmokePayload({ ...payload, environment: { ...payload.environment, arch: 'x64' } }, expected),
		/target architecture/u,
	);
	assert.throws(
		() => assertDesktopSmokePayload({ ...payload, environment: { ...payload.environment, platform: 'linux' } }, expected),
		/target platform/u,
	);
	assert.throws(
		() => assertDesktopSmokePayload({ ...payload, saveOwnerReady: false }, expected),
		/save owner/u,
	);
	assert.throws(
		() => assertDesktopSmokePayload({
			...payload,
			desktopChrome: { ...payload.desktopChrome, fullBleed: false },
		}, expected),
		/full-bleed/iu,
	);
	assert.throws(
		() => assertDesktopSmokePayload({
			...payload,
			desktopChrome: { ...payload.desktopChrome, fileAccessKey: null },
		}, expected),
		/access key/iu,
	);
});

test('desktop smoke validates the closed Framescaper baseline UI, preload, and main readback witness', () => {
	const expected = {
		arch: 'arm64',
		bridge: FRAMESCAPER_EXPECTED_BRIDGE,
		platform: 'darwin',
		productId: 'framescaper',
		title: 'Framescaper',
		url: 'framescaper-app://bundle/',
	};
	const payload = validFramescaperBaselinePayload();
	assert.doesNotThrow(() => assertDesktopSmokePayload(payload, expected));
	assert.throws(
		() => assertDesktopSmokePayload({
			...payload,
			framescaperBaseline: {
				...payload.framescaperBaseline,
				main: {
					...payload.framescaperBaseline.main,
					project: { ...payload.framescaperBaseline.main.project, sha256: 'cd'.repeat(32) },
				},
			},
		}, expected),
		/baseline.*match|readback/iu,
	);
	assert.throws(
		() => assertDesktopSmokePayload({
			...payload,
			framescaperBaseline: {
				...payload.framescaperBaseline,
				main: {
					...payload.framescaperBaseline.main,
					project: { ...payload.framescaperBaseline.main.project, metadataFile: 'private/file.json' },
				},
			},
		}, expected),
		/unsupported fields|closed/iu,
	);
	assert.throws(
		() => assertDesktopSmokePayload({
			...payload,
			framescaperCapture: {
				...payload.framescaperCapture,
				teardown: { retired: true, retiredAgain: true },
			},
		}, expected),
		/retired.*exactly once|teardown/iu,
	);
});

test('packaged desktop smoke isolates both Chromium and shared library data', async () => {
	const source = await readFile(resolve(ROOT, 'scripts/desktop-smoke.mjs'), 'utf8');
	assert.match(source, /bridge: SMOKE_EXPECTED_BRIDGE/u);
	assert.match(source, /PRODUCT_ID === 'framescaper'[\s\S]*FRAMESCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE/u);
	assert.doesNotMatch(source, /const EXPECTED_BRIDGE/u);
	assert.match(source, /--user-data-dir=\$\{profile\}/u);
	assert.match(source, /--soundscaper-smoke-app-data=\$\{[^}]+\}/u);
	assert.match(source, /productId:\s*PRODUCT_ID/u);
});

function validFramescaperBaselinePayload() {
	const project = {
		projectId: 'framescaper-artifact-baseline',
		title: 'Untitled project',
		schemaFamily: 'framescaper',
		schemaVersion: FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.schemaVersion,
		projectRevision: 0,
		metadataRevision: 1,
		byteLength: 4_096,
		sha256: 'ab'.repeat(32),
		bodyCount: 0,
	};
	return {
		bridge: [...FRAMESCAPER_EXPECTED_BRIDGE],
		desktopChrome: validDesktopChromePayload('darwin'),
		environment: { arch: 'arm64', platform: 'darwin', version: '1.0.0' },
		hasEditor: true,
		nodeExposed: false,
		saveOwnerReady: true,
		title: 'Framescaper',
		url: 'framescaper-app://bundle/',
		framescaperBaseline: {
			preloadBridge: [
				'abortPublication', 'beginPublication', 'connect', 'deleteProject', 'duplicateProject',
				'finishPublication', 'handshakeState', 'listProjects', 'readBodyChunk', 'readProjectBundle',
				'writePublicationChunk',
			],
			handshake: {
				kind: 'framescaper-project-library-handshake',
				version: 1,
				owner: 'framescaper',
				schemaFamily: 'framescaper',
				schemaVersion: FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.schemaVersion,
				scapeFormatVersions: [1],
				attachedScapeFormatVersion: 1,
				storageDatabaseName: FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.storageDatabaseName,
				desktopLibrarySchemaVersion: FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.desktopLibrarySchemaVersion,
				desktopDatabaseUserVersion: FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.desktopDatabaseUserVersion,
				desktopLibraryScope: [...FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.desktopLibraryScope],
			},
			ui: { projectId: project.projectId, title: project.title, trackCount: 1, clipCount: 0 },
			project,
			main: {
				host: {
					product: 'framescaper', closed: false, fenced: false, activePublication: false,
				},
				project: { ...project },
			},
		},
		framescaperCapture: {
			preloadBridge: ['grant', 'listSources', 'status', 'teardown'],
			status: {
				version: 1,
				available: true,
				unavailableReason: null,
				selectionMode: 'system-picker',
				systemAudio: 'unavailable',
				sourceLimit: 64,
				sourceListTtlMs: 300_000,
				grantTtlMs: 15_000,
			},
			grant: {
				generation: 1,
				expiresAtMs: 1_015_000,
				roles: ['camera', 'microphone'],
				opaqueId: true,
			},
			teardown: { retired: true, retiredAgain: false },
		},
	};
}

function validDesktopChromePayload(platform) {
	return {
		documentDesktop: true,
		shellDesktop: true,
		fullBleed: true,
		customHeader: true,
		titlebarDraggable: true,
		controlsNoDrag: true,
		controlsVisible: true,
		maximizeEnabled: true,
		controlOrder: ['fullscreen', 'minimize', 'maximize', 'quit'],
		fileAccessKey: platform === 'darwin' ? null : 'Alt+F',
	};
}
