# Recording input coordination integration

`createRecordingInputCoordinationService` is the strict extraction target for
the route-assignment and capture-pool callback bodies that remain in `app.js`.
It coordinates existing owners; it does not replace recording routing,
microphone metering, or recording-session finalization.

## Ownership boundaries

The new service owns only:

- applying one track-route mutation around required persistence and source
  acquisition;
- stopping and generation-safely restarting the microphone meter when the
  selected routed input changes;
- ordering pool snapshot publication, scheduled-input cancellation, route
  health reconciliation, device-row refresh, meter reconciliation, and
  document publication; and
- preserving `disconnected` route health while an ended source is absent.

Existing ownership stays unchanged:

- `recording-routing-service.ts` owns `setRecordingSourceLatency`,
  `setRetainInputs`, `releaseInputs`, `releaseUnretainedRecordingInputs`,
  `syncRecordingPoolSnapshot`, routing persistence policy, and device rows;
- `microphone-meter-service.ts` owns meter sessions, generations, replacement
  streams, late `endedSession` rejection, and meter persistence; and
- `recording-session-service.ts` owns active/start/finalization guards and the
  release-after-stop transition.

Do not copy any of those methods into the coordinator. The `routing` and
`meter` objects are explicit ports to the existing owners.

## Import and composition

Add the direct controller import beside the other recording services:

```js
import { createRecordingInputCoordinationService } from './controller/recording-input-coordination-service.ts';
```

Construct the coordinator after `timedRecordingService` has been initialized.
The capture pool may continue receiving the hoisted
`handleRecordingPoolChange` callback during its earlier construction.

```js
const recordingInputCoordinationService = createRecordingInputCoordinationService({
	state,
	capturePool: recordingCapturePool,
	meter: microphoneMeterService,
	routing: {
		persistRecordingRouting: recordingRoutingService.persistRecordingRouting,
		releaseUnretainedRecordingInputs: recordingRoutingService.releaseUnretainedRecordingInputs,
		syncRecordingPoolSnapshot: recordingRoutingService.syncRecordingPoolSnapshot,
		updateRecordingDeviceRows: recordingRoutingService.updateRecordingDeviceRows,
	},
	cancelTimedRecording: timedRecordingService.cancelTimedRecording,
	getTrack: (trackId) => findTrack(project, trackId) || null,
	projectSampleRate,
	publishDocumentSnapshot,
	recordingRouteSourceKey,
	setRecordingTrackRoute,
	streamAudioChannelCount,
});
```

The routing service may keep its existing hoisted
`setRecordingTrackInput` callback. Calls happen after composition is complete,
so that callback can delegate to the coordinator without introducing a second
owner or an editor-module import cycle.

## Exact replacement and deletion map

Keep the public action name and the capture-pool callback name. Replace their
controller-local bodies with delegates:

```js
async function setRecordingTrackInput(trackId, route) {
	return recordingInputCoordinationService.setRecordingTrackInput(trackId, route);
}

function handleRecordingPoolChange(sources) {
	return recordingInputCoordinationService.handleRecordingPoolChange(sources);
}
```

Delete the complete old `setRecordingTrackInput` body beginning with the timed
recording guard and ending with `return normalized`. Delete the complete old
`handleRecordingPoolChange` body beginning with the frozen source assignment
and ending with its conditional document publication.

Delete the now-unused controller-local `reconcileMicrophoneMeterInput`
function. Pool callbacks use
`recordingInputCoordinationService.reconcileMicrophoneMeterInput`, and media
track `ended` callbacks continue to call the microphone-meter service's own
typed reconciliation directly. Do not leave a second route-health loop or
meter-restart sequence in `app.js`.

Keep these compatibility delegates exactly where they are because action and
recording-service consumers already use their names:

```js
async function setRecordingSourceLatency(sourceKey, value) {
	return recordingRoutingService.setRecordingSourceLatency(sourceKey, value);
}
async function setRetainInputs(enabled) {
	return recordingRoutingService.setRetainInputs(enabled);
}
function releaseInputs() {
	return recordingRoutingService.releaseInputs();
}
function releaseUnretainedRecordingInputs({ force = false } = {}) {
	return recordingRoutingService.releaseUnretainedRecordingInputs({ force });
}
function syncRecordingPoolSnapshot() {
	return recordingRoutingService.syncRecordingPoolSnapshot();
}
```

No import from `recording-routing.js` becomes removable: both
`setRecordingTrackRoute` and `recordingRouteSourceKey` remain composition ports
and have other controller consumers.

## Validation after wiring

Run the focused strict suites first:

```sh
node --import tsx --test \
	tests/audio-editor-recording-input-coordination-service.test.ts \
	tests/audio-editor-recording-routing-service.test.ts \
	tests/audio-editor-microphone-meter-service.test.ts \
	tests/audio-editor-recording-session-service.test.ts
```

Then run `npm run typecheck`, focused ESLint, `npm test`, and the existing
recording controller/browser workflows. The coordinator's focused coverage
gate is 80% lines/functions and 70% branches.
