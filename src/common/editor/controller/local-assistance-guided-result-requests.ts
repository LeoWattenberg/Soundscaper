/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed translations from aggregate terminal semantics to primitive publication requests. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type {
	AssistanceBeatLabelsV1,
	AssistanceCaptionsV1,
	AssistanceCutProposalsV1,
	AssistanceTempoMapDiffV1,
} from '../assistance/owned-audio-cut-transform-types-v1.ts';
import {
	AssistanceProposalStaleError,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import type {
	AssistanceWorkflowModelBindingV1,
	AssistanceWorkflowOutputClaimV1,
	AssistanceWorkflowV1,
} from '../assistance/workflow.ts';

type DataRecord = Readonly<Record<string, unknown>>;
const UTF8 = new TextEncoder();

export interface LocalAssistanceGuidedAdaptedOutput {
	readonly stageId: string;
	readonly slotId: string;
	readonly claim: AssistanceWorkflowOutputClaimV1;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly body: Blob;
	readonly semantic: unknown;
}

export function createGuidedTranscriptAcceptanceRequest(
	workflow: AssistanceWorkflowV1,
	fence: AssistanceSelectionFence,
	outputs: ReadonlyMap<string, LocalAssistanceGuidedAdaptedOutput>,
): DataRecord {
	const captions = outputs.get('captions')!.semantic as AssistanceCaptionsV1;
	const audioRanges = workflow.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === 'audio');
	if (audioRanges.length !== 1 || captions.sourceId !== fence.sourceId
		|| captions.sampleRate !== audioRanges[0]!.sourceSampleRate) {
		throw new AssistanceProposalStaleError();
	}
	const relative = (frame: number): number => {
		if (frame < fence.sourceStartFrame || frame > fence.sourceEndFrame) {
			throw new RangeError('A caption exceeds the exact aggregate source range.');
		}
		const value = (frame - fence.sourceStartFrame) / captions.sampleRate;
		return Object.is(value, -0) ? 0 : value;
	};
	const semantic = Object.freeze({
		kind: 'transcript' as const,
		language: workflow.settings.workflowId === 'transcribe-captions'
			&& workflow.settings.language === 'en' ? 'en' : null,
		segments: Object.freeze(captions.cues.map((cue) => Object.freeze({
			startSeconds: relative(cue.startFrame), endSeconds: relative(cue.endFrame),
			text: cue.text, speaker: null,
			words: Object.freeze(cue.words.map((word) => Object.freeze({
				text: word.text, startSeconds: relative(word.startFrame),
				endSeconds: relative(word.endFrame), confidence: word.confidence,
			}))),
		}))),
	});
	return Object.freeze({ sourceId: fence.sourceId, operation: 'speech-recognition',
		selectionFence: fence,
		models: Object.freeze([primitiveModel(modelBinding(
			workflow, 'recognize-speech', 'speech-recognizer'), 'speech-recognition',
		)]),
		outputs: Object.freeze([Object.freeze({
			claim: adaptedClaim(workflow, semantic, 'transcript',
				'application/vnd.soundscaper.transcript+json'), review: semantic,
		})]),
	});
}

export function createGuidedAudioAcceptanceRequest(
	workflow: AssistanceWorkflowV1,
	workflowId: 'enhance-dialogue' | 'separate-dialogue-music-effects',
	fence: AssistanceSelectionFence,
	outputs: ReadonlyMap<string, LocalAssistanceGuidedAdaptedOutput>,
): DataRecord {
	const enhancement = workflowId === 'enhance-dialogue';
	const operation = enhancement ? 'speech-enhancement' : 'source-separation';
	const stageId = enhancement ? 'enhance-dialogue' : 'separate-sources';
	const slots = enhancement ? ['enhanced-audio'] : ['dialogue', 'music', 'effects'];
	return Object.freeze({ sourceId: fence.sourceId, operation, selectionFence: fence,
		models: Object.freeze([primitiveModel(modelBinding(workflow, stageId,
			enhancement ? 'enhancer' : 'separator'), operation)]),
		outputs: Object.freeze(slots.map((slotId) => {
			const output = outputs.get(slotId)!;
			return Object.freeze({ slotId,
				claim: Object.freeze({ claimVersion: 1, claimId: output.claim.claimId,
					jobId: workflow.jobId, role: enhancement ? 'enhanced-audio' : 'separated-audio',
					mediaType: 'audio/wav', byteLength: output.byteLength, sha256: output.sha256 }),
				review: output.semantic, bytes: output.body,
			});
		})),
	});
}

export function createGuidedBeatAcceptanceRequest(
	workflow: AssistanceWorkflowV1,
	fence: AssistanceSelectionFence,
	outputs: ReadonlyMap<string, LocalAssistanceGuidedAdaptedOutput>,
): DataRecord {
	const labels = outputs.get('beat-labels')!.semantic as AssistanceBeatLabelsV1;
	const diff = outputs.get('tempo-map-diff')!.semantic as AssistanceTempoMapDiffV1;
	const semantic = Object.freeze({ kind: 'beat-grid' as const, schemaVersion: 1,
		sampleRate: 22_050,
		points: Object.freeze(labels.points.map(({ sample, kind, confidence }) => Object.freeze({
			sample, kind, confidence,
		}))), tempoProposal: diff.proposal });
	return Object.freeze({ sourceId: fence.sourceId, operation: 'beat-tracking', selectionFence: fence,
		models: Object.freeze([primitiveModel(modelBinding(
			workflow, 'track-beats', 'beat-tracker'), 'beat-tracking',
		)]),
		outputs: Object.freeze([Object.freeze({ claim: adaptedClaim(
			workflow, semantic, 'beat-grid', 'application/vnd.soundscaper.beat-grid+json',
		), review: semantic })]),
	});
}

export function createGuidedCutAcceptanceRequest(
	workflow: AssistanceWorkflowV1,
	fence: AssistanceSelectionFence,
	outputs: ReadonlyMap<string, LocalAssistanceGuidedAdaptedOutput>,
	selectedIds: readonly string[],
): DataRecord {
	const cuts = outputs.get('cut-proposals')!.semantic as AssistanceCutProposalsV1;
	const selected = new Set(selectedIds);
	const semantic = Object.freeze({ kind: 'shot-boundaries' as const, schemaVersion: 1,
		detector: cuts.detector, timescale: cuts.timescale, sourceFrameCount: cuts.sourceFrameCount,
		boundaries: Object.freeze(cuts.proposals.filter(({ id }) => selected.has(id))
			.map(({ sourceFrame, presentationTick, score }) => Object.freeze({
				sourceFrame, presentationTick, score,
			}))),
	});
	const models = cuts.detector === 'ffmpeg-scdet' ? Object.freeze([]) : Object.freeze([
		primitiveModel(modelBinding(workflow, 'detect-shots', 'accurate-shot-detector'),
			'shot-detection'),
	]);
	return Object.freeze({ sourceId: fence.sourceId, operation: 'shot-detection',
		selectionFence: fence, models,
		outputs: Object.freeze([Object.freeze({ claim: adaptedClaim(
			workflow, semantic, 'shot-boundaries',
			'application/vnd.soundscaper.shot-boundaries+json',
		), review: semantic })]),
	});
}

function modelBinding(
	workflow: AssistanceWorkflowV1,
	stageId: string,
	slotId: string,
): AssistanceWorkflowModelBindingV1 {
	const matches = workflow.models.filter((model) => model.stageId === stageId && model.slotId === slotId);
	if (matches.length !== 1) throw new TypeError('Guided publication lost its exact model binding.');
	return matches[0]!;
}

function primitiveModel(
	model: AssistanceWorkflowModelBindingV1,
	task: string,
): DataRecord {
	return Object.freeze({ modelId: model.modelId, version: model.version, task,
		artifactSha256s: model.artifactSha256s });
}

function adaptedClaim(
	workflow: AssistanceWorkflowV1,
	semantic: unknown,
	role: string,
	mediaType: string,
): DataRecord {
	const bytes = UTF8.encode(JSON.stringify(semantic));
	const digest = bytesToHex(sha256(bytes));
	return Object.freeze({ claimVersion: 1, claimId: digest.slice(0, 40), jobId: workflow.jobId,
		role, mediaType, byteLength: bytes.byteLength, sha256: digest });
}
