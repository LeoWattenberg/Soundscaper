/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from './ffmpeg-output-stream.ts';

export interface ManagedVideoKeyframeOutputSink<Output> {
	readonly value: FfmpegOutputSink<Output>;
	abort(primary: unknown): Promise<unknown>;
}

/** Snapshot sink method authority before acquiring producer or FFmpeg ownership. */
export function manageVideoKeyframeOutputSink<Output>(
	value: FfmpegOutputSink<Output>,
): ManagedVideoKeyframeOutputSink<Output> {
	const open = dataMethod(value, 'open', 'Video keyframe output sink');
	const write = dataMethod(value, 'write', 'Video keyframe output sink');
	const close = dataMethod(value, 'close', 'Video keyframe output sink');
	const abort = dataMethod(value, 'abort', 'Video keyframe output sink');
	let abortAttempted = false;
	const admitted: FfmpegOutputSink<Output> = Object.freeze({
		async open(exactByteLength: number): Promise<void> {
			await Reflect.apply(open, value, [exactByteLength]);
		},
		async write(chunk: Uint8Array): Promise<void> {
			await Reflect.apply(write, value, [chunk]);
		},
		async close(): Promise<Output> {
			return await Reflect.apply(close, value, []) as Output;
		},
		async abort(reason?: unknown): Promise<void> {
			if (abortAttempted) return;
			abortAttempted = true;
			await Reflect.apply(abort, value, [reason]);
		},
	});
	return Object.freeze({
		value: admitted,
		async abort(primary: unknown): Promise<unknown> {
			if (abortAttempted) return primary;
			try {
				await admitted.abort(primary);
				return primary;
			} catch (cleanup) {
				return new AggregateError(
					[primary, cleanup],
					'Video keyframe encoding failed and its output sink could not be aborted.',
				);
			}
		},
	});
}

function dataMethod(
	value: unknown,
	key: 'abort' | 'close' | 'open' | 'write',
	name: string,
): (...arguments_: never[]) => unknown {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError(`${name} must be an object.`);
	}
	let owner: object | null = value;
	while (owner) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
				throw new TypeError(`${name}.${key} must be a data property function.`);
			}
			return descriptor.value as (...arguments_: never[]) => unknown;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError(`${name}.${key} must be a data property function.`);
}
