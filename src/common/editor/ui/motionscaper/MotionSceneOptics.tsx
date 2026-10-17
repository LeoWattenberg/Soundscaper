/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { MotionAppearanceColor, MotionAppearanceNumber, type MotionAppearanceCopy } from './MotionAppearanceFields.tsx';
import { MotionSceneCheckbox, type MotionSceneFormProps } from './MotionSceneFields.tsx';
import { parseMotionNumberInput } from './motion-exact-input.ts';
export function MotionSceneCamera({ copy, layer, disabled, onEdit, onError }: MotionSceneFormProps) {
	if (layer.kind !== 'camera') throw new TypeError('Camera form requires a camera.');
	const [projection, setProjection] = useState(layer.projection); const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
	const values = { zoom: layer.zoom.value, near: layer.near, far: layer.far, focusDistance: layer.focusDistance.value, aperture: layer.aperture.value };
	const kinds = ['zoom', 'near', 'far', 'focusDistance', 'aperture'] as const;
	const value = (key: typeof kinds[number]) => fields[key] ?? String(values[key]);
	const number = (key: typeof kinds[number]) => parseMotionNumberInput(value(key));
	const submit = () => { try { onEdit({ type: 'camera', projection, zoom: number('zoom'), near: number('near'), far: number('far'), focusDistance: number('focusDistance'), aperture: number('aperture') }); } catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperSceneCamera}</legend>
		<label>{copy.motionscaperSceneProjection}<select value={projection} onChange={event => setProjection(event.currentTarget.value as typeof projection)}>{(['perspective', 'orthographic'] as const).map(value => <option key={value} value={value}>{copy[`motionscaperSceneProjection_${value}`]}</option>)}</select></label>
		{kinds.map(key => <MotionAppearanceNumber key={key} label={copy[`motionscaperScene${key[0].toUpperCase()}${key.slice(1)}`]} value={value(key)} min={0} onChange={value => setFields({ ...fields, [key]: value })} />)}
		<Button variant="secondary" onClick={submit}>{copy.motionscaperSceneApplyCamera}</Button>
	</fieldset>;
}
export function MotionSceneLightType({ copy, value, onChange }: Readonly<{ copy: MotionAppearanceCopy; value: 'ambient' | 'point' | 'spot'; onChange: (value: 'ambient' | 'point' | 'spot') => void }>) {
	return <label>{copy.motionscaperSceneLightType}<select value={value} onChange={event => onChange(event.currentTarget.value as typeof value)}>{(['ambient', 'point', 'spot'] as const).map(value => <option key={value} value={value}>{copy[`motionscaperSceneLight_${value}`]}</option>)}</select></label>;
}
export function MotionSceneLight({ copy, layer, disabled, onEdit, onError }: MotionSceneFormProps) {
	if (layer.kind !== 'light') throw new TypeError('Light form requires a light.');
	const [lightType, setType] = useState(layer.lightType), [color, setColor] = useState(layer.color.value), [castsShadows, setShadows] = useState(layer.castsShadows);
	const [fields, setFields] = useState<Readonly<Record<string, string>>>({}); const kinds = ['intensity', 'coneAngle', 'coneFeather'] as const;
	const value = (key: typeof kinds[number]) => fields[key] ?? String(layer[key].value); const number = (key: typeof kinds[number]) => parseMotionNumberInput(value(key));
	const submit = () => { try { onEdit({ type: 'light', lightType, color, castsShadows, intensity: number('intensity'), coneAngle: number('coneAngle'), coneFeather: number('coneFeather') }); } catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperSceneLight}</legend>
		<MotionSceneLightType copy={copy} value={lightType} onChange={setType} /><MotionAppearanceColor copy={copy} value={color} onChange={setColor} /><MotionSceneCheckbox label={copy.motionscaperSceneCastsShadows} value={castsShadows} onChange={setShadows} />
		{kinds.map(key => <MotionAppearanceNumber key={key} label={copy[`motionscaperScene${key[0].toUpperCase()}${key.slice(1)}`]} value={value(key)} min={0} max={key === 'intensity' ? 64 : key === 'coneAngle' ? 180 : 1} onChange={value => setFields({ ...fields, [key]: value })} />)}
		<Button variant="secondary" onClick={submit}>{copy.motionscaperSceneApplyLight}</Button>
	</fieldset>;
}
