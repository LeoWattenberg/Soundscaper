// @ts-check
const professionalNativePayloadManifest = require('./config/soundscaper-professional-native-payload-manifest.json');

const productId = resolveDesktopProductId(process.env.SCAPE_PRODUCT);
const framescaper = productId === 'framescaper';
const motionscaper = productId === 'motionscaper';
const productName = { soundscaper: 'Soundscaper', framescaper: 'Framescaper', motionscaper: 'Motionscaper' }[productId];
// Development builds use ad-hoc seals; credentialed release jobs explicitly
// select a Developer ID identity and require notarization.
const signing = require('./scripts/lib/desktop-signing-config.cjs').desktopSigningConfig();
const macSigningIdentity = signing.mac.identity;
const macEntitlements = motionscaper ? 'desktop/motionscaper-entitlements.mac.plist' : framescaper
	? 'desktop/framescaper-entitlements.mac.plist'
	: 'desktop/soundscaper-entitlements.mac.plist';
// These payloads are sealed before their exact digests enter the stage
// manifest. The release signing hook repins its verified stage before ASAR
// assembly; electron-builder must not sign those runtime bytes a second time.
const macPreAuthenticatedRuntimePayload = [
	'/Contents/Resources/runtime/(?:',
	'native/soundscaper-os-audio-codec/mac-arm64/soundscaper_os_audio_codec\\.node',
	'|',
	`${regexEscape(professionalNativePayloadManifest.staging.runtimePrefix)}/mac-arm64(?:/.*)?`,
	')$',
].join('');

/** @type {import('electron-builder').Configuration} */
module.exports = {
	forceCodeSigning: signing.forceCodeSigning,
	appId: `org.${productId}.desktop`,
	productName,
	artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
	compression: 'maximum',
	asar: true,
	// Stock Electron enables proprietary codecs in its Chromium FFmpeg library.
	// Replace it with Electron's matching alternate release asset before code sealing;
	// this framework library is not a Soundscaper codec-provider tier.
	downloadAlternateFFmpeg: true,
	npmRebuild: false,
	beforePack: motionscaper ? './scripts/motionscaper-desktop-before-pack.mjs' : './scripts/desktop-before-pack.mjs',
	afterPack: motionscaper ? './scripts/motionscaper-desktop-after-pack.mjs' : './scripts/desktop-after-pack.mjs',
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
		{ from: '.desktop-build/licenses', to: 'licenses' },
		{ from: 'LICENSES', to: 'licenses/LICENSES' },
	],
	fileAssociations: [
		{
			// Each build claims its own suffix plus the legacy one. Neither app
			// claims `.liscape`, which Lightscaper will register for itself.
			ext: { soundscaper: 'sscape', framescaper: 'fscape', motionscaper: 'mscape' }[productId],
			name: `${productName} Project`,
			description: `${productName} project`,
			mimeType: 'application/vnd.soundscaper.scape+zip',
			role: 'Editor',
		},
		{
			ext: 'scape',
			name: 'Scape Project',
			description: 'Scape project',
			mimeType: 'application/vnd.soundscaper.scape+zip',
			role: 'Editor',
		},
		...(productId === 'soundscaper' ? [{
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
		// Ad-hoc signatures have no Team ID; hardened library validation would
		// reject the bundled Electron framework before the application can start.
		hardenedRuntime: signing.mac.notarize,
		entitlements: macEntitlements,
		entitlementsInherit: macEntitlements,
		signIgnore: signing.mac.notarize ? '/Contents/Resources/runtime/' : motionscaper
			? '/Contents/Resources/runtime/motionscaper-media-host/motionscaper-media-host$' : macPreAuthenticatedRuntimePayload,
		gatekeeperAssess: false,
		category: productId === 'soundscaper' ? 'public.app-category.music' : 'public.app-category.video',
		target: ['dmg'],
		extendInfo: motionscaper ? {} : framescaper ? {
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
		icon: '.desktop-build/icons/linux',
		executableName: productId,
		syncDesktopName: true,
		category: productId === 'soundscaper' ? 'AudioVideo;Audio' : 'AudioVideo;Video',
		synopsis: motionscaper ? 'Local-first motion graphics and compositing' : framescaper ? 'Local-first video editor' : 'Local-first multitrack audio editor',
		description: motionscaper ? 'Motionscaper is a local-first motion graphics and compositing program.' : framescaper
			? 'Framescaper is a local-first video editor with offline project and media export support.'
			: 'Soundscaper is a local-first multitrack audio editor with offline project and media export support.',
		maintainer: 'Mindscaper',
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
 * @returns {'soundscaper' | 'framescaper' | 'motionscaper'}
 */
function resolveDesktopProductId(value) {
	const requested = value === undefined ? 'soundscaper' : value;
	if (requested !== 'soundscaper' && requested !== 'framescaper' && requested !== 'motionscaper') {
		throw new Error(
			`SCAPE_PRODUCT must be soundscaper, framescaper, or motionscaper; received ${JSON.stringify(value)}.`,
		);
	}
	return requested;
}
