# Timed-recording input service integration

`src/common/editor/controller/timed-recording-input-service.ts` is the strict
TypeScript replacement for the controller-local `prepareTimedRecordingInputs`
body. It is intentionally staged without changing `app.js`: the existing
controller action remains authoritative until the adapter below is applied and
the controller integration tests pass.

## Ownership boundary

`createTimedRecordingInputService` owns only:

- resolving an explicit track to the legacy default route or its assigned
  routed input;
- grouping armed tracks by source, with display permission requested first;
- computing the maximum required hardware channel for each source;
- opening or reusing streams through the existing capture pool;
- validating retained-input, live-stream, and channel capabilities; and
- publishing the existing `opening`, `open`, `skipped`, and `unavailable`
  route-health transitions.

It does not release streams. `createTimedRecordingService` remains the single
owner of cancellation and failure release policy: forced cancellation releases
inputs immediately, ordinary failure releases only when input retention is
disabled, and retained partial acquisitions remain available. The preparation
scope passed by that service is also the single generation/project/disposal
guard. The input service asserts it before permission work and after the whole
permission batch, before any late route-health publication.

## Exact import and composition adapter

Add this direct import beside the other controller service imports in
`src/common/editor/app.js`:

```js
import { createTimedRecordingInputService } from './controller/timed-recording-input-service.ts';
```

Create the service after `recordingCapturePool`, `state`, and the `project`
closure exist, and before `createTimedRecordingService` is called:

```js
const timedRecordingInputService = createTimedRecordingInputService({
	getProject: () => project,
	findTrack: (targetProject, trackId) => findTrack(targetProject, trackId) || null,
	projectSampleRate: (targetProject) => Number.isSafeInteger(targetProject.sampleRate)
		&& targetProject.sampleRate > 0 ? targetProject.sampleRate : AUDIO_EDITOR_SAMPLE_RATE,
	getPreferredInputChannelCount: () => state.preferredInputChannelCount,
	getRecordingRoutes: () => state.recordingRouting.routes,
	setRecordingRouteHealth: (trackId, health) => {
		state.recordingRouteHealth[trackId] = health;
	},
	capturePool: recordingCapturePool,
	defaultDeviceId: RECORDING_DEFAULT_DEVICE_ID,
	recordingRouteSourceKey,
	streamAudioChannelCount,
	recordingStreamIsLive,
	messages: {
		armTrack: copy.armTrackForRecording,
		assignInput: 'Assign an input to at least one armed track before recording.',
		preparedInputClosed: 'The prepared recording input closed before the timer was armed.',
		assignedInputsUnavailable: 'Every assigned recording input must remain available for timer recording.',
	},
});
```

Then change exactly one port in the existing timed-recording composition:

```js
timedRecordingService = createTimedRecordingService({
	// Existing ports stay unchanged.
	prepareInputs: timedRecordingInputService.prepareTimedRecordingInputs,
	// Existing ports stay unchanged.
});
```

The scheduler now supplies a second preparation-scope argument. Existing
one-argument JavaScript callbacks remain valid because extra JavaScript
arguments are ignored; do not wrap the extracted method and do not create a
second generation token in `app.js`.

## Exact deletion map

After the adapter is in place:

1. Delete the complete controller-local `async function
   prepareTimedRecordingInputs(options = {})` declaration, from its opening
   line through its closing brace immediately before
   `activatePreparedTimedRecording`.
2. Keep `scheduleTimedRecording` and its public
   `actions.recording.schedule` registration unchanged. The action must still
   delegate to `timedRecordingService.scheduleTimedRecording`.
3. Keep `activatePreparedTimedRecording`; it owns the later transition from an
   armed recorder to engine playback and is not part of input preparation.
4. Keep `recordingCapturePool`, `recordingRouteSourceKey`,
   `streamAudioChannelCount`, `recordingStreamIsLive`,
   `RECORDING_DEFAULT_DEVICE_ID`, and `findTrack` imports. Other recording and
   routing paths in `app.js` still use them.
5. Do not add release calls to the new adapter. Doing so would stop retained
   inputs and would double-release cancelled permission requests.

## Required validation after integration

Run the focused strict-service checks first:

```sh
node --import tsx --test \
	tests/audio-editor-timed-recording-input-service.test.ts \
	tests/audio-editor-timed-recording-service.test.ts
npx c8 --all \
	--include='src/common/editor/controller/timed-recording-input-service.ts' \
	--check-coverage --lines=80 --functions=80 --branches=70 \
	node --import tsx --test tests/audio-editor-timed-recording-input-service.test.ts
```

Then run the controller and repository gates:

```sh
node --import tsx --test tests/audio-editor-recording-controller.test.js
npm run typecheck
npm run lint
npm test
```

The integration is complete only if the timer tests still demonstrate one
permission acquisition per source, prepared-only reuse at unattended start,
forced release on cancellation, and no late route-health mutation after
controller disposal or project replacement.
