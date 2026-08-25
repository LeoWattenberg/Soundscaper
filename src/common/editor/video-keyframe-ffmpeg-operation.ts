/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputFileSource } from './ffmpeg-output-stream.ts';
import type {
	VideoKeyframeEncoderFfmpegPort,
	VideoKeyframeFfmpegInputStream,
} from './video-keyframe-encoder-stream.ts';
import type { DesktopVideoCodecOperationPlan } from '../../../desktop/desktop-video-codec-operation-contract.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface VideoKeyframeEncoderOperationLease
	extends VideoKeyframeEncoderFfmpegPort, FfmpegOutputFileSource {
	deleteFile(path: string, options?: Readonly<{ signal?: AbortSignal }>): Awaitable<unknown>;
	isExecutionTerminated(): boolean;
}

export interface VideoKeyframeEncoderOperationOptions {
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	/** Renderer-local correlation only; its paths and argv never cross desktop IPC. */
	readonly desktopExternalFfmpeg?: Readonly<{
		readonly plan: DesktopVideoCodecOperationPlan;
		readonly videoInputPath: string;
		readonly audioInputPath?: string;
		readonly outputPath: string;
		readonly ffmpegArguments: readonly string[];
	}>;
}

export interface VideoKeyframeVideoEditorFfmpeg {
	runVideoKeyframeEncoderOperation<Output>(
		operation: (lease: VideoKeyframeEncoderOperationLease) => Awaitable<Output>,
		options?: VideoKeyframeEncoderOperationOptions,
	): Awaitable<Output>;
}

interface RawVideoKeyframeFfmpegRuntime {
	createInputStream: VideoKeyframeEncoderOperationLease['createInputStream'];
	exec: VideoKeyframeEncoderOperationLease['exec'];
	statFile: VideoKeyframeEncoderOperationLease['statFile'];
	readFileRange: VideoKeyframeEncoderOperationLease['readFileRange'];
	deleteFile: VideoKeyframeEncoderOperationLease['deleteFile'];
}

export interface VideoKeyframeFfmpegOperationHost {
	run<Output>(
		operation: (runtime: RawVideoKeyframeFfmpegRuntime) => Awaitable<Output>,
		beforeLoad?: () => void,
	): Promise<Output>;
	terminateRuntime(): void;
	isRuntimeTerminated(runtime: RawVideoKeyframeFfmpegRuntime): boolean;
}

export function createVideoKeyframeEncoderOperationRunner(
	run: VideoKeyframeFfmpegOperationHost['run'],
	terminateRuntime: VideoKeyframeFfmpegOperationHost['terminateRuntime'],
	isRuntimeTerminated: VideoKeyframeFfmpegOperationHost['isRuntimeTerminated'],
) {
	const host: VideoKeyframeFfmpegOperationHost = Object.freeze({
		run,
		terminateRuntime,
		isRuntimeTerminated,
	});
	return <Output>(
		operation: (lease: VideoKeyframeEncoderOperationLease) => Awaitable<Output>,
		options?: VideoKeyframeEncoderOperationOptions,
	): Promise<Output> => runVideoKeyframeEncoderOperation(host, operation, options);
}

/** Lend one generation-scoped raw runtime only for the duration of its queued callback. */
export function runVideoKeyframeEncoderOperation<Output>(
	host: VideoKeyframeFfmpegOperationHost,
	operation: (lease: VideoKeyframeEncoderOperationLease) => Awaitable<Output>,
	options: VideoKeyframeEncoderOperationOptions = {},
): Promise<Output> {
	if (typeof operation !== 'function') {
		throw new TypeError('Video keyframe encoder operation callback must be a function.');
	}
	const admittedHost = normalizeHost(host);
	const settings = normalizeOptions(options);
	try { assertReady(settings); } catch (error) { return Promise.reject(error); }
	return admittedHost.run(async (runtimeValue) => {
		assertReady(settings);
		const runtime = normalizeRuntime(runtimeValue);
		let active = true;
		let terminationRequested = false;
		const pendingCalls = new Set<Promise<unknown>>();
		const openStreams = new Set<VideoKeyframeFfmpegInputStream>();
		const assertLease = (): void => {
			if (!active) throw new Error('The video keyframe FFmpeg operation lease is no longer active.');
		};
		const assertUsable = (): void => {
			assertLease();
			if (admittedHost.isRuntimeTerminated(runtimeValue)) {
				throw new Error('The video keyframe FFmpeg operation lease runtime was terminated.');
			}
		};
		const track = <Value>(call: () => Awaitable<Value>): Promise<Value> => {
			assertUsable();
			const pending = Promise.resolve().then(call);
			pendingCalls.add(pending);
			void pending.then(
				() => pendingCalls.delete(pending),
				() => pendingCalls.delete(pending),
			);
			return pending;
		};
		const incomplete = (): boolean => pendingCalls.size > 0 || openStreams.size > 0;
		const retireIncomplete = (primary: unknown): unknown => {
			if (!incomplete()) return primary;
			try {
				if (!admittedHost.isRuntimeTerminated(runtimeValue)) admittedHost.terminateRuntime();
				return primary;
			} catch (terminationFailure) {
				return new AggregateError(
					[primary, terminationFailure],
					'Video keyframe FFmpeg operation and incomplete-scope termination both failed.',
				);
			}
		};
		const lease: VideoKeyframeEncoderOperationLease = {
			createInputStream(path, capacityBytes, streamOptions) {
				return track(async () => normalizeInputStream(
					await runtime.createInputStream(path, capacityBytes, streamOptions),
					assertLease,
					() => admittedHost.isRuntimeTerminated(runtimeValue),
					track,
					openStreams,
				));
			},
			exec(arguments_, timeout, executionOptions) {
				return track(() => runtime.exec(arguments_, timeout, executionOptions));
			},
			statFile(path, statOptions) {
				return track(() => runtime.statFile(path, statOptions));
			},
			readFileRange(path, offset, maximumBytes, readOptions) {
				return track(() => runtime.readFileRange(path, offset, maximumBytes, readOptions));
			},
			deleteFile(path, deleteOptions) {
				return track(() => runtime.deleteFile(path, deleteOptions));
			},
			terminateExecution() {
				assertLease();
				terminationRequested = true;
				if (!admittedHost.isRuntimeTerminated(runtimeValue)) admittedHost.terminateRuntime();
			},
			isExecutionTerminated() {
				assertLease();
				return admittedHost.isRuntimeTerminated(runtimeValue);
			},
		};
		Object.freeze(lease);
		try {
			const result = await operation(lease);
			assertReady(settings);
			if (incomplete()) {
				throw new Error(
					'Video keyframe FFmpeg operation returned with outstanding calls or undisposed input streams.',
				);
			}
			assertLease();
			if (terminationRequested) {
				throw new Error('The video keyframe FFmpeg operation lease runtime was terminated.');
			}
			return result;
		} catch (error) {
			throw retireIncomplete(error);
		} finally {
			active = false;
		}
	}, () => assertReady(settings));
}

function normalizeOptions(
	value: VideoKeyframeEncoderOperationOptions,
): VideoKeyframeEncoderOperationOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Video keyframe encoder operation options must be a plain object.');
	}
	const admitted: {
		signal?: AbortSignal;
		assertCurrent?: () => void;
		desktopExternalFfmpeg?: VideoKeyframeEncoderOperationOptions['desktopExternalFfmpeg'];
	} = {};
	for (const key of Reflect.ownKeys(value)) {
		if (key !== 'signal' && key !== 'assertCurrent' && key !== 'desktopExternalFfmpeg') {
			throw new TypeError('Video keyframe encoder operation options have an unsupported field.');
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Video keyframe encoder operation options.${String(key)} must be an own data property.`);
		}
		if (key === 'signal') admitted.signal = descriptor.value as AbortSignal | undefined;
		else if (key === 'assertCurrent') admitted.assertCurrent = descriptor.value as (() => void) | undefined;
		else admitted.desktopExternalFfmpeg = normalizeDesktopContext(descriptor.value);
	}
	if (admitted.signal !== undefined
		&& (typeof AbortSignal !== 'function' || !(admitted.signal instanceof AbortSignal))) {
		throw new TypeError('Video keyframe encoder operation signal must be an AbortSignal.');
	}
	if (admitted.assertCurrent !== undefined && typeof admitted.assertCurrent !== 'function') {
		throw new TypeError('Video keyframe encoder operation assertCurrent must be a function.');
	}
	return Object.freeze(admitted);
}

function normalizeDesktopContext(
	value: unknown,
): NonNullable<VideoKeyframeEncoderOperationOptions['desktopExternalFfmpeg']> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || ![
			'plan', 'videoInputPath', 'audioInputPath', 'outputPath', 'ffmpegArguments',
		].includes(key))) {
		throw new TypeError('Desktop external FFmpeg video operation context is invalid.');
	}
	const context = value as Record<string, unknown>;
	for (const key of Reflect.ownKeys(context)) ownDataValue(context, String(key), 'Desktop external FFmpeg video context');
	const videoInputPath = ownDataValue(context, 'videoInputPath', 'Desktop external FFmpeg video context');
	const outputPath = ownDataValue(context, 'outputPath', 'Desktop external FFmpeg video context');
	const audioInputPath = Object.hasOwn(context, 'audioInputPath')
		? ownDataValue(context, 'audioInputPath', 'Desktop external FFmpeg video context') : undefined;
	const ffmpegArguments = ownDataValue(context, 'ffmpegArguments', 'Desktop external FFmpeg video context');
	if (typeof videoInputPath !== 'string' || typeof outputPath !== 'string'
		|| audioInputPath !== undefined && typeof audioInputPath !== 'string'
		|| !Array.isArray(ffmpegArguments)
		|| ffmpegArguments.some((argument) => typeof argument !== 'string')) {
		throw new TypeError('Desktop external FFmpeg video operation context is malformed.');
	}
	return Object.freeze({
		plan: ownDataValue(context, 'plan', 'Desktop external FFmpeg video context') as DesktopVideoCodecOperationPlan,
		videoInputPath,
		...(audioInputPath === undefined ? {} : { audioInputPath }),
		outputPath,
		ffmpegArguments: Object.freeze([...ffmpegArguments] as string[]),
	});
}

function normalizeHost(value: VideoKeyframeFfmpegOperationHost): VideoKeyframeFfmpegOperationHost {
	const run = ownDataFunction(value, 'run', 'Video keyframe FFmpeg operation host');
	const terminateRuntime = ownDataFunction(
		value, 'terminateRuntime', 'Video keyframe FFmpeg operation host',
	);
	const isRuntimeTerminated = ownDataFunction(
		value, 'isRuntimeTerminated', 'Video keyframe FFmpeg operation host',
	);
	return Object.freeze({
		run<Output>(operation: (runtime: RawVideoKeyframeFfmpegRuntime) => Awaitable<Output>, beforeLoad?: () => void) {
			return Reflect.apply(run, value, [operation, beforeLoad]) as Promise<Output>;
		},
		terminateRuntime() { Reflect.apply(terminateRuntime, value, []); },
		isRuntimeTerminated(runtime: RawVideoKeyframeFfmpegRuntime) {
			return Reflect.apply(isRuntimeTerminated, value, [runtime]) as boolean;
		},
	});
}

function normalizeRuntime(value: RawVideoKeyframeFfmpegRuntime): RawVideoKeyframeFfmpegRuntime {
	return Object.freeze({
		createInputStream: inheritedDataFunction(
			value, 'createInputStream', 'Video keyframe FFmpeg runtime',
		) as RawVideoKeyframeFfmpegRuntime['createInputStream'],
		exec: inheritedDataFunction(
			value, 'exec', 'Video keyframe FFmpeg runtime',
		) as RawVideoKeyframeFfmpegRuntime['exec'],
		statFile: inheritedDataFunction(
			value, 'statFile', 'Video keyframe FFmpeg runtime',
		) as RawVideoKeyframeFfmpegRuntime['statFile'],
		readFileRange: inheritedDataFunction(
			value, 'readFileRange', 'Video keyframe FFmpeg runtime',
		) as RawVideoKeyframeFfmpegRuntime['readFileRange'],
		deleteFile: inheritedDataFunction(
			value, 'deleteFile', 'Video keyframe FFmpeg runtime',
		) as RawVideoKeyframeFfmpegRuntime['deleteFile'],
	});
}

function normalizeInputStream(
	value: VideoKeyframeFfmpegInputStream,
	assertLease: () => void,
	isRuntimeGone: () => boolean,
	track: <Value>(call: () => Awaitable<Value>) => Promise<Value>,
	openStreams: Set<VideoKeyframeFfmpegInputStream>,
): VideoKeyframeFfmpegInputStream {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Video keyframe FFmpeg input stream must be an object.');
	}
	const path = ownDataValue(value, 'path', 'Video keyframe FFmpeg input stream');
	const capacityBytes = ownDataValue(value, 'capacityBytes', 'Video keyframe FFmpeg input stream');
	if (typeof path !== 'string' || typeof capacityBytes !== 'number'
		|| !Number.isSafeInteger(capacityBytes)) {
		throw new TypeError('Video keyframe FFmpeg input stream has invalid reservation metadata.');
	}
	const write = ownDataFunction(value, 'write', 'Video keyframe FFmpeg input stream');
	const close = ownDataFunction(value, 'close', 'Video keyframe FFmpeg input stream');
	const abort = ownDataFunction(value, 'abort', 'Video keyframe FFmpeg input stream');
	const dispose = ownDataFunction(value, 'dispose', 'Video keyframe FFmpeg input stream');
	const admitted: VideoKeyframeFfmpegInputStream = {
		path,
		capacityBytes,
		write(data, options) {
			return track<void>(() => Reflect.apply(write, value, [data, options]) as Awaitable<void>);
		},
		close() { return track<void>(() => Reflect.apply(close, value, []) as Awaitable<void>); },
		// Aborting and disposing are the two calls that stay legal after the
		// runtime is gone. Writing to a terminated runtime is a defect worth a
		// refusal; tearing down what it already tore down is not, and refusing
		// that turned every failure the engine had already unwound — a user's own
		// cancel included — into an AggregateError the caller could no longer
		// recognize as an abort.
		abort(reason) {
			assertLease();
			if (isRuntimeGone()) return;
			Reflect.apply(abort, value, [reason]);
		},
		dispose() {
			if (isRuntimeGone()) {
				openStreams.delete(admitted);
				return Promise.resolve();
			}
			return track<void>(() => Reflect.apply(dispose, value, []) as Awaitable<void>).then(() => {
				openStreams.delete(admitted);
			});
		},
	};
	openStreams.add(admitted);
	return Object.freeze(admitted);
}

function ownDataFunction(value: unknown, key: string, name: string): (...args: never[]) => unknown {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError(`${name} must be an object.`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
		throw new TypeError(`${name}.${key} must be an own data property function.`);
	}
	return descriptor.value as (...args: never[]) => unknown;
}

function ownDataValue(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own data property.`);
	}
	return descriptor.value;
}

function inheritedDataFunction(value: unknown, key: string, name: string): (...args: never[]) => unknown {
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
			return descriptor.value.bind(value) as (...args: never[]) => unknown;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError(`${name}.${key} must be a data property function.`);
}

function assertReady(options: VideoKeyframeEncoderOperationOptions): void {
	if (options.signal?.aborted) throw options.signal.reason ?? abortError();
	options.assertCurrent?.();
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
