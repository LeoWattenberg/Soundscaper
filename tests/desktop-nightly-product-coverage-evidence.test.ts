/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	asarNativeEntryPath,
	preserveDesktopNightlyProductCoverageEvidence,
} from '../scripts/lib/desktop-nightly-product-coverage-evidence.mjs';
import {
	createCoverageFixture, KOKORO_RUNTIME_SCRIPT, RENDERER_WASM, REVISION, RUNTIME_SCRIPT,
	RUNTIME_WASM, STARTUP_JSON_DOCUMENT, WASM,
} from './helpers/desktop-nightly-product-coverage-fixture.ts';

test('nightly product coverage evidence preserves every executable and renderer map', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-evidence-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const { buildRoot, files, productOutput } = await createCoverageFixture(workspace, {
		rendererDocument: STARTUP_JSON_DOCUMENT,
	});

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

test('nightly product coverage evidence admits authenticated Kokoro G2P scripts', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-kokoro-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const fixture = await createCoverageFixture(workspace, { kokoroRuntimeAuthority: true });
	const manifest = await preserveDesktopNightlyProductCoverageEvidence({
		buildRoot: fixture.buildRoot,
		productId: 'soundscaper',
		productOutput: fixture.productOutput,
		sourceRevision: REVISION,
	});
	const expectedContents = fixture.files.get(`runtime/${KOKORO_RUNTIME_SCRIPT}`) ?? '';
	assert.deepEqual(
		manifest.excludedRuntimeScripts.find(({ path }) => path === `runtime/${KOKORO_RUNTIME_SCRIPT}`),
		{
			path: `runtime/${KOKORO_RUNTIME_SCRIPT}`,
			byteLength: Buffer.byteLength(expectedContents),
			sha256: createHash('sha256').update(expectedContents).digest('hex'),
		},
	);
});

test('nightly product coverage evidence binds Kokoro G2P scripts to the staged authority',
	async (context) => {
		await context.test('stage receipt mismatch', async (childContext) => {
			const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-kokoro-receipt-'));
			childContext.after(() => rm(workspace, { recursive: true, force: true }));
			const fixture = await createCoverageFixture(workspace, { kokoroRuntimeAuthority: true });
			const stagePath = join(fixture.buildRoot, 'stage-manifest.json');
			const stage = JSON.parse(await readFile(stagePath, 'utf8'));
			stage.kokoroG2pRuntime.manifest.sha256 = '0'.repeat(64);
			await writeFile(stagePath, `${JSON.stringify(stage, null, 2)}\n`);
			await assert.rejects(preserveDesktopNightlyProductCoverageEvidence({
				buildRoot: fixture.buildRoot,
				productId: 'soundscaper',
				productOutput: fixture.productOutput,
				sourceRevision: REVISION,
			}), /Kokoro G2P runtime differs from its stage authority/u);
		});

		await context.test('runtime script substitution', async (childContext) => {
			const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-kokoro-script-'));
			childContext.after(() => rm(workspace, { recursive: true, force: true }));
			const fixture = await createCoverageFixture(workspace, { kokoroRuntimeAuthority: true });
			const substituted = 'globalThis.substituted = true;\n';
			await writeFile(join(fixture.buildRoot, 'runtime', KOKORO_RUNTIME_SCRIPT), substituted);
			await writeFile(join(
				fixture.productOutput,
				'linux-unpacked/resources/runtime',
				KOKORO_RUNTIME_SCRIPT,
			), substituted);
			await assert.rejects(preserveDesktopNightlyProductCoverageEvidence({
				buildRoot: fixture.buildRoot,
				productId: 'soundscaper',
				productOutput: fixture.productOutput,
				sourceRevision: REVISION,
			}), /runtime script differs from its approved authority/u);
		});
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
