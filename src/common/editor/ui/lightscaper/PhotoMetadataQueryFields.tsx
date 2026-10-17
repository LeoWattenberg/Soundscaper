/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useRef, useState } from 'react';
import type { PHOTO_METADATA_QUERY_COLUMNS_V2 } from '../../../../lightscaper/catalog/photo-metadata-query-columns-v2.ts';
import type { PhotoMetadataQueryColumnV2, PhotoPredicateV2 } from '../../../../lightscaper/catalog/photo-smart-query-types-v2.ts';
import type { LIGHTSCAPER_METADATA_QUERY_COPY_EN } from '../../../i18n/lightscaper-metadata-query-copy.ts';

export type PhotoMetadataQueryColumnsV2 = typeof PHOTO_METADATA_QUERY_COLUMNS_V2;
export interface PhotoMetadataQueryCopyV2 extends Readonly<Record<keyof typeof LIGHTSCAPER_METADATA_QUERY_COPY_EN, string>> {
	readonly photoFileName: string;
	readonly photoMetadataTitle: string;
	readonly photoCaption: string;
	readonly photoCreator: string;
	readonly photoCopyright: string;
	readonly photoLocation: string;
	readonly photoCaptureTime: string;
	readonly photoLens: string;
}
export interface PhotoMetadataQueryFieldsPropsV2 {
	readonly predicate: PhotoPredicateV2 | null;
	readonly columns: PhotoMetadataQueryColumnsV2;
	readonly normalizePredicate: (value: unknown) => PhotoPredicateV2;
	readonly copy: PhotoMetadataQueryCopyV2;
	readonly disabled: boolean;
	readonly onChange: (predicate: PhotoPredicateV2 | null, valid: boolean) => void;
}

type Operator = 'contains' | 'equals' | 'starts-with' | 'range' | 'known' | 'unknown';
interface Condition {
	readonly column: PhotoMetadataQueryColumnV2;
	readonly operator: Operator;
	readonly value: string;
	readonly from: string;
	readonly to: string;
}
const MAXIMUM_CONDITIONS = 16;
const freshCondition = (column: PhotoMetadataQueryColumnV2, columns: PhotoMetadataQueryColumnsV2): Condition => ({
	column, operator: columns[column].type === 'text' ? 'contains' : 'range', value: '', from: '', to: '',
});

function editableConditions(predicate: PhotoPredicateV2 | null): readonly Condition[] | null {
	if (predicate === null) return [];
	const terms = predicate.kind === 'all' ? predicate.terms : [predicate];
	if (terms.length > MAXIMUM_CONDITIONS) return null;
	const output: Condition[] = [];
	for (const term of terms) {
		if (term.kind === 'text') output.push({ column: term.column, operator: term.operator, value: term.value, from: '', to: '' });
		else if (term.kind === 'number') output.push({ column: term.column, operator: 'range', value: '',
			from: term.minimum === null ? '' : String(term.minimum), to: term.maximum === null ? '' : String(term.maximum) });
		else if (term.kind === 'time') output.push({ column: term.column, operator: 'range', value: '', from: term.from ?? '', to: term.to ?? '' });
		else if (term.kind === 'presence') output.push({ column: term.column, operator: term.value, value: '', from: '', to: '' });
		else return null;
	}
	return output;
}

function conditionPredicate(condition: Condition, columns: PhotoMetadataQueryColumnsV2): unknown {
	const { column, operator, value, from, to } = condition;
	if (operator === 'known' || operator === 'unknown') return { kind: 'presence', column, value: operator };
	const definition = columns[column];
	if (definition.type === 'text') return { kind: 'text', column, operator, value };
	if (definition.type === 'number') return { kind: 'number', column, minimum: from === '' ? null : Number(from), maximum: to === '' ? null : Number(to) };
	// Native datetime-local omits seconds when they are zero. Preserve the clock, without inventing an offset.
	const endpoint = (value: string) => value === '' ? null : definition.clock === 'local'
		&& /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value) ? `${value}:00` : value;
	return { kind: 'time', column, from: endpoint(from), to: endpoint(to) };
}

/** Local form drafts only; the injected product normalizer owns the predicate protocol. */
export default function PhotoMetadataQueryFields(props: PhotoMetadataQueryFieldsPropsV2) {
	const [conditions, setConditions] = useState(() => editableConditions(props.predicate));
	const [invalid, setInvalid] = useState(false);
	const current = useRef(props); current.current = props;
	const currentDraft = useRef(conditions); currentDraft.current = conditions;
	const { copy, columns, disabled } = props;
	const labels: Readonly<Record<PhotoMetadataQueryColumnV2, string>> = {
		'file-name': copy.photoFileName, title: copy.photoMetadataTitle, caption: copy.photoCaption,
		creator: copy.photoCreator, copyright: copy.photoCopyright, location: copy.photoLocation,
		'camera-make': copy.photoCameraMake, 'camera-model': copy.photoCameraModel, lens: copy.photoLens,
		orientation: copy.photoOrientation, 'capture-offset-minutes': copy.photoCaptureOffsetMinutes,
		'exposure-seconds': copy.photoExposureSeconds, aperture: copy.photoAperture, iso: copy.photoIso,
		'focal-length-mm': copy.photoFocalLengthMm, width: copy.photoWidth, height: copy.photoHeight,
		'capture-time': copy.photoCaptureTime, 'modified-time': copy.photoModifiedTime,
	};
	const publish = (next: readonly Condition[]) => {
		if (current.current.disabled || currentDraft.current !== conditions) return;
		currentDraft.current = next;
		setConditions(next);
		try {
			const predicate = next.length === 0 ? null : current.current.normalizePredicate({ kind: 'all',
				terms: next.map(condition => conditionPredicate(condition, columns)) });
			setInvalid(false); current.current.onChange(predicate, true);
		} catch { setInvalid(true); current.current.onChange(null, false); }
	};
	const update = (index: number, patch: Partial<Condition>) => {
		if (conditions) publish(conditions.map((condition, offset) => offset === index ? { ...condition, ...patch } : condition));
	};
	if (conditions === null) return <fieldset disabled={disabled}><legend>{copy.photoMetadataConditions}</legend>
		<p data-metadata-preserved>{copy.photoMetadataPreserved}</p>
		<button type="button" data-metadata-replace disabled={disabled} onClick={() => { publish([]); }}>{copy.photoMetadataReplaceConditions}</button>
	</fieldset>;
	return <fieldset disabled={disabled}><legend>{copy.photoMetadataConditions}</legend>
		{invalid && <p role="alert" data-metadata-invalid>{copy.photoMetadataInvalid}</p>}
		{conditions.map((condition, index) => {
			const definition = columns[condition.column], presence = condition.operator === 'known' || condition.operator === 'unknown';
			return <fieldset key={index} data-metadata-condition={index}><legend>{index + 1}</legend>
				<label>{copy.photoMetadataColumn}<select name={`metadataColumn-${index}`} disabled={disabled} value={condition.column}
					onChange={event => { update(index, freshCondition(event.currentTarget.value as PhotoMetadataQueryColumnV2, columns)); }}>
					{(Object.keys(columns) as PhotoMetadataQueryColumnV2[]).map(column => <option key={column} value={column}>{labels[column]}</option>)}
				</select></label>
				<label>{copy.photoMetadataOperator}<select name={`metadataOperator-${index}`} disabled={disabled} value={condition.operator}
					onChange={event => { update(index, { operator: event.currentTarget.value as Operator }); }}>
					{definition.type === 'text' ? <><option value="contains">{copy.photoMetadataContains}</option><option value="equals">{copy.photoMetadataEquals}</option>
						<option value="starts-with">{copy.photoMetadataStartsWith}</option></> : <option value="range">{copy.photoMetadataRange}</option>}
					<option value="known">{copy.photoMetadataKnown}</option><option value="unknown">{copy.photoMetadataUnknown}</option>
				</select></label>
				{!presence && definition.type === 'text' && <label>{copy.photoMetadataValue}
					{definition.multiline ? <textarea name={`metadataValue-${index}`} disabled={disabled} maxLength={256} value={condition.value}
						onChange={event => { update(index, { value: event.currentTarget.value }); }} />
						: <input name={`metadataValue-${index}`} disabled={disabled} maxLength={256} value={condition.value}
							onChange={event => { update(index, { value: event.currentTarget.value }); }} />}
				</label>}
				{!presence && definition.type === 'number' && <>
					<label>{copy.photoMetadataMinimum}<input type="number" name={`metadataMinimum-${index}`} disabled={disabled}
						min={definition.minimum} max={definition.maximum} step={definition.integer ? 1 : 'any'} value={condition.from}
						onChange={event => { update(index, { from: event.currentTarget.value }); }} /></label>
					<label>{copy.photoMetadataMaximum}<input type="number" name={`metadataMaximum-${index}`} disabled={disabled}
						min={definition.minimum} max={definition.maximum} step={definition.integer ? 1 : 'any'} value={condition.to}
						onChange={event => { update(index, { to: event.currentTarget.value }); }} /></label>
				</>}
				{!presence && definition.type === 'time' && <>
					<p>{copy.photoMetadataTimeHelp}</p>
					<label>{copy.photoMetadataFrom}<input name={`metadataFrom-${index}`} type={definition.clock === 'local' ? 'datetime-local' : 'text'}
						disabled={disabled} step="0.001" maxLength={24} value={condition.from} onChange={event => { update(index, { from: event.currentTarget.value }); }} /></label>
					<label>{copy.photoMetadataTo}<input name={`metadataTo-${index}`} type={definition.clock === 'local' ? 'datetime-local' : 'text'}
						disabled={disabled} step="0.001" maxLength={24} value={condition.to} onChange={event => { update(index, { to: event.currentTarget.value }); }} /></label>
				</>}
				<button type="button" data-metadata-remove={index} disabled={disabled} onClick={() => { publish(conditions.filter((_, offset) => offset !== index)); }}>
					{copy.photoMetadataRemoveCondition}</button>
			</fieldset>;
		})}
		<button type="button" data-metadata-add disabled={disabled || conditions.length >= MAXIMUM_CONDITIONS} onClick={() => {
			if (conditions.length < MAXIMUM_CONDITIONS) publish([...conditions, freshCondition('file-name', columns)]);
		}}>{copy.photoMetadataAddCondition}</button>
	</fieldset>;
}
