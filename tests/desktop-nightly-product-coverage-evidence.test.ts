/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPackage } from '@electron/asar';

import { assistanceNativeRuntimeStageSummary } from '../desktop/assistance-native-runtime-payload.mjs';
import { DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS } from '../desktop/renderer-smoke-execution.js';
import {
	asarNativeEntryPath,
	preserveDesktopNightlyProductCoverageEvidence,
} from '../scripts/lib/desktop-nightly-product-coverage-evidence.mjs';

const REVISION = '0123456789abcdef0123456789abcdef01234567';
const DYNAMIC_EXCLUSIONS = Object.values(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS)
	.filter(({ products }) => products.includes('soundscaper'))
	.map(({ marker, pathPrefix }, index) => (
		`export const dynamic_recipe_${index} = ${JSON.stringify(`${marker}\n${pathPrefix}`)};`
	)).join('\n');
const RUNTIME_SCRIPT = [
	'assistance/sherpa-onnx/1.13.5/node_modules',
	'sherpa-onnx-node/sherpa-onnx.js',
].join('/');
const RENDERER_WASM = 'renderer/assets/sqlite3-fixture.wasm';
const RUNTIME_WASM = 'runtime/model/engine.wasm';
const WASM = '\u0000asm\u0001\u0000\u0000\u0000';

test('nightly product coverage evidence preserves every executable and renderer map', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-evidence-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const { buildRoot, files, productOutput } = await createCoverageFixture(workspace);

	const manifest = await preserveDesktopNightlyProductCoverageEvidence({
		buildRoot,
		productId: 'soundscaper',
		productOutput,
		sourceRevision: REVISION,
	});

	assert.equal(manifest.schemaVersion, 4);
	assert.equal(manifest.productId, 'soundscaper');
	assert.equal(manifest.sourceRevision, REVISION);
	assert.match(manifest.packageArchive.sha256, /^[0-9a-f]{64}$/u);
	assert.equal(manifest.executableResources.fileCount, 6);
	assert.equal(
		manifest.executableResources.totalBytes,
		[...files]
			.filter(([name]) => /(?:\.(?:c|m)?js|\.html?|\.wasm)$/u.test(name)
				&& (name.startsWith('renderer/') || name === `runtime/${RUNTIME_SCRIPT}`
					|| name === RUNTIME_WASM))
			.reduce((total, [, contents]) => total + Buffer.byteLength(contents), 0),
	);
	assert.match(manifest.executableResources.sha256, /^[0-9a-f]{64}$/u);
	assert.deepEqual(manifest.excludedRuntimeScripts, [{
		path: `runtime/${RUNTIME_SCRIPT}`,
		byteLength: Buffer.byteLength(files.get(`runtime/${RUNTIME_SCRIPT}`) ?? ''),
		sha256: createHash('sha256')
			.update(files.get(`runtime/${RUNTIME_SCRIPT}`) ?? '')
			.digest('hex'),
	}]);
	assert.deepEqual(manifest.webAssemblyResources.map(({
		packagedPath, artifactPath, byteLength,
	}) => ({ packagedPath, artifactPath, byteLength })), [
		{ packagedPath: RENDERER_WASM, artifactPath: `webassembly/${RENDERER_WASM}`, byteLength: 8 },
		{ packagedPath: RUNTIME_WASM, artifactPath: `webassembly/${RUNTIME_WASM}`, byteLength: 8 },
	]);
	for (const resource of manifest.webAssemblyResources) {
		assert.deepEqual(
			await readFile(join(productOutput, 'e2e-coverage', resource.artifactPath)),
			Buffer.from(WASM),
		);
	}
	assert.deepEqual(manifest.documents.map(({ packagedPath, artifactPath }) => ({
		packagedPath, artifactPath,
	})), [
		{
			packagedPath: 'app.asar/desktop/window.html',
			artifactPath: 'app/desktop/window.html',
		},
		{
			packagedPath: 'renderer/index.html',
			artifactPath: 'renderer/index.html',
		},
	]);
	assert.deepEqual(manifest.scripts.map(({ realm, packagedPath, artifactPath }) => ({
		realm, packagedPath, artifactPath,
	})), [
		{
			realm: 'main',
			packagedPath: 'app.asar/desktop/main.mjs',
			artifactPath: 'app/desktop/main.mjs',
		},
		{
			realm: 'preload',
			packagedPath: 'app.asar/desktop/preload.cjs',
			artifactPath: 'app/desktop/preload.cjs',
		},
		{
			realm: 'renderer',
			packagedPath: 'renderer/assets/editor-abc.js',
			artifactPath: 'renderer/assets/editor-abc.js',
		},
		{
			realm: 'renderer',
			packagedPath: 'renderer/desktop-renderer-smoke.js',
			artifactPath: 'renderer/desktop-renderer-smoke.js',
		},
	]);
	for (const script of manifest.scripts) {
		const contents = await readFile(join(productOutput, 'e2e-coverage', script.artifactPath));
		assert.equal(script.byteLength, contents.byteLength);
		assert.equal(script.sha256, createHash('sha256').update(contents).digest('hex'));
	}
	assert.deepEqual(manifest.sourceMaps, [
		'desktop-renderer-smoke.js.map', 'editor-abc.js.map',
	].map((name) => ({
		artifactPath: `renderer-source-maps/${name}`,
		byteLength: files.get(`renderer-source-maps/${name}`)?.length,
		sha256: createHash('sha256')
			.update(files.get(`renderer-source-maps/${name}`) ?? '')
			.digest('hex'),
	})));
	assert.deepEqual(
		JSON.parse(await readFile(join(productOutput, 'e2e-coverage/manifest.json'), 'utf8')),
		manifest,
	);
	await writeFile(join(buildRoot, 'app/desktop/main.mjs'), 'changed after packaging\n');
	await assert.rejects(
		preserveDesktopNightlyProductCoverageEvidence({
			buildRoot,
			productId: 'soundscaper',
			productOutput,
			sourceRevision: REVISION,
		}),
		/packaged app\.asar\/desktop\/main\.mjs differs/u,
	);
});

test('nightly product coverage evidence finds a macOS Contents/Resources archive', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-mac-resources-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const fixture = await createCoverageFixture(workspace, {
		packagedResourcesPath: 'mac-arm64/Soundscaper.app/Contents/Resources',
	});
	const manifest = await preserveDesktopNightlyProductCoverageEvidence({
		buildRoot: fixture.buildRoot,
		productId: 'soundscaper',
		productOutput: fixture.productOutput,
		sourceRevision: REVISION,
	});
	assert.match(manifest.packageArchive.sha256, /^[0-9a-f]{64}$/u);
});

test('nightly product coverage evidence uses native ASAR entry separators', () => {
	const entry = 'desktop/project-library-runtime/desktop/main.mjs';
	assert.equal(asarNativeEntryPath(entry, '\\'), 'desktop\\project-library-runtime\\desktop\\main.mjs');
	assert.equal(asarNativeEntryPath(entry, '/'), entry);
});

test('nightly product coverage evidence refuses an uninventoried app.asar script', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-extra-asar-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const fixture = await createCoverageFixture(workspace, {
		packagedApplicationExtras: new Map([['desktop/hidden.js', 'globalThis.hidden = true;\n']]),
	});

	await assert.rejects(
		preserveDesktopNightlyProductCoverageEvidence({
			buildRoot: fixture.buildRoot,
			productId: 'soundscaper',
			productOutput: fixture.productOutput,
			sourceRevision: REVISION,
		}),
		/app\.asar executable scripts differ from the staged application/u,
	);
});

test('nightly product coverage evidence refuses an uninventoried app.asar document', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-extra-asar-html-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const fixture = await createCoverageFixture(workspace, {
		packagedApplicationExtras: new Map([['desktop/hidden.html', '<main>hidden</main>\n']]),
	});
	await assert.rejects(
		preserveDesktopNightlyProductCoverageEvidence({
			buildRoot: fixture.buildRoot,
			productId: 'soundscaper',
			productOutput: fixture.productOutput,
			sourceRevision: REVISION,
		}),
		/app\.asar documents differ from the staged application/u,
	);
});

test('nightly product coverage evidence admits the same pinned runtime closure for Framescaper', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'framescaper-nightly-coverage-runtime-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const fixture = await createCoverageFixture(workspace, { productId: 'framescaper' });
	const manifest = await preserveDesktopNightlyProductCoverageEvidence({
		buildRoot: fixture.buildRoot,
		productId: 'framescaper',
		productOutput: fixture.productOutput,
		sourceRevision: REVISION,
	});
	assert.deepEqual(manifest.excludedRuntimeScripts.map(({ path }) => path), [
		`runtime/${RUNTIME_SCRIPT}`,
	]);
});

test('nightly product coverage evidence admits an absent optional runtime without exclusions', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-no-runtime-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const fixture = await createCoverageFixture(workspace, { runtimeAuthority: false });
	const manifest = await preserveDesktopNightlyProductCoverageEvidence({
		buildRoot: fixture.buildRoot,
		productId: 'soundscaper',
		productOutput: fixture.productOutput,
		sourceRevision: REVISION,
	});
	assert.deepEqual(manifest.excludedRuntimeScripts, []);
	assert.equal(manifest.executableResources.fileCount, 5);
});

test('nightly product coverage evidence refuses uninventoried and unapproved resource scripts', async (context) => {
	for (const [label, options, expected] of [
		[
			'uninventoried renderer',
			{ packagedResourceExtras: new Map([['renderer/injected.js', 'globalThis.injected = true;\n']]) },
			/executable resources differ from the staged renderer and runtime/u,
		],
		[
			'uninventoried renderer document',
			{ packagedResourceExtras: new Map([['renderer/injected.html', '<main>injected</main>\n']]) },
			/executable resources differ from the staged renderer and runtime/u,
		],
		[
			'uninventoried WebAssembly',
			{ packagedResourceExtras: new Map([['renderer/injected.wasm', WASM]]) },
			/executable resources differ from the staged renderer and runtime/u,
		],
		[
			'unapproved runtime package',
			{
				runtimeScripts: new Map([
					[RUNTIME_SCRIPT, 'module.exports = true;\n'],
					['assistance/onnxruntime-node/1.29.0/linux-x64/node_modules/not-reviewed/index.js', 'void 0;\n'],
				]),
			},
			/runtime script is not an approved third-party exclusion/u,
		],
	] as const) {
		await context.test(label, async (childContext) => {
			const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-extra-resource-'));
			childContext.after(() => rm(workspace, { recursive: true, force: true }));
			const fixture = await createCoverageFixture(workspace, options);
			await assert.rejects(
				preserveDesktopNightlyProductCoverageEvidence({
					buildRoot: fixture.buildRoot,
					productId: 'soundscaper',
					productOutput: fixture.productOutput,
					sourceRevision: REVISION,
				}),
				expected,
			);
		});
	}
});

test('nightly product coverage evidence rejects packaged WebAssembly byte substitution', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-wasm-mismatch-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const fixture = await createCoverageFixture(workspace);
	await writeFile(join(
		fixture.productOutput, 'linux-unpacked/resources', RENDERER_WASM,
	), Buffer.from([...Buffer.from(WASM).slice(0, -1), 1]));
	await assert.rejects(preserveDesktopNightlyProductCoverageEvidence({
		buildRoot: fixture.buildRoot,
		productId: 'soundscaper',
		productOutput: fixture.productOutput,
		sourceRevision: REVISION,
	}), /packaged renderer\/assets\/sqlite3-fixture\.wasm differs/u);
});

test('nightly product coverage evidence refuses inline executable HTML', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-inline-html-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const fixture = await createCoverageFixture(workspace, {
		rendererDocument: '<button onclick="globalThis.hidden = true">Run</button>\n',
	});
	await assert.rejects(
		preserveDesktopNightlyProductCoverageEvidence({
			buildRoot: fixture.buildRoot,
			productId: 'soundscaper',
			productOutput: fixture.productOutput,
			sourceRevision: REVISION,
		}),
		/unattested executable-string primitive.*inline HTML executable attribute/iu,
	);
});

test('nightly product coverage evidence refuses a renderer build without maps', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-maps-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const buildRoot = join(workspace, '.desktop-build');
	await mkdir(join(buildRoot, 'app/desktop'), { recursive: true });
	await mkdir(join(buildRoot, 'renderer/assets'), { recursive: true });
	await writeFile(join(buildRoot, 'app/desktop/main.mjs'), 'void 0;\n');
	await writeFile(join(buildRoot, 'renderer/assets/editor.js'), 'void 0;\n');

	await assert.rejects(
		preserveDesktopNightlyProductCoverageEvidence({
			buildRoot,
			productId: 'framescaper',
			productOutput: join(workspace, 'release', 'framescaper'),
			sourceRevision: REVISION,
		}),
		/renderer source maps/iu,
	);
});

interface CoverageFixtureOptions {
	readonly packagedApplicationExtras?: ReadonlyMap<string, string>;
	readonly packagedResourceExtras?: ReadonlyMap<string, string>;
	readonly packagedResourcesPath?: string;
	readonly productId?: 'soundscaper' | 'framescaper';
	readonly rendererDocument?: string;
	readonly runtimeAuthority?: boolean;
	readonly runtimeScripts?: ReadonlyMap<string, string>;
}

async function createCoverageFixture(workspace: string, options: CoverageFixtureOptions = {}) {
	const buildRoot = join(workspace, '.desktop-build');
	const productId = options.productId ?? 'soundscaper';
	const productOutput = join(workspace, 'release', productId);
	const runtimeAuthority = options.runtimeAuthority ?? true;
	const runtimeScripts = options.runtimeScripts ?? new Map(runtimeAuthority
		? [[RUNTIME_SCRIPT, 'module.exports = true;\n']]
		: []);
	const files = new Map([
		['app/desktop/main.mjs', `export const main = true;\n${DYNAMIC_EXCLUSIONS}\n`],
		['app/desktop/preload.cjs', 'module.exports = true;\n'],
		['app/desktop/window.html', '<script src="preload.cjs"></script>\n'],
		['app/desktop/ignored.json', '{}\n'],
		['renderer/assets/editor-abc.js', 'globalThis.editor = true;\n'],
		['renderer/desktop-renderer-smoke.js', 'export const smoke = true;\n'],
		[RENDERER_WASM, WASM],
		['renderer/index.html', options.rendererDocument ?? '<main></main>\n'],
		['renderer-source-maps/desktop-renderer-smoke.js.map', JSON.stringify({ version: 3, sources: [] })],
		['renderer-source-maps/editor-abc.js.map', JSON.stringify({ version: 3, sources: [] })],
		...[...runtimeScripts].map(([name, contents]) => [`runtime/${name}`, contents] as const),
		[RUNTIME_WASM, WASM],
	]);
	const nativeManifest = runtimeAuthority
		? assistanceNativeManifest(files.get(`runtime/${RUNTIME_SCRIPT}`) ?? '')
		: null;
	if (nativeManifest !== null) {
		files.set(
			'app/config/assistance-native-runtime-manifest.json',
			`${JSON.stringify(nativeManifest, null, 2)}\n`,
		);
	}
	for (const [name, contents] of files) await write(join(buildRoot, name), contents);
	await write(join(buildRoot, 'stage-manifest.json'), `${JSON.stringify({
		schemaVersion: 1,
		productId,
		sourceRevision: REVISION,
		target: { platform: 'linux', arch: 'x64' },
		...(nativeManifest === null ? {} : {
			assistanceNativeRuntime: assistanceNativeRuntimeStageSummary(nativeManifest, 'linux-x64'),
		}),
	}, null, 2)}\n`);
	const resources = join(productOutput, options.packagedResourcesPath ?? 'linux-unpacked/resources');
	for (const [name, contents] of files) {
		if (name.startsWith('renderer/') || name.startsWith('runtime/')) {
			await write(join(resources, name), contents);
		}
	}
	for (const [name, contents] of options.packagedResourceExtras ?? []) {
		await write(join(resources, name), contents);
	}
	const packagedApplicationRoot = join(workspace, 'packaged-app');
	for (const [name, contents] of files) {
		if (name.startsWith('app/')) await write(join(packagedApplicationRoot, name.slice(4)), contents);
	}
	for (const [name, contents] of options.packagedApplicationExtras ?? []) {
		await write(join(packagedApplicationRoot, name), contents);
	}
	await createPackage(packagedApplicationRoot, join(resources, 'app.asar'));
	return { buildRoot, files, productOutput };
}

async function write(path: string, contents: string) {
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, contents);
}

function assistanceNativeManifest(script: string) {
	const descriptor = (contents: string) => ({
		byteLength: Buffer.byteLength(contents),
		sha256: createHash('sha256').update(contents).digest('hex'),
	});
	const generated = (id: string) => ({ id, status: 'package-generated', blockedBy: null });
	return {
		schemaVersion: 1,
		runtimeId: 'sherpa-onnx-node',
		version: '1.13.5',
		runtimePrefix: 'assistance/sherpa-onnx/1.13.5',
		commonPackage: {
			name: 'sherpa-onnx-node',
			version: '1.13.5',
			sourceUrl: 'https://registry.npmjs.org/sherpa-onnx-node/-/sherpa-onnx-node-1.13.5.tgz',
			integrity: 'sha512-AAAA',
			entry: 'sherpa-onnx.js',
			files: { 'sherpa-onnx.js': descriptor(script) },
		},
		targets: {
			'linux-x64': {
				id: 'linux-x64',
				status: 'built',
				package: {
					name: 'sherpa-onnx-linux-x64',
					version: '1.13.5',
					sourceUrl: 'https://registry.npmjs.org/sherpa-onnx-linux-x64/-/sherpa-onnx-linux-x64-1.13.5.tgz',
					integrity: 'sha512-AAAA',
					files: { 'sherpa-onnx.node': descriptor('native') },
				},
			},
			'linux-arm64': generated('linux-arm64'),
			'mac-arm64': generated('mac-arm64'),
			'win-x64': generated('win-x64'),
			'win-arm64': generated('win-arm64'),
		},
	};
}
