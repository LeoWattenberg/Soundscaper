/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { prepareDesktopNightlyTests } from '../scripts/desktop-nightly-tests-prepare.mjs';
import {
	createFixture, listStagedPackages, readJson, writeFixturePackage,
} from './helpers/nightly-tests-staging-fixture.js';
import {
	NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS,
	stageDesktopNightlyTests,
} from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const EXPECTED_RUNTIME_PACKAGES = [
	'@axe-core/playwright',
	'@echogarden/pffft-wasm',
	'@esbuild/linux-x64',
	'@ffmpeg/core',
	'@ffmpeg/ffmpeg',
	'@ffmpeg/types',
	'@fontsource/inter',
	'@noble/hashes',
	'@playwright/test',
	'@types/dom-mediacapture-transform',
	'@types/dom-webcodecs',
	'@zip.js/zip.js',
	'axe-core',
	'esbuild',
	'fflate',
	'mediabunny',
	'playwright',
	'playwright-core',
	'saxes',
	'sql.js',
	'typescript',
	'xmlchars',
];

const BURN_IN_FONT_FILES = [
	'inter-cyrillic-ext-600-normal.woff',
	'inter-cyrillic-600-normal.woff',
	'inter-greek-ext-600-normal.woff',
	'inter-greek-600-normal.woff',
	'inter-latin-ext-600-normal.woff',
	'inter-latin-600-normal.woff',
	'inter-vietnamese-600-normal.woff',
];

test('nightly test staging creates a hermetic, manifest-bound Playwright payload', async (context) => {
	const fixture = await createFixture(context);
	const result = await stageDesktopNightlyTests({
		repositoryRoot: fixture.repositoryRoot,
		outputRoot: fixture.outputRoot,
		browserSourceRoot: fixture.browserSourceRoot,
		sourceRevision: 'a'.repeat(40),
		target: { platform: 'linux', arch: 'x64' },
	});

	assert.equal(result.outputRoot, fixture.outputRoot);
	assert.deepEqual(NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS, [
		'@axe-core/playwright',
		'@echogarden/pffft-wasm',
		'@ffmpeg/core',
		'@ffmpeg/ffmpeg',
		'@fontsource/inter',
		'@noble/hashes',
		'@playwright/test',
		'@zip.js/zip.js',
		'esbuild',
		'fflate',
		'mediabunny',
		'saxes',
		'sql.js',
		'typescript',
	]);

	const packageMetadata = await readJson(join(fixture.outputRoot, 'package.json'));
	assert.deepEqual(packageMetadata, {
		name: 'soundscaper-nightly-tests',
		productName: 'Soundscaper Nightly Tests',
		desktopName: 'org.soundscaper.desktop.nightly-tests',
		version: '1.0.0-rc.1',
		description: 'Portable Soundscaper Playwright browser test runner',
		main: 'desktop/nightly-tests-main.mjs',
		type: 'module',
		private: true,
		license: 'AGPL-3.0-only',
	});

	for (const relativePath of [
		'desktop/nightly-tests-main.mjs',
		'desktop/nightly-tests-manifest.mjs',
		'scripts/lib/desktop-nightly-tests-runtime.mjs',
		'scripts/lib/desktop-nightly-tests-static-response.mjs',
		'scripts/lib/desktop-nightly-tests-product-sites.mjs',
		'scripts/lib/desktop-nightly-tests-static-route.mjs',
		'scripts/lib/desktop-nightly-tests-metrics.mjs',
		'scripts/lib/desktop-nightly-tests-packaged-runtime.mjs',
		'scripts/lib/desktop-nightly-tests-presentation.mjs',
		'scripts/collect-m3-longform-editorial-quality.mjs',
		'scripts/collect-m4-production-parity-quality.mjs',
		'scripts/collect-m4b2-keyframe-parity-quality.mjs',
		'scripts/lib/quality-budget-config.mjs',
		'config/accessibility-wcag-baseline.json',
		'config/quality-budgets.json',
		'playwright.nightly-metrics.config.mjs',
		'playwright.nightly-packaged-metrics.config.mjs',
		'playwright.nightly-tests.config.mjs',
		'sites/soundscaper/en/index.html',
		'sites/framescaper/en/index.html',
		'tests/browser/example.spec.js',
		'tests/browser/example.spec.js-snapshots/example-chromium-linux.png',
		'tests/aup3-fixture.js',
		'tests/fixtures/aup4-native-rich.js',
		'src/common/editor/example.ts',
		'.local-browsers/chromium-101/INSTALLATION_COMPLETE',
		'.local-browsers/firefox-102/INSTALLATION_COMPLETE',
		'.local-browsers/webkit-103/INSTALLATION_COMPLETE',
		'.local-browsers/webkit-103/libalias',
		'.local-browsers/ffmpeg-104/INSTALLATION_COMPLETE',
		'.local-browsers/winldd-105/INSTALLATION_COMPLETE',
		'licenses/Soundscaper-AGPL-3.0.txt',
		'licenses/THIRD_PARTY_LICENSES.md',
		'licenses/LICENSES/Playwright-winldd-MIT.txt',
		'licenses/node_modules/@playwright/test/LICENSE',
		'licenses/node_modules/@playwright/test/NOTICE',
		'licenses/node_modules/playwright/ThirdPartyNotices.txt',
		'licenses/node_modules/playwright-core/ThirdPartyNotices.txt',
		'licenses/node_modules/@axe-core/playwright/LICENSE',
		'licenses/node_modules/@echogarden/pffft-wasm/COPYING',
		'licenses/node_modules/@fontsource/inter/LICENSE',
		'licenses/node_modules/axe-core/LICENSE-3RD-PARTY.txt',
	]) await access(join(fixture.outputRoot, relativePath));
	for (const name of BURN_IN_FONT_FILES) {
		await access(join(fixture.outputRoot, 'node_modules/@fontsource/inter/files', name));
	}
	await assert.rejects(() => access(join(fixture.outputRoot, 'tests/browser/AGENTS.md')), /ENOENT/u);
	await assert.rejects(
		() => access(join(fixture.outputRoot, 'tests/browser/audio-editor-soak-debug.spec.js')),
		/ENOENT/u,
	);
	await assert.rejects(() => access(join(fixture.outputRoot, 'tests/browser/handbook')), /ENOENT/u);
	await assert.rejects(
		() => access(join(fixture.outputRoot, 'node_modules/playwright-core/.local-browsers')),
		/ENOENT/u,
	);
	assert.equal((await lstat(join(fixture.outputRoot, '.local-browsers/webkit-103/libalias'))).isSymbolicLink(), true);

	const stagedPackages = await listStagedPackages(join(fixture.outputRoot, 'node_modules'));
	assert.deepEqual(stagedPackages, EXPECTED_RUNTIME_PACKAGES);
	const manifest = await readJson(join(fixture.outputRoot, 'stage-manifest.json'));
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.kind, 'soundscaper-desktop-nightly-tests');
	assert.equal(manifest.applicationVersion, '1.0.0-rc.1');
	assert.equal(manifest.sourceRevision, 'a'.repeat(40));
	assert.deepEqual(manifest.target, { platform: 'linux', arch: 'x64' });
	assert.deepEqual(manifest.browserRevisions, {
		chromium: '101',
		firefox: '102',
		webkit: '103',
		ffmpeg: '104',
		winldd: '105',
	});
	assert.deepEqual(manifest.runtimePackages.map(({ name }) => name), EXPECTED_RUNTIME_PACKAGES);
	assert.deepEqual(manifest.payload.map(({ path }) => path), [
		'.local-browsers',
		'config',
		'sites',
		'licenses',
		'node_modules',
		'package.json',
		'playwright.nightly-metrics.config.mjs',
		'playwright.nightly-packaged-metrics.config.mjs',
		'playwright.nightly-tests.config.mjs',
		'src',
		'tests',
	]);
	for (const descriptor of manifest.payload) {
		assert.ok(Number.isSafeInteger(descriptor.byteLength) && descriptor.byteLength > 0);
		assert.ok(Number.isSafeInteger(descriptor.fileCount) && descriptor.fileCount > 0);
		assert.match(descriptor.sha256, /^[a-f\d]{64}$/u);
	}

	const firstManifest = await readFile(join(fixture.outputRoot, 'stage-manifest.json'), 'utf8');
	await stageDesktopNightlyTests({
		repositoryRoot: fixture.repositoryRoot,
		outputRoot: fixture.outputRoot,
		browserSourceRoot: fixture.browserSourceRoot,
		sourceRevision: 'a'.repeat(40),
		target: { platform: 'linux', arch: 'x64' },
	});
	assert.equal(await readFile(join(fixture.outputRoot, 'stage-manifest.json'), 'utf8'), firstManifest);
});

test('nightly test preparation creates the clean-checkout desktop icon and default payload', async (context) => {
	const fixture = await createFixture(context);
	const result = await prepareDesktopNightlyTests({
		repositoryRoot: fixture.repositoryRoot,
		sourceRevision: 'b'.repeat(40),
		target: { platform: 'mac', arch: 'arm64' },
	});
	assert.equal(result.outputRoot, join(fixture.repositoryRoot, '.desktop-build/nightly-tests'));
	const icon = await readFile(join(fixture.repositoryRoot, '.desktop-build/icons/icon.png'));
	assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('nightly test staging rejects missing inputs before replacing an existing payload', async (context) => {
	const fixture = await createFixture(context);
	await mkdir(fixture.outputRoot, { recursive: true });
	await writeFile(join(fixture.outputRoot, 'keep.txt'), 'existing payload\n');
	await rm(join(fixture.repositoryRoot, 'playwright.nightly-tests.config.mjs'));

	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/required nightly test Playwright config.*missing/iu,
	);
	assert.equal(await readFile(join(fixture.outputRoot, 'keep.txt'), 'utf8'), 'existing payload\n');
});

test('nightly test staging requires the dedicated WinLDD MIT notice before replacing a payload', async (context) => {
	const fixture = await createFixture(context);
	await mkdir(fixture.outputRoot, { recursive: true });
	await writeFile(join(fixture.outputRoot, 'keep.txt'), 'existing payload\n');
	await rm(join(fixture.repositoryRoot, 'LICENSES/Playwright-winldd-MIT.txt'));

	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/required Playwright WinLDD MIT notice.*missing/iu,
	);
	assert.equal(await readFile(join(fixture.outputRoot, 'keep.txt'), 'utf8'), 'existing payload\n');
});

test('nightly test staging admits exactly one esbuild binary package for the target', async (context) => {
	const fixture = await createFixture(context);
	const scopeRoot = join(fixture.repositoryRoot, 'node_modules/@esbuild');

	// Two installed binary packages leave the payload unable to say which binary
	// its target runs, and none leaves the bundling specs without a compiler.
	await writeFixturePackage(fixture.repositoryRoot, '@esbuild/win32-arm64', {});
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/exactly one @esbuild binary package.*found 2.*linux-x64, win32-arm64/isu,
	);

	await rm(scopeRoot, { recursive: true });
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/installed esbuild binary package scope is missing/iu,
	);
});
