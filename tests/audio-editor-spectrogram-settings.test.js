import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createAddTrackCommand,
	createAudioEditorPreferencesV1,
	createAudioEditorProjectV2,
	updateAudioEditorPreferencesV1,
} from '../src/common/editor/index.js';

function apply(project, command) {
	return applyEditorCommand(project, command, { now: '2026-07-13T00:00:00.000Z' });
}

test('legacy spectrogram workspace panels are removed from normalized preferences', () => {
	const preferences = createAudioEditorPreferencesV1({
		workspace: {
			panels: { spectrogram: { visible: true, dock: 'bottom', order: 0, size: 240 } },
		},
	});
	assert.equal(Object.hasOwn(preferences.workspace.panels, 'spectrogram'), false);
});

test('spectrogram settings are stored per track while preferences remain new-track defaults', () => {
	const defaults = createAudioEditorPreferencesV1({
		spectrogram: {
			scale: 'mel',
			minimumFrequency: 20,
			maximumFrequency: 18_000,
			windowSize: 2_048,
			windowType: 'hann',
			range: 80,
		},
	});
	const changedDefaults = updateAudioEditorPreferencesV1(defaults, {
		spectrogram: { scale: 'linear', windowSize: 4_096 },
	});
	assert.equal(changedDefaults.spectrogram.scale, 'linear');
	assert.equal(changedDefaults.spectrogram.windowSize, 4_096);
	assert.equal(changedDefaults.spectrogram.maximumFrequency, 18_000);

	let project = createAudioEditorProjectV2({
		id: 'spectrogram-settings-project',
		title: 'Spectrogram settings',
		sampleRate: 48_000,
		now: '2026-07-13T00:00:00.000Z',
	});
	project = apply(project, createAddTrackCommand({
		schemaVersion: 2,
		id: 'spectrogram-track',
		name: 'Spectrogram track',
		spectrogram: defaults.spectrogram,
	}));
	project = apply(project, {
		type: 'track/update',
		trackId: 'spectrogram-track',
		changes: {
			displayMode: 'spectrogram',
			spectrogram: {
				...project.tracks[0].spectrogram,
				scale: 'log',
				minimumFrequency: 80,
				maximumFrequency: 12_000,
				windowSize: 8_192,
				windowType: 'blackman',
				range: 110,
			},
		},
	});

	assert.deepEqual(
		Object.fromEntries(['scale', 'minimumFrequency', 'maximumFrequency', 'windowSize', 'windowType', 'range']
			.map((name) => [name, project.tracks[0].spectrogram[name]])),
		{
			scale: 'log',
			minimumFrequency: 80,
			maximumFrequency: 12_000,
			windowSize: 8_192,
			windowType: 'blackman',
			range: 110,
		},
	);
	assert.equal(defaults.spectrogram.scale, 'mel');
	assert.throws(() => apply(project, {
		type: 'track/update',
		trackId: 'spectrogram-track',
		changes: {
			spectrogram: {
				...project.tracks[0].spectrogram,
				minimumFrequency: 16_000,
				maximumFrequency: 12_000,
			},
		},
	}), /positive frequency range/);
});

test('time-frequency selections preserve independently adjustable frame and frequency bounds', () => {
	let project = createAudioEditorProjectV2({
		id: 'spectral-selection-project',
		title: 'Spectral selection',
		sampleRate: 48_000,
		now: '2026-07-13T00:00:00.000Z',
	});
	project = apply(project, createAddTrackCommand({
		schemaVersion: 2,
		id: 'spectral-track',
		name: 'Spectral track',
	}));
	project = apply(project, {
		type: 'selection/set',
		startFrame: 4_800,
		endFrame: 24_000,
		trackIds: ['spectral-track'],
		clipIds: [],
		frequencyRange: { minimumFrequency: 300, maximumFrequency: 8_000 },
	});
	project = apply(project, {
		type: 'selection/set',
		startFrame: 4_801,
		endFrame: 23_999,
		trackIds: project.selection.trackIds,
		clipIds: project.selection.clipIds,
		frequencyRange: { minimumFrequency: 310, maximumFrequency: 7_990 },
	});

	assert.deepEqual(project.selection, {
		startFrame: 4_801,
		endFrame: 23_999,
		trackIds: ['spectral-track'],
		clipIds: [],
		frequencyRange: { minimumFrequency: 310, maximumFrequency: 7_990 },
	});
});
