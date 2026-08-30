/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useState } from 'react';

import type {
	DocumentMasteringSequenceEntrySnapshot,
	DocumentMasteringSequenceRegionSnapshot,
	DocumentMasteringSequenceSnapshot,
} from '../../controller/document-mastering-sequence-snapshot.ts';
import type { SoundscaperProductionCopy } from '../soundscaper-production-copy.ts';
import type { MasteringSequenceDialogOperation } from './SoundscaperProductionDialog.tsx';

/**
 * Authoring the order a delivery realizes.
 *
 * Every control here emits the ordinary command for the edit it names, so a
 * sequence built in this panel and one built by any other caller are the same
 * document, undo the same way, and are refused the same way. The panel holds no
 * draft of the sequence: what it shows is the document, which is why an entry
 * whose region was deleted appears with its problem rather than disappearing.
 */

/**
 * The add a new sequence is created by.
 *
 * A mastering sequence states the timeline sequence it orders, and this panel is
 * the only place in the product that creates one; a payload without it is
 * refused before the document is touched, which is how the button came to fail
 * on every press.
 */
export function masteringSequenceAddOperation(
	primarySequenceId: string,
	id: string,
	name: string,
): MasteringSequenceDialogOperation {
	return {
		type: 'mastering-sequence/add',
		sequence: { id, sequenceId: primarySequenceId, name, entries: [] },
	};
}

export function masteringSequenceEntryApplyOperation(input: Readonly<{
	sequenceId: string;
	entryId: string;
	title: string | null;
	gapBeforeFrames: number;
	fadeInFrames: number;
	fadeOutFrames: number;
	metadata: Readonly<Record<string, string>>;
}>): MasteringSequenceDialogOperation {
	const entry = Object.freeze({ sequenceId: input.sequenceId, entryId: input.entryId });
	return Object.freeze({
		type: 'batch',
		commands: Object.freeze([
			Object.freeze({
				type: 'mastering-sequence/entry-retitle' as const,
				...entry,
				title: input.title,
			}),
			Object.freeze({
				type: 'mastering-sequence/entry-timing' as const,
				...entry,
				gapBeforeFrames: input.gapBeforeFrames,
				fadeInFrames: input.fadeInFrames,
				fadeOutFrames: input.fadeOutFrames,
			}),
			Object.freeze({
				type: 'mastering-sequence/entry-metadata' as const,
				...entry,
				metadata: Object.freeze({ ...input.metadata }),
			}),
		]),
	});
}

interface SoundscaperMasteringSequenceEditorProps {
	readonly copy: SoundscaperProductionCopy;
	readonly disabled: boolean;
	readonly sequences: readonly DocumentMasteringSequenceSnapshot[];
	readonly regions: readonly DocumentMasteringSequenceRegionSnapshot[];
	/** A mastering sequence states the sequence it orders; without one it cannot be created. */
	readonly primarySequenceId: string;
	readonly createId: () => string;
	readonly onOperation: (operation: MasteringSequenceDialogOperation) => void;
}

export default function SoundscaperMasteringSequenceEditor({
	copy, disabled, sequences, regions, primarySequenceId, createId, onOperation,
}: SoundscaperMasteringSequenceEditorProps) {
	const [selectedId, setSelectedId] = useState('');
	const [regionId, setRegionId] = useState('');
	const sequence = sequences.find(({ id }) => id === selectedId) ?? sequences[0] ?? null;
	const addableRegion = regions.find(({ id }) => id === regionId) ?? regions[0] ?? null;

	return <fieldset disabled={disabled} data-soundscaper-mastering-sequence-editor="sequences">
		<legend>{copy.masteringSequenceEditor}</legend>
		<div className="kw-audio-editor-dialog__actions">
			<label className="kw-audio-editor-dialog__field">
				<span>{copy.masteringSequence}</span>
				<select
					value={sequence?.id ?? ''}
					onChange={(event) => setSelectedId(event.currentTarget.value)}
				>
					{sequences.map((candidate) => <option key={candidate.id} value={candidate.id}>
						{candidate.name}
					</option>)}
				</select>
			</label>
			<button type="button" disabled={!primarySequenceId} onClick={() => onOperation(
				masteringSequenceAddOperation(primarySequenceId, createId(), copy.newMasteringSequence),
			)}>{copy.newMasteringSequence}</button>
			{sequence && <button type="button" onClick={() => {
				onOperation({ type: 'mastering-sequence/remove', sequenceId: sequence.id });
				setSelectedId('');
			}}>{copy.removeMasteringSequence}</button>}
		</div>

		{!sequence && <p>{copy.noMasteringSequences}</p>}
		{sequence && <>
			<form
				aria-label={copy.masteringSequenceName}
				onSubmit={(event) => {
					event.preventDefault();
					const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
					if (name) onOperation({ type: 'mastering-sequence/rename', sequenceId: sequence.id, name });
				}}
			>
				<label className="kw-audio-editor-dialog__field">
					<span>{copy.masteringSequenceName}</span>
					<input name="name" type="text" defaultValue={sequence.name} key={sequence.id + sequence.name} />
				</label>
				<button type="submit">{copy.masteringSequenceName}</button>
			</form>

			<p>{`${copy.masteringDeliveredLength}: ${sequence.totalFrames ?? '—'}`}</p>
			{!sequence.deliverable && <p role="alert">{copy.masteringUndeliverable}</p>}
			{sequence.issues.length > 0 && <section aria-label={copy.masteringIssues}>
				<h4>{copy.masteringIssues}</h4>
				<ul>
					{sequence.issues.map((issue, index) => <li key={`${issue.code}-${issue.entryId ?? index}`}>
						{issue.message}
					</li>)}
				</ul>
			</section>}

			<section aria-label={copy.masteringEntries}>
				<h4>{copy.masteringEntries}</h4>
				{sequence.entries.map((entry, index) => <EntryEditor
					key={entryFormKey(sequence.id, entry)}
					copy={copy}
					entry={entry}
					index={index}
					lastIndex={sequence.entries.length - 1}
					sequenceId={sequence.id}
					onOperation={onOperation}
				/>)}
			</section>

			{regions.length === 0 && <p>{copy.noMasteringRegions}</p>}
			{addableRegion && <div className="kw-audio-editor-dialog__actions">
				<label className="kw-audio-editor-dialog__field">
					<span>{copy.masteringAddEntry}</span>
					<select value={addableRegion.id} onChange={(event) => setRegionId(event.currentTarget.value)}>
						{regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
					</select>
				</label>
				<button type="button" onClick={() => onOperation({
					type: 'mastering-sequence/entry-add',
					sequenceId: sequence.id,
					entry: { id: createId(), annotationId: addableRegion.id },
				})}>{copy.masteringAddEntry}</button>
			</div>}
		</>}
	</fieldset>;
}

function entryFormKey(sequenceId: string, entry: DocumentMasteringSequenceEntrySnapshot): string {
	return JSON.stringify([
		sequenceId, entry.id, entry.annotationId, entry.title, entry.titleOverride, entry.durationFrames,
		entry.gapBeforeFrames, entry.fadeInFrames, entry.fadeOutFrames, entry.metadata,
	]);
}

function EntryEditor({ copy, entry, index, lastIndex, sequenceId, onOperation }: Readonly<{
	copy: SoundscaperProductionCopy;
	entry: DocumentMasteringSequenceEntrySnapshot;
	index: number;
	lastIndex: number;
	sequenceId: string;
	onOperation: (operation: MasteringSequenceDialogOperation) => void;
}>) {
	const [metadataError, setMetadataError] = useState('');
	const move = (toIndex: number): void => onOperation({
		type: 'mastering-sequence/entry-reorder', sequenceId, entryId: entry.id, toIndex,
	});
	return <form
		aria-label={entry.title}
		onSubmit={(event) => {
			event.preventDefault();
			const form = new FormData(event.currentTarget);
			const title = String(form.get('title') ?? '').trim();
			const metadata = parseMetadata(form.get('metadata'));
			if (metadata === null) {
				setMetadataError(copy.masteringEntryMetadataInvalid);
				return;
			}
			setMetadataError('');
			onOperation(masteringSequenceEntryApplyOperation({
				sequenceId,
				entryId: entry.id,
				// An emptied title returns the entry to the region's own name rather
				// than pinning the region's current name as an override.
				title: title === '' ? null : title,
				gapBeforeFrames: frames(form.get('gapBeforeFrames')),
				fadeInFrames: frames(form.get('fadeInFrames')),
				fadeOutFrames: frames(form.get('fadeOutFrames')),
				metadata,
			}));
		}}
	>
		<h5>{entry.title}</h5>
		{entry.durationFrames === null && <p role="alert">{copy.masteringMissingRegion}</p>}
		<label className="kw-audio-editor-dialog__field">
			<span>{copy.masteringEntryTitle}</span>
			<input name="title" type="text" defaultValue={entry.titleOverride ?? ''} placeholder={entry.title} />
		</label>
		<p className="audio-editor-panel-hint">{copy.masteringEntryTitleFromRegion}</p>
		<NumberField name="gapBeforeFrames" label={copy.masteringGapBefore} value={entry.gapBeforeFrames} />
		<NumberField name="fadeInFrames" label={copy.masteringFadeIn} value={entry.fadeInFrames} />
		<NumberField name="fadeOutFrames" label={copy.masteringFadeOut} value={entry.fadeOutFrames} />
		<label className="kw-audio-editor-dialog__field">
			<span>{copy.masteringEntryMetadata}</span>
			<textarea name="metadata" rows={3} spellCheck={false} defaultValue={JSON.stringify(entry.metadata)} />
		</label>
		{metadataError && <p role="alert">{metadataError}</p>}
		<div className="kw-audio-editor-dialog__actions">
			<button type="submit">{copy.applyLane}</button>
			<button type="button" disabled={index === 0} onClick={() => move(index - 1)}>
				{copy.masteringMoveEntryUp}
			</button>
			<button type="button" disabled={index === lastIndex} onClick={() => move(index + 1)}>
				{copy.masteringMoveEntryDown}
			</button>
			<button type="button" onClick={() => onOperation({
				type: 'mastering-sequence/entry-remove', sequenceId, entryId: entry.id,
			})}>{copy.masteringRemoveEntry}</button>
		</div>
	</form>;
}

function NumberField({ name, label, value }: Readonly<{
	name: string; label: string; value: number;
}>) {
	return <label className="kw-audio-editor-dialog__field">
		<span>{label}</span>
		<input name={name} type="number" min={0} step={1} defaultValue={value} />
	</label>;
}

function frames(value: FormDataEntryValue | null): number {
	const parsed = Number(String(value ?? '0'));
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** Null means the text is not a flat object of strings, which is a refusal rather than a silent drop. */
function parseMetadata(value: FormDataEntryValue | null): Readonly<Record<string, string>> | null {
	const text = String(value ?? '').trim();
	if (text === '') return Object.freeze({});
	try {
		const parsed: unknown = JSON.parse(text);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const entries = Object.entries(parsed as Record<string, unknown>);
		if (entries.some(([, entryValue]) => typeof entryValue !== 'string')) return null;
		return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
	} catch {
		return null;
	}
}
