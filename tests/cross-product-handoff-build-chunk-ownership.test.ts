/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	chunkGroupForModulePath,
	chunkGroups,
	EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST,
	FRAMESCAPER_PROJECT_COMMAND_CHUNK_TEST,
	FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST,
} from '../scripts/lib/build-chunk-groups.mjs';

test('the cross-product handoff implementation stays behind its eager facade', () => {
	assert.equal(
		chunkGroupForModulePath('src/common/editor/controller/cross-product-handoff-action-facade.ts'),
		'editor-controller-core',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/controller/cross-product-handoff-action.ts'),
		null,
	);
});

test('canonical handoff inspection stays with the optional archive implementation', () => {
	const path = 'src/common/editor/scape-project-canonical-inspection.ts';
	assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), `${path} must be an archive implementation`);
	assert.equal(chunkGroupForModulePath(path), null, `${path} must stay behind its lazy action`);
});

test('the Framescaper project command spine has one non-recursive semantic owner', () => {
	for (const path of [
		'src/framescaper/editor-project-retime-command-admission.ts',
		'src/framescaper/editor-project-sequence-commands.ts',
		'src/framescaper/editor-project-visual-command-inheritance.ts',
		'src/framescaper/editor-project-openfx-validation.ts',
		'src/framescaper/editor-project-native-media-commands.ts',
		'src/framescaper/editor-project-finishing-transition-allocation.ts',
		'src/framescaper/editor-project-native-media-transition-allocation.ts',
		'src/framescaper/editor-project-timeline-image-image-command.ts',
		'src/framescaper/editor-project-timeline-image-commands.ts',
		'src/framescaper/editor-project-timeline-image-transition-allocation.ts',
		'src/framescaper/editor-project-assistance-commands.ts',
		'src/framescaper/editor-project-assistance-transition-allocation.ts',
	]) {
		assert.ok(FRAMESCAPER_PROJECT_COMMAND_CHUNK_TEST.test(path), path);
		assert.equal(chunkGroupForModulePath(path), 'framescaper-project-commands', path);
	}
	assert.equal(
		FRAMESCAPER_PROJECT_COMMAND_CHUNK_TEST.test('src/framescaper/editor-project-commands.ts'),
		false,
	);
	assert.equal(chunkGroupForModulePath('src/framescaper/editor-project-commands.ts'), null);
	assert.equal(
		FRAMESCAPER_PROJECT_COMMAND_CHUNK_TEST.test(
			'src/framescaper/editor-timeline-image-publication-timeline-image.ts',
		),
		false,
	);
	const group = chunkGroups.find((candidate) => candidate.name === 'framescaper-project-commands');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
});

test('new clipboard generations stay out of the timeline-image owner', () => {
	for (const path of [
		'src/framescaper/editor-session-clipboard-v12.ts',
		'src/framescaper/editor-session-clipboard-v12-controller.ts',
		'src/framescaper/editor-session-clipboard-v13.ts',
		'src/framescaper/editor-session-clipboard-v13-paste.ts',
	]) assert.equal(chunkGroupForModulePath(path), 'framescaper-session-clipboard');
	for (const path of [
		'src/framescaper/editor-session-clipboard-v8.ts',
		'src/framescaper/editor-session-clipboard-v11.ts',
		'src/framescaper/editor-session-clipboard-v11-controller.ts',
		'src/framescaper/editor-session-clipboard-v11-selection.ts',
		'src/framescaper/editor-session-clipboard-v12.ts',
		'src/framescaper/editor-session-clipboard-v12-controller.ts',
		'src/framescaper/editor-session-clipboard-v13.ts',
		'src/framescaper/editor-session-clipboard-v13-paste.ts',
	]) assert.equal(FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST.test(path), false);
});

test('the timeline-image owner keeps its native-to-assistance runtime projection chain', () => {
	for (const path of [
		'src/framescaper/editor-project-native-media-runtime.ts',
		'src/framescaper/editor-project-timeline-image-runtime.ts',
		'src/framescaper/editor-project-assistance-runtime.ts',
	]) {
		assert.ok(FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST.test(path), path);
		assert.equal(chunkGroupForModulePath(path), 'framescaper-timeline-images', path);
	}
	const group = chunkGroups.find((candidate) => candidate.name === 'framescaper-timeline-images');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
});
