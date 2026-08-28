/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	animatedVideoKeyframeClipIdsForExport,
} from '../common/editor/video-keyframe-export-admission.ts';
import {
	createVideoKeyframeExportInventory,
} from '../common/editor/video-keyframe-export-inventory.ts';
import { resolveVideoExportRange } from '../common/editor/video-export.js';
import {
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import { framescaperProjectForRuntimeConsumersRetime } from './editor-project-retime-runtime.ts';
import {
	validateFramescaperProjectRetime,
	type FramescaperProjectRetime,
} from './editor-project-retime-validation.ts';

export type FramescaperVideoExportRangeRequestRetime =
	| 'project'
	| 'selection'
	| 'loop'
	| Readonly<{ readonly startFrame: number; readonly endFrame: number }>;

export type FramescaperVideoExportDispatchStrategyRetime = 'legacy-v6' | 'keyed-retime';

interface FramescaperVideoExportRangeRetime {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
}
type ExactRangeResolver = (
	project: Readonly<Record<string, unknown>>,
	requestedRange: FramescaperVideoExportRangeRequestRetime,
) => Readonly<FramescaperVideoExportRangeRetime>;
// The JavaScript implementation accepts exact records, but inference sees its
// default string argument as string-only.
const resolveExactRange = resolveVideoExportRange as unknown as ExactRangeResolver;

export interface FramescaperVideoExportDispatchDecisionRetime {
	readonly strategy: FramescaperVideoExportDispatchStrategyRetime;
	readonly range: Readonly<FramescaperVideoExportRangeRetime>;
	readonly activeClipIds: readonly string[];
	readonly activeSourceIds: readonly string[];
}

/**
 * Classify one exact retime range without crossing a media, renderer, or FFmpeg boundary.
 * The inactive V6/retime strategy choice remains product-owned until retime is selected.
 */
export function classifyFramescaperVideoExportDispatchRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	projectValue: FramescaperProjectRetime | unknown,
	requestedRangeValue: FramescaperVideoExportRangeRequestRetime | unknown = 'project',
): Readonly<FramescaperVideoExportDispatchDecisionRetime> {
	assertFramescaperProjectRetimeProfile(profile);
	validateFramescaperProjectRetime(profile, projectValue);
	const requestedRange = snapshotRequestedRange(requestedRangeValue);
	const runtimeProject = framescaperProjectForRuntimeConsumersRetime(profile, projectValue);
	const range = resolveExactRange(runtimeProject, requestedRange);
	const inventory = createVideoKeyframeExportInventory({
		project: runtimeProject,
		startFrame: range.startFrame,
		endFrame: range.endFrame,
	});
	const animatedClipIds = animatedVideoKeyframeClipIdsForExport(inventory.project.clips);
	const retimedClipIds = inventory.project.clips
		.filter((clip) => dataProperty(clip, 'retimeMap', 'active retime video clip') !== null)
		.map((clip) => String(dataProperty(clip, 'id', 'active retime video clip')));
	return Object.freeze({
		strategy: animatedClipIds.length > 0 || retimedClipIds.length > 0 ? 'keyed-retime' : 'legacy-v6',
		range,
		activeClipIds: inventory.activeClipIds,
		activeSourceIds: inventory.activeSourceIds,
	});
}

function snapshotRequestedRange(
	value: FramescaperVideoExportRangeRequestRetime | unknown,
): FramescaperVideoExportRangeRequestRetime {
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
