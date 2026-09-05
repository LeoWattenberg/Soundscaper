/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	chunkGroupForModulePath,
	chunkGroups,
	EDITOR_EFFECT_DIALOG_SHELL_CHUNK_TEST,
	EDITOR_EFFECT_PARAMETER_SURFACE_CHUNK_TEST,
	EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST,
	EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST,
	EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST,
	EDITOR_OPTIONAL_EXPORT_CHUNK_TEST,
	EDITOR_OPTIONAL_SURFACE_CHUNK_TEST,
	EDITOR_PFFFT_RUNTIME_CHUNK_TEST,
	EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST,
} from '../scripts/lib/build-chunk-groups.mjs';
import { flatEditorModules } from './helpers/editor-chunk-module-inventory.ts';

/**
 * The chunks that must stay behind a dynamic import.
 *
 * Ownership alone does not keep a feature out of the boot path: a group can name a set of
 * modules and still be pulled in eagerly if something on the shell's static graph reaches
 * one of them. These tests pin the other half of the contract — that each optional feature
 * has one lazy owner, that the owner is non-recursive so it cannot swallow shared
 * dependencies, and that nothing eager reaches inside it.
 *
 * `tests/audio-editor-build-chunk-ownership.test.ts` holds the ownership half.
 */

test('optional archive code and its ZIP vendor are placed by dynamic reachability', () => {
	for (const path of [
		'src/common/editor/scape-project.js',
		'src/common/editor/scape-archive-layout.ts',
		'src/common/editor/scape-archive-layout-witness.ts',
		'src/common/editor/scape-import-transaction.ts',
		'src/common/editor/aup-legacy.js',
		'src/common/editor/aup4-client.js',
		'src/common/editor/dawproject-archive.ts',
		'src/common/editor/dawproject-export.ts',
		'src/common/editor/dawproject-import.ts',
		'src/common/editor/dawproject-xml.ts',
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

test('the aup4 split keeps its lazy-only modules behind the archive owner', () => {
	// Splitting `aup4-profile.js` and its siblings into focused modules gave the
	// new names no archive owner, so the broad editor-domain pattern claimed them
	// and placed archive code in an eagerly loaded chunk. Nothing eager imports
	// them: they are reached only from `aup4-profile.js` and each other.
	for (const path of [
		'src/common/editor/aup4-opaque-merge.js',
		'src/common/editor/aup4-profile-values.js',
		'src/common/editor/aup4-track-nodes.js',
	]) {
		assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), `${path} must be an archive implementation`);
		assert.equal(chunkGroupForModulePath(path), null, `${path} must stay behind its lazy action`);
	}
});

test('the DAWproject exchange stays behind its deferred controller facade', () => {
	// Composing the service eagerly is what put the exchange reader, writer, XML
	// parser and their ZIP container into the product-ready startup graph: the
	// Framescaper graph went to 82 requests and 1,659,051 brotli bytes, past both
	// of its ceilings, for a File menu entry most sessions never open.
	const implementation = flatEditorModules().filter((path) => /dawproject-/u.test(path));
	assert.ok(implementation.length >= 10, 'the exchange implementation must be found');
	for (const path of [...implementation, 'src/common/editor/controller/dawproject-service.ts']) {
		assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path) || path.includes('/controller/'), path);
		assert.equal(chunkGroupForModulePath(path), null, `${path} must stay behind its lazy action`);
	}
	assert.equal(
		chunkGroupForModulePath('src/common/editor/controller/deferred-dawproject-service.ts'),
		'editor-controller-core',
	);
	const composition = readFileSync(
		new URL('../src/common/editor/controller/native-project-service.ts', import.meta.url),
		'utf8',
	);
	assert.match(composition, /createDeferredDawprojectService\(/u);
	assert.doesNotMatch(composition, /^import\s+(?!type\b)[^\n]*'\.\/dawproject-service\.ts'/mu);
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
		assert.ok(EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST.test(path.replaceAll('/', '\\')));
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
		'src/common/editor/controller/local-assistance-audio-preparation.ts',
		'src/common/editor/controller/local-assistance-audio-publication.ts',
		'src/common/editor/controller/local-assistance-audio-result-custody.ts',
		'src/common/editor/controller/local-assistance-beat-acceptance.ts',
		'src/common/editor/controller/local-assistance-selected-media.ts',
		'src/common/editor/controller/local-assistance-selected-video.ts',
		'src/common/editor/controller/local-assistance-selected-preparation.ts',
		'src/common/editor/controller/local-assistance-selected-media-router.ts',
		'src/common/editor/controller/local-assistance-result-acceptance.ts',
		'src/common/editor/controller/local-assistance-reaction-acceptance.ts',
		'src/common/editor/controller/local-assistance-cleanup-workflow.ts',
		'src/common/editor/controller/local-assistance-cleanup-acceptance.ts',
		'src/common/editor/controller/local-assistance-range-label-acceptance.ts',
		'src/common/editor/controller/local-assistance-shot-acceptance.ts',
		'src/common/editor/controller/local-assistance-transcript-acceptance.ts',
		'src/common/editor/assistance/disfluency.ts',
		'src/common/editor/assistance/async-search-provider.ts',
		'src/common/editor/assistance/beat-proposals.ts',
		'src/common/editor/assistance/beat-tempo-map.ts',
		'src/common/editor/assistance/beat-this-postprocess-v1.ts',
		'src/common/editor/assistance/binary-formats-v1.ts',
		'src/common/editor/assistance/ctc-forced-alignment-v1.ts',
		'src/common/editor/assistance/editorial-generation-v1.ts',
		'src/common/editor/assistance/highlight-ranking-v1.ts',
		'src/common/editor/assistance/m7-semantic-results.ts',
		'src/common/editor/assistance/proposal-session.ts',
		'src/common/editor/assistance/reaction-proposals.ts',
		'src/common/editor/assistance/reframe-planner-v1.ts',
		'src/common/editor/assistance/scene-scores.ts',
		'src/common/editor/assistance/semantic-search-index-v1.ts',
		'src/common/editor/assistance/shot-detection.ts',
		'src/common/editor/assistance/shot-detection-mode.ts',
		'src/common/editor/assistance/speaker-attribution.ts',
		'src/common/editor/assistance/subject-tracker-v1.ts',
		'src/common/editor/assistance/transnetv2-onnx-adapter-v1.ts',
		'src/common/editor/assistance/transnetv2-postprocess-v1.ts',
		'src/common/editor/assistance/transcript-body-publication-v1.ts',
		'src/common/editor/assistance/transcript-cleanup-presets.ts',
		'src/common/editor/assistance/transcript-indexing-v1.ts',
		'src/common/editor/assistance/transcript-ingest.ts',
		'src/common/editor/assistance/transcript-labels.ts',
		'src/common/editor/assistance/vad-silence.ts',
		'src/common/editor/assistance/wav2vec2-english-tokenizer-v1.ts',
		'src/common/editor/assistance/visual-indexing-v1.ts',
		'src/common/editor/assistance/visual-semantic-results-v1.ts',
		'src/common/editor/assistance/workflow-custody-v1.ts',
		'src/common/editor/assistance/workflow-fence-v1.ts',
		'src/common/editor/assistance/workflow-recipes.ts',
		'src/common/editor/assistance/workflow-settings-v1.ts',
		'src/common/editor/assistance/workflow.ts',
		'src/common/editor/controller/local-assistance-selected-video-frame-pack.ts',
		'src/common/editor/controller/local-assistance-selected-video-timing.ts',
		'src/common/editor/storage/assistance-derivative-codec.ts',
		'src/common/editor/storage/assistance-derivative-key-value-port.ts',
		'src/common/editor/storage/assistance-derivative-repository.ts',
	]) {
		assert.ok(EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST.test(path), `${path} must be optional assistance`);
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-assistance');
	}
	assert.equal(
		chunkGroupForModulePath('src/common/editor/controller/deferred-local-assistance-runtime.ts'),
		'editor-controller-core',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/storage/deferred-assistance-derivative-repository.ts'),
		'editor-storage-model',
	);
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-optional-assistance');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
});

test('menu-opened execution and UI surfaces use dedicated lazy owners', () => {
	for (const path of [
		'src/common/editor/ui/PrivacyPolicyRoute.tsx',
		'src/common/editor/ui/local-assistance-bridge.ts',
		'src/common/editor/ui/local-assistance-guided-session-store.ts', 'src/common/editor/ui/local-assistance-review-authority.ts',
		'src/common/editor/ui/local-assistance-result-review.ts',
		'src/common/editor/ui/local-assistance-session-store.ts',
		'src/common/editor/ui/local-assistance-shot-review.ts',
		'src/common/editor/ui/local-assistance-workflow-bridge.ts',
		'src/common/editor/ui/workspace/RecordingSetupPanel.tsx',
		'src/common/editor/ui/workspace/SoundscaperRoutingGraphInspector.tsx',
		'src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx',
		'src/common/editor/ui/workspace/soundscaper-routing-folder-authority.ts',
		'src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts',
		'src/common/editor/ui/workspace/soundscaper-routing-graph-gesture.ts',
		'src/common/editor/ui/workspace/soundscaper-routing-graph-layout.ts',
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
		// The rack's shortcut handler ships here rather than in a chunk of its
		// own: on its own it joins the overlay's lazy facade, and the resulting
		// two-chunk cycle left the rack calling an uninitialised overlay module.
		'src/common/editor/ui/inspector/audacity-realtime-effect-shortcut.ts',
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
