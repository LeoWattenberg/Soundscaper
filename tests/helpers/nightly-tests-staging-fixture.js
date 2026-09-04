/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	lstat, mkdir, mkdtemp, readFile,
	readdir, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const BURN_IN_FONT_FILES = [
	'inter-cyrillic-ext-600-normal.woff',
	'inter-cyrillic-600-normal.woff',
	'inter-greek-ext-600-normal.woff',
	'inter-greek-600-normal.woff',
	'inter-latin-ext-600-normal.woff',
	'inter-latin-600-normal.woff',
	'inter-vietnamese-600-normal.woff',
];

/**
 * A minimal checkout the nightly-tests payload can be staged out of.
 *
 * Both staging suites build against this rather than the real repository, so a test can
 * make the checkout wrong — a symlink that escapes it, a package with no notice, two
 * esbuild binaries — without touching anything a developer is working in.
 */

export async function createFixture(context) {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-stage-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const repositoryRoot = join(temporaryRoot, 'repository');
	const outputRoot = join(repositoryRoot, '.desktop-build/nightly-tests');
	await writeFixtureFile(repositoryRoot, 'package.json', `${JSON.stringify({
		name: 'soundscaper',
		version: '1.0.0-rc.1',
	})}\n`);
	for (const [path, body] of [
		['LICENSE', 'AGPL fixture\n'],
		['THIRD_PARTY_LICENSES.md', '# Fixture notices\n'],
		['LICENSES/GPL-3.0.txt', 'GPL fixture\n'],
		['LICENSES/Playwright-winldd-MIT.txt', 'WinLDD MIT fixture\n'],
		['public/logo/logo-klein-schwarz.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4" viewBox="0 0 8 4"><path d="M0 0h8v4H0z"/></svg>\n'],
		['playwright.nightly-tests.config.mjs', 'export default {};\n'],
		['playwright.nightly-metrics.config.mjs', 'export default {};\n'],
		['playwright.nightly-packaged-metrics.config.mjs', 'export default {};\n'],
		['config/accessibility-wcag-baseline.json', '{"routes":[]}\n'],
		['config/quality-budgets.json', '{"measurementPolicy":{"timingWorkers":1,"benchmarkRetries":0}}\n'],
		['desktop/nightly-tests-main.mjs', 'export const launcher = true;\n'],
		['desktop/nightly-tests-manifest.mjs', 'export const manifest = true;\n'],
		['scripts/lib/desktop-nightly-tests-runtime.mjs', 'export const runtime = true;\n'],
		['scripts/lib/desktop-nightly-tests-static-response.mjs', 'export const staticResponse = true;\n'],
		['scripts/lib/desktop-nightly-tests-product-sites.mjs', 'export const productSites = true;\n'],
		['scripts/lib/desktop-nightly-tests-static-route.mjs', 'export const staticRoute = true;\n'],
		['scripts/lib/desktop-nightly-tests-metrics.mjs', 'export const metricsRuntime = true;\n'],
		['scripts/lib/desktop-nightly-tests-packaged-runtime.mjs', 'export const packagedRuntime = true;\n'],
		['scripts/lib/desktop-nightly-tests-presentation.mjs', 'export const presentation = true;\n'],
		['scripts/collect-m3-longform-editorial-quality.mjs', 'export const collector = true;\n'],
		['scripts/collect-m4-production-parity-quality.mjs', 'export const collector = true;\n'],
		['scripts/collect-m4b2-keyframe-parity-quality.mjs', 'export const collector = true;\n'],
		['scripts/lib/quality-budget-config.mjs', 'export const config = true;\n'],
		['scripts/quality-budget-evaluator.mjs', 'export const evaluator = true;\n'],
		['scripts/quality-budget-result.mjs', 'export const result = true;\n'],
		['scripts/verify-quality-budget-result.mjs', 'export const verifier = true;\n'],
		['scripts/lib/m4-production-parity-identity.mjs', 'export const identity = true;\n'],
		['scripts/lib/m4-production-parity-metrics.mjs', 'export const metrics = true;\n'],
		['scripts/lib/m4-production-parity-video-fixture.mjs', 'export const fixture = true;\n'],
		['scripts/lib/m4b2-keyframe-parity-metrics.mjs', 'export const keyframeMetrics = true;\n'],
		['scripts/lib/strict-json-snapshot.mjs', 'export const snapshot = true;\n'],
		['.wrangler/browser-products/soundscaper/en/index.html', '<p>Soundscaper fixture</p>'],
		['.wrangler/browser-products/framescaper/en/index.html', '<p>Framescaper fixture</p>'],
		['handbook/guides/steps.mjs', 'export const steps = true;\n'],
		['handbook/guides/soundscaper/volume.mjs', 'export const guide = true;\n'],
		['tests/browser/example.spec.js', 'export const test = true;\n'],
		['tests/browser/example.spec.js-snapshots/example-chromium-linux.png', 'png'],
		['tests/browser/AGENTS.md', 'Do not package instructions.\n'],
		['tests/browser/audio-editor-soak-debug.spec.js', 'export const debugSoak = true;\n'],
		['tests/browser/handbook/handbook.spec.js', 'export const handbook = true;\n'],
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
		['@fontsource/inter', { licenses: ['LICENSE'], files: BURN_IN_FONT_FILES.map((name) => `files/${name}`) }],
		['@noble/hashes', { licenses: ['LICENSE'] }],
		['@playwright/test', { dependencies: { playwright: '1.61.1' }, licenses: ['LICENSE', 'NOTICE'] }],
		['@types/dom-mediacapture-transform', { dependencies: { '@types/dom-webcodecs': '0.1.13' }, licenses: ['LICENSE'] }],
		['@types/dom-webcodecs', { licenses: ['LICENSE'] }],
		['playwright', { dependencies: { 'playwright-core': '1.61.1' }, licenses: ['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt'] }],
		['playwright-core', { licenses: ['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt'] }],
		['@zip.js/zip.js', { licenses: ['LICENSE'] }],
		// esbuild resolves its compiled binary from an optional per-platform
		// dependency, which the closure walk ignores; staging admits the one the
		// build host installed instead.
		['esbuild', { licenses: ['LICENSE.md'] }],
		['@esbuild/linux-x64', {}],
		['fflate', { licenses: ['LICENSE'] }],
		['mediabunny', { dependencies: {
			'@types/dom-mediacapture-transform': '0.1.12', '@types/dom-webcodecs': '0.1.13',
		}, licenses: ['LICENSE'] }],
		['saxes', { dependencies: { xmlchars: '2.2.0' } }],
		['sql.js', { licenses: ['LICENSE'] }],
		['typescript', { licenses: ['LICENSE.txt', 'ThirdPartyNoticeText.txt'] }],
		['xmlchars', { licenses: ['LICENSE'] }],
	]);
	for (const [name, metadata] of packages) {
		await writeFixturePackage(repositoryRoot, name, metadata);
	}
	await writeFixtureFile(repositoryRoot, 'node_modules/playwright-core/browsers.json', `${JSON.stringify({ browsers: [
		{ name: 'chromium', revision: '101' },
		{ name: 'firefox', revision: '102' },
		{ name: 'webkit', revision: '103' },
		{ name: 'ffmpeg', revision: '104' },
		{ name: 'winldd', revision: '105', installByDefault: false },
	] })}\n`);
	const browserSourceRoot = join(repositoryRoot, 'node_modules/playwright-core/.local-browsers');
	for (const directory of ['chromium-101', 'firefox-102', 'webkit-103', 'ffmpeg-104', 'winldd-105']) {
		await writeFixtureFile(browserSourceRoot, `${directory}/INSTALLATION_COMPLETE`, '');
		await writeFixtureFile(browserSourceRoot, `${directory}/bin/runtime`, directory);
	}
	await symlink('bin/runtime', join(browserSourceRoot, 'webkit-103/libalias'));
	const framework = join(browserSourceRoot, 'webkit-103/WebKit.framework');
	await writeFixtureFile(framework, 'Versions/A/WebKit', 'fixture');
	await writeFixtureFile(framework, 'Versions/A/Resources/Info.plist', 'fixture');
	await writeFixtureFile(framework, 'Versions/A/Headers/WebKit.h', 'fixture');
	await writeFixtureFile(framework, 'Versions/A/PrivateHeaders/VideoTarget.h', 'fixture');
	await writeFixtureFile(framework, 'Versions/A/WebKit.tbd', 'fixture');
	for (const hollow of ['Versions/A/Frameworks', 'Versions/A/Modules/nested']) {
		await mkdir(join(framework, hollow), { recursive: true });
	}
	await symlink('A', join(framework, 'Versions/Current'));
	for (const name of ['WebKit', 'Resources', 'Frameworks', 'Modules', 'Headers', 'PrivateHeaders']) {
		await symlink(`Versions/Current/${name}`, join(framework, name));
	}
	await writeFixtureFile(browserSourceRoot, 'webkit-103/Headers/keep.h', 'fixture');
	await writeFixtureFile(browserSourceRoot, 'webkit-103/keep.tbd', 'fixture');
	return { temporaryRoot, repositoryRoot, outputRoot, browserSourceRoot };
}

export async function writeFixturePackage(repositoryRoot, name, metadata) {
	await writeFixtureFile(repositoryRoot, `node_modules/${name}/package.json`, `${JSON.stringify({
		name,
		version: metadata.version ?? '1.0.0',
		...(metadata.dependencies ? { dependencies: metadata.dependencies } : {}),
	})}\n`);
	await writeFixtureFile(repositoryRoot, `node_modules/${name}/index.js`, 'module.exports = {};\n');
	for (const license of metadata.licenses ?? []) {
		await writeFixtureFile(repositoryRoot, `node_modules/${name}/${license}`, `${name} ${license}\n`);
	}
	for (const file of metadata.files ?? []) {
		await writeFixtureFile(repositoryRoot, `node_modules/${name}/${file}`, `${name} ${file}\n`);
	}
}

export async function writeFixtureFile(root, relativePath, body) {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, body);
}

export async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

export async function listStagedPackages(root) {
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
