/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareText, page, table } from './markdown.mjs';

const DIRECTION_LABELS = Object.freeze({
	ltr: 'Left to right',
	rtl: 'Right to left',
});

export function renderLanguageReference({ routeLocales, bundledLocaleTags, machineLocaleTags = [], audacityLocaleTags = [], localePath }) {
	if (!Array.isArray(routeLocales) || routeLocales.length === 0) throw new TypeError('The route locale list is required.');
	if (!Array.isArray(bundledLocaleTags) || bundledLocaleTags.length === 0) throw new TypeError('The bundled locale list is required.');
	if (!Array.isArray(machineLocaleTags) || !Array.isArray(audacityLocaleTags)) throw new TypeError('The machine and Audacity locale lists must be arrays.');
	if (typeof localePath !== 'function') throw new TypeError('The locale route builder is required.');

	const rows = routeLocales
		.map((descriptor) => {
			const direction = DIRECTION_LABELS[descriptor.direction];
			if (!direction) throw new RangeError(`Unknown writing direction: ${String(descriptor.direction)}.`);
			return {
				name: descriptor.nativeName,
				tag: descriptor.locale,
				route: localePath(descriptor.locale),
				direction,
				source: sourceLabel(descriptor.locale, { bundledLocaleTags, machineLocaleTags, audacityLocaleTags }),
			};
		})
		.sort((left, right) => compareText(left.tag, right.tag));

	const body = [
		'The editor is served at one route per language. A language that is not listed here falls back to English.',
		'',
		"Two languages are written and reviewed for this editor directly. The rest are machine translated from the English copy, and wherever Audacity's translators have reviewed the same command name, their wording is shown instead. English variants carry only Audacity's reviewed strings over English.",
		'',
		table(
			['Language', 'Tag', 'Route', 'Writing direction', 'Source'],
			rows.map((row) => [row.name, `\`${row.tag}\``, `\`${row.route}\``, row.direction, row.source]),
		),
		'',
		`An embedded view without the surrounding site uses the same tags under \`${localePath('en', { embedded: true })}\`.`,
	].join('\n');
	return page({
		title: 'Languages',
		description: 'The languages the editor is served in, their routes, and where each translation comes from.',
		order: 10,
		body,
	});
}

function sourceLabel(locale, { bundledLocaleTags, machineLocaleTags, audacityLocaleTags }) {
	if (bundledLocaleTags.includes(locale)) return 'Written for this editor';
	const machine = machineLocaleTags.includes(locale);
	const audacity = audacityLocaleTags.includes(locale);
	if (machine && audacity) return "Machine translated, with Audacity's reviewed strings";
	if (machine) return 'Machine translated';
	if (audacity) return "Audacity's reviewed strings over English";
	return 'English';
}
