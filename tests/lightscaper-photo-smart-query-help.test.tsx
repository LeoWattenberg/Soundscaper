/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import PhotoSmartQueryGrammarHelp from '../src/common/editor/ui/lightscaper/PhotoSmartQueryGrammarHelp.tsx';
import { matchesNormalizedPhotoQuerySubjectV1, normalizePhotoSmartQueryV1 } from '../src/lightscaper/catalog/smart-query.ts';

const identifiers = ['kind', 'all', 'any', 'terms', 'not', 'term', 'rating', 'minimum', 'maximum', 'flag', 'label',
	'value', 'keyword', 'folder', 'id', 'file-name', 'contains', 'capture-time', 'from', 'to', 'null', 'from', 'to'];
const kinds = ['all', 'any', 'not', 'rating', 'flag', 'label', 'keyword', 'folder', 'file-name', 'capture-time'];

function render(text: string): string { return renderToStaticMarkup(<PhotoSmartQueryGrammarHelp text={text} />); }
function prose(html: string): string { return html.slice(0, html.indexOf('</p>') + 4); }
function examples(html: string): string[] {
	return Array.from(html.matchAll(/<code data-photo-smart-query-example="[a-z-]+">(.*?)<\/code>/gu), match => {
		const value = match[1];
		assert.ok(value);
		return value.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&#x27;', "'");
	});
}

test('smart query help exposes every protected grammar identifier as literal code without visible markers', () => {
	const text = `JSON: ${identifiers.map(value => `*${value}*`).join(', ')}.`;
	const html = renderToStaticMarkup(<PhotoSmartQueryGrammarHelp text={text} />);
	assert.equal(prose(html), `<p>JSON: ${identifiers.map(value => `<code>${value}</code>`).join(', ')}.</p>`);
	assert.doesNotMatch(html, /\*/u);
});

test('ten immutable examples normalize with the actual grammar and cover every literal within two KiB', () => {
	const values = examples(render('Examples.'));
	assert.equal(values.length, 10);
	assert.ok(Buffer.byteLength(values.join(''), 'utf8') <= 2_048);
	assert.deepEqual(values.map(value => normalizePhotoSmartQueryV1(JSON.parse(value) as unknown).kind), kinds);
	const tokens: readonly string[] = values.join('').match(/[A-Za-z][A-Za-z0-9_-]*/gu) ?? [];
	for (const identifier of new Set(identifiers)) assert.ok(tokens.includes(identifier), `Missing literal ${identifier}`);
	assert.ok(values.some(value => value.includes('"id":"sample-keyword-id"')));
	assert.ok(values.some(value => value.includes('"id":"sample-folder-id"')));
});

test('reviewed English and German prose have identical immutable examples within the translation growth bound', () => {
	const expected = examples(render('Translated examples.'));
	for (const locale of ['en', 'de']) {
		const text = bundledLightscaperEditorCopyForLocale(locale).photoOrganizerQueryGrammar;
		const html = render(text);
		assert.deepEqual(examples(html), expected);
		assert.doesNotMatch(html, /\*/u);
		assert.doesNotThrow(() => render(text + 'x'.repeat(text.length * 2)));
	}
	assert.deepEqual(examples(render('قاعدة <script>*kind*</script>')), expected);
});

test('capture help states and demonstrates an inclusive lower and exclusive upper local-time boundary', () => {
	const html = render('Local wall time.');
	assert.match(html, /<code data-photo-smart-query-interval="true">\[from, to\)<\/code>/u);
	const value = examples(html).map(source => normalizePhotoSmartQueryV1(JSON.parse(source) as unknown))
		.find(query => query.kind === 'capture-time');
	assert.ok(value?.kind === 'capture-time');
	assert.equal(value.to, null);
	assert.ok(value.from);
	const subject = { rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const, folderId: null,
		fileName: 'sample.jpg', keywordIds: [], captureLocal: value.from };
	assert.equal(matchesNormalizedPhotoQuerySubjectV1(subject, value), true);
	const upper = normalizePhotoSmartQueryV1({ ...value, to: '2027-01-01T00:00:00.000' });
	assert.equal(matchesNormalizedPhotoQuerySubjectV1({ ...subject, captureLocal: '2027-01-01T00:00:00.000' }, upper), false);
	assert.equal(matchesNormalizedPhotoQuerySubjectV1({ ...subject, captureLocal: null }, value), false);
});

test('translated prose keeps its text and punctuation while adjacent and underscored identifiers remain literal', () => {
	const html = renderToStaticMarkup(<PhotoSmartQueryGrammarHelp text="قاعدة *kind**all*؛ Verwende *capture-time* und *Mixed_case*: null." />);
	assert.equal(prose(html), '<p>قاعدة <code>kind</code><code>all</code>؛ Verwende <code>capture-time</code> und <code>Mixed_case</code>: null.</p>');
});

test('arbitrary prose is React text and cannot publish HTML or execute attributes', () => {
	const text = 'Keep <script>alert("x")</script> & <img onerror="run()">; *kind*.';
	const html = renderToStaticMarkup(<PhotoSmartQueryGrammarHelp text={text} />);
	assert.equal(prose(html), '<p>Keep &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img onerror=&quot;run()&quot;&gt;; <code>kind</code>.</p>');
	assert.doesNotMatch(html, /<script|<img|dangerouslySetInnerHTML/u);
});

test('ordinary prose outside the protected identifier syntax remains unchanged', () => {
	const text = 'JSON {"kind":"all"}, 2 * 3, *1*, and *two words*.';
	assert.equal(prose(render(text)),
		'<p>JSON {&quot;kind&quot;:&quot;all&quot;}, 2 * 3, *1*, and *two words*.</p>');
});

test('help copy and identifier counts have fixed admission bounds without truncated grammar', () => {
	assert.equal(prose(render('x'.repeat(4_096))), `<p>${'x'.repeat(4_096)}</p>`);
	assert.throws(() => renderToStaticMarkup(<PhotoSmartQueryGrammarHelp text={'x'.repeat(4_097)} />), RangeError);
	const accepted = '*kind*'.repeat(128);
	assert.equal(prose(render(accepted)), `<p>${'<code>kind</code>'.repeat(128)}</p>`);
	assert.throws(() => renderToStaticMarkup(<PhotoSmartQueryGrammarHelp text={`${accepted}*kind*`} />), RangeError);
});
