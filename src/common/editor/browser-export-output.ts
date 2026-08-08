/* SPDX-License-Identifier: AGPL-3.0-only */

export const BROWSER_EXPORT_BLOB_MAXIMUM_BYTES = 512 * 1024 * 1024;

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface FfmpegWholeFileSource {
	statFile(
		path: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Awaitable<unknown>;
	readFile(
		path: string,
		encoding?: unknown,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Awaitable<unknown>;
}

export interface BoundedFfmpegOutputOptions {
	readonly assertCurrent?: () => void;
	readonly label?: string;
	readonly maximumBytes?: unknown;
	readonly signal?: AbortSignal | null;
}

/** Guard the renderer-owned whole-file fallback below one frozen, lower-only ceiling. */
export function assertBrowserExportOutputSize(
	byteLength: unknown,
	label = 'Browser export',
	maximumBytes?: unknown,
): number {
	const normalizedMaximum = normalizeMaximumBytes(maximumBytes);
	if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new RangeError(`${label} byte length must be a safe non-negative integer.`);
	}
	if (byteLength > normalizedMaximum) {
		throw new RangeError(
			`${label} output is ${byteLength} bytes; the browser Blob fallback maximum is ${normalizedMaximum} bytes.`,
		);
	}
	return byteLength;
}

/** Stat and admit an FFmpeg output before asking its worker to materialize the whole file. */
export async function readBoundedFfmpegOutputFile(
	source: FfmpegWholeFileSource,
	path: string,
	options: BoundedFfmpegOutputOptions = {},
): Promise<Uint8Array> {
	validateSource(source);
	validatePath(path);
	const label = typeof options.label === 'string' && options.label.length > 0
		? options.label
		: 'Browser export';
	const maximumBytes = normalizeMaximumBytes(options.maximumBytes);
	assertReady(options);
	const stat = await source.statFile(path, signalOptions(options.signal));
	assertReady(options);
	const byteLength = statByteLength(stat, label, maximumBytes);
	const output = await source.readFile(path, undefined, signalOptions(options.signal));
	assertReady(options);
	if (!(output instanceof Uint8Array)) {
		throw new TypeError(`${label} FFmpeg output must be Uint8Array bytes.`);
	}
	if (output.byteLength !== byteLength) {
		throw new Error(
			`${label} FFmpeg output changed after admission: expected ${byteLength} bytes, received ${output.byteLength}.`,
		);
	}
	return output;
}

function normalizeMaximumBytes(value: unknown): number {
	const normalized = value === undefined ? BROWSER_EXPORT_BLOB_MAXIMUM_BYTES : value;
	if (
		typeof normalized !== 'number'
		|| !Number.isSafeInteger(normalized)
		|| normalized <= 0
		|| normalized > BROWSER_EXPORT_BLOB_MAXIMUM_BYTES
	) {
		throw new RangeError(
			`browser export maximumBytes must be a positive safe integer no greater than ${BROWSER_EXPORT_BLOB_MAXIMUM_BYTES}.`,
		);
	}
	return normalized;
}

function statByteLength(stat: unknown, label: string, maximumBytes: number): number {
	if (!stat || typeof stat !== 'object') {
		throw new TypeError(`${label} FFmpeg output stat must be an object with an own size.`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(stat, 'size');
	if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
		throw new TypeError(`${label} FFmpeg output stat must have an own data size.`);
	}
	return assertBrowserExportOutputSize(descriptor.value, label, maximumBytes);
}

function validateSource(source: FfmpegWholeFileSource): void {
	if (!source || typeof source.statFile !== 'function' || typeof source.readFile !== 'function') {
		throw new TypeError('Expected an FFmpeg output source with statFile and readFile methods.');
	}
}

function validatePath(path: string): void {
	if (typeof path !== 'string' || path.length === 0 || path.includes('\u0000')) {
		throw new TypeError('Expected a non-empty FFmpeg output path without NUL bytes.');
	}
}

function assertReady(options: BoundedFfmpegOutputOptions): void {
	if (options.signal?.aborted) throw options.signal.reason ?? abortError();
	options.assertCurrent?.();
}

function signalOptions(
	signal: AbortSignal | null | undefined,
): Readonly<{ signal?: AbortSignal }> | undefined {
	return signal ? { signal } : undefined;
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
