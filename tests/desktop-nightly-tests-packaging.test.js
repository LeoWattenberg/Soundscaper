/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { FuseV1Options } from '@electron/fuses';

import hardenNightlyTestsElectron from '../scripts/desktop-nightly-tests-after-pack.mjs';

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
	assert.deepEqual(config.mac.target, ['zip']);
	assert.deepEqual(config.linux.target, ['AppImage']);
	assert.equal(config.linux.executableName, 'soundscaper-nightly-tests');
	assert.match(config.artifactName, /nightly-with-tests/u);
	assert.equal(config.fileAssociations, undefined);
	assert.ok(config.files.includes('desktop/nightly-tests-main.mjs'));
	assert.ok(config.files.includes('desktop/nightly-tests-manifest.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-runtime.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-static-response.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-product-sites.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-static-route.mjs'));
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-metrics.mjs'));
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
	assert.ok(payload.filter.includes('playwright.nightly-tests.config.mjs'));
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

	assert.match(source, /runDesktopNightlyTests/u);
	assert.match(source, /readDesktopNightlyTestsSourceRevision/u);
	assert.match(source, /scripts\/lib\/desktop-nightly-tests-runtime\.mjs/u);
	assert.match(source, /await app\.whenReady\(\)/u);
	assert.match(source, /process\.resourcesPath/u);
	assert.match(source, /sourceRevision/u);
	assert.match(source, /app\.exit/u);
	assert.doesNotMatch(source, /BrowserWindow/u);
});

test('desktop CI exposes one quality-gated five-target nightly-with-tests artifact matrix', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	assert.match(workflow, /workflow_dispatch:\s+inputs:\s+artifact_variant:/u);
	// The tested package is built for every main commit, but off the Quality run
	// that already verified it so the shared jobs are never run twice.
	assert.match(workflow, /workflow_run:\s+workflows: \[Quality\]\s+types: \[completed\]\s+branches: \[main\]/u);
	assert.doesNotMatch(workflow, /push:\s+branches:/u);
	for (const shared of ['  quality:', '  browser:', '  firefox:']) {
		const at = workflow.indexOf(`\n${shared}`);
		assert.ok(at >= 0, `${shared} is missing`);
		assert.match(workflow.slice(at, at + 200), /if: github\.event_name != 'workflow_run'/u);
	}
	assert.match(workflow, /artifact_variant:[\s\S]*type: choice[\s\S]*options:\s+- nightly\s+- nightly-with-tests/u);

	const normalStart = workflow.indexOf('\n  package:');
	const testStart = workflow.indexOf('\n  package-with-tests:');
	const nextStart = workflow.indexOf('\n  soundscaper-project-library-lease-matrix:', testStart);
	assert.ok(normalStart >= 0 && testStart > normalStart && nextStart > testStart);
	const normalJob = workflow.slice(normalStart, testStart);
	const testJob = workflow.slice(testStart, nextStart);

	// The ordinary package stays on tags, schedules and an explicit nightly
	// dispatch; only the tested variant follows verified main commits.
	assert.match(normalJob, new RegExp(
		String.raw`if: >-\s+\(github\.event_name == 'push' && github\.ref_type == 'tag'\)`
		+ String.raw`\s+\|\| github\.event_name == 'schedule'`
		+ String.raw`\s+\|\| \(github\.event_name == 'workflow_dispatch' && inputs\.artifact_variant == 'nightly'\)`,
		'u',
	));
	// A red Quality run still packages: a failing suite is when a hand-testable
	// build is worth most. Cancelled and skipped runs are superseded source.
	assert.match(testJob, new RegExp(
		String.raw`if: >-\s+!cancelled\(\)`
		+ String.raw`\s+&& \(\s+\(\s+github\.event_name == 'workflow_run'`
		+ String.raw`\s+&& github\.event\.workflow_run\.conclusion != 'cancelled'`
		+ String.raw`\s+&& github\.event\.workflow_run\.conclusion != 'skipped'`,
		'u',
	));
	assert.doesNotMatch(testJob, /workflow_run\.conclusion == 'success'/u);
	// The packaged commit must be the verified one, not whatever main moved to.
	assert.match(testJob, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/u);
	assert.match(testJob, new RegExp(
		String.raw`- name: Stage the nightly-with-tests application\s+run: node scripts/desktop-nightly-tests-prepare\.mjs`
		+ String.raw`\s+env:[\s\S]*?SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}`,
		'u',
	), 'the staged manifest must name the same revision that the job checked out');
	assert.doesNotMatch(testJob, /matrix\.product|product: \[/u);
	assert.equal(testJob.match(/- runner:/gu)?.length, 5);
	for (const target of [
		['windows-2025', 'win', 'x64'],
		['windows-11-arm', 'win', 'arm64'],
		['macos-15', 'mac', 'arm64'],
		['ubuntu-22.04', 'linux', 'x64'],
		['ubuntu-24.04-arm', 'linux', 'arm64'],
	]) {
		assert.match(testJob, new RegExp(`runner: ${target[0]}\\s+platform: ${target[1]}\\s+arch: ${target[2]}`, 'u'));
	}
	assert.match(testJob, /node scripts\/desktop-nightly-tests-prepare\.mjs/u);
	assert.match(testJob, /node scripts\/desktop-nightly-tests-products\.mjs/u);
	assert.match(testJob, /npm run build:browser:framescaper/u);
	assert.match(testJob, /npm run prepare:browser:products/u);
	assert.ok(
		testJob.indexOf('npm run build:browser:framescaper')
			< testJob.indexOf('npm run prepare:browser:products')
			&& testJob.indexOf('npm run prepare:browser:products')
				< testJob.indexOf('node scripts/desktop-nightly-tests-prepare.mjs'),
		'the verified product sites must be ready before the test runner stages them',
	);
	assert.ok(
		testJob.indexOf('node scripts/desktop-nightly-tests-products.mjs')
			< testJob.indexOf('node scripts/desktop-nightly-tests-prepare.mjs'),
		'product runtimes must be packaged before the test runner stages them',
	);
	assert.match(testJob, /npx playwright install --no-shell chromium firefox webkit/u);
	assert.doesNotMatch(testJob, /playwright install --only-shell/u);
	assert.match(testJob, /Verify the nightly formal qualification contract[\s\S]*node --import tsx --test tests\/desktop-nightly-tests-qualification\.test\.ts/u);
	assert.match(testJob, /electron-builder --config electron-builder\.nightly-tests\.config\.cjs/u);
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
