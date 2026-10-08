/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS, resolveRelativeModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const directory = fileURLToPath(new URL('../src/common/editor/', import.meta.url));
const scalarModules = ['controller/shared/photo-library-definition-reader.ts', 'controller/shared/photo-library-selection-v1.ts',
	'controller/shared/photo-library-culling-v1.ts', 'controller/shared/photo-library-import-gesture-v1.ts'];

test('the photo shell follows its own lazy bootstrap instead of the audio shell owner', () => {
	// Claiming this sole-consumer UI as editor-shell makes shared site/copy imports
	// point back into LightscaperBootstrap and creates a static chunk cycle.
	for (const separator of ['/', '\\']) {
		for (const path of [
			'src/common/editor/ui/lightscaper/LightscaperApp.tsx',
			'src/common/editor/ui/lightscaper/lightscaper.css',
			'src/common/editor/ui/lightscaper/library/PhotoLibrary.tsx',
			'src/lightscaper/ui/LightscaperBootstrap.tsx',
		]) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), null, path);
		}
	}
});

test('photo shell isolation preserves the shared audio/video shell owner', () => {
	for (const path of [
		'src/common/editor/ui/AudioEditorMenuBar.jsx',
		'src/common/editor/ui/application-menu/product-runtime.ts',
		'src/common/products.js',
		'src/common/url.ts',
	]) {
		assert.equal(chunkGroupForModulePath(path), 'editor-shell', path);
	}
});

test('the actual photo scalar controller closure has no timeline, storage, effects or copy passengers', () => {
	const seen = new Set<string>(), pending = scalarModules.map(path => directory + path);
	while (pending.length) {
		const module = pending.pop()!;
		if (seen.has(module)) continue;
		seen.add(module);
		const expected = module === directory + 'closed-domain-value.ts' ? 'editor-closed-domain-values' : 'editor-photo-library-scalars';
		assert.equal(chunkGroupForModulePath(module), expected, module);
		for (const dependency of staticRelativeDependencies(readFileSync(module, 'utf8'))) {
			const target = resolveRelativeModule(module, dependency); assert.ok(target, dependency); pending.push(target);
		}
	}
	assert.deepEqual([...seen].sort(), [...scalarModules, 'closed-domain-value.ts'].map(path => directory + path).sort());
});

test('scalar and closed-value owners are exact nonrecursive groups with their actual eager classification', () => {
	for (const [paths, owner] of [
		[scalarModules, 'editor-photo-library-scalars'],
		[['closed-domain-value.ts'], 'editor-closed-domain-values'],
	] as const) {
		for (const path of paths) {
			assert.equal(chunkGroupForModulePath(directory + path), owner);
			assert.equal(chunkGroupForModulePath((directory + path).replaceAll('/', '\\')), owner);
			assert.notEqual(chunkGroupForModulePath(directory + path + '.foreign'), owner);
		}
		const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
		assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
		assert.equal(EAGER_CHUNK_GROUPS.has(owner), true);
	}
	assert.equal(chunkGroupForModulePath(directory + 'controller/shared/deferred-module-facade.ts'), 'editor-controller-core');
	assert.equal(chunkGroupForModulePath(directory + 'commands/video-keyframe-carrier.ts'), 'editor-controller-core');
	assert.equal(chunkGroupForModulePath(directory + 'controller/shared/photo-library-future.ts'), 'editor-controller-core');
	assert.equal(chunkGroupForModulePath(directory + 'closed-domain-value-validation.ts'), 'editor-domain');
	assert.deepEqual(staticRelativeDependencies(readFileSync(directory + 'closed-domain-value.ts', 'utf8')), []);
});

test('opt-in pixel presentation has a separate lazy controller owner and uses only common image and closed-value contracts', () => {
	const path = directory + 'controller/shared/pixel-preview-presentation-v1.ts', owner = 'editor-pixel-preview-presentation';
	assert.equal(chunkGroupForModulePath(path), owner);
	assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), owner);
	assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
	const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
	assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(EAGER_CHUNK_GROUPS.has(owner), false);
	const dependencies = staticRelativeDependencies(readFileSync(path, 'utf8')).map(specifier => {
		const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); return chunkGroupForModulePath(target);
	});
	assert.deepEqual(dependencies, ['editor-closed-domain-values', 'editor-imaging', 'editor-imaging']);
});
