/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	animatedVideoKeyframeClipIdsForExport,
} from '../common/editor/video-keyframe-export-admission.ts';
import {
	createVideoKeyframeExportInventory,
} from '../common/editor/video-keyframe-export-inventory.ts';
import { resolveVideoExportRange } from '../common/editor/video-export.js';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import { framescaperProjectForRuntimeConsumersV20 } from './editor-project-v20-runtime.ts';
import {
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20-validation.ts';

export type FramescaperVideoExportRangeRequestV20 =
	| 'project'
	| 'selection'
	| 'loop'
	| Readonly<{ readonly startFrame: number; readonly endFrame: number }>;

export type FramescaperVideoExportDispatchStrategyV20 = 'legacy-v6' | 'keyed-v20';

interface FramescaperVideoExportRangeV20 {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
}
type ExactRangeResolver = (
	project: Readonly<Record<string, unknown>>,
	requestedRange: FramescaperVideoExportRangeRequestV20,
) => Readonly<FramescaperVideoExportRangeV20>;
// The JavaScript implementation accepts exact records, but inference sees its
// default string argument as string-only.
const resolveExactRange = resolveVideoExportRange as unknown as ExactRangeResolver;

export interface FramescaperVideoExportDispatchDecisionV20 {
	readonly strategy: FramescaperVideoExportDispatchStrategyV20;
	readonly range: Readonly<FramescaperVideoExportRangeV20>;
	readonly activeClipIds: readonly string[];
	readonly activeSourceIds: readonly string[];
}

/**
 * Classify one exact V20 range without crossing a media, renderer, or FFmpeg boundary.
 * The inactive V6/V20 strategy choice remains product-owned until V20 is selected.
 */
export function classifyFramescaperVideoExportDispatchV20(
	profile: FramescaperProjectV20Profile | unknown,
	projectValue: FramescaperProjectV20 | unknown,
	requestedRangeValue: FramescaperVideoExportRangeRequestV20 | unknown = 'project',
): Readonly<FramescaperVideoExportDispatchDecisionV20> {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectV20(profile, projectValue);
	const requestedRange = snapshotRequestedRange(requestedRangeValue);
	const runtimeProject = framescaperProjectForRuntimeConsumersV20(profile, projectValue);
	const range = resolveExactRange(runtimeProject, requestedRange);
	const inventory = createVideoKeyframeExportInventory({
		project: runtimeProject,
		startFrame: range.startFrame,
		endFrame: range.endFrame,
	});
	const animatedClipIds = animatedVideoKeyframeClipIdsForExport(inventory.project.clips);
	const retimedClipIds = inventory.project.clips
		.filter((clip) => dataProperty(clip, 'retimeMap', 'active V20 video clip') !== null)
		.map((clip) => String(dataProperty(clip, 'id', 'active V20 video clip')));
	return Object.freeze({
		strategy: animatedClipIds.length > 0 || retimedClipIds.length > 0 ? 'keyed-v20' : 'legacy-v6',
		range,
		activeClipIds: inventory.activeClipIds,
		activeSourceIds: inventory.activeSourceIds,
	});
}

function snapshotRequestedRange(
	value: FramescaperVideoExportRangeRequestV20 | unknown,
): FramescaperVideoExportRangeRequestV20 {
	if (value === 'project' || value === 'selection' || value === 'loop') return value;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper video export range must be a named or exact frame range.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Framescaper video export range must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== 2 || !keys.includes('startFrame') || !keys.includes('endFrame')) {
		throw new TypeError('Framescaper video export range requires exactly startFrame and endFrame.');
	}
	return Object.freeze({
		startFrame: frame(dataProperty(value, 'startFrame', 'range'), 'range.startFrame'),
		endFrame: frame(dataProperty(value, 'endFrame', 'range'), 'range.endFrame'),
	});
}

function dataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function frame(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}
