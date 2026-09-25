/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { FuseV1Options } from '@electron/fuses';

import hardenNightlyTestsElectron from '../scripts/desktop-nightly-tests-after-pack.mjs';
import { selectDesktopNightlyTestTargets } from '../scripts/lib/desktop-nightly-tests-target-matrix.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('nightly-with-tests packaging is isolated, portable, and keeps its payload outside ASAR', () => {
	const configPath = resolve(ROOT, 'electron-builder.nightly-tests.config.cjs');
	delete require.cache[configPath];
	const config = require(configPath);

	assert.equal(config.appId, 'org.soundscaper.desktop.nightly-tests');
	assert.equal(config.productName, 'Soundscaper Nightly Tests');
	assert.equal(config.directories.app, '.desktop-build/nightly-tests');
	assert.equal(config.directories.output, 'release/desktop-nightly-tests');
	assert.equal(config.compression, 'normal');
	assert.equal(config.asar, true);
	assert.equal(config.afterPack, './scripts/desktop-nightly-tests-after-pack.mjs');
	assert.deepEqual(config.win.target, ['portable']);
	assert.equal(config.portable.splashImage, '.desktop-build/icons/nightly-tests-splash.bmp');
	assert.equal(config.portable.useZip, true);
	assert.equal(config.portable.unpackDirName, false);
	assert.deepEqual(config.mac.target, ['zip']);
	assert.equal(config.mac.signIgnore, '/Contents/Resources/nightly-tests/products/');
	const macSignIgnore = new RegExp(config.mac.signIgnore, 'u');
	assert.equal(macSignIgnore.test(
		'/tmp/Soundscaper Nightly Tests.app/Contents/Resources/nightly-tests/products/'
		+ 'framescaper/mac-arm64/Framescaper.app/Contents/Resources/runtime/assistance/'
		+ 'kokoro-g2p/0.9.4/mac-arm64/_internal/Python.framework/Python',
	), true);
	assert.equal(macSignIgnore.test(
		'/tmp/Soundscaper Nightly Tests.app/Contents/Resources/nightly-tests/tests/example.js',
	), false);
	assert.deepEqual(config.linux.target, ['AppImage']);
	assert.equal(config.linux.executableName, 'soundscaper-nightly-tests');
	assert.match(config.artifactName, /nightly-with-tests/u);
	assert.equal(config.fileAssociations, undefined);
	assert.ok(config.files.includes('desktop/nightly-tests-main.mjs'));
	assert.ok(config.files.includes('desktop/nightly-tests-manifest.mjs'));
	assert.ok(config.files.includes('desktop/nightly-tests-progress-window.mjs'));
	assert.ok(config.files.includes('desktop/nightly-tests-progress.html'));
	assert.ok(config.files.includes('desktop/nightly-tests-progress-renderer.js'));
	assert.ok(config.files.includes('desktop/nightly-tests-progress.css'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-runtime.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-dual-origin.mjs'));
	assert.ok(config.files.includes('scripts/lib/pages-site-static-server.mjs'));
	assert.ok(config.files.includes('scripts/lib/product-web-routing.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-static-response.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-product-sites.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-static-route.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-metrics.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-packaged-coverage.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-packaged-product-executable.mjs'));
	assert.ok(config.files.includes('scripts/collect-m4-production-parity-quality.mjs'));
	assert.ok(config.files.includes('scripts/collect-m3-longform-editorial-quality.mjs'));
	assert.ok(config.files.includes('!node_modules/**/*'));
	const payload = config.extraResources.find(({ to }) => to === 'nightly-tests');
	assert.ok(payload);
	assert.ok(payload.filter.includes('package.json'));
	assert.ok(payload.filter.includes('config/**/*'));
	assert.ok(payload.filter.includes('sites/**/*'));
	assert.equal(payload.filter.includes('dist/**/*'), false);
	assert.ok(payload.filter.includes('playwright.nightly-metrics.config.mjs'));
	assert.ok(payload.filter.includes('playwright.nightly-dual-origin.config.mjs'));
	assert.ok(payload.filter.includes('playwright.nightly-packaged-coverage.config.mjs'));
	assert.ok(payload.filter.includes('playwright.nightly-tests.config.mjs'));
	assert.ok(payload.filter.includes('desktop/soak-debug-*.mjs'));
	assert.ok(payload.filter.includes('scripts/*.mjs'));
	assert.ok(payload.filter.includes('scripts/lib/**/*'));
	assert.equal(payload.filter.includes('playwright.config.mjs'), false);
	assert.equal(payload.filter.includes('node_modules/**/*'), false);
	assert.deepEqual(
		config.extraResources.find(({ to }) => to === 'nightly-tests/node_modules'),
		{
			from: '.desktop-build/nightly-tests/node_modules',
			to: 'nightly-tests/node_modules',
		},
	);
	assert.deepEqual(
		config.extraResources.find(({ to }) => to === 'nightly-tests/products'),
		{
			from: 'release/desktop-nightly-products',
			to: 'nightly-tests/products',
		},
	);
	assert.equal(config.extraResources.some(({ to }) => to === 'renderer' || to === 'runtime'), false);
});

test('the Windows ARM64 portable package uses an embedded archive until direct-directory NSIS supports it', () => {
	const configPath = resolve(ROOT, 'electron-builder.nightly-tests.config.cjs');
	const originalArch = process.env.SOUNDSCAPER_NIGHTLY_TESTS_PACKAGE_ARCH;
	try {
		for (const [arch, useZip] of [['x64', true], ['arm64', false]]) {
			process.env.SOUNDSCAPER_NIGHTLY_TESTS_PACKAGE_ARCH = arch;
			delete require.cache[configPath];
			assert.equal(require(configPath).portable.useZip, useZip, arch);
		}
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_PACKAGE_ARCH = 'ia32';
		delete require.cache[configPath];
		assert.throws(() => require(configPath), /SOUNDSCAPER_NIGHTLY_TESTS_PACKAGE_ARCH must be x64 or arm64/u);
	} finally {
		if (originalArch === undefined) delete process.env.SOUNDSCAPER_NIGHTLY_TESTS_PACKAGE_ARCH;
		else process.env.SOUNDSCAPER_NIGHTLY_TESTS_PACKAGE_ARCH = originalArch;
		delete require.cache[configPath];
	}
});

test('generated nightly-with-tests packages stay outside version control', async () => {
	const ignore = await readFile(resolve(ROOT, '.gitignore'), 'utf8');
	assert.match(ignore, /^release\/\*$/mu);
});

test('nightly-with-tests enables RunAsNode without weakening the other desktop fuses', async () => {
	const calls = [];
	await hardenNightlyTestsElectron(packagingContext('/tmp/nightly-tests-package'), {
		flipFuses: async (...args) => { calls.push(args); },
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0][0], join('/tmp/nightly-tests-package', 'soundscaper-nightly-tests'));
	const options = calls[0][1];
	assert.equal(options.strictlyRequireAllFuses, true);
	assert.equal(options[FuseV1Options.RunAsNode], true);
	assert.equal(options[FuseV1Options.EnableNodeOptionsEnvironmentVariable], false);
	assert.equal(options[FuseV1Options.EnableNodeCliInspectArguments], false);
	assert.equal(options[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], true);
	assert.equal(options[FuseV1Options.OnlyLoadAppFromAsar], true);
	assert.equal(options[FuseV1Options.GrantFileProtocolExtraPrivileges], false);
});

test('the production package keeps RunAsNode disabled and excludes the nightly payload', async () => {
	const [configSource, fuseSource, mainSource] = await Promise.all([
		readFile(resolve(ROOT, 'electron-builder.config.cjs'), 'utf8'),
		readFile(resolve(ROOT, 'scripts/desktop-after-pack.mjs'), 'utf8'),
		readFile(resolve(ROOT, 'desktop/main.mjs'), 'utf8'),
	]);

	assert.match(fuseSource, /\[FuseV1Options\.RunAsNode\]: false/u);
	assert.doesNotMatch(configSource, /nightly-tests|nightly-with-tests/u);
	assert.match(mainSource, /app\.commandLine\.appendSwitch\('enable-gpu'\)/u);
	assert.ok(
		mainSource.indexOf("app.commandLine.appendSwitch('enable-gpu')") < mainSource.indexOf('app.whenReady()'),
		'Electron must select the hardware GPU before the application becomes ready.',
	);
});

test('the nightly test launcher delegates to the pure runtime and never opens an editor window', async () => {
	const source = await readFile(resolve(ROOT, 'desktop/nightly-tests-main.mjs'), 'utf8');
	const schemeRegistration = source.indexOf('\telectron.protocol.registerSchemesAsPrivileged(');
	const assistanceStart = source.indexOf("\tvoid import('./nightly-tests-assistance-host.mjs')");
	const progressScheme = source.indexOf("scheme: 'soundscaper-nightly-progress'");
	const runnerStart = source.indexOf('\tvoid startNightlyTests();');
	const readyWait = source.indexOf('\tawait app.whenReady();');

	assert.match(source, /runDesktopNightlyTests/u);
	assert.match(source, /readDesktopNightlyTestsSourceRevision/u);
	assert.match(source, /scripts\/lib\/desktop-nightly-tests-runtime\.mjs/u);
	assert.match(source, /await app\.whenReady\(\)/u);
	assert.ok(schemeRegistration >= 0 && schemeRegistration < assistanceStart,
		'the privileged assistance scheme must be registered before its host starts');
	assert.ok(schemeRegistration < readyWait,
		'the privileged assistance scheme must be registered before Electron can become ready');
	assert.ok(progressScheme >= 0 && progressScheme < runnerStart && runnerStart < readyWait,
		'the progress scheme must be registered synchronously before the runner starts');
	assert.match(source, /process\.resourcesPath/u);
	assert.match(source, /sourceRevision/u);
	assert.match(source, /app\.exit/u);
	assert.match(source, /createDesktopNightlyTestsProgressWindow/u);
	assert.doesNotMatch(source, /desktop\/main\.mjs|createMainWindow/u);
});

test('manual nightly-with-tests target selection preserves all targets and selects Windows subsets', () => {
	const all = selectDesktopNightlyTestTargets('all');
	assert.deepEqual(all, [
		{ runner: 'windows-2025', platform: 'win', arch: 'x64', node_arch: 'x64' },
		{ runner: 'windows-11-arm', platform: 'win', arch: 'arm64', node_arch: 'x64' },
		{ runner: 'macos-15', platform: 'mac', arch: 'arm64', node_arch: 'arm64' },
		{ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64', node_arch: 'x64' },
		{ runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64', node_arch: 'arm64' },
	]);
	assert.deepEqual(selectDesktopNightlyTestTargets('windows'), all.slice(0, 2));
	assert.deepEqual(selectDesktopNightlyTestTargets('win-x64'), all.slice(0, 1));
	assert.throws(() => selectDesktopNightlyTestTargets(''), /target selection/u);
	assert.throws(() => selectDesktopNightlyTestTargets('linux'), /target selection/u);
});

test('desktop test artifacts build on main pushes and manual target selections without running CI tests', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-nightly-tests.yml'), 'utf8');
	assert.match(workflow, /^ {2}push:\s+branches:\s+- main$/mu);
	assert.match(workflow, /workflow_dispatch:\s+inputs:\s+nightly_tests_targets:/u);
	assert.match(workflow, /nightly_tests_targets:[\s\S]*?default: all[\s\S]*?type: choice\s+options:\s+- all\s+- windows\s+- win-x64/u);
	assert.doesNotMatch(workflow, /workflow_run:/u);
	assert.doesNotMatch(workflow, /schedule:\s+(?:#.*\n\s+)*- cron:|push:\s+tags:/u);
	assert.doesNotMatch(workflow, /artifact_variant:/u);
	for (const shared of ['quality', 'tests', 'coverage', 'browser', 'firefox']) {
		assert.doesNotMatch(workflow, new RegExp(`^  ${shared}:`, 'mu'), `${shared} must not run before packaging`);
	}
	assert.doesNotMatch(workflow, /\b(?:npm run (?:check:static|test:|coverage:)|node --import tsx[^\n]* --test|npx playwright test|xvfb-run)\b/u);
	const targetsStart = workflow.indexOf('\n  nightly-test-targets:');
	const targetsEnd = workflow.indexOf('\n  package-with-tests:', targetsStart);
	assert.ok(targetsStart >= 0 && targetsEnd > targetsStart);
	const targetsJob = workflow.slice(targetsStart, targetsEnd);
	assert.match(targetsJob, /if: github\.ref == 'refs\/heads\/main'/u);
	assert.match(targetsJob, /ref: \$\{\{ github\.sha \}\}/u);
	assert.match(targetsJob, /targets: \$\{\{ steps\.resolve\.outputs\.targets \}\}/u);
	assert.match(workflow, /NIGHTLY_TEST_TARGETS: \$\{\{ inputs\.nightly_tests_targets \|\| 'all' \}\}/u);
	assert.match(workflow, /selectDesktopNightlyTestTargets\(process\.env\.NIGHTLY_TEST_TARGETS\)/u);

	const publisherStart = workflow.indexOf('\n  verify-assistance-runtime-handoff:');
	const testStart = workflow.indexOf('\n  package-with-tests:');
	assert.ok(publisherStart > 0 && testStart > publisherStart);
	const publisherJob = workflow.slice(publisherStart, testStart);
	const testJob = workflow.slice(testStart);
	const publisherGuard = publisherJob.slice(publisherJob.indexOf('if: >-'),
		publisherJob.indexOf('\n    needs:'));

	const testGuard = testJob.slice(testJob.indexOf('if: >-'), testJob.indexOf('\n    needs:'));
	assert.ok(testGuard.startsWith('if: >-'));
	assert.doesNotMatch(testGuard, /github\.event_name|workflow_run/u);
	assert.doesNotMatch(testGuard, /inputs\.artifact_variant/u);
	assert.match(testJob, /needs: \[nightly-test-targets, verify-assistance-runtime-handoff\]/u);
	assert.match(testGuard, /needs\.nightly-test-targets\.result == 'success'/u);
	assert.match(testGuard, /needs\.verify-assistance-runtime-handoff\.result == 'success'/u);
	// The package and both source manifests must name the selected commit.
	const sourceRevision = String.raw`\$\{\{ github\.sha \}\}`;
	assert.match(publisherJob, /needs: nightly-test-targets/u);
	assert.match(publisherGuard, /needs\.nightly-test-targets\.result == 'success'/u);
	const publicationStart = publisherJob.indexOf('- name: Publish and verify the immutable archives');
	const handoffStart = publisherJob.indexOf('- name: Export the source-bound AI runtime handoff');
	assert.ok(publisherJob.indexOf('node scripts/desktop-prepare.mjs') < publicationStart
		&& publicationStart < handoffStart);
	const publicationStep = publisherJob.slice(publicationStart, handoffStart);
	assert.match(publicationStep, /npm run desktop:publish:assistance-runtimes/u);
	assert.match(publicationStep, /R2_MODELS_ACCESS_KEY_ID: \$\{\{ secrets\.R2_MODELS_ACCESS_KEY_ID \}\}/u);
	assert.match(publicationStep, /R2_MODELS_SECRET_ACCESS_KEY: \$\{\{ secrets\.R2_MODELS_SECRET_ACCESS_KEY \}\}/u);
	assert.match(publicationStep, /R2_MODELS_ENDPOINT: \$\{\{ vars\.R2_MODELS_ENDPOINT \|\| secrets\.R2_MODELS_ENDPOINT \}\}/u);
	assert.doesNotMatch(publisherJob.slice(0, publicationStart) + publisherJob.slice(handoffStart), /R2_MODELS_/u);
	assert.match(publisherJob, new RegExp(`ref: ${sourceRevision}`, 'u'));
	assert.match(publisherJob, new RegExp(`SOUNDSCAPER_SOURCE_REVISION: ${sourceRevision}`, 'u'));
	assert.match(publisherJob, /node scripts\/export-assistance-runtime-handoff\.mjs/u);
	assert.match(publisherJob, /name: assistance-runtime-handoff-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(publisherJob, /include-hidden-files: true/u);
	assert.match(testJob, new RegExp(`ref: ${sourceRevision}`, 'u'));
	assert.match(testJob, new RegExp(
		String.raw`- name: Package the product runtimes exercised by nightly-with-tests\s+run: node scripts/desktop-nightly-tests-products\.mjs`
		+ String.raw`\s+env:\s+SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: \$\{\{ matrix\.target\.platform \}\}`
		+ String.raw`\s+SOUNDSCAPER_DESKTOP_TARGET_ARCH: \$\{\{ matrix\.target\.arch \}\}`
		+ String.raw`\s+SOUNDSCAPER_SOURCE_REVISION: ` + sourceRevision,
		'u',
	), 'the exercised product manifests must name the same revision that the job checked out');
	assert.match(testJob, new RegExp(
		String.raw`- name: Stage the nightly-with-tests application\s+run: node scripts/desktop-nightly-tests-prepare\.mjs`
		+ String.raw`\s+env:[\s\S]*?SOUNDSCAPER_SOURCE_REVISION: ` + sourceRevision,
		'u',
	), 'the staged manifest must name the same revision that the job checked out');
	assert.doesNotMatch(testJob, /matrix\.product|product: \[/u);
	assert.match(testJob, /target: \$\{\{ fromJSON\(needs\.nightly-test-targets\.outputs\.targets\) \}\}/u);
	assert.doesNotMatch(testJob, /SOUNDSCAPER_PUBLISH_ASSISTANCE_RUNTIMES|R2_MODELS_ACCESS_KEY_ID/u);
	assert.match(testJob, /SOUNDSCAPER_VERIFY_ASSISTANCE_RUNTIMES: 'true'/u);
	assert.match(testJob, /Download the published target-native AI runtime handoff/u);
	assert.match(testJob, /SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT: \$\{\{ github\.workspace \}\}\/\.native-build\/assistance-runtime-handoff/u);
	assert.doesNotMatch(testJob, /- runner:/u);
	assert.match(testJob, /node scripts\/desktop-nightly-tests-prepare\.mjs/u);
	assert.match(testJob, /node scripts\/desktop-nightly-tests-products\.mjs/u);
	assert.match(testJob, /npm run build:browser:framescaper/u);
	assert.match(testJob, /npm run prepare:browser:products/u);
	assert.match(testJob, /npm run pretest:browser:dual-origin/u);
	assert.ok(
		testJob.indexOf('npm run build:browser:framescaper')
			< testJob.indexOf('npm run prepare:browser:products')
			&& testJob.indexOf('npm run prepare:browser:products')
				< testJob.indexOf('npm run pretest:browser:dual-origin')
			&& testJob.indexOf('npm run pretest:browser:dual-origin')
				< testJob.indexOf('node scripts/desktop-nightly-tests-prepare.mjs'),
		'the ordinary and reciprocal verified sites must be ready before the test runner stages them',
	);
	assert.ok(
		testJob.indexOf('node scripts/desktop-nightly-tests-products.mjs')
			< testJob.indexOf('node scripts/desktop-nightly-tests-prepare.mjs'),
		'product runtimes must be packaged before the test runner stages them',
	);
	assert.doesNotMatch(testJob, /Run packaged Soundscaper audio-device browser gate|packaged-audio-device-browser-diagnostics/u);
	assert.match(testJob, /npx playwright install --no-shell chromium firefox webkit/u);
	assert.doesNotMatch(testJob, /playwright install --only-shell/u);
	assert.doesNotMatch(testJob, /qualification|admission|readiness signature/iu);
	assert.match(
		testJob,
		/ci-electron-builder\.sh[\s\\]*--config electron-builder\.nightly-tests\.config\.cjs/u,
	);
	assert.match(testJob, /SOUNDSCAPER_NIGHTLY_TESTS_PACKAGE_ARCH: \$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(testJob, /name: nightly-with-tests-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(testJob, /release\/desktop-nightly-tests\/\*\.AppImage/u);
	assert.match(testJob, /release\/desktop-nightly-tests\/\*\.exe/u);
	assert.match(testJob, /release\/desktop-nightly-tests\/\*\.zip/u);
	assert.match(testJob, /compression-level: 0/u);
	assert.doesNotMatch(workflow, /^ {2}project-library-handoff:/mu);
});

test('AI asset updates publish verified target archives only from manual main dispatch', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/update-ai-assets.yml'), 'utf8');
	assert.match(workflow, /^name: Update AI assets$/mu);
	assert.match(workflow, /^ {2}workflow_dispatch:$/mu);
	assert.doesNotMatch(workflow, /^ {2}(?:push|schedule|workflow_run):$/mu);
	assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
	assert.match(workflow, /selectDesktopNightlyTestTargets\(process\.env\.AI_ASSET_TARGETS\)/u);
	assert.match(workflow, /target: \$\{\{ fromJSON\(needs\.asset-targets\.outputs\.targets\) \}\}/u);
	assert.match(workflow, /node scripts\/desktop-prepare\.mjs/u);
	assert.match(workflow, /npm run desktop:publish:assistance-runtimes/u);
	assert.match(workflow, /R2_MODELS_ACCESS_KEY_ID: \$\{\{ secrets\.R2_MODELS_ACCESS_KEY_ID \}\}/u);
	assert.match(workflow, /R2_MODELS_SECRET_ACCESS_KEY: \$\{\{ secrets\.R2_MODELS_SECRET_ACCESS_KEY \}\}/u);
});

function packagingContext(appOutDir) {
	return {
		electronPlatformName: 'linux',
		appOutDir,
		packager: {
			executableName: 'soundscaper-nightly-tests',
			appInfo: { productFilename: 'Soundscaper Nightly Tests' },
		},
	};
}
