/* SPDX-License-Identifier: AGPL-3.0-only */

/** Own one exact V12/V14 OpenFX attempt's staged files, MessagePorts, and cleanup. */

import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
	receiveHelperDataPlaneReservedFile,
	sendHelperDataPlaneFile,
	type HelperDataPlaneIoPort,
} from './helper-data-plane-io.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	type HelperDataPlaneBinding,
} from './helper-data-plane.ts';
import type { HelperDataPlaneOutputReservation } from './helper-data-plane-output-reservation.ts';
import type { HelperDataPlaneTransferPort } from './helper-data-plane-transfer.ts';
import type { HelperExecutableGrant } from './helper-contract.ts';
import type { FramescaperOpenFxExecutableDescriptor } from './framescaper-openfx-host-payload.ts';
import type { framescaperOpenFxExecutionRequestV1 } from './openfx-main-execution-request.ts';
import type { OfxUnifiedHostAttemptResourcesV1 } from './openfx-unified-render-execution.ts';
import {
	authenticateNativePlanVideoTimingAssetsV1OrV2,
	type NativePlanVideoTimingAssetBytes,
} from './native-services-video-timing-staging.ts';
import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';

const CONTROL_HEADROOM_BYTES = 64 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;

export interface PreparedOpenFxMainAttemptV1 {
	readonly resources: OfxUnifiedHostAttemptResourcesV1;
	finish(expected: Readonly<{ byteLength: number; sha256: string }> | null): Promise<Uint8Array | null>;
}

export interface OpenFxMainAttemptMessageChannelV1 {
	readonly hostPort: HelperDataPlaneIoPort;
	readonly helperPort: HelperDataPlaneTransferPort;
}

export interface PrepareOpenFxMainAttemptOptionsV1 {
	readonly request: ReturnType<typeof framescaperOpenFxExecutionRequestV1>;
	readonly pluginBinary: HelperExecutableGrant;
	readonly runtimeHost: FramescaperOpenFxExecutableDescriptor;
	readonly base: string;
	readonly createMessageChannel: () => OpenFxMainAttemptMessageChannelV1;
	readonly videoTimingAssets?: readonly NativePlanVideoTimingAssetBytes[];
	readonly mintOpaqueId?: () => string;
}

export async function prepareOpenFxMainAttemptV1(
	options: PrepareOpenFxMainAttemptOptionsV1,
): Promise<PreparedOpenFxMainAttemptV1> {
	options.request.signal?.throwIfAborted();
	const abort = new AbortController();
	const forwardAbort = (): void => abort.abort();
	if (options.request.signal?.aborted) abort.abort();
	else options.request.signal?.addEventListener('abort', forwardAbort, { once: true });
	const release = (): void => options.request.signal?.removeEventListener('abort', forwardAbort);
	const transfers: Array<Promise<unknown>> = [];
	try {
		const attempt = await prepareAt(options, abort, transfers, release);
		return attempt;
	} catch (error) {
		release();
		abort.abort();
		await Promise.allSettled(transfers);
		await rm(options.base, { recursive: true, force: true });
		throw error;
	}
}

async function prepareAt(
	options: PrepareOpenFxMainAttemptOptionsV1,
	abort: AbortController,
	transfers: Array<Promise<unknown>>,
	release: () => void,
): Promise<PreparedOpenFxMainAttemptV1> {
	const { request } = options;
	abort.signal.throwIfAborted();
	const helperRoot = join(options.base, 'helper');
	const hostRoot = join(options.base, 'host');
	await Promise.all([mkdir(helperRoot, { mode: 0o700 }), mkdir(hostRoot, { mode: 0o700 })]);
	abort.signal.throwIfAborted();
	const timing = authenticateNativePlanVideoTimingAssetsV1OrV2({
		plan: request.plan,
		assets: options.videoTimingAssets ?? [],
		maximumStagedBytes: HELPER_DATA_PLANE_MAXIMUM_BYTES,
	});
	const envelope = timing.envelope;
	const canonicalPlan = canonicalizeNativeMediaPlan(envelope.plan);
	const planPath = join(hostRoot, 'plan.json');
	await writeFile(planPath, canonicalPlan, { flag: 'wx', mode: 0o600 });
	const planBinding = binding(envelope.canonicalByteLength, envelope.fingerprint);
	const planChannel = options.createMessageChannel();
	transfers.push(sendHelperDataPlaneFile({
		binding: planBinding, port: planChannel.hostPort, path: planPath, signal: abort.signal,
	}));
	const timingResources = [];
	for (const [index, asset] of timing.timingAssets.entries()) {
		abort.signal.throwIfAborted();
		const path = join(hostRoot, `timing-${String(index).padStart(4, '0')}.scti`);
		await writeFile(path, asset.bytes, { flag: 'wx', mode: 0o600 });
		const timingBinding = binding(asset.bytes.byteLength, asset.input.sha256);
		const channel = options.createMessageChannel();
		transfers.push(sendHelperDataPlaneFile({
			binding: timingBinding, port: channel.hostPort, path, signal: abort.signal,
		}));
		timingResources.push(Object.freeze({
			role: 'video-timing' as const,
			binding: timingBinding,
			transfer: { streamId: timingBinding.streamId, port: channel.helperPort },
		}));
	}
	const inputResources = [];
	for (const [index, input] of request.inputs.entries()) {
		abort.signal.throwIfAborted();
		const path = join(hostRoot, `input-${String(index).padStart(2, '0')}.rgba`);
		await writeFile(path, input.rgba, { flag: 'wx', mode: 0o600 });
		const frame = binding(input.rgba.byteLength, digest(input.rgba));
		const channel = options.createMessageChannel();
		transfers.push(sendHelperDataPlaneFile({
			binding: frame, port: channel.hostPort, path, signal: abort.signal,
		}));
		inputResources.push(Object.freeze({
			name: input.name, sourceRef: input.sourceRef,
			pixelFormat: 'rgba8' as const, width: input.width, height: input.height,
			rowBytes: input.rowBytes, binding: frame,
			transfer: { streamId: frame.streamId, port: channel.helperPort },
		}));
	}
	abort.signal.throwIfAborted();
	const outputWidth = request.plan.output.canvas.width;
	const outputHeight = request.plan.output.canvas.height;
	const outputRowBytes = outputWidth * 4;
	const outputBytes = exactOutputBytes(outputRowBytes, outputHeight);
	const outputReservation: HelperDataPlaneOutputReservation = Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION, transport: 'message-port',
		streamId: opaqueId(), direction: 'helper-to-host', exactByteLength: outputBytes,
		maximumByteLength: outputBytes,
		maximumChunkBytes: Math.min(outputBytes, HELPER_DATA_CHUNK_MAXIMUM_BYTES),
		maximumInFlightChunks: 1,
	});
	const outputChannel = options.createMessageChannel();
	const outputPath = join(hostRoot, 'output.rgba');
	transfers.push(receiveHelperDataPlaneReservedFile({
		reservation: outputReservation, port: outputChannel.hostPort,
		path: outputPath, signal: abort.signal,
	}));
	const helperDetails = await lstat(helperRoot);
	if (!helperDetails.isDirectory() || helperDetails.isSymbolicLink()) {
		throw new Error('The OpenFX helper scratch reservation changed during staging.');
	}
	const scratchBytes = envelope.canonicalByteLength + outputBytes
		+ timing.timingAssets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0)
		+ request.inputs.reduce((sum, input) => sum + input.rgba.byteLength, 0)
		+ options.pluginBinary.bytes + CONTROL_HEADROOM_BYTES;
	const mint = options.mintOpaqueId ?? opaqueId;
	const resources: OfxUnifiedHostAttemptResourcesV1 = Object.freeze({
		invocationId: `ofx-${mint()}`, abortSignalId: `abort-${mint()}`,
		outputOrdinal: request.outputOrdinal,
		executable: executableGrant('ofx-host', options.runtimeHost),
		pluginBinary: options.pluginBinary,
		retimerSourceTime: request.retimerSourceTime,
		plan: { binding: planBinding,
			transfer: { streamId: planBinding.streamId, port: planChannel.helperPort } },
		...(timingResources.length === 0 ? {} : {
			videoTimingAssets: Object.freeze(timingResources),
		}),
		inputs: Object.freeze(inputResources),
		output: {
			pixelFormat: 'rgba8' as const, width: outputWidth,
			height: outputHeight, rowBytes: outputRowBytes,
			binding: outputReservation,
			transfer: { streamId: outputReservation.streamId, port: outputChannel.helperPort },
		},
		scratch: {
			rootPath: helperRoot,
			rootIdentity: Object.freeze({ dev: helperDetails.dev, ino: helperDetails.ino }),
			reservationId: mint(), maximumBytes: scratchBytes,
		},
	});
	let finished = false;
	return Object.freeze({
		resources,
		finish: async (expected: Readonly<{ byteLength: number; sha256: string }> | null) => {
			if (finished) return null;
			finished = true;
			if (expected === null) abort.abort();
			const settled = await Promise.allSettled(transfers);
			try {
				if (expected === null) return null;
				const failure = settled.find((entry) => entry.status === 'rejected');
				if (failure) throw failure.reason;
				const bytes = new Uint8Array(await readFile(outputPath));
				if (bytes.byteLength !== expected.byteLength || digest(bytes) !== expected.sha256) {
					throw new Error('The OpenFX rendered frame changed after its exact completion.');
				}
				return bytes;
			} finally {
				release();
				await rm(options.base, { recursive: true, force: true });
			}
		},
	});
}

function executableGrant(
	role: 'ofx-host',
	value: FramescaperOpenFxExecutableDescriptor,
): HelperExecutableGrant {
	return Object.freeze({
		role, path: value.path, bytes: value.byteLength, sha256: value.sha256,
		identity: value.identity,
	});
}

function binding(byteLength: number, sha256: string): HelperDataPlaneBinding {
	if (!Number.isSafeInteger(byteLength) || byteLength < 1 || !SHA256.test(sha256)) {
		throw new TypeError('An OpenFX data-plane binding has invalid exact bytes.');
	}
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION, transport: 'message-port',
		streamId: opaqueId(), direction: 'host-to-helper', byteLength, sha256,
		maximumChunkBytes: Math.min(byteLength, HELPER_DATA_CHUNK_MAXIMUM_BYTES),
		maximumInFlightChunks: 1,
	});
}

function exactOutputBytes(rowBytes: number, height: number): number {
	const value = rowBytes * height;
	if (!Number.isSafeInteger(value) || value < 1 || value > 256 * 1024 * 1024) {
		throw new RangeError('An OpenFX output exceeds the exact bounded RGBA frame domain.');
	}
	return value;
}

function opaqueId(): string { return randomBytes(20).toString('hex'); }
function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
