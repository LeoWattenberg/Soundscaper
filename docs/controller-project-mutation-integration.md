# Controller project-mutation integration

The strict services in this change replace the controller-local command,
retention, project publication, timeline-view, and track-duplication bodies.
They keep the public action groups and command payloads unchanged. There must be
only one commit path and one `projectChanged` path after integration.

## Imports

Add these direct imports with the other controller services:

```js
import { createProjectMutationService } from './controller/project-mutation-service.ts';
import { createProjectRetentionService } from './controller/project-retention-service.ts';
import { createProjectViewService } from './controller/project-view-service.ts';
import { createTrackDuplicationService } from './controller/track-duplication-service.ts';
```

`command-capability-policy.ts` is an implementation dependency of the mutation
service and must not be imported through the editor facade. After deleting the
local `updateSelection` implementation, remove `applyEditorCommand` from the
`commands.js` import. Keep `executeEditorCommand`,
`compactEditorHistorySourceMetadata`, `editorHistoryProjects`,
`evictUnreferencedSourceCaches`, `createAddTrackCommand`,
`createAddClipCommand`, and `cloneVideoEffects`: the composition adapters or
other controller services still own callers.

## Composition

Create these services immediately after `projectSaveService`. All callbacks are
hoisted controller functions or lazy closures, so this placement remains safe
before transport and view-state service construction.

```js
const projectRetentionService = createProjectRetentionService({
	state,
	getProject: () => project,
	setProject: (nextProject) => { project = nextProject; },
	compactHistory: compactEditorHistorySourceMetadata,
	sessionTab,
	updateProjectHistory: (projectId, history, updateOptions) => (
		sessionController.updateProjectHistory(projectId, history, updateOptions)
	),
	getSourceReferenceCounts: () => sessionController.getSourceReferenceCounts(),
	getSessionTabs: () => sessionController.getSnapshot().tabs,
	editorHistoryProjects,
	allProjectClips,
	clipCache: clipTimePitchCache,
	sourceBuffers,
	sourcePeaks,
	evictSourceCaches: evictUnreferencedSourceCaches,
});
const projectViewService = createProjectViewService({
	lifetime,
	state,
	getProject: () => project,
	projectDurationFrames,
	editorTimelineDurationFrames,
	projectSampleRate: () => projectSampleRate(),
	maximumTimelinePixels: MAX_TIMELINE_PIXELS,
	synchronizeAutomaticSampleEditMode,
	getEnginePositionFrames: () => engine.getPositionFrames(),
	updatePlayhead,
	publishDocumentSnapshot,
	editingBlocked,
	commit,
});
const projectMutationService = createProjectMutationService({
	lifetime,
	state,
	productName: product.name,
	capabilities,
	projectReadOnlyMessage: copy.projectReadOnly,
	getProject: () => project,
	setProject: (nextProject) => { project = nextProject; },
	getHistory: () => state.history,
	setHistory: (history) => { state.history = history; },
	executeEditorCommand,
	applyEditorCommand,
	retention: projectRetentionService,
	publisher: projectViewService,
	saves: projectSaveService,
	stopProjectBinPreview,
	clearWaveformPcmWindows,
	normalizeRecordingRouting,
	persistRecordingRouting,
	findClip,
	findTrack,
	synchronizeMicrophoneMeterTarget,
	getPlaybackState: () => engine.getState().state,
	projectHasTimePitchClips,
	beginPlaybackCachePreparation,
	applyProjectToPlaybackEngine,
	captureProject: (projectId) => projectGeneration.capture(projectId),
	assertProject: (token) => projectGeneration.assertCurrent(token),
	handleError,
	isExpectedCancellation: (error) => (
		isEditorDisposedError(error) || error?.name === 'AbortError'
	),
});
const trackDuplicationService = createTrackDuplicationService({
	lifetime,
	copySuffix: copy.projectCopySuffix,
	editingBlocked,
	getProject: () => project,
	createId: createStableId,
	findClip,
	cloneVideoEffects,
	createAddTrackCommand,
	createAddClipCommand,
	commit,
});
```

Do not replace `projectSaveService`: it remains the only queue, generation, and
terminal-flush owner. The mutation service delegates its three compatibility
entry points to that serializer.

## Exact local-function replacements

Keep the existing hoisted names because many already-typed services consume
them as narrow ports. Replace their bodies with these delegates:

```js
function commit(...args) {
	return projectMutationService.commit(...args);
}
function updateSelection(...args) {
	return projectMutationService.updateSelection(...args);
}
function projectChanged(...args) {
	return projectMutationService.projectChanged(...args);
}
function scheduleAutosave(...args) {
	return projectMutationService.scheduleAutosave(...args);
}
function saveNow(...args) {
	return projectMutationService.saveNow(...args);
}
function flushProject(...args) {
	return projectMutationService.flushProject(...args);
}
function compactLiveSourceState(...args) {
	return projectRetentionService.compactLiveSourceState(...args);
}
function liveSessionSourceIds() {
	return projectRetentionService.liveSessionSourceIds();
}
function liveSessionClipIds() {
	return projectRetentionService.liveSessionClipIds();
}
function publishProjectState() {
	return projectViewService.publishProjectState();
}
function setTimelineView(...args) {
	return projectViewService.setTimelineView(...args);
}
function setAllTracksView(...args) {
	return projectViewService.setAllTracksView(...args);
}
function duplicateTrack(...args) {
	return trackDuplicationService.duplicateTrack(...args);
}
```

Delete the complete old bodies for `assertCommandCapabilities`,
`clipboardSourceIds`, and every delegated function above. Do not leave a second
routing normalization, cache-retention pass, playback preparation, snapshot
publication, or autosave call in `app.js`; those duplicates would break atomic
history and save ordering.

The project-switch adapter can also use the typed retention service directly:

```js
retainLiveClipIds: projectRetentionService.retainLiveClipIds,
evictUnreferencedSourceCaches: () => evictUnreferencedSourceCaches(
	sourceBuffers,
	sourcePeaks,
	projectRetentionService.liveSessionSourceIds(),
),
```

The service checks lifetime before every mutation, recursively checks nested
batch capabilities, captures the active project generation for async playback
preparation, and suppresses late cancellation. Track duplication still assigns
all replay IDs before a single batch commit, including regenerated rack and
video-effect IDs.

## Focused validation

```sh
node --import tsx --test \
	tests/audio-editor-command-capability-policy.test.ts \
	tests/audio-editor-project-retention-service.test.ts \
	tests/audio-editor-project-mutation-service.test.ts \
	tests/audio-editor-project-view-track-duplication.test.ts
npm run typecheck
npm run lint
npm test
```
