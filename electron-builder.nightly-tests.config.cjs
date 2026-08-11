/* SPDX-License-Identifier: AGPL-3.0-only */

/** @type {import('electron-builder').Configuration} */
module.exports = {
	appId: 'org.soundscaper.desktop.nightly-tests',
	productName: 'Soundscaper Nightly Tests',
	artifactName: 'Soundscaper-${version}-nightly-with-tests-${os}-${arch}.${ext}',
	compression: 'normal',
	asar: true,
	npmRebuild: false,
	afterPack: './scripts/desktop-nightly-tests-after-pack.mjs',
	directories: {
		app: '.desktop-build/nightly-tests',
		buildResources: '.desktop-build/icons',
		output: 'release/desktop-nightly-tests',
	},
	files: [
		'desktop/nightly-tests-main.mjs',
		'desktop/nightly-tests-manifest.mjs',
		'scripts/lib/desktop-nightly-tests-runtime.mjs',
		'scripts/lib/desktop-nightly-tests-static-route.mjs',
		'package.json',
		'!node_modules/**/*',
	],
	extraResources: [
		{
			from: '.desktop-build/nightly-tests',
			to: 'nightly-tests',
			filter: [
				'.local-browsers/**/*',
				'dist/**/*',
				'licenses/**/*',
				'package.json',
				'playwright.nightly-tests.config.mjs',
				'src/**/*',
				'stage-manifest.json',
				'tests/**/*',
			],
		},
		{
			from: '.desktop-build/nightly-tests/node_modules',
			to: 'nightly-tests/node_modules',
		},
		{ from: 'LICENSE', to: 'licenses/Soundscaper-AGPL-3.0.txt' },
		{ from: 'LICENSES', to: 'licenses/LICENSES' },
	],
	win: {
		icon: '.desktop-build/icons/icon.png',
		target: ['portable'],
	},
	mac: {
		icon: '.desktop-build/icons/icon.png',
		identity: '-',
		hardenedRuntime: false,
		gatekeeperAssess: false,
		category: 'public.app-category.developer-tools',
		target: ['zip'],
	},
	linux: {
		icon: '.desktop-build/icons',
		executableName: 'soundscaper-nightly-tests',
		syncDesktopName: true,
		category: 'Development',
		synopsis: 'Portable Soundscaper browser test runner',
		description: 'Runs the bundled Soundscaper Playwright workflows and writes diagnostics beside the executable.',
		maintainer: 'kw.media',
		target: ['AppImage'],
	},
	publish: null,
};
