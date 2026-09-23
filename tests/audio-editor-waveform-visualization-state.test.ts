/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_TRACK_DISPLAY_MODES,
	isFrequencyWaveformDisplayMode,
	isTrackDisplayMode,
	timelineViewForTrackDisplayMode,
} from '../src/common/editor/track-display-mode.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorTrackService,
	type EditorTrackServiceDependencies,
} from '../src/common/editor/controller/track-audio/internal/track-service.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import {
	createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1,
	updateAudioEditorPreferencesV1,
	validateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';

test('track display modes share one canonical contract and special waveforms keep the global waveform view', () => {
	assert.deepEqual(AUDIO_EDITOR_TRACK_DISPLAY_MODES, [
		'waveform',
		'spectrogram',
		'multiview',
		'half-wave',
		'waveform-three-band',
		'waveform-rainbow',
	]);
	for (const displayMode of AUDIO_EDITOR_TRACK_DISPLAY_MODES) {
		assert.equal(isTrackDisplayMode(displayMode), true);
		const track = createAudioTrack({ id: displayMode, displayMode });
		assert.equal(track.displayMode, displayMode);
		assert.doesNotThrow(() => createAudioEditorProjectV17({
			id: `project-${displayMode}`,
			now: '2026-09-22T00:00:00.000Z',
			tracks: [track],
		}));
	}
	assert.equal(isTrackDisplayMode('frequency-bars'), false);
	assert.equal(isFrequencyWaveformDisplayMode('waveform-three-band'), true);
	assert.equal(isFrequencyWaveformDisplayMode('waveform-rainbow'), true);
	assert.equal(isFrequencyWaveformDisplayMode('waveform'), false);
	assert.equal(timelineViewForTrackDisplayMode('spectrogram'), 'spectrogram');
	assert.equal(timelineViewForTrackDisplayMode('multiview'), 'multiview');
	assert.equal(timelineViewForTrackDisplayMode('waveform-three-band'), 'waveform');
	assert.equal(timelineViewForTrackDisplayMode('waveform-rainbow'), 'waveform');
	assert.throws(
		() => createAudioTrack({ id: 'unsupported', displayMode: 'frequency-bars' }),
		/track\.displayMode has an unsupported value/u,
	);
});

test('waveform visualization preferences default, update, validate, and migrate within schema v1', () => {
	const defaults = createAudioEditorPreferencesV1();
	assert.deepEqual(defaults.waveformVisualization, {
		lowMidCrossoverHz: 250,
		midHighCrossoverHz: 4_000,
	});

	const customized = updateAudioEditorPreferencesV1(defaults, {
		waveformVisualization: {
			lowMidCrossoverHz: 320,
			midHighCrossoverHz: 5_200,
		},
	});
	assert.deepEqual(customized.waveformVisualization, {
		lowMidCrossoverHz: 320,
		midHighCrossoverHz: 5_200,
	});
	assert.equal(validateAudioEditorPreferencesV1(customized), true);

	for (const waveformVisualization of [
		{ lowMidCrossoverHz: null, midHighCrossoverHz: 4_000 },
		{ lowMidCrossoverHz: 19, midHighCrossoverHz: 4_000 },
		{ lowMidCrossoverHz: 250.5, midHighCrossoverHz: 4_000 },
		{ lowMidCrossoverHz: 250, midHighCrossoverHz: 20_001 },
		{ lowMidCrossoverHz: 4_000, midHighCrossoverHz: 4_000 },
		{ lowMidCrossoverHz: 5_000, midHighCrossoverHz: 4_000 },
	]) {
		assert.throws(
			() => createAudioEditorPreferencesV1({ waveformVisualization }),
			/waveform visualization|waveformVisualization/iu,
		);
	}

	const legacy = structuredClone(defaults);
	Reflect.deleteProperty(legacy, 'waveformVisualization');
	assert.equal(validateAudioEditorPreferencesV1(legacy), true);
	assert.deepEqual(loadAudioEditorPreferencesV1(legacy).preferences.waveformVisualization, {
		lowMidCrossoverHz: 250,
		midHighCrossoverHz: 4_000,
	});
});

test('track display commands persist special modes while mapping the global timeline to waveform', () => {
	const project = createAudioEditorProjectV17({
		id: 'frequency-waveform-display-project',
		now: '2026-09-22T00:00:00.000Z',
		tracks: [createAudioTrack({ id: 'audio-track', halfWave: false })],
	}) as unknown as ControllerProject;
	const commands: AudioEditorCommand[] = [];
	const timelineViews: string[] = [];
	const dependencies: EditorTrackServiceDependencies = {
		lifetime: { assertActive() {} },
		copy: {
			track: 'Track', labels: 'Labels', recordingDesktopAudio: 'Desktop audio',
			trackDestinationInvalid: 'Invalid destination', trackNotFound: 'Track missing',
			v2Required: 'Current project required', audioTrackRequired: 'Audio required',
			unknownTrackDisplay: 'Unknown display',
		},
		trackColors: ['blue'],
		recording: {
			defaultDeviceId: 'default', displaySourceKey: 'display',
			getRouting: () => ({ routes: {}, offsets: {} }), setRouting() {},
			getPreferredDeviceId: () => 'default', getPreferredChannelCount: () => 1,
			getDevices: () => [], getPoolSources: () => [],
			setTrackRoute: (routing) => routing, setRouteHealth() {}, updateDeviceRows() {},
			persistRouting: async () => undefined, publish() {},
		},
		getProject: () => project,
		getSelectedTrackId: () => 'audio-track',
		editingBlocked: () => false,
		createId: (prefix) => prefix,
		commit: (command) => { commands.push(command); return command; },
		getPositionFrames: () => 0,
		snapTimelineFrame: (frame) => frame,
		setTimelineView: (view) => { timelineViews.push(view); },
	};
	const service = createEditorTrackService(dependencies);
	service.setTrackDisplayMode('audio-track', 'waveform-three-band');
	service.setTrackDisplayMode('audio-track', 'waveform-rainbow');

	assert.deepEqual(timelineViews, ['waveform', 'waveform']);
	assert.deepEqual(commands.map((command) => (
		command.type === 'track/update' ? command.changes.displayMode : null
	)), ['waveform-three-band', 'waveform-rainbow']);
	service.setTrackDisplayMode('audio-track', 'half-wave');
	const halfWaveCommand = commands.at(-1);
	assert.ok(halfWaveCommand?.type === 'track/update');
	assert.equal(halfWaveCommand.changes.halfWave, true, 'legacy half-wave actions enable a previously unchecked option');
});
