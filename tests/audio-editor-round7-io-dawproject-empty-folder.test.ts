/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAddTrackFolderCommand, createMoveTrackNodeCommand } from '../src/common/editor/commands/factories.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';

for (const placement of ['populated', 'empty-root', 'empty-child'] as const) {
	test(`own DAWproject round trip retains an authored ${placement} folder`, () => {
		let project = createSoundscaperProject({ id: 'folders', tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
		project = applySoundscaperProjectCommand(project, createAddTrackFolderCommand('main-sequence', { id: 'parent', name: 'Dialogue' }));
		project = applySoundscaperProjectCommand(project, createMoveTrackNodeCommand('main-sequence', 'voice', 'parent', 0));
		if (placement !== 'populated') project = applySoundscaperProjectCommand(project,
			createAddTrackFolderCommand('main-sequence', { id: 'empty', name: 'Pickups' }, {
				parentFolderId: placement === 'empty-child' ? 'parent' : null,
			}));
		const original = structuredClone(project);
		const runtime = createSoundscaperProjectRuntimeSelection().projectForRuntimeConsumers(project);
		const exported = createDawprojectExport({ project: runtime });
		const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
		if (placement !== 'populated') {
			const empty = document.tracks.flatMap(track => [track, ...track.children]).find(track => track.name === 'Pickups');
			assert.ok(empty);
			assert.deepEqual(empty.contentTypes, ['tracks']);
			assert.equal(empty.children.length, 0);
		}
		let ordinal = 0;
		const plan = buildDawprojectProject(document, { media: new Map(), createStableId: prefix => `${prefix}-${++ordinal}` });
		const imported = importSoundscaperAudacityProject(createAudioEditorProjectV17(plan.project));
		assert.equal(validateSoundscaperProject(imported), true);
		assert.deepEqual(imported.trackFolders.map(folder => folder.name), placement === 'populated' ? ['Dialogue'] : ['Dialogue', 'Pickups']);
		const parent = imported.trackFolders.find(folder => folder.name === 'Dialogue');
		const empty = imported.trackFolders.find(folder => folder.name === 'Pickups');
		assert.ok(parent);
		assert.equal(imported.sequences[0]!.trackNodes.find(node => node.id === imported.tracks[0]!.id)?.parentFolderId, parent.id);
		if (empty) assert.equal(imported.sequences[0]!.trackNodes.find(node => node.id === empty.id)?.parentFolderId,
			placement === 'empty-child' ? parent.id : null);
		assert.equal(plan.report.items.some(item => item.code === 'dawproject.track-content-omitted'), false);
		assert.deepEqual(project, original);
	});
}
