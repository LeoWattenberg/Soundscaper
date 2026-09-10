/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	ClipTimePitchPreparationState,
	ClipTimePitchPreparationWriteScope,
} from '../src/common/editor/controller/clip-time-pitch-service.ts';
import type {
	MicrophoneMeterDependencies,
	MicrophoneMeterState,
} from '../src/common/editor/controller/microphone-meter-service.ts';
import type { OwnedStateAccess } from '../src/common/editor/controller/owned-state.ts';
import type {
	ProjectBootstrapRecordingState,
	ProjectBootstrapRecordingWriteScope,
	ProjectBootstrapTransportState,
	ProjectBootstrapTransportWriteScope,
} from '../src/common/editor/controller/project-bootstrap-service.ts';
import type { RecordingInputCoordinationState } from '../src/common/editor/controller/recording-input-coordination-service.ts';
import type { RecordingRoutingState } from '../src/common/editor/controller/recording-routing-service-types.d.ts';
import type {
	RecordingCompositionDependencies,
	RecordingCompositionState,
} from '../src/common/editor/controller/recording-composition.ts';
import type { RecordingSessionMutableState } from '../src/common/editor/controller/recording-session-service.ts';
import type { ControllerRecordingState } from '../src/common/editor/controller/recording-state.ts';
import type { RecordingCaptureMutableState } from '../src/common/editor/controller/recording-transaction-types.ts';
import type { TimedRecordingMutableState } from '../src/common/editor/controller/timed-recording-service.ts';
import type {
	TrackAudioCompositionDependencies,
	TrackAudioCompositionState,
} from '../src/common/editor/controller/track-audio-composition.ts';
import type {
	TransportCompositionDependencies,
	TransportCompositionState,
} from '../src/common/editor/controller/transport-composition.ts';
import type { ControllerTransportState } from '../src/common/editor/controller/transport-state.ts';

type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type AssertTrue<Value extends true> = Value;
type AssertFalse<Value extends false> = Value;

function checkMicrophoneMeterOwnerWrites(
	state: MicrophoneMeterDependencies['state'],
): void {
	state.inputMeterDb = -12;
	// @ts-expect-error The recording-owned meter cannot write transport state.
	state.transportState = 'playing';
}

function checkCompositionWritableProjections(
	transport: TransportCompositionDependencies['state'],
	trackAudio: TrackAudioCompositionDependencies['state'],
): void {
	transport.pixelsPerSecond = 120;
	transport.sampleEditMode = null;
	transport.timelineViewportWidth = 960;
	transport.autoFitTrackHeight = true;
	transport.visibleTrackHeights = {};
	// @ts-expect-error A transport composition cannot write selection state.
	transport.selectedClipId = null;

	trackAudio.selectedTrackId = null;
	trackAudio.selectedClipId = null;
	trackAudio.selectedAnnotationId = null;
	trackAudio.analysisProcessing = false;
	trackAudio.pixelsPerSecond = 120;
	trackAudio.pinnedPlayhead = true;
	trackAudio.timelineView = 'waveform';
	// @ts-expect-error The track/audio composition only reads the viewport width.
	trackAudio.timelineViewportWidth = 960;
}

function checkRecordingReadInputs(
	capture: RecordingCaptureMutableState,
	session: RecordingSessionMutableState,
	timed: TimedRecordingMutableState,
	coordination: RecordingInputCoordinationState,
	routing: RecordingRoutingState,
	meter: MicrophoneMeterState,
): void {
	// @ts-expect-error Capture admission reads the project lock state.
	capture.readOnly = false;
	// @ts-expect-error Capture reads selection chosen by the selection owner.
	capture.selectedTrackId = null;
	// @ts-expect-error Recording sessions read lifecycle state owned elsewhere.
	session.disposed = false;
	// @ts-expect-error Recording sessions read the active project-bin preview.
	session.projectBinPreview = null;
	// @ts-expect-error Timed recording reads recovery admission state.
	timed.takeCycleRecovery = null;
	// @ts-expect-error Input coordination reads lifecycle state.
	coordination.disposed = false;
	// @ts-expect-error Input coordination reads selection state.
	coordination.selectedTrackId = null;
	// @ts-expect-error Routing reads selection state.
	routing.selectedTrackId = null;
	// @ts-expect-error Metering reads transport state.
	meter.transportState = 'playing';
	// @ts-expect-error Metering reads routing owned by recording routing.
	meter.recordingRouting = { routes: {} };
}

export type RecordingCompositionAcceptsOwnerScope = AssertTrue<IsAssignable<
	OwnedStateAccess<RecordingCompositionState, ControllerRecordingState>,
	RecordingCompositionDependencies['state']
>>;
export type RecordingCompositionRejectsFlatState = AssertFalse<IsAssignable<
	RecordingCompositionState,
	RecordingCompositionDependencies['state']
>>;

export type TransportCompositionAcceptsOwnerScope = AssertTrue<IsAssignable<
	OwnedStateAccess<TransportCompositionState, ControllerTransportState>,
	TransportCompositionDependencies['state']
>>;
export type TransportCompositionRejectsFlatState = AssertFalse<IsAssignable<
	TransportCompositionState,
	TransportCompositionDependencies['state']
>>;

export type TrackAudioCompositionAcceptsOwnerScope = AssertTrue<IsAssignable<
	OwnedStateAccess<TrackAudioCompositionState, ControllerTransportState>,
	TrackAudioCompositionDependencies['state']
>>;
export type TrackAudioCompositionRejectsFlatState = AssertFalse<IsAssignable<
	TrackAudioCompositionState,
	TrackAudioCompositionDependencies['state']
>>;

export type MicrophoneMeterAcceptsOwnerScope = AssertTrue<IsAssignable<
	OwnedStateAccess<MicrophoneMeterState, ControllerRecordingState>,
	MicrophoneMeterDependencies['state']
>>;
export type MicrophoneMeterRejectsFlatState = AssertFalse<IsAssignable<
	MicrophoneMeterState,
	MicrophoneMeterDependencies['state']
>>;

export type PlaybackCacheAcceptsOwnerScope = AssertTrue<IsAssignable<
	OwnedStateAccess<ClipTimePitchPreparationState, ClipTimePitchPreparationState>,
	ClipTimePitchPreparationWriteScope
>>;
export type PlaybackCacheRejectsFlatState = AssertFalse<IsAssignable<
	ClipTimePitchPreparationState,
	ClipTimePitchPreparationWriteScope
>>;

export type BootstrapRecordingAcceptsOwnerScope = AssertTrue<IsAssignable<
	OwnedStateAccess<ProjectBootstrapRecordingState, ProjectBootstrapRecordingState>,
	ProjectBootstrapRecordingWriteScope
>>;
export type BootstrapRecordingRejectsFlatState = AssertFalse<IsAssignable<
	ProjectBootstrapRecordingState,
	ProjectBootstrapRecordingWriteScope
>>;

export type BootstrapTransportAcceptsOwnerScope = AssertTrue<IsAssignable<
	OwnedStateAccess<ProjectBootstrapTransportState, ProjectBootstrapTransportState>,
	ProjectBootstrapTransportWriteScope
>>;
export type BootstrapTransportRejectsFlatState = AssertFalse<IsAssignable<
	ProjectBootstrapTransportState,
	ProjectBootstrapTransportWriteScope
>>;

test('owner-write composition contracts are checked by the TypeScript project', () => {
	assert.equal(typeof checkMicrophoneMeterOwnerWrites, 'function');
	assert.equal(typeof checkCompositionWritableProjections, 'function');
	assert.equal(typeof checkRecordingReadInputs, 'function');
	assert.ok(true);
});
