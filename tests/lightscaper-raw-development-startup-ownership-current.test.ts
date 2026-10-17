/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS, resolveRelativeModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EDITOR = ROOT + 'src/common/editor/';
const PLAN = 'timeline-image-raw-encoded-plan-current-v1.ts';
const BODY = 'timeline-image-raw-encoded-current-v1.ts';
function dependencies(path: string): readonly string[] {
	return staticRelativeDependencies(transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code);
}

test('actual eager Frame RAW working admission imports the pure encoded plan instead of executable pack proof', () => {
	const working = ROOT + 'src/framescaper/internal/timeline-image-raw-working-plan-current-v1.ts';
	const imports = dependencies(working);
	assert.ok(!imports.includes('../../common/editor/' + BODY), 'Metadata-only startup must not acquire the encoded-body owner.');
	assert.ok(imports.includes('../../common/editor/' + PLAN), 'Frame scalar admission must share the actual encoded-binding plan.');
});

test('canonical, encoded and derived RAW body proof have the same exact optional owner', () => {
	const owner = 'editor-raw-original-proof';
	for (const name of ['timeline-image-raw-pack-current-v1.ts', BODY, 'timeline-image-raw-derived-current-v1.ts']) {
		for (const path of [EDITOR + name, (EDITOR + name).replaceAll('/', '\\')]) {
			assert.equal(chunkGroupForModulePath(path), owner, path);
			assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner, path);
		}
		assert.notEqual(chunkGroupForModulePath(EDITOR + name.replace('-current-v1.ts', '-future-current-v1.ts')), owner);
	}
	const group = chunkGroups.find(group => group.name === owner); assert.ok(group);
	assert.equal(group.priority, 99); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
	assert.equal(group.includeDependenciesRecursively, false); assert.equal(EAGER_CHUNK_GROUPS.has(owner), false);
});

test('recovery runtime and its executable asset pin have the exact optional RAW proof owner', () => {
	const owner = 'editor-raw-original-proof';
	const names = ['src/common/editor/raw/libraw-runtime-v2.ts', 'src/common/editor/raw/libraw-runtime-asset-v2.ts',
		'config/lightscaper-libraw-recovery-runtime-manifest.json'];
	for (const name of names) {
		for (const path of [ROOT + name, (ROOT + name).replaceAll('/', '\\')]) {
			assert.equal(chunkGroupForModulePath(path), owner, path);
			assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner, path);
		}
	}
	for (const name of ['libraw-runtime-v1.ts', 'libraw-runtime-v3.ts', 'libraw-runtime-asset-v1.ts', 'libraw-runtime-asset-v3.ts',
		'libraw-runtime-future-v2.ts', 'libraw-worker-v2.ts', 'libraw-wasm-instance-v2.ts', 'internal/raw-recovery-frame-authority-v1.ts']) {
		assert.notEqual(chunkGroupForModulePath(EDITOR + 'raw/' + name), owner, name);
	}
	for (const name of ['lightscaper-libraw-runtime-manifest.json', 'lightscaper-libraw-recovery-runtime-manifest-v2.json',
		'lightscaper-libraw-recovery-runtime-manifest.json.foreign', 'foreign-lightscaper-libraw-recovery-runtime-manifest.json']) {
		assert.notEqual(chunkGroupForModulePath(ROOT + 'config/' + name), owner, name);
	}
	const group = chunkGroups.find(value => value.name === owner); assert.ok(group);
	assert.equal(group.priority, 99); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
	assert.equal(group.includeDependenciesRecursively, false); assert.equal(EAGER_CHUNK_GROUPS.has(owner), false);
});

test('RAW proof recovery initialization has no static product dependency or unowned recovery runtime leaf', () => {
	const required = new Set([EDITOR + 'raw/libraw-runtime-v2.ts', EDITOR + 'raw/libraw-runtime-asset-v2.ts',
		ROOT + 'config/lightscaper-libraw-recovery-runtime-manifest.json']);
	const pending = ['timeline-image-raw-pack-current-v1.ts', BODY, 'timeline-image-raw-derived-current-v1.ts'].map(name => EDITOR + name);
	const seen = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
		// These shared executable leaves must not fall into the Frame reader's
		// chunk: the reader already imports their enclosing RAW proof owner.
		if (required.has(path)) assert.equal(chunkGroupForModulePath(path), 'editor-raw-original-proof', path);
		assert.doesNotMatch(path, /\/src\/(?:framescaper|lightscaper)\//u, path);
		if (path.endsWith('.json')) continue;
		for (const specifier of dependencies(path)) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	for (const path of required) assert.ok(seen.has(path), path);
});

test('raw model and native identity metadata are explicit shared leaves while execution admission stays optional', () => {
	for (const [name, owner] of [
		[PLAN, 'editor-imaging'],
		['internal/timeline-image-model-raw-kernel-v1.ts', 'editor-imaging'],
		['raw/internal/raw-recovery-frame-authority-v1.ts', 'editor-imaging'],
		['imaging/image-develop-raw-request-current-v1.ts', 'editor-native-image-develop'],
		['imaging/image-develop-raw-source-current-v1.ts', 'editor-native-image-develop'],
	] as const) {
		for (const path of [EDITOR + name, (EDITOR + name).replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(path), owner, path);
		assert.notEqual(chunkGroupForModulePath(EDITOR + name + '.foreign'), owner);
	}
	assert.equal(EAGER_CHUNK_GROUPS.has('editor-native-image-develop'), false);
});

test('Archive8 preset framing is an exact inert leaf in the existing archive byte owner', () => {
	const owner = 'editor-scape-archive-bytes', name = 'scape-photo-develop-preset-pack-v4.ts';
	for (const path of [EDITOR + name, (EDITOR + name).replaceAll('/', '\\')]) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
	}
	for (const suffix of ['v5', 'v40', 'future-v4']) {
		assert.notEqual(chunkGroupForModulePath(EDITOR + name.replace('v4.ts', suffix + '.ts')), owner);
	}
	assert.deepEqual(dependencies(EDITOR + name), []);
	const group = chunkGroups.find(value => value.name === owner); assert.ok(group);
	assert.equal(group.priority, 99); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
	assert.equal(group.includeDependenciesRecursively, false);
});

test('encoded scalar plan closure contains no decoder, native worker, Blob/range proof or native image execution', () => {
	assert.ok(existsSync(EDITOR + PLAN), 'The encoded scalar plan must have its own maintained metadata owner.');
	const pending = [EDITOR + PLAN], seen = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
		assert.doesNotMatch(path, /(?:\/raw\/(?:libraw-|internal\/raw-recovery)|timeline-image-raw-(?:pack|encoded|derived)-current-v1\.ts$|timeline-image-frame-pack-v1\.ts$)/u, path);
		assert.notEqual(chunkGroupForModulePath(path), 'editor-native-image-develop', path);
		assert.notEqual(chunkGroupForModulePath(path), 'editor-raw-original-proof', path);
		if (path.endsWith('.json')) continue; // The fixed ABI1 pin is inert metadata.
		const source = transformSync(readFileSync(path, 'utf8'), { loader: path.endsWith('.ts') ? 'ts' : 'js', format: 'esm' }).code;
		assert.doesNotMatch(source, /\b(?:new Worker|WebAssembly\.(?:compile|instantiate)|new Blob|openFramescaperImageFramePackV1)\b/u, path);
		for (const specifier of staticRelativeDependencies(source)) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	assert.ok(seen.has(EDITOR + 'timeline-image-model.ts'));
	assert.ok(seen.has(EDITOR + 'timeline-image-raw-receipt-v1.ts'));
});

test('the encoded body owner preserves its public scalar preparer as the same shared function', async () => {
	assert.ok(existsSync(EDITOR + PLAN), 'The public preparer must be extracted before its re-export can share identity.');
	const plan = await import('../src/common/editor/timeline-image-raw-encoded-plan-current-v1.ts');
	const body = await import('../src/common/editor/timeline-image-raw-encoded-current-v1.ts');
	assert.equal(body.prepareFramescaperRawImageEncodedCurrentV1, plan.prepareFramescaperRawImageEncodedCurrentV1);
});
