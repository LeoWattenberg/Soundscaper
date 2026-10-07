/* SPDX-License-Identifier: AGPL-3.0-only */

/** Choose a track command, optionally identifying a recording rather than the last imported track. */
export function trackMenu(path, extras = {}) {
	if (!Array.isArray(path) || !path.length || path.some((label) => typeof label !== 'string' || !label)) {
		throw new TypeError('A track menu step needs a non-empty list of menu labels.');
	}
	for (const key of Object.keys(extras)) {
		if (!['why', 'see', 'fixture', 'which'].includes(key)) throw new TypeError(`A track-menu step does not take \`${key}\`.`);
	}
	const fixture = extras.fixture ?? null;
	if (fixture !== null && (typeof fixture !== 'string' || !fixture)) throw new TypeError('A track-menu fixture must be a fixture id.');
	const which = extras.which ?? null;
	if ((fixture !== null && which === null) || (which !== null && (typeof which !== 'string' || !which))) {
		throw new TypeError('A targeted track-menu step needs a reader-facing `which` phrase.');
	}
	const why = extras.why ?? null;
	const see = extras.see ?? null;
	if ((why !== null && typeof why !== 'string') || (see !== null && typeof see !== 'string')) {
		throw new TypeError('A track-menu explanation must be a string.');
	}
	return Object.freeze({ kind: 'track-menu', path: Object.freeze([...path]), fixture, which, why, see });
}

export function describeTrackMenu(entry, facet, fixture) {
	const target = entry.fixture
		? `the menu for ${facet === 'howto' ? entry.which : `\`${fixture(entry.fixture).file}\``}`
		: "the track's menu";
	return `Open ${target} from the **Track menu** button in its header and choose **${entry.path.join(' → ')}**.`;
}
