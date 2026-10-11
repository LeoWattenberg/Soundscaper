/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperPropertyCommands } from '../../../../motionscaper/editor-property-commands.ts';
import { motionLayerProperties } from '../../motion-project-graph.ts';
import { editMotionPath } from '../../motion-path-edit.ts';
import { enableMotionSpatialBezier, setMotionSpatialHandle, setMotionSpatialKey } from '../../motion-spatial-edit.ts';
import { editMotionKeyframes, type MotionKeyframeClipboard } from '../../motion-keyframe-edit.ts';
import { motionPropertyOfKind, type MotionVector2 } from '../../motion-property.ts';
import { compileMotionProperty } from '../../motion-property-evaluation.ts';
import type { Rational } from '../../timeline-time.ts';
import { motionPlaneGeometry, type MotionPlaneProperty } from './motion-plane-geometry.ts';
import { motionPropertyLabel } from './motion-property-ui.ts';
import { parseMotionExactInput as exact, parseMotionNumberInput as number } from './motion-exact-input.ts';
import MotionPlaneEditor from './MotionPlaneEditor.tsx';
import MotionPathKeyframes from './MotionPathKeyframes.tsx';

export default function MotionPathsDialog({ copy, project, busy, canUndo, canRedo, onEdit, onUndo, onRedo, onClose, clipboard, onCopyKeys }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; busy: boolean; canUndo: boolean; canRedo: boolean;
	clipboard: MotionKeyframeClipboard | null; onCopyKeys: (value: MotionKeyframeClipboard) => void;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>; onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void;
}>) {
	const [compositionId, setComposition] = useState(project.primaryCompositionId), [layerId, setLayer] = useState(''), [path, setPath] = useState('transform.position');
	const [frame, setFrame] = useState('0'), [target, setTarget] = useState<'base' | 'key'>('base'), [selected, setSelected] = useState('');
	const [x, setX] = useState('0'), [y, setY] = useState('0'), [draft, setDraft] = useState<MotionPlaneProperty | null>(null);
	const [pointDraft, setPointDraft] = useState<{ key: string; x: string; y: string } | null>(null), [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null);
	const composition = project.compositions.find((entry) => entry.id === compositionId) ?? project.compositions[0]!;
	const layer = composition.layers.find((entry) => entry.id === layerId) ?? composition.layers[0];
	const properties = layer ? motionLayerProperties(layer).filter((entry): entry is typeof entry & { readonly property: MotionPlaneProperty } => entry.property.kind === 'path' || (entry.path === 'transform.position' && (entry.property.kind === 'vector2' || entry.property.kind === 'vector3'))) : [];
	const current = properties.find((entry) => entry.path === path) ?? properties[0], property = current?.property;
	const position = useMemo((): Rational | null => { try { const value = exact(frame); return value.num < 0 ? null : value; } catch { return null; } }, [frame]);
	const options = useMemo(() => ({ duration: composition.durationFrames, position: target === 'key' ? position ?? { num: 0, den: 1 } : null, selected, copy }), [composition.durationFrames, target, position, selected, copy]);
	const geometry = useMemo(() => property ? motionPlaneGeometry(property, options) : { path: '', points: [] }, [property, options]);
	const display = useMemo(() => draft ? motionPlaneGeometry(draft, options) : geometry, [draft, options, geometry]);
	const extent = useMemo(() => property ? motionPlaneGeometry(property, { ...options, allHandles: true }) : geometry, [property, options, geometry]);
	const bounds = useMemo((): readonly [number, number, number, number] => {
		const xs = extent.points.map((point) => point.point[0]), ys = extent.points.map((point) => point.point[1]);
		const minX = Math.min(0, ...xs), maxX = Math.max(composition.width, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(composition.height, ...ys);
		const centerX = minX / 2 + maxX / 2, centerY = minY / 2 + maxY / 2;
		const width = Math.max(maxX - minX, (maxY - minY) * 664 / 304) * 1.1, height = width * 304 / 664;
		return [centerX - width / 2, centerY - height / 2, centerX + width / 2, centerY + height / 2];
	}, [extent, composition.width, composition.height]);
	const active = geometry.points.find((point) => point.id === selected) ?? geometry.points.find((point) => point.kind === 'anchor');
	const draftKey = `${project.revision}/${composition.id}/${layer?.id}/${current?.path}/${frame}/${target}/${active?.id}`;
	const coordinates = pointDraft?.key === draftKey ? pointDraft : { x: String(active?.point[0] ?? 0), y: String(active?.point[1] ?? 0) };
	const disabled = busy || working;
	const reset = () => { setSelected(''); setDraft(null); setPointDraft(null); setError(null); };
	const run = async (operation: () => Promise<void>) => { setWorking(true); setError(null); try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!); } finally { setWorking(false); } };
	const commit = (create: () => MotionPlaneProperty) => {
		if (!layer || !current) return;
		void run(async () => { await onEdit(createMotionscaperPropertyCommands({ project, compositionId: composition.id, layerId: layer.id, propertyPath: current.path, edit: { type: 'replace-property', property: create() } })); setPointDraft(null); });
	};
	const change = (id: string, value: MotionVector2): MotionPlaneProperty => {
		const point = geometry.points.find((entry) => entry.id === id); if (!point || !property) throw new Error(copy.motionscaperNoLayers);
		if (property.kind !== 'path') {
			if (point.action.type === 'base') return motionPropertyOfKind(editMotionKeyframes(property, { type: 'set-base', value: property.kind === 'vector2' ? value : [value[0], value[1], property.value[2]] }), property.kind);
			if (point.action.type === 'key') return setMotionSpatialKey(property, point.action.position, value);
			if (point.action.type === 'handle') return setMotionSpatialHandle(property, point.action.position, point.action.handle, value);
		} else if (point.action.type === 'vertex') {
			if (target === 'key' && !position) throw new RangeError(copy.motionscaperLocalFrameInvalid);
			const relative: MotionVector2 = point.connector ? [value[0] - point.connector[0], value[1] - point.connector[1]] : value;
			return editMotionPath(property, { ...point.action, value: relative, ...(target === 'key' ? { position: position! } : {}) });
		}
		throw new TypeError(copy.motionscaperEditFailed);
	};
	return <AudioEditorDialogShell title={copy.motionscaperPaths} width={900} onClose={disabled ? undefined : onClose} initialFocus="[data-motion-path-property]" bodyClassName="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body motionscaper-property-body"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperPropertySelection}</legend>
			<label>{copy.motionscaperComposition}<select value={composition.id} onChange={(event) => { setComposition(event.currentTarget.value); setLayer(''); reset(); }}>{project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
			<label>{copy.motionscaperLayerMenu}<select value={layer?.id ?? ''} onChange={(event) => { setLayer(event.currentTarget.value); reset(); }}>{composition.layers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
			<label>{copy.motionscaperProperty}<select data-motion-path-property value={current?.path ?? ''} onChange={(event) => { setPath(event.currentTarget.value); reset(); }}>{properties.map((entry) => <option key={entry.path} value={entry.path}>{motionPropertyLabel(entry.path, copy)}</option>)}</select></label>
			<Button variant="secondary" disabled={!canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button><Button variant="secondary" disabled={!canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
		</fieldset>
		<p>{copy.motionscaperPathHint}</p>
		{property ? <>
			<MotionPlaneEditor copy={copy} geometry={display} bounds={bounds} selected={active?.id ?? ''} disabled={disabled} onSelect={(id) => { setSelected(id); setPointDraft(null); }}
				onPreview={(id, point) => { try { setDraft(id && point ? change(id, point) : null); } catch { setDraft(null); } }} onCommit={(id, point) => commit(() => change(id, point))} />
			<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperPathPoint}</legend>
				<label>{copy.motionscaperPathPoint}<select value={active?.id ?? ''} onChange={(event) => { setSelected(event.currentTarget.value); setPointDraft(null); }}>{geometry.points.map((point) => <option key={point.id} value={point.id}>{point.label}</option>)}</select></label>
				<label>{copy.motionscaperPointX}<input value={coordinates.x} onChange={(event) => setPointDraft({ key: draftKey, ...coordinates, x: event.currentTarget.value })} /></label>
				<label>{copy.motionscaperPointY}<input value={coordinates.y} onChange={(event) => setPointDraft({ key: draftKey, ...coordinates, y: event.currentTarget.value })} /></label>
				<Button variant="secondary" disabled={!active} onClick={() => commit(() => change(active!.id, [number(coordinates.x), number(coordinates.y)]))}>{copy.motionscaperApplyPoint}</Button>
			</fieldset>
			<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperKeyframes}</legend>
				<label>{copy.motionscaperLocalFrame}<input value={frame} onChange={(event) => { setFrame(event.currentTarget.value); setDraft(null); }} /></label>
				{property.kind !== 'path' ? <>
					<label>{copy.motionscaperPositionX}<input value={x} onChange={(event) => setX(event.currentTarget.value)} /></label><label>{copy.motionscaperPositionY}<input value={y} onChange={(event) => setY(event.currentTarget.value)} /></label>
					<Button variant="secondary" disabled={!position} onClick={() => commit(() => setMotionSpatialKey(property, position!, [number(x), number(y)]))}>{copy.motionscaperSetPositionKey}</Button>
					<Button variant="secondary" disabled={!active || (active.action.type !== 'key' && active.action.type !== 'handle')} onClick={() => commit(() => enableMotionSpatialBezier(property, active!.action.type === 'key' || active!.action.type === 'handle' ? active!.action.position : position!))}>{copy.motionscaperSpatialBezier}</Button>
				</> : <>
					<label>{copy.motionscaperPathTarget}<select value={target} onChange={(event) => { setTarget(event.currentTarget.value as 'base' | 'key'); setDraft(null); }}><option value="base">{copy.motionscaperPathBase}</option><option value="key">{copy.motionscaperPathKey}</option></select></label>
					<Button variant="secondary" disabled={!position} onClick={() => commit(() => motionPropertyOfKind(editMotionKeyframes(property, { type: 'set-key', position: position!, value: compileMotionProperty(property)(position!) }), 'path'))}>{copy.motionscaperSetPathKey}</Button>
					<Button variant="secondary" disabled={!active || active.action.type !== 'vertex'} onClick={() => commit(() => editMotionPath(property, { type: 'insert', after: active!.action.type === 'vertex' ? active!.action.vertex : 0 }))}>{copy.motionscaperInsertPathPoint}</Button>
					<Button variant="secondary" disabled={!active || active.action.type !== 'vertex'} onClick={() => commit(() => editMotionPath(property, { type: 'remove', vertex: active!.action.type === 'vertex' ? active!.action.vertex : 0 }))}>{copy.motionscaperRemovePathPoint}</Button>
					<label><input type="checkbox" checked={property.value.closed} onChange={(event) => { const closed = event.currentTarget.checked; commit(() => editMotionPath(property, { type: 'closed', closed })); }} />{copy.motionscaperClosedPath}</label>
				</>}
			</fieldset>
			{property.kind === 'path' && <MotionPathKeyframes key={`${composition.id}/${layer?.id}/${current?.path}`} copy={copy} property={property} frameRate={composition.frameRate} position={position} disabled={disabled} clipboard={clipboard} onCopy={onCopyKeys} onEdit={commit} onError={(failure) => setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!)} />}
		</> : <p>{copy.motionscaperNoLayers}</p>}
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
