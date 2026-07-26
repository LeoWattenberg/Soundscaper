# Recording capture/finalization integration

The extracted modules are transaction ports. `recording-session-service.ts`
continues to own start/finalize promise identity, cancellation generations, and
the common recording-state reset. Do not add a second promise owner around
these methods.

## 1. Imports

Import the four factories directly (do not add them to a barrel):

```js
import { createLegacyRecordingCaptureService } from './controller/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from './controller/routed-recording-capture-service.ts';
import { createLegacyRecordingFinalization } from './controller/legacy-recording-finalization.ts';
import { createRoutedRecordingFinalization } from './controller/routed-recording-finalization.ts';
```

## 2. Capture runtime

Create one shared capture runtime next to `recordingSessionService`. The exact
legacy-controller port mapping is:

```js
const captureRuntime = {
	state,
	engine,
	capturePool: recordingCapturePool,
	defaultDeviceId: RECORDING_DEFAULT_DEVICE_ID,
	sourceChunkFrames: SOURCE_CHUNK_FRAMES,
	messages: {
		armTrack: copy.armTrackForRecording,
		preparedInputClosed: 'The prepared recording input closed before the timer was armed.',
		recording: copy.recording,
		recordingLabel: copy.recordingLabel,
		timedRecordingPast: copy.timedRecordingPast,
		assignInput: 'Assign an input to at least one armed track before recording.',
		noInputsAvailable: 'None of the assigned recording inputs are available.',
	},
	getProject: () => project,
	findTrack: (targetProject, trackId) => findTrack(targetProject, trackId),
	projectSampleRate: (targetProject) => Number.isSafeInteger(targetProject.sampleRate)
		&& targetProject.sampleRate > 0 ? targetProject.sampleRate : AUDIO_EDITOR_SAMPLE_RATE,
	activeSelection: (targetProject) => {
		const selection = targetProject.selection;
		return selection && selection.endFrame > selection.startFrame ? selection : null;
	},
	beginPlaybackCachePreparation,
	currentTimeMs,
	createStableId,
	createRecordingName: () => `${copy.recordingLabel} ${new Date().toLocaleTimeString(locale)}`,
	openSourceWriter: async (sourceId, metadata) => createCoalescingSourceWriter(
		await store.beginSourceWrite(sourceId, metadata),
	),
	createPreview: createRecordingPreview,
	createPreviewResampler: createStreamingWindowedSincResampler,
	appendPreview: appendRecordingPreview,
	scaleFrames: scaleRecordingFrames,
	streamAudioChannelCount,
	recordingStreamIsLive,
	createRecorder: recordingControllerFactory,
	preflightStorage,
	startMicrophoneMetering: () => startMicrophoneMetering({ force: true }),
	syncRecordingPoolSnapshot,
	releaseUnretainedRecordingInputs,
	publishDocumentSnapshot,
	publishRecordingPreview,
	updatePlayhead,
	stopRecording,
	finalizeRecording,
	handleError,
	setStatus,
	updateTransportState,
};
const legacyRecordingCapture = createLegacyRecordingCaptureService(captureRuntime);
const routedRecordingCapture = createRoutedRecordingCaptureService({
	...captureRuntime,
	recordingRouteSourceKey,
	createRoutedController: createCoordinatedRoutedRecordingController,
	createLoudnessMeter: createEbuR128Meter,
	getLoudnessMeter: () => ({
		meter: routedInputLoudnessMeter,
		key: routedInputLoudnessMeterKey,
	}),
	setLoudnessMeter: (meter, key) => {
		routedInputLoudnessMeter = meter;
		routedInputLoudnessMeterKey = key;
	},
});
```

Map the existing session-service `beginRecording` branch to
`legacyRecordingCapture.capture(options, scope)` or
`routedRecordingCapture.capture(options, scope)`. Delete the two local capture
bodies only after the existing recording controller tests pass. The supplied
`RecordingStartScope` must be passed through unchanged.

## 3. Finalization runtime

The project scope must capture both the project object and generation before
the first transaction await. The commit adapter must reject a different active
project even when an ID is accidentally reused:

```js
const finalizationRuntime = {
	sourceChunkFrames: SOURCE_CHUNK_FRAMES,
	captureProjectScope: () => {
		const capturedProject = project;
		if (!capturedProject) throw abortError();
		const token = projectGeneration.capture(capturedProject.id);
		return Object.freeze({
			project: capturedProject,
			projectId: capturedProject.id,
			assertCurrent: () => {
				projectGeneration.assertCurrent(token);
				if (project !== capturedProject) throw abortError();
			},
		});
	},
	projectSampleRate: (targetProject) => Number.isSafeInteger(targetProject.sampleRate)
		&& targetProject.sampleRate > 0 ? targetProject.sampleRate : AUDIO_EDITOR_SAMPLE_RATE,
	pauseTransport: () => engine.pause(),
	disposeRecorder: async (recorder) => { await recorder.dispose?.({ stopTracks: false }); },
	appendPreview: appendRecordingPreview,
	scaleFrames: scaleRecordingFrames,
	createStableId,
	createAddSourceCommand,
	preparePunchCommand,
	activateStoredSource,
	commitBatch: (targetProject, commands, selection) => {
		if (targetProject !== project) throw abortError();
		commit({ type: 'batch', commands }, selection);
	},
	setStatusDone: () => setStatus(copy.done, 'success'),
	deactivateSource: (sourceId) => {
		sourceBuffers.delete(sourceId);
		sourceChunkProviders.delete(sourceId);
		sourcePeaks.delete(sourceId);
	},
	deleteStoredSource: (sourceId) => store.deleteSource(sourceId),
};
const legacyRecordingFinalization = createLegacyRecordingFinalization(finalizationRuntime);
const routedRecordingFinalization = createRoutedRecordingFinalization({
	...finalizationRuntime,
	setRouteHealth: (trackId, health) => { state.recordingRouteHealth[trackId] = health; },
	deleteSourceAnalysis: (sourceId) => Promise.resolve(
		store.deleteAnalysis?.(peakCacheKey(sourceId)),
	),
});
```

Map `performLegacyFinalization` to `legacyRecordingFinalization.finalize` and
`performRoutedFinalization` to `routedRecordingFinalization.finalize`. Then
delete both local transaction bodies. Do not move their common cleanup back
into these modules; `recording-session-service.ts` performs that cleanup in one
`finally` block.

## 4. Required focused validation

```sh
node --import tsx --test tests/audio-editor-legacy-recording-capture-service.test.ts \
	tests/audio-editor-routed-recording-capture-service.test.ts \
	tests/audio-editor-recording-finalization-transactions.test.ts \
	tests/audio-editor-recording-session-service.test.ts
npm run typecheck
npm run lint
npm test
```

The capture services intentionally call `scope.assertCurrent()` following each
successful asynchronous boundary and before post-await publication. The
finalizers copy recording inputs up front, carry the captured project through
command preparation and commit, and roll stored data back if project ownership
is lost after a writer commit.
