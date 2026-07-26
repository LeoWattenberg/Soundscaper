# Clip editing service integration

The four strict services replace the controller-local implementations without
changing the public action names or command payloads.

## Imports

Add direct imports beside the other controller services:

```js
import { createClipTransformService } from './controller/clip-transform-service.ts';
import { createClipPropertyService } from './controller/clip-property-service.ts';
import { createClipTimePitchCacheService } from './controller/clip-time-pitch-service.ts';
import { createClipTimePitchRenderService } from './controller/clip-time-pitch-render-service.ts';
```

Once the legacy bodies are gone, remove the unused `collectClipTrimIds`,
`prepareOverwriteClipCommand`, `prepareTransformClipsCommand`,
`clipNeedsTimePitchRender`, and `scaleClipEnvelope` imports. Keep
`collectClipTransformIds` while the non-service range-edit path still uses it.

## Composition

Create the cache service after `state`, `engine`, the source maps, and
`clipTimePitchSourceResolver` exist. Its methods replace the same-named local
cache helpers.

```js
const clipTimePitchCacheService = createClipTimePitchCacheService({
	lifetime,
	state,
	cache: clipTimePitchCache,
	sourceResolver: clipTimePitchSourceResolver,
	sourceChunkProviders,
	getProject: () => project,
	captureProject: (projectId) => projectGeneration.capture(projectId),
	assertProject: (token) => projectGeneration.assertCurrent(token),
	createBufferFromChannels: async (channels, sampleRate) => {
		const context = await engine.getAudioContext?.({ resume: false });
		return bufferFromChannels([...channels], sampleRate, context, copy);
	},
	createRenderEngine: (renderOptions) => renderEngineFactory(renderOptions),
	applyProjectToPlaybackEngine,
	getPlaybackState: () => engine.getState().state,
	handleError,
});
const {
	beginPlaybackCachePreparation,
	cancelPlaybackCachePreparation,
	createCacheAwareRenderEngine,
	prepareCommittedTimePitchCaches,
	projectHasTimePitchClips,
} = clipTimePitchCacheService;
```

Create the edit services beside the existing track/sample services:

```js
const clipTransformService = createClipTransformService({
	lifetime,
	copy,
	getProject: () => project,
	getSelectedClipId: () => state.selectedClipId,
	editingBlocked,
	createId: createStableId,
	snapTimelineFrame,
	activeSelection,
	commit,
});
const clipPropertyService = createClipPropertyService({
	lifetime,
	copy,
	sourceBuffers,
	getProject: () => project,
	getSelectedClipId: () => state.selectedClipId,
	editingBlocked,
	captureProject: () => projectGeneration.capture(project?.id ?? null),
	assertProject: (token) => projectGeneration.assertCurrent(token),
	analyzeChannels: (channels, sampleRate, signal) => (
		analyzeChannelsInWorker([...channels], sampleRate, copy, 65_536, signal)
	),
	createId: createStableId,
	commit,
});
const clipTimePitchRenderService = createClipTimePitchRenderService({
	lifetime,
	copy,
	store,
	sourceBuffers,
	sourcePeaks,
	sourceChunkFrames: SOURCE_CHUNK_FRAMES,
	getProject: () => project,
	getSelectedClipId: () => state.selectedClipId,
	editingBlocked,
	captureProject: () => projectGeneration.capture(project?.id ?? null),
	assertProject: (token) => projectGeneration.assertCurrent(token),
	prepareCommittedOutput: (clip, source, { signal }) => (
		clipTimePitchCache.prepareCommittedOutput(clip, source, { signal })
	),
	materializeEntry: (entry, signal) => (
		clipTimePitchCacheService.materializeTimePitchCacheEntry(entry, signal)
	),
	preflightStorage,
	createId: createStableId,
	writeBuffer,
	generateWaveformPeaks: (channels) => generateWaveformPeaks([...channels], copy),
	peakCacheKey,
	cacheSourceBuffer,
	commit,
	setProcessing: (processing) => { state.audacityEffectProcessing = processing; },
	setStatus,
	publish: publishDocumentSnapshot,
});
```

## Exact local-function replacements

Keep the existing hoisted function names because the action facade and other
services already receive them. Replace each body with only its delegation:

```js
function handleClipAction(...args) {
	return clipPropertyService.handleClipAction(...args);
}
function moveClips(...args) {
	return clipTransformService.moveClips(...args);
}
function moveClipsToNewTrack(...args) {
	return clipTransformService.moveClipsToNewTrack(...args);
}
function trimClips(...args) {
	return clipTransformService.trimClips(...args);
}
function overwriteClips(...args) {
	return clipTransformService.overwriteClips(...args);
}
function setClipTimePitch(...args) {
	return clipPropertyService.setClipTimePitch(...args);
}
function stretchClip(...args) {
	return clipPropertyService.stretchClip(...args);
}
function resetClipPitchSpeed(...args) {
	return clipPropertyService.resetClipPitchSpeed(...args);
}
function renderClipPitchSpeed(...args) {
	return clipTimePitchRenderService.renderClipPitchSpeed(...args);
}
```

Delete the local `projectTimePitchPairs`, `projectHasTimePitchClips`,
`createCacheAwareRenderEngine`, `materializeTimePitchCacheEntry`,
`prepareCommittedTimePitchCaches`, `preparePlaybackTimePitchCaches`,
`beginPlaybackCachePreparation`, `cancelPlaybackCachePreparation`, and
`handlePlaybackCacheError` bodies. Do not retain parallel cache generations or
render promises.

Finally, change the action-facade `toggleStretchToTempo` callback to
`clipPropertyService.toggleStretchToTempo`. The service preserves the existing
action grouping, stable IDs, one-command history grouping, linked A/V lane
behavior, selection translation, and StaffPad cache contract.
