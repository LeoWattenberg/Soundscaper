/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopRepairSpotsCopy } from '../../../i18n/lightscaper-develop-repair-spots-copy.ts';
import { ImageRepairSpotsAuthoringV1, type WithImageRepairSpotsOriginalFrameV1 } from '../../controller/shared/image-repair-spots-authoring-v1.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopStateV3 } from '../../imaging/image-develop-state-v3.ts';
import { normalizeImageDevelopRepairSpotsV1, type ImageDevelopRepairSpotV1 } from '../../imaging/image-develop-repair-spots-v1.ts';
import { paintPixelFrameCanvasV1, clearPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';
import { withRepairSpotsVisualizePixelFrameV1 } from '../../imaging/pixel-frame-repair-visualize-v1.ts';
import '../lightscaper/photo-develop-repair-spots.css';

export interface ImageRepairSpotsEditorPropsV1 {
	readonly develop: ImageDevelopStateCurrentV1;
	readonly withOriginalFrame: WithImageRepairSpotsOriginalFrameV1;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (develop: Readonly<ImageDevelopStateV3>) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
type Form = Readonly<{ mode: 'clone' | 'heal'; targetX: string; targetY: string; sourceX: string; sourceY: string; radius: string; feather: string; opacity: string; enabled: boolean }>;
const defaults = (): Form => ({ mode: 'clone', targetX: '.5', targetY: '.5', sourceX: '.25', sourceY: '.5', radius: '.05', feather: '.5', opacity: '1', enabled: true });

/** Original-space authoring is serial with diagnostics and full validation.
 * Scalar draft edits are local; only the current joined Apply publishes to the
 * Workspace, whose existing Save owns catalog history and the native ACK. */
export default function ImageRepairSpotsEditorV1(props: ImageRepairSpotsEditorPropsV1) {
	const text = photoDevelopRepairSpotsCopy(props.locale), { withOriginalFrame, develop } = props;
	const [form, setForm] = useState<Form>(defaults), [tool, setTool] = useState<'target' | 'source'>('target');
	const [visualize, setVisualize] = useState(false), [threshold, setThreshold] = useState('.02'), [failure, setFailure] = useState(false), [lifecycle, setLifecycle] = useState(0);
	const latest = useRef(props); latest.current = props;
	const live = useRef(true), rendered = useRef(form); rendered.current = form;
	const activeToken = useRef<object | null>(null), predecessor = useRef<Promise<void>>(Promise.resolve()), canvas = useRef<HTMLCanvasElement>(null);
	const generation = useMemo(() => {
		const token = Object.freeze({ withOriginalFrame, develop, lifecycle }), stop = new AbortController();
		const owner = new ImageRepairSpotsAuthoringV1({ withOriginalFrame, develop, signal: stop.signal,
			isCurrent: () => live.current && activeToken.current === token && latest.current.withOriginalFrame === withOriginalFrame
				&& latest.current.develop === develop && latest.current.isCurrent() });
		return { token, owner, stop, retirement: { begun: false }, opening: { work: Promise.resolve() }, painting: { work: Promise.resolve() as Promise<unknown> } };
	}, [withOriginalFrame, develop, lifecycle]);
	activeToken.current = generation.token;
	const { owner } = generation;
	const [state, setState] = useState(() => ({ owner, value: owner.snapshot() })), [painted, setPainted] = useState<object | null>(null);
	const snapshot = state.owner === owner ? state.value : owner.snapshot();
	const drag = useRef<Readonly<{ id: number; x: number; y: number; cancelled?: true }> | null>(null);
	const presentationCurrent = () => live.current && latest.current === props && activeToken.current === generation.token && rendered.current === form && props.isCurrent();
	const current = () => presentationCurrent() && !generation.retirement.begun && !owner.snapshot().closed && !props.disabled;
	const ownerCurrent = useCallback(() => live.current && activeToken.current === generation.token && !generation.retirement.begun
		&& !owner.snapshot().closed && !latest.current.disabled && latest.current.isCurrent(), [generation, owner]);
	const interactive = () => { const actual = owner.snapshot(); return current() && actual.ready && !actual.busy; };
	const retire = useMemo(() => {
		let closing: Promise<void> | null = null;
		return () => {
			if (closing) return closing;
			let resolve!: () => void, reject!: (error: unknown) => void;
			closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
			generation.retirement.begun = true; drag.current = null;
			const before = predecessor.current, opening = generation.opening.work, painting = generation.painting.work;
			const nativeCancellation = (error: unknown) => { if (!generation.stop.signal.aborted || !Object.is(error, generation.stop.signal.reason)) throw error; };
			void (async () => {
				// Cache the join before native listeners can synchronously reenter.
				generation.stop.abort();
				await joinPhotoLibraryRetirementV1([before, owner.cancelAndJoin(), opening.catch(nativeCancellation), painting.then(() => undefined, nativeCancellation)]);
				if (activeToken.current === generation.token && canvas.current) clearPixelFrameCanvasV1(canvas.current);
			})().then(resolve, reject); return closing;
		};
	}, [generation, owner]);
	useLayoutEffect(() => {
		let mounted = true; live.current = true;
		const unsubscribe = owner.snapshot().closed ? () => undefined : owner.subscribe(value => { if (mounted) setState({ owner, value }); });
		const unregister = latest.current.registerRetirement?.(retire);
		setForm(defaults()); setVisualize(false); setThreshold('.02'); setPainted(null); setFailure(false);
		generation.opening.work = predecessor.current.then(async () => {
			if (!mounted) return;
			if (owner.snapshot().closed) { setLifecycle(value => value + 1); return; }
			await owner.open();
			const first = owner.snapshot().repairs.spots[0];
			if (mounted && ownerCurrent() && first) { owner.select(first.id); setForm(spotForm(first)); }
		});
		void generation.opening.work.catch(() => { if (mounted && ownerCurrent()) setFailure(true); });
		return () => { mounted = false; unsubscribe(); predecessor.current = retire(); void predecessor.current.catch(() => undefined); unregister?.(); };
	}, [generation, owner, ownerCurrent, retire]);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	useEffect(() => {
		if (!snapshot.ready || snapshot.closed) return;
		const opened = generation.opening.work;
		const work = generation.painting.work.then(async () => {
			// Ready publication does not release the Original demand. Join its
			// actual opening outcome before taking the serial display slot.
			await opened; if (!ownerCurrent()) return;
			const edgeThreshold = fraction(threshold);
			return owner.withOriginalFrame(async originalFrame => {
				if (!ownerCurrent() || !canvas.current) return;
				const target = canvas.current, paint = (frame: typeof originalFrame) => {
					if (!ownerCurrent()) return;
					paintPixelFrameCanvasV1(target, frame, { limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source, signal: generation.stop.signal });
				};
				if (visualize) await withRepairSpotsVisualizePixelFrameV1({ frame: originalFrame, threshold: edgeThreshold, signal: generation.stop.signal }, paint,
					{ limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source });
				else paint(originalFrame);
			});
		}); generation.painting.work = work;
		void work.then(() => { if (ownerCurrent()) setPainted(generation.token); }, () => { if (ownerCurrent()) setFailure(true); });
	}, [generation, owner, ownerCurrent, snapshot.ready, snapshot.closed, visualize, threshold]);
	const selected = snapshot.repairs.spots.find(spot => spot.id === snapshot.selectedId), disabled = !current() || !snapshot.ready || snapshot.busy;
	const sync = () => { const next = owner.snapshot().repairs.spots.find(spot => spot.id === owner.snapshot().selectedId); setForm(next ? spotForm(next) : defaults()); };
	const attempt = (action: () => void) => { if (!interactive()) return; try { action(); sync(); setFailure(false); } catch { if (current()) setFailure(true); } };
	const update = (next: Form) => {
		if (!interactive()) return; setForm(next); setFailure(false);
		if (selected) try { owner.update(spot(next, selected.id)); } catch { if (current()) setFailure(true); }
	};
	const apply = () => {
		if (!interactive() || drag.current) return;
		try { if (selected) owner.update(spot(form, selected.id)); }
		catch { setFailure(true); return; }
		void owner.apply().then(value => { if (current()) props.onApply(value); }, () => { if (current()) setFailure(true); });
	};
	const close = () => { if (!presentationCurrent() || generation.retirement.begun) return;
		void retire().then(() => { if (presentationCurrent()) props.onClose(); }, () => { if (presentationCurrent()) setFailure(true); }); };
	const position = (event: PointerEvent<HTMLCanvasElement>) => {
		const box = event.currentTarget.getBoundingClientRect(); if (box.width <= 0 || box.height <= 0) throw new RangeError('Original display has no content extent.');
		return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
	};
	const down = (event: PointerEvent<HTMLCanvasElement>) => {
		if (!interactive() || !selected || drag.current || event.button !== 0) return;
		try { const point = position(event); owner.beginMove(selected.id, tool); drag.current = { id: event.pointerId, x: selected[tool].x - point.x, y: selected[tool].y - point.y };
			event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); } catch { drag.current = null; setFailure(true); }
	};
	const move = (event: PointerEvent<HTMLCanvasElement>) => {
		if (!interactive() || drag.current?.id !== event.pointerId || drag.current.cancelled) return;
		try { const point = position(event); owner.previewMove({ x: Math.max(0, Math.min(1, point.x + drag.current.x)), y: Math.max(0, Math.min(1, point.y + drag.current.y)) }); sync(); }
		catch { try { owner.cancelMove(); } finally { drag.current = null; sync(); setFailure(true); } }
	};
	const discard = (event: PointerEvent<HTMLCanvasElement>) => {
		const held = drag.current;
		if (!ownerCurrent() || !held || held.id !== event.pointerId || held.cancelled) return;
		if (interactive()) { drag.current = null; attempt(() => owner.cancelMove()); return; }
		// Keep the gesture fenced until the serial Original demand releases.
		// Retirement already joins this paint chain and seals its owner first.
		const cancelled = Object.freeze({ ...held, cancelled: true as const }); drag.current = cancelled;
		const work = generation.painting.work.then(() => {
			if (!ownerCurrent() || drag.current !== cancelled) return;
			owner.cancelMove(); drag.current = null; sync(); setFailure(false);
		}); generation.painting.work = work;
		void work.catch(() => { if (ownerCurrent()) setFailure(true); });
	};
	const up = (event: PointerEvent<HTMLCanvasElement>) => {
		if (!ownerCurrent() || drag.current?.id !== event.pointerId || drag.current.cancelled) return;
		if (!interactive()) { discard(event); return; }
		move(event); if (!drag.current) return; drag.current = null; attempt(() => owner.commitMove()); event.currentTarget.releasePointerCapture(event.pointerId);
	};
	const fields = ['targetX', 'targetY', 'sourceX', 'sourceY', 'radius', 'feather', 'opacity'] as const, ready = snapshot.ready && !snapshot.busy && painted === generation.token;
	return <AudioEditorDialogShell title={text.title} onClose={close} className="lightscaper-dialog lightscaper-repair-spots-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-repair-spots-dialog>
			<div className="lightscaper-repair-original-plane" style={{ aspectRatio: snapshot.width && snapshot.height ? `${snapshot.width} / ${snapshot.height}` : undefined }}>
				<canvas ref={canvas} width={snapshot.width} height={snapshot.height} role="img" aria-label={text.original} data-photo-repair-original data-state={ready ? 'ready' : failure ? 'failed' : 'pending'}
					onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={discard} onLostPointerCapture={discard} />
				<svg viewBox={`0 0 ${snapshot.width || 1} ${snapshot.height || 1}`} aria-hidden="true">{snapshot.repairs.spots.map(value => {
					const radius = value.radius * Math.min(snapshot.width, snapshot.height), target = { x: value.target.x * snapshot.width, y: value.target.y * snapshot.height }, source = { x: value.source.x * snapshot.width, y: value.source.y * snapshot.height };
					return <g key={value.id} data-selected={value.id === snapshot.selectedId} opacity={value.enabled ? 1 : .4}>
						<line x1={source.x} y1={source.y} x2={target.x} y2={target.y} /><circle cx={source.x} cy={source.y} r={radius} className="lightscaper-repair-source" /><circle cx={target.x} cy={target.y} r={radius} />
					</g>;
				})}</svg>
			</div>
			<label>{text.spot}<select aria-label={text.spot} disabled={disabled} value={snapshot.selectedId ?? ''} onChange={event => attempt(() => owner.select(event.currentTarget.value || null))}>
				<option value="">{text.newSpot}</option>{snapshot.repairs.spots.map((value, index) => <option key={value.id} value={value.id}>{index + 1}: {value.mode === 'clone' ? text.clone : text.heal}</option>)}</select></label>
			<fieldset disabled={disabled} className="lightscaper-repair-controls"><legend>{text.title}</legend>
				<label>{text.mode}<select aria-label={text.mode} value={form.mode} onChange={event => { const mode = event.currentTarget.value; if (mode === 'clone' || mode === 'heal') update({ ...form, mode }); }}>
					<option value="clone">{text.clone}</option><option value="heal">{text.heal}</option></select></label>
				{fields.map(key => <label key={key}>{text[key]}<input type="number" min={key === 'radius' ? '0.000001' : 0} max={1} step="any" aria-label={text[key]} value={form[key]}
					onChange={event => update({ ...form, [key]: event.currentTarget.value })} /></label>)}
				<label><input type="checkbox" aria-label={text.enabled} checked={form.enabled} onChange={event => update({ ...form, enabled: event.currentTarget.checked })} />{text.enabled}</label>
				<label>{text.tool}<select aria-label={text.tool} value={tool} onChange={event => { const value = event.currentTarget.value; if (interactive() && (value === 'target' || value === 'source')) setTool(value); }}>
					<option value="target">{text.target}</option><option value="source">{text.source}</option></select></label>
				<button type="button" disabled={snapshot.repairs.spots.length >= 64} onClick={() => attempt(() => owner.add(spot(form, crypto.randomUUID())))}>{text.add}</button>
				<button type="button" disabled={!selected} onClick={() => { if (selected) attempt(() => owner.remove(selected.id)); }}>{text.remove}</button>
				<button type="button" disabled={!selected || snapshot.repairs.spots[0]?.id === selected.id} onClick={() => { if (selected) attempt(() => owner.move(selected.id, 'up')); }}>{text.moveUp}</button>
				<button type="button" disabled={!selected || snapshot.repairs.spots.at(-1)?.id === selected.id} onClick={() => { if (selected) attempt(() => owner.move(selected.id, 'down')); }}>{text.moveDown}</button>
			</fieldset>
			<label><input type="checkbox" aria-label={text.visualize} checked={visualize} disabled={disabled} onChange={event => { if (interactive()) { setVisualize(event.currentTarget.checked); setPainted(null); } }} />{text.visualize}</label>
			<label>{text.threshold}<input type="number" min={0} max={1} step="any" aria-label={text.threshold} value={threshold} disabled={disabled || !visualize}
				onChange={event => { if (!interactive()) return; try { fraction(event.currentTarget.value); setThreshold(event.currentTarget.value); setPainted(null); setFailure(false); } catch { setFailure(true); } }} /></label>
			<p>{text.edgeHelp}</p>{(!snapshot.ready || snapshot.busy) && <p role="status">{text.working}</p>}{failure && <p role="alert">{text.invalid} {text.failed}</p>}
			<div className="lightscaper-develop-actions"><button type="button" disabled={disabled || Boolean(drag.current)} onClick={apply}>{text.apply}</button><button type="button" onClick={close}>{text.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}
function fraction(value: string): number {
	const number = value.trim() === '' ? NaN : Number(value);
	if (!Number.isFinite(number) || Object.is(number, -0) || number < 0 || number > 1) throw new RangeError('Repair coordinates and amounts require canonical fractions.'); return number;
}
function spot(value: Form, id: string): Readonly<ImageDevelopRepairSpotV1> {
	return normalizeImageDevelopRepairSpotsV1({ schemaVersion: 1, spots: [{ id, mode: value.mode, enabled: value.enabled,
		target: { x: fraction(value.targetX), y: fraction(value.targetY) }, source: { x: fraction(value.sourceX), y: fraction(value.sourceY) },
		radius: fraction(value.radius), feather: fraction(value.feather), opacity: fraction(value.opacity) }] }).spots[0]!;
}
function spotForm(value: Readonly<ImageDevelopRepairSpotV1>): Form {
	return { mode: value.mode, enabled: value.enabled, targetX: String(value.target.x), targetY: String(value.target.y), sourceX: String(value.source.x), sourceY: String(value.source.y),
		radius: String(value.radius), feather: String(value.feather), opacity: String(value.opacity) };
}
