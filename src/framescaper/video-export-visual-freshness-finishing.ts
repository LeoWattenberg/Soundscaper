/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import { sequenceFrameBoundarySample } from '../common/editor/sequence-frame-navigation.ts';
import type { VideoFreezeFreshnessInputV1 } from '../common/editor/video-freeze-v24.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';

/** Derive exact freshness for every V13 visual node intersecting one export range. */
export function createFramescaperVideoExportVisualFreshnessFinishing(
	project: FramescaperProjectFinishing,
	range: Readonly<{ readonly startFrame: number; readonly durationFrames: number }>,
): ReadonlyMap<string, VideoFreezeFreshnessInputV1> {
	const sampleRate = positiveInteger(project.sampleRate, 'finishing visual freshness sample rate');
	const sequenceId = stableId(project.primarySequenceId, 'finishing visual freshness sequence');
	const sequence = records(project.sequences, 'finishing visual freshness sequences')
		.find(({ id }) => id === sequenceId);
	if (!sequence) throw new ReferenceError('finishing visual freshness primary sequence is unavailable.');
	const sequenceRate = record(sequence.rate, 'finishing visual freshness sequence rate') as Readonly<{
		readonly num: number; readonly den: number;
	}>;
	const start = nonNegativeInteger(range.startFrame, 'finishing visual freshness start');
	const end = safeAdd(start, positiveInteger(range.durationFrames, 'finishing visual freshness duration'));
	const sourceById = new Map(records(project.sources, 'finishing visual freshness sources')
		.map((source) => [String(source.id), source]));
	const result = new Map<string, VideoFreezeFreshnessInputV1>();
	const contextSha256 = fingerprintNativeMediaPlan({
		domain: 'framescaper-browser-visual', projectId: project.id,
		revision: project.revision, sequenceId, start, end,
	}).sha256;
	for (const clip of records(project.clips, 'finishing visual freshness clips')) {
		if ((clip.kind !== 'still' && clip.kind !== 'generator') || clip.sequenceId !== sequenceId
			|| !intersects(clip, start, end, sampleRate, sequenceRate)) continue;
		const source = sourceById.get(String(clip.sourceId));
		if (!source || source.kind !== clip.kind) throw new ReferenceError('finishing visual freshness source is unavailable.');
		put(result, stableId(clip.id, 'finishing visual clip'), { source, clip }, contextSha256);
	}
	for (const adjustment of records(project.videoAdjustmentLayers, 'finishing visual adjustment layers')) {
		if (adjustment.sequenceId === sequenceId
			&& intersects(adjustment, start, end, sampleRate, sequenceRate)) {
			put(result, stableId(adjustment.id, 'finishing visual adjustment'), adjustment, contextSha256);
		}
	}
	for (const preset of records(project.videoVisualPresets, 'finishing visual presets')) {
		put(result, stableId(preset.id, 'finishing visual preset'), preset, contextSha256);
	}
	for (const mask of records(project.videoMaskMattes, 'finishing visual masks')) {
		put(result, stableId(mask.id, 'finishing visual mask'), mask, contextSha256);
	}
	for (const fallback of records(project.videoFreezeFallbacks, 'finishing visual freezes')) {
		const renderedSourceId = stableId(fallback.renderedSourceId, 'finishing freeze source');
		const state = Object.freeze({
			schemaVersion: 1 as const, kind: 'video-freeze' as const, renderedSourceId,
		});
		const authoredStateSha256 = fingerprintNativeMediaPlan(state).sha256;
		putExact(result, `video-freeze:${renderedSourceId}`, Object.freeze({
			authoredStateSha256,
			inputIdentitiesSha256: digest(fallback.inputIdentitiesSha256, 'finishing freeze inputs'),
			renderPlanFingerprintSha256: digest(fallback.renderPlanFingerprintSha256, 'finishing freeze plan'),
			nativeEffectFingerprintSha256: digest(fallback.nativeEffectFingerprintSha256, 'finishing freeze effects'),
		}));
	}
	return Object.freeze(result);
}

function put(
	result: Map<string, VideoFreezeFreshnessInputV1>,
	id: string,
	state: unknown,
	contextSha256: string,
): void {
	putExact(result, id, Object.freeze({
		authoredStateSha256: fingerprintNativeMediaPlan(state).sha256,
		inputIdentitiesSha256: contextSha256,
		renderPlanFingerprintSha256: contextSha256,
		nativeEffectFingerprintSha256: contextSha256,
	}));
}

function putExact(
	result: Map<string, VideoFreezeFreshnessInputV1>,
	id: string,
	freshness: VideoFreezeFreshnessInputV1,
): void {
	if (result.has(id)) throw new RangeError(`finishing visual freshness identity ${id} is ambiguous.`);
	result.set(id, freshness);
}

function intersects(
	value: Readonly<Record<string, unknown>>,
	start: number,
	end: number,
	sampleRate: number,
	sequenceRate: Readonly<{ readonly num: number; readonly den: number }>,
): boolean {
	const first = sequenceFrameBoundarySample(
		nonNegativeInteger(value.sequenceStartFrame, 'finishing visual start'), sequenceRate, sampleRate,
	);
	const last = sequenceFrameBoundarySample(safeAdd(
		nonNegativeInteger(value.sequenceStartFrame, 'finishing visual start'),
		positiveInteger(value.sequenceFrameCount, 'finishing visual duration'),
	), sequenceRate, sampleRate);
	return first < end && last > start;
}

function records(value: unknown, name: string): Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new TypeError(`${name} is invalid.`);
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result < 1) throw new RangeError(`${name} must be positive.`);
	return result;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function safeAdd(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('finishing visual range overflows.');
	return result;
}
