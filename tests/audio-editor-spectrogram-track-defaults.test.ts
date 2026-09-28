/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorTrackService,
	type EditorTrackServiceDependencies,
} from '../src/common/editor/controller/track-audio/internal/track-service.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

test('new audio tracks inherit current spectrogram preferences without replacing explicit settings', () => {
	const commands: AudioEditorCommand[] = [];
	let sampleRate = 48_000;
	let defaults = {
		scale: 'linear', minimumFrequency: 100, maximumFrequency: 8_000,
		windowSize: 4_096, windowType: 'hamming', gain: 12, range: 60,
	};
	let nextId = 0;
	const dependencies: EditorTrackServiceDependencies & {
		getSpectrogramDefaults(): typeof defaults;
	} = {
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
		getProject: () => ({
			id: 'project', title: 'Project', schemaVersion: 17,
			sampleRate, tracks: [], clips: [], sources: [],
		}) as unknown as ControllerProject,
		getSelectedTrackId: () => null,
		getSpectrogramDefaults: () => defaults,
		editingBlocked: () => false,
		createId: (prefix) => `${prefix}-${++nextId}`,
		commit: (command) => { commands.push(command); return command; },
		getPositionFrames: () => 0,
		snapTimelineFrame: (frame) => frame,
		setTimelineView() {},
	};
	const service = createEditorTrackService(dependencies);

	service.addTrack();
	assert.deepEqual(addedAudioTracks(commands[0]), [defaults]);

	defaults = { ...defaults, scale: 'log', windowSize: 8_192 };
	sampleRate = 8_000;
	service.addVideoTrackPair({ name: 'Picture' });
	assert.deepEqual(addedAudioTracks(commands[1]), [{
		...defaults, maximumFrequency: 4_000,
	}]);

	const authored = {
		scale: 'mel', minimumFrequency: 0, maximumFrequency: 3_000,
		windowSize: 1_024, windowType: 'blackman', gain: 5, range: 40,
	};
	service.addTrack({ spectrogram: authored });
	assert.deepEqual(addedAudioTracks(commands[2]), [authored]);

	service.addTrack({ spectrogram: { windowSize: 2_048 } });
	assert.deepEqual(addedAudioTracks(commands[3]), [{
		...defaults, maximumFrequency: 4_000, windowSize: 2_048,
	}]);
});

function addedAudioTracks(command: AudioEditorCommand | undefined): readonly (Readonly<Record<string, unknown>>)[] {
	if (!command) assert.fail('Expected a track command.');
	const additions = command.type === 'batch' ? command.commands : [command];
	return additions.flatMap((item) => item.type === 'track/add' && item.track.type === 'audio'
		? [item.track.spectrogram]
		: []);
}
