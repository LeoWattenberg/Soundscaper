/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionEffect } from '../../motion-composition.ts';
import { VIDEO_EFFECT_TYPES, videoEffectDefinition } from '../../video-effects.js';
import { createMotionAuthoredEffect, type MotionscaperCompositingEdit } from '../../../../motionscaper/editor-compositing-commands.ts';
import { parseMotionNumberInput } from './motion-exact-input.ts';
import { normalizeMotionProperty } from '../../motion-property.ts';

type Props = Readonly<{ copy: Readonly<Record<string, string>>; effects: readonly MotionEffect[]; width: number; height: number; revision: number; disabled: boolean; onEdit: (edit: MotionscaperCompositingEdit) => void; onError: (error: unknown) => void }>;
export function motionEffectLabel(type: string, copy: Props['copy']): string {
	return type === 'corner-pin' ? copy.motionscaperCornerPin! : VIDEO_EFFECT_TYPES.includes(type) ? copy[videoEffectDefinition(type).labelKey]! : type;
}
export default function MotionEffectsPanel({ copy, effects, width, height, revision, disabled, onEdit, onError }: Props) {
	const [selected, setSelected] = useState(''); const [type, setType] = useState('color-adjust'); const value = effects.find(({ id }) => id === selected) ?? effects[0]; const index = value ? effects.indexOf(value) : -1;
	const reorder = (delta: number) => { const ids = effects.map(({ id }) => id); [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]; onEdit({ type: 'effect', change: { type: 'reorder', ids } }); };
	const add = () => { try { const id = crypto.randomUUID(); onEdit({ type: 'effect', change: { type: 'add', value: createMotionAuthoredEffect({ id, type, width, height }), index: effects.length } }); setSelected(id); } catch (error) { onError(error); } };
	return <section>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.videoEffects}</legend>
			<label>{copy.motionscaperEffect}<select value={value?.id ?? ''} onChange={(event) => setSelected(event.currentTarget.value)}>{effects.map((entry, offset) => <option data-motion-effect key={entry.id} value={entry.id}>{offset + 1}: {motionEffectLabel(entry.type, copy)}</option>)}</select></label>
			<Button variant="secondary" disabled={index <= 0} onClick={() => reorder(-1)}>{copy.motionscaperMoveEarlier}</Button><Button variant="secondary" disabled={index < 0 || index >= effects.length - 1} onClick={() => reorder(1)}>{copy.motionscaperMoveLater}</Button>
			<Button variant="secondary" disabled={!value} onClick={() => { if (value) onEdit({ type: 'effect', change: { type: 'remove', id: value.id } }); }}>{copy.motionscaperRemoveEffect}</Button>
			<label>{copy.motionscaperEffectType}<select value={type} onChange={(event) => setType(event.currentTarget.value)}>{[...VIDEO_EFFECT_TYPES, 'corner-pin'].map((entry) => <option key={entry} value={entry}>{motionEffectLabel(entry, copy)}</option>)}</select></label>
			<Button variant="secondary" onClick={add}>{copy.motionscaperAddEffect}</Button>
		</fieldset>
		{value && <EffectForm key={`${value.id}/${revision}`} copy={copy} value={value} disabled={disabled} onError={onError} onSubmit={(next) => onEdit({ type: 'effect', change: { type: 'replace', value: next } })} />}
	</section>;
}
function EffectForm({ copy, value, disabled, onSubmit, onError }: Readonly<{ copy: Props['copy']; value: MotionEffect; disabled: boolean; onSubmit: (effect: MotionEffect) => void; onError: Props['onError'] }>) {
	const [enabled, setEnabled] = useState(value.enabled); const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
	const definition = VIDEO_EFFECT_TYPES.includes(value.type) ? videoEffectDefinition(value.type) : null;
	const rows = value.parameters.flatMap((parameter) => {
		const property = parameter.value; if (property.kind !== 'scalar' && property.kind !== 'vector2') return [];
		const descriptor = definition?.params[parameter.id]; const label = descriptor ? copy[descriptor.labelKey]! : copy[`motionscaperCorner_${parameter.id}`] ?? parameter.id;
		const values = property.kind === 'scalar' ? [property.value] : property.value;
		return values.map((number, channel) => ({ key: `${parameter.id}:${channel}`, number, descriptor, label: values.length === 1 ? label : `${label} ${copy[channel === 0 ? 'motionscaperChannel_x' : 'motionscaperChannel_y']}` }));
	});
	const submit = () => { try {
		const parameters = value.parameters.map((parameter) => {
			const property = parameter.value; if (property.kind !== 'scalar' && property.kind !== 'vector2') return parameter;
			const original = property.kind === 'scalar' ? [property.value] : property.value;
			const changed = original.map((number, channel) => { const field = fields[`${parameter.id}:${channel}`]; return field === undefined ? number : definition?.params[parameter.id]?.control === 'color' ? Number.parseInt(field.slice(1), 16) : parseMotionNumberInput(field); });
			return { ...parameter, value: normalizeMotionProperty({ ...property, value: property.kind === 'scalar' ? changed[0] : changed }) };
		}); onSubmit({ ...value, enabled, parameters });
	} catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperEffectSettings}</legend>
		<label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />{copy.motionscaperEffectEnabled}</label>
		{rows.map((row) => {
			const field = fields[row.key] ?? (row.descriptor?.control === 'color' ? `#${row.number.toString(16).padStart(6, '0')}` : String(row.number));
			return <label key={row.key}>{row.label}{row.descriptor?.control === 'select'
				? <select value={field} onChange={(event) => setFields({ ...fields, [row.key]: event.currentTarget.value })}>{row.descriptor.options?.map((option: { value: number; labelKey: string }) => <option key={option.value} value={option.value}>{copy[option.labelKey]}</option>)}</select>
				: <input type={row.descriptor?.control === 'color' ? 'color' : 'number'} step={row.descriptor?.step ?? 'any'} min={row.descriptor?.min} max={row.descriptor?.max} value={field} onChange={(event) => setFields({ ...fields, [row.key]: event.currentTarget.value })} />}</label>;
		})}
		<Button variant="secondary" onClick={submit}>{copy.motionscaperApplyEffect}</Button><p>{copy.motionscaperEffectHint}</p>
	</fieldset>;
}
