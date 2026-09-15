/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkGroupForModulePath, chunkGroups, workerChunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('optional editor ownership is independent of path separator', () => {
	for (const [path, owner] of [
		['src/common/editor/controller/assistance/internal/local-assistance-runtime.ts', 'editor-optional-assistance'],
		['src/common/editor/assistance/local-model.ts', 'editor-optional-assistance'],
		['src/common/editor/storage/assistance-derivative-repository.ts', 'editor-optional-assistance'],
		['src/common/editor/ui/local-model-manager-store.ts', 'editor-optional-surfaces'],
	] as const) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
		const windowsPath = path.replaceAll('/', '\\');
		assert.equal(chunkGroupForModulePath(windowsPath), owner, windowsPath);
	}
});

test('regular effect contracts and copy stay shared instead of following a product bootstrap', () => {
	for (const [path, owner] of [
		['src/common/editor/first-party-effects/standard/definition.ts', 'editor-effect-contracts'],
		['src/common/editor/first-party-effects/standard/filters-definition.ts', 'editor-effect-contracts'],
		['src/common/editor/first-party-effects/standard/filters-coefficients.ts', 'editor-effect-contracts'],
		['src/common/editor/first-party-effects/standard/effect-tail.ts', 'editor-effect-contracts'],
		['src/common/editor/first-party-effects/standard/modulation-definition.ts', 'editor-effect-contracts'],
		['src/common/editor/first-party-effects/standard/noise-gate-definition.ts', 'editor-effect-contracts'],
		['src/common/editor/first-party-effects/standard/delay-definition.ts', 'editor-effect-contracts'],
		['src/common/editor/first-party-effects/standard/nyquist-replacements.ts', 'editor-effect-contracts'],
		['src/common/editor/first-party-effects/standard/selection-contract.ts', 'editor-effect-contracts'],
		['src/common/i18n/canonical-extras-standard-effects.js', 'editor-copy'],
	] as const) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
		const windowsPath = path.replaceAll('/', '\\');
		assert.equal(chunkGroupForModulePath(windowsPath), owner, windowsPath);
	}
	for (const path of [
		'src/common/editor/first-party-effects/standard/dsp.ts',
		'src/common/editor/first-party-effects/standard/vocoder-dsp.ts',
	]) {
		assert.notEqual(chunkGroupForModulePath(path), 'editor-effect-contracts', `${path} must stay with its runtime consumer`);
	}
	for (const name of ['editor-effect-contracts', 'editor-copy']) {
		const group = chunkGroups.find(candidate => candidate.name === name);
		assert.ok(group);
		assert.equal(group.includeDependenciesRecursively, false);
	}
});

test('workers give effect definitions and the complete canonical copy registry a bounded owner', () => {
	const group = workerChunkGroups.find(candidate => candidate.name === 'editor-effect-contracts-worker');
	assert.ok(group);
	assert.ok(group.test instanceof RegExp);
	for (const path of [
		'src/common/editor/first-party-effects/standard/definition.ts',
		'src/common/editor/first-party-effects/standard/filters-definition.ts',
		'src/common/editor/first-party-effects/standard/filters-coefficients.ts',
		'src/common/editor/first-party-effects/standard/effect-tail.ts',
		'src/common/editor/first-party-effects/standard/modulation-definition.ts',
		'src/common/editor/first-party-effects/standard/noise-gate-definition.ts',
		'src/common/editor/first-party-effects/standard/delay-definition.ts',
		'src/common/editor/first-party-effects/standard/nyquist-replacements.ts',
		'src/common/editor/first-party-effects/standard/selection-contract.ts',
		'src/common/i18n/canonical-extras.js',
		'src/common/i18n/canonical-extras-audacity-effects.js',
		'src/common/i18n/canonical-extras-audacity-presets.js',
		'src/common/i18n/canonical-extras-standard-effects.js',
		'src/common/i18n/locale.js',
	]) {
		assert.equal(group.test.test(path), true, path);
		const windowsPath = path.replaceAll('/', '\\');
		assert.equal(group.test.test(windowsPath), true, windowsPath);
	}
	for (const path of [
		'src/common/editor/first-party-effects/standard/dsp.ts',
		'src/common/editor/first-party-effects/standard/vocoder-dsp.ts',
		'src/common/editor/aup4-worker.js',
		'src/common/editor/aup4-database.js',
	]) assert.equal(group.test.test(path), false, path);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.maxSize, 400_000);
	assert.equal(group.minSize, undefined);
});

test('small product-ready foundations have non-recursive semantic owners', () => {
	for (const [path, owner] of [
		['src/common/editor/controller/document/deferred-archive-runtime.ts', 'project-interchange-foundations'],
		['desktop/desktop-video-codec-operation-contract.ts', 'editor-codec-foundations'],
		['src/common/editor/wavpack/pcm.js', 'editor-codec-foundations'],
		['src/common/editor/staffpad/parameters.js', 'editor-codec-foundations'],
		['src/common/editor/parametric-eq/wasm-loader.js', 'editor-codec-foundations'],
		['src/common/i18n/action-parity.js', 'editor-effect-contracts'],
		['src/common/editor/audacity-effects/live-capabilities.js', 'editor-effect-contracts'],
		['src/common/editor/reviewed-effects/selection-effect-contract.ts', 'editor-effect-contracts'],
		['src/soundscaper/editor-native-plugin-playback.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-native-plugin-state-scape.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-native-plugin-state.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-project-feature-capability-profile.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-project-feature-compatibility.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-project-feature-requirements.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-project-production-validation.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-project-validation.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-project.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-scape-assets.ts', 'soundscaper-project-foundations'],
		['src/soundscaper/editor-scape-native.ts', 'soundscaper-project-foundations'],
		['src/framescaper/editor-captured-video-proxy-preservation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-assistance.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-capabilities.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-capability-profile-professional-media.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-capability-profile-native-media.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-capability-profile-timeline-image.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-capability-profile-assistance.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-requirements-professional-media.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-requirements-native-media.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-requirements-timeline-image.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-feature-requirements-assistance.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-storage-profile.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-runtime-profile.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-companion-audio-scope.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-professional-media-source-command.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-finishing-finishing-command.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-professional-media-validation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-native-media-openfx-validation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-native-media-validation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-timeline-image-validation.ts', 'framescaper-project-foundations'],
		['src/framescaper/editor-project-assistance-validation.ts', 'framescaper-project-foundations'],
	] as const) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
	}
	for (const path of [
		'src/framescaper/editor-project-runtime-selection.ts',
		'src/framescaper/editor-native-render-plan-authority.ts',
		'src/framescaper/editor-selected-finishing-authoring-controller.ts',
	]) {
		assert.equal(chunkGroupForModulePath(path), null, `${path} must stay with its composition consumer`);
	}
	assert.equal(
		chunkGroupForModulePath('src/framescaper/editor-project-runtime-timeline-image-selection.ts'),
		'framescaper-timeline-images',
	);
	for (const name of [
		'project-interchange-foundations',
		'editor-codec-foundations',
		'editor-effect-contracts',
		'soundscaper-project-foundations',
		'framescaper-project-foundations',
	]) {
		const group = chunkGroups.find((candidate) => candidate.name === name);
		assert.ok(group);
		assert.equal(group.includeDependenciesRecursively, false);
	}
});
