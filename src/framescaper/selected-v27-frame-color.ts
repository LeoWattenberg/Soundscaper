/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyManagedSdrGradeStackLinearPixelV1,
	applyManagedSdrLinearGradeStackPixelV1,
	defaultVideoSourceColorInterpretationV1,
	type ParsedCubeLutV1,
	type VideoColorGradeV1,
	type VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import type {
	UnifiedExactRenderFinishingNode,
} from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import type { UnifiedExactRenderVisualRgbaV13 } from '../common/editor/unified-exact-render-visual-materializer-v13.ts';

export function gradeSelectedV27Visual(
	finishing: UnifiedExactRenderFinishingNode,
	entry: UnifiedExactRenderVisualFrameEntryV13,
	frame: UnifiedExactRenderVisualRgbaV13,
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	if (!('source' in entry.authoredState)) throw new TypeError('Selected V27 visual source is unavailable.');
	const source = entry.authoredState.source;
	const presentations = finishing.visualPresentations.filter(({ enabled, owner }) => enabled && (
		(owner.kind === 'clip' && owner.id === entry.modelId)
		|| ((owner.kind === 'source' || owner.kind === 'generator') && owner.id === source.id)
	));
	const interpretation = source.kind === 'still'
		? requiredInterpretation(finishing, source.id)
		: defaultVideoSourceColorInterpretationV1('still', source.id);
	return gradeEncodedFrame(frame, interpretation,
		presentations.flatMap(({ grade }) => grade ? [grade] : []), luts, signal);
}

export function gradeSelectedV27LinearFrame(
	frame: UnifiedExactRenderRgbaFrameV13,
	grades: readonly VideoColorGradeV1[],
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const pixels = new Uint8Array(frame.pixels.length);
	const bodies = grades.map(({ lut }) => lut ? luts.get(lut.sha256) : undefined);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (offset % (frame.width * 4) === 0) throwIfAborted(signal);
		writeChannels(pixels, offset, applyManagedSdrLinearGradeStackPixelV1({
			rgba: channels(frame.pixels, offset), grades, luts: bodies,
		}));
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

function gradeEncodedFrame(
	frame: UnifiedExactRenderVisualRgbaV13,
	interpretation: VideoSourceColorInterpretationV1,
	grades: readonly VideoColorGradeV1[],
	luts: ReadonlyMap<string, ParsedCubeLutV1>,
	signal: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const pixels = new Uint8Array(frame.pixels.length);
	const bodies = grades.map(({ lut }) => lut ? luts.get(lut.sha256) : undefined);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (offset % (frame.width * 4) === 0) throwIfAborted(signal);
		writeChannels(pixels, offset, applyManagedSdrGradeStackLinearPixelV1({
			rgba: channels(frame.pixels, offset), interpretation, grades, luts: bodies,
		}));
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

function requiredInterpretation(
	finishing: UnifiedExactRenderFinishingNode,
	sourceId: string,
): VideoSourceColorInterpretationV1 {
	const value = finishing.sourceInterpretations.find((candidate) => candidate.sourceId === sourceId);
	if (!value) throw new ReferenceError(`Selected V27 source interpretation ${sourceId} is unavailable.`);
	return value;
}

function channels(value: Uint8Array, offset: number): readonly [number, number, number, number] {
	return [value[offset]! / 255, value[offset + 1]! / 255,
		value[offset + 2]! / 255, value[offset + 3]! / 255];
}

function writeChannels(target: Uint8Array, offset: number, value: readonly number[]): void {
	for (let channel = 0; channel < 4; channel += 1) target[offset + channel] = Math.round(value[channel]! * 255);
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('Selected V27 exact execution was aborted.', 'AbortError');
}
