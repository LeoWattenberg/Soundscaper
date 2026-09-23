/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject, loadSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { resolveTrackWaveformOptions } from '../src/common/editor/track-display-mode.ts';

const NOW = '2026-09-24T00:00:00.000Z';

test('half-wave and RMS are independent persisted track options', () => {
	const project = createAudioEditorProjectV17({
		id: 'waveform-options', now: NOW,
		tracks: [createAudioTrack({ id: 'audio', displayMode: 'waveform-three-band' })],
	});
	const updated = applyEditorCommand(project, {
		type: 'track/update', trackId: 'audio', changes: { halfWave: true, showRms: true },
	}, { now: NOW });
	const reopened = createAudioEditorProjectV17(JSON.parse(JSON.stringify(updated)));
	const track = reopened.tracks[0];
	assert.ok(track?.type === 'audio');
	assert.equal(track.displayMode, 'waveform-three-band');
	assert.equal(track.halfWave, true);
	assert.equal(track.showRms, true);
	assert.deepEqual(resolveTrackWaveformOptions(track, 'waveform', false), {
		displayMode: 'waveform-three-band', halfWave: true, showRms: true,
	});
});

test('legacy half-wave projects and inherited display defaults remain compatible', () => {
	assert.deepEqual(resolveTrackWaveformOptions({ displayMode: 'half-wave' }), {
		displayMode: 'half-wave', halfWave: true, showRms: false,
	});
	assert.deepEqual(resolveTrackWaveformOptions({ displayMode: 'half-wave', halfWave: false }), {
		displayMode: 'half-wave', halfWave: false, showRms: false,
	});
	assert.deepEqual(resolveTrackWaveformOptions({ displayMode: 'waveform' }, 'half-wave', true), {
		displayMode: 'half-wave', halfWave: true, showRms: true,
	});
	assert.deepEqual(resolveTrackWaveformOptions({ displayMode: 'waveform', showRms: false }, 'waveform-rainbow', true), {
		displayMode: 'waveform-rainbow', halfWave: false, showRms: false,
	});
	const legacyTrack = createAudioTrack({ id: 'legacy' });
	assert.equal(Object.hasOwn(legacyTrack, 'halfWave'), false);
	assert.equal(Object.hasOwn(legacyTrack, 'showRms'), false);
});


test('production Soundscaper track commands retain half-wave and RMS through reload', () => {
	const project = createSoundscaperProject({
		id: 'production-waveform-options', now: NOW,
		tracks: [createAudioTrack({ id: 'audio', displayMode: 'waveform-three-band' })],
	});
	const updated = applySoundscaperProjectCommand(project, {
		type: 'track/update', trackId: 'audio', changes: { halfWave: true, showRms: true },
	}, { now: NOW });
	const reopened = loadSoundscaperProject(JSON.parse(JSON.stringify(updated))).project;
	assert.ok(validateSoundscaperProject(reopened));
	const track = reopened.tracks[0];
	assert.equal(track?.displayMode, 'waveform-three-band');
	assert.equal(track?.halfWave, true);
	assert.equal(track?.showRms, true);
});
