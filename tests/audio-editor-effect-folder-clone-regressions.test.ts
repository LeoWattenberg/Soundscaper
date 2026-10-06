/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneSoundscaperProject, createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import type { EffectAudioProject } from '../src/common/editor/controller/effects/internal/effect-audio-service.ts';
import { createHarness, folderedLegacyProject } from './audio-editor-effect-audio-service-fixture.ts';

test('a foldered authored track renders through the actual Soundscaper project cloner', async () => {
	const legacy = folderedLegacyProject();
	const project = createSoundscaperProject({
		tracks: legacy.tracks, clips: legacy.clips, sources: legacy.sources,
		trackFolders: legacy.trackFolders, sequences: legacy.sequences,
		primarySequenceId: legacy.primarySequenceId,
	});
	const harness = createHarness({
		project: project as unknown as EffectAudioProject,
		cloneProject: (value) => cloneSoundscaperProject(value) as unknown as EffectAudioProject,
	});
	await harness.service.renderDryTrackRange('voice', 0, 8, 1, null, null, 'authored');
	assert.equal(harness.snapshots.length, 1);
	assert.deepEqual(harness.snapshots[0]!.tracks.map(({ id }) => id), ['voice']);
	assert.equal(Object.hasOwn(project, 'trackFolderStateProjectionVersion'), false);
});
