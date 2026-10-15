/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopMaskManagementCopy } from '../../../i18n/lightscaper-develop-mask-management-copy.ts';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import type { ImageDevelopMaskManagementCommandV3 } from '../../imaging/image-develop-mask-management-v3.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import { manageImageDevelopMasksCurrentV1 } from '../../imaging/image-develop-mask-management-current-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 } from '../../video-image-geometry-v1.ts';
import { LENS_DISTORTION_EFFECT_TYPE_V1 } from '../../video-lens-distortion-v1.ts';
import { videoEffectDefinitionV2 } from '../../video-effects-v2.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { VideoMaskMatteGraphV1OrV2 } from '../../video-mask-matte-name-v2.ts';
import type { PhotoDevelopMaskDisplayModeV1 } from '../../photo-develop-mask-display-v1.ts';
import type { PhotoDevelopMaskOverlaySelectionV1 } from './PhotoDevelopGradientDialogV1.tsx';
import './photo-develop-mask-management.css';

export interface PhotoDevelopMaskManagerPropsV1 {
	readonly develop: ImageDevelopStateCurrentV1;
	readonly locale: string;
	readonly disabled?: boolean;
	/** Presentation controls are offered only when the caller can show an overlay. */
	readonly overlayAvailable?: boolean;
	readonly presentation?: ReactNode;
	/** Optional live presentation observes a local draft without publishing it. */
	readonly onPresentationChange?: (value: Readonly<ImageDevelopStateCurrentV1>, overlay: Readonly<PhotoDevelopMaskOverlaySelectionV1> | null) => void;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: ImageDevelopStateCurrentV1, overlay: Readonly<PhotoDevelopMaskOverlaySelectionV1> | null) => void;
	readonly onClose: () => void;
}
type Form = Readonly<{ source: ImageDevelopStateCurrentV1; draft: ImageDevelopStateCurrentV1;
	maskId: string; operandMaskId: string; name: string; nameInvalid: boolean; showOverlay: boolean; overlayEffect: string; displayMode: PhotoDevelopMaskDisplayModeV1; invalid: boolean }>;

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
	const notified = useRef({ source: form.source, draft: form.draft, maskId: '', effectId: '', mode: 'color' });
	if (notified.current.source !== form.source) notified.current = { source: form.source, draft: form.draft, maskId: '', effectId: '', mode: 'color' };
	const presented = () => live.current && latest.current === props && rendered.current === form && form.source === props.develop && props.isCurrent();
	const current = () => presented() && !props.disabled;
	const update = (next: Form) => {
		if (!current()) return;
		const callback = props.onPresentationChange;
		rendered.current = next; setForm(next);
		if (!callback) return;
		const choice = presentationChoice(next, props.overlayAvailable), previous = notified.current;
		const notification = { source: next.source, draft: next.draft, maskId: choice?.maskId ?? '', effectId: choice?.effectId ?? '', mode: choice?.displayMode ?? 'color' };
		notified.current = notification;
		if (previous.source !== notification.source || previous.draft === notification.draft && previous.maskId === notification.maskId && previous.effectId === notification.effectId && previous.mode === notification.mode) return;
		// The update already admitted this exact form/props generation. Publish
		// its scalar presentation before a parent render changes that event fence.
		Reflect.apply(callback, props, [next.draft, choice]);
	};
	const effects = form.draft.effects.filter(effect => effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 && effect.type !== LENS_DISTORTION_EFFECT_TYPE_V1);
	const selected = form.draft.masks.find(mask => mask.id === form.maskId);
	const operands = form.draft.masks.filter(mask => mask.id !== form.maskId);
	const operand = operands.find(mask => mask.id === form.operandMaskId);
	const bindings = form.draft.maskBindings.filter(binding => binding.maskId === form.maskId).map(binding => binding.effectId);
	const label = (type: string) => { const definition = videoEffectDefinitionV2(type); return messages.shared[definition.labelKey] ?? definition.label; };
	const close = () => { if (presented()) { live.current = false; Reflect.apply(props.onClose, props, []); } };
	const edit = (command: ImageDevelopMaskManagementCommandV3) => {
		if (!current()) return;
		try {
			const draft = manageImageDevelopMasksCurrentV1(form.draft, command);
			const maskId = command.type === 'duplicate' ? command.duplicateId : command.type === 'remove' ? draft.masks[0]?.id ?? '' : form.maskId;
			const sameSelection = maskId === form.maskId, chosen = draft.maskBindings.some(binding => binding.maskId === maskId && binding.effectId === form.overlayEffect);
			const name = command.type === 'bindings' || command.type === 'compose' ? form.name : graphName(draft.masks.find(mask => mask.id === maskId));
			const operandMaskId = sameSelection && draft.masks.some(mask => mask.id === form.operandMaskId && mask.id !== maskId) ? form.operandMaskId : '';
			update({ ...form, draft, maskId, operandMaskId, name, nameInvalid: false, invalid: false, showOverlay: sameSelection && form.showOverlay,
				overlayEffect: sameSelection && chosen ? form.overlayEffect : '', displayMode: sameSelection && chosen ? form.displayMode : 'color' });
		} catch { update({ ...form, nameInvalid: command.type === 'rename', invalid: command.type !== 'rename' }); }
	};
	const apply = () => {
		if (!current()) return;
		const showOverlay = props.overlayAvailable !== false && form.showOverlay;
		if (showOverlay && (!selected || !bindings.includes(form.overlayEffect) || !effects.some(effect => effect.id === form.overlayEffect))) {
			update({ ...form, invalid: true }); return;
		}
		Reflect.apply(props.onApply, props, [form.draft, showOverlay ? Object.freeze({ maskId: form.maskId, effectId: form.overlayEffect,
			...(form.displayMode === 'grayscale' ? { displayMode: form.displayMode } : {}) }) : null]);
	};
	return <AudioEditorDialogShell title={text.title} onClose={close} className="lightscaper-dialog lightscaper-mask-management-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-develop-mask-manager><p>{text.bindingPolicy}</p>
			<label className="lightscaper-mask-management-selection">{text.mask}<select aria-label={text.mask} value={form.maskId} disabled={props.disabled || !selected}
				onChange={event => {
					if (!current()) return; const maskId = event.currentTarget.value;
					const mask = form.draft.masks.find(mask => mask.id === maskId);
					if (mask) update({ ...form, maskId, operandMaskId: '', name: graphName(mask), nameInvalid: false, showOverlay: false, overlayEffect: '', displayMode: 'color', invalid: false });
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
			<label className="lightscaper-mask-management-selection">{text.operand}<select aria-label={text.operand} data-photo-develop-mask-operand
				value={form.operandMaskId} disabled={props.disabled || !selected || operands.length === 0} onChange={event => {
					if (!current() || !selected) return; const operandMaskId = event.currentTarget.value;
					if (operandMaskId === '' || operands.some(mask => mask.id === operandMaskId)) update({ ...form, operandMaskId, invalid: false });
				}}><option value="">{text.chooseOperand}</option>{operands.map(mask => <option key={mask.id} value={mask.id}>{graphLabel(mask)}</option>)}</select></label>
			<p>{text.compositionHelp}</p><div className="lightscaper-mask-management-operations">
				{([['union', text.add], ['subtract', text.subtract], ['intersect', text.intersect]] as const).map(([operation, caption]) =>
					<button key={operation} type="button" data-photo-develop-mask-compose={operation} disabled={props.disabled || !selected || !operand}
						onClick={() => { if (current() && selected && operand) edit({ type: 'compose', maskId: selected.id, operandMaskId: operand.id, operation }); }}>{caption}</button>)}
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
			{props.overlayAvailable !== false && <label><input type="checkbox" aria-label={text.showOverlay} checked={form.showOverlay} disabled={props.disabled || !selected}
				onChange={event => { if (current() && selected && props.overlayAvailable !== false) update({ ...form, showOverlay: event.currentTarget.checked, overlayEffect: '', displayMode: 'color', invalid: false }); }} />{text.showOverlay}</label>}
			{props.overlayAvailable !== false && form.showOverlay && <label className="lightscaper-mask-management-selection">{text.displayMode}<select aria-label={text.displayMode}
				value={form.displayMode} disabled={props.disabled} onChange={event => {
					if (!current()) return; const displayMode = event.currentTarget.value;
					if (displayMode === 'color' || displayMode === 'grayscale') update({ ...form, displayMode, invalid: false });
				}}><option value="color">{text.color}</option><option value="grayscale">{text.grayscale}</option></select></label>}
			{props.overlayAvailable !== false && form.showOverlay && <label className="lightscaper-mask-management-selection">{text.overlayEffect}<select aria-label={text.overlayEffect}
				value={form.overlayEffect} disabled={props.disabled} onChange={event => {
					if (current()) update({ ...form, overlayEffect: event.currentTarget.value, invalid: false });
				}}><option value="">{text.chooseEffect}</option>{effects.filter(effect => bindings.includes(effect.id)).map(effect =>
					<option key={effect.id} value={effect.id}>{label(effect.type)} ({effects.indexOf(effect) + 1})</option>)}
			</select></label>}
			{form.invalid && <p role="alert">{text.invalid}</p>}
			{form.nameInvalid && <p role="alert">{text.nameInvalid}</p>}
			{props.presentation}
			<div className="lightscaper-develop-actions"><button type="button" disabled={props.disabled} onClick={apply}>{text.apply}</button>
				<button type="button" onClick={close}>{text.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}

function initial(source: ImageDevelopStateCurrentV1): Form {
	const draft = normalizeImageDevelopStateCurrentV1(source);
	return { source, draft, maskId: draft.masks[0]?.id ?? '', operandMaskId: '', name: graphName(draft.masks[0]), nameInvalid: false, showOverlay: false, overlayEffect: '', displayMode: 'color', invalid: false };
}
function graphName(graph: VideoMaskMatteGraphV1OrV2 | undefined): string { return graph?.schemaVersion === 2 ? graph.name : ''; }
function graphLabel(graph: VideoMaskMatteGraphV1OrV2): string { return graph.schemaVersion === 2 ? `${graph.name} (${graph.id})` : graph.id; }
function presentationChoice(form: Form, available?: boolean): Readonly<PhotoDevelopMaskOverlaySelectionV1> | null {
	if (available === false || !form.showOverlay || !form.draft.masks.some(mask => mask.id === form.maskId)
		|| !form.draft.maskBindings.some(binding => binding.maskId === form.maskId && binding.effectId === form.overlayEffect)
		|| !form.draft.effects.some(effect => effect.id === form.overlayEffect && effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 && effect.type !== LENS_DISTORTION_EFFECT_TYPE_V1)) return null;
	return Object.freeze({ maskId: form.maskId, effectId: form.overlayEffect, ...(form.displayMode === 'grayscale' ? { displayMode: form.displayMode } : {}) });
}
