/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoRasterExportSettings, { DEFAULT_RASTER_EXPORT_SETTINGS, captureRasterExportSettingsOutputCurrentV1, captureRasterExportSettingsOutputV1,
	restoreRasterExportSettingsCurrentV1, type RasterExportSettings } from '../src/common/editor/ui/lightscaper/PhotoRasterExportSettings.tsx';
import PhotoRasterExportPresets from '../src/common/editor/ui/lightscaper/PhotoRasterExportPresets.tsx';
import { photoPngExportCopy } from '../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import type { PhotoRasterExportPresetV1 } from '../src/common/editor/photo-library-export-presets-port-v1.ts';
import { photoRasterDepthCopy } from '../src/common/i18n/lightscaper-photo-raster-depth-copy.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';

for (const locale of ['en', 'de']) test(`${locale}: Current PNG depth is an explicit dialog-only selection and survives retained settings restoration`, async () => {
	let settings: RasterExportSettings = DEFAULT_RASTER_EXPORT_SETTINGS;
	const mounted = await mountPhotoImportUi(() => <PhotoRasterExportSettings value={settings} copy={photoPngExportCopy(locale)} locale={locale}
		currentFormat="png" disabled={false} onChange={value => { settings = value; }} />);
	try {
		const select = mounted.dom.one('[data-photo-raster-export-bit-depth]'); assert.equal(select.getAttribute('aria-label'), photoRasterDepthCopy(locale).label);
		assert.deepEqual(captureRasterExportSettingsOutputCurrentV1(settings, 'png'), captureRasterExportSettingsOutputV1(settings));
		await act(async () => { reactProps(select).onChange?.({ target: { value: '16' } }); }); await mounted.render();
		const output = captureRasterExportSettingsOutputCurrentV1(settings, 'png');
		assert.deepEqual(output, { schemaVersion: 2, bitDepth: 16, sizing: { kind: 'original' }, quality: 'bilinear', metadataScope: 'strip' });
		settings = restoreRasterExportSettingsCurrentV1(JSON.parse(JSON.stringify(output)) as typeof output, '{index}-{name}', 'png'); await mounted.render();
		assert.equal(settings.bitDepth, 16); assert.equal(settings.filenameTemplate, '{index}-{name}');
		assert.throws(() => captureRasterExportSettingsOutputCurrentV1(settings, 'jpeg'), /requires PNG/u);
	}
	finally { await mounted.dispose(); }
});

test('permanent legacy settings and Current JPEG settings offer no sixteen-bit control', async () => {
	for (const currentFormat of [undefined, 'jpeg'] as const) {
		const mounted = await mountPhotoImportUi(() => <PhotoRasterExportSettings value={DEFAULT_RASTER_EXPORT_SETTINGS} copy={photoPngExportCopy('en')}
			currentFormat={currentFormat} disabled={false} onChange={() => undefined} />);
		try { assert.equal(mounted.dom.find('[data-photo-raster-export-bit-depth]'), null); } finally { await mounted.dispose(); }
	}
});

test('actual preset UI saves and reapplies Current PNG16 through the selected native Session child', async () => {
	const f = await repairSettingsFixture(1), applied: PhotoRasterExportPresetV1[] = [];
	const preset = { schemaVersion: 1 as const, id: 'initial', name: 'Print', format: 'png' as const, filenameTemplate: '{name}', sidecarEnabled: false,
		output: { schemaVersion: 2 as const, bitDepth: 16 as const, sizing: { kind: 'original' as const }, quality: 'bilinear' as const, metadataScope: 'strip' as const } };
	const capture = () => { const port = f.session.exportPresetsCurrent!; return port.open.bind(port); }, retirements = new Set<() => Promise<void>>();
	const mounted = await mountPhotoImportUi(() => <PhotoRasterExportPresets locale="en" disabled={false} capture={capture}
		registerDestination={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }}
		captureCurrent={(id, name) => ({ ...preset, id, name })} onApply={value => { applied.push(value); }} />);
	const click = async (selector: string) => { await act(async () => { reactProps(mounted.dom.one(selector)).onClick?.({}); await settle(); }); };
	try {
		await waitFor(async () => { await act(async () => { await settle(); }); return !mounted.dom.one('[data-photo-export-preset-select]').disabled; }, 'Current selected preset UI');
		await act(async () => { reactProps(mounted.dom.one('[data-photo-export-preset-name]')).onChange?.({ currentTarget: { value: 'Print PNG16' } }); await settle(); });
		await click('[data-photo-export-preset-save]');
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.one('[data-photo-export-preset-select]').options.length === 2; }, 'retained PNG16 preset row');
		await click('[data-photo-export-preset-reload]');
		await waitFor(async () => { await act(async () => { await settle(); }); return !mounted.dom.one('[data-photo-export-preset-fields]').disabled; }, 'Current preset reload settlement');
		const access = await f.session.exportPresetsCurrent!.open(), snapshot = await access.list({ schemaVersion: 1 });
		await act(async () => { reactProps(mounted.dom.one('[data-photo-export-preset-select]')).onChange?.({ currentTarget: { value: snapshot.presets[0]!.id } }); await settle(); });
		await click('[data-photo-export-preset-apply]');
		await waitFor(async () => { await act(async () => { await settle(); }); return applied.length === 1; }, 'Current PNG16 preset application');
		assert.deepEqual(applied[0]!.output, preset.output);
		assert.equal(restoreRasterExportSettingsCurrentV1(applied[0]!.output, applied[0]!.filenameTemplate, 'png').bitDepth, 16);
	} finally { await mounted.dispose(); await Promise.allSettled([...retirements].map(retire => retire())); await f.close(); }
});
