/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopMaskManagementCopy } from '../../../i18n/lightscaper-develop-mask-management-copy.ts';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { manageImageDevelopMasksV2, type ImageDevelopMaskManagementCommandV2 } from '../../imaging/image-develop-mask-management-v2.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../imaging/image-develop-state-v2.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 } from '../../video-image-geometry-v1.ts';
import { videoEffectDefinitionV2 } from '../../video-effects-v2.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../photo-library-develop-port-v2.ts';
import type { VideoMaskMatteGraphV1OrV2 } from '../../video-mask-matte-name-v2.ts';
import type { PhotoDevelopMaskOverlaySelectionV1 } from './PhotoDevelopGradientDialogV1.tsx';
import './photo-develop-mask-management.css';

export interface PhotoDevelopMaskManagerPropsV1 {
	readonly develop: PhotoLibraryDevelopSettingsV2;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: PhotoLibraryDevelopSettingsV2, overlay: Readonly<PhotoDevelopMaskOverlaySelectionV1> | null) => void;
	readonly onClose: () => void;
}
type Form = Readonly<{ source: PhotoLibraryDevelopSettingsV2; draft: PhotoLibraryDevelopSettingsV2;
	maskId: string; name: string; nameInvalid: boolean; showOverlay: boolean; overlayEffect: string; invalid: boolean }>;

/** Scalar recipe editing only. Body custody and history belong to the selected
 * Develop owner; this dialog never acquires a mask resource. */
export default function PhotoDevelopMaskManagerV1(props: PhotoDevelopMaskManagerPropsV1) {
	const text = photoDevelopMaskManagementCopy(props.locale), messages = photoDevelopCopy(props.locale);
	const [form, setForm] = useState<Form>(() => initial(props.develop));
	if (form.source !== props.develop) setForm(initial(props.develop));
	const latest = useRef(props); latest.current = props;
	const rendered = useRef(form); rendered.current = form;
	const live = useRef(true);
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const presented = () => live.current && latest.current === props && rendered.current === form && form.source === props.develop && props.isCurrent();
	const current = () => presented() && !props.disabled;
	const update = (next: Form) => { if (current()) { rendered.current = next; setForm(next); } };
	const effects = form.draft.effects.filter(effect => effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1);
	const selected = form.draft.masks.find(mask => mask.id === form.maskId);
	const bindings = form.draft.maskBindings.filter(binding => binding.maskId === form.maskId).map(binding => binding.effectId);
	const label = (type: string) => { const definition = videoEffectDefinitionV2(type); return messages.shared[definition.labelKey] ?? definition.label; };
	const close = () => { if (presented()) { live.current = false; Reflect.apply(props.onClose, props, []); } };
	const edit = (command: ImageDevelopMaskManagementCommandV2) => {
		if (!current()) return;
		try {
			const draft = manageImageDevelopMasksV2(form.draft, command);
			const maskId = command.type === 'duplicate' ? command.duplicateId : command.type === 'remove' ? draft.masks[0]?.id ?? '' : form.maskId;
			const sameSelection = maskId === form.maskId, chosen = draft.maskBindings.some(binding => binding.maskId === maskId && binding.effectId === form.overlayEffect);
			const name = command.type === 'bindings' ? form.name : graphName(draft.masks.find(mask => mask.id === maskId));
			update({ ...form, draft, maskId, name, nameInvalid: false, invalid: false, showOverlay: sameSelection && form.showOverlay,
				overlayEffect: sameSelection && chosen ? form.overlayEffect : '' });
		} catch { update({ ...form, nameInvalid: command.type === 'rename', invalid: command.type !== 'rename' }); }
	};
	const apply = () => {
		if (!current()) return;
		if (form.showOverlay && (!selected || !bindings.includes(form.overlayEffect) || !effects.some(effect => effect.id === form.overlayEffect))) {
			update({ ...form, invalid: true }); return;
		}
		Reflect.apply(props.onApply, props, [form.draft, form.showOverlay ? Object.freeze({ maskId: form.maskId, effectId: form.overlayEffect }) : null]);
	};
	return <AudioEditorDialogShell title={text.title} onClose={close} className="lightscaper-dialog lightscaper-mask-management-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-develop-mask-manager><p>{text.bindingPolicy}</p>
			<label className="lightscaper-mask-management-selection">{text.mask}<select aria-label={text.mask} value={form.maskId} disabled={props.disabled || !selected}
				onChange={event => {
					if (!current()) return; const maskId = event.currentTarget.value;
					const mask = form.draft.masks.find(mask => mask.id === maskId);
					if (mask) update({ ...form, maskId, name: graphName(mask), nameInvalid: false, showOverlay: false, overlayEffect: '', invalid: false });
				}}>
				{form.draft.masks.length === 0 && <option value="">{text.empty}</option>}
				{form.draft.masks.map(mask => <option key={mask.id} value={mask.id}>{graphLabel(mask)}</option>)}
			</select></label>
			{!selected && <p>{text.empty}</p>}
			<label className="lightscaper-mask-management-selection">{text.name}<input type="text" aria-label={text.name} data-photo-develop-mask-name
				maxLength={256} value={form.name} disabled={props.disabled || !selected} onChange={event => {
					if (current() && selected) update({ ...form, name: event.currentTarget.value, nameInvalid: false });
				}} /></label><p>{text.nameHelp}</p>
			<div className="lightscaper-mask-management-operations">
				<button type="button" data-photo-develop-mask-rename disabled={props.disabled || !selected} onClick={() => {
					if (current() && selected) edit({ type: 'rename', maskId: selected.id, name: form.name });
				}}>{text.rename}</button>
				<button type="button" disabled={props.disabled || !selected} onClick={() => {
					if (current() && selected) edit({ type: 'duplicate', maskId: selected.id, duplicateId: crypto.randomUUID() });
				}}>{text.duplicate}</button>
				<button type="button" disabled={props.disabled || !selected} onClick={() => {
					if (current() && selected) edit({ type: 'remove', maskId: selected.id });
				}}>{text.remove}</button>
			</div>
			<fieldset className="lightscaper-mask-management-bindings" disabled={props.disabled || !selected}><legend>{text.bindings}</legend>
				{effects.length === 0 && <p>{text.noEffects}</p>}
				{effects.map((effect, index) => {
					const name = `${label(effect.type)} (${index + 1})`;
					return <label key={effect.id}><input type="checkbox" checked={bindings.includes(effect.id)} data-photo-develop-mask-binding={effect.id}
						aria-label={`${text.bind}: ${name}`} onChange={event => {
							if (!current() || !selected) return;
							const effectIds = bindings.filter(id => id !== effect.id);
							if (event.currentTarget.checked) effectIds.push(effect.id);
							edit({ type: 'bindings', maskId: selected.id, effectIds });
						}} />{name}</label>;
				})}
			</fieldset>
			<label><input type="checkbox" aria-label={text.showOverlay} checked={form.showOverlay} disabled={props.disabled || !selected}
				onChange={event => { if (current() && selected) update({ ...form, showOverlay: event.currentTarget.checked, overlayEffect: '', invalid: false }); }} />{text.showOverlay}</label>
			{form.showOverlay && <label className="lightscaper-mask-management-selection">{text.overlayEffect}<select aria-label={text.overlayEffect}
				value={form.overlayEffect} disabled={props.disabled} onChange={event => {
					if (current()) update({ ...form, overlayEffect: event.currentTarget.value, invalid: false });
				}}><option value="">{text.chooseEffect}</option>{effects.filter(effect => bindings.includes(effect.id)).map(effect =>
					<option key={effect.id} value={effect.id}>{label(effect.type)} ({effects.indexOf(effect) + 1})</option>)}
			</select></label>}
			{form.invalid && <p role="alert">{text.invalid}</p>}
			{form.nameInvalid && <p role="alert">{text.nameInvalid}</p>}
			<div className="lightscaper-develop-actions"><button type="button" disabled={props.disabled} onClick={apply}>{text.apply}</button>
				<button type="button" onClick={close}>{text.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}

function initial(source: PhotoLibraryDevelopSettingsV2): Form {
	const draft = normalizeImageDevelopStateV1OrV2(source);
	return { source, draft, maskId: draft.masks[0]?.id ?? '', name: graphName(draft.masks[0]), nameInvalid: false, showOverlay: false, overlayEffect: '', invalid: false };
}
function graphName(graph: VideoMaskMatteGraphV1OrV2 | undefined): string { return graph?.schemaVersion === 2 ? graph.name : ''; }
function graphLabel(graph: VideoMaskMatteGraphV1OrV2): string { return graph.schemaVersion === 2 ? `${graph.name} (${graph.id})` : graph.id; }
