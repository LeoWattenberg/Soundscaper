/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SoundscaperPluginFoldersPanel } from '../src/common/editor/ui/dialogs/SoundscaperPluginFoldersPreferences.tsx';
import { SOUNDSCAPER_NATIVE_SERVICES_COPY } from '../src/common/editor/ui/soundscaper-native-services-copy.ts';
import { EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import type { NativePluginAvailability } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';

const availability: NativePluginAvailability = {
	enabled: true, quarantined: false, payload: { status: 'available', reason: null }, formats: [],
	consent: { scanningEnabled: true, formats: [{ format: 'fixture', supported: true, granted: true,
		roots: [{ rootId: 'root', origin: 'standard', name: 'Plugin folder', admitted: true }] }] },
	quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 },
};

test('preferences scanning respects discovery, runtime and quarantine while folders remain editable', () => {
	for (const overrides of [{ enabled: false }, { quarantined: true },
		{ payload: { status: 'unavailable' as const, reason: 'not-built' } }]) {
		const html = scanMarkup({ ...availability, ...overrides });
		assert.match(html, /disabled=""[^>]*data-native-plugin-scan="true"/);
		assert.doesNotMatch(html, /role="checkbox"[^>]*aria-disabled="true"/);
	}
	assert.doesNotMatch(scanMarkup(availability), /disabled=""[^>]*data-native-plugin-scan="true"/);
});

function scanMarkup(plugins: NativePluginAvailability): string {
	return renderToStaticMarkup(<SoundscaperPluginFoldersPanel copy={SOUNDSCAPER_NATIVE_SERVICES_COPY}
		state={{ ...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, plugins }} disabled={false} perform={() => undefined} />);
}

test('folder preferences hide unsupported formats and use checkboxes only for standard folders', () => {
	const html = scanMarkup({ ...availability, consent: { scanningEnabled: true, formats: [
		{ format: 'vst3', supported: true, granted: false, roots: [
			{ rootId: 'system', origin: 'standard', name: 'System VST3 folder', admitted: false },
			{ rootId: 'custom', origin: 'custom', name: 'plugins', displayPath: '/opt/vendor/plugins', admitted: true },
		] },
		{ format: 'au', supported: false, granted: false, roots: [] },
	] } });
	assert.match(html, /VST3/);
	assert.match(html, /System VST3 folder/);
	assert.match(html, /\/opt\/vendor\/plugins/);
	assert.equal((html.match(/role="checkbox"/g) ?? []).length, 1);
	assert.match(html, /Add path/);
	assert.match(html, /Remove path/);
	assert.doesNotMatch(html, /data-native-plugin-format="au"|Allow scanning|Stop scanning|Admit folder/);
});
