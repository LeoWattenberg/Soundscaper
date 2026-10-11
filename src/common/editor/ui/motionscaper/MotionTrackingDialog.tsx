/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import MotionTrackingFrame from './MotionTrackingFrame.tsx';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperTrackingCommands, type MotionscaperTrackingCommand } from '../../../../motionscaper/editor-tracking-commands.ts';
import { loadMotionscaperAssetBytes, type MotionAssetReader } from '../../../../motionscaper/editor-render-resources.ts';
import { analyzeMotionTracking, createMotionTrackingFrameProvider } from '../../motion-tracking-analysis.ts';
import { resolveMotionTrackingSource } from '../../motion-tracking-authority.ts';
import { MOTION_TRACKING_LIMITS, createMotionTrackingSettings, normalizeMotionTrackingSettings, type MotionTrackingSettings } from '../../motion-tracking-contract.ts';
import { motionTrackingReadiness } from '../../motion-tracking-admission.ts';
import { createMotionMediaProvider } from '../../motion-media-provider.ts';
import type { MotionVector2 } from '../../motion-property.ts';
import { parseMotionNumberInput } from './motion-exact-input.ts';
type Mode = MotionTrackingSettings['mode'];
function seeds(width: number, height: number, mode: Mode): readonly MotionVector2[] {
	return mode === 'point' ? [[Math.floor(width / 3), Math.floor(height / 3)]] : [[width / 4, height / 4], [width * 3 / 4, height / 4], [width * 3 / 4, height * 3 / 4], [width / 4, height * 3 / 4]];
}
export default function MotionTrackingDialog({ copy, project, store, busy, canUndo, canRedo, onEdit, onUndo, onRedo, onClose, cornerPin = false }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; store: MotionAssetReader; busy: boolean; canUndo: boolean; canRedo: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>; onUndo: () => Promise<void>; onRedo: () => Promise<void>; onClose: () => void; cornerPin?: boolean;
}>) {
	const id = useId();
	const [compositionId, setCompositionId] = useState(project.primaryCompositionId), [sourceId, setSourceId] = useState(''), [analysisId, setAnalysisId] = useState('');
	const [mode, setMode] = useState<Mode>('point'), [first, setFirst] = useState('0'), [count, setCount] = useState('30'), [levels, setLevels] = useState('3');
	const [points, setPoints] = useState<readonly MotionVector2[]>([[0, 0]]), [frame, setFrame] = useState(0), [targetId, setTargetId] = useState('');
	const [strength, setStrength] = useState('1'), [replace, setReplace] = useState(false), [working, setWorking] = useState(false), [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null), [status, setStatus] = useState<string | null>(null);
	const active = useRef<AbortController | null>(null), alive = useRef(true), currentProject = useRef(project), selection = useRef('');
	currentProject.current = project;
	useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); }; }, []);
	const composition = project.compositions.find(item => item.id === compositionId) ?? project.compositions[0]!;
	const result = composition.tracking?.find(item => item.id === analysisId);
	const sourceLayer = result ? composition.layers.find(item => item.id === result.binding.layerId) : composition.layers.find(item => item.id === sourceId) ?? composition.layers.find(item => item.kind === 'footage');
	const sourceAdmission = useMemo(() => {
		if (!sourceLayer) return { source: null, error: null };
		try {
			const source = resolveMotionTrackingSource(project, composition.id, sourceLayer.id);
			if (source.asset.width * source.asset.height > MOTION_TRACKING_LIMITS.maximumDecodedPixels) throw new Error('Tracking source exceeds the decoded pixel budget; use a smaller retained source.');
			return { source, error: null };
		} catch (failure) { return { source: null, error: failure instanceof Error ? failure.message : copy.motionscaperTrackingFailed }; }
	}, [project, composition.id, sourceLayer, copy]);
	const source = sourceAdmission.source;
	const activeMode = result?.settings.mode ?? mode, previewFrame = result ? frame : Number(first);
	const sample = result?.samples.find(item => item.frame === frame);
	const target = composition.layers.find(item => item.id === targetId) ?? (activeMode === 'stabilize' ? sourceLayer : composition.layers.find(item => item.id !== sourceLayer?.id)) ?? sourceLayer;
	const diagnostics = useMemo(() => motionTrackingReadiness(project), [project]);
	const problems = diagnostics.filter(item => item.compositionId === composition.id && (!result || item.analysisId === result.id));
	const disabled = busy || working;
	useEffect(() => {
		const key = `${composition.id}/${result?.id ?? ''}/${source?.layer.id ?? ''}/${mode}`; const changed = selection.current !== key; selection.current = key;
		if (result) {
			const at = changed ? result.settings.firstFrame : frame; const current = result.samples.find(item => item.frame === at);
			if (changed) setFrame(at); setPoints(current?.status === 'lost' ? result.settings.points : current?.points ?? result.settings.points);
		} else if (source && changed) { setPoints(seeds(source.asset.width, source.asset.height, mode)); setFirst(String(Math.max(0, Math.ceil(source.layer.inFrame.num / source.layer.inFrame.den)))); setCount(String(Math.max(1, Math.min(30, Math.floor(source.layer.outFrame.num / source.layer.outFrame.den) - Math.ceil(source.layer.inFrame.num / source.layer.inFrame.den))))); }
	}, [result, source, mode, frame, composition.id]);
	const run = async (operation: () => Promise<void>) => {
		setWorking(true); setError(null); setStatus(null);
		try { await operation(); } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : copy.motionscaperTrackingFailed!); }
		finally { if (alive.current) setWorking(false); }
	};
	const edit = (request: MotionscaperTrackingCommand) => run(async () => { await onEdit(createMotionscaperTrackingCommands(currentProject.current, request, { cornerPin })); });
	const analyze = async () => {
		if (!source || disabled) return;
		const abort = new AbortController(); active.current = abort; setWorking(true); setError(null); setStatus(null); setProgress(0);
		const provider = createMotionMediaProvider({ loadAsset: (asset, signal) => loadMotionscaperAssetBytes(asset, store, signal) });
		try {
			const settings = normalizeMotionTrackingSettings({ ...createMotionTrackingSettings({ mode, firstFrame: parseMotionNumberInput(first), frameCount: parseMotionNumberInput(count), points }), pyramidLevels: parseMotionNumberInput(levels) });
			const analysis = await analyzeMotionTracking({ id: crypto.randomUUID(), project, compositionId: composition.id, layerId: source.layer.id, settings,
				provider: createMotionTrackingFrameProvider(provider), signal: abort.signal, onProgress: completed => { if (alive.current) setProgress(completed); } });
			abort.signal.throwIfAborted(); await onEdit(createMotionscaperTrackingCommands(currentProject.current, { type: 'accept', compositionId: composition.id, result: analysis }));
			if (alive.current) { setAnalysisId(analysis.id); setFrame(settings.firstFrame); setPoints(settings.points); }
		} catch (failure) { if (alive.current) { if (abort.signal.aborted) setStatus(copy.motionscaperTrackingCancelled!); else setError(failure instanceof Error ? failure.message : copy.motionscaperTrackingFailed!); } }
		finally { provider.dispose(); active.current = null; if (alive.current) setWorking(false); }
	};
	const selectFrame = (value: number) => {
		if (!result || !Number.isInteger(value) || value < result.settings.firstFrame || value >= result.settings.firstFrame + result.settings.frameCount) return;
		setFrame(value); const selected = result.samples.find(item => item.frame === value); setPoints(selected?.status === 'lost' ? result.settings.points : selected?.points ?? result.settings.points);
	};
	const apply = () => {
		if (!result || !target) return;
		void run(async () => {
			const base = { compositionId: composition.id, analysisId: result.id, targetLayerId: target.id, replaceAnimation: replace };
			const existing = composition.trackingApplications?.find(item => item.analysisId === result.id && item.targetLayerId === target.id && item.kind === 'corner-pin');
			const request: MotionscaperTrackingCommand = result.settings.mode === 'point' ? { ...base, type: 'apply-point' }
				: result.settings.mode === 'stabilize' ? { ...base, type: 'apply-stabilization', strength: parseMotionNumberInput(strength) }
					: { ...base, type: 'apply-corner-pin', effectId: existing?.effectId ?? crypto.randomUUID() };
			await onEdit(createMotionscaperTrackingCommands(currentProject.current, request, { cornerPin })); if (alive.current) setStatus(copy.motionscaperTrackingApplied!);
		});
	};
	return <AudioEditorDialogShell title={copy.motionscaperTracking} onClose={disabled ? undefined : onClose} width={860}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>{active.current && <Button variant="secondary" onClick={() => active.current?.abort()}>{copy.motionscaperCancel}</Button>}<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button></>} />}>
		<p>{copy.motionscaperTrackingHint}</p>
		<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperTrackingAnalysis}</legend>
			<label htmlFor={`${id}-composition`}>{copy.motionscaperComposition}</label><select id={`${id}-composition`} value={composition.id} onChange={event => { setCompositionId(event.currentTarget.value); setSourceId(''); setAnalysisId(''); }}>
				{project.compositions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
			</select>
			<label htmlFor={`${id}-analysis`}>{copy.motionscaperTrackingAnalysis}</label><select id={`${id}-analysis`} value={result?.id ?? ''} onChange={event => setAnalysisId(event.currentTarget.value)}>
				<option value="">{copy.motionscaperTrackingNew}</option>{composition.tracking?.map(item => <option key={item.id} value={item.id}>{copy[`motionscaperTrackingMode_${item.settings.mode}`]} · {item.settings.firstFrame}–{item.settings.firstFrame + item.settings.frameCount - 1}</option>)}
			</select>
			<label htmlFor={`${id}-source`}>{copy.motionscaperTrackingSource}</label><select id={`${id}-source`} value={sourceLayer?.id ?? ''} disabled={Boolean(result)} onChange={event => setSourceId(event.currentTarget.value)}>
				{composition.layers.filter(item => item.kind === 'footage').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
			</select>
			<Button variant="secondary" disabled={!canUndo} onClick={() => { void run(onUndo); }}>{copy.motionscaperUndo}</Button>
			<Button variant="secondary" disabled={!canRedo} onClick={() => { void run(onRedo); }}>{copy.motionscaperRedo}</Button>
		</fieldset>
		{!result && <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperTrackingMode}</legend>
			<label htmlFor={`${id}-mode`}>{copy.motionscaperTrackingMode}</label><select id={`${id}-mode`} value={mode} onChange={event => setMode(event.currentTarget.value as Mode)}>{(['point', 'planar', 'stabilize'] as const).map(value => <option key={value} value={value}>{copy[`motionscaperTrackingMode_${value}`]}</option>)}</select>
			<label>{copy.motionscaperFirstFrame}<input type="number" min={0} step={1} value={first} onChange={event => setFirst(event.currentTarget.value)} /></label>
			<label>{copy.motionscaperTrackingCount}<input type="number" min={1} max={4096} step={1} value={count} onChange={event => setCount(event.currentTarget.value)} /></label>
			<label>{copy.motionscaperTrackingPyramid}<input type="number" min={1} max={4} step={1} value={levels} onChange={event => setLevels(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={!source} onClick={() => { void analyze(); }}>{copy.motionscaperTrackingAnalyze}</Button>
		</fieldset>}
		{!source && <p>{copy.motionscaperTrackingNoSource}</p>}
		{sourceAdmission.error && <p role="alert">{sourceAdmission.error}</p>}
		{source && Number.isSafeInteger(previewFrame) && previewFrame >= 0 && <MotionTrackingFrame copy={copy} source={source} store={store} frame={previewFrame} points={points} disabled={disabled} onPoints={setPoints} />}
		{source && <><p>{copy.motionscaperTrackingPointHint}</p><fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperTrackingPoint}</legend>
			{points.map((point, index) => <span key={index}>{([0, 1] as const).map(channel => <label key={channel}>{copy.motionscaperTrackingPoint} {index + 1} {channel === 0 ? copy.motionscaperChannel_x : copy.motionscaperChannel_y}
				<input type="number" step="any" value={point[channel]} onChange={event => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) setPoints(points.map((entry, offset) => offset === index ? channel === 0 ? [value, entry[1]] : [entry[0], value] : entry)); }} />
			</label>)}</span>)}
		</fieldset></>}
		{result && <>
			<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperTrackingSamples}</legend>
				<label>{copy.motionscaperFrame}<input type="number" min={result.settings.firstFrame} max={result.settings.firstFrame + result.settings.frameCount - 1} step={1} value={frame} onChange={event => selectFrame(event.currentTarget.valueAsNumber)} /></label>
				<span data-motion-tracking-sample-status={sample?.status}>{copy[`motionscaperTrackingStatus_${sample?.status ?? 'lost'}`]}</span>
				<Button variant="secondary" onClick={() => { void edit({ type: 'correct', compositionId: composition.id, analysisId: result.id, frame, points }); }}>{copy.motionscaperTrackingCorrect}</Button>
				<Button variant="secondary" onClick={() => { void edit({ type: 'remove', compositionId: composition.id, analysisId: result.id }); }}>{copy.motionscaperTrackingRemove}</Button>
			</fieldset>
			<p>{copy.motionscaperTrackingUnresolved}: <span data-motion-tracking-lost>{result.samples.filter(item => item.status === 'lost').length}</span></p>
			<fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperTrackingApply}</legend>
				<label htmlFor={`${id}-target`}>{copy.motionscaperTrackingTarget}</label><select id={`${id}-target`} value={target?.id ?? ''} onChange={event => setTargetId(event.currentTarget.value)}>{composition.layers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
				{activeMode === 'stabilize' && <label>{copy.motionscaperTrackingStrength}<input type="number" min={0} max={1} step={0.1} value={strength} onChange={event => setStrength(event.currentTarget.value)} /></label>}
				<label><input type="checkbox" checked={replace} onChange={event => setReplace(event.currentTarget.checked)} />{copy.motionscaperTrackingReplace}</label>
				<Button variant="secondary" disabled={!target} onClick={apply}>{copy.motionscaperTrackingApply}</Button>
			</fieldset>
			{!problems.length && <p>{copy.motionscaperTrackingReady}</p>}
		</>}
		{composition.trackingApplications?.filter(item => !result || item.analysisId === result.id).map(item => <Button key={`${item.targetLayerId}/${item.kind}/${item.effectId}`} disabled={disabled} variant="secondary" onClick={() => { void edit({ type: 'detach', compositionId: composition.id, targetLayerId: item.targetLayerId, kind: item.kind, ...(item.effectId ? { effectId: item.effectId } : {}) }); }}>{copy.motionscaperTrackingDetach}: {composition.layers.find(layer => layer.id === item.targetLayerId)?.name ?? item.targetLayerId}</Button>)}
		{problems.map((item, index) => <p role="alert" key={index}>{item.message}</p>)}
		{active.current && <p role="status">{copy.motionscaperTrackingProgress}: {progress}/{count}</p>}
		{status && <p role="status">{status}</p>}{error && <p role="alert">{copy.motionscaperTrackingFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
