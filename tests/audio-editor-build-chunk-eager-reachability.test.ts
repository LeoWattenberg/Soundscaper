/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import {
	dynamicRelativeImports,
	EAGER_CHUNK_GROUPS,
	eagerlyReachableModules,
	FRAMESCAPER_BOOTSTRAP_COMPOSITION_LEAVES,
	isEagerlyLoadedModule,
	REACHABILITY_PLACED_TARGETS,
	resolveRelativeModule,
	sourceModules,
	staticRelativeDependencies,
} from './helpers/eager-chunk-group-crossings.ts';

/**
 * The other half of the boundary reachability decides: the importer.
 *
 * The crossing guard used to skip any module whose own owner was null, which meant it could
 * only see a defect when both ends were named. That is backwards for the product trees,
 * where the composition is unowned by design and the feature slices carry the owners:
 * `src/soundscaper/video-export-strategy.ts` has no owner, is composed while the Soundscaper
 * controller is built, and statically imported the lazily owned export projection - the
 * whole optional export chunk was a boot dependency and the guard reported green.
 *
 * Ownership cannot answer whether an unowned module boots, so this walks the graph the
 * bundler walks, from `src/main.jsx` and the two product bootstraps, following static edges
 * and never a dynamic one.
 */

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

function repositoryPath(absolute: string): string {
	return relative(REPOSITORY_ROOT, absolute).split(sep).join('/');
}

test('the eager graph is walked from the page entry and both product bootstraps', () => {
	const reachable = new Set([...eagerlyReachableModules()].map(repositoryPath));
	for (const path of [
		'src/main.jsx',
		'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx',
		'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx',
		'src/soundscaper/editor-controller.ts',
		'src/framescaper/editor-controller.ts',
		'src/soundscaper/video-export-strategy.ts',
	]) assert.ok(reachable.has(path), `${path} must be in the eager graph`);
	for (const path of [
		'src/common/editor/ui/inspector/ExportDialog.jsx',
		'src/common/editor/ui/dialogs/NyquistDialog.jsx',
	]) assert.ok(!reachable.has(path), `${path} is reached only through a dynamic import`);
});

test('an unowned importer the eager entries reach counts as eager', () => {
	// The exact module the guard used to skip, and the exact reason it may not be skipped.
	assert.equal(chunkGroupForModulePath('src/soundscaper/video-export-strategy.ts'), null);
	assert.equal(isEagerlyLoadedModule('src/soundscaper/video-export-strategy.ts'), true);
	// An unowned module nothing reaches statically is still lazy, and so is a lazily owned one.
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/inspector/ExportDialog.jsx'), null);
	assert.equal(isEagerlyLoadedModule('src/common/editor/ui/inspector/ExportDialog.jsx'), false);
	assert.equal(
		isEagerlyLoadedModule('src/common/editor/controller/local-assistance-runtime.ts'),
		false,
	);
	// An owner still answers for the modules that have one, in both directions.
	assert.equal(isEagerlyLoadedModule('src/common/editor/ui/AudioEditorMenuBar.jsx'), true);
});

test('the product composition groups the bootstraps import are classified eager', () => {
	// Each is a size split of a product's own boot-time composition, not a deferred feature.
	// Calling them lazy said the boot graph held no Soundscaper project foundations and no
	// Framescaper command, clipboard or timeline-image code at all.
	for (const name of [
		'framescaper-project-commands',
		'framescaper-project-foundations',
		'framescaper-session-clipboard',
		'framescaper-timeline-images',
		'soundscaper-project-foundations',
	]) assert.ok(EAGER_CHUNK_GROUPS.has(name), name);
	for (const [path, owner] of [
		['src/framescaper/editor-session-clipboard-v13.ts', 'framescaper-session-clipboard'],
		['src/framescaper/editor-project-assistance-commands.ts', 'framescaper-project-commands'],
		['src/framescaper/editor-project-assistance-runtime.ts', 'framescaper-timeline-images'],
		['src/soundscaper/editor-project-validation.ts', 'soundscaper-project-foundations'],
	] as const) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
		assert.equal(isEagerlyLoadedModule(path), true, path);
	}
});

test('the Framescaper composition leaves are reached by eager modules and by no dynamic import', () => {
	// This is the reason each of these carries in `REACHABILITY_PLACED_TARGETS`, measured
	// instead of asserted. A leaf a lazy entry could claim would be emitted in that entry's
	// chunk, and its eagerly owned importers would then boot the chunk to reach it.
	const leaves = new Map(FRAMESCAPER_BOOTSTRAP_COMPOSITION_LEAVES
		.map((path) => [resolve(REPOSITORY_ROOT, path), path] as const));
	for (const path of leaves.values()) {
		assert.ok(REACHABILITY_PLACED_TARGETS.has(path), `${path} must record why its placement is safe`);
		assert.equal(chunkGroupForModulePath(path), null, `${path} is owned now, so drop it from the map`);
	}
	const lazyImporters: string[] = [];
	const dynamicImporters: string[] = [];
	for (const absolute of sourceModules(resolve(REPOSITORY_ROOT, 'src')).map((path) => resolve(path))) {
		const source = readFileSync(absolute, 'utf8');
		const importer = repositoryPath(absolute);
		for (const specifier of staticRelativeDependencies(source)) {
			const target = resolveRelativeModule(absolute, specifier);
			if (!target || !leaves.has(target)) continue;
			if (!isEagerlyLoadedModule(importer)) lazyImporters.push(`${importer} -> ${leaves.get(target)!}`);
		}
		for (const specifier of dynamicRelativeImports(source)) {
			const target = resolveRelativeModule(absolute, specifier);
			if (target && leaves.has(target)) dynamicImporters.push(`${importer} -> ${leaves.get(target)!}`);
		}
	}
	assert.deepEqual(lazyImporters, [], 'a lazy importer can take these leaves into its own chunk');
	assert.deepEqual(dynamicImporters, [], 'a dynamic import makes these leaves a lazy entry of their own');
});
