/* SPDX-License-Identifier: AGPL-3.0-only */

import { listNyquistPlugins } from '../nyquist/plugin-registry.js';
import { regularEffectReplacementForNyquistPlugin } from '../first-party-effects/standard/nyquist-replacements.ts';

let cachedInstalledPlugins = null;
if (typeof globalThis.addEventListener === 'function') {
	globalThis.addEventListener('storage', (event) => {
		if (event.key === 'soundscaper-nyquist-archive-plugins-v1') cachedInstalledPlugins = null;
	});
	globalThis.addEventListener('soundscaper-nyquist-archive-changed', () => { cachedInstalledPlugins = null; });
}

export function listInstalledNyquistMenuPlugins(storage = undefined) {
	if (storage === undefined && cachedInstalledPlugins) return cachedInstalledPlugins;
	try {
		if (storage === undefined && typeof process !== 'undefined' && process.versions?.node) return [];
		const saved = JSON.parse((storage ?? globalThis.localStorage)?.getItem('soundscaper-nyquist-archive-plugins-v1') ?? '[]');
		if (!Array.isArray(saved)) return [];
		const plugins = saved.filter((record) => (
			/^[A-Za-z0-9][A-Za-z0-9._-]*\.ny$/u.test(record?.fileName)
			&& record.archiveId === 'audacityteam-nyquist-plugins-ed168a19631ec48d0029dfb5c17d16c339a174c1'
			&& record.id === `nyquist:archive:${record.fileName}`
			&& typeof record.name === 'string' && record.name.length > 0 && record.name.length <= 200
			&& ['process', 'generate', 'analyze'].includes(record.role)
		)).map((record) => ({
			id: record.id,
			name: record.name,
			role: record.role,
			category: record.role === 'process' ? 'legacy' : record.role,
			spectral: record.spectral === true,
		}));
		if (storage === undefined) cachedInstalledPlugins = plugins;
		return plugins;
	} catch {
		return [];
	}
}

/**
 * Builds the per-category reader the menu tree calls for its Nyquist submenus.
 *
 * Each category asks a different question of the editor before it may run: a
 * generator only needs an editable project, an analyzer needs a track to read
 * rather than write, and the legacy category additionally withholds spectral
 * plugins until a frequency range is selected. Keeping that table beside the
 * registry leaves the menu tree with one call per submenu.
 *
 * Everything but a generator reads the audio the selection names — a drawn time
 * range or the selected clips — and the evaluation refuses outright when the
 * selection resolves to nothing, so the entry withholds itself instead.
 */
export function createNyquistPluginMenuItems(
	{ editBlocked, blocked, selectedAudioTrack, frequencySelectionActive, selectionActive, archiveStorage = undefined },
	actions,
) {
	const plugins = [...listNyquistPlugins(), ...listInstalledNyquistMenuPlugins(archiveStorage)];
	const disabled = (plugin) => {
		if (plugin.category === 'legacy') return editBlocked || !selectedAudioTrack || !selectionActive || (plugin.spectral && !frequencySelectionActive);
		if (plugin.category === 'generate') return editBlocked;
		if (plugin.category === 'analyze') return blocked || !selectedAudioTrack || !selectionActive;
		return editBlocked || !selectedAudioTrack || !selectionActive;
	};
	return (category) => plugins
		.filter((plugin) => plugin.category === category && !regularEffectReplacementForNyquistPlugin(plugin.id))
		.map((plugin) => ({
			id: plugin.id,
			label: plugin.name,
			disabled: disabled(plugin),
			onClick: () => actions.openNyquist(plugin.id),
		}));
}
