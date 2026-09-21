/* SPDX-License-Identifier: AGPL-3.0-only */
import { inspectXing, parseHeader } from '../../../desktop/bundled-mpeg-audio-stream.ts';
import { oggPageCrc } from '../../../desktop/ogg-page-crc.ts';
import { parseBlock } from '../../../desktop/bundled-wavpack-stream.ts';
import { readAacSourceMetadata, validateAacSourceGeometry } from './aac-source-geometry.ts';
import type { BrowserDedicatedAudioFormat } from './browser-dedicated-audio-codec.ts';

interface OutputExpectation {
	readonly format: BrowserDedicatedAudioFormat | 'aac-m4a';
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly signal?: AbortSignal;
}
const CACHE_BYTES = 1024 ** 2;

/** Validate the closed file without materializing either its PCM or its encoded bytes. */
export async function validateStreamedAudioOutput(blob: Blob, expected: OutputExpectation): Promise<void> {
	if (!blob.size) fail('The encoded audio file is empty.');
	const reader = new BoundedReader(blob, expected.signal);
	if (expected.format === 'mp3' || expected.format === 'mp2') await validateMpeg(reader, expected);
	else if (expected.format === 'opus' || expected.format === 'ogg-vorbis') await validateOgg(reader, expected);
	else if (expected.format === 'wavpack') await validateWavPack(reader, expected);
	else await validateDemuxedFile(blob, expected);
	reader.assertCurrent();
}

class BoundedReader {
	private cache = new Uint8Array<ArrayBuffer>(new ArrayBuffer(0));
	private start = 0;
	readonly blob: Blob;
	private readonly signal?: AbortSignal;
	constructor(blob: Blob, signal?: AbortSignal) { this.blob = blob; this.signal = signal; }
	assertCurrent(): void {
		if (this.signal?.aborted) throw this.signal.reason ?? new DOMException('Audio validation was cancelled.', 'AbortError');
	}
	async read(offset: number, length: number): Promise<Uint8Array> {
		this.assertCurrent();
		if (!Number.isSafeInteger(offset) || offset < 0 || length < 1 || length > CACHE_BYTES || offset + length > this.blob.size) fail('The encoded audio file is truncated.');
		if (offset < this.start || offset + length > this.start + this.cache.length) {
			this.start = offset;
			this.cache = new Uint8Array(await this.blob.slice(offset, Math.min(this.blob.size, offset + CACHE_BYTES)).arrayBuffer());
			this.assertCurrent();
		}
		return this.cache.subarray(offset - this.start, offset - this.start + length);
	}
}

async function validateMpeg(reader: BoundedReader, expected: OutputExpectation): Promise<void> {
	let offset = 0;
	let count = 0;
	let gapless: ReturnType<typeof inspectXing> = null;
	while (offset < reader.blob.size) {
		const header = parseHeader(await reader.read(offset, 4), 0);
		if (header.format !== expected.format || header.mpegVersion !== 1 || header.crcProtected
			|| header.sampleRate !== expected.sampleRate || header.channelCount !== expected.channelCount || header.frameBytes < 8) fail('MPEG output geometry is outside its reviewed profile.');
		const frame = await reader.read(offset, header.frameBytes);
		if (!count && expected.format === 'mp3') gapless = inspectXing(frame, header);
		offset += frame.length; count++;
	}
	if (expected.format === 'mp3') {
		if (!gapless || gapless.unsupported || gapless.declaredFrames !== count - 1 || gapless.declaredBytes !== reader.blob.size
			|| gapless.declaredFrames * 1152 - gapless.encoderDelay - gapless.endPadding !== expected.frameCount) fail('MP3 output gapless duration does not match its PCM geometry.');
	} else if (count !== Math.ceil(expected.frameCount / 1152)) fail('MP2 output duration does not match its PCM geometry.');
}

async function validateOgg(reader: BoundedReader, expected: OutputExpectation): Promise<void> {
	let offset = 0;
	let sequence = 0;
	let serial: number | null = null;
	let finalGranule = 0n;
	let preSkip = 0;
	let end = false;
	let continued = false;
	while (offset < reader.blob.size) {
		const header = await reader.read(offset, 27);
		if (ascii(header, 0, 4) !== 'OggS' || header[4] !== 0 || end) fail('The Ogg output page sequence is invalid.');
		const flags = header[5]!;
		const view = new DataView(header.buffer, header.byteOffset, header.length);
		const pageSerial = view.getUint32(14, true);
		if ((flags & ~7) || !!(flags & 1) !== continued || (sequence === 0 ? flags !== 2 : !!(flags & 2))
			|| view.getUint32(18, true) !== sequence || (serial !== null && serial !== pageSerial)) fail('Chained or discontinuous Ogg output is outside its reviewed profile.');
		serial = pageSerial;
		const segments = await reader.read(offset + 27, header[26]!);
		const bodyLength = segments.reduce((total, length) => total + length, 0);
		const page = await reader.read(offset, 27 + segments.length + bodyLength);
		if (oggPageCrc(page) !== view.getUint32(22, true)) fail('The Ogg output page checksum is invalid.');
		if (!sequence) {
			const body = page.subarray(27 + segments.length);
			if (expected.format === 'opus') {
				if (body.length !== 19 || ascii(body, 0, 8) !== 'OpusHead' || body[8] !== 1 || body[9] !== expected.channelCount || body[18] !== 0) fail('Opus output channel geometry is outside its reviewed profile.');
				preSkip = new DataView(body.buffer, body.byteOffset, body.length).getUint16(10, true);
			} else if (body.length !== 30 || body[0] !== 1 || ascii(body, 1, 6) !== 'vorbis' || body[11] !== expected.channelCount
				|| new DataView(body.buffer, body.byteOffset, body.length).getUint32(12, true) !== expected.sampleRate) fail('Vorbis output geometry is outside its reviewed profile.');
		}
		continued = segments.at(-1) === 255;
		end = !!(flags & 4);
		if (end) finalGranule = view.getBigUint64(6, true);
		offset += page.length; sequence++;
	}
	if (!end || continued || finalGranule !== BigInt(expected.frameCount + preSkip)) fail('Ogg output EOS duration does not match its PCM geometry.');
}

async function validateWavPack(reader: BoundedReader, expected: OutputExpectation): Promise<void> {
	let offset = 0;
	let nextFrame = 0;
	let groupChannels = 0;
	let groupFrames = 0;
	let openGroup = false;
	const state = { unsupportedReason: null as string | null };
	while (offset < reader.blob.size) {
		const header = await reader.read(offset, 32);
		if (ascii(header, 0, 4) !== 'wvpk') fail('The WavPack output header is invalid.');
		const length = new DataView(header.buffer, header.byteOffset, header.length).getUint32(4, true) + 8;
		const bytes = await reader.read(offset, length);
		const block = parseBlock(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.length), 0, state, expected.frameCount);
		if (state.unsupportedReason || block.totalFrames !== expected.frameCount || block.blockIndex !== nextFrame || block.sampleRate !== expected.sampleRate
			|| (block.channelDeclaration !== null && block.channelDeclaration !== expected.channelCount)) fail('The WavPack output geometry is outside its reviewed profile.');
		if (block.initial) {
			if (openGroup) fail('The WavPack output channel groups overlap.');
			openGroup = true; groupChannels = 0; groupFrames = block.blockFrames;
		}
		if (!openGroup || block.blockFrames !== groupFrames) fail('The WavPack output channel group is incomplete.');
		groupChannels += block.channelCount;
		if (block.final) {
			if (groupChannels !== expected.channelCount) fail('The WavPack output channel geometry is invalid.');
			openGroup = false; nextFrame += groupFrames;
		}
		offset += length;
	}
	if (openGroup || nextFrame !== expected.frameCount) fail('WavPack output duration does not match its PCM geometry.');
}

async function validateDemuxedFile(blob: Blob, expected: OutputExpectation): Promise<void> {
	const aacMetadata = expected.format === 'aac-m4a' ? await readAacSourceMetadata(blob, expected.signal) : null;
	const { BlobSource, EncodedPacketSink, FLAC, Input, MP4 } = await import('mediabunny');
	const format = expected.format === 'flac' ? FLAC : MP4;
	const input = new Input({ source: new BlobSource(blob, { maxCacheSize: CACHE_BYTES, useStreamReader: false }), formats: [format] });
	const assertCurrent = (): void => { if (expected.signal?.aborted) throw expected.signal.reason ?? new DOMException('Audio validation was cancelled.', 'AbortError'); };
	const onAbort = (): void => input.dispose();
	expected.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		assertCurrent();
		const [readable, actualFormat, tracks, audioTracks] = await Promise.all([input.canRead(), input.getFormat(), input.getTracks(), input.getAudioTracks()]);
		if (!readable || actualFormat !== format || tracks.length !== 1 || audioTracks.length !== 1) fail('The encoded audio file must contain exactly one reviewed audio track.');
		const audio = audioTracks[0]!;
		const [codec, rate, channels, duration] = await Promise.all([audio.getCodec(), audio.getSampleRate(), audio.getNumberOfChannels(), input.computeDuration([audio])]);
		assertCurrent();
		if (codec !== (expected.format === 'flac' ? 'flac' : 'aac') || rate !== expected.sampleRate || channels !== expected.channelCount) fail('The encoded audio track geometry does not match its requested PCM.');
		if (!Number.isFinite(duration)) fail('The encoded audio duration does not match its requested PCM geometry.');
		if (expected.format === 'aac-m4a') {
			const [profile, config] = await Promise.all([audio.getCodecParameterString(), audio.getDecoderConfig()]);
			if (profile !== 'mp4a.40.2' || config?.codec !== profile || !config.description?.byteLength || config.sampleRate !== rate || config.numberOfChannels !== channels) fail('The AAC output is outside its reviewed AAC-LC profile.');
			let encodedFrames = 0;
			for await (const packet of new EncodedPacketSink(audio).packets()) {
				assertCurrent();
				if (!packet.data.length || packet.data.length > CACHE_BYTES || Math.abs(packet.duration * rate - 1024) > 1e-5
					|| Math.abs(packet.timestamp * rate - encodedFrames) > 1e-5) fail('The AAC output packet sequence is outside its qualified profile.');
				encodedFrames += 1024;
				if (encodedFrames % (1024 * 256) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
			const source = validateAacSourceGeometry(aacMetadata, { sampleRate: rate, channelCount: channels, encodedFrames });
			if (source.sourceFrames !== expected.frameCount || Math.abs(duration * rate - encodedFrames) > 1e-5) fail('The AAC output source duration does not match its requested PCM geometry.');
		} else {
			if (duration < (expected.frameCount - 1) / rate || duration > expected.frameCount / rate + 1e-9) fail('The encoded audio duration does not match its requested PCM geometry.');
			let frames = 0;
			for await (const packet of new EncodedPacketSink(audio).packets()) {
				assertCurrent();
				if (!packet.data.length || packet.data.length > CACHE_BYTES || flacCrc(packet.data) !== 0
					|| Math.abs(packet.timestamp * rate - frames) > 1e-5) fail('The FLAC output frame checksum or sequence is invalid.');
				frames += Math.round(packet.duration * rate);
			}
			if (frames !== expected.frameCount) fail('FLAC output frame duration does not match its PCM geometry.');
		}
		assertCurrent();
	} finally { expected.signal?.removeEventListener('abort', onAbort); input.dispose(); }
}

const FLAC_CRC_TABLE = Uint16Array.from({ length: 256 }, (_, value) => {
	let crc = value << 8;
	for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x8005 : 0)) & 0xffff;
	return crc;
});
function flacCrc(bytes: Uint8Array): number {
	let crc = 0;
	for (const byte of bytes) crc = ((crc << 8) ^ FLAC_CRC_TABLE[((crc >>> 8) ^ byte) & 255]!) & 0xffff;
	return crc;
}
function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function fail(message: string): never { throw new Error(message); }
