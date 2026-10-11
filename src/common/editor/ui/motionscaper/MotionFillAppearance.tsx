/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionFill } from '../../motion-fill.ts';
import type { MotionColor } from '../../motion-property.ts';
import type { MotionAppearanceFillEdit } from '../../../../motionscaper/editor-appearance-commands.ts';
import { MotionAppearanceColor, MotionAppearanceNumber, type MotionAppearanceCopy } from './MotionAppearanceFields.tsx';
import { parseMotionNumberInput } from './motion-exact-input.ts';
interface Stop { readonly id: string; readonly offset: string; readonly color: MotionColor }
export default function MotionFillAppearance({ copy, fill, shapeId, disabled, onEdit, onError }: Readonly<{
	copy: MotionAppearanceCopy; fill: MotionFill | null; shapeId: string; disabled: boolean; onEdit: (edit: MotionAppearanceFillEdit) => void; onError: (error: unknown) => void;
}>) {
	const [kind, setKind] = useState<MotionAppearanceFillEdit['kind']>(fill?.kind ?? 'none');
	const [color, setColor] = useState<MotionColor>(fill?.kind === 'color' ? fill.value : [1, 1, 1, 1]);
	const [stops, setStops] = useState<readonly Stop[]>(() => fill && fill.kind !== 'color' ? fill.stops.map(stop => ({ id: stop.id, offset: String(stop.offset.value), color: stop.color.value }))
		: [{ id: crypto.randomUUID(), offset: '0', color: fill?.kind === 'color' ? fill.value : [1, 1, 1, 1] }, { id: crypto.randomUUID(), offset: '1', color: [0, 0, 0, 1] }]);
	const initial = { startX: fill?.kind === 'linear-gradient' ? fill.start.value[0] : 0, startY: fill?.kind === 'linear-gradient' ? fill.start.value[1] : 0,
		endX: fill?.kind === 'linear-gradient' ? fill.end.value[0] : 100, endY: fill?.kind === 'linear-gradient' ? fill.end.value[1] : 0,
		centerX: fill?.kind === 'radial-gradient' ? fill.center.value[0] : 0, centerY: fill?.kind === 'radial-gradient' ? fill.center.value[1] : 0, radius: fill?.kind === 'radial-gradient' ? fill.radius.value : 100 };
	const [fields, setFields] = useState<Readonly<Partial<Record<keyof typeof initial, string>>>>({});
	const number = (key: keyof typeof initial) => parseMotionNumberInput(fields[key] ?? String(initial[key]));
	const gradient = kind === 'linear-gradient' || kind === 'radial-gradient';
	const rows = (kind === 'linear-gradient' ? ['startX', 'startY', 'endX', 'endY'] : ['centerX', 'centerY', 'radius']) as (keyof typeof initial)[];
	const submit = () => { try {
		const values = gradient ? stops.map(stop => ({ ...stop, offset: parseMotionNumberInput(stop.offset) })).sort((a, b) => a.offset - b.offset) : undefined;
		onEdit({ type: 'fill', shapeId, kind, ...(kind === 'color' ? { color } : {}), ...(values ? { stops: values } : {}),
			...(kind === 'linear-gradient' ? { start: [number('startX'), number('startY')], end: [number('endX'), number('endY')] } : {}),
			...(kind === 'radial-gradient' ? { center: [number('centerX'), number('centerY')], radius: number('radius') } : {}) });
	} catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperFillType}</legend>
		<label>{copy.motionscaperFillType}<select value={kind} onChange={event => setKind(event.currentTarget.value as typeof kind)}>{(['none', 'color', 'linear-gradient', 'radial-gradient'] as const).map(value => <option key={value} value={value}>{copy[`motionscaperFill_${value}`]}</option>)}</select></label>
		{kind === 'color' && <MotionAppearanceColor copy={copy} value={color} onChange={setColor} />}
		{gradient && <>
			{rows.map(key => <MotionAppearanceNumber key={key} label={copy[`motionscaperGradient${key[0]!.toUpperCase()}${key.slice(1)}`]} value={fields[key] ?? String(initial[key])} onChange={value => setFields({ ...fields, [key]: value })} />)}
			{stops.map((stop, index) => <fieldset key={stop.id} className="motionscaper-timeline-actions"><legend>{copy.motionscaperGradientStop} {index + 1}</legend>
				<MotionAppearanceNumber label={copy.motionscaperGradientOffset} value={stop.offset} min={0} max={1} onChange={offset => setStops(stops.map(value => value.id === stop.id ? { ...value, offset } : value))} />
				<MotionAppearanceColor copy={copy} value={stop.color} onChange={color => setStops(stops.map(value => value.id === stop.id ? { ...value, color } : value))} />
				<Button variant="secondary" disabled={stops.length <= 2} onClick={() => setStops(stops.filter(value => value.id !== stop.id))}>{copy.motionscaperGradientRemove}</Button>
			</fieldset>)}
			<Button variant="secondary" disabled={stops.length >= 64} onClick={() => setStops([...stops, { id: crypto.randomUUID(), offset: '0.5', color: [1, 1, 1, 1] }])}>{copy.motionscaperGradientAdd}</Button>
		</>}
		<Button variant="secondary" onClick={submit}>{copy.motionscaperApplyFill}</Button>
	</fieldset>;
}
