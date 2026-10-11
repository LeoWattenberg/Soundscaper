/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionMask } from '../../motion-composition.ts';
import { motionEllipsePath, motionRectanglePath } from '../../motion-shape-primitives.ts';
import { createMotionAuthoredMask, type MotionscaperCompositingEdit } from '../../../../motionscaper/editor-compositing-commands.ts';
import { parseMotionNumberInput } from './motion-exact-input.ts';

type Props = Readonly<{ copy: Readonly<Record<string, string>>; masks: readonly MotionMask[]; width: number; height: number; revision: number; disabled: boolean; onEdit: (edit: MotionscaperCompositingEdit) => void; onError: (error: unknown) => void }>;
export default function MotionMasksPanel({ copy, masks, width, height, revision, disabled, onEdit, onError }: Props) {
	const [selected, setSelected] = useState(''); const [kind, setKind] = useState('rectangle'); const [fields, setFields] = useState(['0', '0', String(width), String(height)]);
	const value = masks.find(({ id }) => id === selected) ?? masks[0]; const index = value ? masks.indexOf(value) : -1;
	const reorder = (delta: number) => { const ids = masks.map(({ id }) => id); [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]; onEdit({ type: 'mask', change: { type: 'reorder', ids } }); };
	const add = () => { try {
		const [x, y, w, h] = fields.map(parseMotionNumberInput) as [number, number, number, number];
		const path = kind === 'rectangle' ? motionRectanglePath({ x, y, width: w, height: h }) : motionEllipsePath({ center: [x + w / 2, y + h / 2], radius: [w / 2, h / 2] });
		const id = crypto.randomUUID(); onEdit({ type: 'mask', change: { type: 'add', value: createMotionAuthoredMask(id, path), index: masks.length } }); setSelected(id);
	} catch (error) { onError(error); } };
	return <section>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperMasks}</legend>
			<label>{copy.motionscaperMask}<select value={value?.id ?? ''} onChange={(event) => setSelected(event.currentTarget.value)}>{masks.map((entry, offset) => <option data-motion-mask key={entry.id} value={entry.id}>{copy.motionscaperMask} {offset + 1}</option>)}</select></label>
			<Button variant="secondary" disabled={index <= 0} onClick={() => reorder(-1)}>{copy.motionscaperMoveEarlier}</Button><Button variant="secondary" disabled={index < 0 || index >= masks.length - 1} onClick={() => reorder(1)}>{copy.motionscaperMoveLater}</Button>
			<Button variant="secondary" disabled={!value} onClick={() => { if (value) onEdit({ type: 'mask', change: { type: 'remove', id: value.id } }); }}>{copy.motionscaperRemoveMask}</Button>
			<label>{copy.motionscaperShapeType}<select value={kind} onChange={(event) => setKind(event.currentTarget.value)}>{['rectangle', 'ellipse'].map((entry) => <option key={entry} value={entry}>{copy[`motionscaperShapeType_${entry}`]}</option>)}</select></label>
			{fields.map((field, i) => <label key={i}>{copy[`motionscaperMaskField_${i}`]}<input value={field} onChange={(event) => setFields(fields.map((entry, index) => index === i ? event.currentTarget.value : entry))} /></label>)}
			<Button variant="secondary" onClick={add}>{copy.motionscaperAddMask}</Button>
		</fieldset>
		{value && <MaskForm key={`${value.id}/${revision}`} copy={copy} value={value} disabled={disabled} onError={onError} onSubmit={(next) => onEdit({ type: 'mask', change: { type: 'replace', value: next } })} />}
	</section>;
}
function MaskForm({ copy, value, disabled, onSubmit, onError }: Readonly<{ copy: Props['copy']; value: MotionMask; disabled: boolean; onSubmit: (mask: MotionMask) => void; onError: Props['onError'] }>) {
	const [operation, setOperation] = useState(value.operation); const [inverted, setInverted] = useState(value.inverted);
	const [fields, setFields] = useState([value.opacity.value, ...value.feather.value, value.expansion.value].map(String));
	const submit = () => { try {
		const [opacity, x, y, expansion] = fields.map(parseMotionNumberInput) as [number, number, number, number];
		onSubmit({ ...value, operation, inverted, opacity: { ...value.opacity, value: opacity }, feather: { ...value.feather, value: [x, y] }, expansion: { ...value.expansion, value: expansion } });
	} catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperMaskSettings}</legend>
		<label>{copy.motionscaperMaskOperation}<select value={operation} onChange={(event) => setOperation(event.currentTarget.value as typeof operation)}>{(['add', 'subtract', 'intersect', 'difference'] as const).map((entry) => <option key={entry} value={entry}>{copy[`motionscaperMaskMode_${entry}`]}</option>)}</select></label>
		<label><input type="checkbox" checked={inverted} onChange={(event) => setInverted(event.currentTarget.checked)} />{copy.motionscaperInvertMask}</label>
		{fields.map((field, i) => <label key={i}>{copy[`motionscaperMaskValue_${i}`]}<input value={field} onChange={(event) => setFields(fields.map((entry, index) => index === i ? event.currentTarget.value : entry))} /></label>)}
		<Button variant="secondary" onClick={submit}>{copy.motionscaperApplyMask}</Button><p>{copy.motionscaperMaskHint}</p>
	</fieldset>;
}
