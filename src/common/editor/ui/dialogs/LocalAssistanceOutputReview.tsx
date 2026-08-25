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
