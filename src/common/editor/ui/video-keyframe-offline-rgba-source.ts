/* SPDX-License-Identifier: AGPL-3.0-only */

import { planVideoPreviewCapture } from '../video-preview-capture-admission.ts';

export interface VideoKeyframeOfflineDrawableSource {
	readonly drawable: TexImageSource;
	readonly videoWidth: number;
	readonly videoHeight: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly readyState: number;
}

export interface VideoKeyframeOfflineSourcePresentation {
	readonly sourceId: string;
	readonly identity: string;
	readonly drawable: TexImageSource;
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
	dispose(): PromiseLike<void> | void;
	present(
		entry: Readonly<Record<string, unknown>>,
		options: Readonly<{ readonly signal: AbortSignal }>,
	): PromiseLike<void> | void;
}

export type VideoKeyframeOfflineSourceResolver = (
	entry: Readonly<Record<string, unknown>>,
	options: Readonly<{ readonly signal: AbortSignal }>,
) => PromiseLike<VideoKeyframeOfflineSourcePresentation> | VideoKeyframeOfflineSourcePresentation;

interface SourceRecord {
	readonly occurrenceKey: string;
	readonly sourceId: string;
	readonly identity: string;
	readonly presentation: VideoKeyframeOfflineSourcePresentation;
	readonly drawable: VideoKeyframeOfflineDrawableSource;
	readonly decodedRgbaBytes: number;
}

interface SourceAuthority {
	readonly identity: string;
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
}

interface PresentationSnapshot extends SourceAuthority {
	readonly sourceId: string;
	readonly drawable: TexImageSource;
	readonly original: VideoKeyframeOfflineSourcePresentation;
	readonly decodedRgbaBytes: number;
	readonly present: VideoKeyframeOfflineSourcePresentation['present'];
	readonly dispose: VideoKeyframeOfflineSourcePresentation['dispose'];
}

type CleanupResult = Readonly<{ readonly ok: true }>
	| Readonly<{ readonly ok: false; readonly error: unknown }>;

export const VIDEO_KEYFRAME_OFFLINE_MAXIMUM_PINNED_OCCURRENCES = 32;
export const VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RETAINED_RGBA_BYTES = 256 * 1024 * 1024;
export const VIDEO_KEYFRAME_OFFLINE_MAXIMUM_SOURCE_AUTHORITIES = 4_096;

/** Own bounded occurrence lifecycles while retaining immutable per-source authority. */
export class VideoKeyframeOfflineSourceCache {
	readonly #records = new Map<string, SourceRecord>();
	readonly #authorities = new Map<string, SourceAuthority>();
	readonly #pins = new Set<string>();
	#retainedRgbaBytes = 0;
	#active = false;
	#frameActive = false;
	#disposeRequested = false;
	#disposed = false;
	#disposePromise: Promise<void> | null = null;

	constructor(readonly resolveSource: VideoKeyframeOfflineSourceResolver) {
		if (typeof resolveSource !== 'function') {
			throw new TypeError('An offline video source resolver is required.');
		}
	}

	beginFrame(): void {
		if (this.#disposeRequested || this.#disposed) {
			throw new Error('The offline video source cache is closed.');
		}
		if (this.#frameActive || this.#active) {
			throw new Error('The offline video source cache already has an active frame.');
		}
		this.#pins.clear();
		this.#frameActive = true;
	}

	/** Frame cleanup is deliberately synchronous and cannot mask render failures. */
	finishFrame(): void {
		this.#pins.clear();
		this.#frameActive = false;
	}

	async present(
		entryValue: unknown,
		signal: AbortSignal,
	): Promise<VideoKeyframeOfflineDrawableSource> {
		if (this.#disposeRequested || this.#disposed) {
			throw new Error('The offline video source cache is closed.');
		}
		if (!this.#frameActive) throw new Error('The offline video source cache requires an active frame.');
		if (this.#active) throw new Error('The offline video source cache cannot overlap presentations.');
		const entry = record(entryValue, 'offline video layer entry');
		const sourceId = boundedId(
			data(entry, 'sourceId', 'offline video layer entry'),
			'offline video layer entry.sourceId',
		);
		const clipId = boundedId(
			data(entry, 'clipId', 'offline video layer entry'),
			'offline video layer entry.clipId',
		);
		const occurrenceKey = occurrenceIdentity(clipId, sourceId);
		if (this.#pins.has(occurrenceKey)) {
			throw new Error('The offline video frame contains a duplicate source occurrence.');
		}
		if (this.#pins.size >= VIDEO_KEYFRAME_OFFLINE_MAXIMUM_PINNED_OCCURRENCES) {
			throw new RangeError('The offline video frame exceeds its pinned source occurrence limit.');
		}
		this.#pins.add(occurrenceKey);
		this.#active = true;
		let resolved: unknown;
		let hasResolved = false;
		let incomingOwned = true;
		let failureRecord: SourceRecord | null = null;
		try {
			throwIfAborted(signal);
			resolved = await this.resolveSource(entry, Object.freeze({ signal }));
			hasResolved = true;
			const presentation = snapshotPresentation(resolved);
			throwIfAborted(signal);
			const current = this.#records.get(occurrenceKey);
			if (current?.presentation === presentation.original) {
				incomingOwned = false;
				failureRecord = current;
			}
			if (presentation.sourceId !== sourceId) {
				throw new RangeError('The offline video source resolver returned a different source ID.');
			}
			const authority = this.#assertAuthority(sourceId, presentation);
			if (current !== undefined) {
				if (current.presentation !== presentation.original) {
					throw new Error('The offline video source resolver replaced a source occurrence lifecycle.');
				}
				assertCurrentRecord(current, presentation);
				await current.presentation.present(entry, Object.freeze({ signal }));
				throwIfAborted(signal);
				this.#touch(current);
				failureRecord = null;
				return current.drawable;
			}
			this.#assertDistinctDrawable(occurrenceKey, presentation.drawable);
			await this.#makeCapacity(presentation.decodedRgbaBytes);
			if (authority === undefined) this.#authorities.set(sourceId, authorityFor(presentation));
			const stored: SourceRecord = Object.freeze({
				occurrenceKey,
				sourceId,
				identity: presentation.identity,
				presentation: presentation.original,
				drawable: createDrawableSource(presentation),
				decodedRgbaBytes: presentation.decodedRgbaBytes,
			});
			this.#records.set(occurrenceKey, stored);
			this.#retainedRgbaBytes += stored.decodedRgbaBytes;
			incomingOwned = false;
			failureRecord = stored;
			await presentation.present(entry, Object.freeze({ signal }));
			throwIfAborted(signal);
			failureRecord = null;
			return stored.drawable;
		} catch (error) {
			if (failureRecord !== null) throw await this.#failureWithRecordCleanup(error, failureRecord);
			if (hasResolved && incomingOwned) throw await failureWithRejectedCleanup(error, resolved);
			throw error;
		} finally {
			this.#active = false;
		}
	}

	dispose(): Promise<void> {
		if (this.#disposed) return Promise.resolve();
		if (this.#active || this.#frameActive) {
			return Promise.reject(new Error('The offline video source cache is rendering a presentation.'));
		}
		if (this.#disposePromise !== null) return this.#disposePromise;
		this.#disposeRequested = true;
		const operation = (async () => {
			const failures: unknown[] = [];
			for (const record of [...this.#records.values()]) {
				const cleanup = await attemptCleanup(record.presentation.dispose.bind(record.presentation));
				if (cleanup.ok) this.#remove(record);
				else failures.push(cleanup.error);
			}
			if (failures.length > 0) {
				throw new AggregateError(failures, 'Offline video source cleanup failed.');
			}
			this.#authorities.clear();
			this.#pins.clear();
			this.#disposed = true;
		})();
		this.#disposePromise = operation.catch((error: unknown) => {
			this.#disposePromise = null;
			throw error;
		});
		return this.#disposePromise;
	}

	#assertAuthority(sourceId: string, presentation: PresentationSnapshot): SourceAuthority | undefined {
		const authority = this.#authorities.get(sourceId);
		if (authority === undefined) {
			if (this.#authorities.size >= VIDEO_KEYFRAME_OFFLINE_MAXIMUM_SOURCE_AUTHORITIES) {
				throw new RangeError('Offline video source authorities exceed their hard limit.');
			}
			return undefined;
		}
		if (!sameAuthority(authority, presentation)) {
			throw new Error('An offline video source identity changed during the export snapshot.');
		}
		return authority;
	}

	#assertDistinctDrawable(occurrenceKey: string, drawable: TexImageSource): void {
		for (const record of this.#records.values()) {
			if (record.occurrenceKey !== occurrenceKey && record.presentation.drawable === drawable) {
				throw new Error('Offline video source occurrences must own distinct drawable lifecycles.');
			}
		}
	}

	async #makeCapacity(incomingBytes: number): Promise<void> {
		while (this.#records.size >= VIDEO_KEYFRAME_OFFLINE_MAXIMUM_PINNED_OCCURRENCES
			|| this.#retainedRgbaBytes + incomingBytes > VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RETAINED_RGBA_BYTES) {
			const victim = [...this.#records.values()].find(
				(record) => !this.#pins.has(record.occurrenceKey),
			);
			if (victim === undefined) {
				throw new RangeError('Offline video pinned occurrences exceed aggregate decoded RGBA capacity.');
			}
			const cleanup = await attemptCleanup(victim.presentation.dispose.bind(victim.presentation));
			if (!cleanup.ok) throw cleanup.error;
			this.#remove(victim);
		}
	}

	async #failureWithRecordCleanup(primary: unknown, record: SourceRecord): Promise<unknown> {
		const cleanup = await attemptCleanup(record.presentation.dispose.bind(record.presentation));
		if (cleanup.ok) {
			this.#remove(record);
			return primary;
		}
		return aggregateFailure(primary, cleanup.error);
	}

	#touch(record: SourceRecord): void {
		if (this.#records.get(record.occurrenceKey) !== record) return;
		this.#records.delete(record.occurrenceKey);
		this.#records.set(record.occurrenceKey, record);
	}

	#remove(record: SourceRecord): void {
		if (this.#records.get(record.occurrenceKey) !== record) return;
		this.#records.delete(record.occurrenceKey);
		this.#retainedRgbaBytes -= record.decodedRgbaBytes;
	}
}

function snapshotPresentation(value: unknown): PresentationSnapshot {
	const candidate = record(value, 'offline video source presentation');
	const keys = new Set([
		'sourceId', 'identity', 'drawable', 'decodedWidth', 'decodedHeight',
		'displayWidth', 'displayHeight', 'present', 'dispose',
	]);
	for (const key of Reflect.ownKeys(candidate)) {
		if (typeof key !== 'string' || !keys.has(key)) {
			throw new TypeError('The offline video source presentation has an unsupported field.');
		}
	}
	const sourceId = boundedId(
		data(candidate, 'sourceId', 'offline video source presentation'),
		'offline video source presentation.sourceId',
	);
	const identity = boundedId(
		data(candidate, 'identity', 'offline video source presentation'),
		'offline video source presentation.identity',
	);
	const drawable = data(candidate, 'drawable', 'offline video source presentation') as TexImageSource;
	if (!drawable || (typeof drawable !== 'object' && typeof drawable !== 'function')) {
		throw new TypeError('The offline video source presentation requires a drawable source.');
	}
	const decodedWidth = dimension(
		data(candidate, 'decodedWidth', 'offline video source presentation'), 'decodedWidth',
	);
	const decodedHeight = dimension(
		data(candidate, 'decodedHeight', 'offline video source presentation'), 'decodedHeight',
	);
	const displayWidth = dimension(
		data(candidate, 'displayWidth', 'offline video source presentation'), 'displayWidth',
	);
	const displayHeight = dimension(
		data(candidate, 'displayHeight', 'offline video source presentation'), 'displayHeight',
	);
	const decodedRgbaBig = BigInt(decodedWidth) * BigInt(decodedHeight) * 4n;
	if (decodedRgbaBig > BigInt(VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RETAINED_RGBA_BYTES)) {
		throw new RangeError('Offline video source decoded RGBA bytes exceed their hard limit.');
	}
	planVideoPreviewCapture({ sourceWidth: decodedWidth, sourceHeight: decodedHeight });
	const present = functionValue<VideoKeyframeOfflineSourcePresentation['present']>(
		data(candidate, 'present', 'offline video source presentation'), 'present',
	).bind(value);
	const dispose = functionValue<VideoKeyframeOfflineSourcePresentation['dispose']>(
		data(candidate, 'dispose', 'offline video source presentation'), 'dispose',
	).bind(value);
	return Object.freeze({
		sourceId, identity, drawable, decodedWidth, decodedHeight, displayWidth, displayHeight,
		decodedRgbaBytes: Number(decodedRgbaBig),
		present, dispose, original: value as VideoKeyframeOfflineSourcePresentation,
	});
}

function createDrawableSource(presentation: PresentationSnapshot) {
	return Object.freeze(Object.create(null, {
		readyState: { enumerable: true, value: 4 },
		videoWidth: { enumerable: true, value: presentation.decodedWidth },
		videoHeight: { enumerable: true, value: presentation.decodedHeight },
		displayWidth: { enumerable: true, value: presentation.displayWidth },
		displayHeight: { enumerable: true, value: presentation.displayHeight },
		drawable: { enumerable: false, value: presentation.drawable },
	})) as VideoKeyframeOfflineDrawableSource;
}

function authorityFor(presentation: PresentationSnapshot): SourceAuthority {
	return Object.freeze({
		identity: presentation.identity,
		decodedWidth: presentation.decodedWidth,
		decodedHeight: presentation.decodedHeight,
		displayWidth: presentation.displayWidth,
		displayHeight: presentation.displayHeight,
	});
}

function sameAuthority(left: SourceAuthority, right: SourceAuthority): boolean {
	return left.identity === right.identity
		&& left.decodedWidth === right.decodedWidth
		&& left.decodedHeight === right.decodedHeight
		&& left.displayWidth === right.displayWidth
		&& left.displayHeight === right.displayHeight;
}

function assertCurrentRecord(record: SourceRecord, presentation: PresentationSnapshot): void {
	if (record.sourceId !== presentation.sourceId
		|| record.identity !== presentation.identity
		|| record.presentation.drawable !== presentation.drawable
		|| record.drawable.videoWidth !== presentation.decodedWidth
		|| record.drawable.videoHeight !== presentation.decodedHeight
		|| record.drawable.displayWidth !== presentation.displayWidth
		|| record.drawable.displayHeight !== presentation.displayHeight
		|| record.decodedRgbaBytes !== presentation.decodedRgbaBytes) {
		throw new Error('An offline video source occurrence changed during the export snapshot.');
	}
}

function occurrenceIdentity(clipId: string, sourceId: string): string {
	return `${String(clipId.length)}:${clipId}${sourceId}`;
}

async function failureWithRejectedCleanup(primary: unknown, value: unknown): Promise<unknown> {
	const dispose = candidateDisposer(value);
	if (dispose === null) return primary;
	const cleanup = await attemptCleanup(dispose);
	return cleanup.ok ? primary : aggregateFailure(primary, cleanup.error);
}

function candidateDisposer(value: unknown): (() => PromiseLike<void> | void) | null {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'dispose');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'function') return null;
	return descriptor.value.bind(value) as () => PromiseLike<void> | void;
}

async function attemptCleanup(dispose: () => PromiseLike<void> | void): Promise<CleanupResult> {
	try {
		await dispose();
		return Object.freeze({ ok: true });
	} catch (error) {
		return Object.freeze({ ok: false, error });
	}
}

function aggregateFailure(primary: unknown, cleanup: unknown): AggregateError {
	return new AggregateError(
		[primary, cleanup],
		'Offline video source operation and cleanup did not both succeed.',
		{ cause: primary },
	);
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a record.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function data(value: Readonly<Record<string, unknown>>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function boundedId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`${name} must be a bounded nonempty string.`);
	}
	return value;
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`Offline video source ${name} is outside its hard limit.`);
	}
	return Number(value);
}

function functionValue<Value extends (...args: never[]) => unknown>(value: unknown, name: string): Value {
	if (typeof value !== 'function') throw new TypeError(`Offline video source ${name} must be a function.`);
	return value as Value;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw new DOMException('The offline video frame render was cancelled.', 'AbortError');
}
