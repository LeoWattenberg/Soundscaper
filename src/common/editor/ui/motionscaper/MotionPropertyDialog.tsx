/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import MotionPropertyGraph from './MotionPropertyGraph.tsx';
import { motionLayerProperties } from '../../motion-project-graph.ts';
import { copyMotionKeyframes, type MotionKeyframeClipboard } from '../../motion-keyframe-edit.ts';
import { addRationals, compareRationals, multiplyRationals, subtractRationals, type Rational } from '../../timeline-time.ts';
import type { InterpolationShape } from '../../interpolation-curve.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperPropertyCommands, type MotionscaperPropertyEdit } from '../../../../motionscaper/editor-property-commands.ts';
import { formatMotionExactInput as format, parseMotionExactInput as exact, parseMotionNumberInput as number } from './motion-exact-input.ts';
import { motionPropertyChannel, motionPropertyChannelValue, motionPropertyLabel, type MotionNumericProperty } from './motion-property-ui.ts';

export default function MotionPropertyDialog({ copy, project, busy, canUndo, canRedo, clipboard, onCopyKeys, onEdit, onUndo, onRedo, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; busy: boolean; canUndo: boolean; canRedo: boolean;
	clipboard: MotionKeyframeClipboard | null; onCopyKeys: (clipboard: MotionKeyframeClipboard) => void;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>; onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void;
}>) {
	const id = useId(); const [compositionId, setCompositionId] = useState(project.primaryCompositionId); const [layerId, setLayerId] = useState('');
	const [path, setPath] = useState('transform.position'); const [channel, setChannel] = useState(0); const [selected, setSelected] = useState<readonly Rational[]>([]);
	const [at, setAt] = useState('0'); const [value, setValue] = useState('0'); const [delta, setDelta] = useState('1'); const [shape, setShape] = useState<InterpolationShape['kind']>('linear');
	const [handles, setHandles] = useState<readonly string[]>(['', '', '', '']); const [error, setError] = useState<string | null>(null); const [working, setWorking] = useState(false);
	const composition = project.compositions.find((entry) => entry.id === compositionId) ?? project.compositions[0]!;
	const layer = composition.layers.find((entry) => entry.id === layerId) ?? composition.layers[0];
	const properties = layer ? motionLayerProperties(layer).filter((entry): entry is typeof entry & { readonly property: MotionNumericProperty } => entry.property.kind !== 'path') : [];
	const current = properties.find((entry) => entry.path === path) ?? properties[0]; const property = current?.property;
	const count = property?.kind === 'scalar' ? 1 : property?.value.length ?? 1; const activeChannel = Math.min(channel, count - 1);
	const channelLabels = property?.kind === 'color' ? ['r', 'g', 'b', 'a'] : count === 1 ? ['value'] : ['x', 'y', 'z'];
	const content = property ? motionPropertyChannel(property, activeChannel) : null; const curve = content?.curve;
	const chosen = selected.filter((position) => curve?.anchors.some((anchor) => compareRationals(anchor.position, position) === 0));
	const from = chosen.length === 1 ? curve?.anchors.findIndex((anchor) => compareRationals(anchor.position, chosen[0]!) === 0) ?? -1 : -1;
	const begin = from >= 0 ? curve?.anchors[from] : undefined; const end = from >= 0 ? curve?.anchors[from + 1] : undefined;
	const segment = from >= 0 ? curve?.segments[from] : undefined;
	const disabled = busy || working;
	const reset = () => { setSelected([]); setHandles(['', '', '', '']); setError(null); };
	const run = async (operation: () => Promise<void>) => { setError(null); setWorking(true); try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!); } finally { setWorking(false); } };
	const edit = (create: () => MotionscaperPropertyEdit) => {
		if (!layer || !current) return;
		void run(async () => { await onEdit(createMotionscaperPropertyCommands({ project, compositionId: composition.id, layerId: layer.id, propertyPath: current.path, edit: create() })); });
	};
	const handleDefault = (index: number): string => {
		if (!begin || !end) return '0';
		const point = segment?.kind === 'bezier' ? index < 2 ? segment.control1 : segment.control2 : null;
		if (index % 2 === 0) return format(point?.position ?? addRationals(begin.position, multiplyRationals(subtractRationals(end.position, begin.position), { num: index < 2 ? 1 : 2, den: 3 })));
		return String(point?.value ?? begin.value + (end.value - begin.value) * (index < 2 ? 1 : 2) / 3);
	};
	return <AudioEditorDialogShell title={copy.motionscaperProperties} onClose={disabled ? undefined : onClose} width={900} initialFocus="[data-motion-property]" bodyClassName="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body motionscaper-property-body"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperPropertySelection}</legend>
			<label htmlFor={`${id}-composition`}>{copy.motionscaperComposition}</label><select id={`${id}-composition`} value={composition.id} onChange={(event) => { setCompositionId(event.currentTarget.value); setLayerId(''); reset(); }}>
				{project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
			</select>
			<label htmlFor={`${id}-layer`}>{copy.motionscaperLayerMenu}</label><select id={`${id}-layer`} value={layer?.id ?? ''} onChange={(event) => { setLayerId(event.currentTarget.value); reset(); }}>
				{composition.layers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
			</select>
			<label htmlFor={`${id}-property`}>{copy.motionscaperProperty}</label><select id={`${id}-property`} data-motion-property value={current?.path ?? ''} onChange={(event) => { setPath(event.currentTarget.value); setChannel(0); reset(); }}>
				{properties.map((entry) => <option key={entry.path} value={entry.path}>{motionPropertyLabel(entry.path, copy, layer)}</option>)}
			</select>
			<label htmlFor={`${id}-channel`}>{copy.motionscaperChannel}</label><select id={`${id}-channel`} value={activeChannel} onChange={(event) => { setChannel(Number(event.currentTarget.value)); reset(); }}>
				{Array.from({ length: count }, (_, index) => <option key={index} value={index}>{copy[`motionscaperChannel_${channelLabels[index]}`]}</option>)}
			</select>
			<Button variant="secondary" disabled={!canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button>
			<Button variant="secondary" disabled={!canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
		</fieldset>
		{property && <>
			<MotionPropertyGraph key={`${composition.id}/${layer?.id}/${current?.path}/${activeChannel}`} copy={copy} property={property} channel={activeChannel} duration={composition.durationFrames} frameRate={composition.frameRate} selected={chosen} disabled={disabled} onSelect={setSelected} onCommit={(create) => edit(() => ({ type: 'replace-property', property: create() }))} />
			<p>{copy.motionscaperKeyframeHint}</p>
			<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperKeyframes}</legend>
				<label>{copy.motionscaperKeyFrame}<input value={at} onChange={(event) => setAt(event.currentTarget.value)} /></label>
				<label>{copy.motionscaperKeyValue}<input value={value} onChange={(event) => setValue(event.currentTarget.value)} /></label>
				<Button variant="secondary" onClick={() => { setSelected([]); edit(() => ({ type: 'set-key', position: exact(at), value: motionPropertyChannelValue(property, activeChannel, number(value)), channels: [activeChannel] })); }}>{copy.motionscaperSetKey}</Button>
				<Button variant="secondary" onClick={() => edit(() => ({ type: 'set-base', value: motionPropertyChannelValue(property, activeChannel, number(value)) }))}>{copy.motionscaperSetBase}</Button>
				<label>{copy.motionscaperMoveFrames}<input value={delta} onChange={(event) => setDelta(event.currentTarget.value)} /></label>
				<Button variant="secondary" disabled={chosen.length === 0} onClick={() => edit(() => ({ type: 'move-keys', positions: chosen, deltaFrames: exact(delta), channels: [activeChannel] }))}>{copy.motionscaperMove}</Button>
				<Button variant="secondary" disabled={chosen.length === 0} onClick={() => edit(() => ({ type: 'delete-keys', positions: chosen, channels: [activeChannel] }))}>{copy.motionscaperDeleteKeys}</Button>
				<Button variant="secondary" disabled={chosen.length === 0} onClick={() => { void run(() => { onCopyKeys(copyMotionKeyframes(property, chosen, composition.frameRate, [activeChannel])); return Promise.resolve(); }); }}>{copy.motionscaperCopyKeys}</Button>
				<Button variant="secondary" disabled={!clipboard} onClick={() => { setSelected([]); edit(() => ({ type: 'paste-keys', clipboard: clipboard!, atFrame: exact(at), mode: 'merge' })); }}>{copy.motionscaperPasteKeys}</Button>
			</fieldset>
			<ul className="motionscaper-keyframe-list">{curve?.anchors.map((anchor, index) => <li key={`${anchor.position.num}/${anchor.position.den}`} data-motion-keyframe-row data-motion-interpolation={curve.segments[index]?.kind ?? 'none'}>
				<label><input type="checkbox" checked={chosen.some((position) => compareRationals(position, anchor.position) === 0)} disabled={disabled} onChange={(event) => {
					setSelected(event.currentTarget.checked ? [...chosen, anchor.position] : chosen.filter((position) => compareRationals(position, anchor.position) !== 0)); setHandles(['', '', '', '']);
				}} />{copy.motionscaperKeyframe} {format(anchor.position)}</label>
				<span>{anchor.value}</span><span>{copy[`motionscaperInterpolation_${curve.segments[index]?.kind ?? 'none'}`]}</span>
			</li>)}</ul>
			<fieldset disabled={disabled || !begin || !end} className="motionscaper-timeline-actions"><legend>{copy.motionscaperInterpolation}</legend>
				<label htmlFor={`${id}-interpolation`}>{copy.motionscaperInterpolation}</label><select id={`${id}-interpolation`} value={shape} onChange={(event) => setShape(event.currentTarget.value as InterpolationShape['kind'])}>
					{(['hold', 'linear', 'eased', 'bezier'] as const).map((kind) => <option key={kind} value={kind}>{copy[`motionscaperInterpolation_${kind}`]}</option>)}
				</select>
				{shape === 'bezier' && [0, 1, 2, 3].map((index) => <label key={index}>{copy[`motionscaperBezier_${index}`]}<input value={handles[index] || handleDefault(index)} onChange={(event) => setHandles(handles.map((entry, offset) => offset === index ? event.currentTarget.value : entry))} /></label>)}
				<Button variant="secondary" onClick={() => edit(() => ({ type: 'interpolation', fromPosition: begin!.position, channels: [activeChannel], shape: shape === 'bezier'
					? { kind: shape, control1: { position: exact(handles[0] || handleDefault(0)), value: number(handles[1] || handleDefault(1)) }, control2: { position: exact(handles[2] || handleDefault(2)), value: number(handles[3] || handleDefault(3)) } } : { kind: shape } }))}>{copy.motionscaperApplyInterpolation}</Button>
			</fieldset>
		</>}
		{!property && <p>{copy.motionscaperNoLayers}</p>}
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
