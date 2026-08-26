/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lazy Guided review surface; every admitted choice begins unchecked. */

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

function text(copy: Copy, key: string, fallback: string): string { return copy[key] || fallback; }
