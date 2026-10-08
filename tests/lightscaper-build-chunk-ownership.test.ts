/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';

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

test('the shared Scape Blob bound has an inert exact owner apart from timeline archive estimation', async () => {
	const path = directory + 'scape-blob-budget.ts', owner = 'editor-neutral-foundations';
	for (const candidate of [path, path.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), owner);
	assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
	const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
	assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(EAGER_CHUNK_GROUPS.has(owner), true);
	assert.deepEqual(staticRelativeDependencies(readFileSync(path, 'utf8')), []);
	const narrow = await import('../src/common/editor/scape-blob-budget.ts');
	const legacy = await import('../src/common/editor/scape-export-estimate.ts');
	assert.equal(narrow.SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES, 512 * 1024 * 1024);
	assert.equal(legacy.SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES, narrow.SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES);
	assert.equal(legacy.resolveScapeBlobMaximumBytes(undefined), narrow.SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES);
});

test('photo backup option admission imports the shared scalar budget without eager archive or estimate code', () => {
	const path = fileURLToPath(new URL('../src/lightscaper/controller/photo-library-backup-request.ts', import.meta.url));
	const dependencies = staticRelativeDependencies(readFileSync(path, 'utf8'));
	assert.ok(dependencies.includes('../../common/editor/scape-blob-budget.ts'));
	assert.ok(dependencies.every(specifier => !/scape-(?:export-estimate|archive)/u.test(specifier)));
	assert.ok(staticRelativeDependencies(readFileSync(directory + 'scape-export-estimate.ts', 'utf8')).includes('./scape-blob-budget.ts'));
});

test('shared cancellation, ordering, IDs and worker lifetimes have an exact neutral owner without timeline passengers', () => {
	const owner = 'editor-neutral-foundations';
	for (const module of ['abort-error.ts', 'abort-race.ts', 'code-unit-order.ts', 'stable-id.js',
		'worker-error-transport.ts', 'worker-protocol.ts', 'worker-request-broker.ts']) {
		const path = directory + module;
		assert.equal(chunkGroupForModulePath(path), owner);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), owner);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
		assert.deepEqual(staticRelativeDependencies(readFileSync(path, 'utf8')),
			module === 'worker-request-broker.ts' ? ['./worker-protocol.ts'] : []);
	}
	const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
	assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(EAGER_CHUNK_GROUPS.has(owner), true);
	assert.equal(chunkGroupForModulePath(directory + 'abort-error-future.ts'), 'editor-domain');
	assert.equal(chunkGroupForModulePath(directory + 'effect-contract.ts'), 'editor-domain');
});

test('shared still admission, effect and mask contracts retain only imaging and inert foundation imports', () => {
	const modules = ['image-import-admission.ts', 'image-format-signature.ts', 'image-decoder-routing.ts',
		'video-effects.js', 'video-mask-matte-v24.ts', 'video-visual-model-v24.ts',
		'timeline-image-model.ts', 'timeline-image-frame-pack-v1.ts', 'timeline-image-frame-pack-v1-layout.ts',
		'timeline-image-native-decode-v1.ts', 'timeline-image-browser-native-port.ts', 'timeline-image-conversion-receipt-v1.ts'];
	for (const module of modules) {
		const path = directory + module;
		assert.equal(chunkGroupForModulePath(path), 'editor-imaging');
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-imaging');
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-imaging');
		for (const dependency of staticRelativeDependencies(readFileSync(path, 'utf8'))) {
			const target = resolveRelativeModule(path, dependency); assert.ok(target, dependency);
			assert.ok(['editor-imaging', 'editor-neutral-foundations', 'editor-closed-domain-values', 'project-interchange-foundations']
				.some(owner => owner === chunkGroupForModulePath(target)), target);
		}
	}
	assert.equal(chunkGroupForModulePath(directory + 'safe-visual-text.ts'), 'editor-neutral-foundations');
	assert.deepEqual(staticRelativeDependencies(readFileSync(directory + 'safe-visual-text.ts', 'utf8')), []);
	assert.equal(chunkGroupForModulePath(directory + 'controller/shared/file-size-warning.ts'), 'project-interchange-foundations');
	assert.deepEqual(staticRelativeDependencies(readFileSync(directory + 'controller/shared/file-size-warning.ts', 'utf8')), []);
	assert.equal(chunkGroupForModulePath(directory + 'video-timeline.js'), 'editor-domain');
	assert.equal(chunkGroupForModulePath(directory + 'video-motion-model-v27.ts'), 'editor-domain');
	assert.equal(chunkGroupForModulePath(directory + 'timeline-image-trim.ts'), 'editor-domain');
});

test('shared media storage owns source-reference contracts apart from project construction and timeline effects', () => {
	const owner = 'editor-media-storage-contracts';
	const modules = ['retention.js', 'project-schema-version.ts', 'take-group-source-references.ts',
		'video-source-characteristics.ts', 'sequence-timecode.ts'];
	for (const module of modules) {
		const path = directory + module;
		assert.equal(chunkGroupForModulePath(path), owner);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), owner);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
		for (const dependency of staticRelativeDependencies(readFileSync(path, 'utf8'))) {
			const target = resolveRelativeModule(path, dependency); assert.ok(target, dependency);
			assert.ok([owner, 'project-interchange-foundations'].some(candidate => candidate === chunkGroupForModulePath(target)), target);
		}
	}
	const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
	assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(EAGER_CHUNK_GROUPS.has(owner), true);
	assert.equal(chunkGroupForModulePath(directory + 'project.js'), 'editor-storage-model');
	assert.equal(chunkGroupForModulePath(directory + 'project-audio-factory.js'), 'editor-storage-model');
});

test('shared byte publication budgets and writer leases keep their codec and custody semantics', () => {
	for (const module of ['publication-byte-estimates.ts', 'waveform-peak-contract.ts', 'project-lock.js']) {
		const path = directory + module;
		assert.equal(chunkGroupForModulePath(path), 'editor-media-storage-contracts');
		for (const dependency of staticRelativeDependencies(readFileSync(path, 'utf8'))) {
			const target = resolveRelativeModule(path, dependency); assert.ok(target, dependency);
			assert.ok(['editor-media-storage-contracts', 'editor-media-custody-storage', 'editor-codec-foundations']
				.some(owner => owner === chunkGroupForModulePath(target)), target);
		}
	}
});

test('shared file-storage failure classification uses neutral message metadata without WAV or effect ownership', () => {
	const path = directory + 'web-file-limit-failure.ts', owner = 'editor-neutral-foundations';
	assert.equal(chunkGroupForModulePath(path), owner);
	assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), owner);
	assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
	const dependencies = staticRelativeDependencies(readFileSync(path, 'utf8'));
	assert.deepEqual(dependencies, ['../i18n/presentation-message.ts']);
	const target = resolveRelativeModule(path, dependencies[0]); assert.ok(target);
	assert.equal(chunkGroupForModulePath(target), 'editor-presentation');
	assert.deepEqual(staticRelativeDependencies(readFileSync(target, 'utf8')), []);
	assert.equal(chunkGroupForModulePath(directory + 'wav-import.js'), 'editor-domain');
});

test('the actual photo session borrows shared media repositories without linked readers or timeline storage passengers', () => {
	const root = fileURLToPath(new URL('../src/lightscaper/photo-library-session-runtime.ts', import.meta.url));
	const pending = [root], seen = new Set<string>(), storage = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!;
		if (seen.has(path)) continue;
		seen.add(path);
		if (path.startsWith(directory + 'storage/')) {
			storage.add(path);
			assert.equal(chunkGroupForModulePath(path), 'editor-media-custody-storage', path);
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-media-custody-storage', path);
			assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-media-custody-storage', path);
		}
		if (path.startsWith(directory) && !path.slice(directory.length).includes('/')) {
			assert.ok(['editor-neutral-foundations', 'editor-closed-domain-values', 'editor-imaging',
				'editor-media-storage-contracts', 'project-interchange-foundations'].some(owner => owner === chunkGroupForModulePath(path)), path);
		}
		const source = transformSync(readFileSync(path, 'utf8'), { loader: path.endsWith('.ts') ? 'ts' : 'js', format: 'esm' }).code;
		for (const dependency of staticRelativeDependencies(source)) {
			const target = resolveRelativeModule(path, dependency); assert.ok(target, dependency); pending.push(target);
		}
	}
	assert.equal(storage.size, 54);
	for (const module of ['media-repository.ts', 'media-catalog-original-repository.ts', 'opfs-repository.ts']) {
		assert.ok(storage.has(directory + 'storage/' + module));
	}
	for (const module of ['linked-audio-original-source-reader.ts', 'linked-video-original-source-reader.ts', 'project-repository.ts']) {
		assert.ok(!storage.has(directory + 'storage/' + module));
		assert.equal(chunkGroupForModulePath(directory + 'storage/' + module), 'editor-storage-model');
	}
	const group = chunkGroups.find(candidate => candidate.name === 'editor-media-custody-storage'); assert.ok(group);
	assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(EAGER_CHUNK_GROUPS.has('editor-media-custody-storage'), true);
});
