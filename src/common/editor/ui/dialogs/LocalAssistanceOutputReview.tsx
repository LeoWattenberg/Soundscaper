/* SPDX-License-Identifier: AGPL-3.0-only */

/** Semantic, read-only presentation of validated local-assistance outputs. */

import React from 'react';

import type { LocalAssistanceOutputClaim } from '../local-assistance-bridge.ts';
import type {
	LocalAssistanceOutputReview,
	LocalAssistanceSampleRangeReview,
} from '../local-assistance-result-review.ts';

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
				<small>{template(text(copy, 'localAssistanceTranscriptTime', '{start}–{end} s'), {
					start: formatSeconds(segment.startSeconds), end: formatSeconds(segment.endSeconds),
				})}</small>
			</li>)}
		</ol>;
	}
	if (review.kind === 'voice-activity') {
		return <ol className="kw-local-assistance__voice-activity"
			aria-label={text(copy, 'localAssistanceVoiceActivityRanges', 'Voice activity ranges')}>
			{review.segments.map((segment, index) => <li
				key={`${segment.startSample}:${segment.sampleCount}:${index}`}>
				<SampleRange copy={copy} range={segment} sampleRate={review.sampleRate} />
			</li>)}
		</ol>;
	}
	if (review.kind === 'shot-boundaries') {
		return <ol className="kw-local-assistance__shot-boundaries"
			aria-label={text(copy, 'localAssistanceShotBoundaries', 'Shot boundaries')}>
			{review.boundaries.map((boundary, index) => <li
				key={`${boundary.sourceFrame}:${boundary.presentationTick}:${index}`}>
				<span>{template(text(copy, 'localAssistanceShotBoundaryFrame',
					'Source frame {sourceFrame} · {confidence}%'), {
					sourceFrame: String(boundary.sourceFrame),
					confidence: formatPercent(boundary.score),
				})}</span>
				<small>{boundary.presentationTick}/{String(review.timescale)}</small>
			</li>)}
		</ol>;
	}
	if (review.kind === 'word-alignment') {
		return <ol className="kw-local-assistance__word-alignment"
			aria-label={text(copy, 'localAssistanceWordAlignment', 'Word alignment')}>
			{review.words.map((word) => <li key={`${word.segmentIndex}:${word.wordIndex}`}>
				<span>{word.text}</span>
				<small>{template(text(copy, 'localAssistanceAlignedWordRange',
					'{start}–{end} samples · {confidence}'), {
					start: String(word.startSample), end: String(word.endSample),
					confidence: word.confidence === null
						? text(copy, 'localAssistanceConfidenceUnreported', 'confidence unreported')
						: `${formatPercent(word.confidence)}%`,
				})}</small>
			</li>)}
		</ol>;
	}
	if (review.kind === 'audio-tags') {
		return <ol className="kw-local-assistance__audio-tags"
			aria-label={text(copy, 'localAssistanceExcitementScores', 'Excitement scores')}>
			{review.windows.map((window) => <li key={window.startSample}>
				<span>{template(text(copy, 'localAssistanceExcitementWindow', 'Window {start} s'), {
					start: formatSeconds(window.startSample / review.sampleRate),
				})}</span>
				<small>{template(text(copy, 'localAssistanceExcitementWindowScores',
					'Laughter {laughter}% · Applause {applause}% · Cheering {cheering}%'), {
					laughter: formatPercent(window.scores.laughter),
					applause: formatPercent(window.scores.applause),
					cheering: formatPercent(window.scores.cheering),
				})}</small>
			</li>)}
		</ol>;
	}
	if (review.kind === 'beat-grid') {
		return <div className="kw-local-assistance__beat-grid">
			<ol aria-label={text(copy, 'localAssistanceBeatPoints', 'Beat and downbeat points')}>
				{review.points.map((point) => <li key={`${point.sample}:${point.kind}`}>
					<span>{template(text(copy, 'localAssistanceBeatPoint', '{kind} · sample {sample}'), {
						kind: point.kind === 'downbeat'
							? text(copy, 'localAssistanceDownbeat', 'Downbeat')
							: text(copy, 'localAssistanceBeat', 'Beat'),
						sample: String(point.sample),
					})}</span>
					<small>{point.confidence === null
						? text(copy, 'localAssistanceConfidenceUnreported', 'confidence unreported')
						: `${formatPercent(point.confidence)}%`}</small>
				</li>)}
			</ol>
			{review.tempoProposal && <p>{tempoSummary(copy, review.tempoProposal)}</p>}
		</div>;
	}
	if (review.kind === 'embeddings') {
		return <p className="kw-local-assistance__embeddings">{template(text(copy,
			'localAssistanceEmbeddingSummary', '{rows} normalized vectors · {dimensions} dimensions'), {
			rows: String(review.rowCount), dimensions: String(review.dimensions),
		})}</p>;
	}
	if (review.kind === 'editorial-proposal') {
		return <ol className="kw-local-assistance__editorial"
			aria-label={text(copy, 'localAssistanceEditorialProposals', 'Editorial proposals')}>
			{review.candidates.map((candidate) => <li key={candidate.candidateId}>
				<strong>{candidate.title ?? candidate.candidateId}</strong>
				{candidate.hook && <p>{candidate.hook}</p>}
				{candidate.chapters.length > 0 && <ul>{candidate.chapters.map((chapter, index) =>
					<li key={`${candidate.candidateId}:chapter:${index}`}>{chapter}</li>)}</ul>}
				{candidate.explanation && <small>{candidate.explanation}</small>}
			</li>)}
		</ol>;
	}
	return <ol className="kw-local-assistance__speaker-turns"
		aria-label={text(copy, 'localAssistanceSpeakerTurns', 'Speaker turns')}>
		{review.turns.map((turn, index) => <li
			key={`${turn.startSample}:${turn.speakerId}:${turn.sampleCount}:${index}`}>
			<span>{template(text(copy, 'localAssistanceSpeakerId', 'Speaker ID {speakerId}'), {
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
		'Tempo proposal · {bpm} BPM'), { bpm: formatTempo(value.bpm) });
	return template(text(copy, 'localAssistanceHeldTempoProposal',
		'Tempo proposal · {count} piecewise-held changes · {tempos}'), {
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
		'{startSample}–{endSample} samples · {startSeconds}–{endSeconds} s'), {
		startSample: String(range.startSample),
		endSample: String(endSample),
		startSeconds: formatSeconds(range.startSample / sampleRate),
		endSeconds: formatSeconds(endSample / sampleRate),
	})}</small>;
}

function text(copy: Copy, key: string, fallback: string): string {
	return copy[key] || fallback;
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
