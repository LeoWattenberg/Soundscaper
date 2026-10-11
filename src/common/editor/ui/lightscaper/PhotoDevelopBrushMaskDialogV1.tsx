/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopBrushMaskCopy } from '../../../i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { PhotoLibraryBrushMaskAuthoringV1 } from '../../controller/shared/photo-library-brush-mask-authoring-v1.ts';
import type { PhotoLibraryDevelopMaskRasterPortV1 } from '../../photo-library-develop-mask-raster-port-v1.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../photo-library-develop-port-v2.ts';
import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from '../../imaging/brush-mask-resource-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../imaging/image-develop-state-v2.ts';
import type { BrushMaskPointV1, BrushMaskStrokeV1 } from '../../imaging/brush-mask-plane-v1.ts';
import { videoEffectDefinitionV2 } from '../../video-effects-v2.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 } from '../../video-image-geometry-v1.ts';
import type { PhotoDevelopMaskOverlaySelectionV1 } from './PhotoDevelopGradientDialogV1.tsx';
import './photo-develop-brush-mask.css';

export interface PhotoDevelopBrushMaskDialogPropsV1 {
	readonly port: Readonly<PhotoLibraryDevelopMaskRasterPortV1>;
	readonly develop: PhotoLibraryDevelopSettingsV2;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: PhotoLibraryDevelopSettingsV2, overlay: Readonly<PhotoDevelopMaskOverlaySelectionV1> | null) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
type Form = Readonly<{ maskId: string; width: string; height: string; mode: 'paint' | 'erase'; radius: string; hardness: string; opacity: string;
	x: string; y: string; bindings: readonly string[]; enabled: Readonly<Record<string, boolean>>; showOverlay: boolean; overlayEffect: string }>;
type Request = Readonly<{ width: number; height: number; reference?: Readonly<BrushMaskResourceReferenceV1>; epoch: number }>;
type Graph = PhotoLibraryDevelopSettingsV2['masks'][number];

export default function PhotoDevelopBrushMaskDialogV1(props: PhotoDevelopBrushMaskDialogPropsV1) {
	const text = photoDevelopBrushMaskCopy(props.locale), words = photoDevelopCopy(props.locale);
	const [form, setForm] = useState<Form>(() => initial(props.develop, '', 256, 256));
	const [request, setRequest] = useState<Request>({ width: 256, height: 256, epoch: 0 }), [failure, setFailure] = useState(false);
	const [lifecycle, setLifecycle] = useState(0);
	const latest = useRef(props); latest.current = props;
	const live = useRef(true), rendered = useRef(form); rendered.current = form;
	const active = useRef<PhotoLibraryBrushMaskAuthoringV1 | null>(null), predecessor = useRef<Promise<void>>(Promise.resolve());
	const canvas = useRef<HTMLCanvasElement | null>(null), paintWork = useRef<Promise<unknown>>(Promise.resolve());
	const drag = useRef<Readonly<{ id: number; stroke: Omit<BrushMaskStrokeV1, 'points'>; points: BrushMaskPointV1[] }> | null>(null);
	const generation = useMemo(() => ({ port: props.port, develop: props.develop, request, lifecycle }), [props.port, props.develop, request, lifecycle]);
	const activeGeneration = useRef(generation); activeGeneration.current = generation;
	const cancellation = useMemo(() => ({ generation, stop: new AbortController() }), [generation]);
	const owner = useMemo(() => new PhotoLibraryBrushMaskAuthoringV1({ port: generation.port, signal: cancellation.stop.signal,
		isCurrent: () => live.current && activeGeneration.current === generation && latest.current.isCurrent() }), [generation, cancellation]);
	active.current = owner;
	const opening = useMemo(() => ({ owner, work: Promise.resolve() }), [owner]);
	const [state, setState] = useState(() => ({ owner, value: owner.snapshot() }));
	const snapshot = state.owner === owner ? state.value : owner.snapshot();
	const retirement = useMemo(() => ({ owner, begun: false }), [owner]);
	const presentationCurrent = () => live.current && latest.current === props && active.current === owner && rendered.current === form
		&& !props.disabled && props.isCurrent();
	const current = () => presentationCurrent() && !retirement.begun && !owner.snapshot().closed;
	const ownerCurrent = useCallback(() => live.current && activeGeneration.current === generation && active.current === owner
		&& !retirement.begun && !owner.snapshot().closed && !latest.current.disabled && latest.current.isCurrent(), [generation, owner, retirement]);
	const interactive = () => { if (!current()) return false; const actual = owner.snapshot(); return actual.ready && !actual.busy && !actual.closed; };
	const retire = useMemo(() => {
		let closing: Promise<void> | null = null;
		return () => { if (closing) return closing;
			let resolve!: () => void, reject!: (error: unknown) => void;
			closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
			// A durable install ACK may arrive while Close joins its delivery.
			// Fence all editing actions before cancellation starts that join.
			retirement.begun = true; drag.current = null;
			const before = predecessor.current, painted = paintWork.current;
			void (async () => {
				const errors: unknown[] = []; try { cancellation.stop.abort(); } catch (error) { errors.push(error); }
				const results = await Promise.allSettled([before, owner.cancelAndJoin(), painted]);
				if (active.current === owner && canvas.current) { canvas.current.width = 0; canvas.current.height = 0; }
				errors.push(...results.flatMap((result, index) => result.status === 'rejected'
					&& !(index === 2 && cancellation.stop.signal.aborted && Object.is(result.reason, cancellation.stop.signal.reason)) ? [result.reason as unknown] : []));
				if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Brush presentation cleanup failed.');
			})().then(resolve, reject); return closing;
		};
	}, [owner, retirement, cancellation]);
	useLayoutEffect(() => {
		let mounted = true; live.current = true;
		const unsubscribe = owner.snapshot().closed ? () => undefined : owner.subscribe(value => { if (mounted) setState({ owner, value }); });
		const unregister = latest.current.registerRetirement?.(retire);
		opening.work = predecessor.current.then(() => {
			if (!mounted) return;
			// Effect replay has already retired this instance. A fresh owner
			// starts only after the whole predecessor retirement has joined.
			if (owner.snapshot().closed) { setLifecycle(value => value + 1); return; }
			return owner.open({ width: generation.request.width, height: generation.request.height,
				...(generation.request.reference === undefined ? {} : { reference: generation.request.reference }) });
		});
		void opening.work.catch(() => { if (mounted && ownerCurrent()) setFailure(true); });
		return () => { mounted = false; drag.current = null; unsubscribe(); predecessor.current = retire(); void predecessor.current.catch(() => undefined); unregister?.(); };
	}, [generation, owner, ownerCurrent, retire, opening]);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	useEffect(() => {
		if (!snapshot.ready || snapshot.closed) return;
		const history = snapshot.history;
		const opened = opening.work;
		const pending = paintWork.current.catch(() => undefined).then(async () => {
			// Ready is published while open still owns the serial operation.
			// Its actual outcome must join before replay acquires that slot.
			await opened;
			if (active.current !== owner || owner.snapshot().closed) return;
			return owner.withDisplay((alpha, view) => {
				if (!ownerCurrent() || owner.snapshot().history !== history || !canvas.current) return;
				const target = canvas.current; target.width = view.width; target.height = view.height;
				const context = typeof target.getContext === 'function' ? target.getContext('2d') : null; if (!context) return;
				const bytes = new Uint8ClampedArray(view.width * view.height * 4), backing = bytes.buffer;
				try { for (let index = 0; index < alpha.length; index++) { bytes[index * 4] = 32; bytes[index * 4 + 1] = 160; bytes[index * 4 + 2] = 255; bytes[index * 4 + 3] = alpha[index]!; }
					context.putImageData(new ImageData(bytes, view.width, view.height), 0, 0);
				} finally { new Uint8ClampedArray(backing).fill(0); }
			});
		}); paintWork.current = pending;
		void pending.catch(() => { if (ownerCurrent()) setFailure(true); });
	}, [owner, ownerCurrent, snapshot.ready, snapshot.closed, snapshot.history, opening]);
	const effects = props.develop.effects.filter(effect => effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1);
	const masks = props.develop.masks.filter(brushGraph);
	const label = (type: string) => { const definition = videoEffectDefinitionV2(type); return words.shared[definition.labelKey] ?? definition.label; };
	const update = (value: Form) => { if (interactive()) { setForm(value); setFailure(false); } };
	const changeMask = (id: string) => {
		if (!interactive() || id !== '' && !masks.some(mask => mask.id === id)) return;
		const reference = id ? normalizeBrushMaskResourceReferenceV1(masks.find(mask => mask.id === id)!.inputs[0]!.sourceRef) : null;
		const width = reference?.width ?? 256, height = reference?.height ?? 256;
		setForm(initial(props.develop, id, width, height)); setFailure(false);
		setRequest({ width, height, ...(reference ? { reference } : {}), epoch: request.epoch + 1 });
	};
	const attempt = (action: () => void) => { if (!interactive()) return; try { action(); setFailure(false); } catch { if (current()) setFailure(true); } };
	const stamp = () => attempt(() => owner.append({ ...brush(form), points: [{ x: fraction(form.x), y: fraction(form.y) }] }));
	const position = (event: PointerEvent<HTMLCanvasElement>) => { const box = event.currentTarget.getBoundingClientRect();
		if (box.width <= 0 || box.height <= 0) throw new RangeError('Brush surface has no extent.');
		return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }; };
	const down = (event: PointerEvent<HTMLCanvasElement>) => {
		if (!interactive() || drag.current || event.button !== 0) return;
		try { drag.current = { id: event.pointerId, stroke: brush(form), points: [position(event)] };
			event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); } catch { drag.current = null; setFailure(true); }
	};
	const move = (event: PointerEvent<HTMLCanvasElement>) => {
		if (!interactive() || drag.current?.id !== event.pointerId) return;
		try { if (drag.current.points.length >= 4095) throw new RangeError('Brush stroke exceeds point capacity.'); drag.current.points.push(position(event)); }
		catch { drag.current = null; setFailure(true); }
	};
	const up = (event: PointerEvent<HTMLCanvasElement>) => {
		const stroke = drag.current; if (!stroke || stroke.id !== event.pointerId) return; drag.current = null;
		attempt(() => owner.append({ ...stroke.stroke, points: [...stroke.points, position(event)] }));
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
	};
	const discard = (event: PointerEvent<HTMLCanvasElement>) => { if (drag.current?.id === event.pointerId) drag.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
	const apply = () => {
		if (!interactive() || drag.current || form.maskId !== '' && !masks.some(mask => mask.id === form.maskId)) return;
		try {
			if (!form.bindings.length || form.bindings.some(id => !effects.some(effect => effect.id === id)) || form.showOverlay && !form.bindings.includes(form.overlayEffect)) throw new RangeError('Invalid brush selection.');
			void owner.install().then(receipt => {
				if (!current()) return;
				const retained = masks.find(mask => mask.id === form.maskId), maskId = retained?.id ?? crypto.randomUUID(), nodeId = retained?.outputNodeId ?? crypto.randomUUID();
				const oldInput = retained?.inputs[0], inputName = oldInput?.name ?? 'paint';
				const retainedNode = retained?.nodes[0], raster = retainedNode?.kind === 'raster';
				const graph = { ...retained, schemaVersion: retained?.schemaVersion ?? 1, id: maskId, kind: retained?.kind ?? 'mask', inputs: [{ name: inputName, kind: raster ? 'raster' : 'alpha', sourceRef: receipt.reference.storageKey }],
					nodes: [raster ? { id: nodeId, kind: 'raster', inputName, channel: 'alpha' } : { id: nodeId, kind: 'alpha', inputName }], outputNodeId: nodeId };
				const value = normalizeImageDevelopStateV1OrV2({ ...props.develop, masks: [...props.develop.masks.filter(mask => mask.id !== maskId), graph],
					maskBindings: [...props.develop.maskBindings.filter(binding => binding.maskId !== maskId && !form.bindings.includes(binding.effectId)), ...form.bindings.map(effectId => ({ effectId, maskId }))],
					effects: props.develop.effects.map(effect => Object.hasOwn(form.enabled, effect.id) ? { ...effect, enabled: form.enabled[effect.id] } : effect) });
				if (current()) Reflect.apply(props.onApply, props, [value, form.showOverlay ? Object.freeze({ maskId, effectId: form.overlayEffect }) : null]);
			}).catch(() => { if (current()) setFailure(true); });
		} catch { if (current()) setFailure(true); }
	};
	const remove = () => { if (!interactive() || !form.maskId || !masks.some(mask => mask.id === form.maskId)) return;
		const value = normalizeImageDevelopStateV1OrV2({ ...props.develop, masks: props.develop.masks.filter(mask => mask.id !== form.maskId), maskBindings: props.develop.maskBindings.filter(binding => binding.maskId !== form.maskId) });
		Reflect.apply(props.onApply, props, [value, null]); };
	const close = () => { if (!current()) return; void retire().then(() => { if (presentationCurrent()) Reflect.apply(props.onClose, props, []); })
		.catch(() => { if (presentationCurrent()) setFailure(true); }); };
	const disabled = props.disabled || !snapshot.ready || snapshot.busy || snapshot.closed;
	const fields = [['radius', text.radius], ['hardness', text.hardness], ['opacity', text.opacity], ['x', text.x], ['y', text.y]] as const;
	return <AudioEditorDialogShell title={text.title} onClose={close} className="lightscaper-dialog lightscaper-brush-mask-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-develop-brush-mask><p>{text.coordinates}</p><p>{text.local}</p>
			<label>{text.mask}<select aria-label={text.mask} value={form.maskId} disabled={disabled} onChange={event => { changeMask(event.currentTarget.value); }}>
				<option value="">{text.newMask}</option>{masks.map(mask => <option key={mask.id} value={mask.id}>{mask.schemaVersion === 2 ? `${mask.name} (${mask.id})` : mask.id}</option>)}</select></label>
			<div className="lightscaper-brush-mask-controls">{(['width', 'height'] as const).map(key => <label key={key}>{text[key]}<input type="number" aria-label={text[key]}
				min={1} max={1024} step={1} value={form[key]} disabled={disabled || form.maskId !== ''} onChange={event => { update({ ...form, [key]: event.currentTarget.value }); }} /></label>)}
				<button type="button" disabled={disabled || form.maskId !== ''} onClick={() => attempt(() => { setRequest({ width: dimension(form.width), height: dimension(form.height), epoch: request.epoch + 1 }); })}>{text.create}</button>
			</div>
			<canvas ref={canvas} role="img" aria-label={text.grid} className="lightscaper-brush-mask-grid" width={request.width} height={request.height}
				data-state={snapshot.ready && !snapshot.busy ? 'ready' : 'pending'} onPointerDown={down} onPointerMove={move} onPointerUp={up}
				onPointerCancel={discard} onLostPointerCapture={discard} />
			<fieldset disabled={disabled}><legend>{text.title}</legend><div className="lightscaper-brush-mask-controls">
				<label>{text.mode}<select aria-label={text.mode} value={form.mode} onChange={event => { const mode = event.currentTarget.value; if (mode === 'paint' || mode === 'erase') update({ ...form, mode }); }}>
					<option value="paint">{text.paint}</option><option value="erase">{text.erase}</option></select></label>
				{fields.map(([key, caption]) => <label key={key}>{caption}<input type="number" min={key === 'radius' ? '0.000001' : '0'} max={1} step="any"
					aria-label={caption} value={form[key]} onChange={event => { update({ ...form, [key]: event.currentTarget.value }); }} /></label>)}
				<button type="button" onClick={stamp}>{text.stamp}</button><button type="button" disabled={snapshot.history.cursor === 0} onClick={() => attempt(() => owner.undo())}>{text.undo}</button>
				<button type="button" disabled={snapshot.history.cursor === snapshot.history.strokes.length} onClick={() => attempt(() => owner.redo())}>{text.redo}</button>
			</div></fieldset><p role="status">{text.strokes}: {snapshot.history.cursor} / {snapshot.history.strokes.length}</p>
			<fieldset disabled={disabled} className="lightscaper-brush-mask-bindings"><legend>{text.bindings}</legend>{effects.length === 0 && <p>{text.noEffects}</p>}
				{effects.map((effect, index) => { const name = `${label(effect.type)} (${index + 1})`; return <div key={effect.id}>
					<label><input type="checkbox" checked={form.bindings.includes(effect.id)} aria-label={`${text.bind}: ${name}`} onChange={event => {
						const bindings = event.currentTarget.checked ? [...form.bindings, effect.id] : form.bindings.filter(id => id !== effect.id); update({ ...form, bindings, overlayEffect: bindings.includes(form.overlayEffect) ? form.overlayEffect : '' }); }} />{name}</label>
					<label><input type="checkbox" checked={form.enabled[effect.id] ?? effect.enabled} aria-label={`${text.effectEnabled}: ${name}`} onChange={event => { update({ ...form, enabled: { ...form.enabled, [effect.id]: event.currentTarget.checked } }); }} />{text.effectEnabled}</label>
				</div>; })}
			</fieldset><label><input type="checkbox" disabled={disabled} checked={form.showOverlay} aria-label={text.showOverlay} onChange={event => { update({ ...form, showOverlay: event.currentTarget.checked }); }} />{text.showOverlay}</label>
			{form.showOverlay && <label>{text.overlayEffect}<select disabled={disabled} aria-label={text.overlayEffect} value={form.overlayEffect} onChange={event => { update({ ...form, overlayEffect: event.currentTarget.value }); }}>
				<option value="">{text.chooseEffect}</option>{effects.filter(effect => form.bindings.includes(effect.id)).map(effect => <option key={effect.id} value={effect.id}>{label(effect.type)} ({effects.indexOf(effect) + 1})</option>)}
			</select></label>}
			{snapshot.busy && <p role="status">{text.working}</p>}{failure && <p role="alert">{text.invalid} {text.failed}</p>}
			{snapshot.receipt?.notices.includes('cleanup-failed') && <p role="status">{text.cleanup}</p>}
			<div className="lightscaper-develop-actions"><button type="button" disabled={disabled || !effects.length} onClick={apply}>{text.apply}</button>
				<button type="button" disabled={disabled || !form.maskId} onClick={remove}>{text.remove}</button><button type="button" onClick={close}>{text.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}
function fraction(value: string): number { const number = value.trim() === '' ? NaN : Number(value);
	if (!Number.isFinite(number) || Object.is(number, -0) || number < 0 || number > 1) throw new RangeError('Invalid brush fraction.'); return number; }
function dimension(value: string): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1 || number > 1024) throw new RangeError('Invalid brush grid.'); return number; }
function brush(form: Form): Omit<BrushMaskStrokeV1, 'points'> { const radius = fraction(form.radius); if (radius === 0) throw new RangeError('Brush radius must be positive.');
	return { mode: form.mode, radius, hardness: fraction(form.hardness), opacity: fraction(form.opacity) }; }
function brushGraph(graph: Graph): boolean {
	const input = graph.inputs[0], node = graph.nodes[0];
	if (graph.inputs.length !== 1 || graph.nodes.length !== 1 || !input || !node || graph.outputNodeId !== node.id
		|| !(node.kind === 'alpha' || node.kind === 'raster' && node.channel === 'alpha') || node.inputName !== input.name || node.kind !== input.kind) return false;
	try { normalizeBrushMaskResourceReferenceV1(input.sourceRef); return true; } catch { return false; }
}
function initial(develop: PhotoLibraryDevelopSettingsV2, maskId: string, width: number, height: number): Form {
	return { maskId, width: String(width), height: String(height), mode: 'paint', radius: '0.05', hardness: '0.8', opacity: '1', x: '0.5', y: '0.5',
		bindings: develop.maskBindings.filter(binding => binding.maskId === maskId).map(binding => binding.effectId), enabled: {}, showOverlay: false, overlayEffect: '' };
}
