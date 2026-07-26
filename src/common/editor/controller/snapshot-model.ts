/* SPDX-License-Identifier: AGPL-3.0-only */

interface VideoEffectLike {
	readonly id: string;
	readonly params: unknown;
}

interface VideoClipLike {
	readonly id: string;
	readonly kind: string;
	readonly videoEffects?: readonly VideoEffectLike[];
}

interface VideoGestureProject {
	readonly clips: readonly VideoClipLike[];
}

interface VideoEffectGesture {
	readonly params: unknown;
}

export function applyVideoEffectGesturePreviews<Project extends VideoGestureProject>(
	project: Project | null,
	gestures: ReadonlyMap<string, VideoEffectGesture>,
	gestureKey: (clipId: string, effectId: string) => string,
): Project | null {
	if (!project || !gestures.size) return project;
	let changed = false;
	const clips = project.clips.map((clip) => {
		if (clip.kind !== 'video' || !Array.isArray(clip.videoEffects)) return clip;
		let clipChanged = false;
		const videoEffects = clip.videoEffects.map((effect) => {
			const gesture = gestures.get(gestureKey(clip.id, effect.id));
			if (!gesture) return effect;
			clipChanged = true;
			return { ...effect, params: structuredClone(gesture.params) };
		});
		if (!clipChanged) return clip;
		changed = true;
		return { ...clip, videoEffects };
	});
	return changed ? { ...project, clips } as Project : project;
}

export interface EditorTelemetryState {
	readonly positionFrame: number;
	readonly durationFrames: number;
	readonly transportState: string;
	readonly recorder: unknown;
	readonly timedRecording: unknown;
	readonly timedRecordingCancelling: boolean;
	readonly meters: unknown;
	readonly inputMeterDb: number;
	readonly inputMeter: unknown;
	readonly inputMeters: Readonly<Record<string, unknown>>;
	readonly exportProgress: number;
}

export interface EditorTelemetryEngine {
	getState?(): Readonly<{ playbackMode?: string; playbackRate?: number }>;
}

export function createEditorTelemetrySnapshot(
	state: EditorTelemetryState,
	engine: EditorTelemetryEngine,
) {
	const playback = engine.getState?.() || {};
	return Object.freeze({
		positionFrame: state.positionFrame,
		durationFrames: state.durationFrames,
		transportState: state.transportState,
		playbackMode: playback.playbackMode || 'normal',
		playbackRate: Number(playback.playbackRate) || 1,
		recording: Boolean(state.recorder && !state.timedRecording && !state.timedRecordingCancelling),
		meters: state.meters,
		inputMeterDb: state.inputMeterDb,
		inputMeter: state.inputMeter,
		inputMeters: Object.freeze({ ...state.inputMeters }),
		exportProgress: state.exportProgress,
	});
}

interface AudioDeviceLike {
	readonly deviceId: string;
}

interface RecordingPoolSourceLike {
	readonly kind: string;
}

export interface AudioDeviceSnapshotState {
	readonly preferredInputDeviceId: string;
	readonly preferredInputChannelCount: number;
	readonly preferredOutputDeviceId: string;
	readonly activeOutputDeviceId: string;
	readonly audioInputAccess: boolean;
	readonly audioInputDevices: readonly AudioDeviceLike[];
	readonly audioOutputDevices: readonly AudioDeviceLike[];
	readonly recordingPoolSources: readonly RecordingPoolSourceLike[];
	readonly audioOutputStatus: string;
}

export interface AudioDeviceEngine {
	getOutputDeviceState?(): Readonly<{ activeDeviceId?: string; supported?: boolean }>;
}

export interface AudioMediaDevices {
	readonly getUserMedia?: unknown;
	readonly getDisplayMedia?: unknown;
}

export function createAudioDeviceSnapshot(
	state: AudioDeviceSnapshotState,
	engine: AudioDeviceEngine,
	mediaDevices: AudioMediaDevices | null | undefined,
	defaultInputDeviceId: string,
	displayInputDeviceId: string,
) {
	const outputState = engine.getOutputDeviceState?.() || {};
	const preferredInputAvailable = state.preferredInputDeviceId === defaultInputDeviceId
		|| (state.preferredInputDeviceId === displayInputDeviceId && Boolean(mediaDevices?.getDisplayMedia))
		|| state.audioInputDevices.some((device) => device.deviceId === state.preferredInputDeviceId);
	const preferredOutputAvailable = !state.preferredOutputDeviceId
		|| state.audioOutputDevices.some((device) => device.deviceId === state.preferredOutputDeviceId);
	return Object.freeze({
		inputs: Object.freeze(state.audioInputDevices),
		outputs: Object.freeze(state.audioOutputDevices),
		preferredInputDeviceId: state.preferredInputDeviceId,
		preferredInputChannelCount: state.preferredInputChannelCount,
		preferredOutputDeviceId: state.preferredOutputDeviceId,
		activeOutputDeviceId: outputState.activeDeviceId ?? state.activeOutputDeviceId,
		inputAccess: state.audioInputAccess,
		inputSupported: Boolean(mediaDevices?.getUserMedia || mediaDevices?.getDisplayMedia),
		microphoneInputSupported: Boolean(mediaDevices?.getUserMedia),
		displayInputSupported: Boolean(mediaDevices?.getDisplayMedia),
		displayCaptureOpen: state.recordingPoolSources.some((source) => source.kind === 'display'),
		outputSupported: Boolean(outputState.supported),
		preferredInputAvailable,
		preferredOutputAvailable,
		outputStatus: state.audioOutputStatus,
	});
}
