/* SPDX-License-Identifier: AGPL-3.0-only */

/** Set one checkbox in the Editing preferences through the application menu. */
export function editingPreference({ label, checked }, extras = {}) {
	if (typeof label !== 'string' || label.length === 0 || typeof checked !== 'boolean') {
		throw new TypeError('An editing preference needs its label and a boolean checked value.');
	}
	for (const [key, value] of Object.entries(extras)) {
		if (!['why', 'see'].includes(key) || typeof value !== 'string') throw new TypeError(`Invalid editing preference explanation: ${key}.`);
	}
	return Object.freeze({ kind: 'editing-preference', label, checked, why: extras.why ?? null, see: extras.see ?? null });
}

export function describeEditingPreference(entry) {
	return `Choose **Edit → Preferences**, open the **Editing** tab, ${entry.checked ? 'turn on' : 'turn off'} **${entry.label}**, then press **Close**.`;
}

/** Describe mouse or keyboard selection without changing which pieces are replayed. */
export function describeClips(entry, facet, fixture) {
	const names = facet === 'howto'
		? entry.which
		: entry.fixtures.map((id, index) => `\`${fixture(id).file}\`${entry.keyboard ? ` (piece ${String(index + 1)})` : ''}`);
	const [first, ...rest] = names;
	const remaining = rest.length <= 1 ? rest.join('') : `${rest.slice(0, -1).join(', ')} and ${rest.at(-1)}`;
	if (entry.keyboard) {
		const start = `Use **Tab** to focus ${first} and press **Enter** to select it.`;
		return rest.length === 0 ? start : `${start} Then focus ${remaining} and press **Shift+Enter** to add ${rest.length === 1 ? 'it' : 'each'} to the selection.`;
	}
	if (rest.length === 0) return `Click the name bar of ${first} to select it.`;
	return `Click the name bar of ${first}, then hold Shift and click the name bar of ${remaining}, so ${rest.length === 1 ? 'both' : 'all of them'} are selected.`;
}
