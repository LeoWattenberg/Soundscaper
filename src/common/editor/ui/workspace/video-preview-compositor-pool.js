/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveVideoKeyframePreviewState } from '../../video-keyframe-preview-state.ts';
import { resolveVideoSourceDisplaySize } from '../../video-source-presentation.ts';
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
		let targetEntryCount = 0;
		for (let clipIndex = 0; clipIndex < layer.clips.length; clipIndex += 1) {
			const clip = layer.clips[clipIndex];
			if (!timeline.clipStateById.get(clip.clipId)?.available) continue;
			const targetEntry = targetLayer.entryPool[targetEntryCount];
			targetLayer.entries[targetEntryCount] = targetEntry;
			targetEntry.clipId = clip.clipId;
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
				transitionWeight: previewTransitionWeight(layer, clip, timelineFrame),
			});
			if (state) states.set(clip, state);
		}
	}
	return states;
}

function previewTransitionWeight(layer, clip, timelineFrame) {
	if (clip.role === 'single' || layer.clips.length === 1) return 1;
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
