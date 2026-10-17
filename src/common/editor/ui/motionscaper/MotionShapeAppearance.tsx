/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionLayer, MotionShape } from '../../motion-composition.ts';
import type { MotionColor } from '../../motion-property.ts';
import type { MotionscaperAppearanceEdit } from '../../../../motionscaper/editor-appearance-commands.ts';
import { MotionAppearanceColor, MotionAppearanceNumber, type MotionAppearanceCopy } from './MotionAppearanceFields.tsx';
import MotionFillAppearance from './MotionFillAppearance.tsx';
import { parseMotionNumberInput } from './motion-exact-input.ts';
type Props = Readonly<{ copy: MotionAppearanceCopy; disabled: boolean; onEdit: (edit: MotionscaperAppearanceEdit) => void; onError: (error: unknown) => void }>;
export default function MotionShapeAppearance({ copy, shapes, revision, ...props }: Props & Readonly<{ shapes: readonly MotionShape[]; revision: number }>) {
	const [selected, setSelected] = useState(''); const shape = shapes.find(value => value.id === selected) ?? shapes[0];
	return <section>
		<fieldset disabled={props.disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperShapeAppearance}</legend>
			<label>{copy.motionscaperShapePath}<select value={shape?.id ?? ''} onChange={event => setSelected(event.currentTarget.value)}>{shapes.map((value, index) => <option key={value.id} value={value.id}>{copy.motionscaperShapePath} {index + 1}</option>)}</select></label>
		</fieldset>
		{shape && <><MotionFillAppearance key={`fill/${shape.id}/${revision}`} copy={copy} fill={shape.fill} shapeId={shape.id} {...props} /><StrokeForm key={`stroke/${shape.id}/${revision}`} copy={copy} shape={shape} {...props} /></>}
	</section>;
}
function StrokeForm({ copy, shape, disabled, onEdit, onError }: Props & Readonly<{ shape: MotionShape }>) {
	const [enabled, setEnabled] = useState(shape.stroke !== null); const [color, setColor] = useState<MotionColor>(shape.stroke?.color.value ?? [0, 0, 0, 1]);
	const [width, setWidth] = useState(String(shape.stroke?.width.value ?? 1)); const [cap, setCap] = useState(shape.stroke?.lineCap ?? 'butt'), [join, setJoin] = useState(shape.stroke?.lineJoin ?? 'miter');
	const submit = () => { try { onEdit({ type: 'stroke', shapeId: shape.id, stroke: enabled ? { color, width: parseMotionNumberInput(width), lineCap: cap, lineJoin: join } : null }); } catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperStroke}</legend>
		<label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.currentTarget.checked)} />{copy.motionscaperStrokeEnabled}</label>
		{enabled && <><MotionAppearanceColor copy={copy} value={color} onChange={setColor} /><MotionAppearanceNumber label={copy.motionscaperStrokeWidth} value={width} min={0} onChange={setWidth} />
			<label>{copy.motionscaperStrokeCap}<select value={cap} onChange={event => setCap(event.currentTarget.value as typeof cap)}>{(['butt', 'round', 'square'] as const).map(value => <option key={value} value={value}>{copy[`motionscaperStroke_${value}`]}</option>)}</select></label>
			<label>{copy.motionscaperStrokeJoin}<select value={join} onChange={event => setJoin(event.currentTarget.value as typeof join)}>{(['miter', 'round', 'bevel'] as const).map(value => <option key={value} value={value}>{copy[`motionscaperStroke_${value}`]}</option>)}</select></label></>}
		<Button variant="secondary" onClick={submit}>{copy.motionscaperApplyStroke}</Button>
	</fieldset>;
}
export function MotionSolidAppearance({ copy, layer, disabled, onEdit, onError }: Props & Readonly<{ layer: Extract<MotionLayer, { kind: 'solid' }> }>) {
	const [color, setColor] = useState(layer.color.value); const [width, setWidth] = useState(String(layer.size.value[0])), [height, setHeight] = useState(String(layer.size.value[1]));
	const submit = () => { try { onEdit({ type: 'solid', color, size: [parseMotionNumberInput(width), parseMotionNumberInput(height)] }); } catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperSolid}</legend>
		<MotionAppearanceColor copy={copy} value={color} onChange={setColor} /><MotionAppearanceNumber label={copy.motionscaperWidth} value={width} min={1} onChange={setWidth} /><MotionAppearanceNumber label={copy.motionscaperHeight} value={height} min={1} onChange={setHeight} />
		<Button variant="secondary" onClick={submit}>{copy.motionscaperApplySolid}</Button>
	</fieldset>;
}
