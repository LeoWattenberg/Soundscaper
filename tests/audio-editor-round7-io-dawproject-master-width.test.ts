/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createDefaultAdmMetadata } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';

for (const [layout, channels] of [['mono', 1], ['stereo', 2], ['5.1', 6]] as const) {
	test(`own DAWproject round trip retains the authored ${layout} master width`, () => {
		const initial = createSoundscaperProject({ id: 'programme', tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
		const project = applySoundscaperProjectCommand(initial, { type: 'metadata/update',
			changes: { adm: createDefaultAdmMetadata(initial, layout) } });
		assert.equal(project.masterChannels, channels);
		const original = structuredClone(project);
		const exported = createDawprojectExport({ project });
		const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
		assert.equal(document.tracks.find(track => track.channel?.role === 'master')?.channel?.audioChannels, channels);
		let ordinal = 0;
		const plan = buildDawprojectProject(document, { media: new Map(), createStableId: prefix => `${prefix}-${++ordinal}` });
		const imported = importSoundscaperAudacityProject(createAudioEditorProjectV17(plan.project));
		assert.equal(validateSoundscaperProject(imported), true);
		assert.equal(imported.masterChannels, channels);
		assert.equal(imported.mixer.outputs[0]?.channelCount, channels);
		assert.deepEqual(project, original);
	});
}
