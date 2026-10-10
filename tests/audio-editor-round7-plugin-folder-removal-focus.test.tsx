/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { SoundscaperPluginFoldersPanel } from '../src/common/editor/ui/dialogs/SoundscaperPluginFoldersPreferences.tsx';
import { SOUNDSCAPER_NATIVE_SERVICES_COPY } from '../src/common/editor/ui/soundscaper-native-services-copy.ts';
import { EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import type { NativePluginAvailability } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const outcome of ['removed', 'refused', 'other-focus'] as const) test(`custom folder removal focus: ${outcome}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const custom = { rootId: 'custom', origin: 'custom', name: 'plugins', displayPath: '/opt/vendor/plugins', admitted: true };
	let plugins: NativePluginAvailability = { enabled: false, quarantined: false,
		payload: { status: 'unavailable', reason: 'not-built' }, formats: [],
		consent: { scanningEnabled: false, formats: [{ format: 'vst3', supported: true, granted: true, roots: [custom] }] },
		quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 } };
	let pending = false;
	const render = () => root.render(<><input aria-label="Other preference" /><SoundscaperPluginFoldersPanel copy={SOUNDSCAPER_NATIVE_SERVICES_COPY}
		state={{ ...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, plugins, pending: pending ? 'remove-root' : null }}
		disabled={pending} perform={() => { pending = true; render(); }} /></>);
	try {
		await act(async () => render());
		const remove = dom.one('[aria-label="Remove path: /opt/vendor/plugins"]');
		const add = dom.one('[aria-label="Add path: VST3"]');
		remove.focus();
		await act(async () => reactProps(remove).onClick({ currentTarget: remove }));
		assert.equal(remove.isConnected, true, 'the admitted operation first retains its folder row');
		// Native DOM removal or disabling releases active focus to body.
		const other = dom.one('input');
		if (outcome === 'other-focus') other.focus();
		else document.body.focus();
		if (outcome !== 'refused') plugins = { ...plugins, consent: { ...plugins.consent,
			formats: plugins.consent.formats.map(format => ({ ...format, roots: [] })) } };
		pending = false;
		await act(async () => render());
		assert.equal(remove.isConnected, outcome === 'refused', 'the authoritative inventory owns the original action');
		assert.ok(document.activeElement === (outcome === 'removed' ? add : outcome === 'refused' ? remove : other),
			'focus continues on the surviving action, or the independently chosen preference');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
