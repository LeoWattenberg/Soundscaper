/* SPDX-License-Identifier: AGPL-3.0-only */

interface AudacityShortcutActionDefinition {
	readonly id: string;
	readonly handler?: string | null;
	readonly locations?: readonly string[];
}

/*
 * Rows the shortcut editor never offers. Three kinds qualify, and nothing else:
 * submenu headers that only open another list, dynamic ActionQuery templates
 * whose `%1` stands for a value chosen at invocation time, and the
 * application-information commands that report on the program rather than act
 * on the project or the view. The manual keeps its upstream F1 because Audacity
 * ships that binding; the rest of Help's outward links do not.
 */
const SHORTCUT_CONTAINER_ACTION_IDS: ReadonlySet<string> = new Set([
	'menu-align', 'menu-sort', 'menu-macros',
]);

const SHORTCUT_INFORMATIONAL_ACTION_IDS: ReadonlySet<string> = new Set([
	'about-audacity', 'tutorials', 'local://support', 'privacy-policy',
	'desktop-check-updates', 'desktop-product-help', 'desktop-view-source',
]);

/** A dynamic ActionQuery template stands in for a family of parameterized invocations. */
function isShortcutActionTemplate(id: string): boolean {
	return id.includes('%1');
}

/** Report whether a command is one the shortcut editor refuses to list at all. */
export function audacityShortcutCommandUnassignable(id: string): boolean {
	return SHORTCUT_CONTAINER_ACTION_IDS.has(id)
		|| SHORTCUT_INFORMATIONAL_ACTION_IDS.has(id)
		|| isShortcutActionTemplate(id);
}

/** Apply product capability filters to one Audacity command. */
export function audacityShortcutCommandDisabled(
	resolveDefinition: (id: string) => AudacityShortcutActionDefinition | null,
	id: string,
	disabledCommandIds: readonly string[] = [],
): boolean {
	const definition = resolveDefinition(id);
	const canonicalId = definition?.id || id;
	if (audacityShortcutCommandUnassignable(canonicalId) || audacityShortcutCommandUnassignable(id)) return true;
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
