/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MeterSettings } from '../meter-settings.ts';

export type MeterSettingsUpdate = MeterSettings | ((current: MeterSettings) => MeterSettings);

/** Resolve the shared menu settings before changing React state or workspace preferences. */
export function resolveMeterPanelSettingsChange(
	current: Readonly<MeterSettings>,
	update: MeterSettingsUpdate,
	panelVisible = false,
): { settings: MeterSettings; panelVisible: boolean } {
	const displayed: MeterSettings = { ...current, ...(panelVisible ? { position: 'panel' } : {}) };
	const settings = typeof update === 'function' ? update(displayed) : update;
	return { settings, panelVisible: settings.position === 'panel' };
}
