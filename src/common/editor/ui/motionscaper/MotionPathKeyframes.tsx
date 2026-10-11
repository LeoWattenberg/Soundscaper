/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { copyMotionKeyframes, editMotionKeyframes, pasteMotionKeyframes, type MotionKeyframeClipboard, type MotionKeyframeEdit } from '../../motion-keyframe-edit.ts';
import { motionPropertyOfKind, type MotionPathProperty } from '../../motion-property.ts';
import type { InterpolationShape } from '../../interpolation-curve.ts';
import { addRationals, compareRationals, multiplyRationals, subtractRationals, type Rational } from '../../timeline-time.ts';
import { formatMotionExactInput as format, parseMotionExactInput as exact, parseMotionNumberInput as number } from './motion-exact-input.ts';

export default function MotionPathKeyframes({ copy, property, frameRate, position, disabled, clipboard, onCopy, onEdit, onError }: Readonly<{
	copy: Readonly<Record<string, string>>; property: MotionPathProperty; frameRate: Rational; position: Rational | null; disabled: boolean;
	clipboard: MotionKeyframeClipboard | null; onCopy: (value: MotionKeyframeClipboard) => void; onEdit: (create: () => MotionPathProperty) => void; onError: (error: unknown) => void;
}>) {
	const [selected, setSelected] = useState<readonly Rational[]>([]), [delta, setDelta] = useState('1');
	const [shape, setShape] = useState<InterpolationShape['kind']>('linear'), [handles, setHandles] = useState<readonly string[]>(['', '', '', '']);
	const chosen = selected.filter((position) => property.keyframes.some((key) => compareRationals(key.position, position) === 0));
	const index = chosen.length === 1 ? property.keyframes.findIndex((key) => compareRationals(key.position, chosen[0]!) === 0) : -1;
	const first = property.keyframes[index], last = property.keyframes[index + 1], segment = property.segments[index];
	const rows = property.keyframes.map((key, offset) => ({ key, kind: typeof property.segments[offset] === 'object' ? 'bezier' : property.segments[offset] ?? 'none' }));
	const edit = (create: () => MotionKeyframeEdit) => onEdit(() => motionPropertyOfKind(editMotionKeyframes(property, create()), 'path'));
	const handleDefault = (index: number): string => {
		if (!first || !last) return '0';
		const control = typeof segment === 'object' ? index < 2 ? segment.control1 : segment.control2 : null;
		if (index % 2 === 0) return format(control?.position ?? addRationals(first.position, multiplyRationals(subtractRationals(last.position, first.position), { num: index < 2 ? 1 : 2, den: 3 })));
		return String(control?.value ?? (index < 2 ? 1 : 2) / 3);
	};
	return <>
		<ul className="motionscaper-keyframe-list">{rows.map(({ key, kind }) => <li key={format(key.position)} data-motion-path-keyframe data-motion-interpolation={kind}>
			<label><input type="checkbox" disabled={disabled} checked={chosen.some((position) => compareRationals(position, key.position) === 0)} onChange={(event) => {
				setSelected(event.currentTarget.checked ? [...chosen, key.position] : chosen.filter((position) => compareRationals(position, key.position) !== 0)); setHandles(['', '', '', '']);
			}} />{copy.motionscaperKeyframe} {format(key.position)}</label>
			<span>{copy[`motionscaperInterpolation_${kind}`]}</span>
		</li>)}</ul>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperKeyframes}</legend>
			<label>{copy.motionscaperMoveFrames}<input value={delta} onChange={(event) => setDelta(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={chosen.length === 0} onClick={() => edit(() => ({ type: 'move-keys', positions: chosen, deltaFrames: exact(delta) }))}>{copy.motionscaperMove}</Button>
			<Button variant="secondary" disabled={chosen.length === 0} onClick={() => edit(() => ({ type: 'delete-keys', positions: chosen }))}>{copy.motionscaperDeleteKeys}</Button>
			<Button variant="secondary" disabled={chosen.length === 0} onClick={() => { try { onCopy(copyMotionKeyframes(property, chosen, frameRate)); } catch (error) { onError(error); } }}>{copy.motionscaperCopyKeys}</Button>
			<Button variant="secondary" disabled={!clipboard || !position} onClick={() => { setSelected([]); onEdit(() => motionPropertyOfKind(pasteMotionKeyframes(property, clipboard!, { atFrame: position!, frameRate, mode: 'merge' }), 'path')); }}>{copy.motionscaperPasteKeys}</Button>
		</fieldset>
		<fieldset disabled={disabled || !first || !last} className="motionscaper-timeline-actions"><legend>{copy.motionscaperInterpolation}</legend>
			<label>{copy.motionscaperInterpolation}<select value={shape} onChange={(event) => setShape(event.currentTarget.value as InterpolationShape['kind'])}>{(['hold', 'linear', 'eased', 'bezier'] as const).map((kind) => <option key={kind} value={kind}>{copy[`motionscaperInterpolation_${kind}`]}</option>)}</select></label>
			{shape === 'bezier' && [0, 1, 2, 3].map((index) => <label key={index}>{copy[`motionscaperBezier_${index}`]}<input value={handles[index] || handleDefault(index)} onChange={(event) => setHandles(handles.map((entry, offset) => index === offset ? event.currentTarget.value : entry))} /></label>)}
			<Button variant="secondary" onClick={() => edit(() => ({ type: 'interpolation', fromPosition: first!.position, shape: shape === 'bezier'
				? { kind: shape, control1: { position: exact(handles[0] || handleDefault(0)), value: number(handles[1] || handleDefault(1)) }, control2: { position: exact(handles[2] || handleDefault(2)), value: number(handles[3] || handleDefault(3)) } } : { kind: shape } }))}>{copy.motionscaperApplyInterpolation}</Button>
		</fieldset>
	</>;
}
