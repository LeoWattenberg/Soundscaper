/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readTranslationCatalog, writeTranslationCatalog } from '../scripts/i18n-ai/catalog.mjs';
import { machineTranslatableLocales, parseCliArguments, runCli } from '../scripts/i18n-ai/cli.mjs';
import {
	MACHINE_TRANSLATION_SYSTEM_PROMPT,
	targetLanguageName,
	translationPacket,
	validateTranslationResponse,
} from '../scripts/i18n-ai/prompt.mjs';
import {
	MACHINE_TRANSLATION_EXCLUDED_KEYS,
	batches,
	checkLocales,
	defaultModelForLocale,
	loadGlossary,
	translateLocale,
} from '../scripts/i18n-ai/workflows.mjs';

const ENGLISH = Object.freeze({
	addTrack: 'Add track',
	bandNumber: 'Band {number}',
	fileMenu: 'File',
	stop: 'Stop',
	zoomIn: 'Zoom in',
});
const GERMAN = Object.freeze({
	addTrack: 'Spur hinzufügen',
	bandNumber: 'Band {number}',
	fileMenu: 'Datei',
	stop: 'Stopp',
	zoomIn: 'Vergrößern',
});
const PROVENANCE = { model: 'qwen3.8:latest', modelDigest: 'sha256:model', promptVersion: 'i18n-machine-v1' };

function fakeClient(answer) {
	const requests = [];
	return {
		requests,
		async identity() {
			return { model: 'qwen3.8:latest', digest: 'sha256:model' };
		},
		async generateJson(request) {
			requests.push(request);
			const packet = JSON.parse(request.prompt.split('\n\nPrevious response failed validation:')[0]);
			return answer(packet, requests.length, request);
		},
	};
}

function frenchAnswer(packet) {
	const french = {
		addTrack: 'Ajouter une piste',
		bandNumber: 'Bande {number}',
		fileMenu: 'Fichier',
		stop: 'Arrêter',
		zoomIn: 'Zoom avant',
	};
	return { locale: packet.targetLocale, translations: Object.fromEntries(Object.keys(packet.messages).map((key) => [key, french[key]])) };
}

async function scratch() {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-i18n-ai-'));
	return { directory, cacheDirectory: join(directory, 'cache') };
}

test('the packet is closed: English messages, the German reference, the glossary and the language name', () => {
	const packet = JSON.parse(translationPacket({
		targetLocale: 'fr',
		targetLanguage: targetLanguageName('fr'),
		glossary: [{ key: 'stop', english: 'Stop', translation: 'Arrêter', extra: 'dropped' }],
		reference: { stop: 'Stopp' },
		messages: { stop: 'Stop' },
	}));
	assert.deepEqual(packet, {
		sourceLocale: 'en',
		targetLocale: 'fr',
		targetLanguage: 'French',
		glossary: [{ english: 'Stop', translation: 'Arrêter' }],
		reference: { stop: 'Stopp' },
		messages: { stop: 'Stop' },
	});
	assert.equal(targetLanguageName('zh-CN'), 'Chinese (China)');
	assert.match(MACHINE_TRANSLATION_SYSTEM_PROMPT, /\{name\}/u);
	assert.match(MACHINE_TRANSLATION_SYSTEM_PROMPT, /ellipsis/u);
});

test('an answer must carry exactly the requested keys with acceptable strings', () => {
	const messages = { bandNumber: 'Band {number}', stop: 'Stop' };
	const ok = validateTranslationResponse({ locale: 'fr', translations: { bandNumber: ' Bande {number} ', stop: 'Arrêter' } }, { targetLocale: 'fr', messages });
	assert.deepEqual(ok, { bandNumber: 'Bande {number}', stop: 'Arrêter' });
	const rejects = (response, pattern) => assert.throws(() => validateTranslationResponse(response, { targetLocale: 'fr', messages }), pattern);
	rejects(null, /JSON object/u);
	rejects({ locale: 'es', translations: {} }, /locale must be "fr"/u);
	rejects({ locale: 'fr' }, /"translations" object/u);
	rejects({ locale: 'fr', translations: { stop: 'Arrêter' } }, /Missing translations for: bandNumber/u);
	rejects({ locale: 'fr', translations: { bandNumber: 'Bande {number}', stop: 'Arrêter', extra: 'x' } }, /Unexpected keys: extra/u);
	rejects({ locale: 'fr', translations: { bandNumber: 'Bande {number}', stop: 42 } }, /"stop" must be a string/u);
	rejects({ locale: 'fr', translations: { bandNumber: 'Bande {number}', stop: '  ' } }, /"stop" must not be empty/u);
	assert.deepEqual(
		validateTranslationResponse({ locale: 'fr', translations: { bandNumber: 'Bande {number}', stop: 'Enregistrer sous…' } }, { targetLocale: 'fr', messages }).stop,
		'Enregistrer sous',
	);
	assert.equal(validateTranslationResponse({ locale: 'fr', translations: { bandNumber: 'Bande {number}', stop: 'Arrêter... ' } }, { targetLocale: 'fr', messages }).stop, 'Arrêter');
	rejects({ locale: 'fr', translations: { bandNumber: 'Bande {number}', stop: '…' } }, /must not be empty/u);
	rejects({ locale: 'fr', translations: { bandNumber: 'Bande {numéro}', stop: 'Arrêter' } }, /"bandNumber" must keep the placeholders/u);
	rejects({ locale: 'fr', translations: { bandNumber: 'Bande {number}', stop: 'Arrêter\nmaintenant' } }, /one line/u);
	rejects({ locale: 'fr', translations: { bandNumber: 'Bande {number}', stop: 'A'.repeat(200) } }, /far longer/u);
});

test('a first run translates every key in sorted batches and writes the catalog and index', async () => {
	const { directory, cacheDirectory } = await scratch();
	const client = fakeClient(frenchAnswer);
	const lines = [];
	const summary = await translateLocale({
		locale: 'fr',
		client,
		cacheDirectory,
		directory,
		englishCopy: ENGLISH,
		germanCopy: GERMAN,
		glossary: [{ key: 'stop', english: 'Stop', translation: 'Arrêter' }],
		batchSize: 2,
		log: (line) => lines.push(line),
	});
	assert.deepEqual({ ...summary, skipped: [...summary.skipped] }, {
		locale: 'fr', retained: 0, orphaned: 0, pending: 5, translated: 5, skipped: [], requests: 3, cached: 0,
	});
	assert.equal(client.requests.length, 3);
	const packets = client.requests.map((request) => JSON.parse(request.prompt));
	assert.deepEqual(packets.map((packet) => Object.keys(packet.messages)), [['addTrack', 'bandNumber'], ['fileMenu', 'stop'], ['zoomIn']]);
	assert.deepEqual(packets[1].reference, { fileMenu: 'Datei', stop: 'Stopp' });
	assert.deepEqual(packets[0].reference, { addTrack: 'Spur hinzufügen' });
	assert.deepEqual(packets[0].glossary, [{ english: 'Stop', translation: 'Arrêter' }]);
	assert.equal(packets[0].targetLanguage, 'French');
	assert.equal(client.requests[0].system, MACHINE_TRANSLATION_SYSTEM_PROMPT);
	const catalog = await readTranslationCatalog('fr', directory);
	assert.deepEqual(catalog.provenance, { machine: PROVENANCE });
	assert.deepEqual(catalog.entries, {
		addTrack: ['machine', 'Add track', 'Ajouter une piste'],
		bandNumber: ['machine', 'Band {number}', 'Bande {number}'],
		fileMenu: ['machine', 'File', 'Fichier'],
		stop: ['machine', 'Stop', 'Arrêter'],
		zoomIn: ['machine', 'Zoom in', 'Zoom avant'],
	});
	assert.match(await readFile(join(directory, 'index.js'), 'utf8'), /fr: \(\) => import\('\.\/fr\.json'/u);
	assert.equal(lines.length, 3);
	assert.match(lines[2], /fr: 5\/5 pending keys handled \(5 translated, 0 skipped\)/u);
});

test('a later run sends only stale and missing keys, keeps current ones, drops orphans and reuses the cache', async () => {
	const { directory, cacheDirectory } = await scratch();
	await writeTranslationCatalog({
		locale: 'fr',
		provenance: { machine: PROVENANCE },
		entries: {
			addTrack: ['machine', 'Add track', 'Ajouter une piste'],
			fileMenu: ['machine', 'File (old)', 'Fichier (vieux)'],
			retired: ['machine', 'Retired', 'Retraité'],
			stop: ['machine', 'Stop', 'Arrêter'],
		},
	}, directory);
	const client = fakeClient(frenchAnswer);
	const summary = await translateLocale({ locale: 'fr', client, cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 10 });
	assert.deepEqual({ ...summary, skipped: [...summary.skipped] }, {
		locale: 'fr', retained: 2, orphaned: 1, pending: 3, translated: 3, skipped: [], requests: 1, cached: 0,
	});
	assert.deepEqual(Object.keys(JSON.parse(client.requests[0].prompt).messages), ['bandNumber', 'fileMenu', 'zoomIn']);
	const catalog = await readTranslationCatalog('fr', directory);
	assert.deepEqual(Object.keys(catalog.entries), ['addTrack', 'bandNumber', 'fileMenu', 'stop', 'zoomIn']);
	assert.deepEqual(catalog.entries.fileMenu, ['machine', 'File', 'Fichier']);

	await writeTranslationCatalog({ locale: 'fr', provenance: { machine: PROVENANCE }, entries: { addTrack: ['machine', 'Add track', 'Ajouter une piste'], stop: ['machine', 'Stop', 'Arrêter'] } }, directory);
	const replay = await translateLocale({ locale: 'fr', client, cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 10 });
	assert.equal(replay.cached, 1);
	assert.equal(replay.requests, 0);
	assert.equal(replay.translated, 3);
	assert.equal(client.requests.length, 1);

	const settled = await translateLocale({ locale: 'fr', client, cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN });
	assert.equal(settled.pending, 0);
	assert.equal(client.requests.length, 1);
});

test('a batch the model cannot answer is retried with feedback, then split until the one bad key is skipped', async () => {
	const { directory, cacheDirectory } = await scratch();
	const client = fakeClient((packet) => {
		const answer = frenchAnswer(packet);
		if (Object.hasOwn(packet.messages, 'bandNumber')) answer.translations.bandNumber = 'Bande {numero}';
		return answer;
	});
	const summary = await translateLocale({ locale: 'fr', client, cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 4 });
	assert.equal(summary.translated, 4);
	assert.deepEqual([...summary.skipped].map(({ key }) => key), ['bandNumber']);
	assert.match(summary.skipped[0].reason, /placeholders/u);
	assert.match(client.requests[1].prompt, /Previous response failed validation: "bandNumber" must keep the placeholders/u);
	const catalog = await readTranslationCatalog('fr', directory);
	assert.deepEqual(Object.keys(catalog.entries), ['addTrack', 'fileMenu', 'stop', 'zoomIn']);
});

test('endpoint failures stop the run and leave the batches already written', async () => {
	const { directory, cacheDirectory } = await scratch();
	const client = fakeClient((packet, count) => {
		if (count === 2) throw new Error('Ollama generation returned HTTP 500.');
		return frenchAnswer(packet);
	});
	await assert.rejects(
		() => translateLocale({ locale: 'fr', client, cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 2 }),
		/HTTP 500/u,
	);
	const catalog = await readTranslationCatalog('fr', directory);
	assert.deepEqual(Object.keys(catalog.entries), ['addTrack', 'bandNumber']);
});

const AUDACITY = {
	repository: 'audacity/audacity', headSha: 'a'.repeat(40), runId: 1, artifactId: 2, workflowUrl: 'https://github.com/audacity/audacity/actions/runs/1',
	archiveName: 'Audacity_locale_1.zip', archiveSha256: 'b'.repeat(64), archiveByteLength: 3, licenseSpdx: 'GPL-3.0-only',
	upstreamProjectUrl: 'https://github.com/audacity/audacity', upstreamLicenseUrl: 'https://github.com/audacity/audacity/blob/a/LICENSE.txt',
	modificationNotice: 'converted', mappingVersion: 2, mappingSha256: 'c'.repeat(64),
};

test('the glossary is the Audacity entries of the locale\'s own catalog, keyed to what differs from English', async () => {
	const { directory } = await scratch();
	await writeTranslationCatalog({
		locale: 'fr',
		provenance: { audacity: AUDACITY, machine: PROVENANCE },
		entries: { addTrack: ['machine', 'Add track', 'Ajouter une piste'], fileMenu: ['human', 'File', 'Fichier'], stop: ['audacity', 'Stop', 'Arrêter'], zoomIn: ['audacity', 'Zoom in', 'Zoom in'] },
	}, directory);
	assert.deepEqual(await loadGlossary({ locale: 'fr', directory, englishCopy: ENGLISH }), [{ key: 'stop', english: 'Stop', translation: 'Arrêter' }]);
	assert.deepEqual(await loadGlossary({ locale: 'pl', directory, englishCopy: ENGLISH }), []);
	assert.ok((await loadGlossary({ locale: 'fr', englishCopy: { ...ENGLISH, ...Object.fromEntries(['play', 'stop'].map((key) => [key, key])) } })).length >= 1, 'the committed catalog serves the real glossary');
});

test('human and Audacity entries survive a machine run untouched, and a stale human entry waits for a person', async () => {
	const { directory, cacheDirectory } = await scratch();
	await writeTranslationCatalog({
		locale: 'fr',
		provenance: { audacity: AUDACITY, machine: { ...PROVENANCE, model: 'older-model' } },
		entries: {
			addTrack: ['audacity', 'Add track', 'Ajouter une piste (Audacity)'],
			bandNumber: ['human', 'Band {number} (old)', 'Bande {number} (à la main)'],
			fileMenu: ['human', 'File', 'Fichier (à la main)'],
			stop: ['audacity', 'Stop (old)', 'Arrêter (Audacity)'],
			zoomIn: ['machine', 'Zoom in (old)', 'Zoom avant (vieux)'],
		},
	}, directory);
	const client = fakeClient(frenchAnswer);
	const summary = await translateLocale({ locale: 'fr', client, cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 10 });
	assert.deepEqual({ ...summary, skipped: [...summary.skipped] }, {
		locale: 'fr', retained: 2, orphaned: 0, pending: 2, translated: 2, skipped: [], requests: 1, cached: 0,
	});
	assert.deepEqual(Object.keys(JSON.parse(client.requests[0].prompt).messages), ['stop', 'zoomIn']);
	const catalog = await readTranslationCatalog('fr', directory);
	assert.deepEqual(catalog.entries, {
		addTrack: ['audacity', 'Add track', 'Ajouter une piste (Audacity)'],
		bandNumber: ['human', 'Band {number} (old)', 'Bande {number} (à la main)'],
		fileMenu: ['human', 'File', 'Fichier (à la main)'],
		stop: ['machine', 'Stop', 'Arrêter'],
		zoomIn: ['machine', 'Zoom in', 'Zoom avant'],
	});
	assert.deepEqual(catalog.provenance, { machine: PROVENANCE, audacity: AUDACITY });
	const [report] = await checkLocales({ locales: ['fr'], directory, englishCopy: ENGLISH });
	assert.deepEqual(report.origins, { machine: 2, audacity: 1, human: 1 });
	assert.equal(report.stale, 1);
});

test('check reports each catalog against the English copy and names an invalid file', async () => {
	const { directory } = await scratch();
	await writeTranslationCatalog({ locale: 'fr', provenance: { machine: PROVENANCE }, entries: { addTrack: ['machine', 'Add track', 'Ajouter une piste'], fileMenu: ['machine', 'File (old)', 'Fichier'], gone: ['machine', 'Gone', 'Parti'] } }, directory);
	const { writeFile } = await import('node:fs/promises');
	await writeFile(join(directory, 'es.json'), '{"schemaVersion":2,"locale":"es","provenance":{},"entries":{"a":["A","a"]}}\n');
	const reports = await checkLocales({ locales: ['fr', 'es', 'pl'], directory, englishCopy: ENGLISH });
	assert.deepEqual(reports[0], { locale: 'fr', present: true, model: 'qwen3.8:latest', current: 1, origins: { machine: 1, audacity: 0, human: 0 }, stale: 1, missing: 3, orphaned: 1, outdated: false, invalid: null });
	assert.equal(reports[1].locale, 'es');
	assert.match(reports[1].invalid, /triple/u);
	assert.deepEqual(reports[2], { locale: 'pl', present: false, model: null, current: 0, origins: { machine: 0, audacity: 0, human: 0 }, stale: 0, missing: 5, orphaned: 0, outdated: false, invalid: null });
});

test('batches are bounded by key count and by the characters the answer has to echo', () => {
	const english = { a: 'x'.repeat(10), b: 'y'.repeat(10), c: 'z'.repeat(30), d: 'w' };
	assert.deepEqual(batches(['a', 'b', 'c', 'd'], english, 10, 25), [['a', 'b'], ['c'], ['d']]);
	assert.deepEqual(batches(['a', 'b', 'c', 'd'], english, 2, 1000), [['a', 'b'], ['c', 'd']]);
	assert.deepEqual(batches([], english, 2, 1000), []);
	assert.deepEqual(batches(['c'], english, 2, 5), [['c']]);
});

test('a batch that outruns the request timeout is halved instead of ending the run', async () => {
	const { directory, cacheDirectory } = await scratch();
	const client = fakeClient((packet) => {
		if (Object.keys(packet.messages).length > 2) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		return frenchAnswer(packet);
	});
	const summary = await translateLocale({ locale: 'fr', client, cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 5 });
	assert.equal(summary.translated, 5);
	assert.deepEqual([...summary.skipped], []);
	// 5 keys time out, 3 keys time out, then 2, 1 and 2 keys answer.
	assert.equal(client.requests.length, 5);
	assert.equal(summary.requests, 5);
});

test('keys whose English is code stay untranslated, and an outdated prompt regenerates everything', async () => {
	const { directory, cacheDirectory } = await scratch();
	const english = { ...ENGLISH, nyquistPromptDefault: '; Enter a Nyquist expression.\n(mult *track* 0.5)' };
	assert.deepEqual([...MACHINE_TRANSLATION_EXCLUDED_KEYS], ['nyquistPromptDefault']);
	await writeTranslationCatalog({
		locale: 'fr',
		provenance: { machine: { ...PROVENANCE, promptVersion: 'i18n-machine-v0' } },
		entries: { nyquistPromptDefault: ['machine', english.nyquistPromptDefault, '; Saisissez une expression Nyquist.\n(mult *track* 0.5)'], stop: ['machine', 'Stop', 'Arrêter'] },
	}, directory);
	const client = fakeClient(frenchAnswer);
	const summary = await translateLocale({ locale: 'fr', client, cacheDirectory, directory, englishCopy: english, germanCopy: GERMAN, batchSize: 10 });
	assert.equal(summary.pending, 5);
	assert.equal(summary.translated, 5);
	const packet = JSON.parse(client.requests[0].prompt);
	assert.deepEqual(Object.keys(packet.messages), ['addTrack', 'bandNumber', 'fileMenu', 'stop', 'zoomIn']);
	const catalog = await readTranslationCatalog('fr', directory);
	assert.equal(catalog.provenance.machine.promptVersion, 'i18n-machine-v1');
	assert.ok(!Object.hasOwn(catalog.entries, 'nyquistPromptDefault'));
	assert.deepEqual(catalog.entries.stop, ['machine', 'Stop', 'Arrêter']);
});

test('the default model is Aya where it speaks the language and the general model elsewhere', () => {
	assert.equal(defaultModelForLocale('fr'), 'aya-expanse:32b');
	assert.equal(defaultModelForLocale('zh-CN'), 'aya-expanse:32b');
	assert.equal(defaultModelForLocale('ar'), 'aya-expanse:32b');
	assert.equal(defaultModelForLocale('fi'), 'qwen3.8:latest');
	assert.equal(defaultModelForLocale('gl'), 'qwen3.8:latest');
	assert.equal(defaultModelForLocale('hy'), 'qwen3.8:latest');
});

test('the command line parses both commands and refuses contradictory options', () => {
	assert.deepEqual(parseCliArguments(['translate', '--locale', 'fr,es', '--model', 'aya-expanse:32b', '--batch-size', '20', '--no-glossary', '--keys', 'a,b']), {
		command: 'translate', all: false, strict: false, glossary: false, locales: ['fr', 'es'], model: 'aya-expanse:32b', batchSize: 20, keys: ['a', 'b'],
	});
	assert.deepEqual(parseCliArguments(['translate', '--all']), { command: 'translate', all: true, strict: false, glossary: true });
	assert.deepEqual(parseCliArguments(['check', '--strict']), { command: 'check', all: false, strict: true, glossary: true });
	assert.throws(() => parseCliArguments(['translate']), /needs --locale or --all/u);
	assert.throws(() => parseCliArguments(['translate', '--all', '--locale', 'fr']), /cannot be combined/u);
	assert.throws(() => parseCliArguments(['translate', '--locale']), /Missing value/u);
	assert.throws(() => parseCliArguments(['bogus']), /Usage/u);
	assert.deepEqual(machineTranslatableLocales(['en', 'de', 'en-GB', 'fr', 'zh-CN']), ['fr', 'zh-CN']);
});

test('the command line translates with an injected client and reports per locale', async () => {
	const { directory } = await scratch();
	const out = [];
	const err = [];
	const summaries = await runCli(['translate', '--locale', 'fr', '--no-glossary', '--cache-dir', join(directory, 'cache'), '--keys', 'stop,fileMenu'], {
		client: fakeClient(frenchAnswer),
		directory,
		stdout: { write: (text) => out.push(text) },
		stderr: { write: (text) => err.push(text) },
		env: {},
	});
	assert.equal(summaries.length, 1);
	assert.equal(summaries[0].translated, 2);
	assert.match(out.join(''), /^fr: translated 2, retained 0, skipped 0, dropped 0 orphaned \(1 requests, 0 cached\)\n$/u);
	const reports = await runCli(['check', '--locale', 'fr'], { directory, stdout: { write: (text) => out.push(text) }, env: {} });
	assert.equal(reports[0].current, 2);
	assert.match(out.at(-1), /^fr: 2 current \(2 machine\), 0 stale, \d+ missing, 0 orphaned \(qwen3\.8:latest\)\n$/u);
	assert.match(err.join(''), /^fr: translating with aya-expanse:32b\n/u);
});

test('check and translate agree that an excluded key is neither missing nor pending', async () => {
	const { directory } = await scratch();
	const english = { ...ENGLISH, nyquistPromptDefault: '; Enter a Nyquist expression.\n(mult *track* 0.5)' };
	await writeTranslationCatalog({
		locale: 'fr',
		provenance: { machine: PROVENANCE },
		entries: Object.fromEntries(Object.keys(ENGLISH).map((key) => [key, ['machine', ENGLISH[key], `fr:${ENGLISH[key]}`]])),
	}, directory);
	const [report] = await checkLocales({ locales: ['fr'], directory, englishCopy: english });
	assert.equal(report.missing, 0);
	assert.equal(report.current, 5);
	const summary = await translateLocale({ locale: 'fr', client: fakeClient(() => { throw new Error('must not be asked'); }), directory, englishCopy: english, germanCopy: GERMAN });
	assert.equal(summary.pending, 0);
});

test('orphans and excluded entries are dropped even when nothing is pending, under the existing provenance', async () => {
	const { directory } = await scratch();
	const provenance = { ...PROVENANCE, model: 'older-model' };
	await writeTranslationCatalog({
		locale: 'fr',
		provenance: { machine: provenance },
		entries: {
			...Object.fromEntries(Object.keys(ENGLISH).map((key) => [key, ['machine', ENGLISH[key], `fr:${ENGLISH[key]}`]])),
			retired: ['machine', 'Retired', 'Retraité'],
		},
	}, directory);
	const summary = await translateLocale({ locale: 'fr', client: fakeClient(() => { throw new Error('must not be asked'); }), directory, englishCopy: ENGLISH, germanCopy: GERMAN });
	assert.equal(summary.orphaned, 1);
	assert.equal(summary.requests, 0);
	const catalog = await readTranslationCatalog('fr', directory);
	assert.deepEqual(Object.keys(catalog.entries), Object.keys(ENGLISH).sort());
	assert.deepEqual(catalog.provenance, { machine: provenance });
	const [report] = await checkLocales({ locales: ['fr'], directory, englishCopy: ENGLISH });
	assert.equal(report.orphaned, 0);
});

test('an interrupted regeneration under a new prompt stays outdated until its last batch lands', async () => {
	const { directory, cacheDirectory } = await scratch();
	const old = { ...PROVENANCE, promptVersion: 'i18n-machine-v0' };
	await writeTranslationCatalog({
		locale: 'fr',
		provenance: { machine: old },
		entries: Object.fromEntries(Object.keys(ENGLISH).map((key) => [key, ['machine', ENGLISH[key], `old:${ENGLISH[key]}`]])),
	}, directory);
	const failing = fakeClient((packet, count) => {
		if (count === 2) throw new Error('Ollama generation returned HTTP 500.');
		return frenchAnswer(packet);
	});
	await assert.rejects(
		() => translateLocale({ locale: 'fr', client: failing, cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 2 }),
		/HTTP 500/u,
	);
	let catalog = await readTranslationCatalog('fr', directory);
	assert.deepEqual(catalog.provenance, { machine: old });
	assert.equal(catalog.entries.addTrack[2], 'Ajouter une piste');
	assert.equal(catalog.entries.zoomIn[2], 'old:Zoom in');
	assert.equal((await checkLocales({ locales: ['fr'], directory, englishCopy: ENGLISH }))[0].outdated, true);

	const summary = await translateLocale({ locale: 'fr', client: fakeClient(frenchAnswer), cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 2 });
	assert.equal(summary.pending, 5);
	assert.equal(summary.cached, 1);
	catalog = await readTranslationCatalog('fr', directory);
	assert.equal(catalog.provenance.machine.promptVersion, 'i18n-machine-v1');
	assert.equal(catalog.entries.zoomIn[2], 'Zoom avant');
	assert.equal((await checkLocales({ locales: ['fr'], directory, englishCopy: ENGLISH }))[0].outdated, false);
});

test('a single key that still times out stops the run instead of being skipped', async () => {
	const { directory, cacheDirectory } = await scratch();
	const client = fakeClient(() => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
	await assert.rejects(
		() => translateLocale({ locale: 'fr', client, cacheDirectory, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 4 }),
		{ name: 'TimeoutError' },
	);
	assert.equal(client.requests.length, 3);
	assert.equal(await readTranslationCatalog('fr', directory), null);
});
