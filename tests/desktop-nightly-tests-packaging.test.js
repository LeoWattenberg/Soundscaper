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
	assert.ok(config.files.includes('scripts/lib/desktop-nightly-tests-static-route.mjs'));
	assert.ok(config.files.includes('!node_modules/**/*'));
	const payload = config.extraResources.find(({ to }) => to === 'nightly-tests');
	assert.ok(payload);
	assert.ok(payload.filter.includes('package.json'));
	assert.ok(payload.filter.includes('playwright.nightly-tests.config.mjs'));
	assert.equal(payload.filter.includes('playwright.config.mjs'), false);
	assert.equal(payload.filter.includes('node_modules/**/*'), false);
	assert.deepEqual(
		config.extraResources.find(({ to }) => to === 'nightly-tests/node_modules'),
		{
			from: '.desktop-build/nightly-tests/node_modules',
			to: 'nightly-tests/node_modules',
		},
	);
	assert.equal(config.extraResources.some(({ to }) => to === 'renderer' || to === 'runtime'), false);
});

test('generated nightly-with-tests packages stay outside version control', async () => {
	const ignore = await readFile(resolve(ROOT, '.gitignore'), 'utf8');
	assert.match(ignore, /^release\/desktop-nightly-tests\/$/mu);
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
	const [configSource, fuseSource] = await Promise.all([
		readFile(resolve(ROOT, 'electron-builder.config.cjs'), 'utf8'),
		readFile(resolve(ROOT, 'scripts/desktop-after-pack.mjs'), 'utf8'),
	]);

	assert.match(fuseSource, /\[FuseV1Options\.RunAsNode\]: false/u);
	assert.doesNotMatch(configSource, /nightly-tests|nightly-with-tests/u);
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

test('desktop CI exposes one opt-in six-target nightly-with-tests artifact matrix', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	assert.match(workflow, /workflow_dispatch:\s+inputs:\s+artifact_variant:/u);
	assert.match(workflow, /artifact_variant:[\s\S]*type: choice[\s\S]*options:\s+- nightly\s+- nightly-with-tests/u);

	const normalStart = workflow.indexOf('\n  package:');
	const testStart = workflow.indexOf('\n  package-with-tests:');
	const nextStart = workflow.indexOf('\n  project-library-handoff:', testStart);
	assert.ok(normalStart >= 0 && testStart > normalStart && nextStart > testStart);
	const normalJob = workflow.slice(normalStart, testStart);
	const testJob = workflow.slice(testStart, nextStart);

	assert.match(normalJob, /if: github\.event_name != 'workflow_dispatch' \|\| inputs\.artifact_variant == 'nightly'/u);
	assert.match(testJob, /if: github\.event_name == 'workflow_dispatch' && inputs\.artifact_variant == 'nightly-with-tests'/u);
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
	assert.match(testJob, /electron-builder --config electron-builder\.nightly-tests\.config\.cjs/u);
	assert.match(testJob, /name: nightly-with-tests-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(testJob, /release\/desktop-nightly-tests\/\*\.AppImage/u);
	assert.match(testJob, /release\/desktop-nightly-tests\/\*\.exe/u);
	assert.match(testJob, /release\/desktop-nightly-tests\/\*\.zip/u);
	assert.match(testJob, /compression-level: 0/u);
	const handoffJob = workflow.slice(nextStart);
	assert.match(handoffJob, /project-library-handoff:\s+name: Packaged project-library handoff[^\n]*\s+if: github\.event_name != 'workflow_dispatch' \|\| inputs\.artifact_variant == 'nightly'/u);
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
