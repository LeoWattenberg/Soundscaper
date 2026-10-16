/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS, resolveRelativeModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const IMAGING = ROOT + 'src/common/editor/imaging/';
const NATIVE = 'editor-native-image-develop', GPU = 'editor-image-develop-gpu';
const HOSTS = ['image-develop-gpu-current-v1.ts', 'pixel-frame-webgl2-current-v1.ts', 'pixel-frame-webgl2-global-current-v1.ts',
	'pixel-frame-webgl2-color-current-v1.ts', 'linear-curve-metadata-current-v1.ts', 'image-develop-gpu-plan-current-v1.ts',
	'pixel-frame-webgl2-pass-current-v1.ts', 'pixel-frame-webgl2-lut-current-v1.ts', 'linear-cube-lut-sampling-current-v1.ts',
	'pixel-frame-webgl2-geometry-current-v1.ts', 'pixel-frame-webgl2-pipeline-current-v1.ts', 'pixel-frame-webgl2-optics-current-v1.ts',
	'pixel-frame-webgl2-spatial-current-v1.ts', 'pixel-frame-webgl2-mask-plan-current-v1.ts',
	'pixel-frame-webgl2-mask-graph-current-v1.ts', 'pixel-frame-webgl2-mask-node-current-v1.ts'];
const CONTEXT = 'pixel-frame-webgl2-context-current-v1.ts';
const EXECUTION = [CONTEXT, 'pixel-frame-webgl2-numeric-current-v1.ts', 'pixel-frame-webgl2-chroma-glsl-current-v1.ts',
	'pixel-frame-webgl2-curves-glsl-current-v1.ts', 'pixel-frame-webgl2-color-glsl-current-v1.ts', 'pixel-frame-webgl2-lut-glsl-current-v1.ts',
	'pixel-frame-webgl2-geometry-glsl-current-v1.ts', 'pixel-frame-webgl2-reference-current-v1.ts', 'pixel-frame-webgl2-optics-glsl-current-v1.ts',
	'pixel-frame-webgl2-spatial-glsl-current-v1.ts', 'pixel-frame-webgl2-spatial-neighborhood-glsl-current-v1.ts', 'pixel-frame-webgl2-spatial-lattice-glsl-current-v1.ts',
	'pixel-frame-webgl2-mask-node-glsl-current-v1.ts', 'pixel-frame-webgl2-mask-path-glsl-current-v1.ts', 'pixel-frame-webgl2-mask-feather-glsl-current-v1.ts'];
function source(path: string): string { return transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code; }
function exactOwner(name: string, expected: string): void {
	for (const path of [IMAGING + name, (IMAGING + name).replaceAll('/', '\\')]) {
		assert.equal(chunkGroupForModulePath(path), expected, path);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), expected, path);
	}
	for (const replacement of ['-current-v2.ts', '-future-current-v1.ts', '-current-v10.ts']) {
		assert.notEqual(chunkGroupForModulePath(IMAGING + name.replace('-current-v1.ts', replacement)), expected);
	}
	for (const directory of ['src/framescaper/imaging/', 'src/lightscaper/imaging/', 'src/common/editor/foreign/']) {
		assert.notEqual(chunkGroupForModulePath(ROOT + directory + name), expected);
	}
}
function optional(owner: string): void {
	const group = chunkGroups.find(value => value.name === owner); assert.ok(group, owner);
	assert.equal(group.priority, 99); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
	assert.equal(group.includeDependenciesRecursively, false); assert.equal(EAGER_CHUNK_GROUPS.has(owner), false);
}

test('GPU broker, native host and authenticated global preparation share the existing optional native Develop owner', () => {
	for (const name of HOSTS) exactOwner(name, NATIVE);
	optional(NATIVE);
	assert.equal(chunkGroupForModulePath(IMAGING + 'image-develop-linear-current-v1.ts'), NATIVE);
	assert.equal(chunkGroupForModulePath(IMAGING + 'image-develop-linear-metadata-current-v1.ts'), 'editor-imaging');
});

test('actual native WebGL2 execution, color shaders and precision verification have the separately lazy exact GPU owner', () => {
	for (const module of EXECUTION) exactOwner(module, GPU); optional(GPU);
	for (const name of [...HOSTS, 'pixel-frame-webgl2-probe-current-v1.ts', 'pixel-frame-webgl2-context-v1.ts',
		'pixel-frame-webgl2-context-current-v2.ts', 'pixel-frame-linear-global-v1.ts', 'image-develop-linear-metadata-current-v1.ts']) {
		assert.notEqual(chunkGroupForModulePath(IMAGING + name), GPU, name);
	}
});

test('native host defers actual context initialization until after its synchronous owned source capture', () => {
	const host = source(IMAGING + 'pixel-frame-webgl2-current-v1.ts'), dependencies = staticRelativeDependencies(host);
	assert.ok(!dependencies.includes('./' + CONTEXT), 'A normal native Develop load must not acquire the executable GL owner.');
	assert.match(host, /import\(["']\.\/pixel-frame-webgl2-context-current-v1\.ts["']\)/u);
	assert.ok(host.indexOf('Float32Array.prototype.set.call') < host.indexOf(`import("./${CONTEXT}")`), 'Source capture must precede the optional GL loading await.');
	assert.ok(staticRelativeDependencies(source(IMAGING + HOSTS[0]!)).includes('./pixel-frame-webgl2-current-v1.ts'));
});

test('the optional GPU execution closure has no static product/UI back edge or nested context impostor', () => {
	const pending = [IMAGING + CONTEXT], seen = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
		assert.doesNotMatch(path, /\/src\/(?:framescaper|lightscaper)\/|\/src\/common\/editor\/ui\//u, path);
		const code = source(path);
		for (const specifier of staticRelativeDependencies(code)) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	assert.ok(seen.has(IMAGING + 'pixel-frame-webgl2-global-current-v1.ts'));
	assert.ok(seen.has(IMAGING + 'pixel-frame-linear-global-v1.ts'));
	assert.equal(seen.has(IMAGING + 'image-develop-gpu-current-v1.ts'), false, 'Context execution cannot statically cycle into its broker.');
});
