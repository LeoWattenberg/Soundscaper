/* SPDX-License-Identifier: AGPL-3.0-only */

import { AudioSample, CustomAudioDecoder, registerDecoder, type AudioCodec, type EncodedPacket } from 'mediabunny';
import flac from './flac/source-manifest.json';
import opus from './opus/source-manifest.json';
import vorbis from './vorbis/source-manifest.json';
import mpg123 from './mpg123/source-manifest.json';

type ReviewedCodec = 'flac' | 'opus' | 'vorbis' | 'mp3';
interface Payload {
	readonly url: URL;
	readonly prefix: string;
	readonly manifest: { readonly sha256: string; readonly maximumBytes: number; readonly maximumMemoryBytes: number; readonly allowedFunctionImports: readonly string[] };
}
const PAYLOADS: Readonly<Record<ReviewedCodec, Payload>> = {
	flac: { url: new URL('./flac/flac.wasm', import.meta.url), prefix: 'scfl', manifest: flac.wasm },
	opus: { url: new URL('./opus/opus.wasm', import.meta.url), prefix: 'scop', manifest: opus.wasm },
	vorbis: { url: new URL('./vorbis/vorbis.wasm', import.meta.url), prefix: 'scvb', manifest: vorbis.wasm },
	mp3: { url: new URL('./mpg123/mpg123.wasm', import.meta.url), prefix: 'scmp', manifest: mpg123.wasm },
};
const enabled = new Set<ReviewedCodec>();
let preferredConfigurations = new WeakMap<AudioDecoderConfig, ReviewedCodec>();
let registered = false;
const MAXIMUM_PACKET_BYTES = 1024 * 1024;
const MAXIMUM_FRAMES = 65_536;

/** Register the reviewed packet decoder only for codecs that native WebCodecs refused. */
export function enableReviewedAudioImportDecoder(codec: AudioCodec | null): boolean {
	if (codec !== 'flac' && codec !== 'opus' && codec !== 'vorbis' && codec !== 'mp3') return false;
	enabled.add(codec);
	registerReviewedDecoder();
	return true;
}

/** Select one audited packet decoder before any source chunks reach storage. */
export function preferReviewedAudioImportDecoder(codec: AudioCodec | null, config: AudioDecoderConfig): boolean {
	if (codec !== 'flac' && codec !== 'opus' && codec !== 'vorbis' && codec !== 'mp3') return false;
	preferredConfigurations.set(config, codec);
	if (!ReviewedAudioImportDecoder.supports(codec, config)) { preferredConfigurations.delete(config); return false; }
	registerReviewedDecoder();
	return true;
}

/** A LayerII track needs mpg123 even when native support advertises the shared mp3 codec. */
export function preferReviewedMpegLayerIIImportDecoder(config: AudioDecoderConfig): boolean {
	return config.codec === 'mp3' && preferReviewedAudioImportDecoder('mp3', config);
}

function registerReviewedDecoder(): void {
	if (!registered) { registerDecoder(ReviewedAudioImportDecoder); registered = true; }
}

/** Desktop imports must use native WebCodecs or their main-owned utility codec. */
export function disableReviewedAudioImportDecoders(): void { enabled.clear(); preferredConfigurations = new WeakMap(); }

class ReviewedAudioImportDecoder extends CustomAudioDecoder {
	#exports: WebAssembly.Exports | null = null;
	#payload: Payload | null = null;
	#session = 0;
	#output = 0;
	#timestamp: number | null = null;
	#outputGain = 1;
	#closed = false;

	static override supports(codec: AudioCodec, config: AudioDecoderConfig): boolean {
		if ((!enabled.has(codec as ReviewedCodec) && preferredConfigurations.get(config) !== codec) || !Number.isSafeInteger(config.sampleRate)
			|| config.sampleRate < 8_000 || config.sampleRate > 192_000
			|| !Number.isSafeInteger(config.numberOfChannels) || config.numberOfChannels < 1) return false;
		if (codec === 'flac') return config.numberOfChannels <= 8;
		if (config.numberOfChannels > 2) return false;
		if (codec === 'opus') return config.sampleRate === 48_000;
		if (codec === 'mp3') return [32_000, 44_100, 48_000].includes(config.sampleRate);
		return codec === 'vorbis';
	}

	override async init(): Promise<void> {
		const payload = PAYLOADS[this.codec as ReviewedCodec];
		if (!payload) throw new Error('No reviewed packet decoder owns this codec.');
		const response = await fetch(payload.url);
		if (!response.ok) throw new Error('The reviewed audio decoder payload could not be loaded.');
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > payload.manifest.maximumBytes) throw new Error('The reviewed decoder payload exceeds its size bound.');
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
		if ([...digest].map((value) => value.toString(16).padStart(2, '0')).join('') !== payload.manifest.sha256) {
			throw new Error('The reviewed decoder payload failed authentication.');
		}
		const module = await WebAssembly.compile(bytes);
		const instance = await WebAssembly.instantiate(module, importsFor(module, payload));
		if (this.#closed) return;
		this.#exports = instance.exports;
		this.#payload = payload;
		exported(instance.exports, '_initialize')();
		if (!(instance.exports.memory instanceof WebAssembly.Memory)
			|| instance.exports.memory.buffer.byteLength > payload.manifest.maximumMemoryBytes) throw new Error('The reviewed decoder memory is unsupported.');
		const description = descriptionBytes(this.config.description);
		if (this.codec === 'opus' && description.length >= 19) {
			const gain = new DataView(description.buffer).getInt16(16, true);
			this.#outputGain = 10 ** (gain / (20 * 256));
		}
		const pointer = description.length ? this.#allocate(description.length) : 0;
		try {
			if (pointer) new Uint8Array(this.#memory(), pointer, description.length).set(description);
			this.#session = this.#function('stream_decode_open')(pointer, description.length, this.config.sampleRate, this.config.numberOfChannels);
			if (!this.#session) throw new Error('The reviewed packet decoder refused the source configuration.');
			this.#output = this.#allocate(MAXIMUM_FRAMES * this.config.numberOfChannels * 4);
		} catch (error) { this.close(); throw error; }
		finally { if (pointer) this.#function('free')(pointer); }
	}

	override decode(packet: EncodedPacket): void {
		if (this.#closed || !this.#session || !this.#output) throw new Error('The reviewed packet decoder is closed.');
		if (packet.data.byteLength < 1 || packet.data.byteLength > MAXIMUM_PACKET_BYTES
			|| !Number.isFinite(packet.timestamp)) throw new Error('The encoded audio packet exceeds its bound.');
		const pointer = this.#allocate(packet.data.byteLength);
		try {
			new Uint8Array(this.#memory(), pointer, packet.data.byteLength).set(packet.data);
			const frames = this.#function('stream_decode_push')(this.#session, pointer, packet.data.byteLength, this.#output, MAXIMUM_FRAMES);
			if (!Number.isSafeInteger(frames) || frames < 0 || frames > MAXIMUM_FRAMES) throw new Error('The reviewed packet decoder returned invalid PCM.');
			if (!frames) return;
			const pcm = new Float32Array(this.#memory(), this.#output, frames * this.config.numberOfChannels).slice();
			if (this.#outputGain !== 1) for (let index = 0; index < pcm.length; index += 1) pcm[index]! *= this.#outputGain;
			if (pcm.some((sample) => !Number.isFinite(sample))) throw new Error('The reviewed packet decoder returned non-finite PCM.');
			this.#timestamp ??= packet.timestamp;
			const sample = new AudioSample({ data: pcm, format: 'f32', sampleRate: this.config.sampleRate,
				numberOfChannels: this.config.numberOfChannels, timestamp: this.#timestamp });
			this.#timestamp += frames / this.config.sampleRate;
			this.onSample(sample);
		} finally { this.#function('free')(pointer); }
	}

	override flush(): void { /* Each packet drains all complete decoded samples synchronously. */ }

	override close(): void {
		if (this.#closed) return;
		this.#closed = true;
		if (this.#session) this.#function('stream_decode_close')(this.#session);
		if (this.#output) this.#function('free')(this.#output);
		this.#session = 0;
		this.#output = 0;
	}

	#function(name: string): (...values: number[]) => number {
		if (!this.#exports || !this.#payload) throw new Error('The reviewed decoder has not initialized.');
		return exported(this.#exports, `${this.#payload.prefix}_${name}`);
	}

	#memory(): ArrayBuffer {
		const memory = this.#exports?.memory;
		if (!(memory instanceof WebAssembly.Memory) || !(memory.buffer instanceof ArrayBuffer)
			|| memory.buffer.byteLength > this.#payload!.manifest.maximumMemoryBytes) throw new Error('The reviewed decoder exceeded its memory bound.');
		return memory.buffer;
	}

	#allocate(length: number): number {
		const pointer = this.#function('allocate')(length);
		if (!Number.isSafeInteger(pointer) || pointer < 1 || pointer > this.#memory().byteLength - length) throw new Error('The reviewed decoder allocation failed.');
		return pointer;
	}
}

function descriptionBytes(value: AllowSharedBufferSource | undefined): Uint8Array<ArrayBuffer> {
	if (!value) return new Uint8Array();
	const bytes = ArrayBuffer.isView(value)
		? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
	if (bytes.byteLength > 262_144) throw new Error('The audio decoder configuration exceeds its bound.');
	return Uint8Array.from(bytes);
}

function exported(exports: WebAssembly.Exports, name: string): (...values: number[]) => number {
	const value = exports[name] ?? exports[`_${name}`];
	if (typeof value !== 'function') throw new Error(`The reviewed decoder export ${name} is unavailable.`);
	return value as (...values: number[]) => number;
}

function importsFor(module: WebAssembly.Module, payload: Payload): WebAssembly.Imports {
	const imports: Record<string, Record<string, (...values: number[]) => number | void>> = {};
	for (const entry of WebAssembly.Module.imports(module)) {
		const key = `${entry.module}.${entry.name}`;
		if (entry.kind !== 'function' || !payload.manifest.allowedFunctionImports.includes(key)) throw new Error('The reviewed decoder imports forbidden authority.');
		imports[entry.module] ??= {};
		imports[entry.module]![entry.name] = key === 'env.emscripten_notify_memory_growth' ? () => undefined
			: key === 'env.abort' || key === 'wasi_snapshot_preview1.proc_exit' ? () => { throw new Error('The reviewed decoder aborted.'); }
			: () => 8;
	}
	return imports;
}
