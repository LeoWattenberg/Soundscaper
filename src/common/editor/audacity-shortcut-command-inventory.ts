/* SPDX-License-Identifier: AGPL-3.0-only */

interface AudacityShortcutActionDefinition {
	readonly id: string;
	readonly handler?: string | null;
	readonly locations?: readonly string[];
}

const SHORTCUT_CONTAINER_ACTION_IDS: ReadonlySet<string> = new Set(['menu-align', 'menu-sort']);

/** Apply product capability filters to one Audacity command. */
export function audacityShortcutCommandDisabled(
	resolveDefinition: (id: string) => AudacityShortcutActionDefinition | null,
	id: string,
	disabledCommandIds: readonly string[] = [],
): boolean {
	const definition = resolveDefinition(id);
	const canonicalId = definition?.id || id;
	if (SHORTCUT_CONTAINER_ACTION_IDS.has(canonicalId)) return true;
	const disabled = new Set(disabledCommandIds);
	if (disabled.has(canonicalId) || disabled.has(id)) return true;
	if (!definition) return false;
	const handler = definition.handler || '';
	const locations = definition.locations || [];
	const hasLocation = (root: string): boolean => locations.some((location) => (
		location === root || location.startsWith(`${root} >`)
	));
	if (disabled.has('record') && handler.startsWith('recording.')) return true;
	if (disabled.has('generate') && (
		handler.startsWith('generators.') || handler === 'effects.openGenerator' || hasLocation('Generate')
	)) return true;
	if (disabled.has('selection-effect') && (
		handler.startsWith('effects.') || hasLocation('Effect') || hasLocation('Realtime effect rack')
	)) return true;
	if (disabled.has('spectral-edit') && (
		handler.startsWith('spectral.') || canonicalId.includes('spectral')
		|| locations.some((location) => location.includes('Spectral'))
	)) return true;
	if (disabled.has('analyze') && (handler.startsWith('analysis.') || hasLocation('Analyze'))) return true;
	if (disabled.has('manage-macros') && handler.startsWith('macros.')) return true;
	return disabled.has('nyquist-prompt') && handler.startsWith('nyquist.');
}
