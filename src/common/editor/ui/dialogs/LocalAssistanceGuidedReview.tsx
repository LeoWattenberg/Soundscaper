/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lazy Guided review surface; every admitted choice begins unchecked. */

import { useEffect, useState } from 'react';

import type {
	LocalAssistanceGuidedReviewedResult,
} from '../local-assistance-guided-result-review.ts';

type Copy = Readonly<Record<string, string | undefined>>;

export interface LocalAssistanceGuidedReviewProps {
	readonly copy: Copy;
	readonly review: LocalAssistanceGuidedReviewedResult;
	readonly selectedChoiceIds: readonly string[];
	readonly onChoiceChange: (choiceId: string, selected: boolean) => unknown;
}

export default function LocalAssistanceGuidedReview({
	copy, review, selectedChoiceIds, onChoiceChange,
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
