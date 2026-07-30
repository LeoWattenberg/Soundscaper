/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertScapeArchiveByteSource,
	createScapeArchiveByteSource,
	type ScapeArchiveByteSource,
} from './scape-archive-byte-source.ts';
import { SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES } from './scape-archive-zip-profile.ts';

const END_MAXIMUM_BYTES = 22 + 0xffff;
const ZIP64_END_BYTES = 56;
const ZIP64_LOCATOR_BYTES = 20;

/** Retains twice the canonical central profile plus its bounded duplicate end-record probes. */
export const SCAPE_MAXIMUM_STRUCTURAL_WITNESS_BYTES =
	2 * SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES
	+ END_MAXIMUM_BYTES
	+ ZIP64_END_BYTES
	+ ZIP64_LOCATOR_BYTES;

interface WitnessRange {
	readonly bytes: Uint8Array;
	readonly end: number;
	readonly offset: number;
}

interface WitnessCluster {
	readonly end: number;
	readonly offset: number;
	readonly ranges: readonly WitnessRange[];
}

export interface ScapeArchiveLayoutWitness {
	bind(): ScapeArchiveByteSource;
	record(offset: number, bytes: Uint8Array): void;
}

export function createScapeArchiveLayoutWitness(
	source: ScapeArchiveByteSource,
): ScapeArchiveLayoutWitness {
	assertScapeArchiveByteSource(source);
	const ranges: WitnessRange[] = [];
	let bound = false;
	let retainedBytes = 0;
	return Object.freeze({
		record(offset: number, bytes: Uint8Array): void {
			if (bound) throw new Error('The .scape structural witness is already bound.');
			if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.size - bytes.byteLength) {
				throw new RangeError('The .scape structural witness received an invalid byte range.');
			}
			if (bytes.byteLength > SCAPE_MAXIMUM_STRUCTURAL_WITNESS_BYTES - retainedBytes) {
				throw new RangeError('The .scape structural witness exceeds its portable byte limit.');
			}
			const retained = bytes.slice();
			ranges.push({ bytes: retained, end: offset + retained.byteLength, offset });
			retainedBytes += retained.byteLength;
		},
		bind(): ScapeArchiveByteSource {
			if (bound) throw new Error('The .scape structural witness is already bound.');
			bound = true;
			const clusters = clusterWitnessRanges(ranges);
			ranges.length = 0;
			return createScapeArchiveByteSource({
				maximumReadBytes: source.maximumReadBytes,
				size: source.size,
				async read(request): Promise<Uint8Array> {
					const end = request.offset + request.length;
					const first = firstOverlappingCluster(clusters, request.offset);
					if (first >= clusters.length || clusters[first]!.offset >= end) {
						return source.read(request);
					}
					const result = new Uint8Array(request.length);
					await fillWitnessGaps(result, request, end, source, clusters, first);
					overlayWitness(result, request.offset, end, clusters, first);
					return result;
				},
			});
		},
	});
}

function clusterWitnessRanges(input: WitnessRange[]): readonly WitnessCluster[] {
	const sorted = [...input].sort((left, right) => left.offset - right.offset || left.end - right.end);
	const clusters: WitnessCluster[] = [];
	let current: WitnessRange[] = [];
	let active: WitnessRange[] = [];
	let end = -1;
	for (const range of sorted) {
		if (current.length && range.offset > end) {
			clusters.push(witnessCluster(current, end));
			current = [];
			active = [];
			end = -1;
		}
		active = active.filter((prior) => prior.end > range.offset);
		assertWitnessOverlap(active, range);
		current.push(range);
		active.push(range);
		end = Math.max(end, range.end);
	}
	if (current.length) clusters.push(witnessCluster(current, end));
	return Object.freeze(clusters);
}

function witnessCluster(ranges: WitnessRange[], end: number): WitnessCluster {
	return Object.freeze({
		end,
		offset: ranges[0]!.offset,
		ranges: Object.freeze([...ranges]),
	});
}

function assertWitnessOverlap(existing: readonly WitnessRange[], next: WitnessRange): void {
	for (const prior of existing) {
		const start = Math.max(prior.offset, next.offset);
		const end = Math.min(prior.end, next.end);
		for (let offset = start; offset < end; offset += 1) {
			if (prior.bytes[offset - prior.offset] !== next.bytes[offset - next.offset]) {
				throw new Error('The .scape byte source changed during structural validation.');
			}
		}
	}
}

function firstOverlappingCluster(clusters: readonly WitnessCluster[], offset: number): number {
	let low = 0;
	let high = clusters.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (clusters[middle]!.end <= offset) low = middle + 1;
		else high = middle;
	}
	return low;
}

async function fillWitnessGaps(
	result: Uint8Array,
	request: Readonly<{ offset: number; length: number; signal?: AbortSignal }>,
	end: number,
	source: ScapeArchiveByteSource,
	clusters: readonly WitnessCluster[],
	first: number,
): Promise<void> {
	let cursor = request.offset;
	for (let index = first; index < clusters.length && cursor < end; index += 1) {
		const cluster = clusters[index]!;
		if (cluster.offset >= end) break;
		const gapEnd = Math.min(end, cluster.offset);
		if (cursor < gapEnd) {
			const bytes = await source.read({
				offset: cursor,
				length: gapEnd - cursor,
				...(request.signal ? { signal: request.signal } : {}),
			});
			result.set(bytes, cursor - request.offset);
		}
		cursor = Math.max(cursor, Math.min(end, cluster.end));
	}
	if (cursor < end) {
		const bytes = await source.read({
			offset: cursor,
			length: end - cursor,
			...(request.signal ? { signal: request.signal } : {}),
		});
		result.set(bytes, cursor - request.offset);
	}
}

function overlayWitness(
	result: Uint8Array,
	offset: number,
	end: number,
	clusters: readonly WitnessCluster[],
	first: number,
): void {
	for (let index = first; index < clusters.length; index += 1) {
		const cluster = clusters[index]!;
		if (cluster.offset >= end) break;
		for (const range of cluster.ranges) {
			const start = Math.max(offset, range.offset);
			const overlapEnd = Math.min(end, range.end);
			if (start >= overlapEnd) continue;
			result.set(
				range.bytes.subarray(start - range.offset, overlapEnd - range.offset),
				start - offset,
			);
		}
	}
}
