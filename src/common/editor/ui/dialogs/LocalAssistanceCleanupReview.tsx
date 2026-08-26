/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ASSISTANCE_TRANSCRIPT_CLEANUP_PRESETS,
	type LocalAssistanceTranscriptCleanupPreset,
	type LocalAssistanceTranscriptCleanupState,
} from '../local-assistance-cleanup.ts';

type Copy = Readonly<Record<string, string | undefined>>;

export interface LocalAssistanceCleanupReviewProps {
	readonly copy: Copy;
	readonly cleanup: LocalAssistanceTranscriptCleanupState;
	readonly onPresetChange: (preset: LocalAssistanceTranscriptCleanupPreset) => unknown;
	readonly onSelectionChange: (proposalId: string, selected: boolean) => unknown;
	readonly onAccept: () => unknown;
	readonly onReject: () => unknown;
}

export default function LocalAssistanceCleanupReview({
	copy, cleanup, onPresetChange, onSelectionChange, onAccept, onReject,
}: LocalAssistanceCleanupReviewProps) {
	if (cleanup.phase === 'loading') {
		return <section className="kw-local-assistance__cleanup" aria-labelledby="local-cleanup-heading">
			<h3 id="local-cleanup-heading">{text(copy, 'localAssistanceCleanupHeading',
				'Transcript cleanup proposals')}</h3>
			<p role="status">{text(copy, 'localAssistanceCleanupPreparing',
				'Preparing deterministic cleanup proposals.')}</p>
		</section>;
	}
	if (cleanup.phase === 'unavailable' || cleanup.phase === 'error') {
		return <section className="kw-local-assistance__cleanup" aria-labelledby="local-cleanup-heading">
			<h3 id="local-cleanup-heading">{text(copy, 'localAssistanceCleanupHeading',
				'Transcript cleanup proposals')}</h3>
			<p role={cleanup.phase === 'error' ? 'alert' : 'status'}>{cleanup.error
				?? text(copy, 'localAssistanceCleanupUnavailable',
					'This reviewed transcript has no deterministic cleanup proposals.')}</p>
		</section>;
	}
	if (cleanup.phase === 'accepted' || cleanup.phase === 'rejected') {
		return <section className="kw-local-assistance__cleanup" aria-labelledby="local-cleanup-heading">
			<h3 id="local-cleanup-heading">{text(copy, 'localAssistanceCleanupHeading',
				'Transcript cleanup proposals')}</h3>
			<p role="status">{cleanup.phase === 'accepted'
				? text(copy, 'localAssistanceCleanupAccepted', 'The selected cleanup proposals were applied.')
				: text(copy, 'localAssistanceCleanupRejected',
					'The cleanup proposals were rejected without changing the project.')}</p>
		</section>;
	}
	const accepting = cleanup.phase === 'accepting';
	const selected = new Set(cleanup.selectedProposalIds);
	return <section className="kw-local-assistance__cleanup" aria-labelledby="local-cleanup-heading">
		<h3 id="local-cleanup-heading">{text(copy, 'localAssistanceCleanupHeading',
			'Transcript cleanup proposals')}</h3>
		<p>{text(copy, cleanup.usesVoiceActivity
			? 'localAssistanceCleanupDescriptionWithVad' : 'localAssistanceCleanupDescription',
		cleanup.usesVoiceActivity
			? 'Nothing is applied until you select proposals and explicitly apply them. Silence choices use the reviewed VAD result from this selection.'
			: 'Nothing is applied until you select proposals and explicitly apply them.')}</p>
		<label>{text(copy, 'localAssistanceCleanupPreset', 'Cleanup preset')}
			<select value={cleanup.preset} disabled={accepting}
				onChange={(event) => { void onPresetChange(
					event.currentTarget.value as LocalAssistanceTranscriptCleanupPreset,
				); }}>
				{ASSISTANCE_TRANSCRIPT_CLEANUP_PRESETS.map((preset) => <option
					key={preset} value={preset}>{presetLabel(copy, preset)}</option>)}
			</select>
		</label>
		<ul className="kw-local-assistance__cleanup-list">
			{cleanup.proposals.map((proposal) => <li key={proposal.id}>
				<label>
					<input type="checkbox" checked={selected.has(proposal.id)} disabled={accepting}
						onChange={(event) => {
							void onSelectionChange(proposal.id, event.currentTarget.checked);
						}} />
					<span>{proposalLabel(copy, proposal.kind, proposal.text)}</span>
					<small>{template(text(copy, 'localAssistanceCleanupFrames',
						'frames {start}–{end}'), { start: String(proposal.startFrame),
						end: String(proposal.endFrame) })}</small>
				</label>
			</li>)}
		</ul>
		<div className="kw-local-assistance__cleanup-actions">
			<button type="button" disabled={accepting || selected.size === 0}
				onClick={() => { void onAccept(); }}>{text(copy, 'localAssistanceCleanupApply',
					'Apply selected cleanup')}</button>
			<button type="button" disabled={accepting}
				onClick={() => { void onReject(); }}>{text(copy, 'localAssistanceCleanupReject',
					'Reject cleanup')}</button>
		</div>
	</section>;
}

function presetLabel(copy: Copy, preset: LocalAssistanceTranscriptCleanupPreset): string {
	if (preset === 'conservative') {
		return text(copy, 'localAssistanceCleanupPresetConservative', 'Conservative');
	}
	if (preset === 'aggressive') {
		return text(copy, 'localAssistanceCleanupPresetAggressive', 'Aggressive');
	}
	return text(copy, 'localAssistanceCleanupPresetBalanced', 'Balanced');
}

function proposalLabel(
	copy: Copy,
	kind: LocalAssistanceTranscriptCleanupState['proposals'][number]['kind'],
	value: string,
): string {
	if (kind === 'silence') return text(copy, 'localAssistanceCleanupMeasuredSilence', 'Measured silence');
	return template(text(copy, kind === 'filler' ? 'localAssistanceCleanupFiller'
		: 'localAssistanceCleanupRepetition', kind === 'filler' ? 'Filler: {text}' : 'Repetition: {text}'),
	{ text: value });
}

function text(copy: Copy, key: string, fallback: string): string {
	return copy[key] || fallback;
}

function template(value: string, variables: Readonly<Record<string, string>>): string {
	return Object.entries(variables).reduce((result, [key, replacement]) =>
		result.replaceAll(`{${key}}`, replacement), value);
}
