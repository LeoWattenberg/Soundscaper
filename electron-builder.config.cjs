const framescaper = process.env.SCAPE_PRODUCT === 'framescaper';
const productName = framescaper ? 'Framescaper' : 'Soundscaper';

/** @type {import('electron-builder').Configuration} */
module.exports = {
	appId: framescaper ? 'org.framescaper.desktop' : 'org.soundscaper.desktop',
	productName,
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
	fileAssociations: [
		{
			ext: 'scape',
			name: 'Scape Project',
			description: 'Soundscaper/Framescaper project',
			mimeType: 'application/vnd.soundscaper.scape+zip',
			role: 'Editor',
		},
		...(!framescaper ? [{
			ext: 'aup4',
			name: 'Soundscaper Project',
			description: 'Soundscaper/Audacity project copy',
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
		identity: '-',
		hardenedRuntime: false,
		gatekeeperAssess: false,
		category: framescaper ? 'public.app-category.video' : 'public.app-category.music',
		target: ['dmg'],
		...(!framescaper ? { extendInfo: {
			NSMicrophoneUsageDescription: 'Soundscaper records audio only when you start recording.',
		} } : {}),
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
