/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	frameTrimRationalRate,
	frameTrimRecord,
	nonEmptyString,
	positiveSafeInteger,
	type FrameTrimDataRecord,
} from './frame-canonical-edge-trim-domain.ts';
import type { VideoSourceTimingView } from './frame-canonical-slip-slide-domain.ts';
import { registeredVideoTimingIndex } from './video-source-time.ts';
import {
	isVideoTimingIndexVerifiedForReference,
	type VideoTimingAssetReference,
} from './video-timing-asset.ts';

/**
 * Resolve synchronous frame-planning evidence from one captured project.
 * Unavailable or stale exact timing is omitted so only an operation that needs
 * that source refuses; no unverified PTS can enter a view.
 */
export function resolveVideoSourceTimingViews(
	projectValue: unknown,
): ReadonlyMap<string, VideoSourceTimingView> {
	const project = frameTrimRecord(projectValue, 'project');
	if (!Array.isArray(project.sources)) throw new TypeError('project.sources must be an array.');
	const entries: Array<readonly [string, VideoSourceTimingView]> = [];
	const sourceIds = new Set<string>();
	for (const [index, sourceValue] of project.sources.entries()) {
		const source = frameTrimRecord(sourceValue, `project.sources[${String(index)}]`);
		if (source.kind !== 'video') continue;
		const sourceId = nonEmptyString(source.id, `project.sources[${String(index)}].id`);
		if (sourceIds.has(sourceId)) throw new RangeError(`Duplicate video source ID ${sourceId}.`);
		sourceIds.add(sourceId);
		const view = timingView(source, sourceId);
		if (view) entries.push([sourceId, view]);
	}
	return new ImmutableTimingViewMap(entries);
}

function timingView(
	source: FrameTrimDataRecord,
	sourceId: string,
): VideoSourceTimingView | null {
	const decision = frameTrimRecord(
		source.timingDecision,
		`video source ${sourceId}.timingDecision`,
	);
	if (decision.mode === 'conform-cfr-at-ingest') {
		return Object.freeze({
			kind: 'cfr' as const,
			rate: frameTrimRationalRate(decision.rate, `video source ${sourceId}.timingDecision.rate`),
			frameCount: positiveSafeInteger(
				source.sourceFrameCount,
				`video source ${sourceId}.sourceFrameCount`,
			),
		});
	}
	if (decision.mode !== 'exact') {
		throw new RangeError(`Video source ${sourceId} has an unsupported timing decision.`);
	}
	const reference = source.timingAsset;
	const index = registeredVideoTimingIndex(source);
	if (!index || !isVideoTimingIndexVerifiedForReference(index, reference)) return null;
	return Object.freeze({
		kind: 'vfr' as const,
		reference: reference as Readonly<VideoTimingAssetReference>,
		index,
	});
}

class ImmutableTimingViewMap extends Map<string, VideoSourceTimingView> {
	constructor(entries: readonly (readonly [string, VideoSourceTimingView])[]) {
		super();
		for (const [key, value] of entries) super.set(key, value);
		Object.freeze(this);
	}

	override set(_key: string, _value: VideoSourceTimingView): this {
		throw new TypeError('Video source timing views are immutable.');
	}

	override delete(_key: string): boolean {
		throw new TypeError('Video source timing views are immutable.');
	}

	override clear(): void {
		throw new TypeError('Video source timing views are immutable.');
	}
}
