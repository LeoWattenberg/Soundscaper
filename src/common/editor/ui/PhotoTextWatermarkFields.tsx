/* SPDX-License-Identifier: AGPL-3.0-only */

import { captureImageExportTextV1, type ImageExportTextV1 } from '../image-export-text-v1.ts';
import { imageExportTextCopy } from '../../i18n/image-export-text-copy.ts';

export interface ImageExportTextSelection {
	readonly enabled: boolean; readonly text: string; readonly color: string; readonly anchor: ImageExportTextV1['anchor'];
	readonly width: string; readonly margin: string; readonly opacity: string;
}
export const DEFAULT_IMAGE_EXPORT_TEXT_SELECTION: ImageExportTextSelection = Object.freeze({ enabled: false, text: '', color: '#ffffff',
	anchor: 'bottom-right', width: '25', margin: '2', opacity: '100' });
const ANCHORS = Object.freeze(['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const);

export function captureImageExportTextSelection(value: ImageExportTextSelection): Readonly<ImageExportTextV1> | undefined {
	return value.enabled ? captureImageExportTextV1({ schemaVersion: 1, text: value.text, font: 'inter-600-latin', color: value.color, anchor: value.anchor,
		widthFraction: Number(value.width) / 100, marginFraction: Number(value.margin) / 100, opacity: Number(value.opacity) / 100 }) : undefined;
}
export function restoreImageExportTextSelection(text: Readonly<ImageExportTextV1> | undefined): ImageExportTextSelection {
	return text ? Object.freeze({ enabled: true, text: text.text, color: text.color, anchor: text.anchor,
		width: String(text.widthFraction * 100), margin: String(text.marginFraction * 100), opacity: String(text.opacity * 100) }) : DEFAULT_IMAGE_EXPORT_TEXT_SELECTION;
}

/** Scalar delivery settings only. No font/canvas is acquired by presentation. */
export default function PhotoTextWatermarkFields({ value, onChange, disabled, locale }: {
	readonly value: ImageExportTextSelection; readonly onChange: (value: ImageExportTextSelection) => void;
	readonly disabled: boolean; readonly locale: string;
}) {
	const copy = imageExportTextCopy(locale);
	return <fieldset disabled={disabled} data-image-export-text-fields>
		<label><input type="checkbox" data-image-export-text-enabled checked={value.enabled}
			onChange={event => { onChange({ ...value, enabled: event.currentTarget.checked }); }} />{copy.enabled}</label>
		{value.enabled && <>
			<p>{copy.help}</p>
			<label>{copy.text}<input type="text" data-image-export-text-value maxLength={256} value={value.text}
				onChange={event => { onChange({ ...value, text: event.currentTarget.value }); }} /></label>
			<label>{copy.color}<input type="color" data-image-export-text-color value={value.color}
				onChange={event => { onChange({ ...value, color: event.currentTarget.value }); }} /></label>
			<label>{copy.anchor}<select data-image-export-text-anchor value={value.anchor}
				onChange={event => { onChange({ ...value, anchor: event.currentTarget.value as ImageExportTextV1['anchor'] }); }}>
				{ANCHORS.map(anchor => <option key={anchor} value={anchor}>{copy[anchor]}</option>)}
			</select></label>
			{(['width', 'margin', 'opacity'] as const).map(key => <label key={key}>{copy[key]}<input type="number" {...{ [`data-image-export-text-${key}`]: true }}
				value={value[key]} min={key === 'width' ? 0.01 : 0} max={key === 'margin' ? 49 : 100} step="any"
				onChange={event => { onChange({ ...value, [key]: event.currentTarget.value }); }} /></label>)}
		</>}
	</fieldset>;
}
