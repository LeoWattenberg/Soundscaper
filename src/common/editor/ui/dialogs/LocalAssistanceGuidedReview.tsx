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
