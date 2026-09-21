/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';

import { DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS } from '../../desktop/renderer-smoke-execution.js';
import { buildAttestedMacroSandboxModule } from '../../src/common/editor/macro-script/dynamic-source-contract.js';
import {
	MACRO_FIXED_COVERAGE_SOURCE_PATH,
	macroDynamicCoverageScript,
	macroDynamicSourceUrl,
} from '../../scripts/lib/macro-dynamic-coverage.mjs';
import {
	packagedExecutableResourceIdentity,
} from '../../scripts/lib/packaged-executable-resource-identity.mjs';

const PRODUCTS = ['framescaper', 'soundscaper'];
const MACRO_PRELUDE_PATH = 'src/common/editor/macro-script/sandbox-prelude.js';
const MACRO_PRELUDE_ARTIFACT = 'assets/sandbox-prelude-fixture.js';
const APP_DOCUMENT_SOURCE = '<main>packaged application fixture</main>\n';
const RENDERER_DOCUMENT_SOURCE = '<main>packaged renderer fixture</main>\n';
export const RUNTIME_SCRIPT_PATH = 'runtime/fixture-vendor/index.js';
export const RUNTIME_SCRIPT_SOURCE = 'module.exports = "authenticated fixture runtime";\n';
const MACRO_PRELUDE_SOURCE = readFileSync(join(import.meta.dirname, '../../', MACRO_PRELUDE_PATH), 'utf8');
const MACRO_WRAPPER_SOURCE = readFileSync(
	join(import.meta.dirname, '../../', MACRO_FIXED_COVERAGE_SOURCE_PATH),
	'utf8',
);
const workspaces = [];

export function cleanupE2ECoverageAssemblerFixtures() {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
}

export function makeFixture() {
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
	write(join(repositoryRoot, MACRO_FIXED_COVERAGE_SOURCE_PATH), MACRO_WRAPPER_SOURCE);
	write(join(repositoryRoot, MACRO_PRELUDE_PATH), MACRO_PRELUDE_SOURCE);
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
		write(join(browserRoot, `site/${MACRO_PRELUDE_ARTIFACT}`), MACRO_PRELUDE_SOURCE);
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
		write(join(electronRoot, 'app/desktop/window.html'), APP_DOCUMENT_SOURCE);
		write(join(electronRoot, 'renderer/assets/app.js'), renderer);
		write(join(electronRoot, `renderer/${MACRO_PRELUDE_ARTIFACT}`), MACRO_PRELUDE_SOURCE);
		write(join(electronRoot, 'renderer/index.html'), RENDERER_DOCUMENT_SOURCE);
		writeJson(join(electronRoot, 'renderer-source-maps/app.js.map'), sourceMap);
		writeProductEvidence(electronRoot, product, sourceRevision, {
			appDocument: APP_DOCUMENT_SOURCE,
			main,
			prelude: MACRO_PRELUDE_SOURCE,
			preload,
			rendererDocument: RENDERER_DOCUMENT_SOURCE,
			renderer,
		});
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
		)).join('')}
function executeRecipe(webContents, productId, recipeId, source, userGesture) {
	const attestation = validateDesktopRendererDynamicSource({ productId, path: sourceUrlPath(source), source });
	if (attestation.recipeId !== recipeId) throw new Error("Renderer smoke recipe attestation disagrees.");
	return webContents.executeJavaScript(source, userGesture === true);
}
`;
}

function writeBrowserProfiles(runRoot, evidenceRoot, repositoryRoot) {
	const result = [];
	const scriptSourceCache = {};
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
		if (product === 'soundscaper') {
			const preludeUrl = `file:///__soundscaper_e2e__/browser/${product}/${MACRO_PRELUDE_ARTIFACT}`;
			const source = buildAttestedMacroSandboxModule(
				`import "http://127.0.0.1:4322/${MACRO_PRELUDE_ARTIFACT}";`,
				'globalThis.__fixtureMacroExecuted = true;',
			);
			const dynamic = macroDynamicCoverageScript({
				repositoryRoot,
				source,
				url: macroDynamicSourceUrl(source),
			});
			result.push(v8Entry(preludeUrl), v8Entry(dynamic.coverageUrl));
			scriptSourceCache[dynamic.coverageUrl] = source;
			sourceMapCache[dynamic.coverageUrl] = {
				data: dynamic.sourceMap,
				lineLengths: sourceLineLengths(source),
				url: null,
			};
		}
	}
	writeJson(join(runRoot, 'coverage/v8-browser/browser.json'), {
		result,
		'script-source-cache': scriptSourceCache,
		'source-map-cache': sourceMapCache,
	});
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
		const runtimeUrl = `file:///opt/${product}/resources/${RUNTIME_SCRIPT_PATH}`;
		const evidence = readJson(join(electronRoot, 'manifest.json'));
		const packageArchive = evidence.packageArchive;
		writeJson(join(runRoot, `coverage/v8-packaged/packaged-${product}.json`), {
			result: [v8Entry(rendererUrl), v8Entry(browserUrl), v8Entry(preloadUrl), v8Entry(runtimeUrl)],
			'script-source-cache': {
				[rendererUrl]: readFileSync(join(electronRoot, 'renderer/assets/app.js'), 'utf8'),
				[browserUrl]: readFileSync(join(evidenceRoot, 'browser', product, 'site/assets/app.js'), 'utf8'),
				[preloadUrl]: readFileSync(join(electronRoot, 'app/desktop/preload.js'), 'utf8'),
				[runtimeUrl]: RUNTIME_SCRIPT_SOURCE,
			},
			'source-map-cache': {},
			'soundscaper-packaged-runtime': {
				schemaVersion: 3,
				appAsar: {
					path: `/opt/${product}/resources/app.asar`,
					beforeLaunch: { ...packageArchive },
					afterCollection: { ...packageArchive },
				},
				executableResources: {
					path: `/opt/${product}/resources`,
					beforeLaunch: { ...evidence.executableResources },
					afterCollection: { ...evidence.executableResources },
				},
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
			result: [v8Entry(mainUrl), v8Entry(runtimeUrl), v8Entry('node:internal/bootstrap')],
			'source-map-cache': {},
		});
	}
}

export function rewritePackagedLayout(fixture, layout) {
	const run = readJson(join(fixture.runRoot, 'run.json'));
	run.runtime = {
		platform: layout.platform,
		arch: layout.platform === 'darwin' ? 'arm64' : 'x64',
	};
	writeJson(join(fixture.runRoot, 'run.json'), run);
	for (const [index, product] of PRODUCTS.entries()) {
		const cdpPath = join(fixture.runRoot, `coverage/v8-packaged/packaged-${product}.json`);
		const cdp = readJson(cdpPath);
		const metadata = cdp['soundscaper-packaged-runtime'];
		metadata.platform = layout.platform;
		metadata.architecture = layout.platform === 'darwin' ? 'arm64' : 'x64';
		metadata.executablePath = layout.executable(product);
		metadata.appAsar.path = decodeURIComponent(
			layout.url(product, '').replace(/^file:\/\//u, '').replace(/\/$/u, ''),
		);
		if (layout.platform === 'win32' && metadata.appAsar.path.startsWith('/')
			&& /^[A-Za-z]:\//u.test(metadata.appAsar.path.slice(1))) {
			metadata.appAsar.path = metadata.appAsar.path.slice(1).replaceAll('/', '\\');
		} else if (layout.platform === 'win32' && metadata.appAsar.path.startsWith('server/')) {
			metadata.appAsar.path = `\\\\${metadata.appAsar.path.replaceAll('/', '\\')}`;
		}
		const paths = layout.platform === 'win32' ? win32 : posix;
		metadata.executableResources.path = paths.dirname(metadata.appAsar.path);
		const preloadEntry = cdp.result.find(({ url }) => /preload\.js$/u.test(url));
		const preloadSource = cdp['script-source-cache'][preloadEntry.url];
		delete cdp['script-source-cache'][preloadEntry.url];
		preloadEntry.url = layout.url(product, 'desktop/preload.js');
		cdp['script-source-cache'][preloadEntry.url] = preloadSource;
		const runtimeEntry = cdp.result.find(({ url }) => url.includes('/runtime/'));
		const runtimeSource = cdp['script-source-cache'][runtimeEntry.url];
		delete cdp['script-source-cache'][runtimeEntry.url];
		runtimeEntry.url = resourceUrl(layout, product, RUNTIME_SCRIPT_PATH);
		cdp['script-source-cache'][runtimeEntry.url] = runtimeSource;
		writeJson(cdpPath, cdp);

		const nodePath = join(fixture.runRoot, `coverage/v8-packaged/coverage-${4100 + index}-fixture-0.json`);
		const node = readJson(nodePath);
		node.result[0].url = layout.url(product, 'desktop/main.mjs');
		node.result.find(({ url }) => url.includes('/runtime/')).url = resourceUrl(
			layout,
			product,
			RUNTIME_SCRIPT_PATH,
		);
		writeJson(nodePath, node);
	}
}

function writeProductEvidence(root, productId, sourceRevision, {
	appDocument,
	main,
	prelude,
	preload,
	renderer,
	rendererDocument,
}) {
	const documents = [
		productFile(undefined, 'app.asar/desktop/window.html', 'app/desktop/window.html', appDocument),
		productFile(undefined, 'renderer/index.html', 'renderer/index.html', rendererDocument),
	];
	const scripts = [
		productFile('main', 'app.asar/desktop/main.mjs', 'app/desktop/main.mjs', main),
		productFile('preload', 'app.asar/desktop/preload.js', 'app/desktop/preload.js', preload),
		productFile('renderer', 'renderer/assets/app.js', 'renderer/assets/app.js', renderer),
		productFile(
			'renderer',
			`renderer/${MACRO_PRELUDE_ARTIFACT}`,
			`renderer/${MACRO_PRELUDE_ARTIFACT}`,
			prelude,
		),
	];
	const excludedRuntimeScripts = [resourceFile(RUNTIME_SCRIPT_PATH, RUNTIME_SCRIPT_SOURCE)];
	writeJson(join(root, 'manifest.json'), {
		schemaVersion: 3,
		kind: 'soundscaper-e2e-product-build-evidence',
		productId,
		sourceRevision,
		packageArchive: { byteLength: 123, sha256: hash(`${productId} archive`) },
		executableResources: resourceIdentity({ documents, excludedRuntimeScripts, scripts }),
		excludedRuntimeScripts,
		documents,
		scripts,
		sourceMaps: [productFile(
			undefined,
			undefined,
			'renderer-source-maps/app.js.map',
			readFileSync(join(root, 'renderer-source-maps/app.js.map')),
		)],
	});
}

export function refreshPackagedResourceIdentity(fixture, productId) {
	const manifestPath = join(fixture.evidenceRoot, 'electron', productId, 'manifest.json');
	const manifest = readJson(manifestPath);
	manifest.executableResources = resourceIdentity(manifest);
	writeJson(manifestPath, manifest);
	const profilePath = join(fixture.runRoot, `coverage/v8-packaged/packaged-${productId}.json`);
	const profile = readJson(profilePath);
	profile['soundscaper-packaged-runtime'].executableResources.beforeLaunch = {
		...manifest.executableResources,
	};
	profile['soundscaper-packaged-runtime'].executableResources.afterCollection = {
		...manifest.executableResources,
	};
	writeJson(profilePath, profile);
	return manifest;
}

function resourceIdentity({ documents, excludedRuntimeScripts, scripts }) {
	return packagedExecutableResourceIdentity([
		...scripts.filter(({ realm }) => realm === 'renderer').map(({ packagedPath: path, byteLength, sha256 }) => ({
			path, byteLength, sha256,
		})),
		...documents.filter(({ packagedPath }) => !packagedPath.startsWith('app.asar/'))
			.map(({ packagedPath: path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
		...excludedRuntimeScripts,
	].sort((left, right) => left.path.localeCompare(right.path)));
}

function resourceFile(path, value) {
	const bytes = Buffer.from(value);
	return { path, byteLength: bytes.byteLength, sha256: hash(bytes) };
}

function resourceUrl(layout, product, path) {
	return `${layout.url(product, '').replace(/app\.asar\/$/u, '')}${path}`;
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

export function relocateSourceMapCheckout(evidenceRoot) {
	for (const product of PRODUCTS) {
		for (const relativePath of [
			`browser/${product}/source-maps/app.js.map`,
			`electron/${product}/renderer-source-maps/app.js.map`,
		]) {
			const path = join(evidenceRoot, relativePath);
			const map = readJson(path);
			map.sources = [`file:///D:/a/Soundscaper/Soundscaper/src/${product}-entry.js`];
			writeJson(path, map);
		}
		const electronRoot = join(evidenceRoot, 'electron', product);
		const manifestPath = join(electronRoot, 'manifest.json');
		const manifest = readJson(manifestPath);
		const mapRecord = manifest.sourceMaps[0];
		const bytes = readFileSync(join(electronRoot, mapRecord.artifactPath));
		mapRecord.byteLength = bytes.byteLength;
		mapRecord.sha256 = hash(bytes);
		writeJson(manifestPath, manifest);
		const browserRoot = join(evidenceRoot, 'browser', product);
		const browserManifestPath = join(browserRoot, 'site/.browser-product-build.json');
		const browserManifest = readJson(browserManifestPath);
		const browserMap = readFileSync(join(browserRoot, 'source-maps/app.js.map'));
		browserManifest.sourceMaps['app.js.map'] = {
			byteLength: browserMap.byteLength,
			sha256: hash(browserMap),
		};
		writeJson(browserManifestPath, browserManifest);
	}
}

export function recordBrowserEvidence(site, productId, sourceRevision) {
	const files = {};
	for (const path of walk(site).filter((path) => !path.endsWith('/.browser-product-build.json'))) {
		const relativePath = path.slice(site.length + 1).replaceAll('\\', '/');
		const bytes = readFileSync(path);
		files[relativePath] = { byteLength: bytes.byteLength, sha256: hash(bytes) };
	}
	const sourceMaps = {};
	const mapRoot = join(site, '../source-maps');
	for (const path of walk(mapRoot)) {
		const relativePath = path.slice(mapRoot.length + 1).replaceAll('\\', '/');
		const bytes = readFileSync(path);
		sourceMaps[relativePath] = { byteLength: bytes.byteLength, sha256: hash(bytes) };
	}
	writeJson(join(site, '.browser-product-build.json'), {
		schemaVersion: 2,
		productId,
		origin: `http://127.0.0.1:${productId === 'soundscaper' ? '4322' : '4323'}`,
		sourceRevision,
		files,
		sourceMaps,
	});
}

export function sourceMapFor(sourcePath, source) {
	return {
		version: 3,
		file: 'app.js',
		sourceRoot: '',
		sources: [`file:///old/checkout/${sourcePath}`],
		names: [],
		mappings: 'AAAA',
		x_soundscaper_source_sha256: [hash(source)],
	};
}

function portableMap(map, sourcePath, source) {
	return {
		...map,
		sources: [`file:///__soundscaper_repo__/${sourcePath}`],
		sourcesContent: [source],
	};
}

export function v8Entry(url) {
	return {
		scriptId: '1',
		url,
		functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 1, count: 1 }] }],
	};
}

export function sourceLineLengths(value) {
	return value.replace(/\n$/u, '').split('\n').map((line) => line.length);
}

export function readProfiles(directory) {
	return walk(directory).filter((path) => path.endsWith('.json')).map(readJson);
}

export function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
	write(path, `${JSON.stringify(value, null, '\t')}\n`);
}

export function write(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value);
}

function walk(root) {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}

export function hash(value) {
	return createHash('sha256').update(value).digest('hex');
}

export function commitFixtureRepository(repositoryRoot) {
	for (const args of [
		['init', '--quiet'],
		['config', 'user.name', 'Coverage Fixture'],
		['config', 'user.email', 'coverage@example.invalid'],
		['add', 'src'],
		['commit', '--quiet', '-m', 'fixture'],
	]) {
		const outcome = spawnSync('git', args, {
			cwd: repositoryRoot,
			env: {
				...process.env,
				GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
				GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
			},
			encoding: 'utf8',
		});
		assert.equal(outcome.status, 0, outcome.stderr);
	}
	return spawnSync('git', ['rev-parse', 'HEAD'], {
		cwd: repositoryRoot,
		encoding: 'utf8',
	}).stdout.trim();
}
