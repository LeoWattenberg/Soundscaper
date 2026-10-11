/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopLocalAdjustmentsCopy } from '../../../i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../imaging/image-develop-state-v2.ts';
import { videoEffectDefinitionV2 } from '../../video-effects-v2.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 } from '../../video-image-geometry-v1.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../photo-library-develop-port-v2.ts';
import type { PhotoDevelopMaskOverlaySelectionV1 } from './PhotoDevelopGradientDialogV1.tsx';

export interface PhotoDevelopRangeMaskDialogPropsV1 {
	readonly develop: PhotoLibraryDevelopSettingsV2;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: PhotoLibraryDevelopSettingsV2, overlay: Readonly<PhotoDevelopMaskOverlaySelectionV1> | null) => void;
	readonly onClose: () => void;
}
type Form = Readonly<{ maskId: string; lower: string; upper: string; falloff: string; bindings: readonly string[];
	enabled: Readonly<Record<string, boolean>>; showOverlay: boolean; overlayEffect: string }>;

export default function PhotoDevelopRangeMaskDialogV1(props: PhotoDevelopRangeMaskDialogPropsV1) {
	const text = photoDevelopLocalAdjustmentsCopy(props.locale, 'luminance-range'), messages = photoDevelopCopy(props.locale);
	const [form, setForm] = useState<Form>(() => initial(props.develop, '')), [error, setError] = useState(false);
	const latest = useRef(props); latest.current = props;
	const rendered = useRef(form); rendered.current = form;
	const live = useRef(true);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const current = () => live.current && latest.current === props && rendered.current === form && !props.disabled && props.isCurrent();
	const update = (next: Form) => { if (current()) { setForm(next); setError(false); } };
	const effects = props.develop.effects.filter(effect => effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1);
	const ranges = props.develop.masks.filter(mask => mask.inputs.length === 0 && mask.nodes.length === 1
		&& mask.nodes[0]?.kind === 'luminance-range' && mask.nodes[0].id === mask.outputNodeId);
	const label = (type: string) => { const definition = videoEffectDefinitionV2(type); return messages.shared[definition.labelKey] ?? definition.label; };
	const close = () => { if (live.current && latest.current === props && props.isCurrent()) Reflect.apply(props.onClose, props, []); };
	const apply = () => {
		if (!current() || form.maskId !== '' && !ranges.some(mask => mask.id === form.maskId)) return;
		try {
			if (form.bindings.length === 0 || form.bindings.some(id => !effects.some(effect => effect.id === id))
				|| form.showOverlay && !form.bindings.includes(form.overlayEffect)) throw new RangeError('Invalid range selection.');
			const lower = fraction(form.lower), upper = fraction(form.upper), falloff = fraction(form.falloff);
			if (lower > upper) throw new RangeError('Invalid luminance interval.');
			const retained = ranges.find(mask => mask.id === form.maskId), maskId = retained?.id ?? crypto.randomUUID(), nodeId = retained?.outputNodeId ?? crypto.randomUUID();
			const graph = { schemaVersion: 1, id: maskId, kind: retained?.kind ?? 'mask', inputs: [],
				nodes: [{ id: nodeId, kind: 'luminance-range', lower, upper, falloff }], outputNodeId: nodeId };
			const value = normalizeImageDevelopStateV1OrV2({ ...props.develop,
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
		const value = normalizeImageDevelopStateV1OrV2({ ...props.develop, masks: props.develop.masks.filter(mask => mask.id !== form.maskId),
			maskBindings: props.develop.maskBindings.filter(binding => binding.maskId !== form.maskId) });
		Reflect.apply(props.onApply, props, [value, null]);
	};
	return <AudioEditorDialogShell title={text.title} onClose={close} className="lightscaper-dialog lightscaper-develop-local-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-develop-range-mask><p>{text.coordinates}</p><p>{text.bindingPolicy}</p>
			<label>{text.gradient}<select value={form.maskId} disabled={props.disabled} aria-label={text.gradient} onChange={event => {
				const id = event.currentTarget.value;
				if (current() && (id === '' || ranges.some(mask => mask.id === id))) { setForm(initial(props.develop, id)); setError(false); }
			}}><option value="">{text.newGradient}</option>{ranges.map(mask => <option key={mask.id} value={mask.id}>{mask.id}</option>)}</select></label>
			<fieldset disabled={props.disabled}><legend>{text.title}</legend>
				{(['lower', 'upper', 'falloff'] as const).map(key => <label key={key}>{text[key]}<input type="number" min={0} max={1} step="any"
					value={form[key]} aria-label={text[key]} onChange={event => { update({ ...form, [key]: event.currentTarget.value }); }} /></label>)}
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
	if (!Number.isFinite(number) || Object.is(number, -0) || number < 0 || number > 1) throw new RangeError('Invalid luminance threshold.'); return number;
}
function initial(develop: PhotoLibraryDevelopSettingsV2, maskId: string): Form {
	const mask = develop.masks.find(value => value.id === maskId), node = mask?.nodes[0], range = node?.kind === 'luminance-range' ? node : null;
	return { maskId, lower: String(range?.lower ?? 0), upper: String(range?.upper ?? 1), falloff: String(range?.falloff ?? 0),
		bindings: develop.maskBindings.filter(binding => binding.maskId === maskId).map(binding => binding.effectId), enabled: {}, showOverlay: false, overlayEffect: '' };
}
