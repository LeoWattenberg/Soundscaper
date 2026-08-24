/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated main-owned resource observations for writer-atomic queue admission. */

import { mkdir, statfs } from 'node:fs/promises';
import { availableParallelism, freemem } from 'node:os';
import { isAbsolute } from 'node:path';

import {
	nativeQueueCapacitySnapshotV1,
	type NativeQueueCapacityV1,
} from '../src/common/editor/native-queue-admission.ts';
import {
	assertNativeQueueRecordV3,
	type NativeQueueRecordV3,
} from '../src/common/editor/native-queue-record-v3.ts';
import { computeNativeScratchQuota } from '../src/common/editor/native-scratch-policy.ts';
import type {
	FramescaperNativeScratchReservation,
} from './native-services-scratch-repository.ts';

export interface FramescaperNativeQueueCapacityContextV3 {
	readonly queue: readonly NativeQueueRecordV3[];
	readonly scratch: readonly FramescaperNativeScratchReservation[];
}

export type FramescaperNativeQueueCapacityProviderV3 = (
	context: FramescaperNativeQueueCapacityContextV3,
) => Promise<NativeQueueCapacityV1>;

export interface FramescaperNativeQueueCapacityProviderV3Options {
	readonly scratchRoot: string;
	readonly availableParallelism?: () => number;
	readonly freeMemory?: () => number;
	readonly configuredConcurrency?: () => number | undefined;
	readonly inspectScratchVolume?: (scratchRoot: string) => Promise<Readonly<{
		readonly totalBytes: number;
		readonly freeBytes: number;
	}>>;
}

/**
 * Create the production sampler. Physical observations are read for every
 * admission; durable reservations are supplied only by the fenced runtime.
 */
export function createFramescaperNativeQueueCapacityProviderV3(
	options: FramescaperNativeQueueCapacityProviderV3Options,
): FramescaperNativeQueueCapacityProviderV3 {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| typeof options.scratchRoot !== 'string' || !isAbsolute(options.scratchRoot)
		|| options.scratchRoot.includes('\0')) {
		throw new TypeError('A native queue capacity provider requires an absolute scratch root.');
	}
	const parallelism = options.availableParallelism ?? availableParallelism;
	const freeMemory = options.freeMemory ?? freemem;
	const inspectVolume = options.inspectScratchVolume ?? inspectScratchVolume;
	if (typeof parallelism !== 'function' || typeof freeMemory !== 'function'
		|| typeof inspectVolume !== 'function'
		|| (options.configuredConcurrency !== undefined
			&& typeof options.configuredConcurrency !== 'function')) {
		throw new TypeError('A native queue capacity provider requires exact observation ports.');
	}

	return async (context): Promise<NativeQueueCapacityV1> => {
		const queue = queueRecords(context?.queue);
		const scratch = scratchReservations(context?.scratch);
		const running = queue.filter((record) => record.state === 'running');
		const cpuCores = positiveInteger(parallelism(), 'host parallelism');
		const freeRssBytes = nonNegativeInteger(freeMemory(), 'host free memory');
		const volume = await inspectVolume(options.scratchRoot);
		const totalBytes = nonNegativeInteger(volume?.totalBytes, 'scratch volume bytes');
		const observedFreeBytes = nonNegativeInteger(volume?.freeBytes, 'scratch free bytes');
		if (observedFreeBytes > totalBytes) {
			throw new RangeError('A native queue scratch volume cannot report more free bytes than it has.');
		}
		const committedScratch = committedScratchBytes(running, scratch);
		const unreservedFreeBytes = Math.max(0, observedFreeBytes - committedScratch);
		const scratchQuota = computeNativeScratchQuota({
			totalBytes,
			freeBytes: unreservedFreeBytes,
			managedBytes: committedScratch,
		});
		const snapshot = {
			...(options.configuredConcurrency === undefined
				? {} : { configuredConcurrency: options.configuredConcurrency() }),
			availableCpuCores: Math.max(0, cpuCores - sum(
				running.map(({ reservations }) => reservations.cpuCores), 'running CPU reservations',
			)),
			availableProcessTreeRssBytes: Math.max(0, freeRssBytes - sum(
				running.map(({ reservations }) => reservations.processTreeRssBytes),
				'running RSS reservations',
			)),
			availableScratchBytes: scratchQuota.availableBytes,
			volumeFreeBytes: unreservedFreeBytes,
			reservedFreeBytes: scratchQuota.requiredFreeBytes,
			busyHardwareBackends: [...new Set(running.flatMap(({ reservations }) => (
				reservations.hardwareBackend === null ? [] : [reservations.hardwareBackend]
			)))].sort(),
		};
		return nativeQueueCapacitySnapshotV1(snapshot);
	};
}

function queueRecords(value: unknown): readonly NativeQueueRecordV3[] {
	if (!Array.isArray(value)) throw new TypeError('A native queue capacity context requires queue rows.');
	for (const record of value) assertNativeQueueRecordV3(record);
	return value as readonly NativeQueueRecordV3[];
}

function scratchReservations(value: unknown): readonly FramescaperNativeScratchReservation[] {
	if (!Array.isArray(value)) throw new TypeError('A native queue capacity context requires scratch rows.');
	const seen = new Set<string>();
	for (const row of value as readonly Partial<FramescaperNativeScratchReservation>[]) {
		if (!row || typeof row !== 'object' || typeof row.jobId !== 'string'
			|| !Number.isSafeInteger(row.reservedBytes) || row.reservedBytes! < 0
			|| !['reserved', 'released', 'retained'].includes(String(row.state))) {
			throw new TypeError('A native queue capacity context contains an invalid scratch reservation.');
		}
		if (seen.has(row.jobId)) {
			throw new TypeError('A native queue capacity context repeats one scratch reservation.');
		}
		seen.add(row.jobId);
	}
	return value as readonly FramescaperNativeScratchReservation[];
}

function committedScratchBytes(
	running: readonly NativeQueueRecordV3[],
	scratch: readonly FramescaperNativeScratchReservation[],
): number {
	const active = new Map(scratch
		.filter(({ state }) => state === 'reserved' || state === 'retained')
		.map((row) => [row.jobId, row.reservedBytes] as const));
	let committed = sum([...active.values()], 'durable scratch reservations');
	for (const record of running) {
		const materialized = active.get(record.jobId) ?? 0;
		if (record.reservations.scratchBytes > materialized) {
			committed = safeAdd(
				committed,
				record.reservations.scratchBytes - materialized,
				'running scratch reservations',
			);
		}
	}
	return committed;
}

async function inspectScratchVolume(scratchRoot: string): Promise<Readonly<{
	readonly totalBytes: number;
	readonly freeBytes: number;
}>> {
	await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
	const volume = await statfs(scratchRoot, { bigint: true });
	return Object.freeze({
		totalBytes: safeBigInt(volume.blocks * volume.bsize, 'scratch volume bytes'),
		freeBytes: safeBigInt(volume.bavail * volume.bsize, 'scratch free bytes'),
	});
}

function sum(values: readonly number[], label: string): number {
	return values.reduce((total, value) => safeAdd(total, value, label), 0);
}

function safeAdd(left: number, right: number, label: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Native queue ${label} exceed the safe integer domain.`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1) {
		throw new RangeError(`Native queue ${label} must be a positive safe integer.`);
	}
	return value as number;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`Native queue ${label} must be a non-negative safe integer.`);
	}
	return value as number;
}

function safeBigInt(value: bigint, label: string): number {
	if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`Native queue ${label} exceed the safe integer domain.`);
	}
	return Number(value);
}
