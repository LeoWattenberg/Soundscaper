/* SPDX-License-Identifier: AGPL-3.0-only */

import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	normalizeVideoRetimeCurveV16,
	type VideoRetimeCurveV16,
	type VideoRetimeCurveV16Binding,
} from '../common/editor/video-retime-v16.ts';
import type { FramescaperProjectRetime } from './editor-project-retime-validation.ts';

export type FramescaperVideoRetimeClipScopeRetime = 'timeline' | 'project-bin';

export interface FramescaperVideoRetimeSnapshotRetime {
	readonly id: string;
	readonly retimeMap: VideoRetimeCurveV16;
}

type DataRecord = Record<string, unknown>;

/** Snapshot non-null retime occurrence curves before an inherited projection. */
export function snapshotFramescaperVideoRetimeMapsRetime(
	project: FramescaperProjectRetime,
): readonly FramescaperVideoRetimeSnapshotRetime[] {
	const result: FramescaperVideoRetimeSnapshotRetime[] = [];
	visitClipCollections(project as unknown as DataRecord, (clip, name) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		const retimeMap = normalizeFramescaperVideoRetimeCurveRetime(
			dataProperty(clip, 'retimeMap', name), framescaperVideoRetimeBindingRetime(clip, name),
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
export function clearFramescaperVideoRetimeMapsRetime(project: DataRecord): void {
	visitClipCollections(project, (clip, name) => {
		if (dataProperty(clip, 'kind', name) === 'video') clip.retimeMap = null;
	});
	project.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		project,
		project.featureRequirements as ProjectFeatureRequirementsManifest,
	);
}

/** Restore and revalidate every surviving exact occurrence curve after projection. */
export function restoreFramescaperVideoRetimeMapsRetime(
	project: DataRecord,
	snapshots: readonly FramescaperVideoRetimeSnapshotRetime[],
): void {
	const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
	visitClipCollections(project, (clip, name) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		const snapshot = byId.get(identifier(dataProperty(clip, 'id', name), `${name}.id`));
		if (!snapshot) return;
		const restored = normalizeFramescaperVideoRetimeCurveRetime(
			snapshot.retimeMap, framescaperVideoRetimeBindingRetime(clip, name),
		);
		if (restored === null) throw new TypeError(`${name} lost its exact retime video retime map.`);
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
export function conformFramescaperVideoRetimeSnapshotsForReprobeRetime(
	before: DataRecord,
	commanded: DataRecord,
	command: DataRecord,
	snapshots: readonly FramescaperVideoRetimeSnapshotRetime[],
): readonly FramescaperVideoRetimeSnapshotRetime[] {
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
	const sources = dataProperty(project, 'sources', 'Framescaper retime project');
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

/** Conform for a re-probe, then restore: the one call inherited commands need. */
export function restoreFramescaperVideoRetimeMapsAfterCommandRetime(
	before: DataRecord,
	commanded: DataRecord,
	command: DataRecord,
	snapshots: readonly FramescaperVideoRetimeSnapshotRetime[],
): void {
	restoreFramescaperVideoRetimeMapsRetime(commanded, conformFramescaperVideoRetimeSnapshotsForReprobeRetime(
		before, commanded, command, snapshots,
	));
}

export function findFramescaperVideoClipRetime(
	project: DataRecord,
	scope: FramescaperVideoRetimeClipScopeRetime,
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

export function framescaperVideoRetimeBindingRetime(
	clip: DataRecord,
	name = 'Framescaper retime video clip',
): VideoRetimeCurveV16Binding {
	return Object.freeze({
		sequenceFrameCount: dataProperty(clip, 'sequenceFrameCount', name) as number,
		sourceInFrame: dataProperty(clip, 'sourceInFrame', name) as number,
		sourceFrameCount: dataProperty(clip, 'sourceFrameCount', name) as number,
	});
}

export function normalizeFramescaperVideoRetimeCurveRetime(
	value: unknown,
	binding: VideoRetimeCurveV16Binding,
): VideoRetimeCurveV16 | null {
	return normalizeVideoRetimeCurveV16(value, binding);
}

function visitClipCollections(
	project: DataRecord,
	visit: (clip: DataRecord, name: string, scope: FramescaperVideoRetimeClipScopeRetime) => void,
): void {
	visitClipArray(dataProperty(project, 'clips', 'Framescaper retime project'),
		'Framescaper retime project.clips', 'timeline', visit);
	const projectBin = record(dataProperty(project, 'projectBin', 'Framescaper retime project'),
		'Framescaper retime project.projectBin');
	visitClipArray(dataProperty(projectBin, 'clips', 'Framescaper retime project.projectBin'),
		'Framescaper retime project.projectBin.clips', 'project-bin', visit);
}

function visitClipArray(
	value: unknown,
	name: string,
	scope: FramescaperVideoRetimeClipScopeRetime,
	visit: (clip: DataRecord, name: string, scope: FramescaperVideoRetimeClipScopeRetime) => void,
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
