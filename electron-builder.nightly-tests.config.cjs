/* SPDX-License-Identifier: AGPL-3.0-only */

const nightlyPackageArch = process.env.SOUNDSCAPER_NIGHTLY_TESTS_PACKAGE_ARCH;
if (nightlyPackageArch !== undefined && nightlyPackageArch !== 'x64' && nightlyPackageArch !== 'arm64') {
	throw new TypeError('SOUNDSCAPER_NIGHTLY_TESTS_PACKAGE_ARCH must be x64 or arm64.');
}

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
		'desktop/coverage-checkpoint-exit.mjs',
		'desktop/nightly-tests-main.mjs',
		'desktop/nightly-tests-assistance-host.mjs',
		'desktop/nightly-tests-assistance.html',
		'desktop/nightly-tests-manifest.mjs',
		'desktop/nightly-tests-progress-window.mjs',
		'desktop/nightly-tests-progress.html',
		'desktop/nightly-tests-progress-renderer.js',
		'desktop/nightly-tests-progress.css',
		'scripts/lib/desktop-nightly-tests-runtime.mjs',
		'scripts/lib/desktop-nightly-tests-phases.mjs',
		'scripts/lib/desktop-nightly-tests-local-assistance.mjs',
		'scripts/lib/desktop-nightly-tests-dual-origin.mjs',
		'scripts/lib/pages-site-static-server.mjs',
		'scripts/lib/product-web-routing.mjs',
		'scripts/lib/desktop-nightly-tests-static-response.mjs',
		'scripts/lib/static-site-content-types.mjs',
		'scripts/lib/desktop-nightly-tests-product-sites.mjs',
		'scripts/lib/desktop-nightly-tests-static-route.mjs',
		'scripts/lib/desktop-nightly-tests-metrics.mjs',
		'scripts/lib/desktop-nightly-tests-packaged-coverage.mjs',
		'scripts/lib/desktop-packaged-product-executable.mjs',
		'scripts/lib/desktop-nightly-tests-packaged-runtime.mjs',
		'scripts/lib/desktop-nightly-tests-presentation.mjs',
		'scripts/collect-m3-longform-editorial-quality.mjs',
		'scripts/lib/m4-production-parity-identity.mjs',
		'scripts/lib/m4-production-parity-metrics.mjs',
		'scripts/lib/m4-production-parity-video-fixture.mjs',
		'scripts/lib/m4b2-keyframe-parity-metrics.mjs',
		'scripts/lib/strict-json-snapshot.mjs',
		'scripts/lib/quality-budget-config.mjs',
		'scripts/collect-m4-production-parity-quality.mjs',
		'scripts/collect-m4b2-keyframe-parity-quality.mjs',
		'scripts/quality-budget-evaluator.mjs',
		'scripts/quality-budget-result.mjs',
		'scripts/verify-quality-budget-result.mjs',
		'package.json',
		'!node_modules/**/*',
	],
	extraResources: [
		{
			from: '.desktop-build/nightly-tests',
			to: 'nightly-tests',
			filter: [
				'.local-browsers/**/*',
				'config/**/*',
				'desktop/bundled-*-stream.ts',
				'desktop/desktop-audio-codec-capability-contract.ts',
				'desktop/desktop-audio-codec-operation-contract.ts',
				'desktop/soak-debug-*.mjs',
				'evidence/nyquist-plugin-publication/catalog-metadata-ed168a19631ec48d0029dfb5c17d16c339a174c1.json',
				// The guide specs replay handbook step data, which lives outside `tests/`.
				'handbook/**/*',
				'sites/**/*',
				'licenses/**/*',
				'package.json',
				'playwright.nightly-metrics.config.mjs',
				'playwright.nightly-dual-origin.config.mjs',
				'playwright.nightly-packaged-coverage.config.mjs',
				'playwright.nightly-packaged-metrics.config.mjs',
				'playwright.nightly-local-assistance.config.mjs',
				'playwright.nightly-tests.config.mjs',
				// The browser specs import spec-support helpers from here. The
				// launcher's own modules reach the main process through `files`
				// above, so this carries the payload's copies, not the launcher's.
				'scripts/lib/**/*',
				'scripts/*.mjs',
				'src/**/*',
				'vendor/audacity-design-system/tokens/**/*',
				'stage-manifest.json',
				'tests/**/*',
			],
		},
		{
			from: '.desktop-build/nightly-tests/node_modules',
			to: 'nightly-tests/node_modules',
		},
		{
			from: 'release/desktop-nightly-products',
			to: 'nightly-tests/products',
		},
		{ from: 'LICENSE', to: 'licenses/Soundscaper-AGPL-3.0.txt' },
		{ from: 'LICENSES', to: 'licenses/LICENSES' },
	],
	win: {
		icon: '.desktop-build/icons/icon.png',
		target: ['portable'],
	},
	portable: {
		splashImage: '.desktop-build/icons/nightly-tests-splash.bmp',
		// Electron Builder embeds the app files directly with this option. Its
		// default 7z path extracts to a second tree, then CopyFiles can fail
		// with a misleading "cannot be closed" dialog before Electron starts.
		// The pinned NSIS direct-directory template lacks an APP_DIR_ARM64-only
		// branch, so ARM64 uses the 7z archive path. The ARM64 packaged nightly
		// smoke must exercise that extraction path on its native runner.
		useZip: nightlyPackageArch !== 'arm64',
		// A per-launch directory avoids colliding with a previous run's files.
		unpackDirName: false,
	},
	mac: {
		icon: '.desktop-build/icons/icon.png',
		identity: '-',
		hardenedRuntime: false,
		// The product applications were already sealed before their exact files
		// entered the nightly payload manifest. Preserve those authenticated bytes
		// instead of recursively signing the nested application bundles again.
		signIgnore: '/Contents/Resources/nightly-tests/products/',
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
