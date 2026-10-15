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
import type { PhotoDevelopMaskOverlaySelectionV1 } from './PhotoDevelopGradientDialogV1.tsx';

export interface PhotoDevelopRangeMaskDialogPropsV1 {
	readonly kind?: 'luminance-range' | 'color-range';
	readonly develop: ImageDevelopStateCurrentV1;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: ImageDevelopStateCurrentV1, overlay: Readonly<PhotoDevelopMaskOverlaySelectionV1> | null) => void;
	readonly onClose: () => void;
}
type Kind = NonNullable<PhotoDevelopRangeMaskDialogPropsV1['kind']>;
type CommonForm = Readonly<{ maskId: string; falloff: string; bindings: readonly string[];
	enabled: Readonly<Record<string, boolean>>; showOverlay: boolean; overlayEffect: string }>;
type Form = CommonForm & (Readonly<{ kind: 'luminance-range'; lower: string; upper: string }>
	| Readonly<{ kind: 'color-range'; red: string; green: string; blue: string; radius: string }>);

export default function PhotoDevelopRangeMaskDialogV1(props: PhotoDevelopRangeMaskDialogPropsV1) {
	const kind = props.kind ?? 'luminance-range', text = photoDevelopLocalAdjustmentsCopy(props.locale, kind), messages = photoDevelopCopy(props.locale);
	const [form, setForm] = useState<Form>(() => initial(props.develop, '', kind)), [error, setError] = useState(false);
	const latest = useRef(props); latest.current = props;
	const rendered = useRef(form); rendered.current = form;
	const live = useRef(true);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const presented = () => live.current && latest.current === props && rendered.current === form && !props.disabled && props.isCurrent();
	const current = () => presented() && form.kind === kind;
	const update = (next: Form) => { if (current()) { setForm(next); setError(false); } };
	const effects = props.develop.effects.filter(effect => effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 && effect.type !== LENS_DISTORTION_EFFECT_TYPE_V1);
	const ranges = props.develop.masks.filter(mask => mask.inputs.length === 0 && mask.nodes.length === 1
		&& mask.nodes[0]?.kind === kind && mask.nodes[0].id === mask.outputNodeId);
	const label = (type: string) => { const definition = videoEffectDefinitionV2(type); return messages.shared[definition.labelKey] ?? definition.label; };
	const close = () => { if (live.current && latest.current === props && props.isCurrent()) Reflect.apply(props.onClose, props, []); };
	const apply = () => {
		if (!current() || form.maskId !== '' && !ranges.some(mask => mask.id === form.maskId)) return;
		try {
			if (form.bindings.length === 0 || form.bindings.some(id => !effects.some(effect => effect.id === id))
				|| form.showOverlay && !form.bindings.includes(form.overlayEffect)) throw new RangeError('Invalid range selection.');
			const falloff = fraction(form.falloff);
			const retained = ranges.find(mask => mask.id === form.maskId), maskId = retained?.id ?? crypto.randomUUID(), nodeId = retained?.outputNodeId ?? crypto.randomUUID();
			const node = form.kind === 'color-range' ? { id: nodeId, kind: form.kind,
				color: { r: fraction(form.red), g: fraction(form.green), b: fraction(form.blue) }, radius: fraction(form.radius), falloff }
				: { id: nodeId, kind: form.kind, lower: fraction(form.lower), upper: fraction(form.upper), falloff };
			const graph = { ...retained, schemaVersion: retained?.schemaVersion ?? 1, id: maskId, kind: retained?.kind ?? 'mask', inputs: [],
				nodes: [node], outputNodeId: nodeId };
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
		if (!current() || !form.maskId || !ranges.some(mask => mask.id === form.maskId)) return;
		const value = replaceImageDevelopLocalMasksCurrentV1(props.develop, { effects: props.develop.effects, masks: props.develop.masks.filter(mask => mask.id !== form.maskId),
			maskBindings: props.develop.maskBindings.filter(binding => binding.maskId !== form.maskId) });
		Reflect.apply(props.onApply, props, [value, null]);
	};
	const fields = form.kind === 'color-range'
		? [['red', text.red, form.red], ['green', text.green, form.green], ['blue', text.blue, form.blue], ['radius', text.radius, form.radius], ['falloff', text.falloff, form.falloff]] as const
		: [['lower', text.lower, form.lower], ['upper', text.upper, form.upper], ['falloff', text.falloff, form.falloff]] as const;
	return <AudioEditorDialogShell title={text.title} onClose={close} className="lightscaper-dialog lightscaper-develop-local-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-develop-range-mask={kind}><p>{text.coordinates}</p><p>{text.bindingPolicy}</p>
			<label>{text.gradient}<select value={form.maskId} disabled={props.disabled} aria-label={text.gradient} onChange={event => {
				const id = event.currentTarget.value;
				if (presented() && (id === '' || ranges.some(mask => mask.id === id))) { setForm(initial(props.develop, id, kind)); setError(false); }
			}}><option value="">{text.newGradient}</option>{ranges.map(mask => <option key={mask.id} value={mask.id}>{mask.schemaVersion === 2 ? `${mask.name} (${mask.id})` : mask.id}</option>)}</select></label>
			<fieldset disabled={props.disabled}><legend>{text.title}</legend>
				{fields.map(([key, caption, value]) => <label key={key}>{caption}<input type="number" min={0} max={1} step="any"
					value={value} aria-label={caption} onChange={event => { update({ ...form, [key]: event.currentTarget.value }); }} /></label>)}
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
function fraction(value: string): number {
	const number = value.trim() === '' ? NaN : Number(value);
	if (!Number.isFinite(number) || Object.is(number, -0) || number < 0 || number > 1) throw new RangeError('Invalid range fraction.'); return number;
}
function initial(develop: ImageDevelopStateCurrentV1, maskId: string, kind: Kind): Form {
	const node = develop.masks.find(value => value.id === maskId)?.nodes[0];
	const common = { maskId, bindings: develop.maskBindings.filter(binding => binding.maskId === maskId).map(binding => binding.effectId),
		enabled: {}, showOverlay: false, overlayEffect: '' };
	if (kind === 'color-range') {
		const range = node?.kind === kind ? node : null;
		return { ...common, kind, red: String(range?.color.r ?? 1), green: String(range?.color.g ?? 0), blue: String(range?.color.b ?? 0),
			radius: String(range?.radius ?? 0.1), falloff: String(range?.falloff ?? 0.1) };
	}
	const range = node?.kind === kind ? node : null;
	return { ...common, kind, lower: String(range?.lower ?? 0), upper: String(range?.upper ?? 1), falloff: String(range?.falloff ?? 0) };
}
