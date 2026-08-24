const framescaper = process.env.SCAPE_PRODUCT === 'framescaper';
const productName = framescaper ? 'Framescaper' : 'Soundscaper';
// The signing chain is enacted but identity-gated: with no acquired signing
// identity (the named milestone-5 blocker), macOS stays ad-hoc-signed with the
// hardened runtime off and Windows/Linux stay unsigned via the CI-wide
// CSC_IDENTITY_AUTO_DISCOVERY=false. Providing SOUNDSCAPER_MAC_SIGNING_IDENTITY
// (and Apple notarization credentials for SOUNDSCAPER_MAC_NOTARIZE=true) turns
// the real chain on without any further configuration change.
const macSigningIdentity = process.env.SOUNDSCAPER_MAC_SIGNING_IDENTITY || '-';
const macSigned = macSigningIdentity !== '-';
const macEntitlements = framescaper
	? 'desktop/framescaper-entitlements.mac.plist'
	: 'desktop/soundscaper-entitlements.mac.plist';

/** @type {import('electron-builder').Configuration} */
module.exports = {
	appId: framescaper ? 'org.framescaper.desktop' : 'org.soundscaper.desktop',
	productName,
	artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
	compression: 'maximum',
	asar: true,
	// Stock Electron enables proprietary codecs in its Chromium FFmpeg library.
	// Replace it with Electron's matching alternate release asset before signing;
	// this framework library is not a Soundscaper codec-provider tier.
	downloadAlternateFFmpeg: true,
	npmRebuild: false,
	beforePack: './scripts/desktop-before-pack.mjs',
	afterPack: './scripts/desktop-after-pack.mjs',
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
		{ from: 'LICENSES', to: 'licenses/LICENSES' },
	],
	fileAssociations: [
		{
			ext: 'scape',
			name: 'Scape Project',
			description: 'Soundscaper/Framescaper project',
			mimeType: 'application/vnd.soundscaper.scape+zip',
			role: 'Editor',
		},
		...(!framescaper ? [{
			ext: ['aup3', 'aup4'],
			name: 'Soundscaper Project',
			description: 'Audacity project',
			mimeType: 'application/x-audacity-project',
			role: 'Editor',
		}] : []),
	],
	win: {
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
		icon: '.desktop-build/icons/icon.png',
		identity: macSigningIdentity,
		hardenedRuntime: macSigned,
		entitlements: macEntitlements,
		entitlementsInherit: macEntitlements,
		notarize: macSigned && process.env.SOUNDSCAPER_MAC_NOTARIZE === 'true',
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
