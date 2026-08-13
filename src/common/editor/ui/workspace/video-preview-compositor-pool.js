/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyVideoPreviewDisplaySize } from './video-preview-display-size.ts';

const EMPTY_VIDEO_EFFECT_STACK = Object.freeze([]);

function createEntry() {
	return {
		clipId: null,
		video: null,
		effects: EMPTY_VIDEO_EFFECT_STACK,
		opacity: 0,
		displayWidth: 0,
		displayHeight: 0,
	};
}

export function clearVideoPreviewCompositorEntry(entry) {
	entry.clipId = null;
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
	layer.entries.length = 0;
	delete layer.blendMode;
}

export function primeVideoPreviewCompositorPool(layerPool, layerCount) {
	while (layerPool.length < layerCount) {
		layerPool.push({
			trackId: null,
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
		for (let layerIndex = 0; layerIndex < layerPool.length; layerIndex += 1) {
			clearVideoPreviewCompositorLayer(layerPool[layerIndex]);
		}
		targetLayers.length = 0;
		return true;
	}
	for (let layerIndex = 0; layerIndex < interval.layers.length; layerIndex += 1) {
		const layer = interval.layers[layerIndex];
		for (let clipIndex = 0; clipIndex < layer.clips.length; clipIndex += 1) {
			const clip = layer.clips[clipIndex];
			if (!timeline.clipStateById.get(clip.clipId)?.available) continue;
			const video = videoElements.get(clip.clipId);
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
		const renderDescription = layer.clips.find((clip) => clip.renderDescription)?.renderDescription;
		if (renderDescription) targetLayer.blendMode = renderDescription.blendMode;
		else delete targetLayer.blendMode;

		let targetEntryCount = 0;
		for (let clipIndex = 0; clipIndex < layer.clips.length; clipIndex += 1) {
			const clip = layer.clips[clipIndex];
			if (!timeline.clipStateById.get(clip.clipId)?.available) continue;
			const targetEntry = targetLayer.entryPool[targetEntryCount];
			targetLayer.entries[targetEntryCount] = targetEntry;
			targetEntry.clipId = clip.clipId;
			targetEntry.video = videoElements.get(clip.clipId) || null;
			applyVideoPreviewDisplaySize(displaySizes, clip.source, targetEntry, targetEntry.video);
			targetEntry.effects = videoEffectBypass.effectsFor(
				clip.clipId,
				clip.clip?.videoEffects || EMPTY_VIDEO_EFFECT_STACK,
			);
			targetEntry.opacity = clip.opacityStart
				+ (clip.opacityEnd - clip.opacityStart) * intervalProgress;
			if (clip.renderDescription) {
				targetEntry.renderDescription = clip.renderDescription;
				targetEntry.intervalProgress = intervalProgress;
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
		targetLayerCount += 1;
	}
	for (let layerIndex = targetLayerCount; layerIndex < layerPool.length; layerIndex += 1) {
		clearVideoPreviewCompositorLayer(layerPool[layerIndex]);
	}
	targetLayers.length = targetLayerCount;
	return true;
}

export { EMPTY_VIDEO_EFFECT_STACK };
