/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed pathless contracts for deterministic Framescaper and highlight transforms. */

import type { AssistanceTrackedSubjectResultV1 } from './subject-tracker-v1.ts';
import type {
	AssistanceReframePathResultV1,
	AssistanceVisualFrameAuthorityV1,
} from './visual-semantic-results-v1.ts';
import type {
	AssistanceOcrSearchRecordV1,
	AssistanceVisualSearchRecordV1,
	AssistanceVisualSearchRowsV1,
	AssistanceVisualSearchSampleAuthorityV1,
} from './visual-search-records-v1.ts';
import type { AssistanceWorkflowSettingsV1 } from './workflow-settings-v1.ts';

export const ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1 = Object.freeze([
	'sample-shot-frames',
	'publish-video-index',
	'track-subjects',
	'plan-crops',
	'gather-signals',
	'rank-highlights',
	'assemble-highlights',
] as const);

export type AssistanceOwnedVideoHighlightTransformIdV1 =
	typeof ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1[number];

export interface AssistanceOwnedVideoHighlightTransformRequestV1<
	Id extends AssistanceOwnedVideoHighlightTransformIdV1 = AssistanceOwnedVideoHighlightTransformIdV1,
> {
	readonly schemaVersion: 1;
	readonly transformId: Id;
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly inputs: unknown;
}

export interface AssistanceVideoSourceTimeFrameV1 {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly timelineFrame: number;
}

export interface AssistanceVideoSourceTimeAuthorityV1 {
	readonly schemaVersion: 1;
	readonly kind: 'video-source-time-authority';
	readonly sourceId: string;
	readonly width: number;
	readonly height: number;
	readonly sourceStartFrame: number;
	/** Exclusive selected source boundary. */
	readonly sourceEndFrame: number;
	readonly timescale: number;
	readonly presentationEndTick: string;
	readonly frames: readonly AssistanceVideoSourceTimeFrameV1[];
}

export interface AssistanceOwnedFramePackPlanFrameV1
	extends AssistanceVisualSearchSampleAuthorityV1 {
	readonly presentationTick: string;
}

export interface AssistanceOwnedFramePackPlanV1 {
	readonly schemaVersion: 1;
	readonly kind: 'frame-pack-plan';
	readonly sourceId: string;
	readonly width: number;
	readonly height: number;
	readonly timescale: number;
	readonly frames: readonly AssistanceOwnedFramePackPlanFrameV1[];
}

export interface AssistanceOwnedIndexEmbeddingV1 {
	readonly schemaVersion: 1;
	readonly byteLength: number;
	readonly sha256: string;
	readonly rowCount: number;
	readonly dimensions: number;
}

export interface AssistanceOwnedVideoIndexV1 {
	readonly schemaVersion: 1;
	readonly kind: 'video-index';
	readonly sourceId: string;
	readonly timescale: number;
	readonly sampleAuthority: readonly AssistanceVisualSearchSampleAuthorityV1[];
	readonly embedding: AssistanceOwnedIndexEmbeddingV1;
	readonly records: Readonly<{
		readonly schemaVersion: 1;
		readonly tagTaxonomyVersion: 1;
		readonly visual: readonly AssistanceVisualSearchRecordV1[];
		readonly ocr: readonly AssistanceOcrSearchRecordV1[];
	}>;
	readonly rows: AssistanceVisualSearchRowsV1;
}

export interface AssistanceOwnedReframePathV1 {
	readonly schemaVersion: 1;
	readonly kind: 'reframe-path';
	readonly authority: AssistanceVisualFrameAuthorityV1;
	readonly fallbackChain: readonly ['subject', 'saliency', 'center'];
	readonly path: AssistanceReframePathResultV1;
}

export interface AssistanceOwnedHighlightSignalCandidateV1 {
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly transcriptEvidence: boolean;
	readonly transcriptExcerpt: string | null;
	readonly visualSummary: string;
	readonly hook: number;
	readonly conversationalStructure: number;
	readonly excitement: number;
	readonly energyDynamics: number;
	readonly semanticSelfContainedness: number;
	readonly shotStructure: number;
	readonly visualInterest: number;
	readonly duplication: number;
	readonly videoOccurrenceId: string;
	readonly audioOccurrenceId: string;
}

export interface AssistanceOwnedHighlightSignalsV1 {
	readonly schemaVersion: 1;
	readonly kind: 'highlight-signals';
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly sourceSize: Readonly<{ readonly width: number; readonly height: number }>;
	readonly candidates: readonly AssistanceOwnedHighlightSignalCandidateV1[];
}

export interface AssistanceOwnedRankedHighlightCandidateV1 {
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly score: number;
	readonly evidenceMode: 'transcript' | 'speechless';
	readonly transcriptExcerpt: string | null;
	readonly visualSummary: string;
	readonly selected: false;
	readonly videoOccurrenceId: string;
	readonly audioOccurrenceId: string;
}

export interface AssistanceOwnedHighlightCandidatesV1 {
	readonly schemaVersion: 1;
	readonly kind: 'highlight-candidates';
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly sourceSize: Readonly<{ readonly width: number; readonly height: number }>;
	readonly targetAspect: Readonly<{ readonly width: number; readonly height: number }>;
	readonly candidates: readonly AssistanceOwnedRankedHighlightCandidateV1[];
}

export interface AssistanceOwnedHighlightCropKeyframeV1 {
	readonly sourceFrame: number;
	readonly authority: 'subject' | 'saliency' | 'center';
	readonly trackIds: readonly string[];
	readonly crop: Readonly<{
		readonly left: number;
		readonly top: number;
		readonly right: number;
		readonly bottom: number;
	}>;
}

export interface AssistanceOwnedHighlightProposalV1
	extends AssistanceOwnedRankedHighlightCandidateV1 {
	readonly title: string;
	readonly cropKeyframes: readonly AssistanceOwnedHighlightCropKeyframeV1[];
}

export interface AssistanceOwnedHighlightProposalsV1 {
	readonly schemaVersion: 1;
	readonly kind: 'highlight-proposals';
	readonly workflowId: 'make-highlights';
	readonly targetAspect: Readonly<{ readonly width: 9; readonly height: 16 }>;
	readonly proposals: readonly AssistanceOwnedHighlightProposalV1[];
}

interface TransformResult<Id extends AssistanceOwnedVideoHighlightTransformIdV1, Outputs> {
	readonly schemaVersion: 1;
	readonly transformId: Id;
	readonly outputs: Outputs;
}

export type AssistanceOwnedVideoHighlightTransformResultByIdV1 = Readonly<{
	'sample-shot-frames': TransformResult<'sample-shot-frames', Readonly<{
		readonly 'frame-pack': AssistanceOwnedFramePackPlanV1;
	}>>;
	'publish-video-index': TransformResult<'publish-video-index', Readonly<{
		readonly 'video-index': AssistanceOwnedVideoIndexV1;
	}>>;
	'track-subjects': TransformResult<'track-subjects', Readonly<{
		readonly 'tracked-subjects': AssistanceTrackedSubjectResultV1;
	}>>;
	'plan-crops': TransformResult<'plan-crops', Readonly<{
		readonly 'reframe-path': AssistanceOwnedReframePathV1;
	}>>;
	'gather-signals': TransformResult<'gather-signals', Readonly<{
		readonly 'highlight-signals': AssistanceOwnedHighlightSignalsV1;
	}>>;
	'rank-highlights': TransformResult<'rank-highlights', Readonly<{
		readonly 'highlight-candidates': AssistanceOwnedHighlightCandidatesV1;
	}>>;
	'assemble-highlights': TransformResult<'assemble-highlights', Readonly<{
		readonly 'highlight-proposals': AssistanceOwnedHighlightProposalsV1;
	}>>;
}>;

export type AssistanceOwnedVideoHighlightTransformResultV1 =
	AssistanceOwnedVideoHighlightTransformResultByIdV1[
		AssistanceOwnedVideoHighlightTransformIdV1
	];
