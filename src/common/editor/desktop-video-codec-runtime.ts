/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer adapter from the bounded keyframe lease to opaque main-process video sessions. */

import {
	DESKTOP_VIDEO_CODEC_MAXIMUM_INPUT_CHUNK_BYTES,
	DESKTOP_VIDEO_CODEC_MAXIMUM_OUTPUT_CHUNK_BYTES,
	normalizeDesktopVideoCodecOperationPlan,
} from '../../../desktop/desktop-video-codec-operation-contract.ts';
import {
	runVideoKeyframeEncoderOperation,
	type VideoKeyframeEncoderOperationLease,
	type VideoKeyframeEncoderOperationOptions,
	type VideoKeyframeVideoEditorFfmpeg,
	type VideoKeyframeFfmpegOperationHost,
} from './video-keyframe-ffmpeg-operation.ts';
import type { VideoKeyframeFfmpegInputStream } from './video-keyframe-encoder-stream.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;
type DesktopVideoInputRole = 'video' | 'audio';

export interface DesktopVideoCodecRendererBridge {
	begin(plan: unknown): Awaitable<unknown>;
	write(request: unknown): Awaitable<unknown>;
	close(request: unknown): Awaitable<unknown>;
	execute(request: unknown): Awaitable<unknown>;
	stat(request: unknown): Awaitable<unknown>;
	read(request: unknown): Awaitable<unknown>;
	delete(request: unknown): Awaitable<unknown>;
	cancel(operationId: string): Awaitable<unknown>;
}

interface SessionContext {
	readonly operationId: string;
	readonly videoInputPath: string;
	readonly audioInputPath?: string;
	readonly outputPath: string;
	readonly ffmpegArguments: readonly string[];
	readonly videoCapacityBytes: number;
	readonly audioCapacityBytes: number | null;
}

const OPERATION_ID = /^desktop-video-[a-f0-9]{32}$/u;

export function createDesktopVideoCodecOperationRunner(
	bridgeValue: DesktopVideoCodecRendererBridge,
): VideoKeyframeVideoEditorFfmpeg['runVideoKeyframeEncoderOperation'] {
	const bridge = normalizeBridge(bridgeValue);
	return <Output>(
		operation: (lease: VideoKeyframeEncoderOperationLease) => Awaitable<Output>,
		options: VideoKeyframeEncoderOperationOptions = {},
	): Promise<Output> => {
		const contextValue = options.desktopExternalFfmpeg;
		if (!contextValue) {
			return Promise.reject(new Error(
				'Desktop external FFmpeg video requires an admitted raw-keyframe session plan.',
			));
		}
		const plan = normalizeDesktopVideoCodecOperationPlan(contextValue.plan);
		const local = Object.freeze({
			videoInputPath: contextValue.videoInputPath,
			...(contextValue.audioInputPath ? { audioInputPath: contextValue.audioInputPath } : {}),
			outputPath: contextValue.outputPath,
			ffmpegArguments: Object.freeze([...contextValue.ffmpegArguments]),
		});
		return runVideoKeyframeEncoderOperation(
			createOperationHost(bridge, plan, local, options.signal), operation, options,
		);
	};
}

function createOperationHost(
	bridge: DesktopVideoCodecRendererBridge,
	plan: ReturnType<typeof normalizeDesktopVideoCodecOperationPlan>,
	local: Readonly<{
		readonly videoInputPath: string;
		readonly audioInputPath?: string;
		readonly outputPath: string;
		readonly ffmpegArguments: readonly string[];
	}>,
	signal: AbortSignal | undefined,
): VideoKeyframeFfmpegOperationHost {
	let session: SessionContext | null = null;
	let terminated = false;
	return Object.freeze({
		async run<Output>(operation: (runtime: RawRuntime) => Awaitable<Output>, beforeLoad?: () => void) {
			beforeLoad?.();
			throwIfAborted(signal);
			const begun = await bridge.begin(plan);
			const operationId = beginOperationId(begun);
			session = Object.freeze({
				operationId,
				...local,
				videoCapacityBytes: plan.ringCapacityBytes,
				audioCapacityBytes: plan.audioRingCapacityBytes,
			});
			const onAbort = (): void => {
				terminated = true;
				void Promise.resolve(bridge.cancel(operationId)).catch(() => undefined);
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			try {
				throwIfAborted(signal);
				return await operation(createRawRuntime(bridge, session, () => terminated));
			} finally {
				signal?.removeEventListener('abort', onAbort);
				await Promise.resolve(bridge.cancel(operationId)).catch(() => false);
			}
		},
		terminateRuntime() {
			terminated = true;
			if (session) void Promise.resolve(bridge.cancel(session.operationId)).catch(() => undefined);
		},
		isRuntimeTerminated() { return terminated; },
	});
}

interface RawRuntime {
	createInputStream: VideoKeyframeEncoderOperationLease['createInputStream'];
	exec: VideoKeyframeEncoderOperationLease['exec'];
	statFile: VideoKeyframeEncoderOperationLease['statFile'];
	readFileRange: VideoKeyframeEncoderOperationLease['readFileRange'];
	deleteFile: VideoKeyframeEncoderOperationLease['deleteFile'];
}

function createRawRuntime(
	bridge: DesktopVideoCodecRendererBridge,
	session: SessionContext,
	isTerminated: () => boolean,
): RawRuntime {
	const opened = new Set<DesktopVideoInputRole>();
	return Object.freeze({
		createInputStream(
			path: Parameters<RawRuntime['createInputStream']>[0],
			capacityBytes: Parameters<RawRuntime['createInputStream']>[1],
			options: Parameters<RawRuntime['createInputStream']>[2],
		) {
			assertSignal(options?.signal);
			const role = inputRole(session, path, capacityBytes);
			if (opened.has(role)) throw new Error(`Desktop video ${role} input stream is already open.`);
			opened.add(role);
			return createInputStream(bridge, session.operationId, role, path, capacityBytes!, isTerminated);
		},
		async exec(
			arguments_: Parameters<RawRuntime['exec']>[0],
			timeout: Parameters<RawRuntime['exec']>[1],
			options: Parameters<RawRuntime['exec']>[2],
		) {
			assertSignal(options?.signal);
			if (timeout !== undefined && timeout !== -1) {
				throw new RangeError('Desktop video execution timeout is main-owned.');
			}
			if (!sameArguments(arguments_, session.ffmpegArguments)) {
				throw new Error('Desktop video execution did not use its exact admitted command.');
			}
			throwIfAborted(options?.signal);
			const result = record(await bridge.execute({ operationId: session.operationId }), 'execute result');
			if (result.exitCode !== 0 || Reflect.ownKeys(result).length !== 1) {
				throw new TypeError('Desktop video execute result is invalid.');
			}
			return 0;
		},
		async statFile(
			path: Parameters<RawRuntime['statFile']>[0],
			options: Parameters<RawRuntime['statFile']>[1],
		) {
			assertOutputPath(session, path); assertSignal(options?.signal); throwIfAborted(options?.signal);
			const result = record(await bridge.stat({ operationId: session.operationId }), 'stat result');
			if (!Number.isSafeInteger(result.byteLength) || Number(result.byteLength) < 1
				|| Reflect.ownKeys(result).length !== 1) throw new TypeError('Desktop video stat result is invalid.');
			return Object.freeze({ size: Number(result.byteLength) });
		},
		async readFileRange(
			path: Parameters<RawRuntime['readFileRange']>[0],
			offset: Parameters<RawRuntime['readFileRange']>[1],
			maximumBytes: Parameters<RawRuntime['readFileRange']>[2],
			options: Parameters<RawRuntime['readFileRange']>[3],
		) {
			assertOutputPath(session, path); assertSignal(options?.signal); throwIfAborted(options?.signal);
			if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maximumBytes)
				|| maximumBytes < 1 || maximumBytes > DESKTOP_VIDEO_CODEC_MAXIMUM_OUTPUT_CHUNK_BYTES) {
				throw new RangeError('Desktop video output range is invalid.');
			}
			const bytes = await bridge.read({ operationId: session.operationId, offset, maximumBytes });
			if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
				throw new TypeError('Desktop video output range result is invalid.');
			}
			return bytes;
		},
		async deleteFile(
			path: Parameters<RawRuntime['deleteFile']>[0],
			options: Parameters<RawRuntime['deleteFile']>[1],
		) {
			assertOutputPath(session, path); assertSignal(options?.signal); throwIfAborted(options?.signal);
			if (await bridge.delete({ operationId: session.operationId }) !== true) {
				throw new Error('Desktop video output deletion was not acknowledged.');
			}
		},
	});
}

function createInputStream(
	bridge: DesktopVideoCodecRendererBridge,
	operationId: string,
	role: DesktopVideoInputRole,
	path: string,
	capacityBytes: number,
	isTerminated: () => boolean,
): VideoKeyframeFfmpegInputStream {
	let offset = 0;
	let closed = false;
	let aborted = false;
	return Object.freeze({
		path, capacityBytes,
		async write(
			data: Parameters<VideoKeyframeFfmpegInputStream['write']>[0],
			options: Parameters<VideoKeyframeFfmpegInputStream['write']>[1],
		) {
			assertSignal(options?.signal); assertStreamActive();
			if (!(data instanceof Uint8Array) || data.byteLength < 1) throw new TypeError('Desktop video input bytes are invalid.');
			for (let start = 0; start < data.byteLength; start += DESKTOP_VIDEO_CODEC_MAXIMUM_INPUT_CHUNK_BYTES) {
				throwIfAborted(options?.signal);
				const bytes = data.slice(start, Math.min(data.byteLength, start + DESKTOP_VIDEO_CODEC_MAXIMUM_INPUT_CHUNK_BYTES));
				const result = record(await bridge.write({ operationId, role, offset, bytes }), 'input write result');
				const next = offset + bytes.byteLength;
				if (result.offset !== next || Reflect.ownKeys(result).length !== 1) {
					throw new Error('Desktop video input write acknowledgement drifted.');
				}
				offset = next;
			}
		},
		async close() {
			assertStreamActive();
			const result = record(await bridge.close({ operationId, role, offset }), 'input close result');
			if (result.offset !== offset || Reflect.ownKeys(result).length !== 1) {
				throw new Error('Desktop video input close acknowledgement drifted.');
			}
			closed = true;
		},
		abort() {
			if (closed || aborted) return;
			aborted = true;
			void Promise.resolve(bridge.cancel(operationId)).catch(() => undefined);
		},
		async dispose() {
			if (!closed && !aborted) {
				aborted = true;
				await Promise.resolve(bridge.cancel(operationId));
			}
		},
	});
	function assertStreamActive(): void {
		if (closed || aborted || isTerminated()) throw new Error('Desktop video input stream is no longer active.');
	}
}

function inputRole(session: SessionContext, path: string, capacity: number | undefined): DesktopVideoInputRole {
	if (path === session.videoInputPath && capacity === session.videoCapacityBytes) return 'video';
	if (path === session.audioInputPath && capacity === session.audioCapacityBytes) return 'audio';
	throw new Error('Desktop video input path or capacity did not match its admitted role.');
}

function assertOutputPath(session: SessionContext, path: string): void {
	if (path !== session.outputPath) throw new Error('Desktop video output path did not match its admitted role.');
}

function sameArguments(left: readonly string[], right: readonly string[]): boolean {
	return Array.isArray(left) && left.length === right.length
		&& left.every((argument, index) => argument === right[index]);
}

function beginOperationId(value: unknown): string {
	const result = record(value, 'begin result');
	if (typeof result.operationId !== 'string' || !OPERATION_ID.test(result.operationId)
		|| Reflect.ownKeys(result).length !== 1) throw new TypeError('Desktop video begin result is invalid.');
	return result.operationId;
}

function normalizeBridge(value: DesktopVideoCodecRendererBridge): DesktopVideoCodecRendererBridge {
	const methods = ['begin', 'write', 'close', 'execute', 'stat', 'read', 'delete', 'cancel'] as const;
	const result: Record<string, (...arguments_: unknown[]) => unknown> = {};
	for (const method of methods) {
		const candidate = value?.[method];
		if (typeof candidate !== 'function') throw new TypeError(`Desktop video bridge.${method} is unavailable.`);
		result[method] = (...arguments_: unknown[]) => Reflect.apply(candidate, value, arguments_);
	}
	return Object.freeze(result) as unknown as DesktopVideoCodecRendererBridge;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
		throw new TypeError(`Desktop video ${label} is invalid.`);
	}
	return value as Record<string, unknown>;
}

function assertSignal(value: AbortSignal | undefined): void {
	if (value !== undefined && !(value instanceof AbortSignal)) throw new TypeError('Desktop video signal is invalid.');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
