/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createImportComposition } from '../src/common/editor/controller/import/import-composition.ts';
import type { ImportCompositionDependencies } from '../src/common/editor/controller/import/internal/import-composition-types.ts';
import { createFixture, file } from './audio-editor-project-import-service-fixture.ts';

test('legacy project import uses the injected archive runtime and adapts its project', async () => {
	const fixture = createFixture();
	const invoked: string[] = [];
	const decoded = {
		project: { id: 'imported', title: 'Decoded', sources: [], tracks: [], clips: [] },
		sources: [], warnings: [],
	};
	const dependencies = {
		...fixture.runtime,
		archiveRuntime: {
			decodeLegacyAupProject: async () => { invoked.push('decode'); return decoded; },
			convertLegacyAupToProject: async () => { invoked.push('convert'); return decoded; },
		},
		adaptAudacityProject: (project: typeof decoded.project) => ({ ...project, title: 'Adapted' }),
		state: {
			...fixture.runtime.state,
			selectedTrackId: null, selectedClipId: null,
			missingSourceIds: new Set<string>(), projectBinPreview: null,
		},
		lifetime: { assertActive: () => undefined },
		projectGeneration: {
			capture: fixture.runtime.captureProject,
			assertCurrent: fixture.runtime.assertProject,
		},
		engine: { ...fixture.runtime.engine, getPositionFrames: () => 0 },
		sourceChunkFrames: fixture.runtime.SOURCE_CHUNK_FRAMES,
		sourceChunkProviders: fixture.sourceChunkProviders,
		protectedSourceIds: new Set<string>(),
		trackColors: [],
		projectVisual: {
			activateVideoSource: () => undefined,
			revokeVideoVisual: () => undefined,
			getProjectBinClipVisualData: () => null,
		},
		createPreviewEngine: () => ({}),
		retireTimelinePlayback: async () => undefined,
		updateSelection: () => undefined,
		invalidateSourceRuntime: () => undefined,
		createId: () => 'test-id',
	} as unknown as ImportCompositionDependencies;

	const imported = await createImportComposition(dependencies).importFile(file('session.aup'));
	assert.deepEqual(invoked, ['decode', 'convert']);
	assert.equal(imported.project.title, 'Adapted');
	assert.equal(fixture.calls.includes('create-project'), true);
});
