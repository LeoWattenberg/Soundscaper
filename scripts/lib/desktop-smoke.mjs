import { resolve } from 'node:path';

import { validateFramescaperCaptureArtifactEvidence } from '../../desktop/framescaper-capture-artifact-smoke.js';
import { validateFramescaperBaselineArtifactEvidence } from '../../desktop/framescaper-baseline-artifact-smoke.js';

const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);

export const DESKTOP_SMOKE_EXPECTED_BRIDGE = Object.freeze([
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
	'persistentDelivery',
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

const SOUNDSCAPER_DEFERRED_BRIDGE_MEMBERS = new Set([
	'awaitVideoSourceProbe',
	'beginDesktopVideoCodecOperation',
	'beginVideoSourceProbe',
	'cancelDesktopVideoCodecOperation',
	'cancelVideoSourceProbe',
	'chooseLinkedVideoOriginal',
	'closeDesktopVideoCodecInput',
	'deleteDesktopVideoCodecOperation',
	'executeDesktopVideoCodecOperation',
	'getDesktopVideoExportCapabilities',
	'loadLinkedVideoOriginal',
	'nativeServices',
	'probeHelperAvailability',
	'readDesktopVideoCodecOutput',
	'reconcileLinkedVideoOriginals',
	'releaseLinkedVideoOriginal',
	'statDesktopVideoCodecOutput',
	'writeDesktopVideoCodecInput',
]);

export const SOUNDSCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE = Object.freeze(
	DESKTOP_SMOKE_EXPECTED_BRIDGE.filter((name) => !SOUNDSCAPER_DEFERRED_BRIDGE_MEMBERS.has(name)),
);

export const FRAMESCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE = Object.freeze([
	...DESKTOP_SMOKE_EXPECTED_BRIDGE.filter((name) => name !== 'persistentDelivery'),
	'projectLibrary',
].sort());

export function resolveSmokeArchitecture(configuredArchitecture, hostArchitecture) {
	const architecture = configuredArchitecture === undefined
		? hostArchitecture
		: configuredArchitecture;
	if (!SUPPORTED_ARCHITECTURES.has(architecture)) {
		throw new Error(`Unsupported desktop smoke architecture: ${architecture}`);
	}
	return architecture;
}

export function packagedExecutableCandidates({ arch, outputRoot, platform, productId, productName }) {
	resolveSmokeArchitecture(arch, arch);
	const archSuffix = arch === 'x64' ? '' : `-${arch}`;
	let relativeCandidates;
	if (platform === 'win32') {
		relativeCandidates = [
			[`win${archSuffix}-unpacked`, `${productName}.exe`],
			['win-unpacked', `${productName}.exe`],
		];
	} else if (platform === 'darwin') {
		relativeCandidates = [
			[`mac${archSuffix}`, `${productName}.app`, 'Contents', 'MacOS', productName],
			['mac', `${productName}.app`, 'Contents', 'MacOS', productName],
		];
	} else if (platform === 'linux') {
		relativeCandidates = [
			[`linux${archSuffix}-unpacked`, productId],
			['linux-unpacked', productId],
		];
	} else {
		throw new Error(`Unsupported desktop smoke platform: ${platform}`);
	}
	return [...new Set(relativeCandidates.map((segments) => resolve(outputRoot, ...segments)))];
}

export function assertDesktopSmokePayload(payload, expected) {
	assert(payload?.url === expected.url, 'Smoke loaded an unexpected URL.');
	assert(payload?.title === expected.title, 'Smoke loaded an unexpected document title.');
	assert(payload?.hasEditor === true, 'Smoke did not render the editor document.');
	assert(payload?.nodeExposed === false, 'Smoke exposed Node.js globals to the renderer.');
	assert(payload?.saveOwnerReady === true, 'Smoke did not activate the main-document save owner.');
	assert(
		JSON.stringify(payload?.bridge) === JSON.stringify(expected.bridge),
		'Smoke bridge surface does not match the reviewed v1 contract.',
	);
	assert(
		payload?.environment?.platform === expected.platform,
		'Smoke reported an unexpected target platform.',
	);
	assert(
		payload?.environment?.arch === expected.arch,
		'Smoke reported an unexpected target architecture.',
	);
	assertDesktopChrome(payload?.desktopChrome, expected.platform);
	if (expected.productId === 'framescaper') {
		validateFramescaperCaptureArtifactEvidence(payload?.framescaperCapture);
		validateFramescaperBaselineArtifactEvidence(payload?.framescaperBaseline);
	} else {
		assert(payload?.framescaperCapture === undefined, 'Soundscaper smoke emitted Framescaper capture evidence.');
		assert(payload?.framescaperBaseline === undefined, 'Soundscaper smoke emitted Framescaper baseline evidence.');
	}
}

function assertDesktopChrome(chrome, platform) {
	assert(chrome?.documentDesktop === true, 'Smoke did not activate the desktop document route.');
	assert(chrome?.shellDesktop === true, 'Smoke did not activate the desktop application shell.');
	assert(chrome?.fullBleed === true, 'Smoke editor chrome is not full-bleed.');
	assert(chrome?.customHeader === true, 'Smoke did not render the custom desktop header.');
	assert(chrome?.titlebarDraggable === true, 'Smoke custom title bar is not draggable.');
	assert(chrome?.controlsNoDrag === true, 'Smoke window controls are not excluded from dragging.');
	assert(chrome?.controlsVisible === true, 'Smoke window controls are not all visible.');
	assert(chrome?.maximizeEnabled === true, 'Smoke maximize or restore control is unexpectedly disabled.');
	const controls = chrome?.controlOrder;
	assert(Array.isArray(controls)
		&& controls.length === 4
		&& controls[0] === 'fullscreen'
		&& controls[1] === 'minimize'
		&& (controls[2] === 'maximize' || controls[2] === 'restore')
		&& controls[3] === 'quit', 'Smoke window controls are missing or out of order.');
	const accessKeyIsScoped = platform === 'darwin'
		? chrome?.fileAccessKey === null
		: typeof chrome?.fileAccessKey === 'string'
			&& /^Alt\+[\p{Letter}\p{Number}]$/u.test(chrome.fileAccessKey);
	assert(accessKeyIsScoped, 'Smoke File menu access key has the wrong platform scope.');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
