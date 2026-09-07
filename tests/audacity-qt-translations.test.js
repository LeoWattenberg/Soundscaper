import assert from 'node:assert/strict';
import test from 'node:test';

import { makeStoredZip } from './helpers/stored-zip.js';

import {
	auditQtMappingCandidates,
	convertQtCatalog,
	inspectVerifiedZip,
	normalizeQtLocale,
	parseQtTs,
	validateAudacityQtMapping,
	validateMappingAgainstSourceCatalog,
} from '../scripts/audacity-qt-translations.mjs';

test('Qt TS conversion uses exact identities and excludes unsafe translation states', () => {
	const mapping = [
		{
			key: 'open',
			context: 'menu',
			source: '&Open…',
			comment: 'project action',
			transforms: ['stripMnemonic', 'stripEllipsis'],
		},
		{
			key: 'fileCount',
			context: 'status',
			source: '%1 files',
			comment: '',
			placeholders: { '%1': '{count}' },
		},
		{ key: 'unfinished', context: 'state', source: 'Unfinished', comment: '' },
		{ key: 'vanished', context: 'state', source: 'Vanished', comment: '' },
		{ key: 'obsolete', context: 'state', source: 'Obsolete', comment: '' },
		{ key: 'fuzzy', context: 'state', source: 'Fuzzy', comment: '' },
		{ key: 'plural', context: 'state', source: '%1 item', comment: '', placeholders: { '%1': '{count}' } },
		{ key: 'mismatch', context: 'state', source: '%1 mismatch', comment: '', placeholders: { '%1': '{count}' } },
		{ key: 'ambiguous', context: 'state', source: 'Duplicate', comment: '' },
		{ key: 'branded', context: 'state', source: 'Open editor', comment: '' },
	];
	const catalog = parseQtTs(`<?xml version="1.0"?>
<!DOCTYPE TS>
<TS version="2.1" language="de_DE">
	<context><name>menu</name><message><source>&amp;Open…</source><comment>project action</comment><translation>&amp;Öffnen...</translation></message></context>
	<context><name>status</name><message><source>%1 files</source><translation>%1 Dateien</translation></message></context>
	<context><name>state</name>
		<message><source>Unfinished</source><translation type="unfinished">Unfertig</translation></message>
		<message><source>Vanished</source><translation type="vanished">Verschwunden</translation></message>
		<message><source>Obsolete</source><translation type="obsolete">Veraltet</translation></message>
		<message><source>Fuzzy</source><translation type="fuzzy">Unscharf</translation></message>
		<message numerus="yes"><source>%1 item</source><translation><numerusform>%1 Eintrag</numerusform></translation></message>
		<message><source>%1 mismatch</source><translation>%2 Fehler</translation></message>
		<message><source>Duplicate</source><translation>Erste</translation></message>
		<message><source>Duplicate</source><translation>Zweite</translation></message>
		<message><source>Open editor</source><translation>Audacity öffnen</translation></message>
	</context>
</TS>`);
	const result = convertQtCatalog(catalog, mapping);

	assert.equal(result.locale, 'de-DE');
	assert.deepEqual(result.messages, {
		fileCount: '{count} Dateien',
		open: 'Öffnen',
	});
	assert.deepEqual(result.audit, {
		mapped: 2,
		total: 10,
		coverage: 0.2,
		skipped: [
			{ key: 'ambiguous', reason: 'ambiguous' },
			{ key: 'branded', reason: 'brand' },
			{ key: 'fuzzy', reason: 'fuzzy' },
			{ key: 'mismatch', reason: 'placeholder-mismatch' },
			{ key: 'obsolete', reason: 'obsolete' },
			{ key: 'plural', reason: 'numerus' },
			{ key: 'unfinished', reason: 'unfinished' },
			{ key: 'vanished', reason: 'vanished' },
		],
	});
	assert.ok(Object.values(result.messages).every((value) => !/…|\.{3}/u.test(value)));
});

test('Qt TS parsing accepts schema entities but rejects active XML constructs and wrong schema', () => {
	const catalog = parseQtTs('<?xml version="1.0"?><!DOCTYPE TS><TS version="2.1" language="de"><context><name>A &amp; B</name><message><source>Rock &amp; Roll</source><translation>Rock &amp; Roll</translation></message></context></TS>');
	assert.equal(catalog.messages[0].context, 'A & B');
	assert.equal(catalog.messages[0].source, 'Rock & Roll');

	assert.throws(
		() => parseQtTs('<?xml version="1.0"?><!DOCTYPE TS SYSTEM "https://example.invalid/a.dtd"><TS version="2.1" language="de"/>'),
		(error) => error.code === 'QT_TS_DOCTYPE',
	);
	assert.throws(
		() => parseQtTs('<?xml version="1.0"?><!DOCTYPE TS><TS version="2.0" language="de"/>'),
		(error) => error.code === 'QT_TS_SCHEMA',
	);
	assert.throws(
		() => parseQtTs('<?xml version="1.0"?><TS version="2.1" language="de"/>'),
		(error) => error.code === 'QT_TS_SCHEMA',
	);
	assert.throws(
		() => parseQtTs('<?xml version="1.0"?><!DOCTYPE TS><TS version="2.1" language="de"><context><name>bad<b>markup</b></name></context></TS>'),
		(error) => error.code === 'QT_TS_CONTEXT_NAME_MARKUP',
	);
});

test('Qt TS conversion strips translator-introduced mnemonics from every mapped value', () => {
	const catalog = parseQtTs('<?xml version="1.0"?><!DOCTYPE TS><TS version="2.1" language="de"><context><name>menu</name><message><source>Copy</source><translation>&amp;Kopieren &amp;&amp; Einfügen</translation></message></context></TS>');
	const result = convertQtCatalog(catalog, [{
		key: 'copy', context: 'menu', source: 'Copy', comment: '',
	}]);

	assert.equal(result.messages.copy, 'Kopieren & Einfügen');
});

test('mapping validation requires explicit ellipsis and complete named-placeholder adapters', () => {
	assert.throws(
		() => validateAudacityQtMapping([{ key: 'open', context: 'menu', source: 'Open…', comment: '' }]),
		(error) => error.code === 'QT_MAPPING_ELLIPSIS',
	);
	assert.throws(
		() => validateAudacityQtMapping([{ key: 'count', context: 'status', source: '%1 files', comment: '' }]),
		(error) => error.code === 'QT_MAPPING_PLACEHOLDER',
	);
	assert.doesNotThrow(() => validateAudacityQtMapping([{
		key: 'count',
		context: 'status',
		source: '%1 files',
		comment: '',
		placeholders: { '%1': '{count}' },
	}]));
});

test('reviewed mappings fail closed when the upstream English identity disappears or duplicates', () => {
	const mapping = [{ key: 'open', context: 'menu', source: 'Open', comment: '' }];
	assert.throws(
		() => validateMappingAgainstSourceCatalog(parseQtTs('<?xml version="1.0"?><!DOCTYPE TS><TS version="2.1" language="en_US"><context><name>menu</name><message><source>Save</source><translation type="unfinished">Save</translation></message></context></TS>'), mapping),
		(error) => error.code === 'QT_MAPPING_SOURCE_MISSING',
	);
	assert.throws(
		() => validateMappingAgainstSourceCatalog(parseQtTs('<?xml version="1.0"?><!DOCTYPE TS><TS version="2.1" language="en_US"><context><name>menu</name><message><source>Open</source><translation type="unfinished">Open</translation></message><message><source>Open</source><translation type="unfinished">Open</translation></message></context></TS>'), mapping),
		(error) => error.code === 'QT_MAPPING_SOURCE_AMBIGUOUS',
	);
});

test('candidate audit records unreviewed and ambiguous exact source matches deterministically', () => {
	const source = parseQtTs('<?xml version="1.0"?><!DOCTYPE TS><TS version="2.1" language="en_US"><context><name>menu</name><message><source>Open</source><translation type="unfinished">Open</translation></message><message><source>Save</source><translation type="unfinished">Save</translation></message><message><source>Theme</source><translation type="unfinished">Theme</translation></message><message><source>Copy</source><translation type="unfinished">Copy</translation></message></context><context><name>toolbar</name><message><source>Save</source><translation type="unfinished">Save</translation></message></context></TS>');
	const result = auditQtMappingCandidates({
		chosen: 'Open',
		ambiguous: 'Save',
		unreviewed: 'Theme',
		reusedFirst: 'Copy',
		reusedSecond: 'Copy',
	}, source, [{ key: 'chosen', context: 'menu', source: 'Open', comment: '' }]);

	assert.deepEqual(result.ambiguous.map(({ key, reason, candidates }) => ({ key, reason, contexts: candidates.map((item) => item.context) })), [{
		key: 'ambiguous',
		reason: 'ambiguous-source',
		contexts: ['menu', 'toolbar'],
	}]);
	assert.deepEqual(result.skipped.map(({ key, reason }) => ({ key, reason })), [
		{ key: 'reusedFirst', reason: 'catalog-value-reused' },
		{ key: 'reusedSecond', reason: 'catalog-value-reused' },
		{ key: 'unreviewed', reason: 'not-reviewed' },
	]);
});

test('ZIP validation rejects unsafe paths, duplicates, limit breaches, and corrupt entries', () => {
	assert.throws(
		() => inspectVerifiedZip(makeStoredZip([{ name: '../audacity_de.ts', data: 'bad' }])),
		(error) => error.code === 'ZIP_UNSAFE_PATH',
	);
	assert.throws(
		() => inspectVerifiedZip(makeStoredZip([
			{ name: 'audacity_de.ts', data: 'one' },
			{ name: 'audacity_de.ts', data: 'two' },
		])),
		(error) => error.code === 'ZIP_DUPLICATE_ENTRY',
	);
	assert.throws(
		() => inspectVerifiedZip(makeStoredZip([{ name: 'audacity_de.ts', data: '12345' }]), {
			limits: { maxEntryBytes: 4 },
		}),
		(error) => error.code === 'ZIP_ENTRY_SIZE',
	);

	const corrupt = Buffer.from(makeStoredZip([{ name: 'audacity_de.ts', data: 'valid data' }]));
	corrupt[30 + Buffer.byteLength('audacity_de.ts')] ^= 0xff;
	const archive = inspectVerifiedZip(corrupt);
	assert.throws(() => archive.readEntry('audacity_de.ts'), (error) => error.code === 'ZIP_CRC_MISMATCH');
});

test('Qt locale normalization emits canonical BCP-47 tags', () => {
	assert.equal(normalizeQtLocale('pt_BR'), 'pt-BR');
	assert.equal(normalizeQtLocale('sr_RS'), 'sr-RS');
	assert.equal(normalizeQtLocale('ca@valencia'), 'ca-valencia');
	assert.equal(normalizeQtLocale('sr@latin'), 'sr-Latn');
	assert.throws(() => normalizeQtLocale('../../de'), (error) => error.code === 'QT_LOCALE');
});

