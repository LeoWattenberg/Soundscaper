/* SPDX-License-Identifier: AGPL-3.0-only */

import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	normalizeVideoRetimeCurveV16,
	type VideoRetimeCurveV16,
	type VideoRetimeCurveV16Binding,
} from '../common/editor/video-retime-v16.ts';
import type { FramescaperProjectV20 } from './editor-project-v20-validation.ts';

export type FramescaperVideoRetimeClipScopeV20 = 'timeline' | 'project-bin';

export interface FramescaperVideoRetimeSnapshotV20 {
	readonly id: string;
	readonly retimeMap: VideoRetimeCurveV16;
}

type DataRecord = Record<string, unknown>;

/** Snapshot non-null V20 occurrence curves before an inherited projection. */
export function snapshotFramescaperVideoRetimeMapsV20(
	project: FramescaperProjectV20,
): readonly FramescaperVideoRetimeSnapshotV20[] {
	const result: FramescaperVideoRetimeSnapshotV20[] = [];
	visitClipCollections(project as unknown as DataRecord, (clip, name) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		const retimeMap = normalizeFramescaperVideoRetimeCurveV20(
			dataProperty(clip, 'retimeMap', name), framescaperVideoRetimeBindingV20(clip, name),
		);
		if (retimeMap === null) return;
		result.push(Object.freeze({
			id: identifier(dataProperty(clip, 'id', name), `${name}.id`),
			retimeMap,
		}));
	});
	return Object.freeze(result);
}

/** Hide selected-route retime state from dormant common preservation admission. */
export function clearFramescaperVideoRetimeMapsV20(project: DataRecord): void {
	visitClipCollections(project, (clip, name) => {
		if (dataProperty(clip, 'kind', name) === 'video') clip.retimeMap = null;
	});
	project.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		project,
		project.featureRequirements as ProjectFeatureRequirementsManifest,
	);
}

/** Restore and revalidate every surviving exact occurrence curve after projection. */
export function restoreFramescaperVideoRetimeMapsV20(
	project: DataRecord,
	snapshots: readonly FramescaperVideoRetimeSnapshotV20[],
): void {
	const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
	visitClipCollections(project, (clip, name) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		const snapshot = byId.get(identifier(dataProperty(clip, 'id', name), `${name}.id`));
		if (!snapshot) return;
		const restored = normalizeFramescaperVideoRetimeCurveV20(
			snapshot.retimeMap, framescaperVideoRetimeBindingV20(clip, name),
		);
		if (restored === null) throw new TypeError(`${name} lost its exact V20 video retime map.`);
		clip.retimeMap = restored;
	});
}

/**
 * Rescale surviving curves onto a re-probed source's corrected frame grid.
 *
 * A re-probe replaces the frame grid the curve's source frames were authored
 * against; the same instant of media keeps its time, so every point scales by
 * the exact rate ratio and clamps into the clip's conformed range — the same
 * conformance the clip's own in/out already received. Without this, restoring
 * the snapshot either persists a curve whose frames mean different pictures
 * on the new grid or fails the whole re-probe when they no longer fit.
 */
export function conformFramescaperVideoRetimeSnapshotsForReprobeV20(
	before: DataRecord,
	commanded: DataRecord,
	command: DataRecord,
	snapshots: readonly FramescaperVideoRetimeSnapshotV20[],
): readonly FramescaperVideoRetimeSnapshotV20[] {
	if (command.type !== 'source/reprobe' || snapshots.length === 0) return snapshots;
	const sourceId = identifier(command.sourceId, 'source/reprobe.sourceId');
	const oldRate = videoSourceRate(before, sourceId);
	const newRate = videoSourceRate(commanded, sourceId);
	if (!oldRate || !newRate) return snapshots;
	const bindings = new Map<string, Readonly<{ start: number; end: number }>>();
	visitClipCollections(commanded, (clip, name) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		if (dataProperty(clip, 'sourceId', name) !== sourceId) return;
		const start = dataProperty(clip, 'sourceInFrame', name) as number;
		const count = dataProperty(clip, 'sourceFrameCount', name) as number;
		bindings.set(identifier(dataProperty(clip, 'id', name), `${name}.id`), Object.freeze({
			start, end: start + count,
		}));
	});
	if (bindings.size === 0) return snapshots;
	return Object.freeze(snapshots.map((snapshot) => {
		const binding = bindings.get(snapshot.id);
		if (!binding) return snapshot;
		const points = snapshot.retimeMap.points.map((point) => Object.freeze({
			...point,
			sourceFrame: clampRational(
				scaleRational(point.sourceFrame, oldRate, newRate),
				binding.start, binding.end,
			),
		}));
		return Object.freeze({
			id: snapshot.id,
			retimeMap: Object.freeze({ ...snapshot.retimeMap, points: Object.freeze(points) }),
		});
	}));
}

function videoSourceRate(project: DataRecord, sourceId: string): Readonly<{ num: number; den: number }> | null {
	const sources = dataProperty(project, 'sources', 'Framescaper V20 project');
	if (!Array.isArray(sources)) return null;
	const source = sources.find((candidate) => (
		candidate && typeof candidate === 'object'
		&& (candidate as DataRecord).id === sourceId && (candidate as DataRecord).kind === 'video'
	)) as DataRecord | undefined;
	const rate = source?.frameRate as Readonly<{ num?: unknown; den?: unknown }> | undefined;
	return rate && Number.isSafeInteger(rate.num) && Number.isSafeInteger(rate.den)
		&& Number(rate.num) > 0 && Number(rate.den) > 0
		? Object.freeze({ num: Number(rate.num), den: Number(rate.den) })
		: null;
}

function scaleRational(
	value: Readonly<{ num: number; den: number }>,
	oldRate: Readonly<{ num: number; den: number }>,
	newRate: Readonly<{ num: number; den: number }>,
): Readonly<{ num: number; den: number }> {
	let num = BigInt(value.num) * BigInt(newRate.num) * BigInt(oldRate.den);
	let den = BigInt(value.den) * BigInt(newRate.den) * BigInt(oldRate.num);
	const divisor = greatestCommonDivisor(num < 0n ? -num : num, den);
	if (divisor > 1n) {
		num /= divisor;
		den /= divisor;
	}
	if (num > BigInt(Number.MAX_SAFE_INTEGER) || den > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('A conformed retime source frame exceeds its exact domain.');
	}
	return Object.freeze({ num: Number(num), den: Number(den) });
}

function clampRational(
	value: Readonly<{ num: number; den: number }>,
	minimum: number,
	maximum: number,
): Readonly<{ num: number; den: number }> {
	if (BigInt(value.num) < BigInt(minimum) * BigInt(value.den)) {
		return Object.freeze({ num: minimum, den: 1 });
	}
	if (BigInt(value.num) > BigInt(maximum) * BigInt(value.den)) {
		return Object.freeze({ num: maximum, den: 1 });
	}
	return value;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = left;
	let b = right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a;
}

export function findFramescaperVideoClipV20(
	project: DataRecord,
	scope: FramescaperVideoRetimeClipScopeV20,
	clipId: string,
): DataRecord {
	let result: DataRecord | null = null;
	visitClipCollections(project, (clip, name, candidateScope) => {
		if (candidateScope !== scope || dataProperty(clip, 'id', name) !== clipId) return;
		if (result) throw new RangeError(`Duplicate ${scope} clip ID ${clipId}.`);
		if (dataProperty(clip, 'kind', name) !== 'video') {
			throw new TypeError(`Clip ${clipId} is not a video occurrence.`);
		}
		result = clip;
	});
	if (!result) throw new ReferenceError(`Unknown ${scope} video clip ${clipId}.`);
	return result;
}

export function framescaperVideoRetimeBindingV20(
	clip: DataRecord,
	name = 'Framescaper V20 video clip',
): VideoRetimeCurveV16Binding {
	return Object.freeze({
		sequenceFrameCount: dataProperty(clip, 'sequenceFrameCount', name) as number,
		sourceInFrame: dataProperty(clip, 'sourceInFrame', name) as number,
		sourceFrameCount: dataProperty(clip, 'sourceFrameCount', name) as number,
	});
}

export function normalizeFramescaperVideoRetimeCurveV20(
	value: unknown,
	binding: VideoRetimeCurveV16Binding,
): VideoRetimeCurveV16 | null {
	return normalizeVideoRetimeCurveV16(value, binding);
}

function visitClipCollections(
	project: DataRecord,
	visit: (clip: DataRecord, name: string, scope: FramescaperVideoRetimeClipScopeV20) => void,
): void {
	visitClipArray(dataProperty(project, 'clips', 'Framescaper V20 project'),
		'Framescaper V20 project.clips', 'timeline', visit);
	const projectBin = record(dataProperty(project, 'projectBin', 'Framescaper V20 project'),
		'Framescaper V20 project.projectBin');
	visitClipArray(dataProperty(projectBin, 'clips', 'Framescaper V20 project.projectBin'),
		'Framescaper V20 project.projectBin.clips', 'project-bin', visit);
}

function visitClipArray(
	value: unknown,
	name: string,
	scope: FramescaperVideoRetimeClipScopeV20,
	visit: (clip: DataRecord, name: string, scope: FramescaperVideoRetimeClipScopeV20) => void,
): void {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an own enumerable data property.`);
		}
		visit(record(descriptor.value, `${name}[${String(index)}]`), `${name}[${String(index)}]`, scope);
	}
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function dataProperty(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}
