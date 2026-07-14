import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	AUDACITY_TRANSLATION_ELIGIBILITY,
	auditQtMappingCandidates,
	buildAudacityTranslationRelease,
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

test('release packs and audits are deterministic, content-addressed, and use the 79 percent gate', () => {
	const mapping = numberedMapping(100);
	const archiveBytes = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) },
		{ name: 'audacity_de.ts', data: numberedCatalog('de', mapping, 1) },
		{ name: 'audacity_ar.ts', data: numberedCatalog('ar', mapping, 79) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', mapping, 79) },
		{ name: 'audacity_es.ts', data: numberedCatalog('es', mapping, 78) },
		{ name: 'CMakeLists.txt', data: 'ignored' },
	]);
	const options = releaseOptions({ archiveBytes, artifactId: 101, mapping, exposedLocales: ['en', 'de', 'ar', 'fr'] });
	const first = buildAudacityTranslationRelease(options);
	const second = buildAudacityTranslationRelease(options);

	assert.equal(AUDACITY_TRANSLATION_ELIGIBILITY, 0.79);
	assert.deepEqual(first.manifest.eligibleLocales, ['ar', 'de', 'en', 'fr']);
	assert.deepEqual(first.manifest.pendingLocales, []);
	assert.equal(first.manifest.locales.ar.direction, 'rtl');
	assert.equal(first.manifest.locales.ar.name, 'العربية');
	assert.equal(first.manifest.locales.fr.name, 'Français');
	assert.equal(first.manifest.locales.ar.coverage, 0.79);
	assert.equal(first.manifest.locales.es.coverage, 0.78);
	assert.equal(first.manifest.locales.es.eligible, false);
	assert.equal(first.manifest.locales.de.eligible, true);
	assert.equal(first.manifest.locales.en.eligible, true);
	assert.equal(first.manifest.artifactId, 101);
	assert.equal(first.manifest.source.runId, 123456);
	assert.deepEqual(first.manifest.provenance, {
		licenseSpdx: 'GPL-3.0-only',
		upstreamProjectUrl: 'https://github.com/audacity/audacity',
		upstreamLicenseUrl: `https://github.com/audacity/audacity/blob/${'b'.repeat(40)}/LICENSE.txt`,
		soundscaperProjectUrl: 'https://github.com/LeoWattenberg/Soundscaper',
		modificationNotice: 'Soundscaper converts reviewed Audacity Qt TS messages to per-locale JSON packs, excludes unsafe or inapplicable entries, adapts reviewed placeholders and mnemonics, and removes ellipsis punctuation.',
	});
	assert.match(first.manifest.normalizedContentSha256, /^[a-f0-9]{64}$/u);

	assert.deepEqual([...first.files.keys()].sort(), [...second.files.keys()].sort());
	for (const [filePath, bytes] of first.files) assert.deepEqual(bytes, second.files.get(filePath), filePath);
	for (const [locale, descriptor] of Object.entries(first.manifest.locales)) {
		assert.equal(descriptor.path, `packs/${descriptor.sha256}.json`);
		assert.equal(descriptor.byteLength, first.files.get(descriptor.path).byteLength);
		const pack = JSON.parse(first.files.get(descriptor.path));
		assert.deepEqual(Object.keys(pack).sort(), ['locale', 'messages', 'schemaVersion']);
		assert.equal(pack.locale, locale);
		assert.ok(Object.values(pack.messages).every((value) => !/…|\.{3}/u.test(value)));
	}
	assertEveryReleaseFileIsReferenced(first);
});

test('normalized content changes when mapping coverage changes but pack messages do not', () => {
	const firstMapping = numberedMapping(5);
	const secondMapping = numberedMapping(6);
	const firstArchive = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', firstMapping, 0) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', firstMapping, 4) },
	]);
	const secondArchive = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', secondMapping, 0) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', secondMapping, 4) },
	]);
	const first = buildAudacityTranslationRelease(releaseOptions({
		archiveBytes: firstArchive,
		artifactId: 111,
		mapping: firstMapping,
		exposedLocales: ['en', 'de', 'fr'],
	}));
	const second = buildAudacityTranslationRelease(releaseOptions({
		archiveBytes: secondArchive,
		artifactId: 112,
		mapping: secondMapping,
		exposedLocales: ['en', 'de', 'fr'],
	}));

	assert.equal(first.manifest.locales.fr.sha256, second.manifest.locales.fr.sha256);
	assert.equal(first.manifest.locales.fr.eligible, true);
	assert.equal(second.manifest.locales.fr.eligible, false);
	assert.equal(first.manifest.locales.fr.total, 5);
	assert.equal(second.manifest.locales.fr.total, 6);
	assert.notEqual(first.manifest.normalizedContentSha256, second.manifest.normalizedContentSha256);
});

test('normalized content changes when an eligible pending locale gains a static route', () => {
	const mapping = numberedMapping(5);
	const archiveBytes = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', mapping, 4) },
	]);
	const pending = buildAudacityTranslationRelease(releaseOptions({
		archiveBytes,
		artifactId: 121,
		mapping,
		exposedLocales: ['en', 'de'],
	}));
	const exposed = buildAudacityTranslationRelease(releaseOptions({
		archiveBytes,
		artifactId: 122,
		mapping,
		exposedLocales: ['en', 'de', 'fr'],
	}));

	assert.equal(pending.manifest.locales.fr.sha256, exposed.manifest.locales.fr.sha256);
	assert.deepEqual(pending.manifest.pendingLocales, ['fr']);
	assert.deepEqual(exposed.manifest.pendingLocales, []);
	assert.notEqual(pending.manifest.normalizedContentSha256, exposed.manifest.normalizedContentSha256);
});

test('a previously exposed locale retains its verified pack when coverage regresses', () => {
	const mapping = numberedMapping(5);
	const previousArchive = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', mapping, 4) },
	]);
	const previous = buildAudacityTranslationRelease(releaseOptions({
		archiveBytes: previousArchive,
		artifactId: 201,
		mapping,
		exposedLocales: ['en', 'de', 'fr'],
	}));
	const previousLocales = Object.fromEntries(Object.entries(previous.manifest.locales).map(([locale, descriptor]) => {
		const { mapped: _mapped, total: _total, ...latestDescriptor } = descriptor;
		return [locale, latestDescriptor];
	}));
	const previousRelease = {
		latest: {
			schemaVersion: 1,
			mappingVersion: previous.manifest.conversion.mappingVersion,
			mappingSha256: previous.manifest.conversion.mappingSha256,
			locales: previousLocales,
		},
		packs: new Map([...previous.files].filter(([filePath]) => filePath.startsWith('packs/'))),
	};
	const currentArchive = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', mapping, 0) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', mapping, 3) },
	]);
	const current = buildAudacityTranslationRelease({
		...releaseOptions({ archiveBytes: currentArchive, artifactId: 202, mapping, exposedLocales: ['en', 'de', 'fr'] }),
		previousRelease,
	});

	assert.equal(current.manifest.locales.fr.sha256, previous.manifest.locales.fr.sha256);
	assert.equal(current.manifest.locales.fr.coverage, 0.8);
	assert.equal(current.manifest.locales.fr.retained, true);
	assert.deepEqual(current.manifest.retainedLocales, ['fr']);
	assert.equal(current.audit.locales.fr.coverage, 0.6);
	assert.equal(current.audit.locales.fr.retainedCoverage, 0.8);
	assertEveryReleaseFileIsReferenced(current);
});

test('a changed mapping identity prevents retention of a stale same-key pack', () => {
	const previousMapping = numberedMapping(5);
	const previousArchive = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', previousMapping, 0) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', previousMapping, 4) },
	]);
	const previous = buildAudacityTranslationRelease(releaseOptions({
		archiveBytes: previousArchive,
		artifactId: 301,
		mapping: previousMapping,
		exposedLocales: ['en', 'de', 'fr'],
	}));
	const currentMapping = previousMapping.map((entry, index) => index === 0
		? { ...entry, source: 'Repurposed source' }
		: entry);
	const currentArchive = makeStoredZip([
		{ name: 'audacity_en.ts', data: numberedCatalog('en_US', currentMapping, 0) },
		{ name: 'audacity_fr.ts', data: numberedCatalog('fr', currentMapping, 3) },
	]);
	const current = buildAudacityTranslationRelease({
		...releaseOptions({ archiveBytes: currentArchive, artifactId: 302, mapping: currentMapping, exposedLocales: ['en', 'de', 'fr'] }),
		previousRelease: {
			latest: {
				schemaVersion: 1,
				mappingVersion: previous.manifest.conversion.mappingVersion,
				mappingSha256: previous.manifest.conversion.mappingSha256,
				locales: previous.manifest.locales,
			},
			packs: new Map([...previous.files].filter(([filePath]) => filePath.startsWith('packs/'))),
		},
	});

	assert.notEqual(current.manifest.conversion.mappingSha256, previous.manifest.conversion.mappingSha256);
	assert.notEqual(current.manifest.locales.fr.sha256, previous.manifest.locales.fr.sha256);
	assert.equal(current.manifest.locales.fr.coverage, 0.6);
	assert.equal(current.manifest.locales.fr.eligible, false);
	assert.equal(current.manifest.locales.fr.retained, undefined);
	assert.deepEqual(current.manifest.retainedLocales, []);
	assertEveryReleaseFileIsReferenced(current);
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

function releaseOptions({ archiveBytes, artifactId, mapping, exposedLocales }) {
	return {
		archiveBytes,
		licenseBytes: Buffer.from('GNU GENERAL PUBLIC LICENSE\nVersion 3\n'),
		mapping,
		exposedLocales,
		source: {
			artifactId,
			archiveName: `Audacity_locale_${artifactId}.zip`,
			expectedSha256: sha256(archiveBytes),
			expectedByteLength: archiveBytes.byteLength,
			repository: 'audacity/audacity',
			runId: 123456,
			headSha: 'b'.repeat(40),
			workflowUrl: 'https://github.com/audacity/audacity/actions/runs/123456',
		},
		conversion: {
			toolRevision: 'a'.repeat(40),
			convertedAt: '2026-07-14T12:00:00.000Z',
		},
	};
}

function numberedMapping(count) {
	return Array.from({ length: count }, (_, index) => ({
		key: `key${String(index).padStart(3, '0')}`,
		context: 'main',
		source: `Source ${index}`,
		comment: '',
	}));
}

function numberedCatalog(locale, mapping, finishedCount) {
	const messages = mapping.map((entry, index) => `<message><source>${entry.source}</source><translation${index < finishedCount ? '' : ' type="unfinished"'}>Translation ${index}...</translation></message>`).join('');
	return `<?xml version="1.0"?><!DOCTYPE TS><TS version="2.1" language="${locale}"><context><name>main</name>${messages}</context></TS>`;
}

function assertEveryReleaseFileIsReferenced(release) {
	const referenced = new Set([
		release.manifestPath,
		release.manifest.source.archive.path,
		release.manifest.source.license.path,
		release.manifest.audit.path,
		...Object.values(release.manifest.locales).map((descriptor) => descriptor.path),
	]);
	assert.deepEqual([...release.files.keys()].sort(), [...referenced].sort());
}

function makeStoredZip(files) {
	const localRecords = [];
	const centralRecords = [];
	let localOffset = 0;
	for (const file of files) {
		const name = Buffer.from(file.name, 'utf8');
		const data = Buffer.from(file.data);
		const checksum = crc32(data);
		const local = Buffer.alloc(30 + name.byteLength + data.byteLength);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(data.byteLength, 18);
		local.writeUInt32LE(data.byteLength, 22);
		local.writeUInt16LE(name.byteLength, 26);
		name.copy(local, 30);
		data.copy(local, 30 + name.byteLength);
		localRecords.push(local);

		const central = Buffer.alloc(46 + name.byteLength);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE((3 << 8) | 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(data.byteLength, 20);
		central.writeUInt32LE(data.byteLength, 24);
		central.writeUInt16LE(name.byteLength, 28);
		central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
		central.writeUInt32LE(localOffset, 42);
		name.copy(central, 46);
		centralRecords.push(central);
		localOffset += local.byteLength;
	}
	const centralOffset = localOffset;
	const centralSize = centralRecords.reduce((total, record) => total + record.byteLength, 0);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(files.length, 8);
	eocd.writeUInt16LE(files.length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(centralOffset, 16);
	return Buffer.concat([...localRecords, ...centralRecords, eocd]);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}
