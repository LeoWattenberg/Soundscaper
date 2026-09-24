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

test('manual nightly-with-tests target selection preserves all targets and selects both Windows targets', () => {
	const all = selectDesktopNightlyTestTargets('all');
	assert.deepEqual(all, [
		{ runner: 'windows-2025', platform: 'win', arch: 'x64', node_arch: 'x64' },
		{ runner: 'windows-11-arm', platform: 'win', arch: 'arm64', node_arch: 'x64' },
		{ runner: 'macos-15', platform: 'mac', arch: 'arm64', node_arch: 'arm64' },
		{ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64', node_arch: 'x64' },
		{ runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64', node_arch: 'arm64' },
	]);
	assert.deepEqual(selectDesktopNightlyTestTargets('windows'), all.slice(0, 2));
	assert.throws(() => selectDesktopNightlyTestTargets(''), /target selection/u);
	assert.throws(() => selectDesktopNightlyTestTargets('linux'), /target selection/u);
});

test('desktop CI exposes one quality-gated selectable nightly-with-tests artifact matrix', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	assert.match(workflow, /workflow_dispatch:\s+inputs:\s+artifact_variant:/u);
	assert.match(workflow, /nightly_tests_targets:[\s\S]*?default: all[\s\S]*?type: choice\s+options:\s+- all\s+- windows/u);
	// Main pushes use Quality without starting a second native package build.
	// The tested package runs only when the owner dispatches that variant.
	assert.doesNotMatch(workflow, /workflow_run/u);
	assert.match(workflow, /schedule:\s+(?:#.*\n\s+)*- cron:/u);
	assert.match(workflow, /push:\s+tags:/u);
	assert.doesNotMatch(workflow, /push:\s+branches:/u);
	assert.match(workflow, /artifact_variant:[\s\S]*type: choice[\s\S]*options:\s+- nightly\s+- nightly-with-tests/u);
	assert.match(workflow, /nightly-tests-targets: \$\{\{ steps\.nightly-test-targets\.outputs\.targets \}\}/u);
	assert.match(workflow, /NIGHTLY_TEST_TARGETS: \$\{\{ inputs\.nightly_tests_targets \|\| 'all' \}\}/u);
	assert.match(workflow, /selectDesktopNightlyTestTargets\(process\.env\.NIGHTLY_TEST_TARGETS\)/u);

	const normalStart = workflow.indexOf('\n  package:');
	const testStart = workflow.indexOf('\n  package-with-tests:');
	const nextStart = workflow.indexOf('\n  soundscaper-project-library-lease-matrix:', testStart);
	assert.ok(normalStart >= 0 && testStart > normalStart && nextStart > testStart);
	const normalJob = workflow.slice(normalStart, testStart);
	const testJob = workflow.slice(testStart, nextStart);

	// The ordinary package stays on tags, schedules and explicit nightly dispatch.
	assert.match(normalJob, new RegExp(
		String.raw`if: >-\s+\(github\.event_name == 'push' && github\.ref_type == 'tag'\)`
		+ String.raw`\s+\|\| github\.event_name == 'schedule'`
		+ String.raw`\s+\|\| \(github\.event_name == 'workflow_dispatch' && inputs\.artifact_variant == 'nightly'\)`,
		'u',
	));
	// The manually selected variant runs only after its own quality gates pass.
	const testGuard = testJob.slice(testJob.indexOf('if: >-'), testJob.indexOf('\n    needs:'));
	assert.ok(testGuard.startsWith('if: >-'));
	assert.match(testGuard, /github\.event_name == 'workflow_dispatch'/u);
	assert.match(testGuard, /inputs\.artifact_variant == 'nightly-with-tests'/u);
	assert.doesNotMatch(testGuard, /github\.event_name == '(?:schedule|push)'/u);
	assert.match(testJob, /needs: \[quality, tests, coverage, browser, firefox\]/u);
	for (const gate of ['quality', 'tests', 'coverage', 'browser', 'firefox']) {
		assert.match(testGuard, new RegExp(`needs\\.${gate}\\.result == 'success'`, 'u'));
	}
	// The package and both source manifests must name this manual run's commit.
	assert.match(testJob, /ref: \$\{\{ github\.sha \}\}/u);
	assert.match(testJob, new RegExp(
		String.raw`- name: Package the product runtimes exercised by nightly-with-tests\s+run: node scripts/desktop-nightly-tests-products\.mjs`
		+ String.raw`\s+env:\s+SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: \$\{\{ matrix\.target\.platform \}\}`
		+ String.raw`\s+SOUNDSCAPER_DESKTOP_TARGET_ARCH: \$\{\{ matrix\.target\.arch \}\}`
		+ String.raw`\s+SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}`,
		'u',
	), 'the exercised product manifests must name the same revision that the job checked out');
	assert.match(testJob, new RegExp(
		String.raw`- name: Stage the nightly-with-tests application\s+run: node scripts/desktop-nightly-tests-prepare\.mjs`
		+ String.raw`\s+env:[\s\S]*?SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}`,
		'u',
	), 'the staged manifest must name the same revision that the job checked out');
	assert.doesNotMatch(testJob, /matrix\.product|product: \[/u);
	assert.match(testJob, /target: \$\{\{ fromJSON\(needs\.quality\.outputs\.nightly-tests-targets\) \}\}/u);
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
	const audioGateStart = testJob.indexOf('\n      - name: Run packaged Soundscaper audio-device browser gate');
	const audioGateEnd = testJob.indexOf('\n      - name:', audioGateStart + 1);
	assert.ok(audioGateStart >= 0 && audioGateEnd > audioGateStart, 'the packaged audio-device gate is missing');
	const audioGate = testJob.slice(audioGateStart, audioGateEnd);
	assert.ok(
		testJob.indexOf('sudo chmod 4755 -- "${sandboxes[@]}"') < audioGateStart
			&& audioGateStart < testJob.indexOf('node scripts/desktop-nightly-tests-prepare.mjs'),
		'the audio-device gate must exercise the sandboxed packaged product before staging the test-runner package',
	);
	assert.match(
		testJob,
		/- name: Install virtual display for packaged audio-device browser gate\s+if: matrix\.target\.platform == 'linux' && matrix\.target\.arch == 'x64'[\s\S]*?ci-apt-install\.sh xvfb/u,
	);
	assert.match(audioGate, /if: matrix\.target\.platform == 'linux' && matrix\.target\.arch == 'x64'/u);
	assert.match(audioGate, /timeout-minutes: 10/u);
	assert.match(audioGate, /xvfb-run --auto-servernum npx playwright test/u);
	assert.match(audioGate, /vite\.js preview \\\s+--outDir \.wrangler\/browser-products\/soundscaper[\s\S]*?--port 4322/u);
	assert.match(audioGate, /vite\.js preview \\\s+--outDir \.wrangler\/browser-products\/framescaper[\s\S]*?--port 4323/u);
	assert.match(audioGate, /tests\/browser\/desktop-packaged-audio-io\.spec\.js/u);
	assert.doesNotMatch(audioGate, /desktop-packaged-display-audio/u);
	assert.match(audioGate, /--config playwright\.nightly-packaged-metrics\.config\.mjs/u);
	assert.match(audioGate, /--project packaged-soundscaper-audio-devices/u);
	assert.match(audioGate, /SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: \$\{\{ github\.workspace \}\}/u);
	assert.match(audioGate, /SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: \$\{\{ runner\.temp \}\}\/packaged-audio-device-e2e/u);
	assert.match(audioGate, /SOUNDSCAPER_PACKAGED_PRODUCT_ROOT: \$\{\{ github\.workspace \}\}\/release\/desktop-nightly-products/u);
	assert.match(audioGate, /SOUNDSCAPER_PACKAGED_RUNTIME_METRICS: '1'/u);
	assert.match(audioGate, /SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM: linux/u);
	assert.match(audioGate, /SOUNDSCAPER_PACKAGED_RUNTIME_ARCH: x64/u);
	assert.match(audioGate, /SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: >-/u);
	assert.match(
		testJob,
		/- name: Upload packaged audio-device browser diagnostics\s+if: always\(\) && matrix\.target\.platform == 'linux' && matrix\.target\.arch == 'x64'[\s\S]*?packaged-audio-device-e2e\/packaged-runtime\/[\s\S]*?if-no-files-found: ignore/u,
	);
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
	assert.match(
		workflow.slice(nextStart),
		/soundscaper-project-library-lease-matrix:\s+name: Soundscaper v1 \+ Framescaper v1 packaged lease matrix/iu,
	);
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
