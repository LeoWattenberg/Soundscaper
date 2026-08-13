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
	readonly identity: string;
	readonly presentation: VideoKeyframeOfflineSourcePresentation;
	readonly drawable: VideoKeyframeOfflineDrawableSource;
}

interface SourceAuthority {
	readonly identity: string;
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
}

/** Own and authenticate one stable presentation lifecycle per canonical source ID. */
export class VideoKeyframeOfflineSourceCache {
	readonly #records = new Map<string, SourceRecord>();
	readonly #authorities = new Map<string, SourceAuthority>();
	#active = false;
	#disposed = false;

	constructor(readonly resolveSource: VideoKeyframeOfflineSourceResolver) {
		if (typeof resolveSource !== 'function') {
			throw new TypeError('An offline video source resolver is required.');
		}
	}

	async present(
		entryValue: unknown,
		signal: AbortSignal,
	): Promise<VideoKeyframeOfflineDrawableSource> {
		if (this.#disposed) throw new Error('The offline video source cache is closed.');
		if (this.#active) throw new Error('The offline video source cache cannot overlap presentations.');
		this.#active = true;
		try {
			throwIfAborted(signal);
			const entry = record(entryValue, 'offline video layer entry');
			const sourceId = boundedId(entry.sourceId, 'offline video layer entry.sourceId');
			const resolved = await this.resolveSource(entry, Object.freeze({ signal }));
			const presentation = snapshotPresentation(resolved);
			let cacheOwned = false;
			let retained = false;
			try {
				throwIfAborted(signal);
				const current = this.#records.get(sourceId);
				cacheOwned = current?.presentation === presentation.original;
				if (presentation.sourceId !== sourceId) {
					throw new RangeError('The offline video source resolver returned a different source ID.');
				}
				const authority = this.#authorities.get(sourceId);
				if (authority !== undefined && (
					authority.identity !== presentation.identity
					|| authority.decodedWidth !== presentation.decodedWidth
					|| authority.decodedHeight !== presentation.decodedHeight
					|| authority.displayWidth !== presentation.displayWidth
					|| authority.displayHeight !== presentation.displayHeight
				)) {
					throw new Error('An offline video source identity changed during the export snapshot.');
				}
				if (current !== undefined) {
					if (cacheOwned) {
						await current.presentation.present(entry, Object.freeze({ signal }));
						throwIfAborted(signal);
						return current.drawable;
					}
					if (current.identity !== presentation.identity
						|| current.presentation.drawable !== presentation.drawable
						|| current.drawable.videoWidth !== presentation.decodedWidth
						|| current.drawable.videoHeight !== presentation.decodedHeight
						|| current.drawable.displayWidth !== presentation.displayWidth
						|| current.drawable.displayHeight !== presentation.displayHeight) {
						throw new Error('An offline video source identity changed during the export snapshot.');
					}
					throw new Error('The offline video source resolver replaced a source lifecycle during export.');
				}
				const drawable = createDrawableSource(presentation);
				if (authority === undefined) this.#authorities.set(sourceId, Object.freeze({
					identity: presentation.identity,
					decodedWidth: presentation.decodedWidth,
					decodedHeight: presentation.decodedHeight,
					displayWidth: presentation.displayWidth,
					displayHeight: presentation.displayHeight,
				}));
				const stored = Object.freeze({
					identity: presentation.identity,
					presentation: presentation.original,
					drawable,
				});
				this.#records.set(sourceId, stored);
				retained = true;
				await presentation.present(entry, Object.freeze({ signal }));
				throwIfAborted(signal);
				return drawable;
			} catch (error) {
				if (retained) {
					this.#records.delete(sourceId);
					await disposeIgnoringFailure(presentation.dispose);
				} else if (cacheOwned) {
					this.#records.delete(sourceId);
					await disposeIgnoringFailure(presentation.dispose);
				} else await disposeIgnoringFailure(presentation.dispose);
				throw error;
			}
		} finally {
			this.#active = false;
		}
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		if (this.#active) throw new Error('The offline video source cache is rendering a presentation.');
		this.#disposed = true;
		const records = [...this.#records.values()];
		this.#records.clear();
		this.#authorities.clear();
		const failures: unknown[] = [];
		for (const { presentation } of records) {
			try { await presentation.dispose(); } catch (error) { failures.push(error); }
		}
		if (failures.length > 0) throw new AggregateError(failures, 'Offline video source cleanup failed.');
	}
}

function snapshotPresentation(value: unknown) {
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
	const sourceId = boundedId(data(candidate, 'sourceId'), 'offline video source presentation.sourceId');
	const identity = boundedId(data(candidate, 'identity'), 'offline video source presentation.identity');
	const drawable = data(candidate, 'drawable') as TexImageSource;
	if (!drawable || (typeof drawable !== 'object' && typeof drawable !== 'function')) {
		throw new TypeError('The offline video source presentation requires a drawable source.');
	}
	const decodedWidth = dimension(data(candidate, 'decodedWidth'), 'decodedWidth');
	const decodedHeight = dimension(data(candidate, 'decodedHeight'), 'decodedHeight');
	const displayWidth = dimension(data(candidate, 'displayWidth'), 'displayWidth');
	const displayHeight = dimension(data(candidate, 'displayHeight'), 'displayHeight');
	planVideoPreviewCapture({ sourceWidth: decodedWidth, sourceHeight: decodedHeight });
	const present = functionValue<VideoKeyframeOfflineSourcePresentation['present']>(
		data(candidate, 'present'), 'present',
	).bind(value);
	const dispose = functionValue<VideoKeyframeOfflineSourcePresentation['dispose']>(
		data(candidate, 'dispose'), 'dispose',
	).bind(value);
	return {
		sourceId, identity, drawable, decodedWidth, decodedHeight, displayWidth, displayHeight,
		present, dispose, original: value as VideoKeyframeOfflineSourcePresentation,
	};
}

function createDrawableSource(presentation: ReturnType<typeof snapshotPresentation>) {
	return Object.freeze(Object.create(null, {
		readyState: { enumerable: true, value: 4 },
		videoWidth: { enumerable: true, value: presentation.decodedWidth },
		videoHeight: { enumerable: true, value: presentation.decodedHeight },
		displayWidth: { enumerable: true, value: presentation.displayWidth },
		displayHeight: { enumerable: true, value: presentation.displayHeight },
		drawable: { enumerable: false, value: presentation.drawable },
	})) as VideoKeyframeOfflineDrawableSource;
}

async function disposeIgnoringFailure(dispose: () => PromiseLike<void> | void): Promise<void> {
	try { await dispose(); } catch { /* Preserve the primary admission or render failure. */ }
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`offline video source presentation.${key} must be an enumerable data property.`);
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
