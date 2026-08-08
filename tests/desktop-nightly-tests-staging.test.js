/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import test from 'node:test';

import { prepareDesktopNightlyTests } from '../scripts/desktop-nightly-tests-prepare.mjs';
import {
	NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS,
	stageDesktopNightlyTests,
} from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const EXPECTED_RUNTIME_PACKAGES = [
	'@axe-core/playwright',
	'@echogarden/pffft-wasm',
	'@ffmpeg/core',
	'@ffmpeg/ffmpeg',
	'@ffmpeg/types',
	'@noble/hashes',
	'@playwright/test',
	'@zip.js/zip.js',
	'axe-core',
	'fflate',
	'playwright',
	'playwright-core',
	'saxes',
	'sql.js',
	'xmlchars',
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
		'@noble/hashes',
		'@playwright/test',
		'@zip.js/zip.js',
		'fflate',
		'saxes',
		'sql.js',
	]);

	const packageMetadata = await readJson(join(fixture.outputRoot, 'package.json'));
	assert.deepEqual(packageMetadata, {
		name: 'soundscaper-nightly-tests',
		productName: 'Soundscaper Nightly Tests',
		desktopName: 'org.soundscaper.desktop.nightly-tests',
		version: '0.2.0-beta.1',
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
		'playwright.nightly-tests.config.mjs',
		'dist/en/index.html',
		'tests/browser/example.spec.js',
		'tests/browser/example.spec.js-snapshots/example-chromium-linux.png',
		'tests/aup3-fixture.js',
		'tests/fixtures/aup4-native-rich.js',
		'src/common/editor/example.ts',
		'.local-browsers/chromium_headless_shell-101/INSTALLATION_COMPLETE',
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
		'licenses/node_modules/axe-core/LICENSE-3RD-PARTY.txt',
	]) await access(join(fixture.outputRoot, relativePath));
	await assert.rejects(() => access(join(fixture.outputRoot, 'tests/browser/AGENTS.md')), /ENOENT/u);
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
	assert.equal(manifest.applicationVersion, '0.2.0-beta.1');
	assert.equal(manifest.sourceRevision, 'a'.repeat(40));
	assert.deepEqual(manifest.target, { platform: 'linux', arch: 'x64' });
	assert.deepEqual(manifest.browserRevisions, {
		chromiumHeadlessShell: '101',
		firefox: '102',
		webkit: '103',
		ffmpeg: '104',
		winldd: '105',
	});
	assert.deepEqual(manifest.runtimePackages.map(({ name }) => name), EXPECTED_RUNTIME_PACKAGES);
	assert.deepEqual(manifest.payload.map(({ path }) => path), [
		'.local-browsers',
		'dist',
		'licenses',
		'node_modules',
		'package.json',
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

test('nightly test staging rejects symlinked repository content and escaping browser links', async (context) => {
	const fixture = await createFixture(context);
	const outside = join(dirname(fixture.repositoryRoot), 'outside-index.html');
	await writeFile(outside, '<p>outside</p>');
	await rm(join(fixture.repositoryRoot, 'dist/en/index.html'));
	await symlink(outside, join(fixture.repositoryRoot, 'dist/en/index.html'));
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/(?:dist|production web build).*symbolic link/iu,
	);

	await rm(join(fixture.repositoryRoot, 'dist/en/index.html'));
	await writeFile(join(fixture.repositoryRoot, 'dist/en/index.html'), '<p>inside</p>');
	await symlink(outside, join(fixture.browserSourceRoot, 'firefox-102/escape'));
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/browser.*symbolic link.*(?:relative|leaves)/iu,
	);
});

test('nightly test staging admits only the exact optional registry-bound winldd tool', async (context) => {
	const fixture = await createFixture(context);
	await rm(join(fixture.browserSourceRoot, 'winldd-105'), { recursive: true });
	const withoutWinldd = await stageDesktopNightlyTests({
		repositoryRoot: fixture.repositoryRoot,
		outputRoot: fixture.outputRoot,
		browserSourceRoot: fixture.browserSourceRoot,
	});
	assert.equal(Object.hasOwn(withoutWinldd.manifest.browserRevisions, 'winldd'), false);

	await writeFixtureFile(fixture.browserSourceRoot, 'winldd-105/bin/winldd.exe', 'fixture');
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/installed winldd completion marker.*missing/iu,
	);
	await rm(join(fixture.browserSourceRoot, 'winldd-105'), { recursive: true });
	await writeFixtureFile(fixture.browserSourceRoot, 'winldd-999/INSTALLATION_COMPLETE', '');
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: fixture.outputRoot,
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/unexpected entries: winldd-999/iu,
	);
	assert.deepEqual(await readJson(join(fixture.outputRoot, 'stage-manifest.json')), withoutWinldd.manifest);
});

test('nightly test staging refuses destructive or self-referential paths', async (context) => {
	const fixture = await createFixture(context);
	for (const [outputRoot, browserSourceRoot] of [
		[parse(fixture.repositoryRoot).root, fixture.browserSourceRoot],
		[fixture.repositoryRoot, fixture.browserSourceRoot],
		[join(fixture.repositoryRoot, 'src'), fixture.browserSourceRoot],
		[join(fixture.repositoryRoot, '.desktop-build'), fixture.browserSourceRoot],
		[join(fixture.temporaryRoot, 'external-output'), fixture.browserSourceRoot],
		[fixture.browserSourceRoot, fixture.browserSourceRoot],
	]) {
		await assert.rejects(
			() => stageDesktopNightlyTests({
				repositoryRoot: fixture.repositoryRoot,
				outputRoot,
				browserSourceRoot,
			}),
			/output.*(?:repository|source|browser)/iu,
		);
	}
	const redirectedOutput = join(dirname(fixture.repositoryRoot), 'redirected-output');
	await mkdir(redirectedOutput);
	await symlink(redirectedOutput, join(fixture.repositoryRoot, '.desktop-build'));
	await assert.rejects(
		() => stageDesktopNightlyTests({
			repositoryRoot: fixture.repositoryRoot,
			outputRoot: join(fixture.repositoryRoot, '.desktop-build/nightly-tests'),
			browserSourceRoot: fixture.browserSourceRoot,
		}),
		/output.*symbolic link/iu,
	);
});

async function createFixture(context) {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-stage-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const repositoryRoot = join(temporaryRoot, 'repository');
	const outputRoot = join(repositoryRoot, '.desktop-build/nightly-tests');
	await writeFixtureFile(repositoryRoot, 'package.json', `${JSON.stringify({
		name: 'soundscaper',
		version: '0.2.0-beta.1',
	})}\n`);
	for (const [path, body] of [
		['LICENSE', 'AGPL fixture\n'],
		['THIRD_PARTY_LICENSES.md', '# Fixture notices\n'],
		['LICENSES/GPL-3.0.txt', 'GPL fixture\n'],
		['LICENSES/Playwright-winldd-MIT.txt', 'WinLDD MIT fixture\n'],
		['public/logo/logo-klein-schwarz.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4" viewBox="0 0 8 4"><path d="M0 0h8v4H0z"/></svg>\n'],
		['playwright.nightly-tests.config.mjs', 'export default {};\n'],
		['desktop/nightly-tests-main.mjs', 'export const launcher = true;\n'],
		['desktop/nightly-tests-manifest.mjs', 'export const manifest = true;\n'],
		['scripts/lib/desktop-nightly-tests-runtime.mjs', 'export const runtime = true;\n'],
		['dist/en/index.html', '<p>fixture</p>'],
		['tests/browser/example.spec.js', 'export const test = true;\n'],
		['tests/browser/example.spec.js-snapshots/example-chromium-linux.png', 'png'],
		['tests/browser/AGENTS.md', 'Do not package instructions.\n'],
		['tests/aup3-fixture.js', 'export const fixture = true;\n'],
		['tests/fixtures/aup4-native-rich.js', 'export const fixture = true;\n'],
		['src/common/editor/example.ts', 'export const source = true;\n'],
	]) await writeFixtureFile(repositoryRoot, path, body);

	const packages = new Map([
		['@axe-core/playwright', { dependencies: { 'axe-core': '4.12.1' }, licenses: ['LICENSE'] }],
		['@echogarden/pffft-wasm', { licenses: ['COPYING'] }],
		['axe-core', { licenses: ['LICENSE', 'LICENSE-3RD-PARTY.txt'] }],
		['@ffmpeg/core', {}],
		['@ffmpeg/ffmpeg', { dependencies: { '@ffmpeg/types': '0.12.4' } }],
		['@ffmpeg/types', {}],
		['@noble/hashes', { licenses: ['LICENSE'] }],
		['@playwright/test', { dependencies: { playwright: '1.61.1' }, licenses: ['LICENSE', 'NOTICE'] }],
		['playwright', { dependencies: { 'playwright-core': '1.61.1' }, licenses: ['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt'] }],
		['playwright-core', { licenses: ['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt'] }],
		['@zip.js/zip.js', { licenses: ['LICENSE'] }],
		['fflate', { licenses: ['LICENSE'] }],
		['saxes', { dependencies: { xmlchars: '2.2.0' } }],
		['sql.js', { licenses: ['LICENSE'] }],
		['xmlchars', { licenses: ['LICENSE'] }],
	]);
	for (const [name, metadata] of packages) {
		await writeFixturePackage(repositoryRoot, name, metadata);
	}
	await writeFixtureFile(repositoryRoot, 'node_modules/playwright-core/browsers.json', `${JSON.stringify({ browsers: [
		{ name: 'chromium-headless-shell', revision: '101' },
		{ name: 'firefox', revision: '102' },
		{ name: 'webkit', revision: '103' },
		{ name: 'ffmpeg', revision: '104' },
		{ name: 'winldd', revision: '105', installByDefault: false },
	] })}\n`);
	const browserSourceRoot = join(repositoryRoot, 'node_modules/playwright-core/.local-browsers');
	for (const directory of [
		'chromium_headless_shell-101',
		'firefox-102',
		'webkit-103',
		'ffmpeg-104',
		'winldd-105',
	]) {
		await writeFixtureFile(browserSourceRoot, `${directory}/INSTALLATION_COMPLETE`, '');
		await writeFixtureFile(browserSourceRoot, `${directory}/bin/runtime`, directory);
	}
	await symlink('bin/runtime', join(browserSourceRoot, 'webkit-103/libalias'));
	return { temporaryRoot, repositoryRoot, outputRoot, browserSourceRoot };
}

async function writeFixturePackage(repositoryRoot, name, metadata) {
	await writeFixtureFile(repositoryRoot, `node_modules/${name}/package.json`, `${JSON.stringify({
		name,
		version: metadata.version ?? '1.0.0',
		...(metadata.dependencies ? { dependencies: metadata.dependencies } : {}),
	})}\n`);
	await writeFixtureFile(repositoryRoot, `node_modules/${name}/index.js`, 'module.exports = {};\n');
	for (const license of metadata.licenses ?? []) {
		await writeFixtureFile(repositoryRoot, `node_modules/${name}/${license}`, `${name} ${license}\n`);
	}
}

async function writeFixtureFile(root, relativePath, body) {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, body);
}

async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

async function listStagedPackages(root) {
	const packages = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (entry.name.startsWith('@')) {
			for (const child of await readdir(join(root, entry.name), { withFileTypes: true })) {
				if ((await lstat(join(root, entry.name, child.name))).isDirectory()) {
					packages.push(`${entry.name}/${child.name}`);
				}
			}
		} else if (entry.isDirectory()) packages.push(entry.name);
	}
	return packages.sort();
}
