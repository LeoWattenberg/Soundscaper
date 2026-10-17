/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionLayer } from '../../motion-composition.ts';
import { motionColor } from '../../motion-property.ts';
import { motionEllipsePath, motionPolygonPath, motionRectanglePath } from '../../motion-shape-primitives.ts';
import type { MotionscaperShapeEdit } from '../../../../motionscaper/editor-shape-commands.ts';
import { parseMotionNumberInput } from './motion-exact-input.ts';

export default function MotionShapeCollection({ copy, layer, disabled, onEdit, onError }: Readonly<{
	copy: Readonly<Record<string, string>>; layer: Extract<MotionLayer, { kind: 'shapes' }>; disabled: boolean;
	onEdit: (edit: MotionscaperShapeEdit) => void; onError: (error: unknown) => void;
}>) {
	const [selected, setSelected] = useState(''); const current = layer.shapes.find((entry) => entry.id === selected) ?? layer.shapes[0]!;
	const index = layer.shapes.indexOf(current); const [kind, setKind] = useState('rectangle'); const [values, setValues] = useState(['0', '0', '100', '100']);
	const add = () => { try {
		const [x, y, width, height] = values.map(parseMotionNumberInput) as [number, number, number, number];
		if (width <= 0 || height <= 0 || width > 32768 || height > 32768) throw new RangeError(copy.motionscaperLayerInvalid);
		const path = kind === 'rectangle' ? motionRectanglePath({ x, y, width, height }) : kind === 'ellipse' ? motionEllipsePath({ center: [x + width / 2, y + height / 2], radius: [width / 2, height / 2] })
			: motionPolygonPath({ center: [x + width / 2, y + height / 2], radius: Math.min(width, height) / 2, innerRadius: Math.min(width, height) / 5, points: 5 });
		const id = crypto.randomUUID(); onEdit({ type: 'add', index: layer.shapes.length, value: { id, path, fill: current.fill ?? motionColor([1, 1, 1, 1]), stroke: current.stroke } }); setSelected(id);
	} catch (error) { onError(error); } };
	const reorder = (delta: number) => { const ids = layer.shapes.map(({ id }) => id); [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]; onEdit({ type: 'reorder', ids }); };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperShapesCollection}</legend>
		<label>{copy.motionscaperShapePath}<select value={current.id} onChange={(event) => setSelected(event.currentTarget.value)}>{layer.shapes.map((entry, offset) => <option data-motion-shape key={entry.id} value={entry.id}>{copy.motionscaperShapePath} {offset + 1}</option>)}</select></label>
		<Button variant="secondary" disabled={index === 0} onClick={() => reorder(-1)}>{copy.motionscaperMoveEarlier}</Button>
		<Button variant="secondary" disabled={index === layer.shapes.length - 1} onClick={() => reorder(1)}>{copy.motionscaperMoveLater}</Button>
		<Button variant="secondary" onClick={() => { const newId = crypto.randomUUID(); onEdit({ type: 'duplicate', id: current.id, newId }); setSelected(newId); }}>{copy.motionscaperDuplicateShape}</Button>
		<Button variant="secondary" disabled={layer.shapes.length === 1} onClick={() => onEdit({ type: 'remove', id: current.id })}>{copy.motionscaperRemoveShape}</Button>
		<label>{copy.motionscaperShapeType}<select value={kind} onChange={(event) => setKind(event.currentTarget.value)}>{['rectangle', 'ellipse', 'star'].map((entry) => <option key={entry} value={entry}>{copy[`motionscaperShapeType_${entry}`]}</option>)}</select></label>
		{values.map((value, offset) => <label key={offset}>{copy[`motionscaperShapeField_${offset}`]}<input value={value} onChange={(event) => setValues(values.map((entry, i) => i === offset ? event.currentTarget.value : entry))} /></label>)}
		<Button variant="secondary" onClick={add}>{copy.motionscaperAddShape}</Button><p>{copy.motionscaperShapesHint}</p>
	</fieldset>;
}
