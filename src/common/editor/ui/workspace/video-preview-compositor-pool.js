/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveVideoKeyframePreviewState } from '../../video-keyframe-preview-state.ts';
import { resolveVideoSourceDisplaySize } from '../../video-source-presentation.ts';
import { applyVideoPreviewDisplaySize } from './video-preview-display-size.ts';

const EMPTY_VIDEO_EFFECT_STACK = Object.freeze([]);

function createEntry() {
	return {
		clipId: null,
		sourceId: null,
		video: null,
		effects: EMPTY_VIDEO_EFFECT_STACK,
		opacity: 0,
		displayWidth: 0,
		displayHeight: 0,
	};
}

export function clearVideoPreviewCompositorEntry(entry) {
	entry.clipId = null;
	entry.sourceId = null;
	entry.video = null;
	entry.effects = EMPTY_VIDEO_EFFECT_STACK;
	entry.opacity = 0;
	entry.displayWidth = 0;
	entry.displayHeight = 0;
	delete entry.renderDescription;
	delete entry.intervalProgress;
}

export function clearVideoPreviewCompositorLayer(layer) {
	for (let entryIndex = 0; entryIndex < layer.entryPool.length; entryIndex += 1) {
		clearVideoPreviewCompositorEntry(layer.entryPool[entryIndex]);
	}
	layer.trackId = null;
	layer.trackIndex = null;
	layer.entries.length = 0;
	delete layer.blendMode;
}

export function clearVideoPreviewCompositorLayers(targetLayers, layerPool) {
	for (let layerIndex = 0; layerIndex < layerPool.length; layerIndex += 1) {
		clearVideoPreviewCompositorLayer(layerPool[layerIndex]);
	}
	targetLayers.length = 0;
}

export function primeVideoPreviewCompositorPool(layerPool, layerCount) {
	while (layerPool.length < layerCount) {
		layerPool.push({
			trackId: null,
			trackIndex: null,
			entries: [],
			entryPool: [createEntry(), createEntry()],
		});
	}
}

export function releaseRetiredVideoPreviewElements(compositor, retiredVideos) {
	while (retiredVideos.length) compositor.releaseVideo(retiredVideos.pop());
}

export function findVideoPreviewTimelineInterval(intervals, timelineFrame) {
	let startIndex = 0;
	let endIndex = intervals.length - 1;
	while (startIndex <= endIndex) {
		const index = (startIndex + endIndex) >> 1;
		const interval = intervals[index];
		if (timelineFrame < interval.timelineStartFrame) endIndex = index - 1;
		else if (timelineFrame >= interval.timelineEndFrame) startIndex = index + 1;
		else return interval;
	}
	return null;
}

export function synchronizeVideoPreviewCompositorLayers(
	targetLayers,
	layerPool,
	timeline,
	timelineFrame,
	videoElements,
	videoEffectBypass,
	displaySizes,
) {
	const interval = findVideoPreviewTimelineInterval(timeline.intervals, timelineFrame);
	if (!interval || interval.kind !== 'composition') {
		clearVideoPreviewCompositorLayers(targetLayers, layerPool);
		return true;
	}
	// Validate every authored state before readiness can retain a prior frame and
	// before any reusable pool entry is mutated.
	const keyframeStates = resolveKeyframeStates(interval, timeline, timelineFrame);
	for (let layerIndex = 0; layerIndex < interval.layers.length; layerIndex += 1) {
		const layer = interval.layers[layerIndex];
		for (let clipIndex = 0; clipIndex < layer.clips.length; clipIndex += 1) {
			const clip = layer.clips[clipIndex];
			if (!timeline.clipStateById.get(clip.clipId)?.available) continue;
			const video = videoElements.get(clip.clipId);
			synchronizeExactPresentation(timeline, clip, timelineFrame, video);
			if (
				targetLayers.length
					&& (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight)
			) return false;
		}
	}
	const intervalProgress = Math.max(0, Math.min(
		1,
		(timelineFrame - interval.timelineStartFrame)
			/ Math.max(1, interval.timelineEndFrame - interval.timelineStartFrame),
	));
	let targetLayerCount = 0;
	for (let layerIndex = 0; layerIndex < interval.layers.length; layerIndex += 1) {
		const layer = interval.layers[layerIndex];
		const targetLayer = layerPool[targetLayerCount];
		targetLayers[targetLayerCount] = targetLayer;
		targetLayer.trackId = layer.trackId;
		targetLayer.trackIndex = layer.trackIndex;
		let targetEntryCount = 0;
		for (let clipIndex = 0; clipIndex < layer.clips.length; clipIndex += 1) {
			const clip = layer.clips[clipIndex];
			if (!timeline.clipStateById.get(clip.clipId)?.available) continue;
			const targetEntry = targetLayer.entryPool[targetEntryCount];
			targetLayer.entries[targetEntryCount] = targetEntry;
			targetEntry.clipId = clip.clipId;
			targetEntry.sourceId = clip.sourceId || clip.source?.id || null;
			targetEntry.video = videoElements.get(clip.clipId) || null;
			applyVideoPreviewDisplaySize(displaySizes, clip.source, targetEntry, targetEntry.video);
			const keyframeState = keyframeStates.get(clip) || null;
			targetEntry.effects = videoEffectBypass.effectsFor(
				clip.clipId,
				keyframeState?.videoEffects
					|| clip.clip?.videoEffects
					|| EMPTY_VIDEO_EFFECT_STACK,
			);
			const renderDescription = keyframeState?.renderDescription || clip.renderDescription;
			targetEntry.opacity = keyframeState
				? keyframeState.renderDescription.opacityStart
				: clip.opacityStart + (clip.opacityEnd - clip.opacityStart) * intervalProgress;
			if (renderDescription) {
				targetEntry.renderDescription = renderDescription;
				targetEntry.intervalProgress = keyframeState ? 0 : intervalProgress;
			} else {
				delete targetEntry.renderDescription;
				delete targetEntry.intervalProgress;
			}
			targetEntryCount += 1;
		}
		for (let entryIndex = targetEntryCount; entryIndex < targetLayer.entryPool.length; entryIndex += 1) {
			clearVideoPreviewCompositorEntry(targetLayer.entryPool[entryIndex]);
		}
		targetLayer.entries.length = targetEntryCount;
		const renderDescription = targetLayer.entries
			.find((entry) => entry.renderDescription)?.renderDescription;
		if (renderDescription) targetLayer.blendMode = renderDescription.blendMode;
		else delete targetLayer.blendMode;
		targetLayerCount += 1;
	}
	for (let layerIndex = targetLayerCount; layerIndex < layerPool.length; layerIndex += 1) {
		clearVideoPreviewCompositorLayer(layerPool[layerIndex]);
	}
	targetLayers.length = targetLayerCount;
	return true;
}

function synchronizeExactPresentation(timeline, clip, timelineFrame, video) {
	if (!video || typeof timeline.resolveClipPresentation !== 'function') return;
	const descriptor = timeline.resolveClipPresentation({
		clip: clip.clip,
		source: clip.source,
		timelineSample: timelineFrame,
	});
	if (!descriptor) return;
	const exact = descriptor.sourceTime;
	if (!exact || typeof exact.numerator !== 'bigint' || typeof exact.denominator !== 'bigint'
		|| exact.denominator <= 0n) throw new TypeError('Exact program preview source time is invalid.');
	// Seek inside the drawable frame's half-open interval when the descriptor
	// carries one: a reverse cell's exact source time equals the interval's
	// exclusive end, and seeking that boundary presents the next frame instead
	// of the picture the export path delivers.
	const interior = drawableIntervalInterior(descriptor);
	const targetTime = interior !== null ? interior : Number(exact.numerator) / Number(exact.denominator);
	if (!Number.isFinite(targetTime) || targetTime < 0) {
		throw new RangeError('Exact program preview source time exceeds the browser media range.');
	}
	video.pause?.();
	if (Math.abs((Number(video.currentTime) || 0) - targetTime) <= 0.000001) return;
	try {
		video.currentTime = targetTime;
	} catch {
		// Metadata readiness callbacks and the next compositor pass retry the exact seek.
	}
}

function drawableIntervalInterior(descriptor) {
	const start = exactRationalSeconds(descriptor.drawableSourceStartTime);
	const end = exactRationalSeconds(descriptor.drawableSourceEndTime);
	if (start === null || end === null || !(start < end)) return null;
	const midpoint = (start + end) / 2;
	return midpoint >= start && midpoint < end ? midpoint : start;
}

function exactRationalSeconds(value) {
	if (!value || typeof value !== 'object' || typeof value.numerator !== 'bigint'
		|| typeof value.denominator !== 'bigint' || value.denominator <= 0n) return null;
	const result = Number(value.numerator) / Number(value.denominator);
	return Number.isFinite(result) ? result : null;
}

function resolveKeyframeStates(interval, timeline, timelineFrame) {
	const states = new Map();
	for (const layer of interval.layers) {
		for (const clip of layer.clips) {
			if (!timeline.clipStateById.get(clip.clipId)?.available) continue;
			const state = resolveVideoKeyframePreviewState(timeline.keyframeStateProvider, {
				clip: clip.clip,
				timelineSample: timelineFrame,
				sourceDisplaySize: resolveVideoSourceDisplaySize(clip.source),
				canvas: timeline.renderCanvas,
				transitionWeight: previewTransitionWeight(layer, clip, timelineFrame, timeline),
			});
			if (state) states.set(clip, state);
		}
	}
	return states;
}

function previewTransitionWeight(layer, clip, timelineFrame, timeline) {
	if (clip.role === 'single' || layer.clips.length === 1) return 1;
	if (typeof timeline.resolveTransitionWeight === 'function') {
		const exact = timeline.resolveTransitionWeight(clip.clipId, timelineFrame);
		if (exact !== null && exact !== undefined) {
			if (!Number.isFinite(exact) || exact < 0 || exact > 1) {
				throw new RangeError('An exact video transition weight must be between zero and one.');
			}
			return exact;
		}
	}
	const outgoing = layer.clips.find((candidate) => candidate.role === 'outgoing');
	const incoming = layer.clips.find((candidate) => candidate.role === 'incoming');
	if (!outgoing || !incoming) throw new RangeError('A preview transition requires outgoing and incoming clips.');
	const start = Number(incoming.clip?.timelineStartFrame);
	const end = Number(outgoing.clip?.timelineStartFrame) + Number(outgoing.clip?.durationFrames);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) {
		throw new RangeError('A preview transition requires an exact positive sample interval.');
	}
	const progress = Math.max(0, Math.min(1, (timelineFrame - start) / (end - start)));
	return clip.role === 'outgoing' ? 1 - progress : progress;
}

export { EMPTY_VIDEO_EFFECT_STACK };
