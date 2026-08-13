/* SPDX-License-Identifier: AGPL-3.0-only */

import { videoKeyframeCurvesEqual } from '../video-keyframe-curves.ts';
import { VIDEO_KEYFRAME_CARRIER_EDITED } from './command-projection-transients.ts';
import { transformVideoKeyframeCarrier } from './video-keyframe-carrier.ts';

type DataRecord = Record<PropertyKey, unknown>;

/**
 * Re-derive an existing occurrence's carrier after V10 command coordinates
 * have been reconciled back into authoritative sequence/source frame units.
 */
export function reconcileVideoKeyframeCarriersAfterCommand(
	projectValue: unknown,
	baseValue: unknown,
): void {
	const project = record(projectValue, 'command project');
	const base = record(baseValue, 'persisted command base');
	reconcileCollection(array(project.clips, 'command project.clips'), array(base.clips, 'persisted command base.clips'), 'timeline');
	if (!isRecord(project.projectBin) || !isRecord(base.projectBin)) return;
	const projectBin = project.projectBin;
	const baseBin = base.projectBin;
	reconcileCollection(
		array(projectBin.clips, 'command project.projectBin.clips'),
		array(baseBin.clips, 'persisted command base.projectBin.clips'),
		'Project Bin',
	);
}

function reconcileCollection(targets: DataRecord[], sources: DataRecord[], scope: string): void {
	const sourceById = new Map(sources.map((clip) => [String(clip.id), clip]));
	for (let index = 0; index < targets.length; index += 1) {
		const target = targets[index]!;
		const source = sourceById.get(String(target.id));
		const carrierEdited = target[VIDEO_KEYFRAME_CARRIER_EDITED] === true;
		delete target[VIDEO_KEYFRAME_CARRIER_EDITED];
		if (!source || !hasCarrier(source) || !hasCarrier(target)) continue;
		if (carrierEdited) continue;
		if (!placementChanged(source, target) || carrierChanged(source, target)) continue;
		const sourceClip = projectedClip(source);
		const targetClip = projectedClip(target);
		const reconciled = transformVideoKeyframeCarrier(
			target, sourceClip, targetClip, {}, `${scope} clip ${String(target.id)}`,
		);
		target.videoKeyframes = reconciled.videoKeyframes;
	}
}

function placementChanged(source: DataRecord, target: DataRecord): boolean {
	return source.sequenceStartFrame !== target.sequenceStartFrame
		|| source.sequenceFrameCount !== target.sequenceFrameCount
		|| source.sourceInFrame !== target.sourceInFrame
		|| source.sourceFrameCount !== target.sourceFrameCount;
}

function carrierChanged(source: DataRecord, target: DataRecord): boolean {
	const sourceClip = projectedClip(source);
	try {
		return !videoKeyframeCurvesEqual(
			source.videoKeyframes,
			target.videoKeyframes,
			keyframeContext(sourceClip),
		);
	} catch (error) {
		if (error instanceof ReferenceError || error instanceof RangeError) return true;
		throw error;
	}
}

function keyframeContext(clip: DataRecord): Readonly<Record<string, unknown>> {
	return Object.freeze({
		duration: { num: clip.sequenceFrameCount, den: 1 },
		composition: clip.videoComposition,
		videoEffects: clip.videoEffects,
	});
}

function projectedClip(clip: DataRecord): DataRecord {
	return {
		...clip,
		sourceStartFrame: clip.sourceStartFrame ?? clip.sourceInFrame,
		sourceDurationFrames: clip.sourceDurationFrames ?? clip.sourceFrameCount,
	};
}

function hasCarrier(value: DataRecord): boolean {
	return Object.getOwnPropertyDescriptor(value, 'videoKeyframes') !== undefined;
}

function record(value: unknown, name: string): DataRecord {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function array(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => record(candidate, `${name}[${String(index)}]`));
}
