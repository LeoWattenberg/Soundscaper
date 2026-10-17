/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { beginMotionscaperCanvasTransform, motionscaperCanvasScene, hitMotionscaperCanvas, type MotionCanvasMode, type MotionCanvasTransformGesture } from '../../../../motionscaper/editor-canvas-transform.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import type { MotionAssetReader } from '../../../../motionscaper/editor-render-resources.ts';
import type { MotionVector2 } from '../../motion-property.ts';
import { compareRationals, type Rational } from '../../timeline-time.ts';
import { formatMotionExactInput, parseMotionExactInput } from './motion-exact-input.ts';
import { useMotionCanvasPreview } from './use-motion-canvas-preview.ts';
interface Drag { readonly gesture: MotionCanvasTransformGesture; readonly pointer: number; readonly start: MotionVector2; point: MotionVector2; moved: boolean; valid: boolean }
export default function MotionCanvasDialog({ copy, project, store, busy, canUndo, canRedo, onEdit, onUndo, onRedo, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; store: MotionAssetReader; busy: boolean; canUndo: boolean; canRedo: boolean;
	onEdit(commands: readonly MotionscaperProjectCommand[]): Promise<void>; onUndo(): Promise<void>; onRedo(): Promise<void>; onClose(): void;
}>) {
	const id = useId();
	const [compositionId, setCompositionId] = useState(project.primaryCompositionId); const composition = project.compositions.find(item => item.id === compositionId) ?? project.compositions[0]!;
	const [frame, setFrame] = useState<Rational>({ num: 0, den: 1 }); const [frameText, setFrameText] = useState('0'); const [frameInvalid, setFrameInvalid] = useState(false);
	const [pixelUnit, setPixelUnit] = useState(1);
	const [selected, setSelected] = useState(''); const [draft, setDraft] = useState<MotionscaperProject | null>(null); const [error, setError] = useState<string | null>(null); const [writing, setWriting] = useState(false);
	const canvas = useRef<HTMLCanvasElement>(null); const overlay = useRef<SVGSVGElement>(null); const drag = useRef<Drag | null>(null); const current = useRef(project); current.current = project;
	const shown = draft ?? project; const request = useMemo(() => ({ project: shown, compositionId: composition.id, frame }), [shown, composition.id, frame]);
	const preview = useMotionCanvasPreview(canvas, request, store);
	const model = useMemo(() => { try { return { scene: motionscaperCanvasScene(request), error: null }; } catch (failure) { return { scene: null, error: failure instanceof Error ? failure.message : String(failure) }; } }, [request]);
	const geometry = model.scene?.layers.find(layer => layer.layerId === selected); const disabled = busy || writing;
	useEffect(() => { drag.current = null; setDraft(null); }, [project]);
	useEffect(() => {
		const element = overlay.current; if (!element) return;
		const update = () => { const matrix = element.getScreenCTM(); if (matrix) setPixelUnit(1 / Math.hypot(matrix.a, matrix.b)); };
		const observer = new ResizeObserver(update); observer.observe(element); update(); return () => observer.disconnect();
	}, [composition.width, composition.height]);
	const top = geometry ? [(geometry.corners[0][0] + geometry.corners[1][0]) / 2, (geometry.corners[0][1] + geometry.corners[1][1]) / 2] as const : [0, 0] as const;
	const rotationDirection = geometry ? [geometry.rotationHandle[0] - top[0], geometry.rotationHandle[1] - top[1]] as const : [0, -1] as const;
	const rotationLength = Math.hypot(...rotationDirection);
	const rotationHandle: MotionVector2 = [top[0] + rotationDirection[0] * 24 * pixelUnit / rotationLength, top[1] + rotationDirection[1] * 24 * pixelUnit / rotationLength];
	const handleRadius = 6 * pixelUnit;
	const cancel = () => { const active = drag.current; drag.current = null; if (active && overlay.current?.hasPointerCapture(active.pointer)) overlay.current.releasePointerCapture(active.pointer); setDraft(null); };
	const run = async (operation: () => Promise<void>) => { setWriting(true); setError(null); try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setWriting(false); setDraft(null); } };
	const point = (event: PointerEvent<SVGSVGElement>): MotionVector2 => {
		const matrix = overlay.current?.getScreenCTM(); if (!matrix) throw new Error(copy.motionscaperCanvasInactive);
		const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return [value.x, value.y];
	};
	const start = (event: PointerEvent<SVGSVGElement>) => {
		if (disabled || !preview.ready || frameInvalid || event.button !== 0 || !model.scene) return;
		try {
			const at = point(event); const handle = (event.target as Element).closest('[data-motion-canvas-handle]')?.getAttribute('data-motion-canvas-handle') as MotionCanvasMode | null;
			const layerId = handle ? selected : hitMotionscaperCanvas(model.scene, at); setSelected(layerId ?? ''); setError(null); if (!layerId) return;
			const gesture = beginMotionscaperCanvasTransform({ project, compositionId: composition.id, layerId, frame, mode: handle ?? 'move', start: at });
			drag.current = { gesture, pointer: event.pointerId, start: at, point: at, moved: false, valid: true }; overlay.current?.focus({ preventScroll: true }); overlay.current?.setPointerCapture(event.pointerId); event.preventDefault();
		} catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
	};
	const move = (event: PointerEvent<SVGSVGElement>) => {
		const active = drag.current; if (!active || active.pointer !== event.pointerId) return;
		try { const at = point(event); const candidate = active.gesture.preview(at); active.point = at; active.valid = true; setError(null); active.moved ||= Math.hypot(at[0] - active.start[0], at[1] - active.start[1]) > 0.25; if (active.moved) setDraft(candidate.project); }
		catch (failure) { active.valid = false; setError(failure instanceof Error ? failure.message : String(failure)); }
	};
	const finish = (event: PointerEvent<SVGSVGElement>) => {
		const active = drag.current; if (!active || active.pointer !== event.pointerId) return; drag.current = null; overlay.current?.releasePointerCapture(event.pointerId);
		if (active.moved && active.valid) void run(() => onEdit(active.gesture.commit(current.current, active.point))); else setDraft(null);
	};
	const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
		if (event.key === 'Escape' && drag.current) { cancel(); event.stopPropagation(); event.preventDefault(); return; }
		if (disabled || frameInvalid || !preview.ready || !geometry?.editable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault(); const mode = (event.target as Element).closest('[data-motion-canvas-handle]')?.getAttribute('data-motion-canvas-handle') as MotionCanvasMode | null;
		const from = mode === 'rotate' ? rotationHandle : mode === 'scale' ? geometry.corners[geometry.scaleCorner]! : geometry.anchor;
		const step = event.shiftKey ? 10 : 1; const target: MotionVector2 = [from[0] + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), from[1] + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)];
		void run(() => onEdit(beginMotionscaperCanvasTransform({ project, compositionId: composition.id, layerId: selected, frame, mode: mode ?? 'move', start: from }).commit(current.current, target)));
	};
	const changeFrame = (text: string) => { setFrameText(text); try { const value = parseMotionExactInput(text); if (value.num < 0 || compareRationals(value, composition.durationFrames) >= 0) throw new RangeError(); cancel(); setFrame(value); setError(null); setFrameInvalid(false); } catch { setFrameInvalid(true); } };
	const points = geometry?.corners.map(value => value.join(',')).join(' '); const scaleHandle = geometry?.corners[geometry.scaleCorner];
	return <AudioEditorDialogShell title={copy.motionscaperCanvas} onClose={disabled ? undefined : onClose} width={800} initialFocus="[data-motion-canvas-layer]"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<><Button disabled={disabled || !canUndo} onClick={() => { cancel(); void run(onUndo); }}>{copy.motionscaperUndo}</Button><Button disabled={disabled || !canRedo} onClick={() => { cancel(); void run(onRedo); }}>{copy.motionscaperRedo}</Button><Button disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button></>} />}>
		<p>{copy.motionscaperCanvasDescription}</p><p>{copy.motionscaperCanvasLimits}</p>
		<div className="motionscaper-preview-controls"><label htmlFor={`${id}-composition`}>{copy.motionscaperComposition}</label><select id={`${id}-composition`} disabled={disabled} value={composition.id} onChange={event => { cancel(); setSelected(''); setCompositionId(event.currentTarget.value); setFrame({ num: 0, den: 1 }); setFrameText('0'); setFrameInvalid(false); }}>{project.compositions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
			<label htmlFor={`${id}-layer`}>{copy.motionscaperCanvasLayer}</label><select id={`${id}-layer`} data-motion-canvas-layer disabled={disabled} value={selected} onChange={event => { cancel(); setError(null); setSelected(event.currentTarget.value); }}><option value="">{copy.motionscaperCanvasSelect}</option>{composition.layers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select>
			<label htmlFor={`${id}-frame`}>{copy.motionscaperFrame}</label><input id={`${id}-frame`} disabled={disabled} aria-invalid={frameInvalid} value={frameText} onChange={event => changeFrame(event.currentTarget.value)} /></div>
		<div style={{ position: 'relative', width: '100%', maxWidth: 680, height: Math.min(460, 680 * composition.height / composition.width), margin: 'auto' }}>
			<canvas ref={canvas} data-motion-canvas-preview width={1} height={1} className="motionscaper-preview-canvas" style={{ width: '100%', height: '100%', objectFit: 'contain' }} aria-label={composition.name} />
			<svg ref={overlay} data-motion-canvas-overlay viewBox={`0 0 ${composition.width} ${composition.height}`} role="group" aria-label={copy.motionscaperCanvas} tabIndex={0}
				style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', overflow: 'visible' }}
				onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }} onKeyDown={keyboard}>
				{geometry && <g fill="none" stroke="#36b9ff" strokeWidth={1.5 * pixelUnit} data-motion-canvas-selected={selected} data-motion-anchor-x={geometry.anchor[0]} data-motion-anchor-y={geometry.anchor[1]}>
					<polygon points={points} vectorEffect="non-scaling-stroke" />
					{geometry.editable && <><g data-motion-canvas-handle="move" role="button" tabIndex={0} aria-label={copy.motionscaperCanvasMove}><circle cx={geometry.anchor[0]} cy={geometry.anchor[1]} r={handleRadius} fill="#fff" /></g>
						{scaleHandle && <g data-motion-canvas-handle="scale" role="button" tabIndex={0} aria-label={copy.motionscaperCanvasScale}><rect x={scaleHandle[0] - handleRadius} y={scaleHandle[1] - handleRadius} width={2 * handleRadius} height={2 * handleRadius} fill="#fff" /></g>}
						<line x1={geometry.anchor[0]} y1={geometry.anchor[1]} x2={rotationHandle[0]} y2={rotationHandle[1]} vectorEffect="non-scaling-stroke" />
						<g data-motion-canvas-handle="rotate" role="button" tabIndex={0} aria-label={copy.motionscaperCanvasRotate}><circle cx={rotationHandle[0]} cy={rotationHandle[1]} r={handleRadius} fill="#fff" /></g></>}
				</g>}
			</svg>
		</div>
		{frameInvalid && <p role="alert">{copy.motionscaperCanvasFrameInvalid}</p>}
		{selected && (!geometry || !geometry.editable) && <p role="status">{geometry?.reason ?? copy.motionscaperCanvasInactive}</p>}
		{(error || model.error || preview.error) && <p role="alert">{error ?? model.error ?? preview.error}</p>}
		<p role="status">{draft ? copy.motionscaperCanvasDraft : preview.ready ? `${copy.motionscaperPreviewReady} · ${formatMotionExactInput(frame)}` : copy.motionscaperWorking}</p>
	</AudioEditorDialogShell>;
}
