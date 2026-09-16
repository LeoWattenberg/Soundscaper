/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS, eagerImportsOfLazyOwners } from './helpers/eager-chunk-group-crossings.ts';

test('presentation descriptors and tagged errors share a lightweight non-recursive owner', () => {
	for (const name of ['presentation-message.ts', 'presentation-progress.ts', 'translation-scope.ts']) {
		const path = `src/common/i18n/${name}`;
		assert.equal(chunkGroupForModulePath(path), 'editor-presentation', path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-presentation', path);
	}
	const group = chunkGroups.find(candidate => candidate.name === 'editor-presentation');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(EAGER_CHUNK_GROUPS.has('editor-presentation'), true);
});

test('translation drafts and interchange load with the opted-in translator surface', () => {
	for (const path of [
		'src/common/i18n/community-translations.ts',
		'src/common/i18n/community-translations-po.ts',
		'src/common/editor/controller/preferences/translation-drafts.ts',
		...['CommunityTranslationSurface.tsx', 'community-translation-files.ts', 'community-translation-picker.ts',
			'useCommunityTranslationDraft.ts'].map(name => `src/common/editor/ui/community-translations/${name}`),
	]) assert.equal(chunkGroupForModulePath(path), 'editor-community-translations', path);
	for (const name of ['CommunityTranslationMount.tsx', 'community-translation-menu.ts', 'community-translation-presentation.ts']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/ui/community-translations/${name}`), 'editor-shell', name);
	}
	assert.equal(EAGER_CHUNK_GROUPS.has('editor-community-translations'), false);
	const directory = fileURLToPath(new URL('../src/common/editor/ui/community-translations/', import.meta.url));
	assert.deepEqual(eagerImportsOfLazyOwners([directory]), []);
});

test('diagnostics reports and image preview implementations retain their lazy callers boundary', () => {
	for (const path of [
		'src/common/editor/local-diagnostics-report.ts', 'src/common/editor/local-diagnostics-contract.ts',
		...['preview', 'filmstrip', 'preview-resources'].map(name => `src/framescaper/editor-selected-timeline-image-image-${name}.ts`),
	]) assert.equal(chunkGroupForModulePath(path), 'editor-optional-surfaces', path);
	assert.equal(chunkGroupForModulePath('src/common/editor/delivery-conversion-inventory.ts'), 'editor-optional-export');
	assert.equal(chunkGroupForModulePath('src/common/editor/scape-export-plan.ts'), null);
	assert.equal(chunkGroupForModulePath('src/framescaper/editor-selected-timeline-image-image-preview-controller.ts'),
		'framescaper-timeline-images', 'the eager preview port keeps its dynamic implementation imports');
});
