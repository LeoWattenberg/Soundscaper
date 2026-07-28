/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ADM_AXML_MAX_BYTES,
	CHNA_ENTRY_BYTES,
	createAdmChna,
	createRiffAxmlChunk,
	createRiffChnaChunk,
	encodeAdmAxml,
	encodeChnaPayload,
	generateAdmAxml,
	normalizeAdmBedMetadata,
	parseAdmAxml,
	parseChnaPayload,
	parseRiffAxmlChunk,
	parseRiffChnaChunk,
	readAdmBedMetadata,
	validateAdmChnaConsistency,
	type AdmBedLayout,
} from '../src/common/editor/adm-metadata.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

test('authored ADM beds normalize names, language, layout, and immutable defaults', () => {
	assert.deepEqual(normalizeAdmBedMetadata(), {
		programmeName: 'Programme',
		contentName: 'Main',
		language: '',
		programmeLanguage: '',
		contentLanguage: '',
		bedName: 'Main Bed',
		layout: 'stereo',
		rawXml: '',
	});
	const normalized = normalizeAdmBedMetadata({
		programmeName: 'News & Weather',
		contentName: 'Mix',
		language: 'en-GB',
		bedName: 'Studio',
		layout: '5.1',
	});
	assert.ok(Object.isFrozen(normalized));
	assert.equal(normalized.layout, '5.1');
	assert.equal(normalized.language, 'en-GB');
	assert.equal(normalized.programmeLanguage, 'en-GB');
	assert.equal(normalized.contentLanguage, 'en-GB');
	assert.throws(() => normalizeAdmBedMetadata({ layout: '7.1' as AdmBedLayout }), /layout/u);
	for (const language of ['1n-GB', 'en--GB', 'en_GB', ' en-GB ', 'en-ThisSubtagIsTooLong']) {
		assert.throws(() => normalizeAdmBedMetadata({ language }), /BCP 47|language/u);
	}
	assert.throws(() => normalizeAdmBedMetadata({ bedName: 'bad\0name' }), /NUL|control/u);
});

test('authored ADM preserves conservative BCP 47 language tags in generated AXML', () => {
	const language = 'zh-Hant-TW';
	const xml = generateAdmAxml({ language, layout: 'mono' });
	assert.match(xml, /audioProgrammeLanguage="zh-Hant-TW"/u);
	assert.match(xml, /audioContentLanguage="zh-Hant-TW"/u);
	const parsed = parseAdmAxml(xml);
	assert.equal(parsed.programmes[0]?.language, language);
	assert.equal(parsed.contents[0]?.language, language);
	assert.equal(readAdmBedMetadata(parsed)?.language, language);
});

test('authored ADM preserves distinct programme and content languages', () => {
	const metadata = normalizeAdmBedMetadata({
		programmeLanguage: 'en-GB',
		contentLanguage: 'fr-CA',
		layout: 'mono',
	});
	assert.equal(metadata.language, '');
	assert.equal(metadata.programmeLanguage, 'en-GB');
	assert.equal(metadata.contentLanguage, 'fr-CA');
	const xml = generateAdmAxml(metadata);
	assert.match(xml, /audioProgrammeLanguage="en-GB"/u);
	assert.match(xml, /audioContentLanguage="fr-CA"/u);
	const roundTripped = readAdmBedMetadata(parseAdmAxml(xml));
	assert.equal(roundTripped?.language, '');
	assert.equal(roundTripped?.programmeLanguage, 'en-GB');
	assert.equal(roundTripped?.contentLanguage, 'fr-CA');
});

test('ADM AXML generation is deterministic and uses BS.2094-2 common definitions', () => {
	const layouts = [
		['mono', 'AP_00010001', ['AC_00010003']],
		['stereo', 'AP_00010002', ['AC_00010001', 'AC_00010002']],
		['5.1', 'AP_00010003', [
			'AC_00010001', 'AC_00010002', 'AC_00010003',
			'AC_00010004', 'AC_00010005', 'AC_00010006',
		]],
	] as const;
	for (const [layout, packRef, channelRefs] of layouts) {
		const input = {
			programmeName: 'Drama & News',
			contentName: 'Main <Mix>',
			language: 'en',
			bedName: `Bed "${layout}"`,
			layout,
		};
		const first = generateAdmAxml(input);
		assert.equal(generateAdmAxml(input), first);
		assert.match(first, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<ebuCoreMain/u);
		assert.match(first, /version="ITU-R_BS\.2076-3"/u);
		assert.match(first, /audioProgrammeID="APR_1001"/u);
		assert.match(first, /audioContentID="ACO_1001"/u);
		assert.match(first, /audioObjectID="AO_1001"/u);
		assert.ok(first.includes('Drama &amp; News'));

		const parsed = parseAdmAxml(encodeAdmAxml(input));
		assert.equal(parsed.rawXml, first);
		assert.deepEqual(parsed.programmes[0]?.contentRefs, ['ACO_1001']);
		assert.deepEqual(parsed.contents[0]?.objectRefs, ['AO_1001']);
		assert.deepEqual(parsed.objects[0]?.packRefs, [packRef]);
		assert.deepEqual(parsed.objects[0]?.trackUidRefs, channelRefs.map((_, index) => `ATU_${String(index + 1).padStart(8, '0')}`));
		assert.deepEqual(parsed.trackUids.map((track) => track.trackRef), channelRefs);
		assert.deepEqual(parsed.trackUids.map((track) => track.packRef), channelRefs.map(() => packRef));
		assert.deepEqual(readAdmBedMetadata(parsed), { ...normalizeAdmBedMetadata(input), rawXml: first });
	}
});

test('ADM AXML parser preserves safe unknown XML while rejecting active or unbounded input', () => {
	const source = generateAdmAxml({ layout: 'mono' });
	const extended = source.replace('</audioFormatExtended>', '<vendor:extension xmlns:vendor="urn:example">safe</vendor:extension>\n      </audioFormatExtended>');
	assert.equal(parseAdmAxml(extended).rawXml, extended);

	for (const xml of [
		'<!DOCTYPE x SYSTEM "https://example.invalid/adm.dtd"><audioFormatExtended/>',
		'<!DOCTYPE x [<!ENTITY exfil SYSTEM "file:///etc/passwd">]><audioFormatExtended>&exfil;</audioFormatExtended>',
		'<?xml-stylesheet href="https://example.invalid/style.xsl"?><audioFormatExtended/>',
		'<?vendor run="yes"?><audioFormatExtended/>',
	]) {
		assert.throws(() => parseAdmAxml(xml), /active|DOCTYPE|processing instruction/iu);
	}
	assert.throws(() => parseAdmAxml('<root/>'), /audioFormatExtended/u);
	assert.throws(() => parseAdmAxml('<audioFormatExtended>'), /unclosed|unexpected|document root/iu);
	assert.throws(() => parseAdmAxml(new Uint8Array([0xc3, 0x28])), /UTF-8/u);
	assert.throws(() => parseAdmAxml(new Uint8Array(ADM_AXML_MAX_BYTES + 1)), /16 MiB/u);
	const tooDeep = `<audioFormatExtended>${'<x>'.repeat(129)}${'</x>'.repeat(129)}</audioFormatExtended>`;
	assert.throws(() => parseAdmAxml(tooDeep), /depth/u);
});

test('ADM AXML validates identifiers, uniqueness, and local content references', () => {
	const base = generateAdmAxml({ layout: 'mono' });
	assert.throws(
		() => parseAdmAxml(base.replace('APR_1001', 'APR_bad')),
		/audioProgrammeID/u,
	);
	assert.throws(
		() => parseAdmAxml(base.replace('</audioProgramme>', '<audioContentIDRef>ACO_9999</audioContentIDRef></audioProgramme>')),
		/ACO_9999.*not defined/u,
	);
	assert.throws(
		() => parseAdmAxml(base.replace('</audioFormatExtended>', '<audioTrackUID UID="ATU_00000001"><audioChannelFormatIDRef>AC_00010003</audioChannelFormatIDRef><audioPackFormatIDRef>AP_00010001</audioPackFormatIDRef></audioTrackUID></audioFormatExtended>')),
		/duplicate.*ATU_00000001/iu,
	);
	assert.throws(
		() => parseAdmAxml(base.replace('<audioPackFormatIDRef>AP_00010001</audioPackFormatIDRef>', '<audioPackFormatIDRef>bad</audioPackFormatIDRef>')),
		/audioPackFormatIDRef/u,
	);
});

test('RIFF AXML helpers preserve the complete aligned chunk and validate its frame', () => {
	const metadata = normalizeAdmBedMetadata({ programmeName: 'Odd', layout: 'mono' });
	const chunk = createRiffAxmlChunk(metadata);
	const payloadBytes = new DataView(chunk.buffer).getUint32(4, true);
	assert.equal(decoder.decode(chunk.subarray(0, 4)), 'axml');
	assert.equal(chunk.byteLength, 8 + payloadBytes + (payloadBytes & 1));
	assert.deepEqual(readAdmBedMetadata(parseRiffAxmlChunk(chunk)), {
		...metadata,
		rawXml: generateAdmAxml(metadata),
	});
	const wrongId = chunk.slice();
	wrongId.set(encoder.encode('junk'), 0);
	assert.throws(() => parseRiffAxmlChunk(wrongId), /axml identifier/u);
	assert.throws(() => parseRiffAxmlChunk(chunk.subarray(0, chunk.byteLength - 1)), /truncated/u);
	if ((payloadBytes & 1) === 1) {
		const wrongPad = chunk.slice();
		wrongPad[wrongPad.byteLength - 1] = 1;
		assert.throws(() => parseRiffAxmlChunk(wrongPad), /alignment byte/u);
	}
});

test('CHNA payload uses the exact four-byte header and forty-byte AudioID records', () => {
	const chna = createAdmChna({ layout: 'stereo' });
	const payload = encodeChnaPayload(chna);
	assert.equal(CHNA_ENTRY_BYTES, 40);
	assert.equal(payload.byteLength, 4 + (2 * CHNA_ENTRY_BYTES));
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	assert.equal(view.getUint16(0, true), 2);
	assert.equal(view.getUint16(2, true), 2);
	assert.equal(view.getUint16(4, true), 1);
	assert.equal(decoder.decode(payload.subarray(6, 18)), 'ATU_00000001');
	assert.equal(decoder.decode(payload.subarray(18, 32)), 'AC_00010001_00');
	assert.equal(decoder.decode(payload.subarray(32, 43)), 'AP_00010002');
	assert.equal(payload[43], 0);
	assert.deepEqual(parseChnaPayload(payload), chna);
	assert.ok(Object.isFrozen(chna.entries));
});

test('CHNA parser supports zeroed allocation slots and rejects malformed records', () => {
	const original = encodeChnaPayload(createAdmChna({ layout: 'mono' }));
	const allocated = new Uint8Array(original.byteLength + CHNA_ENTRY_BYTES);
	allocated.set(original);
	assert.deepEqual(parseChnaPayload(allocated), createAdmChna({ layout: 'mono' }));

	const nonzeroSlot = allocated.slice();
	nonzeroSlot[nonzeroSlot.byteLength - 1] = 1;
	assert.throws(() => parseChnaPayload(nonzeroSlot), /unused CHNA allocation/u);
	assert.throws(() => parseChnaPayload(original.subarray(0, original.byteLength - 1)), /40-byte/u);

	const invalidChannelSuffix = original.slice();
	invalidChannelSuffix[4 + 14 + 13] = 0x31;
	assert.throws(() => parseChnaPayload(invalidChannelSuffix), /track reference|_00/u);

	const legacyNulPadding = original.slice();
	legacyNulPadding.fill(0, 4 + 14 + 11, 4 + 14 + 14);
	assert.throws(() => parseChnaPayload(legacyNulPadding), /track reference|_00/u);

	const invalidPadByte = original.slice();
	invalidPadByte[43] = 1;
	assert.throws(() => parseChnaPayload(invalidPadByte), /pad byte/u);

	const invalidTrack = original.slice();
	new DataView(invalidTrack.buffer).setUint16(4, 2, true);
	assert.throws(() => parseChnaPayload(invalidTrack), /track index/u);

	const invalidCount = original.slice();
	new DataView(invalidCount.buffer).setUint16(2, 2, true);
	assert.throws(() => parseChnaPayload(invalidCount), /numUIDs|allocation/u);
});

test('CHNA encoder validates identifiers, track coverage, and duplicate UIDs', () => {
	const entry = {
		trackIndex: 1,
		uid: 'ATU_00000001',
		trackRef: 'AC_00010003',
		packRef: 'AP_00010001',
	};
	assert.throws(() => encodeChnaPayload({ numTracks: 2, entries: [entry] }), /every track/u);
	assert.throws(() => encodeChnaPayload({ numTracks: 1, entries: [{ ...entry, uid: 'bad' }] }), /UID/u);
	assert.throws(() => encodeChnaPayload({ numTracks: 1, entries: [{ ...entry, trackRef: 'AS_00010001' }] }), /track reference/u);
	assert.throws(() => encodeChnaPayload({ numTracks: 1, entries: [{ ...entry, packRef: 'bad' }] }), /pack reference/u);
	assert.throws(() => encodeChnaPayload({ numTracks: 1, entries: [entry, entry] }), /duplicate CHNA UID/u);
});

test('RIFF CHNA helpers encode and parse the complete aligned chunk', () => {
	const metadata = createAdmChna({ layout: '5.1' });
	const chunk = createRiffChnaChunk(metadata);
	assert.equal(decoder.decode(chunk.subarray(0, 4)), 'chna');
	assert.equal(new DataView(chunk.buffer).getUint32(4, true), 4 + (6 * CHNA_ENTRY_BYTES));
	assert.deepEqual(parseRiffChnaChunk(chunk), metadata);
	const wrongId = chunk.slice();
	wrongId.set(encoder.encode('junk'), 0);
	assert.throws(() => parseRiffChnaChunk(wrongId), /chna identifier/u);
	assert.throws(() => parseRiffChnaChunk(chunk.subarray(0, chunk.byteLength - 1)), /truncated/u);
});

test('AXML and CHNA consistency validates UID, reference, and PCM track linkage', () => {
	const axml = parseAdmAxml(generateAdmAxml({ layout: '5.1' }));
	const chna = createAdmChna({ layout: '5.1' });
	assert.equal(validateAdmChnaConsistency(axml, chna, 6), true);

	const uidMismatch = {
		...chna,
		entries: chna.entries.map((entry, index) => index === 0 ? { ...entry, uid: 'ATU_00000010' } : entry),
	};
	assert.throws(() => validateAdmChnaConsistency(axml, uidMismatch), /ATU_00000010.*AXML/u);

	const referenceMismatch = {
		...chna,
		entries: chna.entries.map((entry, index) => index === 0 ? { ...entry, trackRef: 'AC_00010002' } : entry),
	};
	assert.throws(() => validateAdmChnaConsistency(axml, referenceMismatch), /track reference/u);
	assert.throws(() => validateAdmChnaConsistency(axml, chna, 2), /six|6.*tracks|channel count/iu);
});
