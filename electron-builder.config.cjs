/** @type {import('electron-builder').Configuration} */
module.exports = {
	appId: 'org.soundscaper.desktop',
	productName: 'Soundscaper',
	artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
	compression: 'maximum',
	asar: true,
	npmRebuild: false,
	afterPack: './scripts/desktop-after-pack.mjs',
	directories: {
		app: '.desktop-build/app',
		buildResources: '.desktop-build/icons',
		output: 'release/desktop',
	},
	files: [
		'desktop/**/*',
		'package.json',
		'!node_modules/**/*',
		'!desktop/**/*.test.*',
	],
	extraResources: [
		{ from: '.desktop-build/renderer', to: 'renderer' },
		{ from: '.desktop-build/runtime', to: 'runtime' },
		{ from: 'LICENSE', to: 'licenses/Soundscaper-AGPL-3.0.txt' },
		{ from: 'THIRD_PARTY_LICENSES.md', to: 'licenses/THIRD_PARTY_LICENSES.md' },
		{ from: 'LICENSES', to: 'licenses/LICENSES' },
	],
	fileAssociations: [{
		ext: 'aup4',
		name: 'Soundscaper Project',
		description: 'Soundscaper/Audacity project copy',
		mimeType: 'application/x-audacity-project',
		role: 'Editor',
	}],
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
		identity: '-',
		hardenedRuntime: false,
		gatekeeperAssess: false,
		category: 'public.app-category.music',
		target: ['dmg'],
		extendInfo: {
			NSMicrophoneUsageDescription: 'Soundscaper records audio only when you start recording.',
		},
	},
	dmg: {
		artifactName: '${productName}-${version}-mac-${arch}.${ext}',
	},
	linux: {
		icon: '.desktop-build/icons',
		executableName: 'soundscaper',
		syncDesktopName: true,
		category: 'AudioVideo;Audio',
		synopsis: 'Local-first multitrack audio editor',
		description: 'Soundscaper is a local-first multitrack audio editor with offline project and media export support.',
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
