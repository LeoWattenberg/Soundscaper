/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_EDIT_BLOCK_REASONS = Object.freeze({
	READ_ONLY: 'read-only',
	IMPORTING: 'importing',
	RECORDING_STARTING: 'recording-starting',
	RECORDING_SCHEDULING: 'recording-scheduling',
	SCHEDULED_RECORDING: 'scheduled-recording',
	RECORDING: 'recording',
	PLAYBACK_PREPARING: 'playback-preparing',
	EXPORTING: 'exporting',
	PROCESSING_EFFECT: 'processing-effect',
	ANALYSIS_PROCESSING: 'analysis-processing',
	SAMPLE_EDIT_PROCESSING: 'sample-edit-processing',
} as const);

export type AudioEditorEditBlockReason = typeof AUDIO_EDITOR_EDIT_BLOCK_REASONS[
	keyof typeof AUDIO_EDITOR_EDIT_BLOCK_REASONS
];

export interface AudioEditorEditBlockingSnapshot {
	readonly readOnly?: unknown;
	readonly importing?: unknown;
	readonly recordingStarting?: unknown;
	readonly recordingScheduling?: unknown;
	readonly scheduledRecording?: unknown;
	readonly recording?: unknown;
	readonly playbackOptions?: Readonly<{ preparing?: unknown }> | null;
	readonly exporting?: unknown;
	readonly processingEffect?: unknown;
	readonly analysisProcessing?: unknown;
	readonly sampleEdit?: Readonly<{ processing?: unknown }> | null;
}

export interface AudioEditorEditBlock {
	readonly blocked: boolean;
	readonly reason: AudioEditorEditBlockReason | null;
	readonly reasons: readonly AudioEditorEditBlockReason[];
}

export interface AudioEditorControllerEditState {
	readonly readOnly?: unknown;
	readonly importing?: unknown;
	readonly recordingStarting?: unknown;
	readonly timedRecordingPreparing?: unknown;
	readonly timedRecording?: unknown;
	readonly recorder?: unknown;
	readonly playAtSpeedAbort?: unknown;
	readonly exportAbort?: unknown;
	readonly audacityEffectProcessing?: unknown;
	readonly analysisProcessing?: unknown;
	readonly sampleEditProcessing?: unknown;
}

type BlockPredicate = (snapshot: AudioEditorEditBlockingSnapshot) => boolean;
type BlockRule = readonly [AudioEditorEditBlockReason, BlockPredicate];

const EDIT_BLOCK_RULES = Object.freeze<BlockRule[]>([
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.READ_ONLY, (snapshot) => Boolean(snapshot.readOnly)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.IMPORTING, (snapshot) => Boolean(snapshot.importing)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.RECORDING_STARTING, (snapshot) => Boolean(snapshot.recordingStarting)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.RECORDING_SCHEDULING, (snapshot) => Boolean(snapshot.recordingScheduling)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.SCHEDULED_RECORDING, (snapshot) => Boolean(snapshot.scheduledRecording)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.RECORDING, (snapshot) => Boolean(snapshot.recording)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.PLAYBACK_PREPARING, (snapshot) => Boolean(snapshot.playbackOptions?.preparing)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.EXPORTING, (snapshot) => Boolean(snapshot.exporting)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.PROCESSING_EFFECT, (snapshot) => Boolean(snapshot.processingEffect)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.ANALYSIS_PROCESSING, (snapshot) => Boolean(snapshot.analysisProcessing)],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.SAMPLE_EDIT_PROCESSING, (snapshot) => Boolean(snapshot.sampleEdit?.processing)],
]);

const NO_EDIT_BLOCK_REASONS = Object.freeze<AudioEditorEditBlockReason[]>([]);
const NOT_BLOCKED = Object.freeze<AudioEditorEditBlock>({
	blocked: false,
	reason: null,
	reasons: NO_EDIT_BLOCK_REASONS,
});

export function selectAudioEditorEditBlock(
	snapshot: AudioEditorEditBlockingSnapshot = {},
): AudioEditorEditBlock {
	return selectBlock(snapshot, true);
}

export function selectAudioEditorBusyBlock(
	snapshot: AudioEditorEditBlockingSnapshot = {},
): AudioEditorEditBlock {
	return selectBlock(snapshot, false);
}

export function selectAudioEditorControllerEditBlock(
	state: AudioEditorControllerEditState,
): AudioEditorEditBlock {
	return selectAudioEditorEditBlock({
		readOnly: state.readOnly,
		importing: state.importing,
		recordingStarting: state.recordingStarting,
		recordingScheduling: state.timedRecordingPreparing,
		scheduledRecording: state.timedRecording,
		recording: state.recorder,
		playbackOptions: { preparing: state.playAtSpeedAbort },
		exporting: state.exportAbort,
		processingEffect: state.audacityEffectProcessing,
		analysisProcessing: state.analysisProcessing,
		sampleEdit: { processing: state.sampleEditProcessing },
	});
}

function selectBlock(snapshot: AudioEditorEditBlockingSnapshot, includeReadOnly: boolean): AudioEditorEditBlock {
	const reasons = EDIT_BLOCK_RULES
		.filter(([reason, predicate]) => (
			(includeReadOnly || reason !== AUDIO_EDITOR_EDIT_BLOCK_REASONS.READ_ONLY)
			&& predicate(snapshot)
		))
		.map(([reason]) => reason);
	if (!reasons.length) return NOT_BLOCKED;
	const frozenReasons = Object.freeze(reasons);
	return Object.freeze({
		blocked: true,
		reason: frozenReasons[0],
		reasons: frozenReasons,
	});
}
