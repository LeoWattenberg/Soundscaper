/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { executeDesktopRendererSmoke } from '../desktop/renderer-smoke-execution.js';
import { assembleE2ECoverageCapture } from '../scripts/lib/e2e-coverage-assembler.mjs';
import { loadE2EBuildEvidence } from '../scripts/lib/e2e-coverage-build-evidence.mjs';
import { attestPinnedVendorDataUrl } from '../scripts/lib/e2e-coverage-profile-assembly.mjs';
import { assertE2EHtmlExecutablePolicy } from '../scripts/lib/e2e-dynamic-code-audit.mjs';
import {
	cleanupE2ECoverageAssemblerFixtures,
	makeFixture,
	readJson,
	recordBrowserEvidence,
	writeJson,
} from './helpers/e2e-coverage-assembler-fixture.mjs';

after(cleanupE2ECoverageAssemblerFixtures);

test('dynamic vendor coverage is excluded only after decoding the exact pinned FFmpeg JavaScript', () => {
	const manifest = readJson(join(process.cwd(), 'config/ffmpeg-runtime-manifest.json'));
	const descriptor = manifest.runtime.files.find(({ name }) => name === 'ffmpeg-core.js');
	const bytes = readFileSync(join(process.cwd(), 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'));
	assert.equal(bytes.byteLength, descriptor.byteLength);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256);
	const url = `data:text/javascript;base64,${bytes.toString('base64')}`;
	assert.equal(attestPinnedVendorDataUrl(url, descriptor), true);
	const changed = Buffer.from(bytes);
	changed[changed.length - 1] ^= 1;
	assert.throws(() => attestPinnedVendorDataUrl(
		`data:text/javascript;base64,${changed.toString('base64')}`,
		descriptor,
	), /does not match the pinned FFmpeg JavaScript/u);
	assert.throws(() => attestPinnedVendorDataUrl(
		`data:text/javascript,${encodeURIComponent(String(bytes.subarray(0, 32)))}`,
		descriptor,
	), /unapproved dynamic data/u);
	assert.equal(attestPinnedVendorDataUrl('file:///app/main.js', descriptor), false);
});

test('packaged profiles exclude only exact captured closed renderer recipes', () => {
	const admitted = makeFixture();
	addRendererRecipe(admitted, false);
	assert.doesNotThrow(() => assembleE2ECoverageCapture(admitted));

	const injected = makeFixture();
	addRendererRecipe(injected, true);
	assert.throws(() => assembleE2ECoverageCapture(injected),
		/dynamic source digest|canonical recipe/u);
});

test('assembly rejects a raw wasm URL without live CDP WebAssembly attestation', () => {
	const fixture = makeFixture();
	const profilePath = join(fixture.runRoot, 'coverage/v8-packaged/packaged-soundscaper.json');
	const profile = readJson(profilePath);
	profile.result.push({
		functions: [],
		scriptId: 'wasm-spoof',
		url: 'wasm://wasm/00091612',
	});
	writeJson(profilePath, profile);
	assert.throws(
		() => assembleE2ECoverageCapture(fixture),
		/unmapped first-party packaged script wasm:\/\/wasm\/00091612/u,
	);
});

test('browser build evidence refuses executable-string primitives before profile filtering', () => {
	const fixture = makeFixture();
	const siteRoot = join(fixture.evidenceRoot, 'browser/soundscaper/site');
	const scriptPath = join(siteRoot, 'assets/app.js');
	const source = `${readFileSync(scriptPath, 'utf8')}\neval('globalThis.__escapedCoverage = true');\n`;
	writeFileSync(scriptPath, source);
	const manifestPath = join(siteRoot, '.browser-product-build.json');
	const manifest = readJson(manifestPath);
	manifest.files['assets/app.js'] = {
		byteLength: Buffer.byteLength(source),
		sha256: createHash('sha256').update(source).digest('hex'),
	};
	writeJson(manifestPath, manifest);
	assert.throws(() => assembleE2ECoverageCapture(fixture),
		/unattested executable-string primitive/u);
});

test('browser build evidence refuses executable inline HTML from the complete file inventory', () => {
	const fixture = makeFixture();
	const siteRoot = join(fixture.evidenceRoot, 'browser/soundscaper/site');
	writeFileSync(join(siteRoot, 'injected.html'), '<script>globalThis.__escapedCoverage = true</script>\n');
	recordBrowserEvidence(siteRoot, 'soundscaper', fixture.expectedRevision);
	assert.throws(() => loadE2EBuildEvidence({
		evidenceRoot: fixture.evidenceRoot,
		repositoryRoot: fixture.repositoryRoot,
		sourceRevision: fixture.expectedRevision,
	}), /unattested executable-string primitive/u);
});

test('HTML executable auditing parses attribute boundaries instead of filtering tags with regexes', () => {
	for (const source of [
		'<img/onerror="globalThis.__escapedCoverage = true">',
		'<a href=javascript:globalThis.__escapedCoverage=true>Run</a>',
		'<script src="./safe.js">',
	]) {
		assert.throws(
			() => assertE2EHtmlExecutablePolicy([{ artifactPath: 'crafted.html', source }]),
			/unattested executable-string primitive/u,
			source,
		);
	}
	assert.doesNotThrow(() => assertE2EHtmlExecutablePolicy([{
		artifactPath: 'safe.html',
		source: '<!doctype html><script src="./safe.js"></script>',
	}]));
});

test('unused first-party map entries cannot hide generated executable bytes behind vendor mappings', () => {
	const fixture = makeFixture();
	const siteRoot = join(fixture.evidenceRoot, 'browser/soundscaper/site');
	const scriptPath = join(siteRoot, 'assets/vendor-only-facade.js');
	writeFileSync(scriptPath, 'globalThis.generatedFacade = true;\n');
	const repositorySource = readFileSync(join(fixture.repositoryRoot, 'src/soundscaper-entry.js'), 'utf8');
	writeJson(join(
		fixture.evidenceRoot,
		'browser/soundscaper/source-maps/vendor-only-facade.js.map',
	), {
		file: 'vendor-only-facade.js',
		mappings: 'ACAA',
		names: [],
		sourceRoot: '',
		sources: [
			'file:///old/checkout/src/soundscaper-entry.js',
			'file:///old/checkout/node_modules/vendor/runtime.js',
		],
		sourcesContent: [repositorySource, 'export const vendorRuntime = true;\n'],
		version: 3,
		x_soundscaper_source_sha256: [
			createHash('sha256').update(repositorySource).digest('hex'),
			null,
		],
	});
	recordBrowserEvidence(siteRoot, 'soundscaper', fixture.expectedRevision);
	const evidence = loadE2EBuildEvidence({
		evidenceRoot: fixture.evidenceRoot,
		repositoryRoot: fixture.repositoryRoot,
		sourceRevision: fixture.expectedRevision,
	});
	const descriptor = evidence.browser.get('soundscaper').scriptsByPath.get('assets/vendor-only-facade.js');
	assert.equal(descriptor.owned, true);
	assert.equal(descriptor.sourceMap, null);
	assert.equal(descriptor.fullSourceMap, null);
	assert.deepEqual(descriptor.repositorySources, []);
});

test('mixed vendor and unknown mappings retain the generated executable bytes', () => {
	const fixture = makeFixture();
	const siteRoot = join(fixture.evidenceRoot, 'browser/soundscaper/site');
	writeFileSync(join(siteRoot, 'assets/mixed-vendor-facade.js'),
		'globalThis.mixedVendorFacade = true;\n');
	writeJson(join(
		fixture.evidenceRoot,
		'browser/soundscaper/source-maps/mixed-vendor-facade.js.map',
	), {
		file: 'mixed-vendor-facade.js',
		mappings: 'AAAA,CCAA',
		names: [],
		sourceRoot: '',
		sources: [
			'file:///old/checkout/node_modules/vendor/runtime.js',
			'https://cdn.invalid/theme.css',
		],
		sourcesContent: ['export const vendorRuntime = true;\n', 'body {}\n'],
		version: 3,
		x_soundscaper_source_sha256: [null, null],
	});
	recordBrowserEvidence(siteRoot, 'soundscaper', fixture.expectedRevision);
	const evidence = loadE2EBuildEvidence({
		evidenceRoot: fixture.evidenceRoot,
		repositoryRoot: fixture.repositoryRoot,
		sourceRevision: fixture.expectedRevision,
	});
	const descriptor = evidence.browser.get('soundscaper').scriptsByPath.get('assets/mixed-vendor-facade.js');
	assert.equal(descriptor.owned, true);
	assert.equal(descriptor.sourceMap, null);
	assert.equal(descriptor.fullSourceMap, null);
});

test('executable first-party mappings remain authoritative beside generated SVG modules', () => {
	const fixture = makeFixture();
	const siteRoot = join(fixture.evidenceRoot, 'browser/soundscaper/site');
	writeFileSync(join(siteRoot, 'assets/mixed-repository-assets.js'),
		'globalThis.mixedRepositoryAssets = true;\n');
	const repositorySource = readFileSync(join(fixture.repositoryRoot, 'src/soundscaper-entry.js'), 'utf8');
	writeJson(join(
		fixture.evidenceRoot,
		'browser/soundscaper/source-maps/mixed-repository-assets.js.map',
	), {
		file: 'mixed-repository-assets.js',
		mappings: 'AAAA,CCAA',
		names: [],
		sourceRoot: '',
		sources: [
			'file:///old/checkout/src/soundscaper-entry.js',
			'file:///old/checkout/src/common/editor/ui/skins/previews/Classic.svg',
		],
		sourcesContent: [repositorySource, null],
		version: 3,
		x_soundscaper_source_sha256: [
			createHash('sha256').update(repositorySource).digest('hex'),
			null,
		],
	});
	recordBrowserEvidence(siteRoot, 'soundscaper', fixture.expectedRevision);
	const evidence = loadE2EBuildEvidence({
		evidenceRoot: fixture.evidenceRoot,
		repositoryRoot: fixture.repositoryRoot,
		sourceRevision: fixture.expectedRevision,
	});
	const descriptor = evidence.browser.get('soundscaper').scriptsByPath.get('assets/mixed-repository-assets.js');
	assert.equal(descriptor.owned, true);
	assert.notEqual(descriptor.sourceMap, null);
	assert.notEqual(descriptor.fullSourceMap, null);
	assert.deepEqual(descriptor.repositorySources, ['src/soundscaper-entry.js']);
});

function addRendererRecipe(fixture, injectCode) {
	const profilePath = join(fixture.runRoot, 'coverage/v8-packaged/packaged-soundscaper.json');
	const profile = readJson(profilePath);
	let source = '';
	void executeDesktopRendererSmoke({
		executeJavaScript(value) {
			source = value;
			return { status: 'fulfilled', value: null };
		},
	}, { productId: 'soundscaper', operation: 'artifact-chrome' });
	const url = source.slice(source.lastIndexOf('sourceURL=') + 'sourceURL='.length);
	profile.result.push({ functions: [], url });
	profile['script-source-cache'][url] = injectCode
		? source.replace('\n//# sourceURL=', '\nvoid 0;\n//# sourceURL=') : source;
	writeJson(profilePath, profile);
}
