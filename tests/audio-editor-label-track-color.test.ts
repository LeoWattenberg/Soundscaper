/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

const options = { id: 'labels', masterChannels: 2, tracks: [createLabelTrack({ id: 'cues', name: 'Cues' })],
	sequences: [{ id: 'main', trackIds: ['cues'] }], primarySequenceId: 'main' };

for (const product of ['soundscaper', 'framescaper']) test(`${product} retains optional label palette without changing uncolored documents`, () => {
	assert.equal(Object.hasOwn(createLabelTrack({}), 'color'), false);
	const command = { type: 'track/update' as const, trackId: 'cues', changes: { color: 'orange' } };
	if (product === 'soundscaper') {
		const initial = createSoundscaperProject(options);
		const changed = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(initial), command).present;
		assert.equal(changed.tracks[0]?.color, 'orange');
		assert.equal(validateSoundscaperProject(JSON.parse(JSON.stringify(changed))), true);
		assert.equal(Object.hasOwn(initial.tracks[0]!, 'color'), false);
		assert.throws(() => validateSoundscaperProject({ ...changed,
			tracks: [{ ...changed.tracks[0], unrecognizedLabelProperty: true }] }), /unsupported|unknown|field/iu);
	} else {
		const initial = createFramescaperProject(PROFILE, { id: options.id, masterChannels: 2, tracks: options.tracks });
		const changed = applyFramescaperProjectCommand(PROFILE, initial, command);
		assert.equal(changed.tracks[0]?.color, 'orange');
		assert.equal(validateFramescaperProject(PROFILE, JSON.parse(JSON.stringify(changed))), true);
		assert.equal(Object.hasOwn(initial.tracks[0]!, 'color'), false);
	}
	assert.throws(() => createLabelTrack({ color: '' }), /color/iu);
});
