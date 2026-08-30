/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';

import './audio-editor-design-system/15-adm.css';

import {
	ADM_BED_CHANNEL_ORDER,
	ADM_BED_LAYOUTS,
	normalizeAdmProjectMetadata,
	type AdmAuthoredMetadata,
	type AdmBedLayout,
	type AdmProjectMetadata,
} from '../adm-project-metadata.ts';
import {
	addAdmEditorObject,
	admEditorChannelCount,
	createDefaultAdmMetadata,
	listAdmEditorSourceChannels,
	removeAdmEditorObject,
	setAdmEditorAssignment,
	setAdmEditorLayout,
	setAdmEditorObject,
	type AdmEditorSourceChannel,
} from './adm-metadata-editor-model.ts';
import { ADM_AUTHORED_MAXIMUM_CHANNELS } from '../adm-authored-objects.ts';
import { createStableId } from '../stable-id.js';
import {
	cancelDraftEditOnEscape,
	createDraftBlurCommitGuard,
	draftBlurShouldCommit,
} from './draft-blur-commit.ts';

interface AdmMetadataFieldsProps {
	readonly value: AdmProjectMetadata | null;
	readonly project: unknown;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled?: boolean;
	/** Injected so a rendered object identity is reproducible in a test. */
	readonly createId?: () => string;
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
	const blurCommitGuard = useRef(createDraftBlurCommitGuard()).current;
	useEffect(() => setDraft(value), [value]);
	const commit = (input: HTMLInputElement) => {
		if (!draftBlurShouldCommit(blurCommitGuard)) return;
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
						cancelDraftEditOnEscape(
							blurCommitGuard,
							event,
							() => setDraft(value),
						);
					} else if (event.key === 'Enter') event.currentTarget.blur();
				}}
			/>
		</label>
	);
}

function normalizeAuthored(value: AdmAuthoredMetadata): AdmAuthoredMetadata {
	return normalizeAdmProjectMetadata(value) as AdmAuthoredMetadata;
}

function validNumberInput(input: HTMLInputElement): number | null {
	if (!input.checkValidity() || input.value.trim() === '') return null;
	const value = Number(input.value);
	return Number.isFinite(value) ? value : null;
}

export function AdmMetadataFields({
	value,
	project,
	copy,
	disabled = false,
	createId,
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
				{ADM_BED_LAYOUTS.map((layout) => (
					<option key={layout} value={layout}>
						{layout === 'mono' ? copy.mono : layout === 'stereo' ? copy.stereo : layout}
					</option>
				))}
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
							onChange={(event) => {
								const gain = validNumberInput(event.currentTarget);
								if (gain == null) return;
								onCommit(setAdmEditorAssignment(authored, {
									...source,
									bedChannel: assignment?.bedChannel ?? null,
									gain,
								}));
							}}
						/>
					</div>
				);
			})}
		</fieldset>
		<AdmObjectFields
			authored={authored}
			copy={copy}
			disabled={disabled}
			sourceChannels={sourceChannels}
			createId={createId ?? (() => createStableId('adm-object'))}
			onCommit={onCommit}
		/>
		<Button variant="secondary" disabled={disabled} onClick={() => onCommit(null)}>{copy.admRemove}</Button>
		</div>
	);
}

export default AdmMetadataFields;

interface AdmObjectFieldsProps {
	readonly authored: AdmAuthoredMetadata;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly sourceChannels: readonly AdmEditorSourceChannel[];
	readonly createId: () => string;
	readonly onCommit: (value: AdmProjectMetadata | null) => void;
}

/**
 * Authoring the positioned objects a programme delivers after its bed.
 *
 * Adding one is a two-step choice — pick a source channel, then place it —
 * rather than a free-standing "new object", because an object with no signal
 * behind it is a channel of silence the delivery still has to carry.
 */
function AdmObjectFields({ authored, copy, disabled, sourceChannels, createId, onCommit }: AdmObjectFieldsProps) {
	const objects = authored.objects ?? [];
	const full = admEditorChannelCount(authored) >= ADM_AUTHORED_MAXIMUM_CHANNELS;
	const [pending, setPending] = useState('');
	const chosen = sourceChannels.find((source) => sourceKey(source) === pending) ?? sourceChannels[0];
	return (
		<fieldset className="audio-editor-adm-objects">
			<legend>{copy.admObjects}</legend>
			{objects.length === 0 && <p className="audio-editor-panel-hint">{copy.admNoObjects}</p>}
			{objects.map((object) => (
				<div className="audio-editor-adm-object" key={object.id}>
					<DraftField
						name={`adm-object-name-${object.id}`}
						label={copy.admObjectName}
						value={object.name}
						disabled={disabled}
						onCommit={(name) => onCommit(setAdmEditorObject(authored, object.id, { name }))}
					/>
					{([
						['azimuth', copy.admAzimuth, -180, 180],
						['elevation', copy.admElevation, -90, 90],
						['distance', copy.admDistance, 0, 1],
					] as const).map(([coordinate, label, minimum, maximum]) => (
						<label key={coordinate}>
							<span>{label}</span>
							<input
								type="number"
								min={minimum}
								max={maximum}
								step={coordinate === 'distance' ? 0.01 : 1}
								value={object.position[coordinate]}
								disabled={disabled}
								onChange={(event) => {
									const value = validNumberInput(event.currentTarget);
									if (value == null) return;
									onCommit(setAdmEditorObject(authored, object.id, {
										position: { ...object.position, [coordinate]: value },
									}));
								}}
							/>
						</label>
					))}
					<label>
						<span>{copy.gain}</span>
						<input
							type="number" min="0" max="4" step="0.01"
							value={object.gain}
							disabled={disabled}
							onChange={(event) => {
								const gain = validNumberInput(event.currentTarget);
								if (gain == null) return;
								onCommit(setAdmEditorObject(authored, object.id, { gain }));
							}}
						/>
					</label>
					<Button
						variant="secondary"
						disabled={disabled}
						onClick={() => onCommit(removeAdmEditorObject(authored, object.id))}
					>
						{copy.admRemoveObject}
					</Button>
				</div>
			))}
			{full
				? <p className="audio-editor-panel-hint">{copy.admObjectsFull}</p>
				: (
					<div className="audio-editor-adm-object-add">
						<label>
							<span>{copy.admObjectSource}</span>
							<select
								name="adm-object-source"
								value={chosen ? sourceKey(chosen) : ''}
								disabled={disabled || sourceChannels.length === 0}
								onChange={(event) => setPending(event.currentTarget.value)}
							>
								{sourceChannels.map((source) => (
									<option key={sourceKey(source)} value={sourceKey(source)}>{source.label}</option>
								))}
							</select>
						</label>
						<Button
							variant="secondary"
							disabled={disabled || !chosen}
							onClick={() => chosen && onCommit(addAdmEditorObject(authored, chosen, createId))}
						>
							{copy.admAddObject}
						</Button>
					</div>
				)}
		</fieldset>
	);
}

function sourceKey(source: AdmEditorSourceChannel): string {
	return `${source.stripKind}:${source.stripId}:${source.sourceChannel}`;
}
