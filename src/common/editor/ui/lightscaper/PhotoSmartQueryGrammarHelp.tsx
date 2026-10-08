/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ReactNode } from 'react';

const MAXIMUM_HELP_CHARACTERS = 4_096;
const MAXIMUM_HELP_IDENTIFIERS = 128;
const CAPTURE_INTERVAL = '[from, to)';
// DSL literals are program syntax. Keep them outside translatable prose;
// example IDs are placeholders, never resolved or applied by this help.
const QUERY_EXAMPLES = Object.freeze({
	all: '{"kind":"all","terms":[{"kind":"rating","minimum":3,"maximum":5},{"kind":"flag","value":"pick"}]}',
	any: '{"kind":"any","terms":[{"kind":"flag","value":"pick"},{"kind":"label","value":"blue"}]}',
	not: '{"kind":"not","term":{"kind":"flag","value":"reject"}}',
	rating: '{"kind":"rating","minimum":3,"maximum":5}',
	flag: '{"kind":"flag","value":"pick"}',
	label: '{"kind":"label","value":"blue"}',
	keyword: '{"kind":"keyword","id":"sample-keyword-id"}',
	folder: '{"kind":"folder","id":"sample-folder-id"}',
	'file-name': '{"kind":"file-name","contains":"sample"}',
	'capture-time': '{"kind":"capture-time","from":"2026-01-01T00:00:00.000","to":null}',
});

/** The translation writer protects this exact *identifier* syntax. */
export default function PhotoSmartQueryGrammarHelp({ text }: Readonly<{ text: string }>) {
	if (typeof text !== 'string') throw new TypeError('Smart query help requires text.');
	// Current reviewed help and its admitted threefold translation growth fit
	// within this bound; refuse instead of cutting off required grammar tokens.
	if (text.length > MAXIMUM_HELP_CHARACTERS) throw new RangeError('Smart query help exceeds its text bound.');
	const children: ReactNode[] = [];
	let offset = 0, identifiers = 0;
	for (const match of text.matchAll(/\*[A-Za-z][A-Za-z0-9_-]*\*/gu)) {
		if (++identifiers > MAXIMUM_HELP_IDENTIFIERS) throw new RangeError('Smart query help exceeds its identifier bound.');
		if (match.index > offset) children.push(text.slice(offset, match.index));
		children.push(<code key={match.index}>{match[0].slice(1, -1)}</code>);
		offset = match.index + match[0].length;
	}
	if (offset < text.length) children.push(text.slice(offset));
	return <>
		<p>{children}</p>
		<ul className="lightscaper-smart-query-examples">{Object.entries(QUERY_EXAMPLES).map(([kind, json]) =>
			<li key={kind}><pre><code data-photo-smart-query-example={kind}>{json}</code></pre></li>)}</ul>
		<p><code data-photo-smart-query-interval="true">{CAPTURE_INTERVAL}</code></p>
	</>;
}
