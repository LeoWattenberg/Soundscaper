/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { completeVideoAvcColorDescription, createVideoAvcColorNormalizer } from '../src/common/editor/video-avc-color-description.ts';
import { produceVideoWebCodecsChunks, type VideoWebCodecsChunkProduceRequest } from '../src/common/editor/video-webcodecs-producer.ts';

// Actual owned WebKit2336 96x64 Main AVC description: missing VUI video_signal_type.
const missing = Uint8Array.from(Buffer.from('014d4c1effe1000d674d4c1e8c8d4313403c2211a801000468ce3c80', 'hex'));
const colorSpace = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } as const;
const ue = (n: number) => { const bits = (n + 1).toString(2); return '0'.repeat(bits.length - 1) + bits; };
const n = (value: number, width: number) => value.toString(2).padStart(width, '0');
function escape(bits: string): Uint8Array {
	const aligned = (bits + '1').padEnd(Math.ceil((bits.length + 1) / 8) * 8, '0');
	const out: number[] = []; let zeroes = 0;
	for (let i = 0; i < aligned.length; i += 8) {
		const byte = Number.parseInt(aligned.slice(i, i + 8), 2);
		if (zeroes === 2 && byte <= 3) { out.push(3); zeroes = 0; }
		out.push(byte); zeroes = byte === 0 ? zeroes + 1 : 0;
	}
	return Uint8Array.of(0x67, ...out);
}
function sps(options: { signal?: string; vui?: boolean; profile?: number; level?: number; constraints?: number; width?: number; crop?: number[]; tail?: string } = {}): Uint8Array {
	// Main, POC2, 1 reference, progressive96x64, existing VUI, no aspect/overscan.
	const prefix = n(options.profile ?? 77, 8) + n(options.constraints ?? 0, 8) + n(options.level ?? 30, 8) + ue(0) + ue(0) + ue(2)
		+ ue(1) + '0' + ue(options.width ?? 5) + ue(3) + '1' + '1' + (options.crop ? '1' + options.crop.map(ue).join('') : '0');
	return escape(prefix + (options.vui === false ? '0' : '1' + '00' + (options.signal ?? '0') + (options.tail ?? '000000')));
}
function avcc(spsBytes: Uint8Array, pps = Uint8Array.of(0x68, 0x80)): Uint8Array {
	return Uint8Array.of(1, spsBytes[1]!, spsBytes[2]!, spsBytes[3]!, 255, 225, spsBytes.length >> 8, spsBytes.length & 255,
		...spsBytes, 1, pps.length >> 8, pps.length & 255, ...pps);
}
const signal709 = '1' + '101' + '0' + '1' + n(1, 8).repeat(3);
const chunk = (bytes = Uint8Array.of(0, 0, 0, 2, 0x65, 0x88)) => ({
	byteLength: bytes.length, type: 'key' as const, timestamp: 0, duration: 500_000,
	copyTo(target: Uint8Array) { target.set(bytes); },
});
const metadata = (description: Uint8Array = missing, color: VideoColorSpaceInit = colorSpace): EncodedVideoChunkMetadata => ({
	decoderConfig: { codec: 'avc1.4d4c1e', codedWidth: 96, codedHeight: 64, colorSpace: color, description },
});

test('Motion owned AVC adds only missing VUI color bits and preserves already consistent bytes', () => {
	const absent = avcc(sps()); const before = absent.slice();
	const expected = avcc(sps({ signal: signal709 }));
	assert.deepEqual(completeVideoAvcColorDescription(absent), expected);
	assert.deepEqual(absent, before);
	assert.equal(completeVideoAvcColorDescription(expected), expected);
	assert.deepEqual(completeVideoAvcColorDescription(avcc(sps({ vui: false }))), expected, 'absent VUI gets only explicit color fields');
	const actual = completeVideoAvcColorDescription(missing);
	assert.notDeepEqual(actual, missing); assert.equal(completeVideoAvcColorDescription(actual), actual);
	assert.deepEqual(actual.slice(-7), missing.slice(-7), 'PPS bytes and length stay exact');
});

test('Motion owned AVC requires actual encoder709 metadata and retains coded packet/timing identity', () => {
	const normalize = createVideoAvcColorNormalizer(96, 64); const packet = chunk(); const meta = metadata();
	const first = normalize(packet, meta); const repaired = first.metadata!;
	assert.deepEqual(repaired.decoderConfig!.colorSpace, colorSpace);
	assert.notEqual(repaired, meta); assert.notEqual(repaired.decoderConfig!.description, meta.decoderConfig!.description);
	assert.equal(normalize(packet).metadata, undefined); assert.equal(first.chunk, packet);
	for (const color of [{}, { ...colorSpace, matrix: 'smpte170m' as const }, { ...colorSpace, fullRange: true }]) {
		assert.throws(() => createVideoAvcColorNormalizer(96, 64)(packet, metadata(missing, color)), /AVC/u);
	}
	assert.throws(() => createVideoAvcColorNormalizer(96, 64)(packet), /AVC/u);
});

test('Motion owned AVC refuses color conflicts, unsupported profile and malformed bounded records', () => {
	for (const signal of ['110111' + n(1, 8).repeat(3), '110101' + n(6, 8).repeat(3)]) {
		assert.throws(() => completeVideoAvcColorDescription(avcc(sps({ signal }))), /AVC/u);
	}
	for (const bytes of [avcc(sps({ profile: 66 })), avcc(sps({ profile: 100 })), missing.slice(0, -1),
		Uint8Array.of(...missing, 0), new Uint8Array(65537), Uint8Array.of(1, 77, 0, 30, 255, 224)]) {
		assert.throws(() => completeVideoAvcColorDescription(bytes), /AVC/u);
	}
	const normalize = createVideoAvcColorNormalizer(96, 64); normalize(chunk(), metadata());
	assert.throws(() => normalize(chunk(Uint8Array.of(0, 0, 0, 2, 0x67, 0x80))), /AVC/u);
	assert.throws(() => normalize(chunk(Uint8Array.of(0, 0, 0, 99, 0x65))), /AVC/u);
});

test('Motion owned in-band SPS normalization preserves every picture/PPS byte, order and sample time', () => {
	const sourceSps = sps(); const pps = Uint8Array.of(0x68, 0x80);
	const prefix = (nal: Uint8Array) => Uint8Array.of(0, 0, nal.length >> 8, nal.length & 255, ...nal);
	const picture = Uint8Array.of(0x65, 0x91, 0x12, 0x34, 0x56, 0x78);
	const body = Uint8Array.of(...prefix(sourceSps), ...prefix(pps), ...prefix(picture));
	const original = chunk(body); const normalize = createVideoAvcColorNormalizer(96, 64);
	const normalized = normalize(original, { decoderConfig: { ...metadata().decoderConfig!, codec: 'avc1.4d001e', description: avcc(sourceSps) } });
	const output = new Uint8Array(normalized.chunk.byteLength); normalized.chunk.copyTo(output);
	assert.deepEqual(output, Uint8Array.of(...prefix(sps({ signal: signal709 })), ...prefix(pps), ...prefix(picture)));
	assert.deepEqual(body, Uint8Array.of(...prefix(sourceSps), ...prefix(pps), ...prefix(picture)));
	assert.deepEqual([normalized.chunk.type, normalized.chunk.timestamp, normalized.chunk.duration], ['key', 0, 500_000]);
	const second = chunk(output); assert.equal(normalize(second).chunk, second, 'consistent SPS needs no packet allocation');
	assert.throws(() => normalize(chunk(prefix(sps({ signal: '110101' + n(6, 8).repeat(3) })))), /AVC/u);
	assert.throws(() => normalize(chunk(prefix(Uint8Array.of(0x68, 0x90)))), /AVC/u);
});

test('Motion AVC preserves timing/HRD/restriction bits and emulation prevention across insertion', () => {
	// Chroma location; timing with long zero runs; both HRDs; low-delay; pic-structure; restrictions.
	const hrd = ue(1) + '00100011' + ue(0) + ue(100) + '1' + ue(15) + ue(31) + '0' + '10000100001000010000';
	const tail = '1' + ue(0) + ue(0) + '1' + n(1, 32) + n(60, 32) + '1'
		+ '1' + hrd + '1' + hrd + '0' + '1' + '1' + '1' + ue(0) + ue(0) + ue(8) + ue(8) + ue(1) + ue(2);
	const original = avcc(sps({ tail }));
	assert.ok([...original].some((byte, i) => byte === 3 && original[i - 1] === 0 && original[i - 2] === 0));
	assert.deepEqual(completeVideoAvcColorDescription(original), avcc(sps({ signal: signal709, tail })));
	assert.deepEqual(completeVideoAvcColorDescription(avcc(sps({ signal: '100000', tail }))), avcc(sps({ signal: '100001' + n(1, 8).repeat(3), tail })));
	for (const suffix of ['00' + '1' + ue(32), '01' + n(0, 32) + n(60, 32), '00000' + '1' + '1' + ue(17)]) {
		assert.throws(() => completeVideoAvcColorDescription(avcc(sps({ tail: suffix }))), /AVC/u);
	}
	const noEscape = original.slice();
	for (let i = 2; i < noEscape.length; i += 1) if (noEscape[i] === 3 && noEscape[i - 1] === 0 && noEscape[i - 2] === 0) { noEscape[i + 1] = 4; break; }
	assert.throws(() => completeVideoAvcColorDescription(noEscape), /AVC/u);
	const badStop = sps(); badStop[badStop.length - 1] = 0;
	assert.throws(() => completeVideoAvcColorDescription(avcc(badStop)), /AVC/u);
	assert.throws(() => completeVideoAvcColorDescription(avcc(Uint8Array.of(...sps(), 0))), /AVC/u);
});

test('Motion AVC record and packet bounds reject unsupported length size, incomplete sets and foreign config', () => {
	for (let i = 0; i < missing.length; i += 1) assert.throws(() => completeVideoAvcColorDescription(missing.slice(0, i)), /AVC/u);
	for (const [index, value] of [[0, 2], [4, 254], [5, 224], [7, 255], [24, 0x67]] as const) {
		const bytes = missing.slice(); bytes[index] = value;
		assert.throws(() => completeVideoAvcColorDescription(bytes), /AVC/u);
	}
	for (const config of [{ ...metadata().decoderConfig!, codec: 'avc1.64001e' }, { ...metadata().decoderConfig!, codedWidth: 95 },
		{ ...metadata().decoderConfig!, codec: 'avc1.4d801e' }]) {
		assert.throws(() => createVideoAvcColorNormalizer(96, 64)(chunk(), { decoderConfig: config }), /AVC/u);
	}
	const normalize = createVideoAvcColorNormalizer(96, 64); normalize(chunk(), metadata());
	assert.throws(() => normalize({ ...chunk(), byteLength: 64 * 1024 * 1024 + 1, copyTo() { assert.fail('must refuse before allocation/copy'); } }), /AVC/u);
});

test('Motion finishing producer repairs emitted metadata before write and closes on conflicting metadata', async () => {
	for (const conflicting of [false, true]) {
		let encoderClosed = 0; let frameClosed = 0; let writes = 0;
		const emitted = metadata(missing, conflicting ? { ...colorSpace, matrix: 'smpte170m' } : colorSpace);
		class Encoder {
			state = 'configured'; encodeQueueSize = 0;
			constructor(readonly callbacks: ConstructorParameters<VideoWebCodecsChunkProduceRequest['encoderClass']>[0]) {}
			configure() {}
			encode() { this.callbacks.output(chunk(), emitted); }
			async flush() {}
			close() { encoderClosed += 1; this.state = 'closed'; }
		}
		class Frame { close() { frameClosed += 1; } }
		const run = produceVideoWebCodecsChunks({
			frameSource: { frameCount: 1, canvas: { width: 96, height: 64, frameRate: { num: 2, den: 1 } }, frame: index => index },
			producer: { byteLength: 96 * 64 * 4, produce(_frame, target) { target.fill(255); } },
			videoCodec: 'h264', codec: 'avc1.4d4c1e', bitrate: 1_000_000, h264Format: 'avc', encoderClass: Encoder, videoFrameClass: Frame,
			writeChunk(packet, received) {
				writes += 1; assert.deepEqual([packet.timestamp, packet.duration], [0, 500_000]);
				assert.deepEqual(received!.decoderConfig!.description, completeVideoAvcColorDescription(missing));
			},
		});
		if (conflicting) await assert.rejects(run, /AVC/u); else await run;
		assert.equal(writes, conflicting ? 0 : 1); assert.equal(encoderClosed, 1); assert.equal(frameClosed, 1);
	}
});

test('Motion AVC SPS geometry must agree with actual producer dimensions and crop remains positive', () => {
	const owned = (bytes: Uint8Array) => ({ decoderConfig: { ...metadata().decoderConfig!, codec: 'avc1.4d001e', description: avcc(bytes) } });
	for (const options of [{ width: 4 }, { crop: [24, 24, 0, 0] }, { crop: [0, 0, 16, 16] }]) {
	 assert.throws(() => createVideoAvcColorNormalizer(96, 64)(chunk(), owned(sps(options))), /AVC/u);
	}
	const cropped = sps({ width: 6, crop: [0, 8, 0, 0] });
	assert.doesNotThrow(() => createVideoAvcColorNormalizer(96, 64)(chunk(), owned(cropped)));
	for (const level of [1, 29, 63]) assert.throws(() => completeVideoAvcColorDescription(avcc(sps({ level }))), /AVC/u);
});

test('Motion AVC accepts actual encoder Main constraint refinements but no conflicting profile or level', () => {
	const config = { ...metadata().decoderConfig!, codec: 'avc1.4d001e' };
	assert.doesNotThrow(() => createVideoAvcColorNormalizer(96, 64)(chunk(), { decoderConfig: config }));
	for (const codec of ['avc1.4d801e', 'avc1.4d0014', 'avc1.4d031e']) {
	 assert.throws(() => createVideoAvcColorNormalizer(96, 64)(chunk(), { decoderConfig: { ...config, codec } }), /AVC/u);
	}
});

test('Motion accepts an actual lower Main level without rewriting native config, SPS or picture packets', () => {
	// Captured Chromium151 application callback: requested/emitted config Level3, actual SPS Level1.
	const description = Uint8Array.from(Buffer.from('AU1MCv/hABBnTUwKjGhiSagICAg8IhGoAQAEaM48gA==', 'base64'));
	const meta = { decoderConfig: { ...metadata().decoderConfig!, codec: 'avc1.4d001e', description } };
	const before = description.slice(); const normalize = createVideoAvcColorNormalizer(96, 64);
	for (const [index, encoded] of [
		'AAAAMWW4AAQEP//+CKKAAX8cAAQIo4ycnJ+H/+CKK+OAAIEccydddddPXXXXXT1111109eA=',
		'AAAAGGHgAH5AQ5BPycTyHvO+fkPed8/IeTO+fw==',
	].entries()) {
		const data = Uint8Array.from(Buffer.from(encoded, 'base64'));
		const packet = { ...chunk(data), type: index === 0 ? 'key' as const : 'delta' as const, timestamp: index * 500_000 };
		const result = normalize(packet, index === 0 ? meta : undefined);
		assert.equal(result.chunk, packet); assert.equal(result.metadata, index === 0 ? meta : undefined);
	}
	assert.deepEqual(description, before); assert.equal(meta.decoderConfig.codec, 'avc1.4d001e');
});

test('Motion Main level compatibility is ordered, defined and constraint preserving including Level1b', () => {
	const run = (actual: number, constraints: number, codec: string) => createVideoAvcColorNormalizer(96, 64)(chunk(), {
		decoderConfig: { ...metadata().decoderConfig!, codec, description: avcc(sps({ level: actual, constraints, signal: signal709 })) },
	});
	for (const [level, flags, codec] of [[10, 0, 'avc1.4d000b'], [11, 16, 'avc1.4d000b'], [11, 16, 'avc1.4d100b'],
		[11, 0, 'avc1.4d0014'], [30, 0, 'avc1.4d003e']] as const) assert.doesNotThrow(() => run(level, flags, codec));
	for (const [level, flags, codec] of [[11, 16, 'avc1.4d000a'], [11, 0, 'avc1.4d100b'], [20, 16, 'avc1.4d100b'],
		[30, 0, 'avc1.4d0014'], [10, 0, 'avc1.4d801e'], [10, 0, 'avc1.4d0023'], [10, 0, 'avc1.4d0009'],
		[10, 0, 'avc1.4d011e'], [31, 0, 'avc1.4d001e']] as const) {
		assert.throws(() => run(level, flags, codec), /AVC/u);
	}
});
