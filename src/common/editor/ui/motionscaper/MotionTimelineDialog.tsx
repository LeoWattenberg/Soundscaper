/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperLayerCommands, type MotionscaperLayerEdit } from '../../../../motionscaper/editor-layer-commands.ts';
import type { MotionscaperLayerClipboard } from '../../../../motionscaper/editor-layer-clipboard.ts';
import MotionTimelineClipboard from './MotionTimelineClipboard.tsx';
import MotionTimelineSourceTiming from './MotionTimelineSourceTiming.tsx';
import MotionWorkArea from './MotionWorkArea.tsx';
import MotionTimelineAudio from './MotionTimelineAudio.tsx';
import { parseMotionExactInput as frame, formatMotionExactInput as format } from './motion-exact-input.ts';
import MotionTimelineLayerRow from './MotionTimelineLayerRow.tsx';
import MotionTimelineLifecycle from './MotionTimelineLifecycle.tsx';


export default function MotionTimelineDialog({ copy, project, busy, canUndo, canRedo, clipboard, onCopyLayers, onEdit, onUndo, onRedo, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; busy: boolean; canUndo: boolean; canRedo: boolean;
	clipboard: MotionscaperLayerClipboard | null; onCopyLayers: (clipboard: MotionscaperLayerClipboard) => void;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>; onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void;
}>) {
	const id = useId(); const [compositionId, setCompositionId] = useState(project.primaryCompositionId);
	const composition = project.compositions.find((entry) => entry.id === compositionId) ?? project.compositions.find((entry) => entry.id === project.primaryCompositionId)!;
	const [selection, setSelection] = useState<readonly string[]>([]); const selected = composition.layers.filter((layer) => selection.includes(layer.id));
	const single = selected.length === 1 ? selected[0]! : null;
	const [inFrame, setInFrame] = useState('0'); const [outFrame, setOutFrame] = useState(String(composition.durationFrames));
	const [delta, setDelta] = useState('1'); const [split, setSplit] = useState('1'); const [name, setName] = useState(copy.motionscaperGroupName!);
	const [parent, setParent] = useState(''); const [error, setError] = useState<string | null>(null); const [working, setWorking] = useState(false);
	const disabled = busy || working;
	const run = async (operation: () => Promise<void>) => {
		setError(null); setWorking(true);
		try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!); }
		finally { setWorking(false); }
	};
	const edit = (create: () => MotionscaperLayerEdit) => { void run(async () => { await onEdit(createMotionscaperLayerCommands({ project, compositionId: composition.id, edit: create() })); }); };
	const select = (layerId: string, checked: boolean) => {
		const next = checked ? [...selection, layerId] : selection.filter((entry) => entry !== layerId); setSelection(next); setError(null);
		if (next.length === 1) {
			const layer = composition.layers.find((entry) => entry.id === next[0])!;
			setInFrame(format(layer.inFrame)); setOutFrame(format(layer.outFrame)); setParent(layer.parentId ?? '');
		}
	};
	const reorder = (direction: -1 | 1) => {
		if (!single) return; const ids = composition.layers.map((layer) => layer.id); const index = ids.indexOf(single.id); const next = index + direction;
		if (next < 0 || next >= ids.length) return; [ids[index], ids[next]] = [ids[next]!, ids[index]!]; edit(() => ({ type: 'reorder', layerIds: ids }));
	};
	const selectionIds = selected.map((layer) => layer.id);
	return <AudioEditorDialogShell title={copy.motionscaperTimeline} onClose={disabled ? undefined : onClose} width={960} initialFocus="[data-motion-composition]" bodyClassName="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body motionscaper-property-body"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<div className="motionscaper-timeline-toolbar">
			<label htmlFor={`${id}-composition`}>{copy.motionscaperComposition}</label>
			<select id={`${id}-composition`} data-motion-composition value={composition.id} disabled={disabled} onChange={(event) => { setCompositionId(event.currentTarget.value); setSelection([]); setError(null); }}>
				{project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
			</select>
			<Button variant="secondary" disabled={disabled || !canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button>
			<Button variant="secondary" disabled={disabled || !canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
		</div>
		<MotionWorkArea key={`${composition.id}/${project.revision}`} copy={copy} project={project} composition={composition} busy={disabled} onEdit={onEdit} />
		<p>{copy.motionscaperTimelineHint}</p>
		<ul className="motionscaper-timeline-list">{composition.layers.map((layer) => <MotionTimelineLayerRow key={layer.id} layer={layer} durationFrames={composition.durationFrames}
			checked={selection.includes(layer.id)} busy={disabled} copy={copy} onSelect={(checked) => select(layer.id, checked)}
			onMove={(amount) => edit(() => ({ type: 'move', layerIds: [layer.id], deltaFrames: { num: amount, den: 1 } }))} />)}</ul>
		{composition.layers.length === 0 && <p>{copy.motionscaperNoLayers}</p>}
		<MotionTimelineLifecycle key={`${composition.id}/${single?.id ?? ''}/${project.revision}`} copy={copy} selected={selected} assets={project.assets} disabled={disabled} onEdit={edit} />
		<MotionTimelineClipboard copy={copy} project={project} compositionId={composition.id} selection={selectionIds} clipboard={clipboard} busy={disabled} onCopy={onCopyLayers} onSelect={setSelection} onEdit={onEdit} />
		{single && (single.kind === 'footage' || single.kind === 'precomp') && <MotionTimelineSourceTiming key={`${single.id}/${project.revision}`} copy={copy} project={project} compositionId={composition.id} layer={single} busy={disabled} onEdit={onEdit} />}
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperLayerActions}</legend>
			<Button variant="secondary" disabled={!single || composition.layers[0]?.id === single.id} onClick={() => reorder(-1)}>{copy.motionscaperRaiseLayer}</Button>
			<Button variant="secondary" disabled={!single || composition.layers.at(-1)?.id === single.id} onClick={() => reorder(1)}>{copy.motionscaperLowerLayer}</Button>
			<Button variant="secondary" disabled={selected.length === 0} onClick={() => edit(() => ({ type: 'duplicate', copies: selected.map((layer) => ({ layerId: layer.id, newLayerId: crypto.randomUUID(), name: `${layer.name} ${copy.motionscaperCopySuffix}` })) }))}>{copy.motionscaperDuplicate}</Button>
			<label>{copy.motionscaperMoveFrames}<input value={delta} onChange={(event) => setDelta(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={selected.length === 0} onClick={() => edit(() => ({ type: 'move', layerIds: selectionIds, deltaFrames: frame(delta) }))}>{copy.motionscaperMove}</Button>
			<label>{copy.motionscaperInFrame}<input value={inFrame} disabled={!single} onChange={(event) => setInFrame(event.currentTarget.value)} /></label>
			<label>{copy.motionscaperOutFrame}<input value={outFrame} disabled={!single} onChange={(event) => setOutFrame(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={!single} onClick={() => edit(() => ({ type: 'trim', layerId: single!.id, inFrame: frame(inFrame), outFrame: frame(outFrame) }))}>{copy.motionscaperTrim}</Button>
			<label>{copy.motionscaperSplitAt}<input value={split} disabled={!single} onChange={(event) => setSplit(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={!single} onClick={() => edit(() => ({ type: 'split', layerId: single!.id, atFrame: frame(split), newLayerId: crypto.randomUUID() }))}>{copy.motionscaperSplit}</Button>
		</fieldset>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperHierarchy}</legend>
			<label htmlFor={`${id}-parent`}>{copy.motionscaperParent}</label><select id={`${id}-parent`} value={parent} onChange={(event) => setParent(event.currentTarget.value)}>
				<option value="">{copy.motionscaperNone}</option>{composition.layers.filter((layer) => !selection.includes(layer.id)).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
			</select>
			<Button variant="secondary" disabled={selected.length === 0} onClick={() => edit(() => ({ type: 'parent', layerIds: selectionIds, parentId: parent || null }))}>{copy.motionscaperSetParent}</Button>
			<label>{copy.motionscaperGroupName}<input value={name} maxLength={512} onChange={(event) => setName(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={!name.trim()} onClick={() => edit(() => ({ type: 'add-null', newLayerId: crypto.randomUUID(), name, layerIds: selectionIds }))}>{copy.motionscaperGroupNull}</Button>
			<Button variant="secondary" disabled={!name.trim() || selected.length === 0} onClick={() => edit(() => ({ type: 'precompose', newCompositionId: crypto.randomUUID(), newLayerId: crypto.randomUUID(), name, layerIds: selectionIds }))}>{copy.motionscaperPrecompose}</Button>
		</fieldset>
		<p>{copy.motionscaperParentHint}</p>
		<MotionTimelineAudio copy={copy} project={project} composition={composition} busy={disabled} onEdit={onEdit} />
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
