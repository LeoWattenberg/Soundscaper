/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchMotionscaperDocumentation, MOTIONSCAPER_HANDBOOK_LANGUAGES } from '../desktop/motionscaper-documentation.ts';
import { HANDBOOK_LANGUAGES } from '../src/common/editor/documentation-links.ts';
const caller = { ownWindow: true, mainFrame: true, url: 'motionscaper-app://bundle/en/' };

test('Motionscaper native Help maps only its fixed handbook destinations and admitted locales', async () => {
	assert.deepEqual(MOTIONSCAPER_HANDBOOK_LANGUAGES, HANDBOOK_LANGUAGES); const opened: string[] = [];
	for (const locale of ['en', 'de', 'PT-BR', 'zz']) for (const destination of ['manual', 'tutorials']) {
		await dispatchMotionscaperDocumentation(caller, { destination, locale }, async url => { opened.push(url); });
	}
	assert.deepEqual(opened, ['', 'de/', 'pt-br/', ''].flatMap(locale => [`https://motionscaper.org/docs/${locale}`, `https://motionscaper.org/docs/${locale}first-project/`]));
});

test('Motionscaper native Help rejects foreign callers, subframes, URLs and excess fields before opening', async () => {
	let opens = 0; const open = async () => { opens++; };
	for (const untrusted of [{ ...caller, ownWindow: false }, { ...caller, mainFrame: false }, { ...caller, url: 'https://motionscaper.org/' }, { ...caller, url: 'framescaper-app://bundle/' }]) {
		await assert.rejects(dispatchMotionscaperDocumentation(untrusted, { destination: 'manual' }, open), /Untrusted/u);
	}
	for (const value of [null, { destination: 'https://evil.example/' }, { destination: 'manual', url: 'https://evil.example/' }, { destination: 'manual', locale: '../../x' }, { destination: 'manual', locale: 3 }]) {
		await assert.rejects(dispatchMotionscaperDocumentation(caller, value, open));
	}
	assert.equal(opens, 0);
});

test('Motionscaper native Help preserves an operating-system open failure', async () => {
	const failure = new Error('system browser unavailable');
	await assert.rejects(dispatchMotionscaperDocumentation(caller, { destination: 'manual' }, async () => { throw failure; }), error => error === failure);
});
