import { resolve } from 'node:path';

import { validateFramescaperV18ArtifactEvidence } from '../../desktop/framescaper-v18-artifact-smoke.js';

const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);

export const DESKTOP_SMOKE_EXPECTED_BRIDGE = Object.freeze([
	'abortSharedSourceWrite',
	'abortWrite',
	'awaitVideoSourceProbe',
	'beginSharedSourceWrite',
	'beginVideoSourceProbe',
	'beginWrite',
	'cancelVideoSourceProbe',
	'checkForUpdates',
	'chooseFiles',
	'chooseLinkedAudioOriginal',
	'chooseLinkedVideoOriginal',
	'chooseSaveTarget',
	'commitSharedProject',
	'deleteSharedProject',
	'describeNativeAudioBackend',
	'editText',
	'finishSharedSourceWrite',
	'finishWrite',
	'getEnvironment',
	'installAssistanceModel',
	'listAssistanceModels',
	'listSharedProjects',
	'loadLinkedAudioOriginal',
	'loadLinkedVideoOriginal',
	'nativeAudioHelperAvailability',
	'onAssistanceInstallProgress',
	'onCloseRequested',
	'onFullscreenChanged',
	'onMenuCommand',
	'onOpenProject',
	'openExternal',
	'patchFinalPrefix',
	'probeHelperAvailability',
	'readSharedProject',
	'readSharedProjectBundle',
	'readSharedSourceChunk',
	'reconcileLinkedOriginals',
	'reconcileLinkedVideoOriginals',
	'releaseLinkedOriginal',
	'releaseLinkedVideoOriginal',
	'releaseRead',
	'removeAssistanceModel',
	'respondToClose',
	'setFullscreen',
	'setLocale',
	'signalReady',
	'writeChunk',
	'writeSharedSourceChunk',
]);

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
	if (expected.productId === 'framescaper') {
		validateFramescaperV18ArtifactEvidence(payload?.framescaperV18);
	} else {
		assert(payload?.framescaperV18 === undefined, 'Soundscaper smoke emitted Framescaper V18 evidence.');
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
