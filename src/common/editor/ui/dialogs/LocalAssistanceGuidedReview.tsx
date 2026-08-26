/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lazy Guided review surface; every admitted choice begins unchecked. */

import { useEffect, useState } from 'react';

import type {
	LocalAssistanceGuidedReviewedResult,
} from '../local-assistance-guided-result-review.ts';
import type { AssistanceOwnedHighlightProposalsV1 } from
	'../../assistance/owned-video-highlight-transform-types-v1.ts';

type Copy = Readonly<Record<string, string | undefined>>;

export interface LocalAssistanceGuidedReviewProps {
	readonly copy: Copy;
	readonly review: LocalAssistanceGuidedReviewedResult;
	readonly selectedChoiceIds: readonly string[];
	readonly onChoiceChange: (choiceId: string, selected: boolean) => unknown;
	readonly highlightDraft?: AssistanceOwnedHighlightProposalsV1 | null;
	readonly onHighlightTitleChange?: (proposalId: string, title: string) => unknown;
	readonly onHighlightTrimChange?: (
		proposalId: string, startFrame: number, endFrame: number,
	) => unknown;
	readonly onHighlightCropChange?: (proposalId: string, sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>) => unknown;
}

export default function LocalAssistanceGuidedReview({
	copy, review, selectedChoiceIds, onChoiceChange, highlightDraft,
	onHighlightTitleChange = () => undefined,
	onHighlightTrimChange = () => undefined,
	onHighlightCropChange = () => undefined,
}: LocalAssistanceGuidedReviewProps) {
	const selected = new Set(selectedChoiceIds);
	return <section className="kw-local-assistance__guided-review"
		aria-label={text(copy, 'localAssistanceGuidedReview', 'Guided workflow review')}>
		<h3>{text(copy, 'localAssistanceReview', 'Review result')}</h3>
		<p>{review.outputs.map(({ slotId, byteLength }) => (
			`${slotId} · ${String(byteLength)} bytes`
		)).join(' · ')}</p>
		{review.outputs.filter(({ mediaType }) => mediaType === 'audio/wav').map((output) =>
			<AudioAudition key={output.claim.claimId} body={output.body} label={output.slotId} />)}
		{review.workflowId === 'generate-editorial-text'
			? <EditorialProposals review={review} /> : null}
		{review.workflowId === 'make-highlights' && highlightDraft
			? <HighlightProposals copy={copy} draft={highlightDraft} onTitle={onHighlightTitleChange}
				onTrim={onHighlightTrimChange} onCrop={onHighlightCropChange} /> : null}
		{review.choices.length === 0
			? <p>{text(copy, 'localAssistanceNoProposals', 'No proposals were found.')}</p>
			: <fieldset>
				<legend>{text(copy, 'localAssistanceChooseProposals', 'Choose proposals to accept')}</legend>
				{review.choices.map((choice) => <label key={choice.id}>
					<input type="checkbox" checked={selected.has(choice.id)} disabled={!choice.enabled}
						onChange={(event) => { void onChoiceChange(choice.id, event.currentTarget.checked); }} />
					{choice.label}
				</label>)}
			</fieldset>}
	</section>;
}

function HighlightProposals({ copy, draft, onTitle, onTrim, onCrop }: Readonly<{
	copy: Copy;
	draft: AssistanceOwnedHighlightProposalsV1;
	onTitle: (proposalId: string, title: string) => unknown;
	onTrim: (proposalId: string, startFrame: number, endFrame: number) => unknown;
	onCrop: (proposalId: string, sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>) => unknown;
}>) {
	return <div className="kw-local-assistance__highlight-proposals">
		{draft.proposals.map((proposal, index) => <article key={proposal.id}
			aria-label={`${text(copy, 'localAssistanceHighlightProposal', 'Highlight proposal')} ${String(index + 1)}`}>
			<label>{text(copy, 'localAssistanceHighlightTitle', 'Title')}<input type="text"
				key={proposal.title} defaultValue={proposal.title} minLength={1} maxLength={160} required
				onBlur={(event) => { void onTitle(proposal.id, event.currentTarget.value); }} /></label>
			<div className="kw-local-assistance__highlight-trim">
				<label>{text(copy, 'localAssistanceHighlightStartFrame', 'Start frame')}
					<input type="number" key={`start:${String(proposal.startFrame)}`}
					min={proposal.startFrame} max={proposal.endFrame - trimStep(proposal)}
					step={trimStep(proposal)} defaultValue={proposal.startFrame}
					onBlur={(event) => { void onTrim(proposal.id,
						Number(event.currentTarget.value), proposal.endFrame); }} /></label>
				<label>{text(copy, 'localAssistanceHighlightEndFrame', 'End frame')}
					<input type="number" key={`end:${String(proposal.endFrame)}`}
					min={proposal.startFrame + trimStep(proposal)} max={proposal.endFrame}
					step={trimStep(proposal)} defaultValue={proposal.endFrame}
					onBlur={(event) => { void onTrim(proposal.id, proposal.startFrame,
						Number(event.currentTarget.value)); }} /></label>
			</div>
			<p>{text(copy, 'localAssistanceHighlightPreviewRange', 'Preview range')}:{' '}
				{String(proposal.startFrame)}–{String(proposal.endFrame)}</p>
			{proposal.transcriptExcerpt === null
				? <p>{text(copy, 'localAssistanceHighlightSpeechless', 'Speechless footage')}</p>
				: <blockquote>{proposal.transcriptExcerpt}</blockquote>}
			<p>{proposal.visualSummary}</p>
			{proposal.cropKeyframes.map((keyframe) => <fieldset key={keyframe.sourceFrame}>
				<legend>{text(copy, 'localAssistanceHighlightCropKeyframe', 'Crop keyframe')}{' '}
					{String(keyframe.sourceFrame)}</legend>
				<div className="kw-local-assistance__crop-overlay"
					aria-label={text(copy, 'localAssistanceHighlightCropOverlay', 'Draggable crop overlay')}
					style={{ paddingLeft: `${String(keyframe.crop.left * 100)}%`,
						paddingRight: `${String(keyframe.crop.right * 100)}%`,
						paddingTop: `${String(keyframe.crop.top * 100)}%`,
						paddingBottom: `${String(keyframe.crop.bottom * 100)}%` }}><span /></div>
				{(['left', 'top', 'right', 'bottom'] as const).map((edge) => <label key={edge}>
					{text(copy, `localAssistanceHighlightCrop${edge}`, edge)}
					<input type="range" min={0} max={cropMaximum(keyframe.crop, edge)} step={0.001}
						value={keyframe.crop[edge]} onChange={(event) => { void onCrop(
							proposal.id, keyframe.sourceFrame,
							{ ...keyframe.crop, [edge]: Number(event.currentTarget.value) },
						); }} />
				</label>)}
			</fieldset>)}
		</article>)}
	</div>;
}

function trimStep(proposal: AssistanceOwnedHighlightProposalsV1['proposals'][number]): number {
	const timeline = proposal.endFrame - proposal.startFrame;
	const source = proposal.sourceEndFrame - proposal.sourceStartFrame;
	const value = timeline / source;
	return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function cropMaximum(crop: Readonly<{ left: number; top: number; right: number; bottom: number }>,
	edge: 'left' | 'top' | 'right' | 'bottom'): number {
	const opposite = edge === 'left' ? crop.right : edge === 'right' ? crop.left
		: edge === 'top' ? crop.bottom : crop.top;
	return Math.max(0, Math.floor((0.999 - opposite) * 1_000) / 1_000);
}

interface EditorialCandidate {
	readonly candidateId: string;
	readonly title: string | null;
	readonly hook: string | null;
	readonly chapters: readonly string[];
	readonly explanation: string | null;
}

function EditorialProposals({ review }: Readonly<{ review: LocalAssistanceGuidedReviewedResult }>) {
	const candidates = editorialCandidates(review);
	return <div className="kw-local-assistance__editorial-proposals">
		{candidates.map((candidate, index) => <article key={candidate.candidateId}
			aria-label={`Editorial proposal ${String(index + 1)}`}>
			{candidate.title === null ? null : <h4>{candidate.title}</h4>}
			{candidate.hook === null ? null : <p>{candidate.hook}</p>}
			{candidate.chapters.length === 0 ? null : <ol>
				{candidate.chapters.map((chapter) => <li key={chapter}>{chapter}</li>)}
			</ol>}
			{candidate.explanation === null ? null : <p>{candidate.explanation}</p>}
		</article>)}
	</div>;
}

function editorialCandidates(review: LocalAssistanceGuidedReviewedResult): readonly EditorialCandidate[] {
	const semantic = review.outputs.find(({ slotId }) => slotId === 'editorial-proposal')?.semantic;
	if (!semantic || typeof semantic !== 'object' || Array.isArray(semantic)) return [];
	const values = (semantic as Readonly<Record<string, unknown>>).candidates;
	if (!Array.isArray(values)) return [];
	return values.filter(isEditorialCandidate);
}

function isEditorialCandidate(value: unknown): value is EditorialCandidate {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Readonly<Record<string, unknown>>;
	return typeof row.candidateId === 'string'
		&& nullableString(row.title) && nullableString(row.hook) && nullableString(row.explanation)
		&& Array.isArray(row.chapters) && row.chapters.every((chapter) => typeof chapter === 'string');
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string';
}

function AudioAudition({ body, label }: Readonly<{ body: Blob; label: string }>) {
	const [source, setSource] = useState<string>();
	useEffect(() => {
		const url = URL.createObjectURL(body);
		setSource(url);
		return () => URL.revokeObjectURL(url);
	}, [body]);
	return <label>{label}<audio controls preload="metadata" src={source} /></label>;
}

function text(copy: Copy, key: string, fallback: string): string { return copy[key] || fallback; }
