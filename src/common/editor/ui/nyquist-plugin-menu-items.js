/* SPDX-License-Identifier: AGPL-3.0-only */

import { listNyquistPlugins } from '../nyquist/plugin-registry.js';

/**
 * Builds the per-category reader the menu tree calls for its Nyquist submenus.
 *
 * Each category asks a different question of the editor before it may run: a
 * generator only needs an editable project, an analyzer needs a track to read
 * rather than write, and the legacy category additionally withholds spectral
 * plugins until a frequency range is selected. Keeping that table beside the
 * registry leaves the menu tree with one call per submenu.
 */
export function createNyquistPluginMenuItems(
	{ editBlocked, blocked, selectedAudioTrack, frequencySelectionActive },
	actions,
) {
	const plugins = listNyquistPlugins();
	const disabled = (plugin) => {
		if (plugin.category === 'legacy') return editBlocked || !selectedAudioTrack || (plugin.spectral && !frequencySelectionActive);
		if (plugin.category === 'generate') return editBlocked;
		if (plugin.category === 'analyze') return blocked || !selectedAudioTrack;
		return editBlocked || !selectedAudioTrack;
	};
	return (category) => plugins
		.filter((plugin) => plugin.category === category)
		.map((plugin) => ({
			id: plugin.id,
			label: plugin.name,
			disabled: disabled(plugin),
			onClick: () => actions.openNyquist(plugin.id),
		}));
}
