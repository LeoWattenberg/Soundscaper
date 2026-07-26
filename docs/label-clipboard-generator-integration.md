# Label, clipboard, and generator service integration

These strict services replace the controller-local label I/O, split/paste/
disjoin preparation, and signal generation bodies. They retain the public action
names and serializable command payloads. The async services capture both the
controller task and the exact project generation; do not wrap them in another
unscoped async layer.

## Imports

Add direct service imports beside the other controller services:

```js
import { createLabelService } from './controller/label-service.ts';
import { createClipboardEditService } from './controller/clipboard-edit-service.ts';
import { createAudioGeneratorService } from './controller/generator-service.ts';
```

After the local implementations are deleted, remove the now-unused
`parseAudioEditorLabels`, `serializeAudioEditorLabels`,
`generateAudioEditorSignal`, `prepareLinkedSplitCommand`, `generatorName`,
`labelExportFileName`, and `labelMimeType` imports from `app.js`. Also remove
`collectClipTransformIds` if no other extraction has introduced a remaining
caller. Keep `createAddLabelTrackCommand` (Nyquist label persistence),
`prepareSplitCommand` (the edit service), `preparePasteCommand` (selection
effect persistence), `stripExtension` (media import), and `saveLabelExport`
(the label-service adapter).

## Composition

Create the label service after `state`, `fileService`, and the project/lifetime
generations exist:

```js
const labelService = createLabelService({
	lifetime,
	projectGeneration,
	state,
	copy,
	getProject: () => project,
	editingBlocked,
	createId: createStableId,
	commit,
	setStatus,
	publish: publishDocumentSnapshot,
	saveExport: (result) => saveLabelExport(result, options.saveLabelFile, fileService),
});
```

Create the clipboard service before `createEditorEditService`, because that
service consumes three of its methods as ports:

```js
const clipboardEditService = createClipboardEditService({
	lifetime,
	state,
	copy,
	session: sessionController,
	sourceBuffers,
	getProject: () => project,
	editingBlocked,
	getPositionFrames: () => engine.getPositionFrames(),
	normalizeFrame: normalizeTimelineFrame,
	snapFrame: snapTimelineFrame,
	createId: createStableId,
	commit,
	setStatus,
});
```

Create the generator after `persistAudacityEffectResults` exists. Preserve the
scope object when adapting the effect-result port: its `signal`, captured
`project`, and `assertCurrent` callback are part of the transaction contract.

```js
const audioGeneratorService = createAudioGeneratorService({
	lifetime,
	projectGeneration,
	state,
	copy,
	store,
	sourceBuffers,
	sourcePeaks,
	sourceChunkFrames: SOURCE_CHUNK_FRAMES,
	getProject: () => project,
	editingBlocked,
	getPositionFrames: () => engine.getPositionFrames(),
	snapFrame: snapTimelineFrame,
	trackChannelCount: audioTrackChannelCountV2,
	effectTargets: audacityEffectTargets,
	persistEffectResults: (results, type, scope) => (
		persistAudacityEffectResults(results, type, scope)
	),
	preflightStorage,
	getAudioContext: () => engine.getAudioContext({ resume: false }),
	createBuffer: (channels, sampleRate, context) => (
		bufferFromChannels([...channels], sampleRate, context, copy)
	),
	writeBuffer,
	cacheSourceBuffer,
	generatePeaks: (channels) => generateWaveformPeaks([...channels], copy),
	peakCacheKey,
	createId: createStableId,
	commit,
	setStatus,
	publish: publishDocumentSnapshot,
});
```

## Exact local-function replacement and deletion map

Keep the hoisted controller function names because the action facade and edit
service already consume them. Replace each body with only the corresponding
delegate:

```js
function importLabelFile(...args) {
	return labelService.importLabelFile(...args);
}
function exportLabels(...args) {
	return labelService.exportLabels(...args);
}
function setSessionClipboard(...args) {
	return clipboardEditService.setSessionClipboard(...args);
}
function splitAtFrame(...args) {
	return clipboardEditService.splitAtFrame(...args);
}
function commitSplitAtFrames(...args) {
	return clipboardEditService.commitSplitAtFrames(...args);
}
function prepareControllerPaste(...args) {
	return clipboardEditService.prepareControllerPaste(...args);
}
function disjoinSelectedClip(...args) {
	return clipboardEditService.disjoinSelectedClip(...args);
}
function generateSelectionSilence(...args) {
	return audioGeneratorService.generateSelectionSilence(...args);
}
function generateSignal(...args) {
	return audioGeneratorService.generateSignal(...args);
}
```

Delete the complete old bodies beginning at `importLabelFile` and ending after
`generateSignal`; retain the unrelated track-transform delegates that occur
immediately before that range and the selection-view delegates immediately
after it. Do not retain local copies of `collectSplitTargetClipIds` or the
clipboard lane-pair helpers: they are private service implementation details.

The edit service wiring may either keep the delegate names shown above or use
the service methods directly:

```js
commitSplitAtFrames: clipboardEditService.commitSplitAtFrames,
prepareControllerPaste: clipboardEditService.prepareControllerPaste,
setSessionClipboard: clipboardEditService.setSessionClipboard,
```

The services preserve descending multi-split preparation, preassigned replay
IDs, linked A/V expansion, one atomic paste/disjoin batch, selected-label export
behavior, source rollback, and current action-group names.

## Focused validation

```sh
node --import tsx --test \
	tests/audio-editor-label-service.test.ts \
	tests/audio-editor-clipboard-edit-service.test.ts \
	tests/audio-editor-generator-service.test.ts
npm run typecheck
npm run lint
npm test
```
