import { useEffect, useRef, useState } from 'react';

import {
	normalizeBextMetadataEditorValue,
	type BextMetadataEditorValue,
} from './bext-metadata-editor-model.ts';
import {
	cancelDraftEditOnEscape,
	createDraftBlurCommitGuard,
	draftBlurShouldCommit,
} from './draft-blur-commit.ts';

type BextTextFieldName = 'description' | 'originator' | 'originatorReference'
	| 'originationDate' | 'originationTime' | 'timeReference' | 'umid' | 'codingHistory';
type BextNumberFieldName = 'loudnessValue' | 'loudnessRange' | 'maxTruePeakLevel'
	| 'maxMomentaryLoudness' | 'maxShortTermLoudness';

interface BextMetadataFieldsProps {
	readonly value: BextMetadataEditorValue;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled?: boolean;
	readonly onCommit: (value: BextMetadataEditorValue) => void;
}

interface DraftFieldProps {
	readonly name: string;
	readonly label: string;
	readonly value: string | number | null;
	readonly disabled: boolean;
	readonly multiline?: boolean;
	readonly type?: 'text' | 'date' | 'time' | 'number';
	readonly inputMode?: 'numeric' | 'decimal';
	readonly maxLength?: number;
	readonly pattern?: string;
	readonly step?: string;
	readonly onCommit: (value: string) => void;
}

function displayValue(value: string | number | null): string {
	return value == null ? '' : String(value);
}

function DraftField({
	name,
	label,
	value,
	disabled,
	multiline = false,
	type = 'text',
	inputMode,
	maxLength,
	pattern,
	step,
	onCommit,
}: DraftFieldProps) {
	const presentedValue = displayValue(value);
	const [draft, setDraft] = useState(presentedValue);
	const blurCommitGuard = useRef(createDraftBlurCommitGuard()).current;
	useEffect(() => setDraft(presentedValue), [presentedValue]);
	const commit = () => {
		if (!draftBlurShouldCommit(blurCommitGuard)) return;
		if (draft !== presentedValue) onCommit(draft);
	};
	const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		if (event.key === 'Escape') {
			cancelDraftEditOnEscape(
				blurCommitGuard,
				event,
				() => setDraft(presentedValue),
			);
		} else if (!multiline && event.key === 'Enter') event.currentTarget.blur();
	};
	return (
		<label>
			<span>{label}</span>
			{multiline ? (
				<textarea
					name={name}
					rows={5}
					value={draft}
					disabled={disabled}
					onChange={(event) => setDraft(event.currentTarget.value)}
					onBlur={commit}
					onKeyDown={onKeyDown}
				/>
			) : (
				<input
					name={name}
					type={type}
					inputMode={inputMode}
					maxLength={maxLength}
					pattern={pattern}
					step={step}
					value={draft}
					disabled={disabled}
					onChange={(event) => setDraft(event.currentTarget.value)}
					onBlur={commit}
					onKeyDown={onKeyDown}
				/>
			)}
		</label>
	);
}

export function BextMetadataFields({ value, copy, disabled = false, onCommit }: BextMetadataFieldsProps) {
	const commitText = (name: BextTextFieldName, nextValue: string) => {
		onCommit(normalizeBextMetadataEditorValue({ ...value, [name]: nextValue }));
	};
	const commitNumber = (name: BextNumberFieldName, nextValue: string) => {
		const trimmed = nextValue.trim();
		if (!trimmed) {
			onCommit({ ...value, [name]: null });
			return;
		}
		const number = Number(trimmed);
		if (Number.isFinite(number)) onCommit({ ...value, [name]: number });
	};
	const textFields: readonly Readonly<{
		name: BextTextFieldName;
		label: string;
		type?: 'text' | 'date' | 'time';
		inputMode?: 'numeric';
		maxLength?: number;
		pattern?: string;
		step?: string;
	}>[] = [
		{ name: 'description', label: copy.bextDescription, maxLength: 256 },
		{ name: 'originator', label: copy.bextOriginator, maxLength: 32 },
		{ name: 'originatorReference', label: copy.bextOriginatorReference, maxLength: 32 },
		{ name: 'originationDate', label: copy.bextOriginationDate, type: 'date', maxLength: 10 },
		{ name: 'originationTime', label: copy.bextOriginationTime, type: 'time', maxLength: 8, step: '1' },
		{ name: 'timeReference', label: copy.bextTimeReference, inputMode: 'numeric', maxLength: 20, pattern: '[0-9]*' },
		{ name: 'umid', label: copy.bextUmid, maxLength: 128 },
	];
	const numberFields: readonly Readonly<{ name: BextNumberFieldName; label: string }>[] = [
		{ name: 'loudnessValue', label: copy.bextLoudnessValue },
		{ name: 'loudnessRange', label: copy.bextLoudnessRange },
		{ name: 'maxTruePeakLevel', label: copy.bextMaxTruePeakLevel },
		{ name: 'maxMomentaryLoudness', label: copy.bextMaxMomentaryLoudness },
		{ name: 'maxShortTermLoudness', label: copy.bextMaxShortTermLoudness },
	];

	return (
		<div className="audio-editor-bext-fields" data-bext-metadata-editor>
			<label>
				<span>{copy.bextVersion}</span>
				<input name="version" value="2" readOnly aria-readonly="true" />
			</label>
			{textFields.map((field) => (
				<DraftField
					key={field.name}
					{...field}
					value={value[field.name]}
					disabled={disabled}
					onCommit={(nextValue) => commitText(field.name, nextValue)}
				/>
			))}
			{numberFields.map((field) => (
				<DraftField
					key={field.name}
					name={field.name}
					label={field.label}
					type="number"
					inputMode="decimal"
					step="0.01"
					value={value[field.name]}
					disabled={disabled}
					onCommit={(nextValue) => commitNumber(field.name, nextValue)}
				/>
			))}
			<DraftField
				name="codingHistory"
				label={copy.bextCodingHistory}
				value={value.codingHistory}
				disabled={disabled}
				multiline
				onCommit={(nextValue) => commitText('codingHistory', nextValue)}
			/>
		</div>
	);
}

export default BextMetadataFields;
