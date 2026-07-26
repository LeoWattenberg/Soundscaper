# Recording service integration

The strict services in `src/common/editor/controller/recording-session-service.ts`
and `timed-recording-service.ts` are extraction targets for the recording block
in `app.js`. They are intentionally not wired into `app.js` in the same change:
the compatibility controller remains unchanged while the ports and concurrency
semantics can be reviewed and tested independently.

## Ownership

`createRecordingSessionService` owns:

- the mutable `recordingStartPromise` single-flight guard;
- recording-start generation tokens and project/disposal assertions;
- the joinable `recordingFinalizePromise` identity guard;
- stop-error ordering (stop, finalize, then rethrow the stop failure);
- pause and lead-in state transitions; and
- the one common terminal reset/release/publish sequence.

The controller continues to own browser capture and project transactions. Its
`beginRecording` port selects the existing legacy or routed capture operation.
Its two finalization ports commit or roll back the recorded source; they must
not clear controller recording state because the service now does that once.

`createTimedRecordingService` owns:

- parallel input permission and AudioContext preparation from the confirming
  user action;
- timer generation invalidation and bounded re-arming;
- the immutable scheduled-recording descriptor;
- cancellation of preparation and prepared-recorder disposal; and
- transition from an armed recorder to active recording.

## Wiring order

Create the services after controller state and capture dependencies exist. A
small `let timedRecordingService` indirection resolves the two intentional
ports between them:

```js
let timedRecordingService;
const recordingSessionService = createRecordingSessionService({
	state,
	getProjectId: () => project?.id || null,
	abortError,
	addTrack: (options) => addTrack(options),
	stopProjectBinPreview,
	cancelTimedRecording: () => timedRecordingService.cancelTimedRecording(),
	beginRecording: (options, scope) => {
		const route = options.trackId ? state.recordingRouting.routes[options.trackId] : null;
		const routed = route && (route.kind === 'display'
			|| route.deviceId !== RECORDING_DEFAULT_DEVICE_ID
			|| route.channelStart > 0
			|| route.channelCount !== 2);
		return options.trackId && !routed
			? startLegacyRecordingCapture(options, scope)
			: startRoutedRecordingCapture(options, scope);
	},
	performLegacyFinalization: finalizeLegacyRecordingTransaction,
	performRoutedFinalization: finalizeRoutedRecordingTransaction,
	releaseUnretainedRecordingInputs,
	retainInputs: () => state.preferences.recording.retainInputs,
	playTransport: () => engine.play(),
	pauseTransport: () => engine.pause(),
	getTransportState: () => engine.getState().state,
	updateTransportState,
	persistLeadIn: (enabled) => persistSetting('recording-lead-in', enabled),
	publishDocumentSnapshot,
	publishTelemetrySnapshot,
	syncRecordingPoolSnapshot,
	handleError,
});

timedRecordingService = createTimedRecordingService({
	state,
	getProjectId: () => project?.id || null,
	normalizeStartTime: normalizeTimedRecordingStart,
	currentTimeMs,
	prepareInputs: prepareTimedRecordingInputs,
	prepareContext: async () => {
		const context = await engine.getAudioContext();
		await context.resume();
	},
	startRecording: recordingSessionService.startRecording,
	cancelRecordingStart: recordingSessionService.cancelRecordingStart,
	finalizeRecording: recordingSessionService.finalizeRecording,
	activatePreparedRecording: activatePreparedTimedRecording,
	scheduleTimer,
	clearTimer: clearScheduledTimer,
	maximumTimerDelayMs: MAXIMUM_TIMER_DELAY_MS,
	retainInputs: () => state.preferences.recording.retainInputs,
	releaseUnretainedRecordingInputs,
	syncRecordingPoolSnapshot,
	publishDocumentSnapshot,
	setStatus,
	handleError,
	abortError,
	formatScheduledTime: (value) => new Date(value).toLocaleString(locale),
	messages: {
		projectReadOnly: copy.projectReadOnly,
		past: copy.timedRecordingPast,
		preparing: copy.timedRecordingPreparing,
		missed: copy.timedRecordingMissed || copy.timedRecordingPast,
		scheduled: (time) => copy.timedRecordingScheduled.replace('{time}', time),
		cancelled: copy.timedRecordingCancelled,
	},
});
```

## Moving the existing bodies

1. Rename the bodies of `startLegacyRecording` and `startRoutedRecording` to
   capture operations and accept the supplied `RecordingStartScope`. Replace
   calls to `assertRecordingStartActive(token)` with `scope.assertCurrent()`.
   Their existing resource-local catch blocks remain responsible for aborting
   unhanded writers/controllers.
2. Replace the controller-local `createRoutedRecordingController` with the
   exported helper. Keep constructing its source-session objects in the
   composition root, where browser capture controllers and route metadata are
   already available.
3. Move only the transactional `try` bodies from legacy and routed finalizers
   into the two finalization ports. Keep committed-source rollback there. Drop
   their duplicated `recordingFinishing` assignment and common `finally` reset;
   the session service owns both.
4. Move the current `beginTimedRecording` activation body (route-health update,
   `engine.play()`, status, transport state, and snapshot) into
   `activatePreparedRecording`. Input grouping/acquisition remains behind the
   typed `prepareInputs` port.
5. Replace the controller action references with the two service objects. Do
   not retain parallel wrappers for `recordingStartPromise` or
   `recordingFinalizePromise`; having two owners defeats the identity guards.
6. Run the focused service tests, the existing recording controller/browser
   tests, `npm run typecheck`, and the full Node suite before deleting the old
   local functions.

The port interfaces are the authoritative dependency list. Adding an ambient
controller closure dependency to either service should be treated as a failed
extraction: add a named typed port or keep the operation in the composition
root until its ownership is clear.
