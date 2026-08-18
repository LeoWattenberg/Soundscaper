/* SPDX-License-Identifier: AGPL-3.0-only */
import {
	ADM_BED_DEFINITIONS,
	normalizeChnaMetadata,
	parseChnaPayload,
	type AdmBedLayout,
	type ChnaMetadata,
	type ChnaMetadataInput,
} from './adm-chna.ts';
import {
	ADM_AXML_MAX_BYTES,
	MAX_ATTRIBUTE_BYTES,
	boundedString,
	equalId,
	isAxmlDocument,
	isCommonDefinition,
	parseAdmAxml,
	requireFormatDefined,
	sameIds,
	type AdmAxmlDocument,
} from './adm-axml-document.ts';
import {
	ADM_BED_LAYOUTS,
	admBedDefinedSpeakers,
	admTrackUid as uid,
	admBedLayoutDefinition,
	isAdmBedLayout,
	type AdmBedSpeaker,
} from './adm-bed-layout.ts';

export * from './adm-chna.ts';
export {
	ADM_AXML_MAX_BYTES,
	ADM_AXML_MAX_DEPTH,
	ADM_AXML_MAX_ELEMENTS,
	inspectAdmAxml,
	parseAdmAxml,
	parseRiffAxmlChunk,
	type AdmAxmlDocument,
	type AdmContent,
	type AdmObject,
	type AdmProgramme,
	type AdmTrackUid,
} from './adm-axml-document.ts';

const EBU_CORE_NAMESPACE = 'urn:ebu:metadata-schema:ebuCore_2015';
const ADM_VERSION = 'ITU-R_BS.2076-3';
export interface AdmBedMetadata {
	readonly programmeName: string;
	readonly contentName: string;
	/** Shared-language compatibility field; empty when programme and content differ. */
	readonly language: string;
	readonly programmeLanguage: string;
	readonly contentLanguage: string;
	readonly bedName: string;
	readonly layout: AdmBedLayout;
	readonly rawXml: string;
}

export type AdmBedMetadataInput = Partial<AdmBedMetadata>;

export function normalizeAdmBedMetadata(input: AdmBedMetadataInput = {}): AdmBedMetadata {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('ADM bed metadata must be an object.');
	const layout = input.layout ?? 'stereo';
	if (!isAdmBedLayout(layout)) throw new RangeError(`Unsupported ADM bed layout: ${String(layout)}.`);
	const sharedLanguage = normalizedLanguage(input.language ?? '');
	const programmeLanguage = normalizedLanguage(input.programmeLanguage ?? sharedLanguage);
	const contentLanguage = normalizedLanguage(input.contentLanguage ?? sharedLanguage);
	const language = programmeLanguage.toLowerCase() === contentLanguage.toLowerCase()
		? programmeLanguage
		: '';
	const rawXml = boundedString(input.rawXml ?? '', 'ADM raw XML', ADM_AXML_MAX_BYTES, true);
	return Object.freeze({
		programmeName: normalizedName(input.programmeName, 'Programme', 'ADM programme name'),
		contentName: normalizedName(input.contentName, 'Main', 'ADM content name'),
		language,
		programmeLanguage,
		contentLanguage,
		bedName: normalizedName(input.bedName, 'Main Bed', 'ADM bed name'),
		layout,
		rawXml,
	});
}

export function generateAdmAxml(input: AdmBedMetadataInput = {}): string {
	const metadata = normalizeAdmBedMetadata(input);
	if (metadata.rawXml) {
		parseAdmAxml(metadata.rawXml);
		return metadata.rawXml;
	}
	const definition = ADM_BED_DEFINITIONS[metadata.layout];
	const languageAttribute = metadata.programmeLanguage ? ` audioProgrammeLanguage="${escapeAttribute(metadata.programmeLanguage)}"` : '';
	const contentLanguageAttribute = metadata.contentLanguage ? ` audioContentLanguage="${escapeAttribute(metadata.contentLanguage)}"` : '';
	const trackUidRefs = definition.channelRefs.map((_, index) => `          <audioTrackUIDRef>${uid(index)}</audioTrackUIDRef>`);
	const trackUids = definition.channelRefs.flatMap((channelRef, index) => [
		`        <audioTrackUID UID="${uid(index)}">`,
		`          <audioChannelFormatIDRef>${channelRef}</audioChannelFormatIDRef>`,
		`          <audioPackFormatIDRef>${definition.packRef}</audioPackFormatIDRef>`,
		'        </audioTrackUID>',
	]);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<ebuCoreMain xmlns="${EBU_CORE_NAMESPACE}" xmlns:dc="http://purl.org/dc/elements/1.1/">`,
		'  <coreMetadata>',
		'    <format>',
		`      <audioFormatExtended version="${ADM_VERSION}">`,
		`        <audioProgramme audioProgrammeID="APR_1001" audioProgrammeName="${escapeAttribute(metadata.programmeName)}"${languageAttribute}>`,
		'          <audioContentIDRef>ACO_1001</audioContentIDRef>',
		'        </audioProgramme>',
		`        <audioContent audioContentID="ACO_1001" audioContentName="${escapeAttribute(metadata.contentName)}"${contentLanguageAttribute}>`,
		'          <audioObjectIDRef>AO_1001</audioObjectIDRef>',
		'        </audioContent>',
		`        <audioObject audioObjectID="AO_1001" audioObjectName="${escapeAttribute(metadata.bedName)}">`,
		`          <audioPackFormatIDRef>${definition.packRef}</audioPackFormatIDRef>`,
		...trackUidRefs,
		'        </audioObject>',
		...bedFormatDefinitions(metadata.layout),
		...trackUids,
		'      </audioFormatExtended>',
		'    </format>',
		'  </coreMetadata>',
		'</ebuCoreMain>',
	].join('\n');
}

/**
 * The pack and channel definitions a layout has to carry itself.
 *
 * Empty for the three layouts whose formats are BS.2094 common definitions —
 * their bytes predate this and do not change. Every other layout writes its own
 * pack, and its own definition for each speaker the common definitions do not
 * cover, so the file states where it believes each speaker sits instead of
 * citing a table the reader may not have.
 */
function bedFormatDefinitions(layout: AdmBedLayout): readonly string[] {
	const definition = admBedLayoutDefinition(layout);
	if (definition.commonDefinition) return [];
	return [
		`        <audioPackFormat audioPackFormatID="${definition.packRef}"`
			+ ` audioPackFormatName="${escapeAttribute(layout)}"`
			+ ' typeDefinition="DirectSpeakers" typeLabel="0001">',
		...definition.speakers.map((speaker) => (
			`          <audioChannelFormatIDRef>${speaker.channelRef}</audioChannelFormatIDRef>`
		)),
		'        </audioPackFormat>',
		...admBedDefinedSpeakers(layout).flatMap(channelFormatDefinition),
	];
}

function channelFormatDefinition(speaker: AdmBedSpeaker): readonly string[] {
	const blockId = `AB_${speaker.channelRef.slice(3)}_00000001`;
	return [
		`        <audioChannelFormat audioChannelFormatID="${speaker.channelRef}"`
			+ ` audioChannelFormatName="${escapeAttribute(speaker.speakerLabel)}"`
			+ ' typeDefinition="DirectSpeakers" typeLabel="0001">',
		`          <audioBlockFormat audioBlockFormatID="${blockId}">`,
		`            <speakerLabel>${escapeAttribute(speaker.speakerLabel)}</speakerLabel>`,
		`            <position coordinate="azimuth">${speaker.azimuth.toFixed(1)}</position>`,
		`            <position coordinate="elevation">${speaker.elevation.toFixed(1)}</position>`,
		'            <position coordinate="distance">1.0</position>',
		'          </audioBlockFormat>',
		'        </audioChannelFormat>',
	];
}

export function encodeAdmAxml(input: AdmBedMetadataInput = {}): Uint8Array {
	return new TextEncoder().encode(generateAdmAxml(input));
}

export function readAdmBedMetadata(document: AdmAxmlDocument): AdmBedMetadata | null {
	if (document.programmes.length !== 1 || document.contents.length !== 1 || document.objects.length !== 1) return null;
	const programme = document.programmes[0];
	const content = document.contents[0];
	const object = document.objects[0];
	if (!programme || !content || !object) return null;
	if (!sameIds(programme.contentRefs, [content.id]) || !sameIds(content.objectRefs, [object.id])) return null;
	for (const layout of ADM_BED_LAYOUTS) {
		const definition = ADM_BED_DEFINITIONS[layout];
		const expectedUids = definition.channelRefs.map((_, index) => uid(index));
		if (!sameIds(object.packRefs, [definition.packRef]) || !sameIds(object.trackUidRefs, expectedUids)) continue;
		if (document.trackUids.length !== definition.channelRefs.length) continue;
		const matches = document.trackUids.every((track, index) => (
			equalId(track.uid, expectedUids[index] ?? '')
			&& track.trackRefKind === 'audioChannelFormat'
			&& equalId(track.trackRef, definition.channelRefs[index] ?? '')
			&& equalId(track.packRef, definition.packRef)
		));
		if (!matches) continue;
		return normalizeAdmBedMetadata({
			programmeName: programme.name,
			contentName: content.name,
			programmeLanguage: programme.language,
			contentLanguage: content.language,
			bedName: object.name,
			layout,
			rawXml: document.rawXml,
		});
	}
	return null;
}

export function createRiffAxmlChunk(input: AdmBedMetadataInput = {}): Uint8Array {
	const payload = encodeAdmAxml(input);
	const chunk = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	chunk.set(new TextEncoder().encode('axml'), 0);
	new DataView(chunk.buffer).setUint32(4, payload.byteLength, true);
	chunk.set(payload, 8);
	return chunk;
}

export function validateAdmChnaConsistency(
	axmlInput: AdmAxmlDocument | string | Uint8Array | ArrayBuffer | ArrayBufferView,
	chnaInput: ChnaMetadataInput | Uint8Array | ArrayBuffer | ArrayBufferView,
	expectedTrackCount?: number,
): true {
	const axml = isAxmlDocument(axmlInput) ? axmlInput : parseAdmAxml(axmlInput);
	const chna = isChnaMetadata(chnaInput) ? normalizeChnaMetadata(chnaInput) : parseChnaPayload(chnaInput);
	if (expectedTrackCount !== undefined) {
		if (!Number.isSafeInteger(expectedTrackCount) || expectedTrackCount < 1) throw new RangeError('ADM channel count must be positive.');
		if (chna.numTracks !== expectedTrackCount) {
			throw new Error(`CHNA declares ${chna.numTracks} tracks but the PCM channel count is ${expectedTrackCount}.`);
		}
	}
	const axmlByUid = new Map(axml.trackUids.map((track) => [track.uid.toUpperCase(), track]));
	const axmlFormats = new Map(axml.definedFormatIds.map((id) => [id.toUpperCase(), id]));
	const chnaByUid = new Map(chna.entries.map((entry) => [entry.uid.toUpperCase(), entry]));
	for (const object of axml.objects) for (const uidRef of object.trackUidRefs) {
		if (!equalId(uidRef, 'ATU_00000000') && !chnaByUid.has(uidRef.toUpperCase())) {
			throw new Error(`AXML UID ${uidRef} is not present in CHNA.`);
		}
	}
	for (const entry of chna.entries) {
		requireFormatDefined(entry.trackRef, axmlFormats);
		if (entry.packRef) requireFormatDefined(entry.packRef, axmlFormats);
		const track = axmlByUid.get(entry.uid.toUpperCase());
		if (track?.trackRef && !equalId(track.trackRef, entry.trackRef)) {
			throw new Error(`CHNA UID ${entry.uid} has a track reference that differs from AXML.`);
		}
		if (track?.packRef && !equalId(track.packRef, entry.packRef)) {
			throw new Error(`CHNA UID ${entry.uid} has a pack reference that differs from AXML.`);
		}
	}
	return true;
}

export function validateAdmCommonDefinitionChna(
	chnaInput: ChnaMetadataInput | Uint8Array | ArrayBuffer | ArrayBufferView,
	expectedTrackCount?: number,
): true {
	const chna = isChnaMetadata(chnaInput) ? normalizeChnaMetadata(chnaInput) : parseChnaPayload(chnaInput);
	if (expectedTrackCount !== undefined && chna.numTracks !== expectedTrackCount) {
		throw new Error(`CHNA declares ${chna.numTracks} tracks but the PCM channel count is ${expectedTrackCount}.`);
	}
	for (const entry of chna.entries) {
		if (!isCommonDefinition(entry.trackRef)) {
			throw new Error(`CHNA UID ${entry.uid} has a custom track reference but AXML is empty.`);
		}
		if (entry.packRef && !isCommonDefinition(entry.packRef)) {
			throw new Error(`CHNA UID ${entry.uid} has a custom pack reference but AXML is empty.`);
		}
	}
	return true;
}

function normalizedName(value: unknown, fallback: string, field: string): string {
	if (value === undefined || value === null || value === '') return fallback;
	const text = boundedString(value, field, MAX_ATTRIBUTE_BYTES).trim();
	return text || fallback;
}

function normalizedLanguage(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('ADM language must be a string.');
	const language = boundedString(value, 'ADM language', 128);
	if (language && !/^[A-Za-z]{2,3}$/u.test(language)) {
		throw new RangeError('ADM language must be a two- or three-letter ISO 639 code.');
	}
	return language;
}

function escapeAttribute(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function isChnaMetadata(value: unknown): value is ChnaMetadata {
	return Boolean(value && typeof value === 'object' && 'numTracks' in value && 'entries' in value);
}
