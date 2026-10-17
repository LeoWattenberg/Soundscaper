/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionLayer } from '../../motion-composition.ts';
import type { MotionVector3 } from '../../motion-property.ts';
import type { MotionscaperSceneEdit } from '../../../../motionscaper/editor-scene-commands.ts';
import { MotionAppearanceNumber, type MotionAppearanceCopy } from './MotionAppearanceFields.tsx';
import { parseMotionNumberInput } from './motion-exact-input.ts';
export type MotionSceneFormProps = Readonly<{ copy: MotionAppearanceCopy; layer: MotionLayer; disabled: boolean; onEdit: (edit: MotionscaperSceneEdit) => void; onError: (error: unknown) => void }>;
export function MotionSceneCheckbox({ label, value, onChange, disabled }: Readonly<{ label: string | undefined; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }>) {
	return <label><input type="checkbox" checked={value} disabled={disabled} onChange={event => onChange(event.currentTarget.checked)} />{label}</label>;
}
export function MotionSceneTransform({ copy, layer, disabled, onEdit, onError }: MotionSceneFormProps) {
	const [is3D, setIs3D] = useState(layer.is3D); const [fields, setFields] = useState<Readonly<Record<string, string>>>({}); const kinds = ['anchor', 'position', 'scale', 'rotation'] as const;
	const value = (kind: typeof kinds[number], axis: number) => fields[`${kind}${axis}`] ?? String(layer.transform[kind].value[axis]);
	const vector = (kind: typeof kinds[number]): MotionVector3 => [0, 1, 2].map(axis => parseMotionNumberInput(value(kind, axis))) as unknown as MotionVector3;
	const submit = () => { try { onEdit({ type: 'transform', is3D, anchor: vector('anchor'), position: vector('position'), scale: vector('scale'), rotation: vector('rotation') }); } catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperSceneTransform}</legend>
		<MotionSceneCheckbox label={copy.motionscaperSceneIs3D} value={is3D} onChange={setIs3D} disabled={['camera', 'light', 'adjustment'].includes(layer.kind)} />
		{kinds.map(kind => ['X', 'Y', 'Z'].map((axis, index) => <MotionAppearanceNumber key={`${kind}${axis}`} label={copy[`motionscaperScene${kind[0].toUpperCase()}${kind.slice(1)}${axis}`]} value={value(kind, index)} onChange={value => setFields({ ...fields, [`${kind}${index}`]: value })} />))}
		<Button variant="secondary" onClick={submit}>{copy.motionscaperSceneApplyTransform}</Button>
	</fieldset>;
}
export function MotionSceneMaterial({ copy, layer, disabled, onEdit, onError }: MotionSceneFormProps) {
	const material = layer.material; const [acceptsLights, setLights] = useState(material.acceptsLights), [castsShadows, setCasts] = useState(material.castsShadows), [receivesShadows, setReceives] = useState(material.receivesShadows);
	const [fields, setFields] = useState<Readonly<Record<string, string>>>({}); const kinds = ['ambient', 'diffuse', 'specular', 'shininess'] as const;
	const value = (key: typeof kinds[number]) => fields[key] ?? String(material[key].value);
	const submit = () => { try { onEdit({ type: 'material', acceptsLights, castsShadows, receivesShadows, ambient: parseMotionNumberInput(value('ambient')), diffuse: parseMotionNumberInput(value('diffuse')), specular: parseMotionNumberInput(value('specular')), shininess: parseMotionNumberInput(value('shininess')) }); } catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperSceneMaterial}</legend>
		<MotionSceneCheckbox label={copy.motionscaperSceneAcceptsLights} value={acceptsLights} onChange={setLights} /><MotionSceneCheckbox label={copy.motionscaperSceneCastsShadows} value={castsShadows} onChange={setCasts} /><MotionSceneCheckbox label={copy.motionscaperSceneReceivesShadows} value={receivesShadows} onChange={setReceives} />
		{kinds.map(key => <MotionAppearanceNumber key={key} label={copy[`motionscaperScene${key[0].toUpperCase()}${key.slice(1)}`]} value={value(key)} min={0} max={key === 'shininess' ? 1024 : 1} onChange={value => setFields({ ...fields, [key]: value })} />)}
		<Button variant="secondary" onClick={submit}>{copy.motionscaperSceneApplyMaterial}</Button>
	</fieldset>;
}
