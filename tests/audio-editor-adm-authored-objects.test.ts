/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ADM_AUTHORED_MAXIMUM_CHANNELS,
	admObjectFormatIds,
	normalizeAdmAuthoredObjects,
} from '../src/common/editor/adm-authored-objects.ts';
import {
	createAdmChna,
	generateAdmAxml,
	parseAdmAxml,
	validateAdmChnaConsistency,
} from '../src/common/editor/adm-metadata.ts';
import { inventoryDeliveryConversions } from '../src/common/editor/delivery-conversion-inventory.ts';
import { resolveBw64Adm } from '../src/common/editor/export-bw64-adm.js';
import {
	authoredAdmChannelCount,
	authoredAdmDeliveryChannels,
	normalizeAdmProjectMetadata,
	validateAdmAuthoredRouting,
	type AdmAuthoredMetadata,
} from '../src/common/editor/adm-project-metadata.ts';

const OBJECT = Object.freeze({
	id: 'voice', name: 'Narrator', stripKind: 'track', stripId: 'narration',
	sourceChannel: 0, gain: 1, position: { azimuth: 30, elevation: 15, distance: 0.8 },
});

function authored(overrides: Record<string, unknown> = {}): AdmAuthoredMetadata {
	return normalizeAdmProjectMetadata({
		mode: 'authored',
		programme: { name: 'Programme', language: 'eng' },
		content: { name: 'Content', language: 'eng' },
		bed: {
			name: 'Bed',
			layout: 'stereo',
			assignments: [
				{ stripKind: 'track', stripId: 'music', sourceChannel: 0, bedChannel: 'L' },
				{ stripKind: 'track', stripId: 'music', sourceChannel: 1, bedChannel: 'R' },
			],
		},
		...overrides,
	}) as AdmAuthoredMetadata;
}

test('a programme without objects normalizes to exactly what it did before objects existed', () => {
	const bedOnly = authored();
	assert.equal(Object.hasOwn(bedOnly, 'objects'), false, 'absent, not an empty array');
	assert.deepEqual(Object.keys(bedOnly).sort(), ['bed', 'content', 'mode', 'programme']);
	assert.equal(authoredAdmChannelCount(bedOnly), 2);
});

test('objects are delivered after the bed, one channel each', () => {
	const metadata = authored({ objects: [OBJECT, { ...OBJECT, id: 'fx', name: 'Helicopter', stripId: 'effects' }] });
	assert.equal(authoredAdmChannelCount(metadata), 4, 'a stereo bed and two objects');
	assert.deepEqual(authoredAdmDeliveryChannels(metadata), [
		{ kind: 'bed', bedChannel: 'L' },
		{ kind: 'bed', bedChannel: 'R' },
		{ kind: 'object', objectId: 'voice' },
		{ kind: 'object', objectId: 'fx' },
	]);
});

test('an object position is normalized, bounded, and defaulted', () => {
	const [normalized] = normalizeAdmAuthoredObjects([{
		id: 'a', name: 'A', stripKind: 'track', stripId: 't', sourceChannel: 0,
		position: {},
	}], 2);
	assert.deepEqual(normalized?.position, { azimuth: 0, elevation: 0, distance: 1 });
	assert.equal(normalized?.gain, 1);

	for (const position of [{ azimuth: 181 }, { azimuth: -181 }, { elevation: 91 }, { distance: 1.5 }, { distance: -1 }]) {
		assert.throws(() => normalizeAdmAuthoredObjects([{
			id: 'a', name: 'A', stripKind: 'track', stripId: 't', sourceChannel: 0, position,
		}], 2), /azimuth|elevation|distance/u, JSON.stringify(position));
	}
});

test('duplicate object identities and over-wide programmes are refused', () => {
	assert.throws(() => normalizeAdmAuthoredObjects([
		{ id: 'a', name: 'A', stripKind: 'track', stripId: 't', sourceChannel: 0, position: {} },
		{ id: 'a', name: 'B', stripKind: 'track', stripId: 't', sourceChannel: 1, position: {} },
	], 2), /Duplicate ADM object ID/u);

	// A 5.1 bed leaves room for exactly 26 objects, because the render graph
	// clamps a mix at 32 channels and a wider programme could not be rendered.
	const room = ADM_AUTHORED_MAXIMUM_CHANNELS - 6;
	const object = (index: number) => ({
		id: `object-${index}`, name: `Object ${index}`,
		stripKind: 'track', stripId: 't', sourceChannel: 0, position: {},
	});
	const objects = Array.from({ length: room }, (_value, index) => object(index));
	assert.equal(normalizeAdmAuthoredObjects(objects, 6).length, 26);
	assert.throws(
		() => normalizeAdmAuthoredObjects([...objects, object(room)], 6),
		/at most 32 channels, so a 6-channel bed leaves room for 26 objects/u,
	);
});

test('a strip that only feeds objects counts as routed', () => {
	// Reporting it as unassigned would ask the operator to route the same signal
	// twice — once as an object and once into the bed it is deliberately not in.
	const project = {
		masterChannels: 3,
		sources: [{ id: 'stereo', channelCount: 2 }, { id: 'mono', channelCount: 1 }],
		clips: [{ id: 'music-clip', sourceId: 'stereo' }, { id: 'voice-clip', sourceId: 'mono' }],
		tracks: [
			{ type: 'audio', id: 'music', clipIds: ['music-clip'] },
			{ type: 'audio', id: 'narration', clipIds: ['voice-clip'] },
		],
		mixer: {},
	};
	assert.deepEqual(validateAdmAuthoredRouting(authored({ objects: [OBJECT] }), project as never), []);

	const unrouted = validateAdmAuthoredRouting(authored(), project as never);
	assert.deepEqual(
		unrouted.map(({ code, stripId }) => ({ code, stripId })),
		[{ code: 'missing-terminal-strip', stripId: 'narration' }],
		'without the object, the same strip is unassigned',
	);
});

test('an object naming a strip that is not there is reported as the object it is', () => {
	const project = {
		masterChannels: 3,
		sources: [{ id: 'stereo', channelCount: 2 }],
		clips: [{ id: 'music-clip', sourceId: 'stereo' }],
		tracks: [{ type: 'audio', id: 'music', clipIds: ['music-clip'] }],
		mixer: {},
	};
	const issues = validateAdmAuthoredRouting(authored({ objects: [OBJECT] }), project as never);
	assert.deepEqual(issues.map(({ code, message }) => ({ code, message })), [{
		code: 'unknown-strip',
		message: 'ADM object voice references unknown track narration.',
	}]);

	const outOfRange = validateAdmAuthoredRouting(
		authored({ objects: [{ ...OBJECT, stripId: 'music', sourceChannel: 4 }] }),
		project as never,
	);
	assert.deepEqual(outOfRange.map(({ code }) => code), ['source-channel-out-of-range']);
});

test('object format identifiers stay inside the custom Objects namespace', () => {
	assert.deepEqual(admObjectFormatIds(0), {
		object: 'AO_1002', pack: 'AP_00031001', channel: 'AC_00031001', block: 'AB_00031001_00000001',
	});
	assert.notEqual(admObjectFormatIds(0).object, 'AO_1001', 'the bed already holds that identifier');
	// Past the fifteenth object the counter has to carry, and a decimal spelling
	// would collide with an identifier the sixteenth object already holds.
	assert.equal(admObjectFormatIds(15).channel, 'AC_00031010');
	const channels = new Set(Array.from({ length: 26 }, (_value, index) => admObjectFormatIds(index).channel));
	assert.equal(channels.size, 26);
});

test('an object programme writes a file that resolves every reference it makes', () => {
	const objects = [
		{ ...OBJECT, position: { azimuth: 30, elevation: 15, distance: 0.8 } },
		{ ...OBJECT, id: 'fx', name: 'Helicopter', position: { azimuth: -90, elevation: 30, distance: 1 } },
	];
	const xml = generateAdmAxml({ layout: 'stereo', bedName: 'Bed', objects });
	const chna = createAdmChna({ layout: 'stereo', objectCount: objects.length });

	// The cross-check refuses a custom reference the AXML does not define and a
	// CHNA UID the AXML does not carry, so passing means the two agree.
	validateAdmChnaConsistency(xml, chna, 4);
	assert.equal(chna.numTracks, 4);
	assert.deepEqual(chna.entries.map(({ trackRef }) => trackRef), [
		'AC_00010001', 'AC_00010002', 'AC_00031001', 'AC_00031002',
	]);

	const document = parseAdmAxml(xml);
	assert.deepEqual(document.objects.map(({ id, name }) => ({ id, name })), [
		{ id: 'AO_1001', name: 'Bed' },
		{ id: 'AO_1002', name: 'Narrator' },
		{ id: 'AO_1003', name: 'Helicopter' },
	]);
	assert.deepEqual(document.contents[0]?.objectRefs, ['AO_1001', 'AO_1002', 'AO_1003']);
	assert.equal(document.trackUids.length, 4);

	assert.ok(xml.includes('<position coordinate="azimuth">30.0</position>'));
	assert.ok(xml.includes('<position coordinate="distance">0.800</position>'));
	assert.ok(!xml.includes('<gain>'), 'the render applies the authored gain, so the file must not repeat it');
});

test('a bed-only programme still writes exactly the bytes it always wrote', () => {
	for (const layout of ['mono', 'stereo', '5.1'] as const) {
		assert.equal(generateAdmAxml({ layout, objects: [] }), generateAdmAxml({ layout }));
		assert.deepEqual(
			createAdmChna({ layout, objectCount: 0 }).entries,
			createAdmChna({ layout }).entries,
		);
	}
});

test('an authored delivery is as wide as its bed plus its objects', () => {
	const project = {
		masterChannels: 4,
		sources: [{ id: 'stereo', channelCount: 2 }, { id: 'mono', channelCount: 1 }],
		clips: [{ id: 'music-clip', sourceId: 'stereo' }, { id: 'voice-clip', sourceId: 'mono' }],
		tracks: [
			{ type: 'audio', id: 'music', clipIds: ['music-clip'] },
			{ type: 'audio', id: 'narration', clipIds: ['voice-clip'] },
		],
		mixer: {},
		metadata: { adm: authored({ objects: [OBJECT, { ...OBJECT, id: 'fx', name: 'FX' }] }) },
	};
	const resolved = resolveBw64Adm(project, {});
	assert.equal(resolved.channelCount, 4);
	assert.deepEqual(resolved.channelOrder, ['L', 'R', 'voice', 'fx']);

	assert.throws(
		() => resolveBw64Adm({ ...project, masterChannels: 2 }, {}),
		/4-channel ADM bed does not match the 2-channel project master/u,
	);
});

test('an immersive delivery says in its report what it carried', () => {
	const source = { sampleRate: 48_000 };
	const plan = (adm: unknown) => inventoryDeliveryConversions({
		format: 'bw64', sampleRate: 48_000, adm: { metadata: adm },
	}, source);

	assert.deepEqual(plan(authored()).filter(({ code }) => code.startsWith('delivery.adm')), [],
		'a stereo bed is the delivery that has always been available');

	const immersive = plan(authored({ bed: { name: 'Bed', layout: '7.1.4', assignments: [] } }));
	const bedItem = immersive.find(({ code }) => code === 'delivery.adm-immersive-bed');
	assert.equal(bedItem?.disposition, 'preserved');
	assert.deepEqual(bedItem?.data, { layout: '7.1.4' });
	assert.match(String(bedItem?.message), /defined in the file itself/u);

	const objectItem = plan(authored({ objects: [OBJECT] }))
		.find(({ code }) => code === 'delivery.adm-objects');
	assert.deepEqual(objectItem?.data, { objects: 1, layout: 'stereo' });

	// Passthrough still reports byte preservation and nothing else, because
	// nothing about it was authored here.
	assert.deepEqual(
		plan({ mode: 'passthrough' }).map(({ code }) => code),
		['delivery.adm-passthrough'],
	);
});
