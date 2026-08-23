/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveVideoRetimeExactPictureOrdinal,
	type VideoRetimeExactOrdinalAuthority,
} from './video-retime-exact-ordinal-authority.ts';
import type { VideoRetimeFrameDescriptor } from './video-retime-frame-dispatch.ts';
import { createVideoRetimeWebCoreOrdinalAuthority } from './video-retime-web-core-ordinal-authority.ts';
import { registeredVideoTimingIndex } from './video-source-time.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from './video-source-timing-view.ts';
import type { VideoTimingAssetReference, VideoTimingIndex } from './video-timing-asset.ts';
import { videoTimelineDurationFrames } from './video-timeline.js';

export interface VideoRetimeWebCorePreviewRequest {
	readonly project: Readonly<Record<string, unknown>>;
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
}

export interface VideoRetimeWebCorePreviewResolver {
	readonly authority: VideoRetimeExactOrdinalAuthority;
	readonly resolveClipPresentation: (request: Readonly<{
		readonly clip: Readonly<Record<string, unknown>>;
		readonly source: Readonly<Record<string, unknown>>;
		readonly timelineSample: number;
	}>) => VideoRetimeFrameDescriptor | null;
}

/** Resolve integer project-sample seeks through the exact export ordinal oracle. */
export function createVideoRetimeWebCorePreviewResolver(
	requestValue: VideoRetimeWebCorePreviewRequest | unknown,
): VideoRetimeWebCorePreviewResolver {
	const request = requestRecord(requestValue);
	const project = record(request.project, 'web-core retime preview project');
	const sampleRate = positiveInteger(data(project, 'sampleRate', 'web-core retime preview project'), 'project.sampleRate');
	const endFrame = videoTimelineDurationFrames(project);
	const authority = createVideoRetimeWebCoreOrdinalAuthority({
		project,
		timingBySourceId: request.timingBySourceId,
		startFrame: 0,
		endFrame,
		outputRate: { num: sampleRate, den: 1 },
	});
	const retimed = new Map<string, string>();
	for (const clip of records(data(project, 'clips', 'web-core retime preview project'), 'project.clips')) {
		if (data(clip, 'kind', 'web-core retime preview clip') !== 'video'
			|| data(clip, 'retimeMap', 'web-core retime preview clip') === null) continue;
		retimed.set(
			identifier(data(clip, 'id', 'web-core retime preview clip'), 'clip.id'),
			identifier(data(clip, 'sourceId', 'web-core retime preview clip'), 'clip.sourceId'),
		);
	}
	return Object.freeze({
		authority,
		resolveClipPresentation(requestValue_: unknown) {
			const value = record(requestValue_, 'web-core retime preview picture request');
			const clip = record(data(value, 'clip', 'web-core retime preview picture request'), 'preview clip');
			const source = record(data(value, 'source', 'web-core retime preview picture request'), 'preview source');
			const clipId = identifier(data(clip, 'id', 'web-core retime preview clip'), 'clip.id');
			const sourceId = identifier(data(source, 'id', 'web-core retime preview source'), 'source.id');
			if (retimed.get(clipId) !== sourceId) return null;
			const timelineSample = data(value, 'timelineSample', 'web-core retime preview picture request');
			if (typeof timelineSample !== 'number' || !Number.isSafeInteger(timelineSample)
				|| timelineSample < 0 || timelineSample >= endFrame) return null;
			const picture = resolveVideoRetimeExactPictureOrdinal(authority, {
				outputOrdinal: timelineSample,
				clipId,
				sourceId,
			});
			return Object.freeze({
				outerCell: picture.outerCell,
				segmentIndex: picture.segmentIndex,
				mode: picture.mode,
				sourceFrame: picture.sourcePosition,
				sourceTime: picture.sourceTime,
				drawableSourceFrame: picture.sourceOrdinal,
				drawableSourceStartTime: picture.drawableSourceStartTime,
				drawableSourceEndTime: picture.drawableSourceEndTime,
			});
		},
	});
}

/** Bind preview timing from persisted CFR state or the verified active VFR registry. */
export function createRegisteredVideoRetimeWebCorePreviewResolver(
	projectValue: Readonly<Record<string, unknown>> | unknown,
): VideoRetimeWebCorePreviewResolver {
	const project = record(projectValue, 'registered web-core retime preview project');
	const timing = new Map<string, BoundVideoSourceTimingView>();
	for (const source of records(data(project, 'sources', 'registered web-core retime preview project'), 'project.sources')) {
		if (data(source, 'kind', 'registered web-core retime preview source') !== 'video') continue;
		const sourceId = identifier(data(source, 'id', 'registered web-core retime preview source'), 'source.id');
		const decision = record(
			data(source, 'timingDecision', 'registered web-core retime preview source'),
			`video source ${sourceId}.timingDecision`,
		);
		let view: VideoSourceTimingView;
		if (data(decision, 'mode', `video source ${sourceId}.timingDecision`) === 'conform-cfr-at-ingest') {
			view = Object.freeze({
				kind: 'cfr',
				rate: data(source, 'frameRate', `video source ${sourceId}`) as never,
				frameCount: positiveInteger(data(source, 'sourceFrameCount', `video source ${sourceId}`), 'sourceFrameCount'),
			});
		} else {
			const index = registeredVideoTimingIndex(source);
			if (!index) throw new ReferenceError(`Exact video source ${sourceId} has no active verified timing index.`);
			view = Object.freeze({
				kind: 'vfr',
				reference: data(source, 'timingAsset', `video source ${sourceId}`) as Readonly<VideoTimingAssetReference>,
				index: index as VideoTimingIndex,
			});
		}
		timing.set(sourceId, bindVideoSourceTimingView(new Map([[sourceId, view]]), source));
	}
	return createVideoRetimeWebCorePreviewResolver({ project, timingBySourceId: timing });
}

function requestRecord(value: unknown): VideoRetimeWebCorePreviewRequest {
	const result = record(value, 'web-core retime preview request');
	const keys = Reflect.ownKeys(result);
	if (keys.length !== 2 || !keys.includes('project') || !keys.includes('timingBySourceId')) {
		throw new TypeError('Web-core retime preview request must contain project and timingBySourceId.');
	}
	data(result, 'project', 'web-core retime preview request');
	data(result, 'timingBySourceId', 'web-core retime preview request');
	return result as unknown as VideoRetimeWebCorePreviewRequest;
}

function records(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => record(entry, `${name}[${String(index)}]`));
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError(`${name} must be a bounded non-empty string.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}
