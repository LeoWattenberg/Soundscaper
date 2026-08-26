/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
	chunkGroupForModulePath,
	chunkGroups,
	EDITOR_EFFECT_DIALOG_SHELL_CHUNK_TEST,
	EDITOR_EFFECT_PARAMETER_SURFACE_CHUNK_TEST,
	EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST,
	EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST,
	EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST,
	EDITOR_OPTIONAL_EXPORT_CHUNK_TEST,
	EDITOR_OPTIONAL_SURFACE_CHUNK_TEST,
	EDITOR_PFFFT_RUNTIME_CHUNK_TEST,
	EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST,
} from '../scripts/lib/build-chunk-groups.mjs';

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
const MODULE_PATTERN = /\.(?:[cm]?[jt]s)$/u;

test('every shared flat editor domain module has an owning chunk group', () => {
	const unowned = flatEditorModules()
		.filter((path) => !EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path))
		.filter((path) => !EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test(path))
		.filter((path) => chunkGroupForModulePath(path) === null);
	assert.deepEqual(unowned, [], 'these modules would be placed by reachability alone');
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
	assert.equal(chunkGroupForModulePath('src/common/editor/history.js'), 'editor-storage-model');
	assert.equal(chunkGroupForModulePath('src/common/editor/video-timeline.js'), 'editor-timeline');
	// A dialog stays outside every path-matched group, so it can be split off and
	// loaded when it is opened rather than when the editor boots.
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/inspector/ExportDialog.jsx'), null);
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/AudioEditorMenuBar.jsx'), 'editor-shell');
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

test('optional archive code and its ZIP vendor are placed by dynamic reachability', () => {
	for (const path of [
		'src/common/editor/scape-project.js',
		'src/common/editor/scape-archive-layout.ts',
		'src/common/editor/scape-archive-layout-witness.ts',
		'src/common/editor/scape-import-transaction.ts',
		'src/common/editor/aup-legacy.js',
		'src/common/editor/aup4-client.js',
	]) {
		assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), `${path} must be an archive implementation`);
		assert.equal(chunkGroupForModulePath(path), null, `${path} must stay behind its lazy action`);
	}
	assert.equal(
		chunkGroupForModulePath('node_modules/@zip.js/zip.js/index.js'),
		null,
		'ZIP must stay behind lazy archive import/export actions',
	);
	assert.equal(
		chunkGroupForModulePath('node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js'),
		null,
		'FFmpeg client code must stay behind its existing dynamic runtime import',
	);
});

test('optional effect and analysis implementations have a dedicated lazy owner', () => {
	for (const path of [
		'src/common/editor/analysis.js',
		'src/common/editor/spectral-edit.js',
		'src/common/editor/spectral-edit-admission.ts',
		'src/common/editor/controller/analysis-service.ts',
	]) {
		assert.ok(EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test(path), `${path} must be an optional execution module`);
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-execution', `${path} must stay behind its lazy action`);
	}
	assert.equal(chunkGroupForModulePath('node_modules/@echogarden/pffft-wasm/simd.js'), null);
});

test('PFFFT has an isolated lazy runtime owner', () => {
	const path = 'src/common/editor/pffft.js';
	assert.ok(EDITOR_PFFFT_RUNTIME_CHUNK_TEST.test(path));
	assert.ok(EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test(path));
	assert.equal(chunkGroupForModulePath(path), 'editor-pffft-runtime');
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-pffft-runtime');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.minSize, 0);
});

test('selection effects have an isolated lazy runtime owner', () => {
	for (const path of [
		'src/common/editor/selection-effects-runtime.js',
		'src/common/editor/parametric-eq/destructive.js',
	]) {
		assert.ok(EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST.test(path));
		assert.equal(chunkGroupForModulePath(path), 'editor-selection-effects-runtime');
	}
	assert.ok(EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test('src/common/editor/selection-effects-runtime.js'));
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-selection-effects-runtime');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.minSize, 0);
});

test('optional export execution has an isolated lazy owner', () => {
	for (const path of [
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/controller/audio-export-render-orchestration.ts',
		'src/common/editor/controller/audio-realtime-encoded-export.ts',
		'src/common/editor/controller/direct-compressed-export.ts',
		'src/common/editor/controller/video-export-service.ts',
		'src/common/editor/controller/delivery-conformance-action.ts',
	]) {
		assert.ok(EDITOR_OPTIONAL_EXPORT_CHUNK_TEST.test(path), `${path} must be optional export execution`);
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-export');
		assert.equal(EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test(path), false);
	}
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-optional-export');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
});

test('stateful local assistance implementations share one dedicated lazy owner', () => {
	for (const path of [
		'src/common/editor/controller/local-assistance-runtime.ts',
		'src/common/editor/controller/local-assistance-selected-media.ts',
		'src/common/editor/controller/local-assistance-selected-video.ts',
		'src/common/editor/controller/local-assistance-selected-preparation.ts',
		'src/common/editor/controller/local-assistance-selected-media-router.ts',
		'src/common/editor/controller/local-assistance-result-acceptance.ts',
		'src/common/editor/controller/local-assistance-cleanup-workflow.ts',
		'src/common/editor/controller/local-assistance-cleanup-acceptance.ts',
		'src/common/editor/controller/local-assistance-range-label-acceptance.ts',
		'src/common/editor/controller/local-assistance-shot-acceptance.ts',
		'src/common/editor/controller/local-assistance-transcript-acceptance.ts',
		'src/common/editor/assistance/disfluency.ts',
		'src/common/editor/assistance/transcript-body-publication-v1.ts',
		'src/common/editor/assistance/transcript-labels.ts',
		'src/common/editor/assistance/vad-silence.ts',
	]) {
		assert.ok(EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST.test(path), `${path} must be optional assistance`);
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-assistance');
	}
	assert.equal(
		chunkGroupForModulePath('src/common/editor/controller/deferred-local-assistance-runtime.ts'),
		'editor-controller-core',
	);
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-optional-assistance');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
});

test('menu-opened execution and UI surfaces use dedicated lazy owners', () => {
	for (const path of [
		'src/common/editor/ui/local-assistance-session-store.ts',
		'src/common/editor/ui/workspace/RecordingSetupPanel.tsx',
	]) {
		assert.ok(EDITOR_OPTIONAL_SURFACE_CHUNK_TEST.test(path), `${path} must be a lazy UI surface`);
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-surfaces');
	}
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/EffectsPanel/EffectsPanel.tsx'),
		'editor-effect-dialog-shell',
	);
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/EffectsPanel/index.ts'),
		'editor-effect-dialog-shell',
	);
	for (const name of ['editor-optional-execution', 'editor-optional-export', 'editor-optional-surfaces', 'editor-effect-dialog-shell']) {
		const group = chunkGroups.find((candidate) => candidate.name === name);
		assert.ok(group);
		assert.equal(group.includeDependenciesRecursively, false);
	}
});

test('effect dialogs and their design-system shell share one cycle-free lazy owner', () => {
	for (const path of [
		'src/common/editor/ui/inspector/AudioEditorEffectsOverlay.jsx',
		'src/common/editor/ui/inspector/AudacityEffectHeader.jsx',
		'vendor/audacity-design-system/components/src/EffectsPanel/EffectsPanel.tsx',
		'vendor/audacity-design-system/components/src/EffectDialog/EffectHeader.tsx',
		'vendor/audacity-design-system/components/src/SidePanel/SidePanel.tsx',
	]) {
		assert.ok(EDITOR_EFFECT_DIALOG_SHELL_CHUNK_TEST.test(path));
		assert.equal(chunkGroupForModulePath(path), 'editor-effect-dialog-shell');
	}
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-effect-dialog-shell');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.minSize, 0);
});

test('effect parameter surfaces share one cycle-free lazy owner', () => {
	for (const path of [
		'src/common/editor/ui/AudacityEffectLayout.jsx',
		'src/common/editor/ui/ParametricEqEditor.jsx',
		'src/common/editor/ui/inspector/EffectParameterEditor.jsx',
	]) {
		assert.ok(EDITOR_EFFECT_PARAMETER_SURFACE_CHUNK_TEST.test(path));
		assert.equal(chunkGroupForModulePath(path), 'editor-effect-parameter-surfaces');
	}
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-effect-parameter-surfaces');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.minSize, 0);
});

test('small product-ready foundations have non-recursive semantic owners', () => {
	for (const [path, owner] of [
		['src/common/editor/wavpack/pcm.js', 'editor-codec-foundations'],
		['src/common/editor/staffpad/parameters.js', 'editor-codec-foundations'],
		['src/common/editor/parametric-eq/wasm-loader.js', 'editor-codec-foundations'],
		['src/common/i18n/action-parity.js', 'editor-effect-contracts'],
		['src/common/editor/audacity-effects/live-capabilities.js', 'editor-effect-contracts'],
		['src/common/editor/reviewed-effects/selection-effect-contract.ts', 'editor-effect-contracts'],
		['src/framescaper/editor-project-v31-foundation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-v32.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-v25-foundation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-capability-profile-v25.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-storage-profile-v25.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-runtime-profile-v25-prerequisite.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-runtime-profile-v25.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-requirements-v25.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-capability-profile-v26.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-storage-profile-v26.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-runtime-profile-v26-prerequisite.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-runtime-profile-v26.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-requirements-v26.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-v28-foundation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-capability-profile-v28.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-storage-profile-v28.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-runtime-profile-v28-prerequisite.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-runtime-profile-v28.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-v32-foundation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-capability-profile-v32.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-storage-profile-v32.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-runtime-profile-v32-prerequisite.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-runtime-profile-v32.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-v25-validation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-v28-openfx-validation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-v28-validation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-v32-validation.ts', 'framescaper-project-foundations'],
	] as const) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
	}
	for (const name of [
		'editor-codec-foundations',
		'editor-effect-contracts',
		'framescaper-project-foundations',
	]) {
		const group = chunkGroups.find((candidate) => candidate.name === name);
		assert.ok(group);
		assert.equal(group.includeDependenciesRecursively, false);
	}
});

test('Framescaper session clipboard modules stay in one product-owned ready chunk', () => {
	for (const path of [
		'src/framescaper/editor-session-clipboard-v8.ts',
		'src/framescaper/editor-session-clipboard-v11.ts',
		'src/framescaper/editor-session-clipboard-v11-controller.ts',
		'src/framescaper/editor-session-clipboard-v11-selection.ts',
	]) {
		assert.equal(chunkGroupForModulePath(path), 'framescaper-session-clipboard');
	}
	const group = chunkGroups.find((candidate) => candidate.name === 'framescaper-session-clipboard');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
});

test('editor UI imports exact internal design-system modules', () => {
	const broadImporters = sourceModules(EDITOR_UI_DIRECTORY)
		.filter((path) => readFileSync(path, 'utf8').includes("from '@dilsonspickles/components'"));
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
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/Footer/Footer.tsx'),
		null,
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

function flatEditorModules(): readonly string[] {
	return readdirSync(EDITOR_DIRECTORY, { withFileTypes: true })
		.filter((entry) => entry.isFile() && MODULE_PATTERN.test(entry.name))
		.map((entry) => `src/common/editor/${entry.name}`)
		.sort();
}

function assistanceDomainModules(): readonly string[] {
	return readdirSync(ASSISTANCE_DIRECTORY, { withFileTypes: true })
		.filter((entry) => entry.isFile() && MODULE_PATTERN.test(entry.name))
		.map((entry) => `src/common/editor/assistance/${entry.name}`)
		.sort();
}

function sourceModules(directory: string): readonly string[] {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(?:[jt]sx?)$/u.test(entry.name))
		.map((entry) => `${entry.parentPath}/${entry.name}`)
		.sort();
}
