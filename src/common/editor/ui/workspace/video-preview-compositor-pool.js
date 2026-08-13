/* SPDX-License-Identifier: AGPL-3.0-only */

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
}

export function clearVideoPreviewCompositorLayer(layer) {
	for (let entryIndex = 0; entryIndex < layer.entryPool.length; entryIndex += 1) {
		clearVideoPreviewCompositorEntry(layer.entryPool[entryIndex]);
	}
	layer.trackId = null;
	layer.entries.length = 0;
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

export { EMPTY_VIDEO_EFFECT_STACK };
