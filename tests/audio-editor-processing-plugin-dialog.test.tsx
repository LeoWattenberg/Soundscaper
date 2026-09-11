/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SoundscaperNativeEffectScanPanel } from '../src/common/editor/ui/dialogs/SoundscaperNativeEffectPanels.tsx';
import { SOUNDSCAPER_NATIVE_SERVICES_COPY } from '../src/common/editor/ui/soundscaper-native-services-copy.ts';
import { EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import type { NativePluginAvailability } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';

const availability: NativePluginAvailability = {
	enabled: true, quarantined: false, payload: { status: 'available', reason: null }, formats: [],
	consent: { scanningEnabled: true, formats: [{ format: 'fixture', supported: true, granted: true,
		roots: [{ rootId: 'root', origin: 'standard', name: 'Plugin folder', admitted: true }] }] },
	quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 },
};

test('manager scanning respects discovery, runtime, quarantine and consent while permissions remain reachable', () => {
	for (const overrides of [{ enabled: false }, { quarantined: true },
		{ payload: { status: 'unavailable' as const, reason: 'not-built' } },
		{ consent: { ...availability.consent, scanningEnabled: false } }]) {
		const html = scanMarkup({ ...availability, ...overrides });
		assert.match(html, /disabled=""[^>]*data-native-plugin-scan="root"/);
		assert.doesNotMatch(html, /disabled=""[^>]*data-native-plugin-consent="revoke"/);
	}
	assert.doesNotMatch(scanMarkup(availability), /disabled=""[^>]*data-native-plugin-scan="root"/);
});

function scanMarkup(plugins: NativePluginAvailability): string {
	return renderToStaticMarkup(<SoundscaperNativeEffectScanPanel copy={SOUNDSCAPER_NATIVE_SERVICES_COPY}
		state={{ ...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, plugins }} disabled={false} perform={() => undefined} />);
}
