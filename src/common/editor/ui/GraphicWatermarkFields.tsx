/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useState } from 'react';
import { captureImageExportGraphicRequest, type ImageExportGraphicRequest } from '../image-export-graphic-request.ts';
import { imageExportGraphicCopy } from '../../i18n/image-export-graphic-copy.ts';
import { takeSelectedFile } from './file-input-selection.ts';

interface Selection { readonly enabled: boolean; readonly body: File | null; readonly anchor: ImageExportGraphicRequest['anchor']; readonly width: string; readonly margin: string; readonly opacity: string; }
const DEFAULT = Object.freeze({ enabled: false, body: null, anchor: 'bottom-right' as const, width: '25', margin: '2', opacity: '100' });
const ANCHORS = Object.freeze(['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const);

/** File custody is local to one open export surface, never a project or preset. */
export function useGraphicWatermarkSelection(owner: unknown) {
	const [selection, setSelection] = useState<{ owner: unknown; value: Selection }>({ owner, value: DEFAULT });
	useLayoutEffect(() => { setSelection({ owner, value: DEFAULT }); }, [owner]);
	const value = selection.owner === owner ? selection.value : DEFAULT;
	return { value, onChange: (value: Selection) => { setSelection({ owner, value }); }, capture: (): Readonly<ImageExportGraphicRequest> | undefined => value.enabled
		? captureImageExportGraphicRequest({ body: value.body, anchor: value.anchor, widthFraction: Number(value.width) / 100, marginFraction: Number(value.margin) / 100, opacity: Number(value.opacity) / 100 }) : undefined };
}

export default function GraphicWatermarkFields({ value, onChange, disabled, locale }: {
	readonly value: Selection; readonly onChange: (value: Selection) => void; readonly disabled: boolean; readonly locale: string;
}) {
	const copy = imageExportGraphicCopy(locale);
	return <fieldset disabled={disabled} data-image-export-graphic-fields>
		<label><input type="checkbox" data-image-export-graphic-enabled checked={value.enabled} onChange={event => { onChange({ ...value, enabled: event.currentTarget.checked }); }} />{copy.enabled}</label>
		{value.enabled && <>
			<p>{copy.help}</p>
			<label>{copy.file}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" data-image-export-graphic-file
				onChange={event => { onChange({ ...value, body: takeSelectedFile(event.currentTarget) }); }} /></label>
			{value.body && <p data-image-export-graphic-name>{value.body.name}</p>}
			<label>{copy.anchor}<select data-image-export-graphic-anchor value={value.anchor} onChange={event => { onChange({ ...value, anchor: event.currentTarget.value as Selection['anchor'] }); }}>
				{ANCHORS.map(anchor => <option key={anchor} value={anchor}>{copy[anchor]}</option>)}
			</select></label>
			{(['width', 'margin', 'opacity'] as const).map(key => <label key={key}>{copy[key]}<input type="number" {...{ [`data-image-export-graphic-${key}`]: true }}
				value={value[key]} min={key === 'width' ? 0.01 : 0} max={key === 'margin' ? 49 : 100} step="any" onChange={event => { onChange({ ...value, [key]: event.currentTarget.value }); }} /></label>)}
		</>}
	</fieldset>;
}
