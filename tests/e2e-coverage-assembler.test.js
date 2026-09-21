/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import {
	readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { assembleE2ECoverageCapture } from '../scripts/lib/e2e-coverage-assembler.mjs';
import { prepareE2ECoverageArtifacts } from '../scripts/lib/e2e-coverage-builder.mjs';
import {
	cleanupE2ECoverageAssemblerFixtures,
	hash,
	makeFixture,
	readJson,
	readProfiles,
	recordBrowserEvidence,
	rewritePackagedLayout,
	sourceMapFor,
	sourceLineLengths,
	v8Entry,
	write,
	writeJson,
} from './helpers/e2e-coverage-assembler-fixture.mjs';

const PRODUCTS = ['framescaper', 'soundscaper'];

after(cleanupE2ECoverageAssemblerFixtures);

test('actual nightly evidence assembles into eight strict portable coverage surfaces', () => {
	const fixture = makeFixture();
	const result = assembleE2ECoverageCapture(fixture);

	assert.equal(result.captureIndex.sourceRevision, fixture.expectedRevision);
	assert.deepEqual(result.captureIndex.surfaces.map(({ id }) => id), [
		'browser-chromium-framescaper-renderer',
		'browser-chromium-soundscaper-renderer',
		'nightly-electron-framescaper-main',
		'nightly-electron-framescaper-preload',
		'nightly-electron-framescaper-renderer',
		'nightly-electron-soundscaper-main',
		'nightly-electron-soundscaper-preload',
		'nightly-electron-soundscaper-renderer',
	]);
	assert.equal(result.captureIndex.scripts.length, 21, 'loopback and dynamic browser scripts are inventoried');
	assert.equal(result.captureIndex.sources.length, 9, 'byte-identical generated chunks share one union source');
	assert.ok(result.captureIndex.scripts.every(({ coverageUrl }) => (
		coverageUrl.startsWith('file:///__soundscaper_e2e__/')
	)));
	assert.ok(result.captureIndex.scripts.some(({ coverageUrl }) => coverageUrl.endsWith('/service-worker.js')),
		'unmapped generated first-party workers stay in the denominator');
	for (const surface of result.captureIndex.surfaces) {
		const profiles = readProfiles(join(fixture.outputRoot, surface.coverage.inputPath));
		assert.ok(profiles.length > 0, `${surface.id} must have a real raw profile`);
		assert.ok(profiles.some((profile) => profile.result.length > 0), `${surface.id} must execute a script`);
	}
	const soundSource = result.captureIndex.sources.find(({ path }) => path === 'src/soundscaper-entry.js');
	assert.deepEqual(soundSource.surfaces, [
		'browser-chromium-soundscaper-renderer',
		'nightly-electron-soundscaper-renderer',
	]);
	const browserProfile = readProfiles(join(
		fixture.outputRoot,
		'profiles/browser-chromium-soundscaper-renderer',
	))[0];
	const mappedUrl = 'file:///__soundscaper_e2e__/browser/soundscaper/assets/app.js';
	assert.deepEqual(browserProfile['source-map-cache'][mappedUrl].data.sources, [
		'file:///__soundscaper_repo__/src/soundscaper-entry.js',
	]);
	const packagedRenderer = readProfiles(join(
		fixture.outputRoot,
		'profiles/nightly-electron-framescaper-renderer',
	))[0];
	assert.ok(packagedRenderer.result.some(({ url }) => (
		url === 'file:///__soundscaper_e2e__/electron/framescaper/renderer-browser/assets/app.js'
	)), 'loopback workers and diagnostic pages remain owned by the packaged renderer');

	const preparedRoot = join(fixture.workspace, 'prepared');
	const prepared = prepareE2ECoverageArtifacts({
		captureIndex: result.captureIndex,
		captureRoot: fixture.outputRoot,
		artifactRoot: preparedRoot,
		repositoryRoot: fixture.repositoryRoot,
	});
	assert.equal(prepared.manifests.length, 8);
	assert.equal(prepared.inventory.scripts.length, 21);
});

test('an observed browser script without exact build evidence is rejected', () => {
	const fixture = makeFixture();
	const profilePath = join(fixture.runRoot, 'coverage/v8-browser/browser.json');
	const profile = readJson(profilePath);
	profile.result.push(v8Entry('file:///__soundscaper_e2e__/browser/soundscaper/assets/missing.js'));
	writeJson(profilePath, profile);

	assert.throws(() => assembleE2ECoverageCapture(fixture), /unmapped first-party browser script.*missing\.js/u);
});

test('changed browser bytes and ambiguous map ownership fail before an index is emitted', () => {
	const stale = makeFixture();
	write(join(stale.evidenceRoot, 'browser/soundscaper/site/assets/app.js'), 'changed\n');
	assert.throws(() => assembleE2ECoverageCapture(stale), /browser evidence is stale.*assets\/app\.js/u);

	const ambiguous = makeFixture();
	const site = join(ambiguous.evidenceRoot, 'browser/soundscaper/site');
	write(join(site, 'other/app.js'), 'globalThis.other = true;\n');
	recordBrowserEvidence(site, 'soundscaper', ambiguous.expectedRevision);
	assert.throws(() => assembleE2ECoverageCapture(ambiguous), /source map app\.js\.map is ambiguous/u);
});

test('mapped first-party sources outside src and desktop are refused', () => {
	const fixture = makeFixture();
	const mapPath = join(fixture.evidenceRoot, 'browser/soundscaper/source-maps/app.js.map');
	const map = readJson(mapPath);
	map.sources = ['file:///old/checkout/private/owned-runtime.js'];
	writeJson(mapPath, map);
	recordBrowserEvidence(
		join(fixture.evidenceRoot, 'browser/soundscaper/site'),
		'soundscaper',
		fixture.expectedRevision,
	);

	assert.throws(() => assembleE2ECoverageCapture(fixture), /mapped first-party source.*outside src\/ and desktop\//u);
});

test('packaged profiles cannot claim scripts absent from the product evidence manifest', () => {
	const fixture = makeFixture();
	const profilePath = join(fixture.runRoot, 'coverage/v8-packaged/packaged-soundscaper.json');
	const profile = readJson(profilePath);
	profile.result.push(v8Entry('soundscaper-app://bundle/assets/missing.js'));
	profile['script-source-cache']['soundscaper-app://bundle/assets/missing.js'] = 'missing();\n';
	writeJson(profilePath, profile);

	assert.throws(() => assembleE2ECoverageCapture(fixture), /unmapped first-party packaged script.*missing\.js/u);
});

test('portable raw maps are bound to current repository source bytes', () => {
	const fixture = makeFixture();
	const profilePath = join(fixture.runRoot, 'coverage/v8-browser/browser.json');
	const profile = readJson(profilePath);
	const url = 'file:///__soundscaper_e2e__/browser/soundscaper/assets/app.js';
	profile['source-map-cache'][url].data.sourcesContent[0] = 'stale source\n';
	writeJson(profilePath, profile);

	assert.throws(() => assembleE2ECoverageCapture(fixture), /stale embedded source bytes/u);
});

test('an unobserved distinct map cannot disappear behind an observed shared source', () => {
	const fixture = makeFixture();
	const product = 'soundscaper';
	const browserRoot = join(fixture.evidenceRoot, 'browser', product);
	const sourcePath = `src/${product}-entry.js`;
	const source = readFileSync(join(fixture.repositoryRoot, sourcePath), 'utf8');
	write(join(browserRoot, 'site/assets/secondary.js'), 'globalThis.secondary = true;\n');
	writeJson(join(browserRoot, 'source-maps/secondary.js.map'), {
		...sourceMapFor(sourcePath, source),
		file: 'secondary.js',
		mappings: 'AACA',
	});
	recordBrowserEvidence(join(browserRoot, 'site'), product, fixture.expectedRevision);

	assert.throws(
		() => assembleE2ECoverageCapture(fixture),
		/did not execute executable equivalence.*secondary\.js/u,
	);
});

test('vendor-only mapped chunks are admitted in raw input but omitted from first-party ownership', () => {
	const fixture = makeFixture();
	const product = 'soundscaper';
	const browserRoot = join(fixture.evidenceRoot, 'browser', product);
	const vendorSource = 'export const vendor = true;\n';
	const vendorScript = 'globalThis.vendor = true;\n';
	const vendorUrl = `file:///__soundscaper_e2e__/browser/${product}/assets/vendor-mediabunny.js`;
	const vendorMap = {
		version: 3,
		file: 'vendor-mediabunny.js',
		sourceRoot: '',
		sources: ['file:///old/checkout/node_modules/mediabunny/src/index.js'],
		names: [],
		mappings: 'AAAA',
		x_soundscaper_source_sha256: [hash(vendorSource)],
	};
	write(join(browserRoot, 'site/assets/vendor-mediabunny.js'), vendorScript);
	writeJson(join(browserRoot, 'source-maps/vendor-mediabunny.js.map'), vendorMap);
	recordBrowserEvidence(join(browserRoot, 'site'), product, fixture.expectedRevision);
	const profilePath = join(fixture.runRoot, 'coverage/v8-browser/browser.json');
	const profile = readJson(profilePath);
	profile.result.push(v8Entry(vendorUrl));
	profile['source-map-cache'][vendorUrl] = {
		lineLengths: sourceLineLengths(vendorScript),
		data: { ...vendorMap, sourcesContent: [null] },
		url: null,
	};
	writeJson(profilePath, profile);

	const result = assembleE2ECoverageCapture(fixture);
	assert.equal(result.captureIndex.scripts.some(({ coverageUrl }) => coverageUrl === vendorUrl), false);
	assert.equal(readProfiles(join(
		result.outputRoot,
		'profiles/browser-chromium-soundscaper-renderer',
	)).flatMap(({ result: entries }) => entries).some(({ url }) => url === vendorUrl), false);
});

test('mapped repository bytes must exist unchanged at the declared Git revision', () => {
	const dirty = makeFixture();
	write(join(dirty.repositoryRoot, 'src/soundscaper-entry.js'), 'export const dirty = true;\n');
	assert.throws(
		() => assembleE2ECoverageCapture(dirty),
		/differs from declared revision/u,
	);

	const absent = makeFixture();
	const source = 'export const uncommitted = true;\n';
	write(join(absent.repositoryRoot, 'src/uncommitted.js'), source);
	const browserRoot = join(absent.evidenceRoot, 'browser/soundscaper');
	const mapPath = join(browserRoot, 'source-maps/app.js.map');
	const map = readJson(mapPath);
	map.sources = ['file:///old/checkout/src/uncommitted.js'];
	map.x_soundscaper_source_sha256 = [hash(source)];
	writeJson(mapPath, map);
	recordBrowserEvidence(join(browserRoot, 'site'), 'soundscaper', absent.expectedRevision);
	assert.throws(
		() => assembleE2ECoverageCapture(absent),
		/does not exist at revision/u,
	);
});

test('the documented repository coverage output stays inside its bounded root', () => {
	const fixture = makeFixture();
	const outputRoot = join(fixture.repositoryRoot, 'coverage/e2e-capture');
	const result = assembleE2ECoverageCapture({ ...fixture, outputRoot });

	assert.equal(result.outputRoot, outputRoot);
	assert.deepEqual(readJson(join(outputRoot, 'capture-index.json')), result.captureIndex);
});

test('packaged paths normalize Windows drives, UNC shares and macOS app bundles', () => {
	const layouts = [
		{
			platform: 'win32',
			executable: (product) => `C:\\Nightly builds\\${product}\\${product}.exe`,
			url: (product, path) => `file:///C:/Nightly%20builds/${product}/resources/app.asar/${path}`,
		},
		{
			platform: 'win32',
			executable: (product) => `\\\\server\\share\\${product}\\${product}.exe`,
			url: (product, path) => `file://server/share/${product}/resources/app.asar/${path}`,
		},
		{
			platform: 'darwin',
			executable: (product) => `/Applications/${product} Test.app/Contents/MacOS/${product}`,
			url: (product, path) => `file:///Applications/${product}%20Test.app/Contents/Resources/app.asar/${path}`,
		},
	];
	for (const layout of layouts) {
		const fixture = makeFixture();
		rewritePackagedLayout(fixture, layout);
		assert.equal(assembleE2ECoverageCapture(fixture).captureIndex.surfaces.length, 8);
	}
});

test('Electron evidence rejects ambiguous installed paths and stale CDP source caches', () => {
	const ambiguous = makeFixture();
	const manifestPath = join(ambiguous.evidenceRoot, 'electron/soundscaper/manifest.json');
	const manifest = readJson(manifestPath);
	manifest.scripts[1].packagedPath = manifest.scripts[0].packagedPath;
	writeJson(manifestPath, manifest);
	assert.throws(() => assembleE2ECoverageCapture(ambiguous), /ambiguous packaged path/u);

	for (const replacement of [undefined, 'stale preload bytes\n']) {
		const fixture = makeFixture();
		const path = join(fixture.runRoot, 'coverage/v8-packaged/packaged-soundscaper.json');
		const profile = readJson(path);
		const preload = profile.result.find(({ url }) => /preload\.js$/u.test(url)).url;
		if (replacement === undefined) delete profile['script-source-cache'][preload];
		else profile['script-source-cache'][preload] = replacement;
		writeJson(path, profile);
		assert.throws(() => assembleE2ECoverageCapture(fixture), /script bytes are stale/u);
	}
});

test('child Node profiles and duplicate URLs merge, while PID/product conflicts fail closed', () => {
	const fixture = makeFixture();
	const rootProfile = readJson(join(
		fixture.runRoot,
		'coverage/v8-packaged/coverage-4100-fixture-0.json',
	));
	writeJson(join(fixture.runRoot, 'coverage/v8-packaged/coverage-9999-child-0.json'), {
		result: [rootProfile.result[0], rootProfile.result[0]],
		'source-map-cache': {},
	});
	for (const product of PRODUCTS) {
		const path = join(fixture.runRoot, `coverage/v8-packaged/packaged-${product}.json`);
		const profile = readJson(path);
		profile['soundscaper-packaged-runtime'].targetTypes = [];
		profile['soundscaper-packaged-runtime'].targetCounts = {};
		profile['soundscaper-packaged-runtime'].pausedTargetCounts = {};
		writeJson(path, profile);
	}
	const assembled = assembleE2ECoverageCapture(fixture);
	const mainEntries = readProfiles(join(
		assembled.outputRoot,
		'profiles/nightly-electron-framescaper-main',
	)).flatMap(({ result }) => result);
	assert.equal(mainEntries.length, 3);

	const conflict = makeFixture();
	const soundscaperPath = join(conflict.runRoot, 'coverage/v8-packaged/coverage-4101-fixture-0.json');
	const soundscaper = readJson(soundscaperPath);
	soundscaper.result.push(rootProfile.result[0]);
	writeJson(soundscaperPath, soundscaper);
	assert.throws(() => assembleE2ECoverageCapture(conflict), /disagrees with its recorded product process/u);

	const resource = makeFixture();
	const resourcePath = join(resource.runRoot, 'coverage/v8-packaged/coverage-4100-fixture-0.json');
	const resourceProfile = readJson(resourcePath);
	resourceProfile.result.push(v8Entry('file:///opt/framescaper/resources/extra/utility.js'));
	writeJson(resourcePath, resourceProfile);
	assert.throws(() => assembleE2ECoverageCapture(resource), /un-inventoried product resource script/u);
});
