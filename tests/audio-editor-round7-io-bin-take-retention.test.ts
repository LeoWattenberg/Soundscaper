/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { planClipSpreadsheetInsert } from '../src/common/editor/clip-spreadsheet-insert.ts';
import { createTakeCompService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-service.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createCycleProducedTakeFixture } from './helpers/cycle-produced-take-fixture.ts';

for (const grouped of [true, false]) for (const operation of ['remove', 'replace'] as const) {
	test(`${operation} a placed cycle take's bin entry retains the recorded group's source (${String(grouped)})`, async context => {
		const fixture = await createCycleProducedTakeFixture();
		context.after(async () => { await fixture.store.close(); });
		const document = fixture.project;
		let project = createSoundscaperProject({ id: document.id, sampleRate: document.sampleRate,
			sources: document.sources, tracks: document.tracks, sequences: document.sequences,
			primarySequenceId: document.primarySequenceId, takeGroups: grouped ? document.takeGroups : [],
		});
		const source = project.sources[0]!;
		let ordinal = 0;
		const inserted = planClipSpreadsheetInsert(project, [{ name: 'Placed take', source: source.id, position: '1' }], {
			createId: prefix => `${prefix}-${++ordinal}`,
		});
		assert.ok(inserted);
		project = applySoundscaperProjectCommand(project, inserted);
		const clip = project.clips[0]!;
		project = applySoundscaperProjectCommand(project, { type: 'project-bin/move-from-timeline', clipIds: [clip.id] });
		if (operation === 'remove') {
			project = applySoundscaperProjectCommand(project, { type: 'project-bin/remove-from-project', clipId: clip.id });
			assert.equal(project.projectBin.clips.length, 0);
		} else {
			const replacement = createAudioSource({ ...source, id: 'replacement', storageKey: 'replacement', name: 'Replacement.wav' });
			project = applySoundscaperProjectCommand(project, { type: 'batch', commands: [
				{ type: 'source/add', source: replacement },
				{ type: 'project-bin/replace-media', clipId: clip.id, replacements: [{ oldSourceId: source.id, newSourceId: replacement.id }],
					templates: [{ ...project.projectBin.clips[0]!, id: 'replacement-bin', sourceId: replacement.id }], shortfallMode: 'keep-spacing' },
			] });
			assert.equal(project.projectBin.clips[0]?.sourceId, replacement.id);
		}
		assert.equal(project.sources.some(candidate => candidate.id === source.id), grouped);
		assert.equal(validateSoundscaperProject(project), true);
		if (grouped) {
			const retained = project.sources.find(candidate => candidate.id === source.id);
			assert.deepEqual(retained, source);
			const service = createTakeCompService({ lifetime: { assertActive() {} }, getProject: () => project,
				editingBlocked: () => false, commit: () => assert.fail('Audition does not edit the document.'),
			});
			assert.equal(service.auditionTake('cycle-produced-group', 'cycle-produced-take-a').takeId, 'cycle-produced-take-a');
		}
	});
}
