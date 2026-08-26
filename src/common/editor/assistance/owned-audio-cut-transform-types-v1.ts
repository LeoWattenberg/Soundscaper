/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pathless JSON contracts for deterministic owned audio and cut workflow stages. */

import type { AssistanceTempoProposalV1 } from './m7-semantic-results.ts';
import type { AssistanceTranscript } from './transcript.ts';

export const ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_SCHEMA_VERSION_V1 = 1 as const;
export const ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1 = Object.freeze([
	'assemble-captions',
	'propose-cleanup',
	'attribute-speakers',
	'merge-reaction-ranges',
	'chunk-transcript',
	'publish-transcript-index',
	'propose-tempo-map',
	'normalize-cuts',
] as const);

export type AssistanceOwnedAudioCutTransformIdV1 =
	(typeof ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1)[number];

export interface AssistanceOwnedAudioCutTransformRequestV1<
	Id extends AssistanceOwnedAudioCutTransformIdV1 = AssistanceOwnedAudioCutTransformIdV1,
> {
	readonly schemaVersion: typeof ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_SCHEMA_VERSION_V1;
	readonly transformId: Id;
	/** Exact authenticated AssistanceWorkflowSettingsV1 body; never optional or defaulted. */
	readonly settings: unknown;
	/** Closed stage-specific slots. Binary embeddings are the sole non-JSON slot body. */
	readonly inputs: unknown;
}

export interface AssistanceCaptionWordV1 {
	readonly text: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly confidence: number | null;
}

export interface AssistanceCaptionCueV1 {
	readonly cueId: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly text: string;
	readonly words: readonly AssistanceCaptionWordV1[];
}

export interface AssistanceCaptionsV1 {
	readonly schemaVersion: 1;
	readonly kind: 'captions';
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly alignmentApplied: boolean;
	readonly cues: readonly AssistanceCaptionCueV1[];
}

export interface AssistanceCleanupProposalV1 {
	readonly id: string;
	readonly kind: 'filler' | 'repetition' | 'silence';
	readonly startFrame: number;
	readonly endFrame: number;
	readonly text: string;
	readonly selected: false;
}

export interface AssistanceCleanupProposalsV1 {
	readonly schemaVersion: 1;
	readonly kind: 'cleanup-proposals';
	readonly preset: 'conservative' | 'balanced' | 'aggressive';
	readonly proposals: readonly AssistanceCleanupProposalV1[];
}

export interface AssistanceReactionRangeV1 {
	readonly id: string;
	readonly kind: 'reaction';
	readonly label: 'Laughter' | 'Applause' | 'Cheering';
	readonly startSample: number;
	readonly endSample: number;
	readonly score: number;
	readonly selected: false;
}

export interface AssistanceReactionRangesV1 {
	readonly schemaVersion: 1;
	readonly kind: 'reaction-ranges';
	readonly sampleRate: 32_000;
	readonly threshold: number;
	readonly ranges: readonly AssistanceReactionRangeV1[];
}

export interface AssistanceTextChunkV1 {
	readonly schemaVersion: 1;
	readonly chunkId: string;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly segmentStartIndex: number;
	readonly segmentEndIndexExclusive: number;
	readonly inputIds: readonly number[];
	readonly label: string;
}

export interface AssistanceTextChunksV1 {
	readonly schemaVersion: 1;
	readonly kind: 'text-chunks';
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly chunks: readonly AssistanceTextChunkV1[];
}

export interface AssistanceTranscriptIndexEmbeddingV1 {
	readonly schemaVersion: 1;
	readonly byteLength: number;
	readonly sha256: string;
	readonly rowCount: number;
	readonly dimensions: number;
}

export interface AssistanceTranscriptIndexRowV1 {
	readonly resultId: string;
	readonly timelineFrame: number;
	readonly sourceEndFrame: number;
	readonly segmentStartIndex: number;
	readonly segmentEndIndexExclusive: number;
	readonly label: string;
	readonly embeddingRow: number;
}

export interface AssistanceTranscriptIndexV1 {
	readonly schemaVersion: 1;
	readonly kind: 'transcript-index';
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly embedding: AssistanceTranscriptIndexEmbeddingV1;
	readonly rows: readonly AssistanceTranscriptIndexRowV1[];
}

export interface AssistanceBeatLabelPointV1 {
	readonly id: string;
	readonly kind: 'beat' | 'downbeat';
	readonly label: 'Beat' | 'Downbeat';
	readonly sample: number;
	readonly confidence: number | null;
	readonly selected: false;
}

export interface AssistanceBeatLabelsV1 {
	readonly schemaVersion: 1;
	readonly kind: 'beat-labels';
	readonly publicationRequested: boolean;
	readonly points: readonly AssistanceBeatLabelPointV1[];
}

export interface AssistanceTempoMapDiffV1 {
	readonly schemaVersion: 1;
	readonly kind: 'tempo-map-diff';
	readonly applicationRequested: boolean;
	readonly proposal: AssistanceTempoProposalV1 | null;
}

export interface AssistanceCutProposalV1 {
	readonly id: string;
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly score: number;
	readonly selected: false;
}

export interface AssistanceCutProposalsV1 {
	readonly schemaVersion: 1;
	readonly kind: 'cut-proposals';
	readonly mode: 'fast' | 'accurate';
	readonly detector: 'ffmpeg-scdet' | 'transnetv2';
	readonly timescale: number;
	readonly sourceFrameCount: number;
	readonly proposals: readonly AssistanceCutProposalV1[];
}

interface TransformResult<Id extends AssistanceOwnedAudioCutTransformIdV1, Outputs> {
	readonly schemaVersion: 1;
	readonly transformId: Id;
	readonly outputs: Outputs;
}

export type AssistanceOwnedAudioCutTransformResultByIdV1 = Readonly<{
	'assemble-captions': TransformResult<'assemble-captions', Readonly<{
		readonly captions: AssistanceCaptionsV1;
	}>>;
	'propose-cleanup': TransformResult<'propose-cleanup', Readonly<{
		readonly 'cleanup-proposals': AssistanceCleanupProposalsV1;
	}>>;
	'attribute-speakers': TransformResult<'attribute-speakers', Readonly<{
		readonly 'attributed-transcript': AssistanceTranscript;
	}>>;
	'merge-reaction-ranges': TransformResult<'merge-reaction-ranges', Readonly<{
		readonly 'reaction-ranges': AssistanceReactionRangesV1;
	}>>;
	'chunk-transcript': TransformResult<'chunk-transcript', Readonly<{
		readonly 'text-chunks': AssistanceTextChunksV1;
	}>>;
	'publish-transcript-index': TransformResult<'publish-transcript-index', Readonly<{
		readonly 'transcript-index': AssistanceTranscriptIndexV1;
	}>>;
	'propose-tempo-map': TransformResult<'propose-tempo-map', Readonly<{
		readonly 'beat-labels': AssistanceBeatLabelsV1;
		readonly 'tempo-map-diff': AssistanceTempoMapDiffV1;
	}>>;
	'normalize-cuts': TransformResult<'normalize-cuts', Readonly<{
		readonly 'cut-proposals': AssistanceCutProposalsV1;
	}>>;
}>;

export type AssistanceOwnedAudioCutTransformResultV1 =
	AssistanceOwnedAudioCutTransformResultByIdV1[AssistanceOwnedAudioCutTransformIdV1];
