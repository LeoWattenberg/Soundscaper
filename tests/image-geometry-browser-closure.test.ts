/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build, type Metafile } from 'esbuild';
import { NIGHTLY_TEST_PAYLOAD_INPUTS, NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';
import configuration from '../electron-builder.nightly-tests.config.cjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), SPEC = 'tests/browser/framescaper-image-geometry.spec.js';
const HELPER = 'tests/helpers/image-geometry-native-fixture.ts';
type Input = Readonly<{ source: string; destination: string; kind: string; exclude?: ReadonlySet<string> }>;
let graphs: Promise<{ spec: Metafile; native: Metafile }> | undefined;
function actualGraphs() {
	return graphs ??= Promise.all([build({ absWorkingDir: ROOT, entryPoints: [SPEC], bundle: true, write: false, metafile: true,
		platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' }), build({ absWorkingDir: ROOT, entryPoints: [HELPER],
		bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' })])
		.then(([spec, native]) => ({ spec: spec.metafile, native: native.metafile }));
}

test('the maintained geometry native spec and exact new-URL helper retain their actual staging closure', async () => {
	const source = await readFile(resolve(ROOT, SPEC), 'utf8');
	assert.match(source, /new URL\('\.\.\/helpers\/image-geometry-native-fixture\.ts', import\.meta\.url\)/u);
	const { spec, native } = await actualGraphs();
	assert.deepEqual(Object.keys(native.inputs).filter(path => path.startsWith('tests/helpers/')), [HELPER]);
	for (const path of ['src/common/editor/imaging/pixel-frame-geometry-v1.ts', 'src/common/editor/ui/video-preview-compositor.js',
		'src/framescaper/editor-video-exact-browser-effects-finishing.ts']) assert.ok(Object.hasOwn(native.inputs, path), path);
	assertAdmitted(spec, NIGHTLY_TEST_PAYLOAD_INPUTS); assertAdmitted(native, NIGHTLY_TEST_PAYLOAD_INPUTS);
});

test('omitting the one native geometry helper refuses the actual graph instead of widening helper directories', async () => {
	const { native } = await actualGraphs();
	assert.throws(() => assertAdmitted(native, NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source !== HELPER)), /image-geometry-native-fixture/u);
	assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(input => input.source === 'tests/helpers' && input.kind === 'directory'), false);
});

test('native geometry emits no Node or unresolved runtime imports and is an exact strict root', async () => {
	const { native } = await actualGraphs();
	const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
	for (const output of Object.values(native.outputs)) for (const dependency of output.imports) {
		assert.equal(builtins.has(dependency.path), false); assert.equal(dependency.external, false, dependency.path);
	}
	const config = JSON.parse(await readFile(resolve(ROOT, 'tsconfig.tests.json'), 'utf8')) as { include: string[] };
	assert.ok(config.include.includes(HELPER)); assert.equal(config.include.includes('tests/helpers/**/*.ts'), false);
});

function assertAdmitted(graph: Metafile, inputs: readonly Input[]): void {
	const missing: string[] = [];
	assert.ok(Array.isArray(configuration.extraResources));
	const payload = configuration.extraResources.find(resource => typeof resource === 'object' && resource.to === 'nightly-tests');
	assert.ok(payload && typeof payload === 'object' && Array.isArray(payload.filter));
	for (const input of Object.keys(graph.inputs)) {
		const path = relative(ROOT, resolve(ROOT, input)).split(sep).join('/');
		if (path.startsWith('node_modules/')) {
			assert.ok(NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.includes(packageOf(path.slice('node_modules/'.length))), path); continue;
		}
		const row = inputs.find(row => row.kind === 'file' ? path === row.source
			: path.startsWith(`${row.source}/`) && !row.exclude?.has(path.slice(row.source.length + 1).split('/')[0]!));
		if (!row) { missing.push(path); continue; }
		assert.equal(row.kind === 'file' ? row.destination : row.destination + path.slice(row.source.length), path);
		assert.ok(payload.filter.some(pattern => matchesGlob(path, pattern)), `Package drops native geometry file ${path}`);
	}
	for (const output of Object.values(graph.outputs)) for (const dependency of output.imports) {
		if (!dependency.external || builtinModules.includes(dependency.path) || dependency.path.startsWith('node:')) continue;
		assert.equal(isAbsolute(dependency.path) || dependency.path.startsWith('.'), false, dependency.path);
		assert.ok(NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.includes(packageOf(dependency.path)), dependency.path);
	}
	assert.deepEqual(missing, [], `Missing native geometry payload: ${missing.join(', ')}`);
}
function packageOf(path: string): string { return path.startsWith('@') ? path.split('/').slice(0, 2).join('/') : path.split('/')[0]!; }
