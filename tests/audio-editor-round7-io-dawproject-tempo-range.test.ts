/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createUpdateTempoEventCommand, createAddTempoEventCommand } from '../src/common/editor/commands/factories.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';

for (const [root, later] of [[999, 999], [1_000, 180], [120, 1_000]] as const) {
	test(`own DAWproject round trip retains authored ${root}/${later} BPM events`, () => {
		let project = createSoundscaperProject({ id: 'tempo-programme' });
		project = applySoundscaperProjectCommand(project, createUpdateTempoEventCommand('tempo-1', { bpm: { num: root, den: 1 } }));
		project = applySoundscaperProjectCommand(project, createAddTempoEventCommand({ id: 'later', beat: { num: 4, den: 1 }, bpm: { num: later, den: 1 } }));
		assert.equal(validateSoundscaperProject(project), true);
		const original = structuredClone(project);
		const exported = createDawprojectExport({ project });
		const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
		let ordinal = 0;
		const plan = buildDawprojectProject(document, { media: new Map(), createStableId: prefix => `${prefix}-${++ordinal}` });
		const imported = importSoundscaperAudacityProject(createAudioEditorProjectV17(plan.project));
		assert.equal(validateSoundscaperProject(imported), true);
		assert.deepEqual(imported.tempoMap.events.map(event => event.bpm), project.tempoMap.events.map(event => event.bpm));
		assert.ok(!plan.report.items.some(item => item.code === 'dawproject.tempo-range-converted'));
		const transport = exported.document.children.find(element => element.name === 'Transport');
		const tempo = transport?.children.find(element => element.name === 'Tempo');
		assert.ok(tempo);
		assert.ok(Number(tempo.attributes.max) >= Math.max(root, later));
		assert.deepEqual(project, original);
	});
}
