/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';
import { Button } from '@dilsonspickles/components';

import {
	ADM_BED_CHANNEL_ORDER,
	normalizeAdmProjectMetadata,
	type AdmAuthoredMetadata,
	type AdmBedLayout,
	type AdmProjectMetadata,
} from '../adm-project-metadata.ts';
import {
	createDefaultAdmMetadata,
	listAdmEditorSourceChannels,
	setAdmEditorAssignment,
	setAdmEditorLayout,
} from './adm-metadata-editor-model.ts';

interface AdmMetadataFieldsProps {
	readonly value: AdmProjectMetadata | null;
	readonly project: unknown;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled?: boolean;
	readonly onCommit: (value: AdmProjectMetadata | null) => void;
}

interface DraftFieldProps {
	readonly name: string;
	readonly label: string;
	readonly value: string;
	readonly disabled: boolean;
	readonly maxLength?: number;
	readonly pattern?: string;
	readonly onCommit: (value: string) => void;
}

function DraftField({ name, label, value, disabled, maxLength = 512, pattern, onCommit }: DraftFieldProps) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = (input: HTMLInputElement) => {
		if (!input.checkValidity()) return;
		if (draft !== value) onCommit(draft);
	};
	return (
		<label>
			<span>{label}</span>
			<input
				name={name}
				value={draft}
				disabled={disabled}
				maxLength={maxLength}
				pattern={pattern}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={(event) => commit(event.currentTarget)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') {
						setDraft(value);
						event.currentTarget.blur();
					} else if (event.key === 'Enter') event.currentTarget.blur();
				}}
			/>
		</label>
	);
}

function normalizeAuthored(value: AdmAuthoredMetadata): AdmAuthoredMetadata {
	return normalizeAdmProjectMetadata(value) as AdmAuthoredMetadata;
}

export function AdmMetadataFields({
	value,
	project,
	copy,
	disabled = false,
	onCommit,
}: AdmMetadataFieldsProps) {
	if (value == null) return (
		<div className="audio-editor-adm-fields" data-adm-metadata-editor data-adm-mode="none">
			<p className="audio-editor-panel-hint">{copy.admDisabledHint}</p>
			<Button disabled={disabled} onClick={() => onCommit(createDefaultAdmMetadata(project))}>
				{copy.admEnable}
			</Button>
		</div>
	);

	if (value.mode === 'passthrough') {
		const currentRevision = Number((project as Readonly<{ revision?: unknown }> | null)?.revision);
		const pristine = value.valid && currentRevision === value.pristineRevision;
		return (
			<div className="audio-editor-adm-fields" data-adm-metadata-editor data-adm-mode="passthrough">
				<p className="audio-editor-panel-hint">{pristine ? copy.admPassthroughPristine : copy.admPassthroughStale}</p>
				<dl className="audio-editor-adm-summary">
					<div><dt>{copy.admPayload}</dt><dd>{value.payload.kind.toUpperCase()}</dd></div>
					<div><dt>{copy.admChannels}</dt><dd>{value.geometry.channelCount}</dd></div>
					<div><dt>{copy.sampleRate}</dt><dd>{`${value.geometry.sampleRate} Hz`}</dd></div>
				</dl>
				{value.warnings.length > 0 && <p role="status">{value.warnings.join(' ')}</p>}
				<div className="audio-editor-adm-actions">
					<Button disabled={disabled} onClick={() => onCommit(createDefaultAdmMetadata(project))}>
						{copy.admConvertAuthored}
					</Button>
					<Button variant="secondary" disabled={disabled} onClick={() => onCommit(null)}>{copy.admRemove}</Button>
				</div>
			</div>
		);
	}

	const authored = value;
	const sourceChannels = listAdmEditorSourceChannels(project);
	const commitNamed = (
		section: 'programme' | 'content',
		field: 'name' | 'language',
		nextValue: string,
	) => onCommit(normalizeAuthored({ ...authored, [section]: { ...authored[section], [field]: nextValue } }));
	const commitBedName = (name: string) => onCommit(normalizeAuthored({
		...authored,
		bed: { ...authored.bed, name },
	}));

	return (
		<div className="audio-editor-adm-fields" data-adm-metadata-editor data-adm-mode="authored">
		<p className="audio-editor-panel-hint">{copy.admDirectSpeakersHint}</p>
		<DraftField name="adm-programme-name" label={copy.admProgrammeName} value={authored.programme.name} disabled={disabled} onCommit={(next) => commitNamed('programme', 'name', next)} />
		<DraftField name="adm-programme-language" label={copy.admProgrammeLanguage} value={authored.programme.language} disabled={disabled} maxLength={3} pattern="[A-Za-z]{2,3}" onCommit={(next) => commitNamed('programme', 'language', next)} />
		<DraftField name="adm-content-name" label={copy.admContentName} value={authored.content.name} disabled={disabled} onCommit={(next) => commitNamed('content', 'name', next)} />
		<DraftField name="adm-content-language" label={copy.admContentLanguage} value={authored.content.language} disabled={disabled} maxLength={3} pattern="[A-Za-z]{2,3}" onCommit={(next) => commitNamed('content', 'language', next)} />
		<DraftField name="adm-bed-name" label={copy.admBedName} value={authored.bed.name} disabled={disabled} onCommit={commitBedName} />
		<label>
			<span>{copy.admBedLayout}</span>
			<select
				name="adm-bed-layout"
				value={authored.bed.layout}
				disabled={disabled}
				onChange={(event) => onCommit(setAdmEditorLayout(authored, project, event.currentTarget.value as AdmBedLayout))}
			>
				<option value="mono">{copy.mono}</option>
				<option value="stereo">{copy.stereo}</option>
				<option value="5.1">5.1</option>
			</select>
		</label>
		<fieldset className="audio-editor-adm-routing">
			<legend>{copy.admRouting}</legend>
			{sourceChannels.length === 0 && <p className="audio-editor-panel-hint">{copy.admNoTerminalStrips}</p>}
			{sourceChannels.map((source) => {
				const assignment = authored.bed.assignments.find((candidate) => (
					candidate.stripKind === source.stripKind
					&& candidate.stripId === source.stripId
					&& candidate.sourceChannel === source.sourceChannel
				));
				return (
					<div className="audio-editor-adm-route" key={`${source.stripKind}:${source.stripId}:${source.sourceChannel}`}>
						<span>{source.label}</span>
						<select
							aria-label={`${source.label} ${copy.admBedChannel}`}
							value={assignment?.bedChannel || ''}
							disabled={disabled}
							onChange={(event) => onCommit(setAdmEditorAssignment(authored, {
								...source,
								bedChannel: event.currentTarget.value ? event.currentTarget.value as never : null,
								gain: assignment?.gain ?? 1,
							}))}
						>
							<option value="">{copy.none}</option>
							{ADM_BED_CHANNEL_ORDER[authored.bed.layout].map((channel) => <option key={channel} value={channel}>{channel}</option>)}
						</select>
						<input
							type="number"
							min="0"
							max="4"
							step="0.01"
							aria-label={`${source.label} ${copy.gain}`}
							value={assignment?.gain ?? 1}
							disabled={disabled || !assignment}
							onChange={(event) => onCommit(setAdmEditorAssignment(authored, {
								...source,
								bedChannel: assignment?.bedChannel ?? null,
								gain: Number(event.currentTarget.value),
							}))}
						/>
					</div>
				);
			})}
		</fieldset>
		<Button variant="secondary" disabled={disabled} onClick={() => onCommit(null)}>{copy.admRemove}</Button>
		</div>
	);
}

export default AdmMetadataFields;
