/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export-service.ts';
import { countUnreportedDeliveryConversions } from '../src/common/editor/delivery-conversion-inventory.ts';
import { createFixture, defaultPlan, defaultProject } from './helpers/export-service-fixture.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';

test('desktop compressed export refuses an unavailable exact tuple before rendering', async () => {
	const fixture = createFixture();
	fixture.setPlan({
		...defaultPlan(), format: 'opus', mimeType: 'audio/ogg', extension: 'opus',
		container: 'Ogg Opus', codec: 'opus',
	});
	const runtime = {
		...fixture.runtime,
		ffmpeg: {
			...fixture.runtime.ffmpeg,
			[DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true as const,
			desktopAudioCodecCapabilities: (query: { operations: readonly Record<string, unknown>[] }) => ({
				schemaVersion: 1,
				capabilities: query.operations.map((operation) => ({
					...operation, available: false, provider: null,
					reason: 'configure-external-ffmpeg',
				})),
			}),
		},
	};
	await createEditorExportService(runtime).handleExportAction('export', { format: 'opus' });
	assert.equal(fixture.errors.length, 1);
	assert.match(String(fixture.errors[0]), /Preferences > General/iu);
	assert.equal(fixture.calls.includes('render-realtime'), false);
});

test('export action cancellation and preconditions preserve idle state', async () => {
	const fixture = createFixture();
	let aborted = false;
	fixture.state.exportAbort = { signal: new AbortController().signal, abort: () => { aborted = true; } };
	await createEditorExportService(fixture.runtime).handleExportAction('cancel');
	assert.equal(aborted, true);
	assert.equal(fixture.state.exportAbort, null);
	assert.equal(fixture.calls.includes('ffmpeg-dispose'), true);

	const empty = createFixture();
	empty.setProject({ ...defaultProject(), clips: [] });
	assert.equal(await createEditorExportService(empty.runtime).handleExportAction('export'), undefined);

	const busy = createFixture();
	busy.state.exportAbort = { signal: new AbortController().signal, abort: () => undefined };
	assert.equal(await createEditorExportService(busy.runtime).handleExportAction('export'), undefined);

	const missing = createFixture();
	missing.setMissingSources(true);
	await assert.rejects(
		() => createEditorExportService(missing.runtime).handleExportAction('export'),
		/Local sources missing/iu,
	);
});

test('an export never re-validates the delivery projection through the product clone', async () => {
	// The delivery projection is not a canonical document — it carries the folder
	// projection marker and any frozen substitution playback renders — so putting
	// it through the product's validating clone refused exactly the projects that
	// play. Nothing in the export may reach for that clone.
	const fixture = createFixture();
	const runtime = {
		...fixture.runtime,
		cloneProject: () => {
			throw new TypeError('Soundscaper project contains an unsupported field.');
		},
	};
	const output = await createEditorExportService(runtime).handleExportAction('export');
	assert.equal(output.fileName, 'mix.wav');
	assert.equal(fixture.state.exportAbort, null, 'a failed clone used to wedge the export flag');
});

test('audio export awaits product-owned live state capture before reading the project', async () => {
	const fixture = createFixture();
	let captured = false;
	const runtime = {
		...fixture.runtime,
		prepareProjectForExport: async (purpose: string) => {
			assert.equal(purpose, 'audio-export');
			captured = true;
		},
		getProject: () => {
			assert.equal(captured, true);
			return fixture.runtime.getProject();
		},
	};
	assert.equal((await createEditorExportService(runtime).handleExportAction('export')).fileName, 'mix.wav');
});

test('offline WAV and AIFF exports replace prior output and chain cleanup', async () => {
	const fixture = createFixture();
	fixture.state.outputUrl = 'blob:old';
	fixture.state.outputCleanup = async () => { fixture.calls.push('old-cleanup'); };
	const service = createEditorExportService(fixture.runtime);
	const output = await service.handleExportAction('export', { includeTail: true, bitDepth: 32 });
	assert.equal(output.fileName, 'mix.wav');
	assert.equal(output.mimeType, 'audio/wav');
	assert.equal(fixture.calls.includes('old-cleanup'), true);
	assert.deepEqual(fixture.statuses.at(-1), ['Done', 'success']);
	await fixture.state.outputCleanup?.();
	assert.equal(fixture.calls.includes('download-cleanup'), true);

	const aiff = defaultPlan();
	aiff.format = 'aiff';
	aiff.mimeType = 'audio/aiff';
	aiff.outputs = [{ fileName: 'mix.aiff', trackId: 'video-track' }];
	aiff.sampleRate = 44_100;
	fixture.setPlan(aiff);
	fixture.state.disposed = false;
	const aiffOutput = await service.handleExportAction('export', { bitDepth: 16 });
	assert.equal(aiffOutput.fileName, 'mix.aiff');
	assert.equal(fixture.downloads.at(-1)?.mimeType, 'audio/aiff');
});

test('offline sample-rate conversion encodes the exact planned native frame count', async () => {
	const fixture = createFixture();
	const converted = defaultPlan();
	converted.sampleRate = 44_100;
	converted.outputFrames = 12;
	fixture.setPlan(converted);
	await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.deepEqual(fixture.resampleFrameRequests, [12]);
	assert.deepEqual(fixture.encodedFrameCounts, [12]);
});

test('offline and realtime BWF exports pass final file-level BEXT metadata to the WAV encoder', async () => {
	const bext = { description: 'Broadcast master', timeReference: '66150', version: 2 };
	const offline = createFixture();
	const offlinePlan = defaultPlan();
	offlinePlan.format = 'bwf';
	offlinePlan.bext = bext;
	offlinePlan.encoding = { ...offlinePlan.encoding };
	offline.setPlan(offlinePlan);
	const offlineResult = await createEditorExportService(offline.runtime).handleExportAction('export');
	assert.equal(offlineResult.mimeType, 'audio/wav');
	assert.deepEqual(offline.wavOptions.at(-1)?.bext, bext);

	const realtime = createFixture();
	const realtimePlan = { ...offlinePlan, render: { strategy: 'realtime-stream' } };
	realtime.setPlan(realtimePlan);
	const realtimeResult = await createEditorExportService(realtime.runtime).handleExportAction('export');
	assert.equal(realtimeResult.mimeType, 'audio/wav');
	assert.deepEqual(realtime.streamEncoderOptions.at(-1)?.bext, bext);
});

test('compressed exports stage PCM and return publisher cancellation cleanly', async () => {
	const fixture = createFixture();
	const compressed = defaultPlan();
	compressed.format = 'mp3';
	compressed.mimeType = 'audio/mpeg';
	compressed.encoding = { sampleFormat: 'int24' };
	compressed.ditherMode = 'triangular';
	compressed.outputs = [{ fileName: 'mix.mp3', trackId: 'video-track' }];
	fixture.setPlan(compressed);
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export', { bitDepth: 16 });
	assert.equal(result.mimeType, 'audio/mp3');
	assert.equal(fixture.statuses.some(([message]) => message === 'Encoding'), true);

	fixture.setPublishCancelled(true);
	const cancelled = await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.equal(cancelled.cancelled, true);
	assert.equal(fixture.state.outputUrl, null);
});

test('stem exports archive each output, report progress, and abort failed archives', async () => {
	const fixture = createFixture();
	const renderRanges: Array<Record<string, unknown>> = [];
	const renderSnapshot = fixture.renderOptions.renderSnapshot!;
	fixture.renderOptions.renderSnapshot = async (...args: unknown[]) => {
		renderRanges.push(args[1] as Record<string, unknown>);
		return renderSnapshot(...args);
	};
	const stems = defaultPlan();
	stems.mode = 'stems';
	stems.outputs = [
		{ fileName: 'one.wav', trackId: 'one', includeMaster: false, respectMuteSolo: false },
		{ fileName: 'two.wav', trackId: 'two', includeMaster: false, respectMuteSolo: false },
	];
	stems.requiredTemporaryBytes = 768;
	stems.archive = {
		format: '7z',
		fileName: 'stems.7z',
		mimeType: 'application/x-7z-compressed',
		expectedByteLength: 512,
		entries: stems.outputs.map(({ fileName }) => ({ fileName, expectedByteLength: 128 })),
	};
	fixture.setPlan(stems);
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.equal(result.fileName, 'stems.7z');
	assert.equal(result.mimeType, 'application/x-7z-compressed');
	assert.equal(fixture.calls.includes('archive-create:7z:stems.7z'), true);
	assert.equal(fixture.preflightBytes[0], 768);
	assert.deepEqual(fixture.progress, [0.5, 1]);
	assert.equal(fixture.calls.filter((entry) => entry.startsWith('archive-add')).length, 2);
	assert.deepEqual(renderRanges.map(({ trackId, includeMaster, respectMuteSolo }) => ({
		trackId, includeMaster, respectMuteSolo,
	})), [
		{ trackId: 'one', includeMaster: false, respectMuteSolo: false },
		{ trackId: 'two', includeMaster: false, respectMuteSolo: false },
	]);
	assert.equal(renderRanges.some((range) => 'fileName' in range || 'kind' in range), false);

	const realtime = createFixture();
	const realtimeStems = structuredClone(stems);
	realtimeStems.outputs = [stems.outputs[0]!];
	realtimeStems.archive!.entries = [stems.archive.entries[0]!];
	realtimeStems.render = { strategy: 'realtime-stream' };
	realtime.setPlan(realtimeStems);
	await createEditorExportService(realtime.runtime).handleExportAction('export');
	assert.deepEqual(realtime.realtimeRenderOptions.map(({ trackId, includeMaster, respectMuteSolo }) => ({
		trackId, includeMaster, respectMuteSolo,
	})), [{ trackId: 'one', includeMaster: false, respectMuteSolo: false }]);
	assert.equal(realtime.realtimeRenderOptions.some((range) => 'fileName' in range || 'kind' in range), false);

	const failed = createFixture();
	failed.setPlan(stems);
	failed.setArchiveAddFails(true);
	assert.equal(await createEditorExportService(failed.runtime).handleExportAction('export'), undefined);
	assert.equal(failed.calls.includes('archive-abort'), true);
	assert.match((failed.errors[0] as Error).message, /archive add failed/u);
});

test('realtime exports stream native PCM and transcode staged compressed formats', async () => {
	const native = createFixture();
	const nativePlan = defaultPlan();
	nativePlan.render = { strategy: 'realtime-stream' };
	native.setPlan(nativePlan);
	const nativeResult = await createEditorExportService(native.runtime).handleExportAction('export', { includeTail: true });
	assert.equal(nativeResult.mimeType, 'audio/wav');
	assert.equal(native.calls.includes('sink-write'), true);
	assert.equal(native.calls.includes('render-realtime'), true);
	assert.deepEqual(native.progress, [0.25]);
	await native.state.outputCleanup?.();
	assert.equal(native.calls.includes('sink-remove'), true);

	const flac = createFixture();
	const flacPlan = defaultPlan();
	flacPlan.render = { strategy: 'realtime-stream' };
	flacPlan.format = 'flac';
	flacPlan.mimeType = 'audio/flac';
	flacPlan.encoding = { bitDepth: 24, sampleFormat: 'int24' };
	flacPlan.outputs = [{ fileName: 'mix.flac', trackId: 'one' }];
	flac.setPlan(flacPlan);
	const flacResult = await createEditorExportService(flac.runtime).handleExportAction('export', { bitDepth: 24 });
	assert.equal(flacResult.mimeType, 'audio/flac');
	assert.equal(flac.calls.includes('sink-remove'), true);
});

test('realtime export handles storage requirements and renderer failures', async () => {
	const storage = createFixture();
	const huge = defaultPlan();
	huge.render = { strategy: 'realtime-stream' };
	huge.outputBytesPerRender = 97 * 1024 ** 2;
	storage.setPlan(huge);
	storage.setSinkPersistent(false);
	assert.equal(await createEditorExportService(storage.runtime).handleExportAction('export'), undefined);
	assert.equal(storage.calls.includes('sink-abort'), true);
	assert.match((storage.errors[0] as Error).message, /storage required/u);

	const renderer = createFixture();
	const realtime = defaultPlan();
	realtime.render = { strategy: 'realtime-stream' };
	renderer.setPlan(realtime);
	renderer.setRealtimeThrows(true);
	await createEditorExportService(renderer.runtime).handleExportAction('export');
	assert.equal(renderer.calls.includes('sink-abort'), true);
	assert.match((renderer.errors[0] as Error).message, /realtime failed/u);
});

test('offline renderer failures fall back to the realtime export path', async () => {
	const fixture = createFixture();
	fixture.renderOptions.renderSnapshot = async () => { throw new Error('offline failed'); };
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.equal(result.mimeType, 'audio/wav');
	assert.equal(fixture.statuses.some(([message]) => message === 'Realtime fallback'), true);
});

test('renderSnapshot supports both injected and owned render engines', async () => {
	const fixture = createFixture();
	const service = createEditorExportService(fixture.runtime);
	assert.equal(await service.renderSnapshot(defaultProject(), { startFrame: 0, endFrame: 1 }), await fixture.renderOptions.renderSnapshot?.());
	fixture.renderOptions.renderSnapshot = undefined;
	const rendered = await service.renderSnapshot(defaultProject(), { startFrame: 0, endFrame: 1 });
	assert.equal(rendered.sampleRate, 48_000);
	assert.equal(fixture.calls.includes('prepare-caches'), true);
	assert.equal(fixture.calls.includes('load-project'), true);
	assert.equal(fixture.calls.includes('dispose-renderer'), true);
});

test('video export loads media, mixes audio, sanitizes names, and publishes output', async () => {
	const fixture = createFixture();
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export', {
		format: 'video-mp4', range: 'project', canvas: { width: 1_920 },
	});
	assert.equal(result.fileName, 'Cafe-Film.mp4');
	assert.equal(result.mimeType, 'video/mp4');
	assert.equal(fixture.calls.includes('video-audio:true'), true);
	assert.equal(fixture.downloads.at(-1)?.purpose, 'video');
});

test('video export supports silent cancellation and reports missing media', async () => {
	const silent = createFixture();
	silent.setProject({
		...defaultProject(),
		title: '---',
		clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source' }],
	});
	silent.setPublishCancelled(true);
	const cancelled = await createEditorExportService(silent.runtime).exportVideo({ format: 'video-webm' });
	assert.equal(cancelled.cancelled, true);
	assert.equal(silent.calls.includes('video-audio:false'), true);
	assert.equal(silent.downloads.at(-1)?.suggestedName, 'video-project.webm');

	const missingMedia = createFixture();
	missingMedia.setMediaAvailable(false);
	assert.equal(await createEditorExportService(missingMedia.runtime).exportVideo(), null);
	assert.match((missingMedia.errors[0] as Error).message, /Local sources missing/iu);

	const preflight = createFixture();
	preflight.setPreflightFails(true);
	assert.equal(await createEditorExportService(preflight.runtime).exportVideo(), null);
	assert.match((preflight.errors[0] as Error).message, /preflight failed/u);
});

test('video export validates the timeline and cleans late publications', async () => {
	const absent = createFixture();
	absent.setProject({ ...defaultProject(), tracks: [{ id: 'audio', type: 'audio', clipIds: [] }] });
	await assert.rejects(
		() => createEditorExportService(absent.runtime).exportVideo(),
		/Add visible picture content/iu,
	);

	const hidden = createFixture();
	hidden.setProject({ ...defaultProject(), tracks: [{ id: 'video', type: 'video', hidden: true, clipIds: ['video-clip'] }] });
	await assert.rejects(
		() => createEditorExportService(hidden.runtime).exportVideo(),
		/Add visible picture content/iu,
	);

	const missing = createFixture();
	missing.setMissingSources(true);
	await assert.rejects(
		() => createEditorExportService(missing.runtime).exportVideo(),
		/Local sources missing/iu,
	);

	const late = createFixture();
	late.setDisposeDuringPublish(true);
	assert.equal(await createEditorExportService(late.runtime).exportVideo(), null);
	assert.equal(late.calls.includes('download-cleanup'), true);
	assert.equal(late.errors.length, 0);
});

test('every export emits a delivery report derived from the plan it executes', async () => {
	const fixture = createFixture();
	const service = createEditorExportService(fixture.runtime);
	await service.handleExportAction('export', {});

	const report = fixture.state.deliveryReport as {
		format: string;
		subject: { format: string; sampleRate: number; lossless: boolean | null };
		items: Array<{ code: string; disposition: string }>;
	};
	assert.ok(report, 'a delivery records its report on session state');
	assert.equal(report.format, 'delivery');
	assert.equal(report.subject.format, 'wav');
	assert.equal(report.subject.sampleRate, 48_000);
	assert.equal(report.subject.lossless, true);

	const codes = report.items.map(({ code }) => code);
	assert.ok(
		codes.includes('delivery.quantize'),
		'writing int24 from a float render is a conversion the real path must report',
	);
	assert.ok(codes.includes('delivery.lossless-encode'));
	assert.equal(
		countUnreportedDeliveryConversions(
			fixture.runtime.createExportPlan(),
			{ sampleRate: 48_000 },
			report,
		),
		0,
		'the report the export path emits leaves no conversion unreported',
	);
});

test('a resampling export reports the rate change on the real path', async () => {
	const fixture = createFixture();
	const converted = defaultPlan();
	converted.sampleRate = 44_100;
	fixture.setPlan(converted);
	const service = createEditorExportService(fixture.runtime);
	await service.handleExportAction('export', {});

	const recorded = fixture.state.deliveryReport as {
		items: Array<{ code: string; data: Record<string, unknown> }>;
	};
	const resample = recorded?.items.find(({ code }) => code === 'delivery.resample');
	assert.ok(resample, 'a 48k project delivered at 44.1k reports the conversion');
	assert.deepEqual(resample.data, { fromSampleRate: 48_000, toSampleRate: 44_100 });
});

test('a normalized delivery rebuilds its report once the render has been measured', async () => {
	// The plan cannot describe normalization on its own: the gain is not known
	// until the render exists. This is the wiring that puts the decision into the
	// report the operator reads, rather than leaving it on the encoder's result.
	const fixture = createFixture();
	const normalized = defaultPlan();
	normalized.loudnessNormalization = { integratedLufs: -23, truePeakCeilingDb: -1 };
	fixture.setPlan(normalized);
	await createEditorExportService(fixture.runtime).handleExportAction('export');

	const report = fixture.state.deliveryReport as {
		items: Array<{ code: string; data: Record<string, unknown>; severity: string; disposition: string }>;
		counts: Record<string, number>;
	};
	const loudness = report.items.find(({ code }) => code.startsWith('delivery.loudness'));
	assert.ok(loudness, 'the delivery report states what normalization did');
	assert.equal(loudness.data.targetLufs, -23);
	assert.equal(loudness.data.ceilingDb, -1);
	// The fixture renders a handful of frames, so the meter never gates a block.
	// Refusing to invent a gain is the correct outcome and must be said out loud.
	assert.equal(loudness.code, 'delivery.loudness-unmeasurable');
	assert.equal(loudness.data.gainDb, 0);
	assert.equal(loudness.severity, 'warning');
	// The rebuilt report is a whole report, not the old one with an item bolted on.
	for (const disposition of ['preserved', 'converted', 'missing', 'omitted']) {
		assert.equal(
			report.counts[disposition],
			report.items.filter((item) => item.disposition === disposition).length,
			`${disposition} count must still agree with its items after the rebuild`,
		);
	}
	assert.ok(report.items.some(({ code }) => code === 'delivery.quantize'), 'and it still holds the plan conversions');
});

test('a delivery with no target leaves the plan-derived report exactly as it was', async () => {
	const fixture = createFixture();
	await createEditorExportService(fixture.runtime).handleExportAction('export');
	const report = fixture.state.deliveryReport as { items: Array<{ code: string }> };
	assert.equal(report.items.some(({ code }) => code.startsWith('delivery.loudness')), false);
});

test('a request naming a delivery target is routed to the video path, not the audio one', async () => {
	// The router decides audio versus video from the request's format alone. A
	// delivery target used to overwrite that format with its bare plan spelling,
	// so every targeted delivery fell through to the audio branch and came back
	// as a WAV — the format the audio normalizer falls back to for anything it
	// does not recognize. Reaching the video action at all is the assertion; the
	// audio-only fixture then refuses for its own reason.
	const request = createExportDialogRequest({
		mode: 'mix', range: 'project', format: 'video-mp4',
		canvasWidth: '', canvasHeight: '', canvasFit: 'contain',
		canvasFrameRate: '', canvasBackgroundColor: '', videoQuality: 'balanced',
		deliveryTarget: 'web-vp9-1080p',
	}, { metadata: {} });
	const fixture = createFixture();
	const output = await createEditorExportService(fixture.runtime).handleExportAction('export', request);
	assert.match(output.fileName, /\.webm$/u, `a WebM target must deliver WebM, not ${output.fileName}`);
});

test('a video delivery stating mono stages the mix as one channel', async () => {
	// The plan carrying `channelLayout` and the mapping downmixing when it is
	// handed one were each tested; the line that joins them was not, so replacing
	// it with the literal 'preserve' left 1343 tests green while every delivery
	// staged the full-width mix and both the plan and the report kept claiming
	// mono. This drives the export action and reads what reached the WAV encoder.
	const fixture = createFixture();
	const request = createExportDialogRequest({
		mode: 'mix', range: 'project', format: 'video-mp4',
		canvasWidth: '', canvasHeight: '', canvasFit: 'contain',
		canvasFrameRate: '', canvasBackgroundColor: '', videoQuality: 'balanced',
		videoAudioLayout: 'mono', deliveryTarget: '',
	}, { metadata: {} });
	assert.equal(request.audioLayout, 'mono');

	await createEditorExportService(fixture.runtime).handleExportAction('export', request);
	assert.deepEqual(fixture.encodedChannelCounts, [1]);

	const preserved = createFixture();
	await createEditorExportService(preserved.runtime).handleExportAction('export', {
		...request, audioLayout: undefined,
	});
	assert.deepEqual(preserved.encodedChannelCounts, [2], 'an unstated layout still delivers the project channels');
});
