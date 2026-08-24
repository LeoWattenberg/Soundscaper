/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canvas-backed, pathless native image-sequence source resolution for preview and export. */

import type { VideoRetimeFrameDescriptor } from '../video-retime-frame-dispatch.ts';
import type {
	FramescaperNativeImageSequenceBridge,
	FramescaperNativeImageSequenceDecodeClaim,
} from './framescaper-native-image-sequence-bridge.ts';
import type {
	VideoKeyframeOfflineSourcePresentation,
	VideoKeyframeOfflineSourceResolver,
} from './video-keyframe-offline-rgba-source.ts';

const HEADER_BYTES = 59;
const FRAME_HEADER_BYTES = 32;
const MAXIMUM_READ_BYTES = 16 * 1024 * 1024;
const MAXIMUM_SOURCE_COUNT = 4_096;
const MAXIMUM_CLIP_REFERENCES = 100_000;
const OPAQUE_ID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface FramescaperNativeImageSequenceSourceAsset {
	readonly sourceId: string;
	readonly identity: string;
	readonly extension: 'png' | 'tif' | 'tiff' | 'exr';
	readonly clipIds: readonly string[];
	readonly frameCount: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly presentationForEntry: (
		entry: Readonly<Record<string, unknown>>,
	) => VideoRetimeFrameDescriptor;
}

export interface FramescaperNativeImageSequenceSourceResolverOptions {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly sources: readonly FramescaperNativeImageSequenceSourceAsset[];
	readonly bridge: Required<Pick<FramescaperNativeImageSequenceBridge,
		'decodeImageSequenceSource' | 'cancelImageSequenceDecode'
		| 'readImageSequenceDecode' | 'releaseImageSequenceDecode'>>;
	readonly createCanvas?: () => HTMLCanvasElement;
	readonly writeRgba?: (
		canvas: HTMLCanvasElement, bytes: Uint8ClampedArray, width: number, height: number,
	) => void;
	readonly mintRequestId?: () => string;
}

export interface FramescaperNativeImageSequenceSourceResolver {
	readonly sourceIds: ReadonlySet<string>;
	readonly resolveSource: VideoKeyframeOfflineSourceResolver;
	dispose(): Promise<void>;
}

interface AssetSnapshot extends Omit<FramescaperNativeImageSequenceSourceAsset, 'clipIds'> {
	readonly clipIds: ReadonlySet<string>;
}

interface SourceState {
	readonly asset: AssetSnapshot;
	claim: FramescaperNativeImageSequenceDecodeClaim | null;
	pending: Promise<FramescaperNativeImageSequenceDecodeClaim> | null;
	requestId: string | null;
	references: number;
	release: Promise<void> | null;
}

interface Occurrence {
	readonly key: string;
	readonly asset: AssetSnapshot;
	readonly source: SourceState;
	readonly canvas: HTMLCanvasElement;
	readonly lifetime: AbortController;
	presentation: VideoKeyframeOfflineSourcePresentation;
	ordinal: number | null;
	presenting: boolean;
	retired: boolean;
}

/** Decode each admitted source lazily, retain no full pack, and expose one canvas per clip occurrence. */
export function createFramescaperNativeImageSequenceSourceResolver(
	optionsValue: FramescaperNativeImageSequenceSourceResolverOptions,
): FramescaperNativeImageSequenceSourceResolver {
	const options = snapshotOptions(optionsValue);
	const sources = new Map<string, SourceState>();
	const occurrences = new Map<string, Occurrence>();
	const lifetime = new AbortController();
	const cancellation = new Set<Promise<unknown>>();
	let disposed = false;
	let disposePromise: Promise<void> | null = null;

	const resolveSource: VideoKeyframeOfflineSourceResolver = async (entryValue, requestValue) => {
		if (disposed) throw new Error('The native image-sequence source resolver is closed.');
		const signal = exactSignal(requestValue);
		throwIfAborted(signal);
		const binding = bindEntry(entryValue, options.assets);
		const current = occurrences.get(binding.key);
		if (current) {
			assertOccurrenceCurrent(current);
			return current.presentation;
		}
		let source = sources.get(binding.asset.sourceId);
		if (!source) {
			source = {
				asset: binding.asset, claim: null, pending: null,
				requestId: null, references: 0, release: null,
			};
			sources.set(binding.asset.sourceId, source);
		}
		const claim = await ensureClaim(source, signal);
		throwIfAborted(signal);
		if (disposed) throw abortError('Native image-sequence source resolution was disposed.');
		let canvas: HTMLCanvasElement;
		try { canvas = options.createCanvas(); }
		catch (error) {
			await releaseSource(source).catch((cleanup) => {
				throw new AggregateError([error, cleanup], 'Native image-sequence canvas setup and cleanup failed.', { cause: error });
			});
			throw error;
		}
		if (!canvas || typeof canvas !== 'object') {
			await releaseSource(source);
			throw new Error('Native image-sequence canvas creation failed.');
		}
		canvas.width = claim.width;
		canvas.height = claim.height;
		const occurrence: Occurrence = {
			key: binding.key, asset: binding.asset, source, canvas,
			lifetime: new AbortController(),
			presentation: null as unknown as VideoKeyframeOfflineSourcePresentation,
			ordinal: null, presenting: false, retired: false,
		};
		occurrence.presentation = presentationFor(occurrence);
		source.references += 1;
		occurrences.set(binding.key, occurrence);
		return occurrence.presentation;
	};

	async function ensureClaim(source: SourceState, signal: AbortSignal) {
		if (source.claim) return source.claim;
		if (source.pending) return source.pending;
		if (source.release) await source.release;
		const requestId = options.mintRequestId();
		if (!OPAQUE_ID.test(requestId)) throw new TypeError('The native image-sequence decode request ID is invalid.');
		source.requestId = requestId;
		const abortScope = abortSignals([signal, lifetime.signal]);
		const cancel = (): void => {
			const operation = options.bridge.cancelImageSequenceDecode({ requestId });
			track(cancellation, Promise.resolve(operation));
		};
		abortScope.signal.addEventListener('abort', cancel, { once: true });
		const pending = (async () => {
			let claim: FramescaperNativeImageSequenceDecodeClaim | null = null;
			try {
				const returned = await options.bridge.decodeImageSequenceSource({
					requestId, projectId: options.projectId,
					projectRevision: options.projectRevision, sourceId: source.asset.sourceId,
				});
				try { claim = exactClaim(returned, source.asset); }
				catch (error) {
					const claimId = returnedClaimId(returned);
					if (claimId === null) throw error;
					try { await options.bridge.releaseImageSequenceDecode({ claimId }); }
					catch (cleanup) {
						throw new AggregateError([error, cleanup], 'Invalid decode claim cleanup failed.', { cause: error });
					}
					throw error;
				}
				if (abortScope.signal.aborted || disposed) {
					await options.bridge.releaseImageSequenceDecode({ claimId: claim.claimId });
					throw abortError('Native image-sequence decode completed after its lifetime ended.');
				}
				source.claim = claim;
				return claim;
			} finally {
				abortScope.signal.removeEventListener('abort', cancel);
				abortScope.dispose();
				source.requestId = null;
			}
		})();
		source.pending = pending;
		try { return await pending; }
		finally {
			if (source.pending === pending) source.pending = null;
			if (!source.claim && source.references === 0) sources.delete(source.asset.sourceId);
		}
	}

	function presentationFor(occurrence: Occurrence): VideoKeyframeOfflineSourcePresentation {
		return Object.freeze({
			sourceId: occurrence.asset.sourceId,
			identity: occurrence.asset.identity,
			drawable: occurrence.canvas as unknown as TexImageSource,
			decodedWidth: occurrence.asset.decodedWidth,
			decodedHeight: occurrence.asset.decodedHeight,
			displayWidth: occurrence.asset.displayWidth,
			displayHeight: occurrence.asset.displayHeight,
			async present(
				entryValue: Readonly<Record<string, unknown>>,
				requestValue: Readonly<{ readonly signal: AbortSignal }>,
			): Promise<void> {
				assertOccurrenceCurrent(occurrence);
				if (occurrence.presenting) throw new Error('A native image-sequence occurrence cannot overlap presentations.');
				const binding = bindEntry(entryValue, options.assets);
				if (binding.asset !== occurrence.asset || binding.key !== occurrence.key) {
					throw new Error('The native image-sequence presentation received a different occurrence.');
				}
				const requestSignal = exactSignal(requestValue);
				const scope = abortSignals([requestSignal, lifetime.signal, occurrence.lifetime.signal]);
				occurrence.presenting = true;
				try {
					throwIfAborted(scope.signal);
					const descriptor = occurrence.asset.presentationForEntry(binding.entry);
					const ordinal = exactDescriptorOrdinal(descriptor, occurrence.asset);
					if (occurrence.ordinal === ordinal) return;
					const claim = occurrence.source.claim;
					if (!claim) throw new Error('The native image-sequence claim is no longer installed.');
					const rgba = await readFrame(claim, ordinal, options.bridge, scope.signal);
					throwIfAborted(scope.signal);
					assertOccurrenceCurrent(occurrence);
					options.writeRgba(occurrence.canvas, rgba, claim.width, claim.height);
					occurrence.ordinal = ordinal;
				} finally {
					occurrence.presenting = false;
					scope.dispose();
				}
			},
			dispose: () => retireOccurrence(occurrence),
		});
	}

	async function retireOccurrence(occurrence: Occurrence): Promise<void> {
		if (!occurrence.retired) {
			occurrence.retired = true;
			occurrence.lifetime.abort(abortError('Native image-sequence occurrence was retired.'));
			occurrence.canvas.width = 0;
			occurrence.canvas.height = 0;
			occurrences.delete(occurrence.key);
			occurrence.source.references -= 1;
		}
		if (occurrence.source.references === 0) await releaseSource(occurrence.source);
	}

	async function releaseSource(source: SourceState): Promise<void> {
		if (source.release) return source.release;
		const release = (async () => {
			if (source.pending) await source.pending.catch(() => undefined);
			const claim = source.claim;
			if (claim) await options.bridge.releaseImageSequenceDecode({ claimId: claim.claimId });
			source.claim = null;
			sources.delete(source.asset.sourceId);
		})();
		source.release = release.finally(() => { source.release = null; });
		return source.release;
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		if (disposed && sources.size === 0) return Promise.resolve();
		disposed = true;
		lifetime.abort(abortError('Native image-sequence source resolver was disposed.'));
		for (const occurrence of occurrences.values()) {
			occurrence.retired = true;
			occurrence.lifetime.abort(lifetime.signal.reason);
			occurrence.canvas.width = 0;
			occurrence.canvas.height = 0;
			occurrence.source.references = Math.max(0, occurrence.source.references - 1);
		}
		occurrences.clear();
		const operation = (async () => {
			await Promise.allSettled([...cancellation]);
			const results = await Promise.allSettled([...sources.values()].map(releaseSource));
			const failures = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected')
				.map(({ reason }) => reason);
			if (failures.length) throw new AggregateError(failures, 'Native image-sequence source cleanup failed.');
		})();
		disposePromise = operation.catch((error: unknown) => {
			disposePromise = null;
			throw error;
		});
		return disposePromise;
	}

	function assertOccurrenceCurrent(occurrence: Occurrence): void {
		if (disposed || occurrence.retired || occurrences.get(occurrence.key) !== occurrence) {
			throw new Error('The native image-sequence occurrence is no longer current.');
		}
	}

	return Object.freeze({ sourceIds: new Set(options.assets.keys()), resolveSource, dispose });
}

async function readFrame(
	claim: FramescaperNativeImageSequenceDecodeClaim,
	ordinal: number,
	bridge: FramescaperNativeImageSequenceSourceResolverOptions['bridge'],
	signal: AbortSignal,
): Promise<Uint8ClampedArray> {
	const frameBytes = safeProduct(claim.width, claim.height, 4);
	const headerOffset = safeAdd(HEADER_BYTES,
		safeProduct(ordinal, safeAdd(FRAME_HEADER_BYTES, frameBytes)));
	const header = await readExactRange(bridge, claim.claimId, headerOffset, FRAME_HEADER_BYTES, signal);
	const frame = new DataView(header.buffer, header.byteOffset, header.byteLength);
	if (safeBigInt(frame.getBigUint64(0, true), 'frame ordinal') !== ordinal
		|| safeSignedBigInt(frame.getBigInt64(8, true), 'frame timestamp') !== ordinal
		|| safeSignedBigInt(frame.getBigInt64(16, true), 'frame duration') !== 1
		|| safeBigInt(frame.getBigUint64(24, true), 'frame byte length') !== frameBytes) {
		throw new Error('The native image-sequence frame header changed exact ordinal, time, or extent.');
	}
	const frameOffset = safeAdd(headerOffset, FRAME_HEADER_BYTES);
	const output = new Uint8ClampedArray(frameBytes);
	for (let copied = 0; copied < frameBytes;) {
		throwIfAborted(signal);
		const length = Math.min(MAXIMUM_READ_BYTES, frameBytes - copied);
		const value = await readExactRange(bridge, claim.claimId, safeAdd(frameOffset, copied), length, signal);
		output.set(value, copied);
		copied += length;
	}
	return output;
}

async function readExactRange(
	bridge: FramescaperNativeImageSequenceSourceResolverOptions['bridge'],
	claimId: string, offset: number, length: number, signal: AbortSignal,
): Promise<Uint8Array> {
	throwIfAborted(signal);
	const value = await bridge.readImageSequenceDecode({ claimId, offset, length });
	if (!(value instanceof Uint8Array) || value.byteLength !== length) {
		throw new Error('The native image-sequence frame range was short or not binary.');
	}
	throwIfAborted(signal);
	return value;
}

function exactDescriptorOrdinal(descriptor: VideoRetimeFrameDescriptor, asset: AssetSnapshot): number {
	if (!descriptor || typeof descriptor !== 'object'
		|| !Number.isSafeInteger(descriptor.drawableSourceFrame)
		|| descriptor.drawableSourceFrame < 0 || descriptor.drawableSourceFrame >= asset.frameCount) {
		throw new RangeError('The native image-sequence drawable source frame is outside its inventory.');
	}
	const ordinal = descriptor.drawableSourceFrame;
	const start = exactTime(descriptor.drawableSourceStartTime, 'drawable source start');
	const end = exactTime(descriptor.drawableSourceEndTime, 'drawable source end');
	const source = exactTime(descriptor.sourceTime, 'source time');
	if (!equalRational(start, BigInt(ordinal) * BigInt(asset.frameRate.den), BigInt(asset.frameRate.num))
		|| !equalRational(end, BigInt(ordinal + 1) * BigInt(asset.frameRate.den), BigInt(asset.frameRate.num))
		|| compareRational(source, start) < 0 || compareRational(source, end) >= 0) {
		throw new Error('The native image-sequence descriptor changed exact rational frame timing.');
	}
	return ordinal;
}

function snapshotOptions(value: FramescaperNativeImageSequenceSourceResolverOptions) {
	if (!value || typeof value !== 'object' || !PROJECT_ID.test(value.projectId)
		|| !Number.isSafeInteger(value.projectRevision) || value.projectRevision < 0
		|| !value.bridge || ['decodeImageSequenceSource', 'cancelImageSequenceDecode',
			'readImageSequenceDecode', 'releaseImageSequenceDecode']
			.some((method) => typeof value.bridge[method as keyof typeof value.bridge] !== 'function')) {
		throw new TypeError('Native image-sequence source resolver options are incomplete.');
	}
	if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > MAXIMUM_SOURCE_COUNT) {
		throw new RangeError('Native image-sequence source inventory is outside its bound.');
	}
	const assets = new Map<string, AssetSnapshot>();
	let clipReferences = 0;
	for (const asset of value.sources) {
		if (!asset || typeof asset !== 'object' || !PROJECT_ID.test(asset.sourceId)
			|| !SHA256.test(asset.identity) || !['png', 'tif', 'tiff', 'exr'].includes(asset.extension)
			|| !Number.isSafeInteger(asset.frameCount) || asset.frameCount < 1
			|| !positiveRate(asset.frameRate) || typeof asset.presentationForEntry !== 'function'
			|| assets.has(asset.sourceId)) throw new TypeError('A native image-sequence source asset is invalid.');
		const clipIds = new Set(asset.clipIds);
		clipReferences += clipIds.size;
		if (!Array.isArray(asset.clipIds) || clipIds.size !== asset.clipIds.length || clipIds.size < 1
			|| clipReferences > MAXIMUM_CLIP_REFERENCES
			|| [...clipIds].some((id) => typeof id !== 'string' || id.length < 1 || id.length > 256)) {
			throw new RangeError('Native image-sequence clip authority is invalid.');
		}
		for (const dimension of [asset.decodedWidth, asset.decodedHeight, asset.displayWidth, asset.displayHeight]) {
			if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 65_536) {
				throw new RangeError('Native image-sequence source geometry is outside its bound.');
			}
		}
		assets.set(asset.sourceId, Object.freeze({ ...asset, clipIds }));
	}
	const createCanvas = value.createCanvas ?? (() => {
		if (!globalThis.document || typeof globalThis.document.createElement !== 'function') {
			throw new Error('Native image-sequence canvas support is unavailable.');
		}
		return globalThis.document.createElement('canvas');
	});
	const writeRgba = value.writeRgba ?? ((canvas, bytes, width, height) => {
		const context = canvas.getContext('2d', { alpha: true });
		if (!context) throw new Error('Native image-sequence 2D canvas support is unavailable.');
		const pixels = new Uint8ClampedArray(new ArrayBuffer(bytes.byteLength));
		pixels.set(bytes);
		context.putImageData(new ImageData(pixels, width, height), 0, 0);
	});
	const mintRequestId = value.mintRequestId ?? (() => {
		const bytes = new Uint8Array(20);
		globalThis.crypto.getRandomValues(bytes);
		return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	});
	if (typeof createCanvas !== 'function' || typeof writeRgba !== 'function' || typeof mintRequestId !== 'function') {
		throw new TypeError('Native image-sequence source resolver dependencies are invalid.');
	}
	return Object.freeze({
		projectId: value.projectId, projectRevision: value.projectRevision,
		bridge: value.bridge, assets, createCanvas, writeRgba, mintRequestId,
	});
}

function bindEntry(value: unknown, assets: ReadonlyMap<string, AssetSnapshot>) {
	const entry = record(value, 'native image-sequence frame entry');
	const sourceId = data(entry, 'sourceId', 'frame entry');
	const clipId = data(entry, 'clipId', 'frame entry');
	if (typeof sourceId !== 'string' || typeof clipId !== 'string') throw new TypeError('Frame entry IDs are invalid.');
	const asset = assets.get(sourceId);
	if (!asset || !asset.clipIds.has(clipId)) throw new Error('Frame entry is not bound to an admitted sequence occurrence.');
	const source = record(data(entry, 'source', 'frame entry'), 'frame source');
	const clip = record(data(entry, 'clip', 'frame entry'), 'frame clip');
	if (data(source, 'kind', 'frame source') !== 'video' || data(source, 'id', 'frame source') !== sourceId
		|| data(source, 'contentSha256', 'frame source') !== asset.identity
		|| data(clip, 'kind', 'frame clip') !== 'video' || data(clip, 'id', 'frame clip') !== clipId
		|| data(clip, 'sourceId', 'frame clip') !== sourceId) {
		throw new Error('Frame entry changed native image-sequence source or clip identity.');
	}
	return Object.freeze({ asset, entry, key: `${String(sourceId.length)}:${sourceId}${clipId}` });
}

function exactClaim(value: unknown, asset: AssetSnapshot): FramescaperNativeImageSequenceDecodeClaim {
	const claim = record(value, 'native image-sequence decode claim');
	const fields = ['claimId', 'sourceId', 'byteLength', 'sha256', 'frameCount', 'width', 'height', 'frameRate'];
	if (Reflect.ownKeys(claim).length !== fields.length
		|| Reflect.ownKeys(claim).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Native image-sequence decode claim contains unsupported authority.');
	}
	const rate = record(data(claim, 'frameRate', 'decode claim'), 'decode claim rate');
	const expectedBytes = safeAdd(HEADER_BYTES, safeProduct(asset.frameCount,
		safeAdd(FRAME_HEADER_BYTES, safeProduct(asset.decodedWidth, asset.decodedHeight, 4))));
	if (!OPAQUE_ID.test(String(data(claim, 'claimId', 'decode claim')))
		|| data(claim, 'sourceId', 'decode claim') !== asset.sourceId
		|| data(claim, 'byteLength', 'decode claim') !== expectedBytes
		|| !SHA256.test(String(data(claim, 'sha256', 'decode claim')))
		|| data(claim, 'frameCount', 'decode claim') !== asset.frameCount
		|| data(claim, 'width', 'decode claim') !== asset.decodedWidth
		|| data(claim, 'height', 'decode claim') !== asset.decodedHeight
		|| data(rate, 'num', 'decode claim rate') !== asset.frameRate.num
		|| data(rate, 'den', 'decode claim rate') !== asset.frameRate.den) {
		throw new Error('Native image-sequence decode claim changed authenticated source extent or rational rate.');
	}
	return value as FramescaperNativeImageSequenceDecodeClaim;
}

function returnedClaimId(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'claimId');
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& typeof descriptor.value === 'string' && OPAQUE_ID.test(descriptor.value)
		? descriptor.value : null;
}

function exactTime(value: unknown, name: string) {
	const time = record(value, name);
	const numerator = data(time, 'numerator', name);
	const denominator = data(time, 'denominator', name);
	if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || denominator <= 0n) {
		throw new TypeError(`Native image-sequence ${name} is not exact.`);
	}
	return Object.freeze({ numerator, denominator });
}

function equalRational(value: Readonly<{ numerator: bigint; denominator: bigint }>, numerator: bigint, denominator: bigint) {
	return value.numerator * denominator === numerator * value.denominator;
}
function compareRational(left: Readonly<{ numerator: bigint; denominator: bigint }>, right: Readonly<{ numerator: bigint; denominator: bigint }>) {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function abortSignals(signals: readonly AbortSignal[]) {
	const controller = new AbortController();
	const abort = (signal: AbortSignal): void => controller.abort(signal.reason ?? abortError('Operation was cancelled.'));
	const listeners = signals.map((signal) => {
		const listener = (): void => abort(signal);
		if (signal.aborted) abort(signal); else signal.addEventListener('abort', listener, { once: true });
		return Object.freeze({ signal, listener });
	});
	return Object.freeze({ signal: controller.signal, dispose: () => {
		for (const row of listeners) row.signal.removeEventListener('abort', row.listener);
	} });
}

function track(set: Set<Promise<unknown>>, promise: Promise<unknown>): void {
	set.add(promise);
	void promise.catch(() => undefined).finally(() => set.delete(promise));
}
function exactSignal(value: unknown): AbortSignal {
	const request = record(value, 'native image-sequence source request');
	const signal = data(request, 'signal', 'source request');
	if (!(signal instanceof AbortSignal)) throw new TypeError('Native image-sequence source request requires an AbortSignal.');
	return signal;
}
function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? abortError('Operation was cancelled.');
}
function abortError(message: string): DOMException { return new DOMException(message, 'AbortError'); }
function positiveRate(value: unknown): value is Readonly<{ num: number; den: number }> {
	return Boolean(value && typeof value === 'object'
		&& Number.isSafeInteger((value as { num?: unknown }).num) && Number((value as { num: number }).num) > 0
		&& Number.isSafeInteger((value as { den?: unknown }).den) && Number((value as { den: number }).den) > 0);
}
function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}
function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} is not own data.`);
	return descriptor.value;
}
function safeAdd(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
		|| left > Number.MAX_SAFE_INTEGER - right) throw new RangeError('Native image-sequence byte accounting overflowed.');
	return left + right;
}
function safeProduct(...values: number[]): number {
	return values.reduce((total, value) => {
		if (!Number.isSafeInteger(value) || value < 0 || (value && total > Number.MAX_SAFE_INTEGER / value)) {
			throw new RangeError('Native image-sequence byte accounting overflowed.');
		}
		return total * value;
	}, 1);
}
function safeBigInt(value: bigint, label: string): number {
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`Native image-sequence ${label} is too large.`);
	return Number(value);
}
function safeSignedBigInt(value: bigint, label: string): number {
	if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`Native image-sequence ${label} is too large.`);
	}
	return Number(value);
}
