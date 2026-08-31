/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('optional editor ownership is independent of path separator', () => {
	for (const [path, owner] of [
		['src/common/editor/controller/local-assistance-runtime.ts', 'editor-optional-assistance'],
		['src/common/editor/assistance/local-model.ts', 'editor-optional-assistance'],
		['src/common/editor/storage/assistance-derivative-repository.ts', 'editor-optional-assistance'],
		['src/common/editor/ui/local-model-manager-store.ts', 'editor-optional-surfaces'],
	] as const) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
		const windowsPath = path.replaceAll('/', '\\');
		assert.equal(chunkGroupForModulePath(windowsPath), owner, windowsPath);
	}
});

test('small product-ready foundations have non-recursive semantic owners', () => {
	for (const [path, owner] of [
		['src/common/editor/controller/deferred-archive-runtime.ts', 'project-interchange-foundations'],
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
