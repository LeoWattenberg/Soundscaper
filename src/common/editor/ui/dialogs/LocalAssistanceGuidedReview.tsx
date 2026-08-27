/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lazy Guided review surface; every admitted choice begins unchecked. */

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';

import type {
	LocalAssistanceGuidedReviewedResult,
} from '../local-assistance-guided-result-review.ts';
import type { AssistanceOwnedHighlightProposalsV1 } from
	'../../assistance/owned-video-highlight-transform-types-v1.ts';
import type { AssistanceOwnedReframePathV1 } from
	'../../assistance/owned-video-highlight-transform-types-v1.ts';
import { createLocalAssistanceCleanupAuditionWave } from
	'../local-assistance-cleanup-audition.ts';

type Copy = Readonly<Record<string, string | undefined>>;
type ReviewCrop = Readonly<{ left: number; top: number; right: number; bottom: number }>;

export interface LocalAssistanceGuidedReviewProps {
	readonly copy: Copy;
	readonly review: LocalAssistanceGuidedReviewedResult;
	readonly selectedChoiceIds: readonly string[];
	readonly onChoiceChange: (choiceId: string, selected: boolean) => unknown;
	readonly auditionAudio?: Blob | null;
	readonly auditionSourceStartFrame?: number | null;
	readonly auditionSourceSampleRate?: number | null;
	readonly previewVideo?: Blob | null;
	readonly reframeDraft?: AssistanceOwnedReframePathV1 | null;
	readonly onReframeCropChange?: (sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>) => unknown;
	readonly highlightDraft?: AssistanceOwnedHighlightProposalsV1 | null;
	readonly onHighlightTitleChange?: (proposalId: string, title: string) => unknown;
	readonly onHighlightTrimChange?: (
		proposalId: string, startFrame: number, endFrame: number,
	) => unknown;
	readonly onHighlightCropChange?: (proposalId: string, sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>) => unknown;
}

export default function LocalAssistanceGuidedReview({
	copy, review, selectedChoiceIds, onChoiceChange, auditionAudio = null, previewVideo = null,
	auditionSourceStartFrame = null, auditionSourceSampleRate = null,
	reframeDraft, highlightDraft,
	onReframeCropChange = () => undefined,
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
		{auditionAudio === null ? null : <AudioAudition body={auditionAudio}
			label={text(copy, 'localAssistanceOriginalSelection', 'Original selection')}
			skipRanges={cleanupSkipRanges(review, selectedChoiceIds,
				auditionSourceStartFrame, auditionSourceSampleRate)} />}
		{review.workflowId === 'clean-filler-silence' && auditionAudio !== null
			? <p>{text(copy, 'localAssistanceCleanupAudition',
				'Audition skips checked ranges without changing the project.')}</p> : null}
		{review.outputs.filter(({ mediaType }) => mediaType === 'audio/wav').map((output) =>
			<AudioAudition key={output.claim.claimId} body={output.body} label={output.slotId} />)}
		{review.workflowId === 'make-highlights' && previewVideo !== null
			? <VideoTransport body={previewVideo}
				label={text(copy, 'localAssistanceHighlightTransportPreview', 'Transport preview')} />
			: null}
		{review.workflowId === 'generate-editorial-text'
			? <EditorialProposals review={review} /> : null}
		{review.workflowId === 'reframe' && reframeDraft
			? <ReframePath copy={copy} draft={reframeDraft} onCrop={onReframeCropChange} /> : null}
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

function ReframePath({ copy, draft, onCrop }: Readonly<{
	copy: Copy;
	draft: AssistanceOwnedReframePathV1;
	onCrop: (sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>) => unknown;
}>) {
	const [keyframeIndex, setKeyframeIndex] = useState(0);
	const keyframe = draft.path.keyframes[keyframeIndex]!;
	return <div className="kw-local-assistance__reframe-path">
		<p>{text(copy, 'localAssistanceReframeTargetAspect', 'Target aspect')}:{' '}
			{String(draft.path.targetAspect.width)}:{String(draft.path.targetAspect.height)}</p>
		<p>{text(copy, 'localAssistanceReframeKeyframePosition', 'Keyframe')} {' '}
			{String(keyframeIndex + 1)} / {String(draft.path.keyframes.length)}</p>
		<div className="kw-local-assistance__reframe-navigation">
			<button type="button" disabled={keyframeIndex === 0}
				onClick={() => setKeyframeIndex((index) => Math.max(0, index - 1))}>
				{text(copy, 'localAssistancePreviousKeyframe', 'Previous keyframe')}
			</button>
			<button type="button" disabled={keyframeIndex === draft.path.keyframes.length - 1}
				onClick={() => setKeyframeIndex((index) => Math.min(
					draft.path.keyframes.length - 1, index + 1,
				))}>{text(copy, 'localAssistanceNextKeyframe', 'Next keyframe')}</button>
		</div>
		<fieldset key={keyframe.sourceFrame}>
			<legend>{text(copy, 'localAssistanceReframeCropKeyframe', 'Crop keyframe')}{' '}
				{String(keyframe.sourceFrame)}</legend>
			<DraggableCropOverlay crop={keyframe.crop}
				label={text(copy, 'localAssistanceReframeCropOverlay', 'Draggable crop overlay')}
				onCrop={(crop) => onCrop(keyframe.sourceFrame, crop)} />
			<label>{text(copy, 'localAssistanceReframeHorizontalPosition', 'Horizontal position')}
				<input type="range" min={0} max={positionMaximum(keyframe.crop, 'horizontal')}
					step={0.001} value={keyframe.crop.left} onChange={(event) => {
						const left = Number(event.currentTarget.value);
						const width = 1 - keyframe.crop.left - keyframe.crop.right;
						void onCrop(keyframe.sourceFrame, { ...keyframe.crop,
							left, right: 1 - width - left });
					}} /></label>
			<label>{text(copy, 'localAssistanceReframeVerticalPosition', 'Vertical position')}
				<input type="range" min={0} max={positionMaximum(keyframe.crop, 'vertical')}
					step={0.001} value={keyframe.crop.top} onChange={(event) => {
						const top = Number(event.currentTarget.value);
						const height = 1 - keyframe.crop.top - keyframe.crop.bottom;
						void onCrop(keyframe.sourceFrame, { ...keyframe.crop,
							top, bottom: 1 - height - top });
					}} /></label>
		</fieldset>
	</div>;
}

function positionMaximum(
	crop: ReviewCrop,
	direction: 'horizontal' | 'vertical',
): number {
	const extent = direction === 'horizontal'
		? 1 - crop.left - crop.right : 1 - crop.top - crop.bottom;
	return Math.max(0, Math.floor((1 - extent) * 1_000) / 1_000);
}

function DraggableCropOverlay({ crop, label, onCrop }: Readonly<{
	crop: ReviewCrop;
	label: string;
	onCrop: (crop: ReviewCrop) => unknown;
}>) {
	const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const bounds = event.currentTarget.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return;
		const width = 1 - crop.left - crop.right;
		const height = 1 - crop.top - crop.bottom;
		const left = boundedPosition((event.clientX - bounds.left) / bounds.width - width / 2, width);
		const top = boundedPosition((event.clientY - bounds.top) / bounds.height - height / 2, height);
		void onCrop({ left, top, right: unit(1 - width - left), bottom: unit(1 - height - top) });
	};
	return <div className="kw-local-assistance__crop-overlay" aria-label={label}
		onPointerDown={(event) => {
			event.currentTarget.setPointerCapture(event.pointerId);
			move(event);
		}}
		onPointerMove={(event) => {
			if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
		}}
		onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
		style={{ paddingLeft: `${String(crop.left * 100)}%`,
			paddingRight: `${String(crop.right * 100)}%`,
			paddingTop: `${String(crop.top * 100)}%`,
			paddingBottom: `${String(crop.bottom * 100)}%` }}><span /></div>;
}

function CropPositionControls({ copy, crop, onCrop }: Readonly<{
	copy: Copy;
	crop: ReviewCrop;
	onCrop: (crop: ReviewCrop) => unknown;
}>) {
	return <>
		<label>{text(copy, 'localAssistanceReframeHorizontalPosition', 'Horizontal position')}
			<input type="range" min={0} max={positionMaximum(crop, 'horizontal')}
				step={0.001} value={crop.left} onChange={(event) => {
					const left = Number(event.currentTarget.value);
					const width = 1 - crop.left - crop.right;
					void onCrop({ ...crop, left, right: 1 - width - left });
				}} /></label>
		<label>{text(copy, 'localAssistanceReframeVerticalPosition', 'Vertical position')}
			<input type="range" min={0} max={positionMaximum(crop, 'vertical')}
				step={0.001} value={crop.top} onChange={(event) => {
					const top = Number(event.currentTarget.value);
					const height = 1 - crop.top - crop.bottom;
					void onCrop({ ...crop, top, bottom: 1 - height - top });
				}} /></label>
	</>;
}

function boundedPosition(value: number, extent: number): number {
	return unit(Math.min(1 - extent, Math.max(0, value)));
}

function unit(value: number): number {
	return Math.round(value * 1_000_000_000) / 1_000_000_000;
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
			{proposal.hook === null ? null : <p><strong>
				{text(copy, 'localAssistanceHighlightHook', 'Hook')}:</strong> {proposal.hook}</p>}
			{proposal.chapters.length === 0 ? null : <div><strong>
				{text(copy, 'localAssistanceHighlightChapters', 'Chapters')}:</strong><ol>
				{proposal.chapters.map((chapter) => <li key={chapter}>{chapter}</li>)}
			</ol></div>}
			{proposal.explanation === null ? null : <p><strong>
				{text(copy, 'localAssistanceHighlightExplanation', 'Explanation')}:</strong>{' '}
				{proposal.explanation}</p>}
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
				<DraggableCropOverlay crop={keyframe.crop}
					label={text(copy, 'localAssistanceHighlightCropOverlay', 'Draggable crop overlay')}
					onCrop={(crop) => onCrop(proposal.id, keyframe.sourceFrame, crop)} />
				<CropPositionControls copy={copy} crop={keyframe.crop}
					onCrop={(crop) => onCrop(proposal.id, keyframe.sourceFrame, crop)} />
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

function cleanupSkipRanges(
	review: LocalAssistanceGuidedReviewedResult,
	selectedIds: readonly string[],
	sourceStartFrame: number | null,
	sourceSampleRate: number | null,
): readonly Readonly<{ startSeconds: number; endSeconds: number }>[] {
	if (review.workflowId !== 'clean-filler-silence' || sourceStartFrame === null
		|| sourceSampleRate === null || sourceSampleRate < 1) return [];
	const semantic = review.outputs.find(({ slotId }) => slotId === 'cleanup-proposals')?.semantic;
	if (!semantic || typeof semantic !== 'object' || Array.isArray(semantic)) return [];
	const proposals = (semantic as Readonly<Record<string, unknown>>).proposals;
	if (!Array.isArray(proposals)) return [];
	const selected = new Set(selectedIds);
	return proposals.flatMap((value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
		const row = value as Readonly<Record<string, unknown>>;
		if (typeof row.id !== 'string' || !selected.has(row.id)
			|| !Number.isSafeInteger(row.startFrame) || !Number.isSafeInteger(row.endFrame)
			|| Number(row.startFrame) < sourceStartFrame || Number(row.endFrame) <= Number(row.startFrame)) {
			return [];
		}
		return [Object.freeze({
			startSeconds: (Number(row.startFrame) - sourceStartFrame) / sourceSampleRate,
			endSeconds: (Number(row.endFrame) - sourceStartFrame) / sourceSampleRate,
		})];
	});
}

function AudioAudition({ body, label, skipRanges = [] }: Readonly<{
	body: Blob;
	label: string;
	skipRanges?: readonly Readonly<{ startSeconds: number; endSeconds: number }>[];
}>) {
	const [source, setSource] = useState<string>();
	const serializedSkipRanges = JSON.stringify(skipRanges);
	useEffect(() => {
		let active = true;
		let url: string | null = null;
		const auditionRanges = parseAuditionRanges(serializedSkipRanges);
		const audition = auditionRanges.length > 0
			? createLocalAssistanceCleanupAuditionWave(body, auditionRanges) : Promise.resolve(body);
		void audition.then((auditionBody) => {
			if (!active) return;
			url = URL.createObjectURL(auditionBody);
			setSource(url);
		}).catch(() => { if (active) setSource(undefined); });
		return () => {
			active = false;
			if (url !== null) URL.revokeObjectURL(url);
		};
	}, [body, serializedSkipRanges]);
	return <label>{label}<audio controls preload="metadata" src={source}
		data-skip-range-count={skipRanges.length} /></label>;
}

function parseAuditionRanges(
	value: string,
): readonly Readonly<{ startSeconds: number; endSeconds: number }>[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((candidate) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
		const row = candidate as Readonly<Record<string, unknown>>;
		return typeof row.startSeconds === 'number' && typeof row.endSeconds === 'number'
			? [Object.freeze({ startSeconds: row.startSeconds, endSeconds: row.endSeconds })] : [];
	});
}

function VideoTransport({ body, label }: Readonly<{ body: Blob; label: string }>) {
	const [source, setSource] = useState<string>();
	useEffect(() => {
		const url = URL.createObjectURL(body);
		setSource(url);
		return () => URL.revokeObjectURL(url);
	}, [body]);
	return <label>{label}<video controls preload="metadata" src={source} /></label>;
}

function text(copy: Copy, key: string, fallback: string): string { return copy[key] || fallback; }
