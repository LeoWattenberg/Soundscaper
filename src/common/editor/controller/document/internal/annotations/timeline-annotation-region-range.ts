/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveSelectionRange } from '../../../../selection-range.ts';
import type { RuntimeClipProject } from '../../../../runtime-clip-projection.ts';

interface RegionRange { readonly startFrame: number; readonly endFrame: number }
interface RegionProject extends RuntimeClipProject { readonly selection: RegionRange }

export function resolveTimelineAnnotationRegionRange(project: RegionProject, requested?: RegionRange): RegionRange {
	const range = requested ?? resolveSelectionRange(project) ?? project.selection;
	const first = timelineFrame(range.startFrame, 'Annotation region start');
	const second = timelineFrame(range.endFrame, 'Annotation region end');
	const startFrame = Math.min(first, second);
	const endFrame = Math.max(first, second);
	if (endFrame <= startFrame) throw new RangeError('A timeline annotation region requires a positive selection.');
	return { startFrame, endFrame };
}

export function timelineFrame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}
