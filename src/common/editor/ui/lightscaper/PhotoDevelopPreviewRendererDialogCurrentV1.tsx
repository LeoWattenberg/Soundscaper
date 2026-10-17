/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopPreviewRendererCopy } from '../../../i18n/lightscaper-develop-preview-renderer-copy.ts';
import { preparePhotoDevelopPreviewRendererCurrentV1, type PhotoDevelopPreviewRendererCurrentV1 } from '../../photo-library-develop-gpu-preview-port-current-v1.ts';

interface Props {
	readonly value: PhotoDevelopPreviewRendererCurrentV1;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: PhotoDevelopPreviewRendererCurrentV1) => void;
	readonly onClose: () => void;
}
/** Native jobs belong to the existing presenter. This opt-in form retains no pixels. */
export default function PhotoDevelopPreviewRendererDialogCurrentV1(props: Props) {
	const text = photoDevelopPreviewRendererCopy(props.locale), latest = useRef(props); latest.current = props;
	const live = useRef(false); useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const [value, setValue] = useState(() => preparePhotoDevelopPreviewRendererCurrentV1(props.value));
	const current = () => live.current && latest.current === props && props.isCurrent();
	return <AudioEditorDialogShell title={text.title} onClose={() => { if (current()) Reflect.apply(props.onClose, props, []); }}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<p>{text.help}</p><label>{text.renderer}<select aria-label={text.renderer} data-photo-develop-preview-renderer value={value} disabled={props.disabled}
			onChange={event => { const next = event.currentTarget.value;
				if (current() && !props.disabled && (next === 'cpu' || next === 'gpu-preferred')) setValue(preparePhotoDevelopPreviewRendererCurrentV1(next)); }}>
			<option value="cpu">{text.cpu}</option><option value="gpu-preferred">{text.gpu}</option>
		</select></label>
		<button type="button" data-photo-develop-preview-renderer-apply disabled={props.disabled}
			onClick={() => { if (current() && !props.disabled) Reflect.apply(props.onApply, props, [value]); }}>{text.apply}</button>
		<button type="button" onClick={() => { if (current()) Reflect.apply(props.onClose, props, []); }}>{text.close}</button>
	</AudioEditorDialogShell>;
}
