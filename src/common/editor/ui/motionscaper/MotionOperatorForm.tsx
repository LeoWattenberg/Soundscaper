/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionLayer } from '../../motion-composition.ts';
import type { MotionShapeOperator, MotionTextAnimator } from '../../motion-authoring-operators.ts';
import { motionLayerProperties } from '../../motion-project-graph.ts';
import { replaceMotionLayerProperty } from '../../motion-layer-links.ts';
import { motionColor, normalizeMotionProperty } from '../../motion-property.ts';
import { parseMotionNumberInput } from './motion-exact-input.ts';

export default function MotionOperatorForm({ copy, layer, index, disabled, onSubmit, onError }: Readonly<{
	copy: Readonly<Record<string, string>>; layer: Extract<MotionLayer, { kind: 'shapes' | 'text' }>; index: number; disabled: boolean;
	onSubmit: (value: MotionShapeOperator | MotionTextAnimator) => void; onError: (error: unknown) => void;
}>) {
	const operator = layer.kind === 'shapes' ? layer.operators![index]! : layer.document.animators![index]!;
	const [enabled, setEnabled] = useState(operator.enabled); const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
	const [mode, setMode] = useState('mode' in operator ? operator.mode : '');
	const [unit, setUnit] = useState('selector' in operator ? operator.selector.unit : 'cluster');
	const [shape, setShape] = useState('selector' in operator ? operator.selector.shape : 'square');
	const [color, setColor] = useState('color' in operator && operator.color !== null);
	const prefix = layer.kind === 'shapes' ? `operators.${index}.` : `document.animators.${index}.`;
	const source = layer.kind === 'text' && 'color' in operator ? { ...layer, document: { ...layer.document, animators: layer.document.animators!.map((entry, offset) => offset === index ? { ...entry, color: color ? entry.color ?? motionColor([1, 1, 1, 1]) : null } : entry) } } : layer;
	const properties = motionLayerProperties(source).filter(({ path, property }) => path.startsWith(prefix) && property.kind !== 'path');
	const rows = properties.flatMap(({ path, property }) => {
		if (property.kind === 'path') return [];
		const values = property.kind === 'scalar' ? [property.value] : property.value;
		const relative = path.slice(prefix.length).replaceAll('.', '_');
		const label = copy[`motionscaperOperatorField_${relative}`] ?? copy[`motionscaperProperty_${relative}`] ?? relative;
		return values.map((value, channel) => ({ id: `${path}:${channel}`, label: values.length === 1 ? label : `${label} ${copy[`motionscaperChannel_${property.kind === 'color' ? ['r', 'g', 'b', 'a'][channel] : ['x', 'y', 'z'][channel]}`]}`, value }));
	});
	const submit = () => {
		try {
			let next: MotionLayer = source;
			for (const { path, property } of properties) {
				if (property.kind === 'path') continue;
				const values = property.kind === 'scalar' ? [property.value] : property.value;
				const changed = values.map((value, channel) => fields[`${path}:${channel}`] === undefined ? value : parseMotionNumberInput(fields[`${path}:${channel}`]!));
				next = replaceMotionLayerProperty(next, path, normalizeMotionProperty({ ...property, value: property.kind === 'scalar' ? changed[0] : changed }));
			}
			if (next.kind === 'shapes') {
				const value = next.operators![index]!;
				onSubmit({ ...value, enabled, ...('mode' in value ? { mode } : {}) } as MotionShapeOperator);
			} else if (next.kind === 'text') {
				const value = next.document.animators![index]!; onSubmit({ ...value, enabled, selector: { ...value.selector, unit, shape } });
			}
		} catch (error) { onError(error); }
	};
	const modes = 'kind' in operator && operator.kind === 'boolean' ? ['union', 'subtract', 'intersect', 'xor'] : ['individual', 'simultaneous'];
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{layer.kind === 'shapes' ? copy.motionscaperOperatorSettings : copy.motionscaperAnimatorSettings}</legend>
		<label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />{copy.motionscaperOperatorEnabled}</label>
		{'mode' in operator && <label>{operator.kind === 'boolean' ? copy.motionscaperBooleanMode : copy.motionscaperTrimMode}<select value={mode} onChange={(event) => setMode(event.currentTarget.value)}>
			{modes.map((entry) => <option key={entry} value={entry}>{copy[`motionscaperOperatorMode_${entry}`]}</option>)}
		</select></label>}
		{'selector' in operator && <>
			<label>{copy.motionscaperSelectorUnit}<select value={unit} onChange={(event) => setUnit(event.currentTarget.value as typeof unit)}>{(['cluster', 'word', 'line'] as const).map((entry) => <option key={entry} value={entry}>{copy[`motionscaperSelectorUnit_${entry}`]}</option>)}</select></label>
			<label>{copy.motionscaperSelectorShape}<select value={shape} onChange={(event) => setShape(event.currentTarget.value as typeof shape)}>{(['square', 'ramp-up', 'ramp-down', 'triangle', 'round', 'smooth'] as const).map((entry) => <option key={entry} value={entry}>{copy[`motionscaperSelectorShape_${entry}`]}</option>)}</select></label>
			<label><input type="checkbox" checked={color} onChange={(event) => setColor(event.currentTarget.checked)} />{copy.motionscaperAnimatorColor}</label>
		</>}
		{rows.map((row) => <label key={row.id}>{row.label}<input value={fields[row.id] ?? String(row.value)} onChange={(event) => setFields({ ...fields, [row.id]: event.currentTarget.value })} /></label>)}
		<p>{copy.motionscaperOperatorValuesHint}</p>
		<Button variant="secondary" onClick={submit}>{layer.kind === 'shapes' ? copy.motionscaperApplyOperator : copy.motionscaperApplyAnimator}</Button>
	</fieldset>;
}
