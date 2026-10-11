/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionAsset } from '../../motion-asset.ts';
import { prepareMotionFont } from '../../motion-font-import.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperAppearanceCommands, type MotionscaperAppearanceEdit } from '../../../../motionscaper/editor-appearance-commands.ts';
import MotionTextAppearance from './MotionTextAppearance.tsx';
import MotionShapeAppearance, { MotionSolidAppearance } from './MotionShapeAppearance.tsx';

export default function MotionAppearanceDialog({ copy, project, busy, canUndo, canRedo, onEdit, onUndo, onRedo, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; busy: boolean; canUndo: boolean; canRedo: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[], preparedAssets?: readonly Readonly<{ asset: MotionAsset; body: Blob }>[]) => Promise<void>;
	onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void;
}>) {
	const [compositionId, setCompositionId] = useState(project.primaryCompositionId), [layerId, setLayerId] = useState('');
	const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null);
	const lifetime = useRef<AbortController | null>(null), currentProject = useRef(project); currentProject.current = project;
	useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
	const composition = project.compositions.find(value => value.id === compositionId) ?? project.compositions[0]!;
	const layers = composition.layers.filter(value => value.kind === 'text' || value.kind === 'shapes' || value.kind === 'solid');
	const layer = layers.find(value => value.id === layerId) ?? layers[0], disabled = working || busy;
	const failed = (failure: unknown) => setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!);
	const run = async (operation: () => Promise<void>) => { setError(null); setWorking(true); try { await operation(); } catch (failure) { if (!lifetime.current?.signal.aborted) failed(failure); } finally { if (!lifetime.current?.signal.aborted) setWorking(false); } };
	const edit = (change: MotionscaperAppearanceEdit) => { if (layer) void run(async () => { await onEdit(createMotionscaperAppearanceCommands({ project, compositionId: composition.id, layerId: layer.id, edit: change })); }); };
	const importFont = (file: File, style: string, change: Extract<MotionscaperAppearanceEdit, { type: 'text-run' }>) => {
		if (!layer) return;
		void run(async () => {
			const signal = lifetime.current?.signal;
			const { loadMotionRasterRuntime } = await import('../../controller/composition/motion-raster-runtime.ts');
			const runtime = await loadMotionRasterRuntime(signal);
			const prepared = await prepareMotionFont(file, { id: crypto.randomUUID(), name: file.name, style }, runtime.kit, signal);
			signal?.throwIfAborted();
			if (currentProject.current !== project) throw new Error('The project changed while importing this font. Import it again.');
			await onEdit(createMotionscaperAppearanceCommands({ project, compositionId: composition.id, layerId: layer.id, edit: { ...change, fontAssetId: prepared.asset.id }, fonts: [prepared.asset] }), [prepared]);
		});
	};
	return <AudioEditorDialogShell title={copy.motionscaperAppearance} onClose={disabled ? undefined : onClose} width={940} initialFocus="[data-motion-appearance-layer]" bodyClassName="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body motionscaper-property-body"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperPropertySelection}</legend>
			<label>{copy.motionscaperComposition}<select value={composition.id} onChange={event => { setCompositionId(event.currentTarget.value); setLayerId(''); }}>{project.compositions.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
			<label>{copy.motionscaperLayerMenu}<select data-motion-appearance-layer value={layer?.id ?? ''} onChange={event => setLayerId(event.currentTarget.value)}>{layers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
			<Button variant="secondary" disabled={!canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button><Button variant="secondary" disabled={!canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
		</fieldset>
		<p>{copy.motionscaperAppearanceHint}</p>
		{layer?.kind === 'text' && <MotionTextAppearance key={layer.id} copy={copy} document={layer.document} fonts={project.assets.filter(asset => asset.kind === 'font')} revision={project.revision} disabled={disabled} onEdit={edit} onError={failed} onImportFont={importFont} />}
		{layer?.kind === 'shapes' && <MotionShapeAppearance key={layer.id} copy={copy} shapes={layer.shapes} revision={project.revision} disabled={disabled} onEdit={edit} onError={failed} />}
		{layer?.kind === 'solid' && <MotionSolidAppearance key={`${layer.id}/${project.revision}`} copy={copy} layer={layer} disabled={disabled} onEdit={edit} onError={failed} />}
		{!layer && <p>{copy.motionscaperAppearanceEmpty}</p>}
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
