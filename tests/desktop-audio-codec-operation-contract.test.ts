/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES,
	DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES,
	assertDesktopAudioCodecRequest,
	assertDesktopAudioCodecResult,
	desktopAudioMp3ConstantBitrateKbps,
	createDesktopAudioCodecResult,
	normalizeDesktopAudioCodecRequest,
	normalizeDesktopAudioCodecResult,
	type DesktopAudioCodecFormat,
	type DesktopAudioCodecRequest,
} from '../desktop/desktop-audio-codec-operation-contract.ts';
import {
	DESKTOP_AUDIO_FFMPEG_INPUT_NAME,
	buildDesktopAudioFfmpegPlan,
	deriveDesktopAudioFfmpegCapabilityTuple,
	isDesktopAudioFfmpegCapabilityTupleSatisfied,
} from '../desktop/desktop-audio-ffmpeg-plan.ts';

const ENCODE_FIXTURES = Object.freeze([
	Object.freeze({ format: 'flac', settings: Object.freeze({ compressionLevel: 5, bitDepth: 24 }) }),
	Object.freeze({ format: 'mp3', settings: Object.freeze({ bitrateKbps: 192 }) }),
	Object.freeze({ format: 'ogg-vorbis', settings: Object.freeze({ quality: 6 }) }),
	Object.freeze({ format: 'opus', settings: Object.freeze({ bitrateKbps: 128, vbrMode: 1 }) }),
	Object.freeze({ format: 'wavpack', settings: Object.freeze({ compressionLevel: 2 }) }),
	Object.freeze({ format: 'mp2', settings: Object.freeze({ bitrateKbps: 192 }) }),
	Object.freeze({ format: 'aac-m4a', settings: Object.freeze({ bitrateKbps: 192 }) }),
] as const);

test('all seven canonical encode formats normalize to owned bounded requests', () => {
	for (const fixture of ENCODE_FIXTURES) {
		const source = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
		const request = normalizeDesktopAudioCodecRequest({
			operation: 'audio-encode',
			format: fixture.format,
			input: source,
			sampleRate: fixture.format === 'opus' ? 48_000 : 44_100,
			channelCount: 2,
			settings: fixture.settings,
			maximumOutputBytes: 4_096,
			requestId: `encode-${fixture.format}`,
		});
		assert.equal(request.format, fixture.format);
		assert.equal(Object.isFrozen(request), true);
		assert.equal(Object.isFrozen(request.settings), true);
		assert.notEqual(request.input, source);
		source[0] = 255;
		assert.equal(request.input[0], 0);
	}
});

test('decode normalization fixes interleaved f32le and leaves source geometry unresolved', () => {
	const request = normalizeDesktopAudioCodecRequest({
		operation: 'audio-decode', format: 'aac-m4a', input: new Uint8Array([1, 2, 3]),
		sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' },
		maximumOutputBytes: 8_192,
	});
	assert.deepEqual(request.settings, { sampleFormat: 'f32le' });
	assert.equal(request.sampleRate, null);
	assert.equal(request.channelCount, null);
	assert.equal(Object.hasOwn(request, 'requestId'), false);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...request, sampleRate: 48_000, channelCount: 2,
	}), /source-authoritative/iu);
});

test('the request boundary rejects paths, URLs, argv, custom FFmpeg and unknown fields', () => {
	const base = decodeRequest();
	for (const field of ['path', 'url', 'argv', 'ffmpegPath', 'customFfmpeg'] as const) {
		assert.throws(
			() => assertDesktopAudioCodecRequest({ ...base, [field]: '/tmp/untrusted' }),
			/inexact shape/u,
		);
	}
	assert.throws(() => assertDesktopAudioCodecRequest({
		...base, requestId: 'https://attacker.invalid/audio',
	}), /request ID/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...base, settings: { sampleFormat: 'f32le', arguments: ['-filter_script', '/tmp/a'] },
	}), /settings.*inexact/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...base, format: 'custom-ffmpeg',
	}), /format/u);
});

test('the request boundary enforces byte, output, rate, channel and PCM-frame bounds', () => {
	assert.throws(() => assertDesktopAudioCodecRequest({ ...decodeRequest(), input: new Uint8Array() }), /input/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...decodeRequest(), input: { byteLength: 4 },
	}), /Uint8Array/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...decodeRequest(), input: new Uint8Array(DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES + 1),
	}), /input/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...decodeRequest(), maximumOutputBytes: DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES + 1,
	}), /maximum output/u);
	assert.throws(() => assertDesktopAudioCodecRequest({ ...encodeRequest('flac'), sampleRate: 7_999 }), /sample rate/u);
	assert.doesNotThrow(() => assertDesktopAudioCodecRequest({
		...encodeRequest('opus'), channelCount: 8, input: new Uint8Array(32), sampleRate: 48_000,
	}));
	assert.throws(() => assertDesktopAudioCodecRequest({ ...decodeRequest(), channelCount: 9 }), /source-authoritative/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('mp3'), channelCount: 3, input: new Uint8Array(12),
	}), /channel count/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('flac'), input: new Uint8Array(7),
	}), /complete PCM frames/u);
});

test('format-specific settings and encode constraints are exact', () => {
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('mp3'), settings: { bitrateKbps: 191 },
	}), /bitrate/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('ogg-vorbis'), settings: { quality: 11 },
	}), /quality/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('flac'), settings: { compressionLevel: 13, bitDepth: 24 },
	}), /compression/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('flac'), settings: { compressionLevel: 5, bitDepth: 20 },
	}), /bit depth/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('opus'), sampleRate: 44_100,
	}), /sample rate/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('mp2'), sampleRate: 96_000,
	}), /sample rate/u);
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('aac-m4a'), sampleRate: 192_000,
	}), /sample rate/u);
	assert.doesNotThrow(() => assertDesktopAudioCodecRequest({
		...encodeRequest('aac-m4a'), sampleRate: 64_000,
	}));
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('aac-m4a'), sampleRate: 8_000, channelCount: 1,
		input: new Uint8Array(4), settings: { bitrateKbps: 64 },
	}), /bitrate.*sample rate.*channel/u);
	assert.doesNotThrow(() => assertDesktopAudioCodecRequest({
		...encodeRequest('aac-m4a'), sampleRate: 8_000, channelCount: 1,
		input: new Uint8Array(4), settings: { bitrateKbps: 48 },
	}));
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('aac-m4a'), sampleRate: 48_000, channelCount: 1,
		input: new Uint8Array(4), settings: { bitrateKbps: 320 },
	}), /bitrate.*sample rate.*channel/u);
	assert.doesNotThrow(() => assertDesktopAudioCodecRequest({
		...encodeRequest('aac-m4a'), sampleRate: 48_000, channelCount: 2,
		settings: { bitrateKbps: 320 },
	}));
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('mp3'), sampleRate: 8_000, settings: { bitrateKbps: 80 },
	}), /bitrate.*sample rate/u);
	assert.doesNotThrow(() => assertDesktopAudioCodecRequest({
		...encodeRequest('mp3'), sampleRate: 8_000, settings: { bitrateKbps: 64 },
	}));
	assert.throws(() => assertDesktopAudioCodecRequest({
		...encodeRequest('mp3'), sampleRate: 24_000, settings: { bitrateKbps: 192 },
	}), /bitrate.*sample rate/u);
	assert.doesNotThrow(() => assertDesktopAudioCodecRequest({
		...encodeRequest('mp3'), sampleRate: 24_000, settings: { bitrateKbps: 160 },
	}));
	assert.doesNotThrow(() => assertDesktopAudioCodecRequest({
		...encodeRequest('mp3'), sampleRate: 48_000, settings: { bitrateKbps: 320 },
	}));
});

test('result builders return owned closed bytes and renderer metadata', () => {
	const decode = normalizeDesktopAudioCodecRequest(decodeRequest());
	const decodedSource = new Uint8Array(32);
	const decoded = createDesktopAudioCodecResult(decode, decodedSource, {
		sampleRate: 44_100, channelCount: 1, frameCount: 8,
	});
	assert.deepEqual(decoded.metadata, {
		kind: 'decoded-audio', sourceFormat: 'flac', sampleFormat: 'f32le',
		interleaving: 'interleaved', sampleRate: 44_100, channelCount: 1, frameCount: 8,
	});
	assert.notEqual(decoded.bytes, decodedSource);
	decodedSource[0] = 255;
	assert.equal(decoded.bytes[0], 0);
	assertDesktopAudioCodecResult(decoded);

	const encode = normalizeDesktopAudioCodecRequest(encodeRequest('mp3'));
	const encoded = createDesktopAudioCodecResult(encode, new Uint8Array([1, 2, 3]));
	assert.deepEqual(encoded.metadata, {
		kind: 'encoded-audio', format: 'mp3', mimeType: 'audio/mpeg', fileExtension: '.mp3',
		sampleRate: 44_100, channelCount: 2, frameCount: 1,
	});
	assertDesktopAudioCodecResult(encoded);

	const flac = createDesktopAudioCodecResult(
		normalizeDesktopAudioCodecRequest(encodeRequest('flac')), new Uint8Array([1, 2, 3]),
	);
	assert.deepEqual(flac.metadata, {
		kind: 'encoded-audio', format: 'flac', mimeType: 'audio/flac', fileExtension: '.flac',
		sampleRate: 44_100, channelCount: 2, frameCount: 1,
		sourceSampleFormat: 'f32le', encodedSampleFormat: 's24',
		pcmConversion: 'clamp-unit-range-to-signed-24',
	});
	assertDesktopAudioCodecResult(flac);
});

test('results reject unknown metadata, forged PCM geometry and oversized bytes', () => {
	const result = createDesktopAudioCodecResult(
		normalizeDesktopAudioCodecRequest(decodeRequest()), new Uint8Array(8),
		{ sampleRate: 48_000, channelCount: 2, frameCount: 1 },
	);
	assert.throws(() => assertDesktopAudioCodecResult({ ...result, path: '/tmp/result' }), /inexact shape/u);
	assert.throws(() => assertDesktopAudioCodecResult({
		...result, metadata: { ...result.metadata, frameCount: 9 },
	}), /frame count/u);
	assert.throws(() => assertDesktopAudioCodecResult({
		...result, bytes: new Uint8Array(DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES + 1),
	}), /bytes/u);
	const normalized = normalizeDesktopAudioCodecResult(result, 8);
	assert.notEqual(normalized.bytes, result.bytes);
	assert.throws(() => normalizeDesktopAudioCodecResult(result, 7), /bytes/u);
	assert.throws(() => createDesktopAudioCodecResult(
		normalizeDesktopAudioCodecRequest(decodeRequest()), new Uint8Array(8),
	), /decoded geometry/u);
	assert.throws(() => createDesktopAudioCodecResult(
		normalizeDesktopAudioCodecRequest(decodeRequest()), new Uint8Array(8),
		{ sampleRate: 44_100, channelCount: 1, frameCount: 1 },
	), /frame count/u);
});

test('capability tuples cover the exact demux, decode, encode, mux and conversion chain', () => {
	assert.deepEqual(deriveDesktopAudioFfmpegCapabilityTuple(decodeRequest()), {
		direction: 'decode', demuxerAnyOf: ['flac'], decoderAnyOf: ['flac'],
		encoderAnyOf: ['pcm_f32le'], muxerAnyOf: ['wav'], filterAllOf: [],
	});
	assert.deepEqual(deriveDesktopAudioFfmpegCapabilityTuple(encodeRequest('mp3')), {
		direction: 'encode', demuxerAnyOf: ['f32le'], decoderAnyOf: ['pcm_f32le'],
		encoderAnyOf: ['libmp3lame'], muxerAnyOf: ['mp3'], filterAllOf: ['aresample'],
	});
	assert.deepEqual(deriveDesktopAudioFfmpegCapabilityTuple(encodeRequest('aac-m4a')), {
		direction: 'encode', demuxerAnyOf: ['f32le'], decoderAnyOf: ['pcm_f32le'],
		encoderAnyOf: ['aac'], muxerAnyOf: ['ipod'], filterAllOf: ['aresample'],
	});
});

test('capability evaluation uses any-of alternatives and requires every chain category', () => {
	const tuple = deriveDesktopAudioFfmpegCapabilityTuple({ ...decodeRequest(), format: 'mp3' });
	const capabilities = {
		demuxers: ['mp3'], decoders: ['mp3float'], encoders: ['pcm_f32le'],
		muxers: ['wav'], filters: [],
	};
	assert.equal(isDesktopAudioFfmpegCapabilityTupleSatisfied(tuple, capabilities), true);
	assert.equal(isDesktopAudioFfmpegCapabilityTupleSatisfied(tuple, {
		...capabilities, muxers: [],
	}), false);
	assert.equal(isDesktopAudioFfmpegCapabilityTupleSatisfied(tuple, {
		...capabilities, decoders: ['mp3'],
	}), false, 'a noncanonical decoder must not satisfy the exact decode tuple');
});

test('decode plans use only fixed relative names and closed FFmpeg 4.4-9 arguments', () => {
	const plan = buildDesktopAudioFfmpegPlan(decodeRequest());
	assert.equal(plan.inputName, DESKTOP_AUDIO_FFMPEG_INPUT_NAME);
	assert.equal(plan.outputName, 'soundscaper-codec-output.wav');
	assert.equal(plan.arguments.at(-1), plan.outputName);
	assert.deepEqual(plan.arguments.slice(0, 7), [
		'-nostdin', '-hide_banner', '-loglevel', 'error', '-nostats', '-xerror', '-y',
	]);
	assert.deepEqual(argumentValue(plan.arguments, '-protocol_whitelist'), 'file');
	assert.deepEqual(argumentValue(plan.arguments, '-f'), 'flac');
	const inputIndex = plan.arguments.indexOf('-i');
	assert.deepEqual(plan.arguments.slice(inputIndex - 2, inputIndex), ['-c:a', 'flac']);
	assert.equal(plan.arguments.lastIndexOf('-c:a') > inputIndex, true);
	assert.equal(plan.arguments.includes('-af'), false);
	assert.equal(plan.arguments.includes('-ar'), false);
	assert.equal(plan.arguments.includes('-ac'), false);
	assert.equal(plan.arguments.includes('wav'), true);
	assert.equal(plan.arguments.includes('/tmp'), false);
	assert.equal(plan.arguments.some((argument) => argument.includes('://')), false);
	assert.deepEqual(argumentValue(plan.arguments, '-fs'), '8192');
});

test('every decode plan forces its admitted decoder before opening the input', () => {
	const expected = new Map<DesktopAudioCodecFormat, string>([
		['flac', 'flac'], ['mp3', 'mp3float'], ['ogg-vorbis', 'vorbis'], ['opus', 'opus'],
		['wavpack', 'wavpack'], ['mp2', 'mp2float'], ['aac-m4a', 'aac'],
	]);
	for (const [format, decoder] of expected) {
		const plan = buildDesktopAudioFfmpegPlan({ ...decodeRequest(), format });
		const inputIndex = plan.arguments.indexOf('-i');
		assert.deepEqual(plan.arguments.slice(inputIndex - 2, inputIndex), ['-c:a', decoder]);
		assert.deepEqual(plan.arguments.slice(plan.arguments.lastIndexOf('-c:a'), -1).slice(0, 2), [
			'-c:a', 'pcm_f32le',
		]);
	}
});

test('encode plans select only canonical encoders, muxers and settings', () => {
	const expected = new Map<DesktopAudioCodecFormat, readonly [string, string, string]>([
		['flac', ['flac', 'flac', '.flac']], ['mp3', ['libmp3lame', 'mp3', '.mp3']],
		['ogg-vorbis', ['libvorbis', 'ogg', '.ogg']], ['opus', ['libopus', 'opus', '.opus']],
		['wavpack', ['wavpack', 'wv', '.wv']], ['mp2', ['mp2', 'mp2', '.mp2']],
		['aac-m4a', ['aac', 'ipod', '.m4a']],
	]);
	for (const fixture of ENCODE_FIXTURES) {
		const plan = buildDesktopAudioFfmpegPlan(encodeRequest(fixture.format));
		const tuple = expected.get(fixture.format);
		assert.ok(tuple);
		assert.deepEqual(argumentValue(plan.arguments, '-c:a'), tuple[0]);
		assert.equal(plan.arguments.includes(tuple[1]), true);
		assert.equal(plan.outputName.endsWith(tuple[2]), true);
		assert.equal(plan.arguments.at(-1), plan.outputName);
	}
});

test('24-bit FLAC plans declare their raw sample precision explicitly', () => {
	const plan = buildDesktopAudioFfmpegPlan(encodeRequest('flac'));
	assert.equal(argumentValue(plan.arguments, '-sample_fmt'), 's32');
	assert.equal(argumentValue(plan.arguments, '-bits_per_raw_sample'), '24');
});

test('FFmpeg planning revalidates typed-looking objects instead of accepting authority by cast', () => {
	const injected = { ...encodeRequest('mp3'), argv: ['-i', 'https://attacker.invalid/a'] };
	assert.throws(() => buildDesktopAudioFfmpegPlan(injected as unknown as DesktopAudioCodecRequest), /inexact/u);
	assert.throws(
		() => deriveDesktopAudioFfmpegCapabilityTuple(injected as unknown as DesktopAudioCodecRequest),
		/inexact/u,
	);
});

function decodeRequest(): Record<string, unknown> {
	return {
		operation: 'audio-decode', format: 'flac', input: new Uint8Array([1, 2, 3]),
		sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' },
		maximumOutputBytes: 8_192,
	};
}

test("the MP3 contract admits Audacity's four bit-rate strategies, one per request", () => {
	const mp3 = (settings: Readonly<Record<string, number>>) => ({
		...encodeRequest('mp3'), settings,
	});
	const admitted: ReadonlyArray<Readonly<Record<string, number>>> = [
		{ bitrateKbps: 192 }, { averageBitrateKbps: 128 }, { vbrQuality: 0 }, { vbrQuality: 9 },
		{ preset: 0 }, { preset: 3 },
	];
	for (const settings of admitted) {
		assert.doesNotThrow(() => assertDesktopAudioCodecRequest(mp3(settings)), JSON.stringify(settings));
	}

	const refused: ReadonlyArray<Readonly<Record<string, number>>> = [
		{ vbrQuality: 10 }, { preset: 4 }, { averageBitrateKbps: 191 },
		{ bitrateKbps: 192, vbrQuality: 2 }, { preset: 1, bitrateKbps: 192 },
	];
	for (const settings of refused) {
		assert.throws(() => assertDesktopAudioCodecRequest(mp3(settings)), JSON.stringify(settings));
	}

	/* Only a constant strategy pins a rate the operating-system encoders can match. */
	assert.equal(desktopAudioMp3ConstantBitrateKbps({ bitrateKbps: 192 }), 192);
	assert.equal(desktopAudioMp3ConstantBitrateKbps({ preset: 0 }), 320);
	assert.equal(desktopAudioMp3ConstantBitrateKbps({ preset: 2 }), null);
	assert.equal(desktopAudioMp3ConstantBitrateKbps({ vbrQuality: 2 }), null);
	assert.equal(desktopAudioMp3ConstantBitrateKbps({ averageBitrateKbps: 192 }), null);
});

test("the Opus contract carries Audacity's VBR Mode alongside the bitrate", () => {
	const opus = (settings: Readonly<Record<string, number>>) => ({
		...encodeRequest('opus'), sampleRate: 48_000, settings,
	});
	for (const vbrMode of [0, 1, 2]) {
		assert.doesNotThrow(() => assertDesktopAudioCodecRequest(opus({ bitrateKbps: 128, vbrMode })));
	}
	/* The mode is required and bounded, and no other setting is admitted. */
	assert.throws(() => assertDesktopAudioCodecRequest(opus({ bitrateKbps: 128 })), /inexact/u);
	assert.throws(() => assertDesktopAudioCodecRequest(opus({ bitrateKbps: 128, vbrMode: 3 })), /VBR mode/u);
	assert.throws(() => assertDesktopAudioCodecRequest(opus({ bitrateKbps: 129, vbrMode: 1 })), /bitrate/u);

	for (const [vbrMode, spelling] of [[0, 'off'], [1, 'on'], [2, 'constrained']] as const) {
		const plan = buildDesktopAudioFfmpegPlan(opus({ bitrateKbps: 128, vbrMode }));
		assert.equal(argumentValue(plan.arguments, '-b:a'), '128k');
		assert.equal(argumentValue(plan.arguments, '-vbr'), spelling);
	}
});

test('the external FFmpeg tier spells every MP3 strategy the way LAME means it', () => {
	const rateArguments = (settings: Readonly<Record<string, number>>) => {
		const plan = buildDesktopAudioFfmpegPlan({ ...encodeRequest('mp3'), settings });
		const codec = plan.arguments.indexOf('libmp3lame');
		assert.ok(codec >= 0);
		return plan.arguments.slice(codec + 1, codec + 4).filter((value) => value.startsWith('-')
			|| /^\d/u.test(value));
	};
	assert.deepEqual(rateArguments({ bitrateKbps: 256 }).slice(0, 2), ['-b:a', '256k']);
	assert.deepEqual(rateArguments({ averageBitrateKbps: 224 }), ['-b:a', '224k', '-abr']);
	assert.deepEqual(rateArguments({ vbrQuality: 6 }).slice(0, 2), ['-q:a', '6']);
	assert.deepEqual(rateArguments({ preset: 0 }).slice(0, 2), ['-b:a', '320k']);
	assert.deepEqual(rateArguments({ preset: 1 }).slice(0, 2), ['-q:a', '0']);
	assert.deepEqual(rateArguments({ preset: 2 }).slice(0, 2), ['-q:a', '2']);
	assert.deepEqual(rateArguments({ preset: 3 }).slice(0, 2), ['-q:a', '4']);
});

function encodeRequest(format: DesktopAudioCodecFormat): Record<string, unknown> {
	const fixture = ENCODE_FIXTURES.find((entry) => entry.format === format);
	assert.ok(fixture);
	return {
		operation: 'audio-encode', format, input: new Uint8Array(8),
		sampleRate: format === 'opus' ? 48_000 : format === 'mp2' ? 44_100 : 44_100,
		channelCount: 2, settings: fixture.settings, maximumOutputBytes: 8_192,
		requestId: `encode-${format}`,
	};
}

function argumentValue(arguments_: readonly string[], name: string): string | undefined {
	const index = arguments_.indexOf(name);
	return index < 0 ? undefined : arguments_[index + 1];
}
