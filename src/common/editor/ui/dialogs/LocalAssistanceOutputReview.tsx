/* SPDX-License-Identifier: AGPL-3.0-only */

import { LOCAL_ASSISTANCE_ADDITIONAL_COPY } from '../../../i18n/editor-local-assistance-additional-copy.ts';

/** Semantic, read-only presentation of validated local-assistance outputs. */

import React from 'react';

import type { LocalAssistanceOutputClaim } from '../../assistance/local-assistance-bridge.ts';
import type {
	LocalAssistanceOutputReview,
	LocalAssistanceSampleRangeReview,
} from '../../assistance/local-assistance-result-review.ts';

type Copy = Readonly<Record<string, string | undefined>>;

export interface LocalAssistanceReviewableOutput {
	readonly claim: LocalAssistanceOutputClaim;
	readonly review: LocalAssistanceOutputReview;
}

export interface LocalAssistanceOutputReviewListProps {
	readonly copy: Copy;
	readonly outputs: readonly LocalAssistanceReviewableOutput[];
}

export default function LocalAssistanceOutputReviewList({
	copy, outputs,
}: LocalAssistanceOutputReviewListProps) {
	return <ul className="kw-local-assistance__outputs">
		{outputs.map(({ claim, review }) => <li key={claim.claimId}>
			{template(text(copy, 'localAssistanceOutputRow', '{role} · {mediaType} · {bytes} B'), {
				role: claim.role, mediaType: claim.mediaType, bytes: String(claim.byteLength),
			})}
			<SemanticReview copy={copy} review={review} />
		</li>)}
	</ul>;
}

function SemanticReview({ copy, review }: Readonly<{
	copy: Copy;
	review: LocalAssistanceOutputReview;
}>) {
	if (review.kind === 'transcript') {
		return <ol className="kw-local-assistance__transcript">
			{review.segments.map((segment, index) => <li
				key={`${segment.startSeconds}:${segment.endSeconds}:${index}`}>
				<span>{segment.speaker ? `${segment.speaker}: ${segment.text}` : segment.text}</span>
				<small>{template(text(copy, 'localAssistanceTranscriptTime', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceTranscriptTime), {
					start: formatSeconds(segment.startSeconds), end: formatSeconds(segment.endSeconds),
				})}</small>
			</li>)}
		</ol>;
	}
	if (review.kind === 'voice-activity') {
		return <ol className="kw-local-assistance__voice-activity"
			aria-label={text(copy, 'localAssistanceVoiceActivityRanges', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceVoiceActivityRanges)}>
			{review.segments.map((segment, index) => <li
				key={`${segment.startSample}:${segment.sampleCount}:${index}`}>
				<SampleRange copy={copy} range={segment} sampleRate={review.sampleRate} />
			</li>)}
		</ol>;
	}
	if (review.kind === 'shot-boundaries') {
		return <ol className="kw-local-assistance__shot-boundaries"
			aria-label={text(copy, 'localAssistanceShotBoundaries', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceShotBoundaries)}>
			{review.boundaries.map((boundary, index) => <li
				key={`${boundary.sourceFrame}:${boundary.presentationTick}:${index}`}>
				<span>{template(text(copy, 'localAssistanceShotBoundaryFrame',
					LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceShotBoundaryFrame), {
					sourceFrame: String(boundary.sourceFrame),
					confidence: formatPercent(boundary.score),
				})}</span>
				<small>{boundary.presentationTick}/{String(review.timescale)}</small>
			</li>)}
		</ol>;
	}
	if (review.kind === 'word-alignment') {
		return <ol className="kw-local-assistance__word-alignment"
			aria-label={text(copy, 'localAssistanceWordAlignment', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceWordAlignment)}>
			{review.words.map((word) => <li key={`${word.segmentIndex}:${word.wordIndex}`}>
				<span>{word.text}</span>
				<small>{template(text(copy, 'localAssistanceAlignedWordRange',
					LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceAlignedWordRange), {
					start: String(word.startSample), end: String(word.endSample),
					confidence: word.confidence === null
						? text(copy, 'localAssistanceConfidenceUnreported', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceConfidenceUnreported)
						: `${formatPercent(word.confidence)}%`,
				})}</small>
			</li>)}
		</ol>;
	}
	if (review.kind === 'audio-tags') {
		return <ol className="kw-local-assistance__audio-tags"
			aria-label={text(copy, 'localAssistanceExcitementScores', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceExcitementScores)}>
			{review.windows.map((window) => <li key={window.startSample}>
				<span>{template(text(copy, 'localAssistanceExcitementWindow', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceExcitementWindow), {
					start: formatSeconds(window.startSample / review.sampleRate),
				})}</span>
				<small>{template(text(copy, 'localAssistanceExcitementWindowScores',
					LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceExcitementWindowScores), {
					laughter: formatPercent(window.scores.laughter),
					applause: formatPercent(window.scores.applause),
					cheering: formatPercent(window.scores.cheering),
				})}</small>
			</li>)}
		</ol>;
	}
	if (review.kind === 'beat-grid') {
		return <div className="kw-local-assistance__beat-grid">
			<ol aria-label={text(copy, 'localAssistanceBeatPoints', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceBeatPoints)}>
				{review.points.map((point) => <li key={`${point.sample}:${point.kind}`}>
					<span>{template(text(copy, 'localAssistanceBeatPoint', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceBeatPoint), {
						kind: point.kind === 'downbeat'
							? text(copy, 'localAssistanceDownbeat', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceDownbeat)
							: text(copy, 'localAssistanceBeat', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceBeat),
						sample: String(point.sample),
					})}</span>
					<small>{point.confidence === null
						? text(copy, 'localAssistanceConfidenceUnreported', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceConfidenceUnreported)
						: `${formatPercent(point.confidence)}%`}</small>
				</li>)}
			</ol>
			{review.tempoProposal && <p>{tempoSummary(copy, review.tempoProposal)}</p>}
		</div>;
	}
	if (review.kind === 'embeddings') {
		return <p className="kw-local-assistance__embeddings">{template(text(copy,
			'localAssistanceEmbeddingSummary', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceEmbeddingSummary), {
			rows: String(review.rowCount), dimensions: String(review.dimensions),
		})}</p>;
	}
	if (review.kind === 'editorial-proposal') {
		return <ol className="kw-local-assistance__editorial"
			aria-label={text(copy, 'localAssistanceEditorialProposals', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceEditorialProposals)}>
			{review.candidates.map((candidate) => <li key={candidate.candidateId}>
				<strong>{candidate.title ?? candidate.candidateId}</strong>
				{candidate.hook && <p>{candidate.hook}</p>}
				{candidate.chapters.length > 0 && <ul>{candidate.chapters.map((chapter, index) =>
					<li key={`${candidate.candidateId}:chapter:${index}`}>{chapter}</li>)}</ul>}
				{candidate.explanation && <small>{candidate.explanation}</small>}
			</li>)}
		</ol>;
	}
	if (review.kind === 'audio-wave') {
		return <p className="kw-local-assistance__audio-wave">{template(text(copy,
			'localAssistanceAudioWaveSummary',
			LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceAudioWaveSummary), {
			channels: String(review.channelCount), frames: String(review.frameCount),
			sampleRate: String(review.sampleRate),
		})}</p>;
	}
	if (review.kind === 'recognized-text') {
		return <ol className="kw-local-assistance__recognized-text">
			{review.frames.flatMap((frame) => frame.regions.map((region, index) => <li
				key={`${frame.sourceFrame}:${index}`}>
				<span>{region.text}</span>
				<small>{template(text(copy, 'localAssistanceVisualFrameEvidence',
					LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceVisualFrameEvidence), {
					frame: String(frame.sourceFrame), tick: frame.presentationTick,
					confidence: formatPercent(region.confidence),
				})}</small>
			</li>))}
		</ol>;
	}
	if (review.kind === 'subject-tracks') {
		const count = review.frames.reduce((total, frame) => total + frame.subjects.length, 0);
		return <p className="kw-local-assistance__subjects">{template(text(copy,
			'localAssistanceSubjectSummary', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceSubjectSummary), {
			count: String(count), frames: String(review.frames.length),
		})}</p>;
	}
	if (review.kind === 'saliency-map') {
		const count = review.frames.filter(({ saliency }) => saliency !== null).length;
		return <p className="kw-local-assistance__saliency">{template(text(copy,
			'localAssistanceSaliencySummary', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceSaliencySummary), {
			count: String(count), frames: String(review.frames.length),
		})}</p>;
	}
	return <ol className="kw-local-assistance__speaker-turns"
		aria-label={text(copy, 'localAssistanceSpeakerTurns', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceSpeakerTurns)}>
		{review.turns.map((turn, index) => <li
			key={`${turn.startSample}:${turn.speakerId}:${turn.sampleCount}:${index}`}>
			<span>{template(text(copy, 'localAssistanceSpeakerId', LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceSpeakerId), {
				speakerId: String(turn.speakerId),
			})}</span>
			<SampleRange copy={copy} range={turn} sampleRate={review.sampleRate} />
		</li>)}
	</ol>;
}

function tempoSummary(copy: Copy, value: Extract<LocalAssistanceOutputReview,
{ readonly kind: 'beat-grid' }>['tempoProposal']): string {
	if (!value) return '';
	if (value.kind === 'constant') return template(text(copy, 'localAssistanceConstantTempoProposal',
		LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceConstantTempoProposal), { bpm: formatTempo(value.bpm) });
	return template(text(copy, 'localAssistanceHeldTempoProposal',
		LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceHeldTempoProposal), {
		count: String(value.changes.length),
		tempos: value.changes.map(({ bpm }) => `${formatTempo(bpm)} BPM`).join(', '),
	});
}

function SampleRange({ copy, range, sampleRate }: Readonly<{
	copy: Copy;
	range: LocalAssistanceSampleRangeReview;
	sampleRate: number;
}>) {
	const endSample = range.startSample + range.sampleCount;
	return <small>{template(text(copy, 'localAssistanceSampleRange',
		LOCAL_ASSISTANCE_ADDITIONAL_COPY.localAssistanceSampleRange), {
		startSample: String(range.startSample),
		endSample: String(endSample),
		startSeconds: formatSeconds(range.startSample / sampleRate),
		endSeconds: formatSeconds(endSample / sampleRate),
	})}</small>;
}

function text(copy: Copy, key: string, fallback: string): string {
	return copy[`ui.localAssistance.${key}`] || copy[key] || fallback;
}

function template(value: string, variables: Readonly<Record<string, string>>): string {
	return Object.entries(variables).reduce((result, [key, replacement]) =>
		result.replaceAll(`{${key}}`, replacement), value);
}

function formatSeconds(value: number): string {
	return value.toFixed(3).replace(/(?:\.0+|(\.\d*?)0+)$/u, '$1');
}

function formatPercent(value: number): string {
	return (value * 100).toFixed(1).replace(/\.0$/u, '');
}

function formatTempo(value: number): string {
	return value.toFixed(3).replace(/(?:\.0+|(\.\d*?)0+)$/u, '$1');
}
