/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { motionLayerProperties } from '../../motion-project-graph.ts';
import { motionExpressionErrorMessage } from '../../motion-expression-error-message.ts';
import { diagnoseMotionExpression } from '../../motion-expression-parser.ts';
import type { MotionExpression, MotionProperty } from '../../motion-property.ts';
import { motionCompositionWorkArea } from '../../motion-composition-work-area.ts';
import { compareRationals } from '../../timeline-time.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperExpressionCommands } from '../../../../motionscaper/editor-expression-commands.ts';
import { bakeMotionscaperDocumentExpression, evaluateMotionscaperDocumentExpression } from '../../../../motionscaper/editor-expression-document.ts';
import type { MotionAssetReader } from '../../../../motionscaper/editor-render-resources.ts';
import { motionPropertyLabel } from './motion-property-ui.ts';
import { formatMotionExactInput as format, parseMotionExactInput as exact } from './motion-exact-input.ts';
import MotionExpressionReferences, { type MotionExpressionOwner } from './MotionExpressionReferences.tsx';

type Props = Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; store: MotionAssetReader; busy: boolean; canUndo: boolean; canRedo: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>; onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void;
}>;
export default function MotionExpressionDialog(props: Props) {
	const { copy, project, busy, canUndo, canRedo, onUndo, onRedo, onClose } = props;
	const [compositionId, setCompositionId] = useState(project.primaryCompositionId); const [ownerId, setOwnerId] = useState(''); const [path, setPath] = useState('transform.opacity');
	const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null); const currentProject = useRef(project); currentProject.current = project;
	const composition = project.compositions.find(({ id }) => id === compositionId) ?? project.compositions[0]!;
	const owners: readonly MotionExpressionOwner[] = [...composition.layers.map((owner) => ({ owner, label: owner.name })), ...composition.audio.map((owner, i) => ({ owner, label: `${copy.motionscaperAudioPlacement} ${i + 1}: ${project.assets.find(({ id }) => id === owner.assetId)?.name ?? owner.id}` }))];
	const entry = owners.find(({ owner }) => owner.id === ownerId) ?? owners[0]; const properties = entry ? motionLayerProperties(entry.owner) : [];
	const property = properties.find((value) => value.stablePath === path) ?? properties[0]; const disabled = busy || working;
	const failed = (failure: unknown) => {
		setError(motionExpressionErrorMessage(failure, project, copy.motionscaperExpressionDiagnostic) ?? (failure instanceof Error ? failure.message : copy.motionscaperFailed!));
	};
	const run = async (operation: () => Promise<void>) => { setError(null); setWorking(true); try { await operation(); } catch (failure) { failed(failure); } finally { setWorking(false); } };
	return <AudioEditorDialogShell title={copy.motionscaperExpressions} onClose={disabled ? undefined : onClose} width={960} initialFocus="[data-motion-expression-source]" bodyClassName="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body motionscaper-property-body"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperPropertySelection}</legend>
			<label>{copy.motionscaperComposition}<select value={composition.id} onChange={(event) => { setCompositionId(event.currentTarget.value); setOwnerId(''); }}>{project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
			<label>{copy.motionscaperLayerMenu}<select value={entry?.owner.id ?? ''} onChange={(event) => { setOwnerId(event.currentTarget.value); setError(null); }}>{owners.map((entry) => <option key={entry.owner.id} value={entry.owner.id}>{entry.label}</option>)}</select></label>
			<label>{copy.motionscaperProperty}<select value={property?.stablePath ?? ''} onChange={(event) => { setPath(event.currentTarget.value); setError(null); }}>{properties.map((property) => <option key={property.stablePath} value={property.stablePath}>{motionPropertyLabel(property.path, copy, entry && 'kind' in entry.owner ? entry.owner : undefined)}</option>)}</select></label>
			<Button variant="secondary" disabled={!canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button><Button variant="secondary" disabled={!canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
		</fieldset>
		{property && entry ? <ExpressionForm key={`${composition.id}/${entry.owner.id}/${property.stablePath}/${project.revision}`} {...props} currentProject={() => currentProject.current} compositionId={composition.id} entry={entry} propertyPath={property.stablePath} property={property.property} owners={owners} disabled={disabled} run={run} onError={failed} /> : <p>{copy.motionscaperExpressionEmpty}</p>}
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
function ExpressionForm({ copy, project, store, onEdit, currentProject, compositionId, entry, propertyPath, property, owners, disabled, run, onError }: Props & Readonly<{
	currentProject: () => MotionscaperProject; compositionId: string; entry: MotionExpressionOwner; propertyPath: string; property: MotionProperty; owners: readonly MotionExpressionOwner[]; disabled: boolean;
	run: (operation: () => Promise<void>) => Promise<void>; onError: (error: unknown) => void;
}>) {
	const sourceId = useId();
	const [source, setSource] = useState(property.expression?.source ?? 'value'); const [enabled, setEnabled] = useState(property.expression?.enabled ?? false);
	const [references, setReferences] = useState<MotionExpression['references']>(property.expression?.references ?? []);
	const composition = project.compositions.find(({ id }) => id === compositionId)!; const area = motionCompositionWorkArea(composition);
	const [start, setStart] = useState(format(compareRationals(entry.owner.startFrame, area.startFrame) > 0 ? entry.owner.startFrame : area.startFrame)); const [end, setEnd] = useState(format(area.endFrame)); const [step, setStep] = useState('1');
	const [sampleFrame, setSampleFrame] = useState(format(area.startFrame)); const [sample, setSample] = useState<string | null>(null);
	const [progress, setProgress] = useState<readonly [number, number] | null>(null); const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	const address = { project, compositionId, layerId: entry.owner.id, propertyPath }; const expression = { source, enabled, references };
	const diagnostic = diagnoseMotionExpression(source).diagnostic; const dirty = JSON.stringify(expression) !== JSON.stringify(property.expression);
	const keys = property.kind === 'path' ? property.keyframes.length : property.kind === 'scalar' ? property.curve?.anchors.length ?? 0 : Math.max(0, ...property.curves.map((curve) => curve?.anchors.length ?? 0));
	const apply = (value: MotionExpression | null) => { void run(async () => { await onEdit(createMotionscaperExpressionCommands({ ...address, expression: value })); }); };
	const bake = () => { void run(async () => {
		const active = new AbortController(); controller.current = active; setProgress([0, 1]);
		try { await bakeMotionscaperDocumentExpression({ ...address, store, currentProject, onEdit, signal: active.signal, startFrame: exact(start), endFrame: exact(end), stepFrames: exact(step), onProgress: (done, total) => setProgress([done, total]) }); }
		finally { controller.current = null; setProgress(null); }
	}); };
	const evaluate = () => { void run(async () => {
		const active = new AbortController(); controller.current = active; setProgress([0, 1]); setSample(null);
		try {
			const value = await evaluateMotionscaperDocumentExpression({ ...address, frame: exact(sampleFrame), store, signal: active.signal });
			setSample(typeof value === 'number' ? String(value) : 'vertices' in value ? `${copy.motionscaperExpressionPathVertices} ${value.vertices.length}` : JSON.stringify(value));
		} finally { controller.current = null; setProgress(null); }
	}); };
	const assets = project.assets.filter((asset) => asset.kind === 'audio' || asset.kind === 'footage' && asset.hasAudio);
	const [assetId, setAssetId] = useState(assets[0]?.id ?? '');
	return <>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperExpressionSource}</legend>
			<label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />{copy.motionscaperExpressionEnabled}</label>
			<label htmlFor={sourceId}>{copy.motionscaperExpressionSource}</label><textarea id={sourceId} data-motion-expression-source rows={5} cols={75} spellCheck={false} value={source} onChange={(event) => setSource(event.currentTarget.value)} />
			<Button variant="secondary" onClick={() => apply(expression)}>{copy.motionscaperExpressionApply}</Button><Button variant="secondary" disabled={!property.expression} onClick={() => apply(null)}>{copy.motionscaperExpressionRemove}</Button>
			<p>{copy.motionscaperExpressionLanguage}</p>
			{diagnostic && <p data-motion-expression-diagnostic role="status">{copy.motionscaperExpressionDiagnostic} {diagnostic.start + 1}–{diagnostic.end + 1}: {diagnostic.message}</p>}
		</fieldset>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperExpressionEvaluate}</legend>
			<label>{copy.motionscaperExpressionEvaluateFrame}<input value={sampleFrame} onChange={(event) => setSampleFrame(event.currentTarget.value)} /></label><Button variant="secondary" disabled={dirty} onClick={evaluate}>{copy.motionscaperExpressionEvaluate}</Button>
			{sample !== null && <output data-motion-expression-result>{sample}</output>}
		</fieldset>
		<MotionExpressionReferences copy={copy} owners={owners} references={references} disabled={disabled} onChange={setReferences} onError={onError} />
		{assets.length > 0 && <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperExpressionAmplitude}</legend>
			<label>{copy.motionscaperExpressionAudioAsset}<select value={assetId} onChange={(event) => setAssetId(event.currentTarget.value)}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
			<Button variant="secondary" onClick={() => setSource(`audioAmplitude(${JSON.stringify(assetId)}, time, 0.02)`)}>{copy.motionscaperExpressionUseAmplitude}</Button><p>{copy.motionscaperExpressionAmplitudeHint}</p>
		</fieldset>}
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperExpressionBake}</legend>
			<label>{copy.motionscaperExpressionBakeStart}<input value={start} onChange={(event) => setStart(event.currentTarget.value)} /></label><label>{copy.motionscaperExpressionBakeEnd}<input value={end} onChange={(event) => setEnd(event.currentTarget.value)} /></label><label>{copy.motionscaperExpressionBakeStep}<input value={step} onChange={(event) => setStep(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={dirty || !enabled || !!diagnostic} onClick={bake}>{copy.motionscaperExpressionBake}</Button><p>{copy.motionscaperExpressionBakeHint}</p>
			<p>{copy.motionscaperExpressionKeyCount}{' '}<output data-motion-expression-keys>{keys}</output></p>
		</fieldset>
		{progress && <div role="status"><progress value={progress[0]} max={progress[1]} /><Button variant="secondary" onClick={() => controller.current?.abort()}>{copy.motionscaperCancel}</Button></div>}
	</>;
}
