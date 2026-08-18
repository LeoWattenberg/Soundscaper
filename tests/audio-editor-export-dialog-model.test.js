import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { VIDEO_DELIVERY_QUALITY_TIERS } from '../src/common/editor/video-delivery-quality.ts';
import { VIDEO_CANVAS_FIT_MODES } from '../src/common/editor/video-canvas-fit.ts';
import { CANONICAL_EXTRA_COPY_BY_LOCALE } from '../src/common/i18n/canonical-extras.js';
import {
	VIDEO_EXPORT_DIALOG_FORMATS,
	createExportDialogRequest,
	isVideoExportDialogFormat,
	projectHasTimelineVideo,
} from '../src/common/editor/ui/export-dialog-model.js';

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

test('Broadcast WAV requests carry structured BEXT metadata without changing ordinary WAV requests', () => {
	const settings = {
		mode: 'mix',
		range: 'project',
		format: 'bwf',
		sampleFormat: 'int24',
		bitRate: '192',
		quality: '5',
		compressionLevel: '5',
		sampleRate: '48000',
		dither: 'triangular',
		customExtension: '',
		customMimeType: 'application/octet-stream',
		customArguments: '',
		includeTail: true,
	};
	const bext = {
		version: 2,
		description: 'News mix',
		originator: 'Soundscaper',
		originatorReference: '',
		originationDate: '2026-07-28',
		originationTime: '20:10:00',
		timeReference: '9007199254740993',
		umid: '',
		loudnessValue: -23,
		loudnessRange: null,
		maxTruePeakLevel: null,
		maxMomentaryLoudness: null,
		maxShortTermLoudness: null,
		codingHistory: '',
	};

	assert.deepEqual(createExportDialogRequest(settings, { bext, metadata: {}, channelMapping: 'stereo' }).bext, bext);
	const bw64 = createExportDialogRequest({ ...settings, mode: 'stems', format: 'bw64' }, {
		adm: { mode: 'authored' },
		bext,
		metadata: {},
		channelMapping: 'preserve',
	});
	assert.equal(bw64.mode, 'mix');
	assert.deepEqual(bw64.bext, bext);
	assert.deepEqual(bw64.adm, { mode: 'authored' });
	assert.equal(createExportDialogRequest({ ...settings, format: 'wav' }, { bext, metadata: {}, channelMapping: 'stereo' }).bext, undefined);
});

test('the export dialog reaches the delivery canvas for a video format and only for one', async () => {
	const dialog = await readFile(new URL('../src/common/editor/ui/inspector/ExportDialog.jsx', import.meta.url), 'utf8');
	const fields = await readFile(new URL('../src/common/editor/ui/VideoDeliveryFields.jsx', import.meta.url), 'utf8');

	// The canvas is a video decision, so the dialog must gate it on the format
	// rather than parking two more permanent controls on an audio export.
	assert.match(dialog, /\{videoFormat && \(\s*<VideoDeliveryFields/u);
	assert.match(fields, /data-export-field="canvasSize"/u);
	assert.match(fields, /data-export-field="canvasFrameRate"/u);
	assert.match(fields, /data-export-field="canvasBackground"/u);
	assert.match(fields, /hook="canvasFit"/u);
	assert.match(fields, /hook="videoQuality"/u);
	assert.match(fields, /hook="videoAudioLayout"/u);
	assert.match(fields, /hook="captionTrack"/u);
	assert.match(fields, /hook="captionDelivery"/u);
	assert.match(fields, /data-export-field="captionBurnIn"/u);
	for (const fit of VIDEO_CANVAS_FIT_MODES) {
		assert.match(fields, new RegExp(`${fit}: 'videoCanvasFit`, 'u'), `${fit} needs a label of its own`);
	}
	for (const tier of VIDEO_DELIVERY_QUALITY_TIERS) {
		assert.match(fields, new RegExp(`${tier}: 'videoQuality`, 'u'), `${tier} needs a label of its own`);
	}
});

test('a video request states a tier only when the dialog asked for one', () => {
	const settings = {
		mode: 'mix', range: 'project', format: 'video-mp4',
		canvasWidth: '', canvasHeight: '', canvasFit: 'contain',
		canvasFrameRate: '', canvasBackgroundColor: '', videoQuality: 'balanced',
	};

	// An untouched dialog must produce the request it always produced, so the
	// delivery it names stays byte-identical.
	assert.equal(Object.hasOwn(createExportDialogRequest(settings, { metadata: {} }), 'quality'), false);
	assert.equal(createExportDialogRequest({ ...settings, videoQuality: 'high' }, { metadata: {} }).quality, 'high');
});

test('every delivery-canvas control has copy in both catalogs', () => {
	const keys = [
		'videoCanvasSize', 'videoCanvasWidth', 'videoCanvasHeight', 'videoCanvasFit',
		'videoCanvasFitContain', 'videoCanvasFitCover', 'videoCanvasFitStretch',
		'videoCanvasAutomatic', 'videoCanvasFrameRate', 'videoCanvasBackground',
		'videoCanvasHint',
		'videoQuality', 'videoQualityDraft', 'videoQualityBalanced', 'videoQualityHigh',
		'videoCaptionTrack', 'videoCaptionNone', 'videoCaptionDelivery',
		'videoCaptionDeliveryMux', 'videoCaptionDeliverySrt', 'videoCaptionDeliveryVtt',
		'videoCaptionDeliveryMuxSrt', 'videoCaptionDeliveryMuxVtt',
		'videoCaptionBurnIn', 'videoCaptionBurnInHint',
	];
	for (const locale of ['en', 'de']) {
		const catalog = CANONICAL_EXTRA_COPY_BY_LOCALE[locale];
		for (const key of keys) {
			assert.equal(typeof catalog[key], 'string', `${locale} is missing ${key}`);
			assert.ok(catalog[key].length > 0, `${locale} ${key} must not be empty`);
		}
	}
});
