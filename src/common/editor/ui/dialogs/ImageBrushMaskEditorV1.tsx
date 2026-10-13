/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopBrushMaskCopy } from '../../../i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { ImageBrushMaskAuthoringV1, type ImageBrushMaskAuthoringOptionsV1, type ImageBrushMaskAuthoringOwnerV1 } from '../../controller/shared/image-brush-mask-authoring-v1.ts';
import type { ImageBrushMaskResourceAcknowledgementV1, ImageBrushMaskResourcePortV1, WithImageBrushMaskDraftFrameV1 } from '../../image-brush-mask-resource-port-v1.ts';
import { ImageDevelopDraftPresentationV1, type ImageDevelopDraftFrameRequestV1, type ImageDevelopDraftPresentationSnapshotV1, type WithImageDevelopDraftFrameV1 } from '../../controller/shared/image-develop-draft-presentation-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../../imaging/image-develop-frame-core.ts';
import PhotoDevelopMaskOverlayV1 from '../lightscaper/PhotoDevelopMaskOverlayV1.tsx';
import { photoDevelopMaskManagementCopy } from '../../../i18n/lightscaper-develop-mask-management-copy.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import { normalizeBrushMaskResourceReferenceV1, withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../../imaging/brush-mask-resource-v1.ts';
import { replaceImageDevelopLocalMasksCurrentV1 } from '../../imaging/image-develop-mask-management-current-v1.ts';
import type { BrushMaskPointV1, BrushMaskStrokeV1 } from '../../imaging/brush-mask-plane-v1.ts';
import { videoEffectDefinitionV2 } from '../../video-effects-v2.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 } from '../../video-image-geometry-v1.ts';
import type { PhotoDevelopMaskOverlaySelectionV1 } from '../lightscaper/PhotoDevelopGradientDialogV1.tsx';
import { paintPixelFrameCanvasV1, clearPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';
import '../lightscaper/photo-develop-brush-mask.css';

export interface ImageBrushMaskEditorPropsV1<Receipt extends ImageBrushMaskResourceAcknowledgementV1> {
	readonly port: Readonly<ImageBrushMaskResourcePortV1<Receipt>>;
	readonly develop: ImageDevelopStateCurrentV1;
	readonly prepareAcknowledgement: ImageBrushMaskAuthoringOptionsV1<Receipt>['prepareAcknowledgement'];
	readonly createAuthoring?: (options: ImageBrushMaskAuthoringOptionsV1<Receipt>) => ImageBrushMaskAuthoringOwnerV1<Receipt>;
	readonly withBrushDraftFrame?: WithImageBrushMaskDraftFrameV1;
	readonly messages?: Readonly<Record<keyof ReturnType<typeof photoDevelopBrushMaskCopy>, string>>;
	/** Product-neutral dismissal after joined settlement, including failure. */
	readonly onJoinedClose?: () => void;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: ImageDevelopStateCurrentV1, overlay: Readonly<PhotoDevelopMaskOverlaySelectionV1> | null) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
type Form = Readonly<{ maskId: string; width: string; height: string; mode: 'paint' | 'erase'; radius: string; hardness: string; opacity: string;
	x: string; y: string; bindings: readonly string[]; enabled: Readonly<Record<string, boolean>>; showOverlay: boolean; overlayEffect: string; displayMode: 'color' | 'grayscale' }>;
type Request = Readonly<{ width: number; height: number; reference?: Readonly<BrushMaskResourceReferenceV1>; epoch: number }>;
type Graph = ImageDevelopStateCurrentV1['masks'][number];
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

export default function ImageBrushMaskEditorV1<Receipt extends ImageBrushMaskResourceAcknowledgementV1>(props: ImageBrushMaskEditorPropsV1<Receipt>) {
	const text = props.messages ?? photoDevelopBrushMaskCopy(props.locale), words = photoDevelopCopy(props.locale), maskWords = photoDevelopMaskManagementCopy(props.locale);
	const [form, setForm] = useState<Form>(() => initial(props.develop, '', 256, 256));
	const [request, setRequest] = useState<Request>({ width: 256, height: 256, epoch: 0 }), [failure, setFailure] = useState(false);
	const [lifecycle, setLifecycle] = useState(0), [finishing, setFinishing] = useState(false);
	const finalizing = useRef(false), rememberedFailure = useRef<Readonly<{ value: unknown }> | null>(null);
	const latest = useRef(props); latest.current = props;
	const live = useRef(true), rendered = useRef(form); rendered.current = form;
	const active = useRef<ImageBrushMaskAuthoringOwnerV1<Receipt> | null>(null), predecessor = useRef<Promise<void>>(Promise.resolve());
	const canvas = useRef<HTMLCanvasElement | null>(null), paintWork = useRef<Promise<unknown>>(Promise.resolve());
	const drag = useRef<Readonly<{ id: number; stroke: Omit<BrushMaskStrokeV1, 'points'>; points: BrushMaskPointV1[] }> | null>(null);
	const generation = useMemo(() => ({ port: props.port, develop: props.develop, request, lifecycle, renderer: props.withBrushDraftFrame,
		factory: props.createAuthoring, prepare: props.prepareAcknowledgement }), [props.port, props.develop, request, lifecycle, props.withBrushDraftFrame, props.createAuthoring, props.prepareAcknowledgement]);
	const activeGeneration = useRef(generation); activeGeneration.current = generation;
	const cancellation = useMemo(() => ({ generation, stop: new AbortController() }), [generation]);
	const owner = useMemo(() => {
		const receiver = latest.current;
		const options: ImageBrushMaskAuthoringOptionsV1<Receipt> = { port: generation.port, signal: cancellation.stop.signal,
			prepareAcknowledgement: (value, reference) => Reflect.apply(generation.prepare, receiver, [value, reference]) as Readonly<Receipt>,
			isCurrent: () => live.current && activeGeneration.current === generation && Reflect.apply(latest.current.isCurrent, latest.current, []) === true };
		return generation.factory ? Reflect.apply(generation.factory, receiver, [options]) as ImageBrushMaskAuthoringOwnerV1<Receipt> : new ImageBrushMaskAuthoringV1(options);
	}, [generation, cancellation]);
	active.current = owner;
	const opening = useMemo(() => ({ owner, work: Promise.resolve() }), [owner]);
	const [state, setState] = useState(() => ({ owner, value: owner.snapshot() }));
	const snapshot = state.owner === owner ? state.value : owner.snapshot();
	const retirement = useMemo(() => ({ owner, begun: false }), [owner]);
	const gridTarget = useMemo(() => ({ owner, value: null as HTMLCanvasElement | null }), [owner]);
	const presented = () => live.current && latest.current === props && active.current === owner && rendered.current === form;
	const presentationCurrent = () => presented() && !props.disabled && props.isCurrent();
	const current = () => presentationCurrent() && !retirement.begun && !owner.snapshot().closed && !finalizing.current;
	const ownerCurrent = useCallback(() => live.current && activeGeneration.current === generation && active.current === owner
		&& !retirement.begun && !owner.snapshot().closed && !latest.current.disabled && latest.current.isCurrent(), [generation, owner, retirement]);
	const interactive = () => { if (!current()) return false; const actual = owner.snapshot(); return actual.ready && !actual.busy && !actual.closed; };
	const identities = useMemo(() => ({ maskId: form.maskId || crypto.randomUUID(), nodeId: generation.develop.masks.find(mask => mask.id === form.maskId)?.outputNodeId ?? crypto.randomUUID() }), [generation, form.maskId]);
	const after = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null);
	const selected = useRef({ form, identities }); selected.current = { form, identities };
	const preview = useMemo(() => {
		const renderer = generation.renderer, receiver = latest.current; if (!renderer) return null;
		const withDraftFrame: WithImageDevelopDraftFrameV1 = async <Result,>(request: Readonly<ImageDevelopDraftFrameRequestV1>, consume: (value: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> => {
			const choice = selected.current, history = owner.snapshot().history, grid = canvas.current;
			await opening.work;
			if (!ownerCurrent() || !grid || owner.snapshot().history !== history) throw new Error('The brush presentation changed.');
			return owner.withDisplay((alpha, view) => {
				gridTarget.value = grid;
				paintGrid(grid, alpha, view.width, view.height, options?.signal, true);
				return withPreparedBrushMaskResourceV1({ width: view.width, height: view.height, alpha, signal: options?.signal }, prepared => {
					const develop = authoredRecipe(generation.develop, choice.form, prepared.reference, choice.identities);
					return Reflect.apply(renderer, receiver, [{ develop, reference: prepared.reference, bytes: prepared.bytes,
						...(request.maskOverlay ? { maskOverlay: request.maskOverlay } : {}) }, consume, options]) as Promise<Result>;
				});
			});
		};
		return new ImageDevelopDraftPresentationV1({ withDraftFrame, isCurrent: ownerCurrent, beforePresent: predecessor.current });
	}, [generation, owner, ownerCurrent, opening, gridTarget]);
	const [previewState, setPreviewState] = useState<{ owner: ImageDevelopDraftPresentationV1 | null; value: ImageDevelopDraftPresentationSnapshotV1 }>({ owner: null, value: { status: 'idle', extent: null, error: null } });
	const previewSnapshot = previewState.owner === preview ? previewState.value : { status: 'idle' as const, extent: null, error: null };
	const selectedOverlay = form.showOverlay && form.bindings.includes(form.overlayEffect) ? { maskId: identities.maskId, effectId: form.overlayEffect } : null;
	useLayoutEffect(() => {
		if (!preview) return;
		return preview.subscribe(value => { if (active.current === owner) setPreviewState({ owner: preview, value }); });
	}, [preview, owner]);
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
				const errors: unknown[] = [];
				// Join display's cancellation before aborting its enclosing alpha
				// owner, so clean retirement retains one actual cancellation reason.
				if (preview) try { await preview.close(); } catch (error) { errors.push(error); }
				try { cancellation.stop.abort(); } catch (error) { errors.push(error); }
				const results = await Promise.allSettled([before, owner.cancelAndJoin(), painted]);
				try { const target = gridTarget.value; gridTarget.value = null;
					if (target) { if (preview) clearPixelFrameCanvasV1(target); else { target.width = 0; target.height = 0; } } } catch (error) { errors.push(error); }
				errors.push(...results.flatMap((result, index) => result.status === 'rejected'
					&& !(index === 2 && cancellation.stop.signal.aborted && Object.is(result.reason, cancellation.stop.signal.reason)) ? [result.reason as unknown] : []));
				if (preview && rememberedFailure.current && !errors.some(error => Object.is(error, rememberedFailure.current!.value))) errors.push(rememberedFailure.current.value);
				if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Brush presentation cleanup failed.');
			})().then(resolve, reject); return closing;
		};
	}, [owner, retirement, cancellation, preview, gridTarget]);
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
		if (preview) return;
		const history = snapshot.history;
		const opened = opening.work;
		const pending = paintWork.current.catch(() => undefined).then(async () => {
			// Ready is published while open still owns the serial operation.
			// Its actual outcome must join before replay acquires that slot.
			await opened;
			if (active.current !== owner || owner.snapshot().closed) return;
			return owner.withDisplay((alpha, view) => {
				if (!ownerCurrent() || owner.snapshot().history !== history || !canvas.current) return;
				gridTarget.value = canvas.current;
				paintGrid(canvas.current, alpha, view.width, view.height, cancellation.stop.signal, false);
			});
		}); paintWork.current = pending;
		void pending.catch(() => { if (ownerCurrent()) setFailure(true); });
	}, [owner, ownerCurrent, snapshot.ready, snapshot.closed, snapshot.history, opening, preview, cancellation, gridTarget]);
	useEffect(() => {
		if (!preview || !snapshot.ready || snapshot.closed || retirement.begun || finalizing.current || !after.current) return;
		const choice = form.showOverlay && form.bindings.includes(form.overlayEffect) ? { maskId: identities.maskId, effectId: form.overlayEffect } : null;
		try { preview.setView({ develop: generation.develop, after: after.current,
			...(choice && overlay.current ? { overlay: overlay.current, maskOverlay: choice, maskOverlayMode: form.displayMode } : {}) }); }
		catch (error) { rememberedFailure.current = { value: error }; setFailure(true); }
	}, [preview, generation, snapshot.ready, snapshot.closed, snapshot.history, retirement, form.bindings, form.enabled, form.showOverlay, form.overlayEffect, form.displayMode, identities]);
	useLayoutEffect(() => {
		if (!preview || retirement.begun || ownerCurrent()) return;
		if (preview.snapshot().status !== 'idle') void preview.pause().catch((error: unknown) => { rememberedFailure.current = { value: error }; setFailure(true); });
		if (canvas.current) try { clearPixelFrameCanvasV1(canvas.current); } catch (error) { rememberedFailure.current = { value: error }; }
	});
	const effects = props.develop.effects.filter(effect => effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1);
	const masks = props.develop.masks.filter(brushGraph);
	const label = (type: string) => { const definition = videoEffectDefinitionV2(type); return words.shared[definition.labelKey] ?? definition.label; };
	const update = (value: Form) => { if (generation.renderer ? current() : interactive()) { rendered.current = value; setForm(value); setFailure(false); } };
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
	const finalize = (produce: () => Promise<Readonly<ImageDevelopStateCurrentV1>>) => {
		if (!preview || !current() || finalizing.current || preview.snapshot().status === 'failed') return;
		const receiver = props, callback = props.onApply; finalizing.current = true; setFinishing(true);
		void (async () => {
			await preview.pause();
			if (!presentationCurrent() || retirement.begun) return;
			const value = await produce();
			if (!presentationCurrent() || retirement.begun) return;
			await retire();
			if (presentationCurrent()) Reflect.apply(callback, receiver, [value, null]);
		})().catch((error: unknown) => {
			rememberedFailure.current = { value: error };
			if (presented()) { setFailure(true); setFinishing(false); }
		});
	};
	const apply = () => {
		if (!(preview ? current() && snapshot.ready : interactive()) || drag.current || form.maskId !== '' && !masks.some(mask => mask.id === form.maskId)) return;
		try {
			if (!form.bindings.length || form.bindings.some(id => !effects.some(effect => effect.id === id)) || form.showOverlay && !form.bindings.includes(form.overlayEffect)) throw new RangeError('Invalid brush selection.');
			if (preview) { finalize(async () => { const receipt = await owner.install(); return authoredRecipe(props.develop, form, receipt.reference, identities); }); return; }
			void owner.install().then(receipt => {
				if (!current()) return;
				const retained = masks.find(mask => mask.id === form.maskId), maskId = retained?.id ?? crypto.randomUUID(), nodeId = retained?.outputNodeId ?? crypto.randomUUID();
				const oldInput = retained?.inputs[0], inputName = oldInput?.name ?? 'paint';
				const retainedNode = retained?.nodes[0], raster = retainedNode?.kind === 'raster';
				const graph = { ...retained, schemaVersion: retained?.schemaVersion ?? 1, id: maskId, kind: retained?.kind ?? 'mask', inputs: [{ name: inputName, kind: raster ? 'raster' : 'alpha', sourceRef: receipt.reference.storageKey }],
					nodes: [raster ? { id: nodeId, kind: 'raster', inputName, channel: 'alpha' } : { id: nodeId, kind: 'alpha', inputName }], outputNodeId: nodeId };
				const value = replaceImageDevelopLocalMasksCurrentV1(props.develop, { masks: [...props.develop.masks.filter(mask => mask.id !== maskId), graph],
					maskBindings: [...props.develop.maskBindings.filter(binding => binding.maskId !== maskId && !form.bindings.includes(binding.effectId)), ...form.bindings.map(effectId => ({ effectId, maskId }))],
					effects: props.develop.effects.map(effect => Object.hasOwn(form.enabled, effect.id) ? { ...effect, enabled: form.enabled[effect.id] } : effect) });
				if (current()) Reflect.apply(props.onApply, props, [value, form.showOverlay ? Object.freeze({ maskId, effectId: form.overlayEffect }) : null]);
			}).catch(() => { if (current()) setFailure(true); });
		} catch { if (current()) setFailure(true); }
	};
	const remove = () => { if (!(preview ? current() : interactive()) || !form.maskId || !masks.some(mask => mask.id === form.maskId)) return;
		const value = replaceImageDevelopLocalMasksCurrentV1(props.develop, { effects: props.develop.effects, masks: props.develop.masks.filter(mask => mask.id !== form.maskId), maskBindings: props.develop.maskBindings.filter(binding => binding.maskId !== form.maskId) });
		if (preview) { finalize(() => Promise.resolve(value)); return; }
		Reflect.apply(props.onApply, props, [value, null]); };
	const close = () => {
		if (props.onJoinedClose) {
			if (!presented() || retirement.begun) return;
			finalizing.current = true; setFinishing(true);
			const dismiss = () => {
				if (!live.current || active.current !== owner || activeGeneration.current !== generation) return;
				const receiver = latest.current, callback = receiver.onJoinedClose;
				if (typeof callback === 'function') Reflect.apply(callback, receiver, []);
			};
			void retire().then(dismiss, (error: unknown) => { rememberedFailure.current = { value: error }; setFailure(true); dismiss(); }); return;
		}
		if (!current()) return; void retire().then(() => { if (presentationCurrent()) Reflect.apply(props.onClose, props, []); })
			.catch(() => { if (presentationCurrent()) setFailure(true); });
	};
	const disabled = props.disabled || !snapshot.ready || snapshot.busy || snapshot.closed || finishing || Boolean(preview && !props.isCurrent());
	const choicesDisabled = preview ? props.disabled || !snapshot.ready || snapshot.closed || finishing || previewSnapshot.status === 'failed' || !props.isCurrent() : disabled;
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
				data-image-brush-mask-grid data-state={snapshot.ready && !snapshot.busy && (!preview || previewSnapshot.status === 'ready') ? 'ready' : 'pending'} onPointerDown={down} onPointerMove={move} onPointerUp={up}
				onPointerCancel={discard} onLostPointerCapture={discard} />
			<fieldset disabled={disabled}><legend>{text.title}</legend><div className="lightscaper-brush-mask-controls">
				<label>{text.mode}<select aria-label={text.mode} value={form.mode} onChange={event => { const mode = event.currentTarget.value; if (mode === 'paint' || mode === 'erase') update({ ...form, mode }); }}>
					<option value="paint">{text.paint}</option><option value="erase">{text.erase}</option></select></label>
				{fields.map(([key, caption]) => <label key={key}>{caption}<input type="number" min={key === 'radius' ? '0.000001' : '0'} max={1} step="any"
					aria-label={caption} value={form[key]} onChange={event => { update({ ...form, [key]: event.currentTarget.value }); }} /></label>)}
				<button type="button" onClick={stamp}>{text.stamp}</button><button type="button" disabled={snapshot.history.cursor === 0} onClick={() => attempt(() => owner.undo())}>{text.undo}</button>
				<button type="button" disabled={snapshot.history.cursor === snapshot.history.strokes.length} onClick={() => attempt(() => owner.redo())}>{text.redo}</button>
			</div></fieldset><p role="status">{text.strokes}: {snapshot.history.cursor} / {snapshot.history.strokes.length}</p>
			<fieldset disabled={choicesDisabled} className="lightscaper-brush-mask-bindings"><legend>{text.bindings}</legend>{effects.length === 0 && <p>{text.noEffects}</p>}
				{effects.map((effect, index) => { const name = `${label(effect.type)} (${index + 1})`; return <div key={effect.id}>
					<label><input type="checkbox" checked={form.bindings.includes(effect.id)} aria-label={`${text.bind}: ${name}`} onChange={event => {
						const bindings = event.currentTarget.checked ? [...form.bindings, effect.id] : form.bindings.filter(id => id !== effect.id); update({ ...form, bindings, overlayEffect: bindings.includes(form.overlayEffect) ? form.overlayEffect : '' }); }} />{name}</label>
					<label><input type="checkbox" checked={form.enabled[effect.id] ?? effect.enabled} aria-label={`${text.effectEnabled}: ${name}`} onChange={event => { update({ ...form, enabled: { ...form.enabled, [effect.id]: event.currentTarget.checked } }); }} />{text.effectEnabled}</label>
				</div>; })}
			</fieldset><label><input type="checkbox" disabled={choicesDisabled} checked={form.showOverlay} aria-label={text.showOverlay} onChange={event => { update({ ...form, showOverlay: event.currentTarget.checked, displayMode: 'color' }); }} />{text.showOverlay}</label>
			{form.showOverlay && <label>{text.overlayEffect}<select disabled={choicesDisabled} aria-label={text.overlayEffect} value={form.overlayEffect} onChange={event => { update({ ...form, overlayEffect: event.currentTarget.value }); }}>
				<option value="">{text.chooseEffect}</option>{effects.filter(effect => form.bindings.includes(effect.id)).map(effect => <option key={effect.id} value={effect.id}>{label(effect.type)} ({effects.indexOf(effect) + 1})</option>)}
			</select></label>}
			{preview && form.showOverlay && <label>{maskWords.displayMode}<select aria-label={maskWords.displayMode} disabled={choicesDisabled} value={form.displayMode} onChange={event => {
				const displayMode = event.currentTarget.value; if (displayMode === 'color' || displayMode === 'grayscale') update({ ...form, displayMode });
			}}><option value="color">{maskWords.color}</option><option value="grayscale">{maskWords.grayscale}</option></select></label>}
			{preview && <div data-frame-image-brush-preview data-frame-image-develop-preview data-state={previewSnapshot.status}>
				<div className="frame-image-develop-plane" style={{ aspectRatio: previewSnapshot.extent ? `${previewSnapshot.extent.width} / ${previewSnapshot.extent.height}` : undefined }}>
					<canvas ref={after} width={0} height={0} role="img" aria-label={words.after} data-frame-image-brush-after data-state={previewSnapshot.status} hidden={previewSnapshot.status !== 'ready' || finishing} />
					<PhotoDevelopMaskOverlayV1 canvasRef={overlay} locale={props.locale} displayMode={form.displayMode} state={selectedOverlay && !finishing ? previewSnapshot.status : 'idle'} />
				</div>{previewSnapshot.status === 'failed' && <p role="alert">{previewSnapshot.error ?? text.failed}</p>}
			</div>}
			{snapshot.busy && <p role="status">{text.working}</p>}{failure && <p role="alert">{text.invalid} {text.failed}</p>}
			{snapshot.receipt?.notices.includes('cleanup-failed') && <p role="status">{text.cleanup}</p>}
			<div className="lightscaper-develop-actions"><button type="button" disabled={choicesDisabled || !effects.length} onClick={apply}>{text.apply}</button>
				<button type="button" disabled={choicesDisabled || !form.maskId} onClick={remove}>{text.remove}</button><button type="button" onClick={close}>{text.close}</button></div>
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
function initial(develop: ImageDevelopStateCurrentV1, maskId: string, width: number, height: number): Form {
	return { maskId, width: String(width), height: String(height), mode: 'paint', radius: '0.05', hardness: '0.8', opacity: '1', x: '0.5', y: '0.5',
		bindings: develop.maskBindings.filter(binding => binding.maskId === maskId).map(binding => binding.effectId), enabled: {}, showOverlay: false, overlayEffect: '', displayMode: 'color' };
}

function authoredRecipe(develop: ImageDevelopStateCurrentV1, form: Form, reference: Readonly<BrushMaskResourceReferenceV1>, identities: Readonly<{ maskId: string; nodeId: string }>): Readonly<ImageDevelopStateCurrentV1> {
	const retained = develop.masks.find(mask => mask.id === form.maskId), { maskId, nodeId } = identities;
	const inputName = retained?.inputs[0]?.name ?? 'paint', raster = retained?.nodes[0]?.kind === 'raster';
	const graph = { ...retained, schemaVersion: retained?.schemaVersion ?? 1, id: maskId, kind: retained?.kind ?? 'mask',
		inputs: [{ name: inputName, kind: raster ? 'raster' : 'alpha', sourceRef: reference.storageKey }],
		nodes: [raster ? { id: nodeId, kind: 'raster', inputName, channel: 'alpha' } : { id: nodeId, kind: 'alpha', inputName }], outputNodeId: nodeId };
	return replaceImageDevelopLocalMasksCurrentV1(develop, { masks: [...develop.masks.filter(mask => mask.id !== maskId), graph],
		maskBindings: [...develop.maskBindings.filter(binding => binding.maskId !== maskId && !form.bindings.includes(binding.effectId)), ...form.bindings.map(effectId => ({ effectId, maskId }))],
		effects: develop.effects.map(effect => Object.hasOwn(form.enabled, effect.id) ? { ...effect, enabled: form.enabled[effect.id] } : effect) });
}
function paintGrid(target: HTMLCanvasElement, alpha: Uint8Array<ArrayBuffer>, width: number, height: number, signal: AbortSignal | undefined, qualified: boolean): void {
	const bytes = new Uint8ClampedArray(width * height * 4), backing = bytes.buffer;
	let operation: Readonly<{ error: unknown }> | null = null, cleanup: Readonly<{ error: unknown }> | null = null;
	try {
		for (let index = 0; index < alpha.length; index++) { bytes[index * 4] = 32; bytes[index * 4 + 1] = 160; bytes[index * 4 + 2] = 255; bytes[index * 4 + 3] = alpha[index]!; }
		if (qualified) {
			paintPixelFrameCanvasV1(target, { descriptor: { schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(backing) },
				{ signal, limits: { maximumSidePixels: 1024, maximumPixels: 1_048_576, maximumBytes: 4_194_304 } });
		} else {
			target.width = width; target.height = height; const context = typeof target.getContext === 'function' ? target.getContext('2d') : null;
			context?.putImageData(new ImageData(bytes, width, height), 0, 0);
		}
	} catch (error) { operation = { error }; }
	try {
		if (Number(Reflect.apply(BUFFER_SIZE, backing, [])) !== width * height * 4) throw new TypeError('Brush grid backing changed before physical retirement.');
		new Uint8ClampedArray(backing).fill(0);
	} catch (error) { cleanup = { error }; }
	if (operation) { if (cleanup && !Object.is(operation.error, cleanup.error)) throw new AggregateError([operation.error, cleanup.error], 'Brush grid presentation and physical retirement failed.', { cause: operation.error }); throw operation.error; }
	if (cleanup) throw cleanup.error;
}
