/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopLocalAdjustmentsCopy } from '../../../i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { replaceImageDevelopLocalMasksCurrentV1 } from '../../imaging/image-develop-mask-management-current-v1.ts';
import { videoEffectDefinitionV2 } from '../../video-effects-v2.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 } from '../../video-image-geometry-v1.ts';
import { LENS_DISTORTION_EFFECT_TYPE_V1 } from '../../video-lens-distortion-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { PhotoDevelopMaskDisplaySelectionV1 } from '../../photo-develop-mask-display-v1.ts';

export type PhotoDevelopMaskOverlaySelectionV1 = PhotoDevelopMaskDisplaySelectionV1;
export interface PhotoDevelopGradientDialogPropsV1 {
	readonly kind?: 'linear-gradient' | 'radial-gradient';
	readonly develop: ImageDevelopStateCurrentV1;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: ImageDevelopStateCurrentV1, overlay: Readonly<PhotoDevelopMaskOverlaySelectionV1> | null) => void;
	readonly onClose: () => void;
}
type Kind = NonNullable<PhotoDevelopGradientDialogPropsV1['kind']>;
type CommonForm = Readonly<{ maskId: string; bindings: readonly string[]; enabled: Readonly<Record<string, boolean>>; showOverlay: boolean; overlayEffect: string }>;
type Form = CommonForm & (Readonly<{ kind: 'linear-gradient'; startX: string; startY: string; endX: string; endY: string }>
	| Readonly<{ kind: 'radial-gradient'; centerX: string; centerY: string; radiusX: string; radiusY: string; innerFraction: string }>);

export default function PhotoDevelopGradientDialogV1(props: PhotoDevelopGradientDialogPropsV1) {
	const kind = props.kind ?? 'linear-gradient', text = photoDevelopLocalAdjustmentsCopy(props.locale, kind), messages = photoDevelopCopy(props.locale);
	const [form, setForm] = useState<Form>(() => initial(props.develop, '', kind)), [error, setError] = useState(false);
	const latest = useRef(props); latest.current = props;
	const rendered = useRef(form); rendered.current = form;
	const live = useRef(true);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const current = () => live.current && latest.current === props && rendered.current === form && form.kind === kind && !props.disabled && props.isCurrent();
	const update = (next: Form) => { if (current()) { setForm(next); setError(false); } };
	const effects = props.develop.effects.filter(effect => effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 && effect.type !== LENS_DISTORTION_EFFECT_TYPE_V1);
	const gradients = props.develop.masks.filter(mask => mask.inputs.length === 0 && mask.nodes.length === 1 && mask.nodes[0]?.kind === kind);
	const label = (type: string) => { const definition = videoEffectDefinitionV2(type); return messages.shared[definition.labelKey] ?? definition.label; };
	const close = () => { if (live.current && latest.current === props && props.isCurrent()) Reflect.apply(props.onClose, props, []); };
	const apply = () => {
		if (!current() || form.maskId !== '' && !gradients.some(mask => mask.id === form.maskId)) return;
		try {
			if (form.bindings.length === 0
				|| form.bindings.some(id => !effects.some(effect => effect.id === id))
				|| form.showOverlay && !form.bindings.includes(form.overlayEffect)) throw new RangeError('Invalid gradient selection.');
			const retained = gradients.find(mask => mask.id === form.maskId), maskId = retained?.id ?? crypto.randomUUID(), nodeId = retained?.outputNodeId ?? crypto.randomUUID();
			const node = form.kind === 'linear-gradient' ? { id: nodeId, kind: form.kind,
				start: { x: coordinate(form.startX), y: coordinate(form.startY) }, end: { x: coordinate(form.endX), y: coordinate(form.endY) } }
				: { id: nodeId, kind: form.kind, center: { x: coordinate(form.centerX), y: coordinate(form.centerY) },
					radius: { x: positiveCoordinate(form.radiusX), y: positiveCoordinate(form.radiusY) }, innerFraction: fraction(form.innerFraction) };
			const graph = { ...retained, schemaVersion: retained?.schemaVersion ?? 1, id: maskId, kind: retained?.kind ?? 'mask', inputs: [], nodes: [node], outputNodeId: nodeId };
			const value = replaceImageDevelopLocalMasksCurrentV1(props.develop, {
				masks: [...props.develop.masks.filter(mask => mask.id !== maskId), graph],
				maskBindings: [...props.develop.maskBindings.filter(binding => binding.maskId !== maskId && !form.bindings.includes(binding.effectId)),
					...form.bindings.map(effectId => ({ effectId, maskId }))],
				effects: props.develop.effects.map(effect => Object.hasOwn(form.enabled, effect.id) ? { ...effect, enabled: form.enabled[effect.id] } : effect) });
			if (!current()) return;
			Reflect.apply(props.onApply, props, [value, form.showOverlay ? Object.freeze({ maskId, effectId: form.overlayEffect }) : null]);
		} catch { if (current()) setError(true); }
	};
	const remove = () => {
		if (!current() || !form.maskId || !gradients.some(mask => mask.id === form.maskId)) return;
		const value = replaceImageDevelopLocalMasksCurrentV1(props.develop, { effects: props.develop.effects, masks: props.develop.masks.filter(mask => mask.id !== form.maskId),
			maskBindings: props.develop.maskBindings.filter(binding => binding.maskId !== form.maskId) });
		Reflect.apply(props.onApply, props, [value, null]);
	};
	const fields = form.kind === 'linear-gradient'
		? [['startX', text.startX, form.startX, -1_000_000, 1_000_000], ['startY', text.startY, form.startY, -1_000_000, 1_000_000],
			['endX', text.endX, form.endX, -1_000_000, 1_000_000], ['endY', text.endY, form.endY, -1_000_000, 1_000_000]] as const
		: [['centerX', text.centerX, form.centerX, -1_000_000, 1_000_000], ['centerY', text.centerY, form.centerY, -1_000_000, 1_000_000],
			['radiusX', text.radiusX, form.radiusX, Number.MIN_VALUE, 1_000_000], ['radiusY', text.radiusY, form.radiusY, Number.MIN_VALUE, 1_000_000],
			['innerFraction', text.innerFraction, form.innerFraction, 0, 1]] as const;
	return <AudioEditorDialogShell title={text.title} onClose={close} className="lightscaper-dialog lightscaper-develop-local-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-develop-gradient={kind} data-photo-develop-linear-gradient={kind === 'linear-gradient' ? true : undefined}
			data-photo-develop-radial-gradient={kind === 'radial-gradient' ? true : undefined}><p>{text.coordinates}</p><p>{text.bindingPolicy}</p>
			<label>{text.gradient}<select value={form.maskId} disabled={props.disabled} aria-label={text.gradient} onChange={event => {
				const id = event.currentTarget.value;
				if (current() && (id === '' || gradients.some(mask => mask.id === id))) { setForm(initial(props.develop, id, kind)); setError(false); }
			}}><option value="">{text.newGradient}</option>{gradients.map(mask => <option key={mask.id} value={mask.id}>{mask.schemaVersion === 2 ? `${mask.name} (${mask.id})` : mask.id}</option>)}</select></label>
			<fieldset disabled={props.disabled}><legend>{text.title}</legend>
				{fields.map(([key, caption, value, minimum, maximum]) => <label key={key}>{caption}<input type="number" min={minimum} max={maximum}
					step="any" value={value} aria-label={caption} onChange={event => { update({ ...form, [key]: event.currentTarget.value }); }} /></label>)}
			</fieldset>
			<fieldset disabled={props.disabled}><legend>{text.bindings}</legend>{effects.length === 0 && <p>{text.noEffects}</p>}
				{effects.map((effect, index) => { const name = `${label(effect.type)} (${index + 1})`; return <div key={effect.id}>
					<label><input type="checkbox" checked={form.bindings.includes(effect.id)} aria-label={`${text.bind}: ${name}`} onChange={event => {
						const bindings = event.currentTarget.checked ? [...form.bindings, effect.id] : form.bindings.filter(id => id !== effect.id);
						update({ ...form, bindings, overlayEffect: bindings.includes(form.overlayEffect) ? form.overlayEffect : '' });
					}} />{name}</label>
					<label><input type="checkbox" checked={form.enabled[effect.id] ?? effect.enabled} aria-label={`${text.effectEnabled}: ${name}`}
						onChange={event => { update({ ...form, enabled: { ...form.enabled, [effect.id]: event.currentTarget.checked } }); }} />{text.effectEnabled}</label>
				</div>; })}
			</fieldset>
			<label><input type="checkbox" checked={form.showOverlay} disabled={props.disabled} aria-label={text.showOverlay}
				onChange={event => { update({ ...form, showOverlay: event.currentTarget.checked }); }} />{text.showOverlay}</label>
			{form.showOverlay && <label>{text.overlayEffect}<select value={form.overlayEffect} disabled={props.disabled} aria-label={text.overlayEffect}
				onChange={event => { update({ ...form, overlayEffect: event.currentTarget.value }); }}>
				<option value="">{text.chooseEffect}</option>{effects.filter(effect => form.bindings.includes(effect.id)).map(effect =>
					<option key={effect.id} value={effect.id}>{label(effect.type)} ({effects.indexOf(effect) + 1})</option>)}
			</select></label>}
			{error && <p role="alert">{text.invalid}</p>}
			<div className="lightscaper-develop-actions"><button type="button" disabled={props.disabled || effects.length === 0} onClick={apply}>{text.apply}</button>
				<button type="button" disabled={props.disabled || !form.maskId} onClick={remove}>{text.remove}</button><button type="button" onClick={close}>{text.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}
function coordinate(value: string): number {
	const number = value.trim() === '' ? NaN : Number(value);
	if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) throw new RangeError('Invalid gradient coordinate.'); return number;
}
function positiveCoordinate(value: string): number {
	const number = coordinate(value); if (number <= 0) throw new RangeError('Invalid gradient radius.'); return number;
}
function fraction(value: string): number {
	const number = coordinate(value); if (number < 0 || number >= 1) throw new RangeError('Invalid gradient falloff.'); return number;
}
function initial(develop: ImageDevelopStateCurrentV1, maskId: string, kind: Kind): Form {
	const mask = develop.masks.find(value => value.id === maskId), node = mask?.nodes[0];
	const common = { maskId, bindings: develop.maskBindings.filter(binding => binding.maskId === maskId).map(binding => binding.effectId), enabled: {}, showOverlay: false, overlayEffect: '' };
	if (kind === 'radial-gradient') {
		const gradient = node?.kind === kind ? node : null;
		return { ...common, kind, centerX: String(gradient?.center.x ?? 0.5), centerY: String(gradient?.center.y ?? 0.5), radiusX: String(gradient?.radius.x ?? 0.5),
			radiusY: String(gradient?.radius.y ?? 0.5), innerFraction: String(gradient?.innerFraction ?? 0) };
	}
	const gradient = node?.kind === kind ? node : null;
	return { ...common, kind, startX: String(gradient?.start.x ?? 0), startY: String(gradient?.start.y ?? 0), endX: String(gradient?.end.x ?? 1), endY: String(gradient?.end.y ?? 0) };
}
