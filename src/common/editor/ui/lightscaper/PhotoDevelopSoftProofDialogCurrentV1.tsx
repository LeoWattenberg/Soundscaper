/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopSoftProofCopy } from '../../../i18n/lightscaper-develop-soft-proof-copy.ts';
import { prepareImageOutputSoftProofCurrentV1, type ImageOutputSoftProofCurrentV1 } from '../../imaging/image-output-soft-proof-current-v1.ts';
import { qualifyPixelFrameDisplayP3CurrentV1 } from '../../imaging/pixel-frame-canvas-presenter-profile-current-v1.ts';

export interface PhotoDevelopSoftProofDialogPropsCurrentV1 {
	readonly value?: Readonly<ImageOutputSoftProofCurrentV1>;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: Readonly<ImageOutputSoftProofCurrentV1> | undefined) => void;
	readonly onClose: () => void;
}
/** Temporary presentation selection only; no recipe or persistence owner. */
export default function PhotoDevelopSoftProofDialogCurrentV1(props: PhotoDevelopSoftProofDialogPropsCurrentV1) {
	const text = photoDevelopSoftProofCopy(props.locale), latest = useRef(props); latest.current = props;
	const live = useRef(false);
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const [selection, setSelection] = useState<{ profile: 'off' | ImageOutputSoftProofCurrentV1['profile']; bitDepth: 8 | 16 }>(() => {
		const value = props.value === undefined ? undefined : prepareImageOutputSoftProofCurrentV1(props.value);
		return { profile: value?.profile ?? 'off', bitDepth: value?.bitDepth ?? 8 };
	});
	const [failed, setFailed] = useState(false);
	const current = () => live.current && latest.current === props && props.isCurrent();
	const apply = () => {
		if (!current() || props.disabled) return;
		let value: Readonly<ImageOutputSoftProofCurrentV1> | undefined;
		try {
			value = selection.profile === 'off' ? undefined : prepareImageOutputSoftProofCurrentV1(selection);
			if (value?.profile === 'display-p3') qualifyPixelFrameDisplayP3CurrentV1();
		} catch { if (current()) setFailed(true); return; }
		if (current() && !props.disabled) Reflect.apply(props.onApply, props, [value]);
	};
	const close = () => { if (current()) Reflect.apply(props.onClose, props, []); };
	return <AudioEditorDialogShell title={text.title} onClose={close} className="lightscaper-dialog lightscaper-soft-proof-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<p>{text.help}</p>
		<label>{text.profile}<select aria-label={text.profile} data-photo-develop-soft-proof-profile value={selection.profile} disabled={props.disabled}
			onChange={event => { const profile = event.currentTarget.value;
				if (current() && !props.disabled && (profile === 'off' || profile === 'srgb' || profile === 'display-p3')) { setSelection({ ...selection, profile }); setFailed(false); }
			}}><option value="off">{text.off}</option><option value="srgb">{text.srgb}</option><option value="display-p3">{text.displayP3}</option></select></label>
		<label>{text.depth}<select aria-label={text.depth} data-photo-develop-soft-proof-depth value={selection.bitDepth} disabled={props.disabled || selection.profile === 'off'}
			onChange={event => { const depth = event.currentTarget.value;
				if (current() && !props.disabled && (depth === '8' || depth === '16')) { setSelection({ ...selection, bitDepth: depth === '16' ? 16 : 8 }); setFailed(false); }
			}}><option value="8">{text.eight}</option><option value="16">{text.sixteen}</option></select></label>
		{failed && <p role="alert">{text.unavailable}</p>}
		<div className="lightscaper-develop-actions"><button type="button" data-photo-develop-soft-proof-apply disabled={props.disabled} onClick={apply}>{text.apply}</button>
			<button type="button" onClick={close}>{text.close}</button></div>
	</AudioEditorDialogShell>;
}
