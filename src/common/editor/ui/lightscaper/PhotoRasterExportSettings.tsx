/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageExportSizingV1 } from '../../imaging/image-export-size-v1.ts';
import type { PhotoRasterExportCopy } from './PhotoRasterExportDialog.tsx';

export interface RasterExportSettings {
	readonly kind: ImageExportSizingV1['kind']; readonly width: string; readonly height: string;
	readonly longEdge: string; readonly megapixels: string; readonly percentage: string;
	readonly allowUpscale: boolean; readonly quality: 'nearest' | 'bilinear'; readonly filenameTemplate: string;
	readonly metadataScope: 'strip' | 'capture';
	readonly sharpen: boolean; readonly sharpenAmount: string; readonly sharpenThreshold: string;
}
export const DEFAULT_RASTER_EXPORT_SETTINGS: RasterExportSettings = Object.freeze({ kind: 'original', width: '2048', height: '2048',
	longEdge: '2048', megapixels: '8', percentage: '100', allowUpscale: false, quality: 'bilinear', filenameTemplate: '{name}',
	metadataScope: 'strip', sharpen: false, sharpenAmount: '100', sharpenThreshold: '0' });

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

export default function PhotoRasterExportSettings({ value, copy, disabled, onChange }: {
	readonly value: RasterExportSettings; readonly copy: PhotoRasterExportCopy; readonly disabled: boolean;
	readonly onChange: (value: RasterExportSettings) => void;
}) {
	const number = (key: 'width' | 'height' | 'longEdge' | 'megapixels' | 'percentage', label: string, selector: string, step = '1') =>
		<label>{label}<input type="number" min={step === '1' ? '1' : '0.000001'} step={step} value={value[key]} disabled={disabled}
			{...{ [`data-photo-raster-export-${selector}`]: true }} onChange={event => onChange({ ...value, [key]: event.target.value })} /></label>;
	return <fieldset disabled={disabled}>
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
	</fieldset>;
}
