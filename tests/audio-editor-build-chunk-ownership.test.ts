/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
	chunkGroupForModulePath,
	chunkGroups,
	EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST,
	EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST,
	EDITOR_PRODUCTION_METER_CHUNK_TEST,
	workerChunkGroups,
	WORKER_XML_VENDOR_CHUNK_TEST,
} from '../scripts/lib/build-chunk-groups.mjs';
import {
	assistanceDomainModules,
	flatEditorModules,
	localAssistanceControllerModules,
} from './helpers/editor-chunk-module-inventory.ts';
import {
	eagerImportsOfLazyOwners,
	importsOnlyTypes,
	sourceModules,
} from './helpers/eager-chunk-group-crossings.ts';

/**
 * Every flat editor domain module must be owned by a named chunk group.
 *
 * A module with no owner is placed by reachability. `video-delivery-frame-rate.ts`
 * arrived that way with the delivery slice: the export dialog reached it first, so
 * it was emitted inside the lazily imported ExportDialog chunk, while the eagerly
 * loaded shell modules that also read it - `ui/export-preset-model.ts` and
 * `ui/VideoDeliveryFields.jsx` - statically imported that chunk to get it. The
 * dialog chunk then initialized during the shell's own import and called a shell
 * initializer that had not been declared yet. Every route failed to mount with
 * `TypeError: y is not a function`, and nothing in the non-browser gate noticed,
 * because the defect only exists in the emitted chunk graph.
 *
 * Ownership is what prevents it: a shared leaf that belongs to a group is never
 * absorbed into a dialog chunk, whichever importer happens to reach it first.
 */

const EDITOR_DIRECTORY = fileURLToPath(new URL('../src/common/editor/', import.meta.url));
const ASSISTANCE_DIRECTORY = fileURLToPath(new URL('../src/common/editor/assistance/', import.meta.url));
const EDITOR_UI_DIRECTORY = fileURLToPath(new URL('../src/common/editor/ui/', import.meta.url));
const EDITOR_CONTROLLER_DIRECTORY = fileURLToPath(new URL('../src/common/editor/controller/', import.meta.url));
/** The directories whose modules are all part of one product's boot path. */
const EAGER_ROOTS = [EDITOR_DIRECTORY, ASSISTANCE_DIRECTORY, EDITOR_CONTROLLER_DIRECTORY, EDITOR_UI_DIRECTORY];

test('every shared flat editor domain module has an owning chunk group', () => {
	const unowned = flatEditorModules()
		.filter((path) => !EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path))
		.filter((path) => !EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test(path))
		.filter((path) => chunkGroupForModulePath(path) === null);
	assert.deepEqual(unowned, [], 'these modules would be placed by reachability alone');
});

test('no eagerly owned editor module statically imports a lazily owned one', () => {
	// This is the invariant every per-directory ownership rule exists to serve. A static
	// import across the boundary makes the importer's chunk depend on the lazy chunk, so the
	// whole lazy feature is downloaded during startup and the product-ready graph blows its
	// byte budget - for code the user never opened. Reach lazy code through a dynamic import
	// or a facade instead, or move the importer to the lazy side.
	assert.deepEqual(eagerImportsOfLazyOwners(EAGER_ROOTS), []);
});

test('Split Tool runtime stays behind its optional feature boundary', () => {
	for (const path of [
		'src/common/editor/ui/timeline/split-tool-guideline.ts',
		'src/common/editor/ui/timeline/split-tool-shortcut.ts',
	]) assert.equal(chunkGroupForModulePath(path), 'editor-optional-split-tool', path);
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-optional-split-tool');
	assert.ok(group);
	assert.equal(group.minSize, 0);
	assert.equal(group.includeDependenciesRecursively, false);
});

test('only a wholly type-only import clause is absent from the eager graph', () => {
	assert.equal(importsOnlyTypes('{ type LazyShape, type LazyOptions as Options }'), true);
	assert.equal(importsOnlyTypes('LazyRuntime, { type LazyShape }'), false);
	assert.equal(importsOnlyTypes('* as LazyRuntime'), false);
});

test('assistance domain modules default to the lazy owner, with a named eager exception set', () => {
	// The eager side is the exception, not the default. A new assistance module that
	// silently landed in editor-domain and imported one lazy sibling pulled the whole
	// optional assistance chunk into the product-ready startup graph and broke its byte
	// budget three times over. Growing this list is a deliberate claim that eagerly
	// loaded shell or controller code reads the module.
	const eager = assistanceDomainModules()
		.filter((path) => chunkGroupForModulePath(path) !== 'editor-optional-assistance');
	assert.deepEqual(eager, [
		'src/common/editor/assistance/assistance-asset-command-v1.ts',
		'src/common/editor/assistance/assistance-asset-reference-v1.ts',
		'src/common/editor/assistance/operation.ts',
		'src/common/editor/assistance/shots.ts',
		'src/common/editor/assistance/transcript-scape-asset-extension-v1.ts',
		'src/common/editor/assistance/transcript.ts',
	]);
	for (const path of eager) assert.equal(chunkGroupForModulePath(path), 'editor-domain');
});

test('every local assistance controller module keeps the lazy assistance owner', () => {
	// A controller/local-assistance-*.ts module with any other owner lands in an eagerly
	// loaded chunk, and its static imports then drag the whole optional assistance chunk
	// into the product-ready startup graph, past its byte budget. Only the deferred facade
	// that the composition root imports directly belongs on the eager side.
	const misowned = localAssistanceControllerModules()
		.filter((path) => chunkGroupForModulePath(path) !== 'editor-optional-assistance');
	assert.deepEqual(misowned, [], 'these modules would join the eager startup graph');
	assert.equal(
		chunkGroupForModulePath('src/common/editor/controller/deferred-local-assistance-runtime.ts'),
		'editor-controller-core',
	);
});

test('every assistance domain module has an owning chunk group', () => {
	const unowned = assistanceDomainModules()
		.filter((path) => chunkGroupForModulePath(path) === null);
	assert.deepEqual(unowned, [], 'these modules would be placed in a lazy assistance dialog');
});

test('the shell, controller, and storage groups keep the flat modules they name', () => {
	assert.equal(
		chunkGroupForModulePath('src/common/editor/video-delivery-frame-rate.ts'),
		'editor-domain',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/assistance/transcript.ts'),
		'editor-domain',
	);
	assert.equal(chunkGroupForModulePath('src/common/editor/index.js'), 'editor-controller-core');
	assert.equal(chunkGroupForModulePath('src/common/editor/facade.ts'), 'editor-controller-core');
	assert.equal(
		chunkGroupForModulePath('src/common/editor/browser-webcodecs-aac.ts'),
		'editor-optional-execution',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/browser-dedicated-audio-worker-client.ts'),
		'editor-optional-execution',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/video-mediabunny-muxer.ts'),
		'editor-optional-execution',
	);
	assert.equal(
		chunkGroupForModulePath('node_modules/mediabunny/dist/index.js'),
		'vendor-mediabunny',
	);
	assert.equal(chunkGroupForModulePath('src/common/editor/history.js'), 'editor-storage-model');
	assert.equal(chunkGroupForModulePath('src/common/editor/video-timeline.js'), 'editor-domain');
	// A dialog stays outside every path-matched group, so it can be split off and
	// loaded when it is opened rather than when the editor boots.
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/inspector/ExportDialog.jsx'), null);
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/AudioEditorMenuBar.jsx'), 'editor-shell');
	assert.equal(chunkGroupForModulePath('src/common/url.ts'), 'editor-shell');
	for (const path of [
		'src/common/i18n/catalogs.js',
		'src/common/i18n/runtime.js',
		'src/common/i18n/report-copy.js',
		'src/common/i18n/framescaper-capture-copy.js',
		'src/soundscaper/framescaper-capture-copy.js',
	]) {
		assert.equal(chunkGroupForModulePath(path), 'editor-copy', path);
	}
	assert.equal(chunkGroupForModulePath('src/common/i18n/site-copy.js'), null);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/ui/local-assistance-semantic-search-source.ts'),
		'editor-assistance-semantic-search-runtime',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/ui/local-assistance-semantic-search-bridge.ts'),
		'editor-assistance-semantic-search-runtime',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/ui/local-assistance-lazy-semantic-search-source.ts'),
		'editor-shell',
	);
	assert.equal(
		chunkGroupForModulePath('src/framescaper/editor-soundscaper-workflow-product-runtime.tsx'),
		'editor-shell',
	);
});

test('production meter session helpers have a shared non-recursive owner', () => {
	for (const path of [
		'src/common/editor/production-audio/loudness-history-session.ts',
		'src/common/editor/production-audio/strip-analysis-scheduler.ts',
		'src/common/editor/production-audio/strip-meter-session.ts',
	]) {
		assert.ok(EDITOR_PRODUCTION_METER_CHUNK_TEST.test(path), path);
		assert.ok(EDITOR_PRODUCTION_METER_CHUNK_TEST.test(path.replaceAll('/', '\\')), path);
		assert.equal(chunkGroupForModulePath(path), 'editor-production-meter', path);
	}
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-production-meter');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
});

test('the domain group sits below the groups whose modules it would otherwise claim', () => {
	const priority = (name: string): number => {
		const group = chunkGroups.find((candidate) => candidate.name === name);
		assert.ok(group, `${name} must exist`);
		return group.priority as number;
	};
	for (const name of ['editor-engine', 'editor-storage-model', 'editor-timeline', 'editor-controller-core', 'editor-shell']) {
		assert.ok(
			priority(name) > priority('editor-domain'),
			`${name} must outrank editor-domain, which matches every flat module`,
		);
	}
});

test('editor groups never absorb shared application dependencies recursively', () => {
	for (const name of [
		'editor-copy',
		'editor-engine',
		'editor-storage-model',
		'editor-timeline',
		'editor-controller-core',
		'editor-shell',
		'editor-domain',
	]) {
		const group = chunkGroups.find((candidate) => candidate.name === name);
		assert.ok(group, `${name} must exist`);
		assert.equal(group.includeDependenciesRecursively, false, `${name} captured a shared site dependency`);
	}
});

test('the site entry has highest-priority non-recursive ownership', () => {
	const siteEntry = chunkGroups.find((candidate) => candidate.name === 'site-entry');
	assert.ok(siteEntry);
	assert.deepEqual(siteEntry.tags, ['$initial']);
	assert.equal(siteEntry.includeDependenciesRecursively, false);
	assert.ok(chunkGroups.every((candidate) => (
		candidate === siteEntry || Number(siteEntry.priority) > Number(candidate.priority)
	)));
});

test('worker XML parsing dependencies share one bounded vendor owner', () => {
	for (const path of [
		'node_modules/saxes/saxes.js',
		'node_modules/xmlchars/xml/1.0/ed5.js',
		'node_modules/xmlchars/xml/1.1/ed2.js',
		'node_modules/xmlchars/xmlns/1.0/ed3.js',
	]) assert.ok(WORKER_XML_VENDOR_CHUNK_TEST.test(path), `${path} must stay with the worker XML parser`);
	assert.equal(WORKER_XML_VENDOR_CHUNK_TEST.test('src/common/editor/ixml.ts'), false);
	const group = workerChunkGroups.find((candidate) => candidate.name === 'vendor-xml-worker');
	assert.ok(group);
	assert.equal(group.test, WORKER_XML_VENDOR_CHUNK_TEST);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.maxSize, 400_000);
});

test('editor UI imports exact internal design-system modules', () => {
	const broadImporters = sourceModules(EDITOR_UI_DIRECTORY)
		.filter((path) => readFileSync(path, 'utf8').includes("from '@audacity-ui/components'"));
	assert.deepEqual(broadImporters, [], 'broad design-system imports retain every component stylesheet');
	const viteConfig = readFileSync(fileURLToPath(new URL('../vite.config.mjs', import.meta.url)), 'utf8');
	const tsconfig = readFileSync(fileURLToPath(new URL('../tsconfig.base.json', import.meta.url)), 'utf8');
	assert.match(viteConfig, /@soundscaper\\\/design-system/u);
	assert.match(tsconfig, /"@soundscaper\/design-system\/\*"/u);
});

test('design-system foundations stay vendor-owned while components follow eager or lazy consumers', () => {
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx'),
		'vendor-design-system',
	);
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/hooks/useTabOrder.ts'),
		'vendor-design-system',
	);
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/Button/Button.tsx'),
		'editor-shell-design-components',
	);
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/TrackMeter/TrackMeter.tsx'),
		'editor-shell-design-components',
	);
	// The shared dialog footer was dialog-only until every confirm row started
	// going through it, including the effect preset bar and the effect picker,
	// which the shell loads eagerly. Its bytes are in the startup path either
	// way; owning them here keeps that from costing two more requests.
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/Footer/Footer.tsx'),
		'editor-shell-design-components',
	);
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/PreferencePanel/PreferencePanel.tsx'),
		null,
	);
	assert.equal(
		chunkGroups.some((candidate) => candidate.name === 'vendor-design-system-components'),
		false,
	);
	const components = chunkGroups.find((candidate) => candidate.name === 'editor-shell-design-components');
	assert.ok(components);
	assert.equal(components.includeDependenciesRecursively, false);
});

