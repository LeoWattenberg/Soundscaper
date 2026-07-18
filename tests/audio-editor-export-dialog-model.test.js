import test from 'node:test';
import assert from 'node:assert/strict';

import {
	VIDEO_EXPORT_DIALOG_FORMATS,
	createExportDialogRequest,
	isVideoExportDialogFormat,
	projectHasTimelineVideo,
} from '../src/components/tools/audio-editor/export-dialog-model.js';

test('video export formats only apply when a video clip is assigned to a timeline video track', () => {
	const project = {
		clips: [
			{ id: 'timeline-video', kind: 'video' },
			{ id: 'timeline-audio', kind: 'audio' },
		],
		tracks: [
			{ id: 'video-track', type: 'video', clipIds: ['timeline-video'] },
			{ id: 'audio-track', type: 'audio', clipIds: ['timeline-audio'] },
		],
		projectBin: {
			clips: [{ id: 'bin-video', kind: 'video' }],
		},
	};
	assert.equal(projectHasTimelineVideo(project), true);
	assert.equal(projectHasTimelineVideo({
		...project,
		tracks: [{ id: 'video-track', type: 'video', clipIds: [] }],
	}), false);
	assert.equal(projectHasTimelineVideo({
		clips: [],
		tracks: [],
		projectBin: project.projectBin,
	}), false);
	assert.deepEqual(VIDEO_EXPORT_DIALOG_FORMATS.map(({ id }) => id), ['video-mp4', 'video-webm']);
	assert.equal(isVideoExportDialogFormat('video-mp4'), true);
	assert.equal(isVideoExportDialogFormat('mp4'), false);
});

test('video export requests use the single mixed video path without audio encoder settings', () => {
	const request = createExportDialogRequest({
		mode: 'stems',
		range: 'selection',
		format: 'video-webm',
		sampleFormat: 'int24',
		bitRate: '320',
		sampleRate: '96000',
		dither: 'triangular',
		customArguments: '-custom',
		includeTail: true,
	}, {
		metadata: { title: 'Video' },
		channelMapping: 'stereo',
	});
	assert.deepEqual(request, {
		mode: 'mix',
		range: 'selection',
		format: 'video-webm',
		metadata: { title: 'Video' },
	});
});

test('audio export request settings remain unchanged', () => {
	const request = createExportDialogRequest({
		mode: 'stems',
		range: 'loop',
		format: 'mp3',
		sampleFormat: 'int24',
		bitRate: '192',
		quality: '5',
		compressionLevel: '5',
		sampleRate: '48000',
		dither: 'triangular',
		customExtension: '',
		customMimeType: 'application/octet-stream',
		customArguments: ' -id3v2_version\n 3 ',
		includeTail: true,
	}, {
		metadata: { artist: 'Soundscaper' },
		channelMapping: 'stereo',
	});
	assert.deepEqual(request, {
		mode: 'stems',
		range: 'loop',
		format: 'mp3',
		sampleFormat: 'int24',
		bitDepth: 24,
		floatingPoint: false,
		bitRate: 192,
		quality: undefined,
		compressionLevel: undefined,
		sampleRate: 48_000,
		channelMapping: 'stereo',
		dither: 'triangular',
		metadata: { artist: 'Soundscaper' },
		extension: '',
		mimeType: 'application/octet-stream',
		customArguments: ['-id3v2_version', '3'],
		includeTail: true,
	});
});
