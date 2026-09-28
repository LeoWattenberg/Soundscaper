/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorTrackService,
	type EditorTrackServiceDependencies,
} from '../src/common/editor/controller/track-audio/internal/track-service.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';

register(`data:text/javascript,${encodeURIComponent(`
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');

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

	defaults = { ...defaults, minimumFrequency: 5_000 };
	service.addTrack();
	assert.deepEqual(addedAudioTracks(commands[4]), [{
		...defaults, minimumFrequency: 0, maximumFrequency: 4_000,
	}]);
});

function addedAudioTracks(command: AudioEditorCommand | undefined): readonly (Readonly<Record<string, unknown>>)[] {
	if (!command) assert.fail('Expected a track command.');
	const additions = command.type === 'batch' ? command.commands : [command];
	return additions.flatMap((item) => item.type === 'track/add' && item.track.type === 'audio'
		? [item.track.spectrogram as Readonly<Record<string, unknown>>]
		: []);
}

test('the initial audio track in a new project inherits spectrogram preferences', async () => {
	const options = {
		headless: true,
		copy: {
			ready: 'Ready', untitledProject: 'Untitled project', track: 'Track',
			projectSaving: 'Saving', projectSaved: 'Saved', storage: 'Storage',
			genericError: 'Error: {message}', unknownError: 'Unknown error',
		},
		locale: 'en',
		store: createMemoryStore(),
		engine: {
			positionFrame: 0,
			loadProject() {}, async applyProject() {}, setSourceResolver() {},
			getPositionFrames() { return this.positionFrame; },
			getState() { return { state: 'stopped', loop: { enabled: false } }; },
			stop() {}, seek(frame: number) { this.positionFrame = frame; return frame; },
			async getAudioContext() { return null; }, async dispose() {},
		},
		ffmpeg: { dispose() {} },
	} as unknown as Parameters<typeof createAudioEditorController>[1];
	const controller = createAudioEditorController(null, options);
	try {
		await controller.ready;
		await controller.actions.preferences.update({ spectrogram: {
			scale: 'log', minimumFrequency: 100, maximumFrequency: 8_000,
			windowSize: 4_096, windowType: 'blackman', gain: 8, range: 65,
		} });
		await controller.actions.project.create({ sampleRate: 8_000 });
		const project = controller.getSnapshot().project as unknown as Readonly<{
			tracks: readonly Readonly<{ type: string; spectrogram: Readonly<Record<string, unknown>> }>[];
		}>;
		const track = project.tracks[0];
		assert.equal(track?.type, 'audio');
		assert.deepEqual(track.spectrogram, {
			scale: 'log', minimumFrequency: 100, maximumFrequency: 4_000,
			windowSize: 4_096, windowType: 'blackman', gain: 8, range: 65,
		});
	} finally {
		await controller.dispose();
	}
});
