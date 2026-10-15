/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageExportSizingV1 } from '../../imaging/image-export-size-v1.ts';
import type { PhotoRasterExportCopy } from './PhotoRasterExportDialog.tsx';
import type { PhotoRasterExportOutput } from '../../../../lightscaper/controller/photo-raster-export.ts';
import { capturePhotoRasterExportOutput } from '../../../../lightscaper/controller/photo-raster-export-contract-v1.ts';
import { capturePhotoRasterExportOutputCurrentV1, type PhotoRasterExportOutputCurrentV1 } from '../../../../lightscaper/controller/photo-raster-export-output-current-v1.ts';
import { photoRasterDepthCopy } from '../../../i18n/lightscaper-photo-raster-depth-copy.ts';
import PhotoTextWatermarkFields, { DEFAULT_IMAGE_EXPORT_TEXT_SELECTION, captureImageExportTextSelection, restoreImageExportTextSelection, type ImageExportTextSelection } from '../PhotoTextWatermarkFields.tsx';

export interface RasterExportSettings {
	readonly kind: ImageExportSizingV1['kind']; readonly width: string; readonly height: string;
	readonly longEdge: string; readonly megapixels: string; readonly percentage: string;
	readonly allowUpscale: boolean; readonly quality: 'nearest' | 'bilinear'; readonly filenameTemplate: string;
	readonly metadataScope: 'strip' | 'capture';
	readonly sharpen: boolean; readonly sharpenAmount: string; readonly sharpenThreshold: string;
	readonly textWatermark: ImageExportTextSelection;
	readonly bitDepth?: 8 | 16;
}
export const DEFAULT_RASTER_EXPORT_SETTINGS: RasterExportSettings = Object.freeze({ kind: 'original', width: '2048', height: '2048',
	longEdge: '2048', megapixels: '8', percentage: '100', allowUpscale: false, quality: 'bilinear', filenameTemplate: '{name}',
	metadataScope: 'strip', sharpen: false, sharpenAmount: '100', sharpenThreshold: '0', textWatermark: DEFAULT_IMAGE_EXPORT_TEXT_SELECTION });

export function rasterExportText(settings: RasterExportSettings) {
	const textWatermark = captureImageExportTextSelection(settings.textWatermark);
	return textWatermark ? { textWatermark } : {};
}

export function rasterExportSizing(settings: RasterExportSettings): ImageExportSizingV1 {
	const allowUpscale = settings.allowUpscale;
	switch (settings.kind) {
		case 'original': return { kind: 'original' };
		case 'fit': return { kind: 'fit', width: Number(settings.width), height: Number(settings.height), allowUpscale };
		case 'long-edge': return { kind: 'long-edge', pixels: Number(settings.longEdge), allowUpscale };
		case 'megapixels': return { kind: 'megapixels', megapixels: Number(settings.megapixels), allowUpscale };
		case 'percentage': return { kind: 'percentage', percentage: Number(settings.percentage) };
	}
}
function outputInput(settings: RasterExportSettings) {
	return { sizing: rasterExportSizing(settings), quality: settings.quality, metadataScope: settings.metadataScope, ...rasterExportText(settings),
		...(settings.sharpen ? { sharpen: { amount: Number(settings.sharpenAmount), threshold: Number(settings.sharpenThreshold) } } : {}) };
}
export function captureRasterExportSettingsOutputV1(settings: RasterExportSettings) { return capturePhotoRasterExportOutput(outputInput(settings)); }
export function captureRasterExportSettingsOutputCurrentV1(settings: RasterExportSettings, format: 'png' | 'jpeg') {
	return capturePhotoRasterExportOutputCurrentV1({ ...outputInput(settings),
		...(settings.bitDepth === undefined ? {} : { schemaVersion: 2, bitDepth: settings.bitDepth }) }, format);
}

/** Present the normalized retained recipe, without changing its output plan.
 * Older journals without output retain the single-owner default semantics. */
export function restoreRasterExportSettings(output: Readonly<PhotoRasterExportOutput> | undefined, filenameTemplate: string): RasterExportSettings {
	const sizing = output?.sizing ?? { kind: 'original' };
	const restored: RasterExportSettings = { ...DEFAULT_RASTER_EXPORT_SETTINGS, kind: sizing.kind, filenameTemplate,
		quality: output?.quality ?? 'bilinear', metadataScope: output?.metadataScope ?? 'strip', sharpen: output?.sharpen !== undefined,
		sharpenAmount: String(output?.sharpen?.amount ?? 100), sharpenThreshold: String(output?.sharpen?.threshold ?? 0), textWatermark: restoreImageExportTextSelection(output?.textWatermark) };
	switch (sizing.kind) {
		case 'original': return Object.freeze(restored);
		case 'fit': return Object.freeze({ ...restored, width: String(sizing.width), height: String(sizing.height), allowUpscale: sizing.allowUpscale });
		case 'long-edge': return Object.freeze({ ...restored, longEdge: String(sizing.pixels), allowUpscale: sizing.allowUpscale });
		case 'megapixels': return Object.freeze({ ...restored, megapixels: String(sizing.megapixels), allowUpscale: sizing.allowUpscale });
		case 'percentage': return Object.freeze({ ...restored, percentage: String(sizing.percentage) });
	}
}
export function restoreRasterExportSettingsCurrentV1(output: Readonly<PhotoRasterExportOutputCurrentV1> | undefined, filenameTemplate: string, format: 'png' | 'jpeg'): RasterExportSettings {
	const captured = output === undefined ? undefined : capturePhotoRasterExportOutputCurrentV1(output, format);
	const depth = captured && 'bitDepth' in captured ? captured.bitDepth : undefined;
	return Object.freeze({ ...restoreRasterExportSettings(captured, filenameTemplate),
		...(depth === 8 || depth === 16 ? { bitDepth: depth } : {}) });
}

export default function PhotoRasterExportSettings({ value, copy, disabled, onChange, locale = 'en', currentFormat }: {
	readonly value: RasterExportSettings; readonly copy: PhotoRasterExportCopy; readonly disabled: boolean;
	readonly onChange: (value: RasterExportSettings) => void;
	readonly locale?: string;
	readonly currentFormat?: 'png' | 'jpeg';
}) {
	const depth = photoRasterDepthCopy(locale);
	const number = (key: 'width' | 'height' | 'longEdge' | 'megapixels' | 'percentage', label: string, selector: string, step = '1') =>
		<label>{label}<input type="number" min={step === '1' ? '1' : '0.000001'} step={step} value={value[key]} disabled={disabled}
			{...{ [`data-photo-raster-export-${selector}`]: true }} onChange={event => onChange({ ...value, [key]: event.target.value })} /></label>;
	return <fieldset disabled={disabled}>
		{currentFormat === 'png' && <label>{depth.label}<select aria-label={depth.label} data-photo-raster-export-bit-depth value={value.bitDepth ?? 8} disabled={disabled}
			onChange={event => { const next = event.target.value; if (next === '8' || next === '16') onChange({ ...value, bitDepth: next === '16' ? 16 : 8 }); }}>
			<option value="8">{depth.eight}</option><option value="16">{depth.sixteen}</option></select></label>}
		<label>{copy.outputSize}<select data-photo-raster-export-sizing value={value.kind} disabled={disabled}
			onChange={event => onChange({ ...value, kind: event.target.value as RasterExportSettings['kind'] })}>
			<option value="original">{copy.originalSize}</option><option value="fit">{copy.fitSize}</option>
			<option value="long-edge">{copy.longEdgeSize}</option><option value="megapixels">{copy.megapixelsSize}</option>
			<option value="percentage">{copy.percentageSize}</option>
		</select></label>
		{value.kind === 'fit' && <>{number('width', copy.width, 'width')}{number('height', copy.height, 'height')}</>}
		{value.kind === 'long-edge' && number('longEdge', copy.pixels, 'long-edge')}
		{value.kind === 'megapixels' && number('megapixels', copy.megapixels, 'megapixels', 'any')}
		{value.kind === 'percentage' && number('percentage', copy.percentage, 'percentage', 'any')}
		{['fit', 'long-edge', 'megapixels'].includes(value.kind) && <label><input type="checkbox" data-photo-raster-export-upscale
			checked={value.allowUpscale} disabled={disabled} onChange={event => onChange({ ...value, allowUpscale: event.target.checked })} />{copy.allowUpscale}</label>}
		{value.kind !== 'original' && <label>{copy.resample}<select data-photo-raster-export-resample value={value.quality} disabled={disabled}
			onChange={event => onChange({ ...value, quality: event.target.value as RasterExportSettings['quality'] })}>
			<option value="nearest">{copy.nearest}</option><option value="bilinear">{copy.bilinear}</option>
		</select></label>}
		<label><input type="checkbox" data-photo-raster-export-sharpen checked={value.sharpen} disabled={disabled}
			onChange={event => onChange({ ...value, sharpen: event.target.checked })} />{copy.outputSharpen}</label>
		{value.sharpen && <>
			<label>{copy.sharpenAmount}<input type="number" data-photo-raster-export-sharpen-amount min="0" max="200" step="any" value={value.sharpenAmount} disabled={disabled}
				onChange={event => onChange({ ...value, sharpenAmount: event.target.value })} /></label>
			<label>{copy.sharpenThreshold}<input type="number" data-photo-raster-export-sharpen-threshold min="0" max="255" step="1" value={value.sharpenThreshold} disabled={disabled}
				onChange={event => onChange({ ...value, sharpenThreshold: event.target.value })} /></label>
		</>}
		<label>{copy.metadata}<select data-photo-raster-export-metadata value={value.metadataScope} disabled={disabled}
			onChange={event => onChange({ ...value, metadataScope: event.target.value as RasterExportSettings['metadataScope'] })}>
			<option value="strip">{copy.stripMetadata}</option><option value="capture">{copy.captureMetadata}</option>
		</select></label>
		<p data-photo-raster-export-metadata-help>{copy.metadataHelp}</p>
		<label>{copy.filenameTemplate}<input type="text" data-photo-raster-export-filename-template value={value.filenameTemplate} maxLength={256}
			disabled={disabled} onChange={event => onChange({ ...value, filenameTemplate: event.target.value })} /></label>
		<p>{copy.filenameHelp}</p>
		<PhotoTextWatermarkFields value={value.textWatermark} locale={locale} disabled={disabled} onChange={textWatermark => { onChange({ ...value, textWatermark }); }} />
	</fieldset>;
}
