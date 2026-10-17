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
	'controller/shared/photo-library-culling-v1.ts', 'controller/shared/photo-library-import-gesture-v1.ts',
	'controller/shared/photo-library-compare-v1.ts', 'controller/shared/photo-library-survey-v1.ts'];

const currentPhotoOwners = [
	['controller/shared/photo-library-develop-command-v2.ts', 'editor-photo-library-scalars'],
	['controller/shared/photo-library-develop-workflow-v2.ts', 'editor-photo-library-scalars'],
	['controller/shared/photo-library-develop-settings-intent-v2.ts', 'editor-photo-library-scalars'],
	['controller/shared/photo-library-develop-settings-workflow-v2.ts', 'editor-photo-library-scalars'],
	['controller/shared/photo-library-workflow-slot-v2.ts', 'editor-photo-library-scalars'],
	['controller/shared/photo-library-develop-presentation-v2.ts', 'editor-pixel-preview-presentation'],
	['photo-library-develop-proxy-port-v2.ts', 'editor-neutral-foundations'],
] as const;

for (const [module, owner] of currentPhotoOwners) test(`current Photo exact chunk owner: ${module}`, () => {
	for (const separator of ['/', '\\']) {
		const path = (directory + module).replaceAll('/', separator);
		assert.equal(chunkGroupForModulePath(path), owner, path);
		for (const impostor of [path + '.foreign', path.replace('-v2.ts', '-future-v2.ts'), path.replace('-v2.ts', '-v3.ts')]) {
			assert.notEqual(chunkGroupForModulePath(impostor), owner, impostor);
		}
	}
	const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
	assert.equal(group.priority, 99); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(EAGER_CHUNK_GROUPS.has(owner), owner !== 'editor-pixel-preview-presentation');
});

test('current Photo aliases retain every original workflow, presentation and typed port owner', () => {
	for (const [modules, owner] of [
		[['develop-command', 'develop-workflow-v1', 'develop-settings-intent', 'develop-settings-workflow-v1', 'workflow-slot'], 'editor-photo-library-scalars'],
		[['develop-presentation-v1'], 'editor-pixel-preview-presentation'],
	] as const) for (const module of modules) for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath((directory + `controller/shared/photo-library-${module}.ts`).replaceAll('/', separator)), owner);
	}
	for (const kind of ['proxy', 'original', 'full-resolution']) for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath((directory + `photo-library-develop-${kind}-port-v1.ts`).replaceAll('/', separator)), 'editor-neutral-foundations');
	}
	for (const kind of ['original', 'full-resolution']) {
		assert.notEqual(chunkGroupForModulePath(directory + `photo-library-develop-${kind}-port-v2.ts`), 'editor-neutral-foundations');
	}
});

test('fixed closed effect families own one exact imaging leaf without foreign registrations', () => {
	const path = directory + 'video-effect-closed-families-v1.ts';
	for (const candidate of [path, path.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), 'editor-imaging');
	for (const candidate of [path + '.foreign', path.replace('-v1.ts', '-future-v1.ts')]) assert.notEqual(chunkGroupForModulePath(candidate), 'editor-imaging');
	const dependencies = staticRelativeDependencies(transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code);
	assert.ok(dependencies.includes('./video-effect-closed-creation.ts'));
	assert.ok(dependencies.every(specifier => /^\.\/(?:video-[^/]+\.ts|stable-id\.js)$/u.test(specifier)));
	assert.ok(!dependencies.includes('./video-effects.js'));
});

test('scalar color wheels own exact imaging contracts without foreign suffix or timeline passengers', () => {
	for (const path of ['video-color-wheels-v1.ts', 'video-color-wheels-scalar-v1.ts']) {
		for (const candidate of [directory + path, (directory + path).replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), 'editor-imaging');
		assert.notEqual(chunkGroupForModulePath(directory + path + '.foreign'), 'editor-imaging');
	}
});

test('the actual metadata query copy leaf stays with photo copy without a domain or shell dependency', () => {
	const path = fileURLToPath(new URL('../src/common/i18n/lightscaper-metadata-query-copy.ts', import.meta.url));
	for (const candidate of [path, path.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), 'lightscaper-editor-copy');
	assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'lightscaper-editor-copy');
	const leafImports = staticRelativeDependencies(transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code);
	assert.deepEqual(leafImports, []);
	const source = fileURLToPath(new URL('../src/common/i18n/lightscaper-editor-copy.ts', import.meta.url));
	const imports = staticRelativeDependencies(transformSync(readFileSync(source, 'utf8'), { loader: 'ts', format: 'esm' }).code);
	assert.ok(imports.includes('./lightscaper-metadata-query-copy.ts'));
});

test('metadata query controls and their product registry are lazy at the actual composition boundaries', () => {
	const bootstrap = fileURLToPath(new URL('../src/lightscaper/ui/LightscaperBootstrap.tsx', import.meta.url));
	const productSource = transformSync(readFileSync(bootstrap, 'utf8'), { loader: 'tsx', format: 'esm' }).code;
	assert.ok(!staticRelativeDependencies(productSource).includes('../photo-metadata-query-ui-runtime.ts'));
	assert.match(productSource, /import\(["']\.\.\/photo-metadata-query-ui-runtime\.ts["']\)/u);
	const appSource = transformSync(readFileSync(directory + 'ui/lightscaper/LightscaperApp.tsx', 'utf8'), { loader: 'tsx', format: 'esm' }).code;
	assert.ok(!staticRelativeDependencies(appSource).includes('./PhotoQuerySurface.tsx'));
	assert.match(appSource, /import\(["']\.\/PhotoQuerySurface\.tsx["']\)/u);
});

test('the actual stack archive leaf shares the neutral Scape byte owner without timeline copy passengers', () => {
	const path = directory + 'scape-photo-stack-pack.ts', owner = 'editor-scape-archive-bytes';
	for (const candidate of [path, path.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), owner);
	assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
	assert.deepEqual(staticRelativeDependencies(readFileSync(path, 'utf8')), []);
	for (const consumer of ['catalog-archive-contract-v2.ts', 'catalog-archive-export-v2.ts']) {
		const entry = fileURLToPath(new URL('../src/lightscaper/archive/' + consumer, import.meta.url));
		const imports = staticRelativeDependencies(transformSync(readFileSync(entry, 'utf8'), { loader: 'ts', format: 'esm' }).code);
		assert.ok(imports.includes('../../common/editor/scape-photo-stack-pack.ts'), consumer);
	}
	const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
	assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
});

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

test('the eager Survey hook uses the photo scalar owner while its dialog remains a lazy surface', () => {
	const hook = directory + 'ui/lightscaper/use-photo-survey.ts';
	const source = transformSync(readFileSync(hook, 'utf8'), { loader: 'ts', format: 'esm' }).code;
	const dependencies = staticRelativeDependencies(source).map(specifier => {
		const target = resolveRelativeModule(hook, specifier); assert.ok(target, specifier); return target;
	});
	assert.deepEqual(dependencies, [directory + 'controller/shared/photo-library-survey-v1.ts']);
	assert.equal(chunkGroupForModulePath(dependencies[0]!), 'editor-photo-library-scalars');
	assert.equal(chunkGroupForModulePath(directory + 'ui/lightscaper/PhotoSurveyDialog.tsx'), null);
	const app = directory + 'ui/lightscaper/LightscaperApp.tsx';
	const appSource = transformSync(readFileSync(app, 'utf8'), { loader: 'tsx', format: 'esm' }).code;
	assert.ok(!staticRelativeDependencies(appSource).includes('./PhotoSurveyDialog.tsx'));
	assert.match(appSource, /import\(["']\.\/PhotoSurveyDialog\.tsx["']\)/u);
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
	assert.deepEqual(dependencies, ['editor-closed-domain-values', 'editor-imaging', 'editor-imaging', 'editor-imaging']);
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
	for (const module of ['abort-error.ts', 'abort-race.ts', 'code-unit-order.ts', 'error-diagnostic-message.ts', 'stable-id.js',
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

test('original recovery composes only scalar, neutral and original-contract owners', () => {
	const root = directory + 'controller/shared/photo-library-original-recovery-v1.ts';
	assert.equal(chunkGroupForModulePath(root), 'editor-photo-library-scalars');
	assert.equal(chunkGroupForModulePath(root.replaceAll('/', '\\')), 'editor-photo-library-scalars');
	assert.notEqual(chunkGroupForModulePath(root + '.foreign'), 'editor-photo-library-scalars');
	const pending = [root], seen = new Set<string>();
	while (pending.length) {
		const module = pending.pop()!;
		if (seen.has(module)) continue;
		seen.add(module);
		assert.ok(['editor-photo-library-scalars', 'editor-neutral-foundations', 'editor-closed-domain-values',
			'editor-media-custody-storage'].some(owner => owner === chunkGroupForModulePath(module)), module);
		const source = transformSync(readFileSync(module, 'utf8'), { loader: 'ts', format: 'esm' }).code;
		for (const specifier of staticRelativeDependencies(source)) {
			const path = resolveRelativeModule(module, specifier); assert.ok(path, specifier); pending.push(path);
		}
	}
	assert.deepEqual([...seen].map(path => path.slice(directory.length)).sort(), [
		'closed-domain-value.ts', 'controller/shared/photo-library-original-recovery-v1.ts', 'error-diagnostic-message.ts',
		'safe-visual-text.ts', 'storage/media-catalog-original-repair-contract.ts', 'storage/media-catalog-original-schema.ts',
	].sort());
});

test('shared still admission, effect and mask contracts retain only imaging and inert foundation imports', () => {
	const modules = ['image-import-admission.ts', 'image-format-signature.ts', 'image-decoder-routing.ts',
		'video-effects.js', 'video-global-develop-v1.ts', 'video-chroma-develop-v1.ts', 'video-black-white-mix-v1.ts', 'video-hsl-mixer-v1.ts',
		'video-curves-v1.ts', 'video-curve-transfer-v1.ts', 'video-curve-types-v1.ts', 'video-sharpen-v1.ts', 'video-sharpen-ffmpeg-v1.ts',
		'video-grain-v1.ts', 'video-grain-ffmpeg-v1.ts', 'video-texture-v1.ts', 'video-texture-ffmpeg-v1.ts', 'video-dehaze-v1.ts', 'video-dehaze-ffmpeg-v1.ts',
		'video-post-crop-vignette-v1.ts', 'video-post-crop-vignette-ffmpeg-v1.ts', 'video-clarity-v1.ts', 'video-clarity-ffmpeg-v1.ts', 'video-noise-reduction-v1.ts', 'video-noise-reduction-ffmpeg-v1.ts', 'video-original-alpha-ffmpeg-v1.ts', 'video-effect-closed-creation.ts', 'video-mask-matte-v24.ts', 'video-visual-model-v24.ts',
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

test('global develop and histogram production imports stay within the image processing closure', () => {
	const pending = ['video-global-develop-v1.ts', 'imaging/pixel-frame-global-develop-v1.ts', 'imaging/pixel-frame-histogram-v1.ts']
		.map(module => directory + module);
	const seen = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!;
		if (seen.has(path)) continue;
		seen.add(path);
		for (const candidate of [path, path.replaceAll('/', '\\')]) {
			assert.ok(['editor-imaging', 'editor-neutral-foundations', 'editor-closed-domain-values']
				.some(owner => owner === chunkGroupForModulePath(candidate)), candidate);
		}
		const source = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code;
		for (const specifier of staticRelativeDependencies(source)) {
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	assert.ok(seen.has(directory + 'closed-domain-value.ts'));
	assert.ok(seen.has(directory + 'imaging/pixel-frame-admission-v1.ts'));
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

test('Cube custody owns only exact scalar references and plans without parsing or rendering passengers', () => {
	const modules = ['cube-lut-reference-contract.ts', 'video-cube-lut-profile-v1.ts', 'video-cube-lut-project-references-v1.ts'];
	const pending = modules.map(module => directory + module), seen = new Set<string>();
	for (const path of pending) {
		assert.equal(chunkGroupForModulePath(path), 'editor-media-storage-contracts', path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-media-storage-contracts', path);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-media-storage-contracts', path);
	}
	while (pending.length) {
		const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
		assert.ok(['editor-media-storage-contracts', 'editor-closed-domain-values']
			.some(owner => owner === chunkGroupForModulePath(path)), path);
		const source = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code;
		for (const dependency of staticRelativeDependencies(source)) {
			const target = resolveRelativeModule(path, dependency); assert.ok(target); pending.push(target);
		}
	}
	assert.deepEqual([...seen].sort(), [...modules, 'closed-domain-value.ts'].map(module => directory + module).sort());
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
	// The append-only native schema registry is a separate shared custody leaf.
	assert.equal(storage.size, 61);
	assert.ok(storage.has(directory + 'storage/indexeddb-schema.ts'));
	for (const module of ['media-repository.ts', 'media-catalog-original-repository.ts', 'opfs-repository.ts', 'opfs-binary-inspection.ts',
		'media-asset-binary-inspection.ts', 'media-catalog-original-inspection-repository.ts',
		'media-catalog-original-repair-contract.ts', 'media-catalog-original-repair-publication.ts', 'media-catalog-original-repair-repository.ts']) {
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
