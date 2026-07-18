import test from 'node:test';
import assert from 'node:assert/strict';

import {
	MEDIA_EXPORT_FORMATS,
	MediaExportUnavailableError,
	applyMediaChannelMapping,
	assertMediaExportAvailable,
	buildMediaFfmpegDecoderArgs,
	buildMediaFfmpegEncoderArgs,
	createAiffStreamEncoder,
	createAudioEditorProjectV2,
	createExportPlan,
	createMediaExportCapabilities,
	encodeAiff,
	encodeWav,
	listMediaExportFormats,
	mediaChannelMappingToFfmpegFilter,
	normalizeMediaChannelMapping,
	normalizeMediaDecodeSampleRate,
	normalizeMediaExportSettings,
} from '../src/lib/tools/audio-editor/index.js';

test('media export registry classifies native and pinned FFmpeg formats', () => {
	assert.deepEqual(Object.keys(MEDIA_EXPORT_FORMATS), [
		'wav', 'aiff', 'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a', 'custom-ffmpeg',
	]);
	const bundled = createMediaExportCapabilities();
	assert.equal(bundled.profileId, '@ffmpeg/core@0.12.10');
	assert.equal(Object.values(bundled.formats).every((entry) => entry.available), true);
	assert.equal(listMediaExportFormats(bundled).find((entry) => entry.id === 'aiff').backend, 'native-aiff');
	assert.equal(listMediaExportFormats(bundled).find((entry) => entry.id === 'ogg-vorbis').codec, 'libvorbis');

	const constrained = createMediaExportCapabilities({
		profile: { id: 'fixture', encoders: [], muxers: [] },
		encoders: ['flac'],
		muxers: ['flac'],
	});
	assert.equal(constrained.formats.wav.available, true);
	assert.equal(constrained.formats.flac.available, true);
	assert.deepEqual(constrained.formats.mp3.missingEncoders, ['libmp3lame']);
	assert.throws(
		() => assertMediaExportAvailable('mp3', constrained),
		(error) => error instanceof MediaExportUnavailableError
			&& error.code === 'MEDIA_EXPORT_UNAVAILABLE'
			&& /libmp3lame/.test(error.message),
	);
	const noCore = createMediaExportCapabilities({ ffmpegAvailable: false });
	assert.equal(noCore.formats.aiff.available, true);
	assert.match(noCore.formats.opus.reason, /could not be loaded/);
});

test('media export settings normalize aliases, arbitrary rates, sample formats, metadata, and dither', () => {
	const aiff = normalizeMediaExportSettings('aif', {
		sampleRate: 96_000,
		inputChannelCount: 6,
		channelCount: 2,
		sampleFormat: 'int32',
		dither: 'triangular-highpass',
		metadata: { title: 'Six channel mix', artist: 'kw.media' },
	});
	assert.equal(aiff.format, 'aiff');
	assert.equal(aiff.sampleRate, 96_000);
	assert.equal(aiff.sampleFormat, 'int32');
	assert.equal(aiff.channelMapping.mode, 'stereo');
	assert.equal(aiff.dither, 'triangular-highpass');
	assert.deepEqual(aiff.metadata, { title: 'Six channel mix', artist: 'kw.media' });

	const vorbis = normalizeMediaExportSettings('ogg', { quality: 7.5, inputChannelCount: 2 });
	assert.equal(vorbis.format, 'ogg-vorbis');
	assert.equal(vorbis.quality, 7.5);
	assert.equal(vorbis.dither, 'none');
	assert.throws(() => normalizeMediaExportSettings('flac', { sampleFormat: 'float32' }), /does not support/);
	assert.throws(() => normalizeMediaExportSettings('mp2', { inputChannelCount: 6 }), /at most 2/);
	assert.throws(() => normalizeMediaExportSettings('wav', { metadata: { 'bad key': 'value' } }), /field name/);
});

test('channel mapping uses an explicit matrix for native PCM and FFmpeg pan filters', () => {
	const mapping = normalizeMediaChannelMapping(2, {
		channels: [
			{ inputs: [{ channel: 0, gain: 0.75 }, { channel: 1, gain: 0.25 }] },
			[0.25, -0.5],
		],
	});
	assert.equal(mediaChannelMappingToFfmpegFilter(mapping), 'pan=2c|c0=0.75*c0+0.25*c1|c1=0.25*c0+-0.5*c1');
	const output = applyMediaChannelMapping([
		Float32Array.of(1, 0, -1),
		Float32Array.of(0, 1, 0.5),
	], mapping);
	assert.deepEqual([...output[0]], [0.75, 0.25, -0.625]);
	assert.deepEqual([...output[1]], [0.25, -0.5, -0.5]);
	assert.deepEqual(
		normalizeMediaChannelMapping(1, 'stereo').channels.map((channel) => channel.inputs[0].channel),
		[0, 0],
	);
	assert.throws(() => normalizeMediaChannelMapping(2, [[1]]), /one finite gain per input/);
});

test('pure FFmpeg command builder covers all pinned codec paths and rejects unsafe custom arguments', () => {
	const cases = [
		['flac', { bitDepth: 24 }, 'flac'],
		['mp3', { bitRate: 256 }, 'libmp3lame'],
		['ogg-vorbis', { quality: 6 }, 'libvorbis'],
		['opus', { bitRate: 160 }, 'libopus'],
		['wavpack', { sampleFormat: 'float32' }, 'wavpack'],
		['mp2', { bitRate: 256 }, 'mp2'],
		['aac-m4a', { bitRate: 192 }, 'aac'],
	];
	for (const [format, settings, codec] of cases) {
		const args = buildMediaFfmpegEncoderArgs('stage.wav', `output.${MEDIA_EXPORT_FORMATS[format].extension}`, format, {
			...settings,
			sampleRate: 44_100,
			channelCount: 1,
			metadata: { title: 'Export title' },
		});
		assert.deepEqual(args.slice(0, 4), ['-i', 'stage.wav', '-vn', '-map_metadata']);
		assert.equal(args.includes(codec), true, `${format} codec missing`);
		assert.equal(args.includes('title=Export title'), true);
		assert.deepEqual(args.slice(-2), ['-y', `output.${MEDIA_EXPORT_FORMATS[format].extension}`]);
		assert.doesNotMatch(args.join(' '), /SBSMS|SoundTouch|\bSoX\b/i);
	}

	const custom = buildMediaFfmpegEncoderArgs('stage.wav', 'output.caf', 'custom', {
		extension: 'caf',
		mimeType: 'audio/x-caf',
		customArguments: ['-c:a', 'pcm_s24be', '-f', 'caf'],
		sampleRate: 192_000,
	});
	assert.equal(custom.includes('pcm_s24be'), true);
	assert.equal(custom.includes('192000'), true);
	const ditheredWavPack = buildMediaFfmpegEncoderArgs('stage.wav', 'output.wv', 'wavpack', {
		sampleFormat: 'int24',
		dither: 'triangular-highpass',
		applyDither: true,
	});
	assert.equal(ditheredWavPack.includes('aresample=dither_method=triangular_hp'), true);
	assert.throws(() => normalizeMediaExportSettings('custom', {
		extension: 'mka', mimeType: 'audio/x-matroska', customArguments: ['-i', 'other.wav'],
	}), /not allowed/);
	assert.throws(() => normalizeMediaExportSettings('custom', {
		extension: 'mka', mimeType: 'audio/x-matroska', customArguments: ['https://example.invalid/input'],
	}), /not allowed/);
});

test('FFmpeg import targets the requested project sample rate instead of a fixed 48 kHz', () => {
	assert.deepEqual(
		buildMediaFfmpegDecoderArgs('input.m4a', 'decoded.f32', { sampleRate: 96_000, channelCount: 2 }),
		[
			'-i', 'input.m4a', '-vn', '-map', '0:a:0',
			'-ac', '2', '-ar', '96000',
			'-c:a', 'pcm_f32le', '-f', 'f32le', '-y', 'decoded.f32',
		],
	);
	assert.equal(normalizeMediaDecodeSampleRate(), 48_000);
	assert.throws(() => normalizeMediaDecodeSampleRate(7_999), /8000 to 384000/);
	assert.throws(() => buildMediaFfmpegDecoderArgs('input', 'output', { sampleRate: 44_100.5 }), /integer/);
	assert.deepEqual(
		buildMediaFfmpegDecoderArgs('input.wv', 'decoded.wav', {
			sampleRate: null,
			channelCount: null,
			outputFormat: 'wav',
		}),
		[
			'-i', 'input.wv', '-vn', '-map', '0:a:0',
			'-c:a', 'pcm_f32le', '-f', 'wav', '-y', 'decoded.wav',
		],
	);
	assert.throws(
		() => buildMediaFfmpegDecoderArgs('input', 'output', { outputFormat: 'mp3' }),
		/f32le or wav/,
	);
});

test('AIFF encoder writes big-endian integer PCM, extended sample rate, and even chunk padding', () => {
	const encoded = encodeAiff([
		Float32Array.of(-1, 1),
		Float32Array.of(0.5, -0.5),
	], { sampleRate: 44_100, bitDepth: 16, dither: false });
	const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
	assert.equal(ascii(encoded, 0, 4), 'FORM');
	assert.equal(ascii(encoded, 8, 4), 'AIFF');
	assert.equal(ascii(encoded, 12, 4), 'COMM');
	assert.equal(view.getUint32(4, false), encoded.byteLength - 8);
	assert.equal(view.getUint16(20, false), 2);
	assert.equal(view.getUint32(22, false), 2);
	assert.equal(view.getUint16(26, false), 16);
	assert.equal(hex(encoded.subarray(28, 38)), '400eac44000000000000');
	assert.equal(ascii(encoded, 38, 4), 'SSND');
	assert.equal(view.getInt16(54, false), -32_768);
	assert.equal(view.getInt16(56, false), 16_384);
	assert.equal(view.getInt16(58, false), 32_767);
	assert.equal(view.getInt16(60, false), -16_384);

	const padded = encodeAiff([Float32Array.of(0.25)], { bitDepth: 24, dither: false });
	assert.equal(padded.byteLength, 58);
	assert.equal(new DataView(padded.buffer).getUint32(42, false), 11);
	assert.equal(padded.at(-1), 0);
});

test('AIFF-C float and streaming encoders preserve float headroom without retaining PCM chunks', async () => {
	const floating = encodeAiff([Float32Array.of(0.25, 1.25)], { sampleFormat: 'float32', dither: false });
	const ssnd = findAscii(floating, 'SSND');
	assert.equal(ascii(floating, 8, 4), 'AIFC');
	assert.equal(ascii(floating, 12, 4), 'FVER');
	assert.equal(ascii(floating, findAscii(floating, 'COMM') + 26, 4), 'fl32');
	assert.equal(new DataView(floating.buffer).getFloat32(ssnd + 16, false), 0.25);
	assert.equal(new DataView(floating.buffer).getFloat32(ssnd + 20, false), 1.25);

	const emitted = [];
	const encoder = createAiffStreamEncoder({
		totalFrames: 1,
		channelCount: 1,
		bitDepth: 24,
		dither: false,
		collect: false,
		onChunk: async (chunk, info) => emitted.push({ bytes: chunk.byteLength, ...info }),
	});
	encoder.write([Float32Array.of(0.5)]);
	const result = encoder.finalize();
	await encoder.settled();
	assert.deepEqual(emitted.map((entry) => entry.bytes), [54, 3, 1]);
	assert.deepEqual(emitted.map((entry) => entry.frameOffset), [0, 0, 1]);
	assert.deepEqual(result, { header: result.header, byteLength: 58, frames: 1, padBytes: 1 });
	assert.throws(() => encoder.write([Float32Array.of(0)]), /finalized/);
});

test('native WAV and AIFF embed normalized UTF-8 metadata in bounded ID3 chunks', () => {
	const metadata = {
		title: 'Äther',
		artist: 'kw.media',
		album: 'Browser exports',
		trackNumber: '3',
		year: '2026',
		comments: 'Offline only',
		customField: 'opaque value',
	};
	const wav = encodeWav([Float32Array.of(0)], { bitDepth: 16, dither: 'none', metadata });
	const wavId3 = findAscii(wav, 'id3 ');
	assert.ok(wavId3 > 44);
	assert.equal(ascii(wav, wavId3 + 8, 3), 'ID3');
	assert.equal(new DataView(wav.buffer).getUint32(4, true), wav.byteLength - 8);
	assert.equal(new DataView(wav.buffer).getUint32(40, true), 2);
	assert.ok(findAscii(wav, 'TIT2') > wavId3);
	assert.ok(findAscii(wav, 'TXXX') > wavId3);
	assert.ok(findAscii(wav, 'Äther') > wavId3);

	const aiff = encodeAiff([Float32Array.of(0)], { bitDepth: 16, dither: 'none', metadata });
	const aiffId3 = findAscii(aiff, 'ID3 ');
	assert.ok(aiffId3 > 54);
	assert.equal(ascii(aiff, aiffId3 + 8, 3), 'ID3');
	assert.equal(new DataView(aiff.buffer).getUint32(4, false), aiff.byteLength - 8);
	assert.ok(findAscii(aiff.subarray(aiffId3), 'COMM') > 0);
});

test('native dither modes honor none and keep high-pass state per channel', () => {
	let noneCalls = 0;
	encodeWav([Float32Array.of(0, 0)], { bitDepth: 16, dither: 'none', random: () => { noneCalls += 1; return 1; } });
	assert.equal(noneCalls, 0);
	const values = [1, 0, 0, 1, 1, 0, 0, 1];
	let index = 0;
	const highpass = encodeWav([Float32Array.of(0, 0, 0, 0)], {
		bitDepth: 16,
		dither: 'triangular-highpass',
		random: () => values[index++],
	});
	assert.equal(index, 8);
	assert.notDeepEqual([...highpass.subarray(44)], [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('export plans cover loop range, custom channel mapping, AIFF, and FFmpeg extensions', () => {
	const project = createAudioEditorProjectV2({
		id: 'media-export-project',
		title: 'Media export',
		now: '2026-07-13T00:00:00.000Z',
		sampleRate: 96_000,
		loop: { enabled: true, startFrame: 96_000, endFrame: 192_000 },
	});
	const aiff = createExportPlan(project, {
		format: 'aiff',
		range: 'loop',
		sampleRate: 88_200,
		channelCount: 1,
		date: '2026-07-13',
	});
	assert.equal(aiff.outputs[0].fileName, 'Media-export-mix-2026-07-13.aiff');
	assert.equal(aiff.range.durationFrames, 96_000);
	assert.equal(aiff.outputFrames, 88_200);
	assert.equal(aiff.channelCount, 1);
	assert.equal(aiff.outputBytesPerRender, 88_200 * 4);

	const m4a = createExportPlan(project, { format: 'm4a', range: 'loop', bitRate: 256, date: '2026-07-13' });
	assert.equal(m4a.format, 'aac-m4a');
	assert.equal(m4a.outputs[0].fileName.endsWith('.m4a'), true);
	assert.equal(m4a.mimeType, 'audio/mp4');
});

function ascii(bytes, offset, length) {
	return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}

function hex(bytes) {
	return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function findAscii(bytes, value) {
	const pattern = new TextEncoder().encode(value);
	for (let offset = 0; offset <= bytes.length - pattern.length; offset += 1) {
		if (pattern.every((byte, index) => bytes[offset + index] === byte)) return offset;
	}
	return -1;
}
