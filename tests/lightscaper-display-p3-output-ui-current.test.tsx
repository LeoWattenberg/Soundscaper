/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoRasterExportSettings, { DEFAULT_RASTER_EXPORT_SETTINGS, captureRasterExportSettingsOutputCurrentV1, captureRasterExportSettingsOutputV1,
	restoreRasterExportSettingsCurrentV1, type RasterExportSettings } from '../src/common/editor/ui/lightscaper/PhotoRasterExportSettings.tsx';
import PhotoRasterExportPresets from '../src/common/editor/ui/lightscaper/PhotoRasterExportPresets.tsx';
import { photoPngExportCopy } from '../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import type { PhotoRasterExportPresetCurrentV1 } from '../src/common/editor/photo-library-export-presets-port-current-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';

for (const locale of ['en', 'de']) test(`${locale}: Current export profile is opt-in, retained across format changes and restored exactly`, async () => {
	let settings: RasterExportSettings = DEFAULT_RASTER_EXPORT_SETTINGS, format: 'png' | 'jpeg' = 'png';
	const mounted = await mountPhotoImportUi(() => <PhotoRasterExportSettings value={settings} copy={photoPngExportCopy(locale)} locale={locale}
		currentFormat={format} disabled={false} onChange={value => { settings = value; }} />);
	try {
		const select = mounted.dom.one('[data-photo-raster-export-profile]');
		assert.equal(select.getAttribute('aria-label'), locale === 'de' ? 'Ausgabe-Farbprofil' : 'Output color profile');
		assert.deepEqual(captureRasterExportSettingsOutputCurrentV1(settings, 'png'), captureRasterExportSettingsOutputV1(settings));
		await act(async () => { reactProps(select).onChange?.({ target: { value: 'display-p3' } }); }); await mounted.render();
		const expected = { schemaVersion: 3, profile: 'display-p3', bitDepth: 8, sizing: { kind: 'original' }, quality: 'bilinear', metadataScope: 'strip' };
		assert.deepEqual(captureRasterExportSettingsOutputCurrentV1(settings, 'png'), expected);
		await act(async () => { reactProps(mounted.dom.one('[data-photo-raster-export-bit-depth]')).onChange?.({ target: { value: '16' } }); }); await mounted.render();
		assert.deepEqual(captureRasterExportSettingsOutputCurrentV1(settings, 'png'), { ...expected, bitDepth: 16 });
		format = 'jpeg'; await mounted.render();
		assert.equal(reactProps(mounted.dom.one('[data-photo-raster-export-profile]')).value, 'display-p3');
		assert.match(mounted.dom.one('[data-photo-raster-export-profile-refusal]').textContent, locale === 'de' ? /PNG oder sRGB/u : /PNG or sRGB/u);
		assert.throws(() => captureRasterExportSettingsOutputCurrentV1(settings, 'jpeg'), /PNG|JPEG|profile/u);
		format = 'png'; await mounted.render();
		const captured = captureRasterExportSettingsOutputCurrentV1(settings, 'png');
		settings = restoreRasterExportSettingsCurrentV1(captured, '{index}-{name}', 'png'); await mounted.render();
		assert.equal(Reflect.get(settings, 'profile'), 'display-p3'); assert.equal(settings.bitDepth, 16);
		assert.equal(settings.filenameTemplate, '{index}-{name}');
		assert.deepEqual(captureRasterExportSettingsOutputCurrentV1(settings, 'png'), captured);
		await act(async () => { reactProps(mounted.dom.one('[data-photo-raster-export-profile]')).onChange?.({ target: { value: 'srgb' } }); }); await mounted.render();
		assert.deepEqual(captureRasterExportSettingsOutputCurrentV1(settings, 'png'), { ...expected, profile: 'srgb', bitDepth: 16 });
	} finally { await mounted.dispose(); }
});

test('permanent export settings expose no profile control and legacy/Output2 restoration keeps its exact representation', async () => {
	const mounted = await mountPhotoImportUi(() => <PhotoRasterExportSettings value={DEFAULT_RASTER_EXPORT_SETTINGS} copy={photoPngExportCopy('en')}
		disabled={false} onChange={() => undefined} />);
	try { assert.equal(mounted.dom.find('[data-photo-raster-export-profile]'), null); } finally { await mounted.dispose(); }
	const legacy = captureRasterExportSettingsOutputV1(DEFAULT_RASTER_EXPORT_SETTINGS);
	assert.deepEqual(captureRasterExportSettingsOutputCurrentV1(restoreRasterExportSettingsCurrentV1(legacy, '{name}', 'png'), 'png'), legacy);
	const previous = { schemaVersion: 2 as const, bitDepth: 16 as const, ...legacy };
	const restored = restoreRasterExportSettingsCurrentV1(previous, '{name}', 'png');
	assert.equal(Object.hasOwn(restored, 'profile'), false); assert.deepEqual(captureRasterExportSettingsOutputCurrentV1(restored, 'png'), previous);
});

test('actual selected preset UI saves and reapplies Output3 through the native Current Session child', async () => {
	const f = await repairSettingsFixture(1), applied: PhotoRasterExportPresetCurrentV1[] = [];
	const before = await f.inspect();
	const preset = { schemaVersion: 1 as const, id: 'initial', name: 'Print', format: 'png' as const, filenameTemplate: '{name}', sidecarEnabled: false,
		output: { schemaVersion: 3 as const, profile: 'display-p3' as const, bitDepth: 16 as const, sizing: { kind: 'original' as const }, quality: 'bilinear' as const, metadataScope: 'strip' as const } };
	const capture = () => { const port = f.session.exportPresetsCurrent!; return port.open.bind(port); }, retirements = new Set<() => Promise<void>>();
	const mounted = await mountPhotoImportUi(() => <PhotoRasterExportPresets locale="en" disabled={false} capture={capture}
		registerDestination={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }}
		captureCurrent={(id, name) => ({ ...preset, id, name })} onApply={value => { applied.push(value); }} />);
	const click = async (selector: string) => { await act(async () => { reactProps(mounted.dom.one(selector)).onClick?.({}); await settle(); }); };
	try {
		await waitFor(async () => { await act(async () => { await settle(); }); return !mounted.dom.one('[data-photo-export-preset-select]').disabled; }, 'Current preset UI readiness');
		await act(async () => { reactProps(mounted.dom.one('[data-photo-export-preset-name]')).onChange?.({ currentTarget: { value: 'Print Display P3' } }); await settle(); });
		await click('[data-photo-export-preset-save]');
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.one('[data-photo-export-preset-select]').options.length === 2; }, 'retained P3 preset row');
		await click('[data-photo-export-preset-reload]');
		await waitFor(async () => { await act(async () => { await settle(); }); return !mounted.dom.one('[data-photo-export-preset-fields]').disabled; }, 'P3 preset reload settlement');
		const access = await f.session.exportPresetsCurrent!.open(), snapshot = await access.list({ schemaVersion: 1 });
		await act(async () => { reactProps(mounted.dom.one('[data-photo-export-preset-select]')).onChange?.({ currentTarget: { value: snapshot.presets[0]!.id } }); await settle(); });
		await click('[data-photo-export-preset-apply]');
		await waitFor(async () => { await act(async () => { await settle(); }); return applied.length === 1; }, 'P3 preset application');
		assert.deepEqual(applied[0]!.output, preset.output);
		const restored = restoreRasterExportSettingsCurrentV1(applied[0]!.output, applied[0]!.filenameTemplate, 'png');
		assert.equal(Reflect.get(restored, 'profile'), 'display-p3'); assert.equal(restored.bitDepth, 16); assert.deepEqual(await f.inspect(), before);
	} finally { await mounted.dispose(); await Promise.allSettled([...retirements].map(retire => retire())); await f.close(); }
});
