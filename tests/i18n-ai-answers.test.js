/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAnswersClient, readAnswers, writeTranslationPackets } from '../scripts/i18n-ai/answers.mjs';
import { readMachineCatalog, writeMachineCatalog } from '../scripts/i18n-ai/catalog.mjs';
import { parseCliArguments, runCli } from '../scripts/i18n-ai/cli.mjs';
import { translateLocale } from '../scripts/i18n-ai/workflows.mjs';

const ENGLISH = Object.freeze({ addTrack: 'Add track', bandNumber: 'Band {number}', fileMenu: 'File', stop: 'Stop', zoomIn: 'Zoom in' });
const GERMAN = Object.freeze({ addTrack: 'Spur hinzufügen', bandNumber: 'Band {number}', fileMenu: 'Datei', stop: 'Stopp', zoomIn: 'Vergrößern' });
const PROVENANCE = { model: 'aya-expanse:32b', modelDigest: 'sha256:model', promptVersion: 'i18n-machine-v1' };

async function scratch() {
	return mkdtemp(join(tmpdir(), 'soundscaper-i18n-answers-'));
}

test('packets are the closed requests a run would send for the pending keys, one file per batch', async () => {
	const directory = await scratch();
	await writeMachineCatalog({ locale: 'fr', provenance: PROVENANCE, entries: { stop: ['Stop', 'Arrêter'] } }, directory);
	const result = await writeTranslationPackets({
		locale: 'fr',
		directory,
		outputDirectory: join(directory, 'packets'),
		englishCopy: ENGLISH,
		germanCopy: GERMAN,
		glossary: [{ key: 'stop', english: 'Stop', translation: 'Arrêter' }],
		batchSize: 3,
	});
	assert.equal(result.pending, 4);
	assert.equal(result.batches, 2);
	assert.deepEqual(await readdir(join(directory, 'packets', 'fr')), ['001.json', '002.json']);
	const first = JSON.parse(await readFile(join(directory, 'packets', 'fr', '001.json'), 'utf8'));
	assert.deepEqual(first, {
		sourceLocale: 'en',
		targetLocale: 'fr',
		targetLanguage: 'French',
		glossary: [{ english: 'Stop', translation: 'Arrêter' }],
		reference: { addTrack: 'Spur hinzufügen', fileMenu: 'Datei' },
		messages: { addTrack: 'Add track', bandNumber: 'Band {number}', fileMenu: 'File' },
	});
	const second = JSON.parse(await readFile(join(directory, 'packets', 'fr', '002.json'), 'utf8'));
	assert.deepEqual(Object.keys(second.messages), ['zoomIn']);
});

test('answers merge in file order, accept both shapes, and refuse another locale', async () => {
	const directory = await scratch();
	await mkdir(join(directory, 'fr'), { recursive: true });
	await writeFile(join(directory, 'fr', '001.json'), JSON.stringify({ locale: 'fr', translations: { addTrack: 'Ajouter une piste', stop: 'Stop!' } }));
	await writeFile(join(directory, 'fr', '002-fix.json'), JSON.stringify({ stop: 'Arrêter' }));
	const answers = await readAnswers(directory, 'fr');
	assert.deepEqual([...answers], [['addTrack', 'Ajouter une piste'], ['stop', 'Arrêter']]);
	assert.deepEqual([...await readAnswers(directory, 'es')], []);
	await writeFile(join(directory, 'fr', '003.json'), JSON.stringify({ locale: 'es', translations: {} }));
	await assert.rejects(() => readAnswers(directory, 'fr'), /for locale es/u);
});

test('the answers client serves any subset it knows and names what it does not', async () => {
	const client = createAnswersClient({ locale: 'fr', answers: new Map([['stop', 'Arrêter'], ['fileMenu', 'Fichier']]), model: 'claude-sonnet-5' });
	assert.deepEqual(await client.identity(), { model: 'claude-sonnet-5', digest: (await client.identity()).digest });
	assert.match((await client.identity()).digest, /^sha256:[a-f0-9]{64}$/u);
	const packet = JSON.stringify({ targetLocale: 'fr', messages: { stop: 'Stop', fileMenu: 'File', zoomIn: 'Zoom in' } });
	assert.deepEqual(await client.generateJson({ prompt: packet }), { locale: 'fr', translations: { stop: 'Arrêter', fileMenu: 'Fichier' } });
	assert.deepEqual(await client.generateJson({ prompt: `${packet}\n\nPrevious response failed validation: x` }), { locale: 'fr', translations: { stop: 'Arrêter', fileMenu: 'Fichier' } });
	await assert.rejects(() => client.generateJson({ prompt: JSON.stringify({ targetLocale: 'fr', messages: { zoomIn: 'Zoom in' } }) }), { name: 'InvalidModelOutputError' });
});

test('replaying answers writes a catalog under the same rules and skips only the keys the answers get wrong', async () => {
	const directory = await scratch();
	const answers = new Map([
		['addTrack', 'Ajouter une piste'],
		['bandNumber', 'Bande {numero}'],
		['fileMenu', 'Fichier'],
		['stop', 'Arrêter…'],
	]);
	const client = createAnswersClient({ locale: 'fr', answers, model: 'claude-sonnet-5' });
	const summary = await translateLocale({ locale: 'fr', client, directory, englishCopy: ENGLISH, germanCopy: GERMAN, batchSize: 10 });
	assert.equal(summary.translated, 3);
	assert.deepEqual([...summary.skipped].map(({ key }) => key), ['bandNumber', 'zoomIn']);
	assert.match(summary.skipped[0].reason, /placeholders/u);
	assert.match(summary.skipped[1].reason, /No answer/u);
	const catalog = await readMachineCatalog('fr', directory);
	assert.deepEqual(catalog.entries, {
		addTrack: ['Add track', 'Ajouter une piste'],
		fileMenu: ['File', 'Fichier'],
		stop: ['Stop', 'Arrêter'],
	});
	assert.equal(catalog.provenance.model, 'claude-sonnet-5');
});

test('the command line exports packets and replays answers for a locale', async () => {
	const directory = await scratch();
	assert.deepEqual(parseCliArguments(['packets', '--locale', 'fr', '--output', 'out']), { command: 'packets', all: false, strict: false, glossary: 'published', locales: ['fr'], output: 'out' });
	assert.throws(() => parseCliArguments(['packets', '--locale', 'fr']), /needs --output/u);
	assert.throws(() => parseCliArguments(['packets']), /needs --locale or --all/u);
	assert.equal(parseCliArguments(['translate', '--locale', 'fr', '--answers', 'answers']).answers, 'answers');
	const out = [];
	const err = [];
	const io = { directory, stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) }, env: {} };
	const [exported] = await runCli(['packets', '--locale', 'fr', '--output', join(directory, 'packets'), '--no-glossary', '--keys', 'fileMenu,stop'], io);
	assert.equal(exported.batches, 1);
	await mkdir(join(directory, 'answers', 'fr'), { recursive: true });
	await writeFile(join(directory, 'answers', 'fr', '001.json'), JSON.stringify({ locale: 'fr', translations: { fileMenu: 'Fichier', stop: 'Arrêter' } }));
	const [summary] = await runCli(['translate', '--locale', 'fr', '--answers', join(directory, 'answers'), '--model', 'claude-sonnet-5', '--no-glossary', '--keys', 'fileMenu,stop'], io);
	assert.equal(summary.translated, 2);
	assert.match(err.join(''), /fr: replaying 2 answers from .* as claude-sonnet-5/u);
	assert.equal((await readMachineCatalog('fr', directory)).provenance.model, 'claude-sonnet-5');
});
