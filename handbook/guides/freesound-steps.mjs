/* SPDX-License-Identifier: AGPL-3.0-only */

function requirePhrase(value, key) {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`A Freesound step needs a reader-facing \`${key}\` phrase.`);
	return value;
}

function extrasFor(kind, extras, key) {
	for (const name of Object.keys(extras)) {
		if (![key, 'why', 'see'].includes(name)) throw new TypeError(`A ${kind} step does not take \`${name}\`.`);
	}
	if (extras.why !== undefined && typeof extras.why !== 'string') throw new TypeError('A step explanation must be a string.');
	if (extras.see !== undefined && typeof extras.see !== 'string') throw new TypeError('A step observation must be a string.');
	return { why: extras.why ?? null, see: extras.see ?? null };
}

/** Search for a known result; `what` describes a reader's own search instead of the test query. */
export function searchFreesound(query, extras = {}) {
	if (typeof query !== 'string' || query.trim().length === 0) throw new TypeError('A Freesound search needs a query.');
	return Object.freeze({ kind: 'freesound-search', query, what: requirePhrase(extras.what, 'what'), ...extrasFor('freesound-search', extras, 'what') });
}

/** Insert the known result at the playhead; `which` describes a reader's chosen result. */
export function insertFreesound(name, extras = {}) {
	if (typeof name !== 'string' || name.length === 0) throw new TypeError('A Freesound insert needs the result name.');
	return Object.freeze({ kind: 'freesound-insert', name, which: requirePhrase(extras.which, 'which'), ...extrasFor('freesound-insert', extras, 'which') });
}

export function describeFreesoundStep(entry, facet) {
	if (entry.kind === 'freesound-search') {
		const query = facet === 'howto' ? entry.what : `\`${entry.query}\``;
		return `In the **Freesound** panel, type ${query} into **Search Freesound**, then press **Search**. Matching sounds appear in **Freesound results**.`;
	}
	const result = facet === 'howto' ? entry.which : `**${entry.name}**`;
	return `In **Freesound results**, press **Insert at playhead** beside ${result}. The sound appears as a clip at the playhead.`;
}
