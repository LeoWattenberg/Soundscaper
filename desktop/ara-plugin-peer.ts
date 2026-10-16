/* SPDX-License-Identifier: AGPL-3.0-only */
/** Bounded ARA operations on the existing isolated, authenticated VST3 peer. */
export interface AraClipConfiguration {
	readonly sourceId: string;
	readonly name: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly sourceStartSeconds: number;
	readonly playbackStartSeconds: number;
	readonly durationSeconds: number;
}
interface AraWriter {
	text(value: string): void;
	number(value: number): void;
	unsigned32(value: number): void;
	floats(value: Float32Array): void;
	blob(value: Uint8Array): void;
}
interface AraReader {
	byte(): number;
	unsigned32(): number;
	floats(output: Float32Array): void;
	blob(maximum: number): Uint8Array;
	done(): void;
}
interface AraPeerInstance {
	latency: number;
	readonly session: {
		request(operation: number, build?: (writer: AraWriter) => void): Promise<AraReader>;
	};
}
interface DocumentState {
	readonly config: AraClipConfiguration;
	written: number;
	bound: boolean;
}
const MAXIMUM_ARCHIVE_BYTES = 16 * 1024 ** 2 - 64;
export function createAraPluginPeerMethods<T extends AraPeerInstance>(liveInstance: (value: T) => T) {
	const documents = new WeakMap<T, DocumentState>();
	const document = (value: T) => {
		const state = documents.get(liveInstance(value));
		if (!state) throw new Error('ARA source PCM has not been uploaded.');
		return state;
	};
	return Object.freeze({
		araCapabilities: async (value: T) => {
			const answer = await liveInstance(value).session.request(19);
			const supported = answer.byte(); answer.done();
			if (supported > 1) throw new Error('The isolated peer returned invalid ARA capabilities.');
			return Object.freeze({ supported: supported === 1 });
		},
		configureAra: async (value: T, config: AraClipConfiguration) => {
			const instance = liveInstance(value);
			validateConfiguration(config);
			if (documents.get(instance)?.bound) throw new Error('The ARA document is already bound.');
			const answer = await instance.session.request(13, (writer) => {
				writer.text(config.sourceId); writer.text(config.name); writer.number(config.sampleRate);
				writer.unsigned32(config.channelCount); writer.unsigned32(config.frameCount);
				writer.number(config.sourceStartSeconds); writer.number(config.playbackStartSeconds); writer.number(config.durationSeconds);
			});
			answer.done(); documents.set(instance, { config: Object.freeze({ ...config }), written: 0, bound: false });
			return true;
		},
		writeAraPcm: async (value: T, input: Readonly<{ startFrame: number; channels: readonly Float32Array[] }>) => {
			const state = document(value);
			if (state.bound) throw new Error('The ARA document is already bound.');
			const frames = input.channels[0]?.length ?? 0;
			frameCount(frames);
			if (input.startFrame !== state.written || frames > state.config.frameCount - state.written
				|| input.channels.length !== state.config.channelCount) throw new RangeError('ARA upload does not match the source region.');
			for (const plane of input.channels) {
				if (!(plane instanceof Float32Array) || plane.length !== frames
					|| plane.buffer instanceof SharedArrayBuffer || plane.some((sample) => !Number.isFinite(sample))) {
					throw new TypeError('ARA PCM must be finite planes in ordinary memory.');
				}
			}
			if (frames * input.channels.length * 4 > MAXIMUM_ARCHIVE_BYTES) throw new RangeError('ARA upload frame is oversized.');
			const answer = await liveInstance(value).session.request(14, (writer) => {
				writer.unsigned32(input.startFrame); writer.unsigned32(frames); writer.unsigned32(input.channels.length);
				for (const plane of input.channels) writer.floats(plane);
			});
			answer.done(); state.written += frames; return true;
		},
		bindAra: async (value: T) => {
			const state = document(value);
			if (state.bound || state.written !== state.config.frameCount) throw new Error('ARA source must be fully uploaded before binding.');
			const answer = await liveInstance(value).session.request(15);
			answer.done(); state.bound = true; return true;
		},
		renderAra: async (value: T, request: Readonly<{ startFrame: number; frameCount: number; channelCount: number }>) => {
			const instance = liveInstance(value);
			const state = document(instance);
			frameCount(request.frameCount);
			const durationFrames = Math.round(state.config.durationSeconds * state.config.sampleRate);
			if (!state.bound || !Number.isSafeInteger(request.startFrame) || request.startFrame < 0
				|| request.startFrame + request.frameCount > durationFrames || request.channelCount !== state.config.channelCount) {
				throw new RangeError('ARA render does not match the bound region.');
			}
			if (request.frameCount * request.channelCount * 4 > MAXIMUM_ARCHIVE_BYTES) throw new RangeError('ARA render frame is oversized.');
			let answer: AraReader;
			try {
				answer = await instance.session.request(16, (writer) => {
					writer.unsigned32(request.startFrame); writer.unsigned32(request.frameCount); writer.unsigned32(request.channelCount);
				});
			} catch (error) {
				if (error instanceof Error && 'code' in error && error.code === 'mode-refused') {
					throw Object.assign(new Error('The ARA plugin is still analyzing its source audio.', { cause: error }),
						{ code: 'ara-analysis-incomplete' });
				}
				throw error;
			}
			const latencyFrames = answer.unsigned32();
			if (answer.unsigned32() !== request.channelCount) throw new Error('The ARA peer changed output topology.');
			const channels = Array.from({ length: request.channelCount }, () => new Float32Array(request.frameCount));
			for (const plane of channels) {
				answer.floats(plane);
				if (plane.some((sample) => !Number.isFinite(sample))) throw new Error('The ARA peer rendered non-finite PCM.');
			}
			answer.done(); instance.latency = latencyFrames;
			return Object.freeze({ channels: Object.freeze(channels), latencyFrames });
		},
		saveAraState: async (value: T) => {
			if (!document(value).bound) throw new Error('The ARA document has not been bound.');
			const answer = await liveInstance(value).session.request(17);
			const archive = answer.blob(MAXIMUM_ARCHIVE_BYTES); answer.done(); return archive;
		},
		loadAraState: async (value: T, archive: Uint8Array) => {
			if (!document(value).bound) throw new Error('The ARA document has not been bound.');
			if (!(archive instanceof Uint8Array) || archive.buffer instanceof SharedArrayBuffer || archive.byteLength > MAXIMUM_ARCHIVE_BYTES) {
				throw new TypeError('ARA archives must be bounded ordinary memory.');
			}
			const answer = await liveInstance(value).session.request(18, (writer) => writer.blob(archive));
			answer.done(); return true;
		},
	});
}
function validateConfiguration(config: AraClipConfiguration) {
	for (const value of [config.sourceId, config.name]) {
		if (typeof value !== 'string' || value.length < 1 || value.includes('\0') || Buffer.byteLength(value, 'utf8') > 511) {
			throw new TypeError('ARA source text must be bounded and nonempty.');
		}
	}
	if (!Number.isFinite(config.sampleRate) || config.sampleRate < 8000 || config.sampleRate > 768000
		|| !Number.isSafeInteger(config.frameCount) || config.frameCount < 1 || config.frameCount > 0xffff_ffff
		|| !Number.isSafeInteger(config.channelCount) || config.channelCount < 1 || config.channelCount > 64) {
		throw new RangeError('ARA source topology is invalid.');
	}
	if (config.frameCount * config.channelCount * 4 > 512 * 1024 ** 2) throw new RangeError('ARA source exceeds 512 MiB.');
	if (!Number.isFinite(config.sourceStartSeconds) || config.sourceStartSeconds < 0
		|| !Number.isFinite(config.playbackStartSeconds) || config.playbackStartSeconds < 0 || config.playbackStartSeconds > 86400 * 365
		|| !Number.isFinite(config.durationSeconds) || config.durationSeconds <= 0
		|| config.sourceStartSeconds + config.durationSeconds > config.frameCount / config.sampleRate + 1e-9) {
		throw new RangeError('ARA source region is invalid.');
	}
}
function frameCount(value: number) {
	if (!Number.isSafeInteger(value) || value < 1 || value > 65_536) throw new RangeError('ARA frame count is invalid.');
}
