/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareText, page, table } from './markdown.mjs';

const DIRECTION_LABELS = Object.freeze({
	ltr: 'Left to right',
	rtl: 'Right to left',
});

export function renderLanguageReference({ routeLocales, bundledLocaleTags, localePath }) {
	if (!Array.isArray(routeLocales) || routeLocales.length === 0) throw new TypeError('The route locale list is required.');
	if (!Array.isArray(bundledLocaleTags) || bundledLocaleTags.length === 0) throw new TypeError('The bundled locale list is required.');
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
				source: bundledLocaleTags.includes(descriptor.locale)
					? 'Written for this editor'
					: 'Audacity translation release',
			};
		})
		.sort((left, right) => compareText(left.tag, right.tag));

	const body = [
		'The editor is served at one route per language. A language that is not listed here falls back to English.',
		'',
		'Two languages are written and reviewed for this editor directly. The rest reuse the Audacity translation release for the wording Audacity already has, which is why their coverage follows what upstream translators have done rather than what this editor has added.',
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
