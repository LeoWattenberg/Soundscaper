/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundActivationTimestampCommands } from '../src/common/editor/controller/recording/internal/sound-activation/sound-activation-timestamp-labels.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

for (const locks of [[false], [true], [true, false]]) {
	test(`recording timestamps choose a writable destination among label locks ${locks.join(',')}`, () => {
		const project = createSoundscaperProject({ id: 'recording', tracks: [createAudioTrack({ id: 'microphone' }),
			...locks.map((locked, index) => createLabelTrack({ id: `annotations-${index}`, name: `Annotations ${index}`,
				locked, labels: [{ id: `original-${index}`, title: 'Protected annotation', startFrame: 0, endFrame: 0 }] })),
		] });
		const original = structuredClone(project);
		let ordinal = 0;
		const commands = createSoundActivationTimestampCommands({ project, labelTrackName: 'Labels',
			projectSampleRate: 48_000, createId: prefix => `${prefix}-${++ordinal}`,
			timestamps: [{ startFrame: 0, offsetFrames: 2_400, sampleRate: 48_000, occurredAtMs: 1_790_514_321_125 }],
		});
		const imported = applySoundscaperProjectCommand(project, { type: 'batch', commands });
		assert.equal(validateSoundscaperProject(imported), true);
		for (const track of project.tracks.filter(track => track.locked)) {
			assert.deepEqual(imported.tracks.find(candidate => candidate.id === track.id), track);
		}
		const destinationId = locks.includes(false) ? `annotations-${locks.indexOf(false)}` : 'label-track-1';
		const destination = imported.tracks.find(track => track.id === destinationId);
		assert.ok(destination?.type === 'label');
		assert.equal(destination.labels.length, locks.includes(false) ? 2 : 1);
		const timestamp = destination.labels.at(-1)!;
		assert.equal(timestamp.startFrame, 2_400);
		assert.ok(typeof timestamp.title === 'string');
		assert.equal(Date.parse(timestamp.title), 1_790_514_321_125);
		assert.deepEqual(project, original);
	});
}
