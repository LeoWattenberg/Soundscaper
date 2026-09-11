// @ts-check
const assistanceNativeRuntimeManifest = require('./config/assistance-native-runtime-manifest.json');
const professionalNativePayloadManifest = require('./config/soundscaper-professional-native-payload-manifest.json');
const productReleaseLines = require('./config/product-release-lines.json');

const productId = resolveDesktopProductId(process.env.SCAPE_PRODUCT);
const framescaper = productId === 'framescaper';
const productName = framescaper ? 'Framescaper' : 'Soundscaper';
const soundscaperStable = !framescaper
	&& productReleaseLines.products.soundscaper.applicationVersionChannel === 'stable'
	&& productReleaseLines.products.soundscaper.releaseChannel === 'stable';
// Development builds use ad-hoc seals; credentialed release jobs explicitly
// select a Developer ID identity and require notarization.
const signing = require('./scripts/lib/desktop-signing-config.cjs').desktopSigningConfig();
const macSigningIdentity = signing.mac.identity;
const macEntitlements = framescaper
	? 'desktop/framescaper-entitlements.mac.plist'
	: 'desktop/soundscaper-entitlements.mac.plist';
// These payloads are sealed before their exact digests enter the stage
// manifest. The release signing hook repins its verified stage before ASAR
// assembly; electron-builder must not sign those runtime bytes a second time.
const macAssistancePackage = assistanceNativeRuntimeManifest.targets['mac-arm64'].package;
const macAssistanceNativeFiles = Object.keys(macAssistancePackage.files)
	.filter((name) => name.endsWith('.dylib') || name.endsWith('.node'))
	.map(regexEscape)
	.join('|');
const macPreAuthenticatedRuntimePayload = [
	'/Contents/Resources/runtime/(?:',
	'native/soundscaper-os-audio-codec/mac-arm64/soundscaper_os_audio_codec\\.node',
	'|',
	`${regexEscape(professionalNativePayloadManifest.staging.runtimePrefix)}/mac-arm64(?:/.*)?`,
	'|',
	`${regexEscape(assistanceNativeRuntimeManifest.runtimePrefix)}/node_modules/`,
	`${regexEscape(macAssistancePackage.name)}/(?:${macAssistanceNativeFiles})`,
	'|assistance/(?:onnxruntime-node/1\\.29\\.0|whisper-cpp/v1\\.9\\.3)/mac-arm64/.*',
	')$',
].join('');

/** @type {import('electron-builder').Configuration} */
module.exports = {
	forceCodeSigning: signing.forceCodeSigning,
	appId: framescaper ? 'org.framescaper.desktop' : 'org.soundscaper.desktop',
	productName,
	artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
	compression: 'maximum',
	asar: true,
	// Stock Electron enables proprietary codecs in its Chromium FFmpeg library.
	// Replace it with Electron's matching alternate release asset before code sealing;
	// this framework library is not a Soundscaper codec-provider tier.
	downloadAlternateFFmpeg: true,
	npmRebuild: false,
	beforePack: './scripts/desktop-before-pack.mjs',
	afterPack: './scripts/desktop-after-pack.mjs',
	afterSign: './scripts/desktop-after-sign.mjs',
	afterAllArtifactBuild: './scripts/desktop-verify-release-artifacts.mjs',
	directories: {
		app: '.desktop-build/app',
		buildResources: '.desktop-build/icons',
		output: 'release/desktop',
	},
	files: [
		'desktop/**/*',
		'config/*.json',
		'package.json',
		'!node_modules/**/*',
		'!desktop/**/*.test.*',
	],
	extraResources: [
		{ from: '.desktop-build/renderer', to: 'renderer' },
		{ from: '.desktop-build/runtime', to: 'runtime' },
		{ from: 'LICENSE', to: 'licenses/Soundscaper-AGPL-3.0.txt' },
		{ from: '.desktop-build/licenses/THIRD_PARTY_LICENSES.md', to: 'licenses/THIRD_PARTY_LICENSES.md' },
		{ from: '.desktop-build/licenses/codecs', to: 'licenses/codecs' },
		...(soundscaperStable ? [{
			from: '.desktop-build/licenses/professional-native',
			to: 'licenses/professional-native',
		}] : []),
		{ from: 'LICENSES', to: 'licenses/LICENSES' },
	],
	fileAssociations: [
		{
			// Each build claims its own suffix plus the legacy one. Neither app
			// claims `.liscape`, which Lightscaper will register for itself.
			ext: framescaper ? 'fscape' : 'sscape',
			name: framescaper ? 'Framescaper Project' : 'Soundscaper Project',
			description: `${productName} project`,
			mimeType: 'application/vnd.soundscaper.scape+zip',
			role: 'Editor',
		},
		{
			ext: 'scape',
			name: 'Scape Project',
			description: 'Soundscaper/Framescaper project',
			mimeType: 'application/vnd.soundscaper.scape+zip',
			role: 'Editor',
		},
		...(!framescaper ? [{
			ext: ['aup3', 'aup4'],
			// Named for what it is: 'Soundscaper Project' now belongs to `.sscape`.
			name: 'Audacity Project',
			description: 'Audacity project',
			mimeType: 'application/x-audacity-project',
			role: 'Editor',
		}] : []),
	],
	win: {
		...signing.win,
		// The signed application archive authenticates this exact CPU executable.
		// Copy-time signing would change its bytes after the inventory is sealed.
		signExts: ['!whisper-cli.exe'],
		icon: '.desktop-build/icons/icon.png',
		target: ['nsis', 'zip'],
	},
	nsis: {
		oneClick: false,
		perMachine: true,
		allowElevation: true,
		allowToChangeInstallationDirectory: true,
		createDesktopShortcut: true,
		createStartMenuShortcut: true,
		deleteAppDataOnUninstall: false,
	},
	mac: {
		notarize: signing.mac.notarize,
		icon: '.desktop-build/icons/icon.png',
		identity: macSigningIdentity,
		hardenedRuntime: true,
		entitlements: macEntitlements,
		entitlementsInherit: macEntitlements,
		signIgnore: signing.mac.notarize ? '/Contents/Resources/runtime/' : macPreAuthenticatedRuntimePayload,
		gatekeeperAssess: false,
		category: framescaper ? 'public.app-category.video' : 'public.app-category.music',
		target: ['dmg'],
		extendInfo: framescaper ? {
			NSCameraUsageDescription: 'Framescaper accesses the camera only when you choose a camera capture source.',
			NSMicrophoneUsageDescription: 'Framescaper records microphone audio only when you choose a microphone capture source.',
			NSAudioCaptureUsageDescription: 'Framescaper records system audio only when you explicitly include it with a screen capture.',
		} : {
			NSMicrophoneUsageDescription: 'Soundscaper records audio only when you start recording.',
		},
	},
	dmg: {
		sign: signing.mac.notarize,
		artifactName: '${productName}-${version}-mac-${arch}.${ext}',
	},
	linux: {
		icon: '.desktop-build/icons',
		executableName: framescaper ? 'framescaper' : 'soundscaper',
		syncDesktopName: true,
		category: framescaper ? 'AudioVideo;Video' : 'AudioVideo;Audio',
		synopsis: framescaper ? 'Local-first video editor' : 'Local-first multitrack audio editor',
		description: framescaper
			? 'Framescaper is a local-first video editor with offline project and media export support.'
			: 'Soundscaper is a local-first multitrack audio editor with offline project and media export support.',
		maintainer: 'kw.media',
		target: ['AppImage', 'deb'],
	},
	appImage: {
		artifactName: '${productName}-${version}-linux-${arch}.${ext}',
	},
	deb: {
		artifactName: '${productName}-${version}-linux-${arch}.${ext}',
	},
	publish: null,
};

/** @param {string} value */
function regexEscape(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * @param {string | undefined} value
 * @returns {'soundscaper' | 'framescaper'}
 */
function resolveDesktopProductId(value) {
	const requested = value === undefined ? 'soundscaper' : value;
	if (requested !== 'soundscaper' && requested !== 'framescaper') {
		throw new Error(
			`SCAPE_PRODUCT must be soundscaper or framescaper; received ${JSON.stringify(value)}.`,
		);
	}
	return requested;
}
