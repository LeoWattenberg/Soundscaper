/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	ADM_BED_LAYOUTS,
	admBedChannelCount,
	admBedChannelOrder,
	admBedDefinedSpeakers,
	admBedLayoutDefinition,
	admBedSpeakers,
	isAdmBedLayout,
} from '../src/common/editor/adm-bed-layout.ts';
import {
	createAdmChna,
	encodeChnaPayload,
	generateAdmAxml,
	parseAdmAxml,
	readAdmBedMetadata,
	validateAdmChnaConsistency,
} from '../src/common/editor/adm-metadata.ts';

const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

/**
 * The bytes the three original layouts wrote before immersive layouts existed.
 *
 * 6A-5's acceptance is that growing the bed set changes nothing that already
 * shipped, and a digest says that about the whole file rather than about the
 * parts a hand-written expectation remembered to check.
 */
const SHIPPED_BYTES = Object.freeze({
	mono: {
		axml: 'b0d951508074bb54c4494c65b6c80cc10c0924760de372c32b0f58520ede1175',
		chna: 'e721037a741521808817b9cba3e5c738003da0a7d573826f6c22977dc48f69ec',
	},
	stereo: {
		axml: '95130ccbffa0e38cd8a32cd8a5ec7ccde606fa3a52dfaf095fd314f2e9939625',
		chna: '6e5512a5521e79d4775860fa5f6e6f66b45fa2c39bf1f5f88ef34491e02bcf4f',
	},
	'5.1': {
		axml: 'a604e615dc2cc946e59c45e391c084aa431ee202c77e3915e98ef46cf399b3f0',
		chna: '101309702cbb73f2568ccd1347580efe9a0fb5a7472356188062e7b17ee81f50',
	},
});

test('the layouts that shipped write exactly the bytes they always wrote', () => {
	for (const [layout, expected] of Object.entries(SHIPPED_BYTES)) {
		assert.equal(digest(generateAdmAxml({ layout: layout as never })), expected.axml, `${layout} AXML`);
		assert.equal(
			digest(encodeChnaPayload(createAdmChna({ layout: layout as never }))),
			expected.chna,
			`${layout} CHNA`,
		);
	}
});

test('the shipped layouts cite common definitions and define nothing themselves', () => {
	for (const layout of ['mono', 'stereo', '5.1'] as const) {
		assert.equal(admBedLayoutDefinition(layout).commonDefinition, true);
		assert.deepEqual(admBedDefinedSpeakers(layout), []);
		const xml = generateAdmAxml({ layout });
		assert.ok(!xml.includes('<audioPackFormat '), `${layout} restates no pack format`);
		assert.ok(!xml.includes('<audioChannelFormat '), `${layout} restates no channel format`);
	}
});

test('every immersive layout defines the speakers the common definitions do not cover', () => {
	for (const layout of ADM_BED_LAYOUTS) {
		const definition = admBedLayoutDefinition(layout);
		if (definition.commonDefinition) continue;
		const xml = generateAdmAxml({ layout });
		assert.ok(xml.includes(`<audioPackFormat audioPackFormatID="${definition.packRef}"`), `${layout} pack`);
		for (const speaker of definition.speakers) {
			if (!speaker.defined) {
				assert.ok(
					!xml.includes(`<audioChannelFormat audioChannelFormatID="${speaker.channelRef}"`),
					`${layout} does not restate the common definition ${speaker.channelRef}`,
				);
				continue;
			}
			assert.ok(
				xml.includes(`<audioChannelFormat audioChannelFormatID="${speaker.channelRef}"`),
				`${layout} defines ${speaker.speakerLabel}`,
			);
			assert.ok(xml.includes(`<speakerLabel>${speaker.speakerLabel}</speakerLabel>`));
			assert.ok(xml.includes(`<position coordinate="azimuth">${speaker.azimuth.toFixed(1)}</position>`));
		}
	}
});

test('every layout parses, cross-checks against its CHNA, and reads back as itself', () => {
	// A custom reference that the file does not define is a parse error, so a
	// layout that reached this point carries definitions for everything it names.
	for (const layout of ADM_BED_LAYOUTS) {
		const xml = generateAdmAxml({ layout, programmeName: 'Feature', bedName: 'Bed' });
		const chna = createAdmChna({ layout });
		assert.equal(chna.numTracks, admBedChannelCount(layout));
		validateAdmChnaConsistency(xml, chna, admBedChannelCount(layout));
		const read = readAdmBedMetadata(parseAdmAxml(xml));
		assert.equal(read?.layout, layout, `${layout} round-trips`);
		assert.equal(read?.bedName, 'Bed');
	}
});

test('track UIDs stay hexadecimal past the ninth channel, and the CHNA agrees', () => {
	// The generator pads a decimal counter into a field the reader parses as
	// hexadecimal. Below ten channels the two agree by accident; a 5.1.4 bed is
	// the first layout where the tenth UID reads as 0x10.
	const xml = generateAdmAxml({ layout: '5.1.4' });
	assert.ok(xml.includes('<audioTrackUIDRef>ATU_0000000A</audioTrackUIDRef>'), 'the tenth UID is 0x0A');
	assert.ok(!xml.includes('ATU_00000010'), 'and never the decimal spelling');
	const uids = createAdmChna({ layout: '7.1.4' }).entries.map((entry) => entry.uid);
	assert.equal(uids.at(-1), 'ATU_0000000C', 'twelve channels end at 0x0C');
	assert.equal(new Set(uids).size, uids.length);
});

test('a layout names each speaker once and puts no two of them in the same place', () => {
	for (const layout of ADM_BED_LAYOUTS) {
		const speakers = admBedSpeakers(layout);
		assert.equal(new Set(speakers.map((speaker) => speaker.channelRef)).size, speakers.length, layout);
		assert.equal(new Set(speakers.map((speaker) => speaker.speakerLabel)).size, speakers.length, layout);
		assert.deepEqual(
			[...admBedChannelOrder(layout)],
			speakers.map((speaker) => speaker.channel),
			`${layout} delivery order`,
		);
		const positions = speakers.map((speaker) => `${speaker.azimuth}:${speaker.elevation}`);
		assert.equal(new Set(positions).size, positions.length, `${layout} positions`);
		assert.equal(speakers.filter((speaker) => speaker.lowFrequencyEffects).length <= 1, true);
	}
});

test('an unknown layout is refused rather than treated as stereo', () => {
	assert.equal(isAdmBedLayout('9.1.6'), false);
	assert.throws(() => generateAdmAxml({ layout: '9.1.6' as never }), /Unsupported ADM bed layout/u);
	assert.throws(() => createAdmChna({ layout: '9.1.6' as never }), /Unsupported ADM bed layout/u);
	assert.throws(() => admBedChannelOrder('9.1.6' as never), /Unsupported ADM bed layout/u);
});
