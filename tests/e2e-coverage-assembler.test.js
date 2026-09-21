/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import {
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import {
	DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS,
} from '../desktop/renderer-smoke-execution.js';
import { assembleE2ECoverageCapture } from '../scripts/lib/e2e-coverage-assembler.mjs';
import { prepareE2ECoverageArtifacts } from '../scripts/lib/e2e-coverage-builder.mjs';
import {
	commitFixtureRepository,
	hash,
	readJson,
	readProfiles,
	recordBrowserEvidence,
	rewritePackagedLayout,
	sourceMapFor,
	sourceLineLengths,
	write,
	writeJson,
} from './helpers/e2e-coverage-assembler-fixture.mjs';

const PRODUCTS = ['framescaper', 'soundscaper'];
const workspaces = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

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
	assert.equal(result.captureIndex.scripts.length, 14, 'loopback browser chunks are admitted in Electron');
	assert.equal(result.captureIndex.sources.length, 7, 'byte-identical generated chunks share one union source');
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
	assert.equal(prepared.inventory.scripts.length, 14);
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

function makeFixture() {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-e2e-assembler-'));
	workspaces.push(workspace);
	const repositoryRoot = join(workspace, 'repository');
	const runRoot = join(workspace, 'nightly-run');
	const evidenceRoot = join(runRoot, 'coverage/build-evidence');
	const outputRoot = join(runRoot, 'coverage/e2e-capture');
	const sources = new Map();
	for (const product of PRODUCTS) {
		const sourcePath = `src/${product}-entry.js`;
		const source = `export const product = ${JSON.stringify(product)};\n`;
		write(join(repositoryRoot, sourcePath), source);
		sources.set(product, { source, sourcePath });
	}
	const sourceRevision = commitFixtureRepository(repositoryRoot);
	writeJson(join(runRoot, 'run.json'), {
		schemaVersion: 2,
		kind: 'soundscaper-desktop-nightly-tests',
		runtime: { platform: 'linux', arch: 'x64' },
		sourceRevision,
		status: 'passed',
		finishedAt: '2026-09-20T12:00:00.000Z',
	});
	for (const product of PRODUCTS) {
		const { source, sourcePath } = sources.get(product);
		const browserRoot = join(evidenceRoot, 'browser', product);
		const browserApp = `globalThis.product = ${JSON.stringify(product)};\n`;
		write(join(browserRoot, 'site/assets/app.js'), browserApp);
		write(join(browserRoot, 'site/service-worker.js'), 'globalThis.addEventListener("fetch", () => {});\n');
		const sourceMap = sourceMapFor(sourcePath, source);
		writeJson(join(browserRoot, 'source-maps/app.js.map'), sourceMap);
		recordBrowserEvidence(join(browserRoot, 'site'), product, sourceRevision);

		const electronRoot = join(evidenceRoot, 'electron', product);
		const main = dynamicExclusionFixture(`export const mainProduct = ${JSON.stringify(product)};\n`, product);
		const preload = `globalThis.preloadProduct = ${JSON.stringify(product)};\n`;
		const renderer = browserApp;
		write(join(electronRoot, 'app/desktop/main.mjs'), main);
		write(join(electronRoot, 'app/desktop/preload.js'), preload);
		write(join(electronRoot, 'renderer/assets/app.js'), renderer);
		writeJson(join(electronRoot, 'renderer-source-maps/app.js.map'), sourceMap);
		writeProductEvidence(electronRoot, product, sourceRevision, { main, preload, renderer });
	}
	writeBrowserProfiles(runRoot, evidenceRoot, repositoryRoot);
	writePackagedProfiles(runRoot, evidenceRoot);
	return {
		workspace,
		repositoryRoot,
		runRoot,
		evidenceRoot,
		outputRoot,
		expectedRevision: sourceRevision,
	};
}

function dynamicExclusionFixture(source, productId) {
	return `${source}${Object.values(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS)
		.filter(({ products }) => products.includes(productId))
		.map(({ marker, pathPrefix }, index) => (
			`export const dynamic_recipe_${index} = ${JSON.stringify(`${marker}\n${pathPrefix}`)};\n`
		)).join('')}`;
}

function writeBrowserProfiles(runRoot, evidenceRoot, repositoryRoot) {
	const result = [];
	const sourceMapCache = {};
	for (const product of PRODUCTS) {
		const appUrl = `file:///__soundscaper_e2e__/browser/${product}/assets/app.js`;
		const workerUrl = `file:///__soundscaper_e2e__/browser/${product}/service-worker.js`;
		result.push(v8Entry(appUrl), v8Entry(workerUrl));
		const script = readFileSync(join(evidenceRoot, 'browser', product, 'site/assets/app.js'), 'utf8');
		const source = readFileSync(join(repositoryRoot, `src/${product}-entry.js`), 'utf8');
		sourceMapCache[appUrl] = {
			lineLengths: sourceLineLengths(script),
			data: portableMap(
				sourceMapFor(`src/${product}-entry.js`, source),
				`src/${product}-entry.js`,
				source,
			),
			url: null,
		};
	}
	writeJson(join(runRoot, 'coverage/v8-browser/browser.json'), { result, 'source-map-cache': sourceMapCache });
}

function writePackagedProfiles(runRoot, evidenceRoot) {
	for (const [index, product] of PRODUCTS.entries()) {
		const electronRoot = join(evidenceRoot, 'electron', product);
		const executablePath = `/opt/${product}/${product}`;
		const appOrigin = `${product}-app://bundle`;
		const baseOrigin = `http://127.0.0.1:${String(45678 + index)}`;
		const rendererUrl = `${appOrigin}/assets/app.js`;
		const browserUrl = `${baseOrigin}/assets/app.js`;
		const preloadPath = `/opt/${product}/resources/app.asar/desktop/preload.js`;
		const preloadUrl = index === 0 ? preloadPath : `file://${preloadPath}`;
		const mainUrl = `file:///opt/${product}/resources/app.asar/desktop/main.mjs`;
		writeJson(join(runRoot, `coverage/v8-packaged/packaged-${product}.json`), {
			result: [v8Entry(rendererUrl), v8Entry(browserUrl), v8Entry(preloadUrl)],
			'script-source-cache': {
				[rendererUrl]: readFileSync(join(electronRoot, 'renderer/assets/app.js'), 'utf8'),
				[browserUrl]: readFileSync(join(evidenceRoot, 'browser', product, 'site/assets/app.js'), 'utf8'),
				[preloadUrl]: readFileSync(join(electronRoot, 'app/desktop/preload.js'), 'utf8'),
			},
			'source-map-cache': {},
			'soundscaper-packaged-runtime': {
				schemaVersion: 1,
				productId: product,
				platform: 'linux',
				architecture: 'x64',
				executablePath,
				processId: 4100 + index,
				appOrigin,
				baseOrigin,
				captureKind: 'cdp-precise-coverage',
				capturesChildTargets: true,
				childTargetStrategy: 'recursive-auto-attach-paused',
				pausedTargetCounts: { worker: 1 },
				targetCounts: { worker: 2 },
				targetTypes: ['worker'],
			},
		});
		writeJson(join(runRoot, `coverage/v8-packaged/coverage-${4100 + index}-fixture-0.json`), {
			result: [v8Entry(mainUrl), v8Entry('node:internal/bootstrap')],
			'source-map-cache': {},
		});
	}
}

function writeProductEvidence(root, productId, sourceRevision, { main, preload, renderer }) {
	writeJson(join(root, 'manifest.json'), {
		schemaVersion: 2,
		kind: 'soundscaper-e2e-product-build-evidence',
		productId,
		sourceRevision,
		packageArchive: { byteLength: 123, sha256: hash(`${productId} archive`) },
		scripts: [
			productFile('main', 'app.asar/desktop/main.mjs', 'app/desktop/main.mjs', main),
			productFile('preload', 'app.asar/desktop/preload.js', 'app/desktop/preload.js', preload),
			productFile('renderer', 'renderer/assets/app.js', 'renderer/assets/app.js', renderer),
		],
		sourceMaps: [productFile(
			undefined,
			undefined,
			'renderer-source-maps/app.js.map',
			readFileSync(join(root, 'renderer-source-maps/app.js.map')),
		)],
	});
}

function productFile(realm, packagedPath, artifactPath, value) {
	const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
	return {
		...(realm === undefined ? {} : { realm }),
		...(packagedPath === undefined ? {} : { packagedPath }),
		artifactPath,
		byteLength: bytes.byteLength,
		sha256: hash(bytes),
	};
}

function portableMap(map, sourcePath, source) {
	return {
		...map,
		sources: [`file:///__soundscaper_repo__/${sourcePath}`],
		sourcesContent: [source],
	};
}

function v8Entry(url) {
	return {
		scriptId: '1',
		url,
		functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 1, count: 1 }] }],
	};
}
