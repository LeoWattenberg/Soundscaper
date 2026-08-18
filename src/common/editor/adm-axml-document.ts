/* SPDX-License-Identifier: AGPL-3.0-only */

import { SaxesParser, type SaxesTagNS } from 'saxes';

/**
 * Reading an ADM AXML document, and saying no to the ones that lie.
 *
 * Split out of `adm-metadata.ts` when immersive layouts pushed that file past
 * its size limit, along the seam that was already there: this half never writes
 * anything. It parses hostile XML under element, depth and attribute ceilings,
 * refuses DOCTYPE and processing instructions outright, and resolves every
 * identifier reference against what the document actually defines — so the
 * writer cannot be the thing that decides whether its own output is valid.
 */

export const ADM_AXML_MAX_BYTES = 16 * 1024 * 1024;

export const ADM_AXML_MAX_ELEMENTS = 100_000;

export const ADM_AXML_MAX_DEPTH = 128;

export const MAX_ATTRIBUTE_BYTES = 1024;

const MAX_REFERENCE_CHARACTERS = 128;

export interface AdmProgramme {
	readonly id: string;
	readonly name: string;
	readonly language: string;
	readonly contentRefs: readonly string[];
}

export interface AdmContent {
	readonly id: string;
	readonly name: string;
	readonly language: string;
	readonly objectRefs: readonly string[];
}

export interface AdmObject {
	readonly id: string;
	readonly name: string;
	readonly packRefs: readonly string[];
	readonly trackUidRefs: readonly string[];
}

export interface AdmTrackUid {
	readonly uid: string;
	readonly trackRef: string;
	readonly trackRefKind: 'audioChannelFormat' | 'audioTrackFormat' | '';
	readonly packRef: string;
}

export interface AdmAxmlDocument {
	readonly rawXml: string;
	readonly version: string;
	readonly programmes: readonly AdmProgramme[];
	readonly contents: readonly AdmContent[];
	readonly objects: readonly AdmObject[];
	readonly trackUids: readonly AdmTrackUid[];
	readonly definedFormatIds: readonly string[];
}

type ProgrammeBuilder = { kind: 'programme'; id: string; name: string; language: string; contentRefs: string[] };

type ContentBuilder = { kind: 'content'; id: string; name: string; language: string; objectRefs: string[] };

type ObjectBuilder = { kind: 'object'; id: string; name: string; packRefs: string[]; trackUidRefs: string[] };

type TrackUidBuilder = { kind: 'trackUid'; uid: string; trackRef: string; trackRefKind: AdmTrackUid['trackRefKind']; packRef: string };

type AdmBuilder = ProgrammeBuilder | ContentBuilder | ObjectBuilder | TrackUidBuilder;

type XmlFrame = { name: string; owner: AdmBuilder | null; referenceName: string; text: string; formatRoot: boolean };

const ELEMENT_IDS: Readonly<Record<string, readonly [string, RegExp]>> = Object.freeze({
	audioProgramme: ['audioProgrammeID', /^APR_[0-9A-Fa-f]{4}$/u],
	audioContent: ['audioContentID', /^ACO_[0-9A-Fa-f]{4}$/u],
	audioObject: ['audioObjectID', /^AO_[0-9A-Fa-f]{4}$/u],
	audioTrackUID: ['UID', /^ATU_[0-9A-Fa-f]{8}$/u],
	audioPackFormat: ['audioPackFormatID', /^AP_[0-9A-Fa-f]{8}$/u],
	audioChannelFormat: ['audioChannelFormatID', /^AC_[0-9A-Fa-f]{8}$/u],
	audioTrackFormat: ['audioTrackFormatID', /^AT_[0-9A-Fa-f]{8}_[0-9A-Fa-f]{2}$/u],
});

const REFERENCE_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
	audioContentIDRef: /^ACO_[0-9A-Fa-f]{4}$/u,
	audioObjectIDRef: /^AO_[0-9A-Fa-f]{4}$/u,
	audioTrackUIDRef: /^ATU_[0-9A-Fa-f]{8}$/u,
	audioPackFormatIDRef: /^AP_[0-9A-Fa-f]{8}$/u,
	audioChannelFormatIDRef: /^AC_[0-9A-Fa-f]{8}$/u,
	audioTrackFormatIDRef: /^AT_[0-9A-Fa-f]{8}_[0-9A-Fa-f]{2}$/u,
});

export function inspectAdmAxml(input: string | Uint8Array | ArrayBuffer | ArrayBufferView): AdmAxmlDocument | null {
	const xml = decodeAxml(input);
	if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) throw new Error('Active or external XML declarations are not allowed in ADM AXML.');
	if (/<\?(?!xml\s)/iu.test(xml)) throw new Error('Active XML processing instructions are not allowed in ADM AXML.');

	const programmes: ProgrammeBuilder[] = [];
	const contents: ContentBuilder[] = [];
	const objects: ObjectBuilder[] = [];
	const trackUids: TrackUidBuilder[] = [];
	const definedFormatIds = new Map<string, string>();
	const declaredIds = new Map<string, string>();
	const frames: XmlFrame[] = [];
	let formatExtendedCount = 0;
	let version = '';
	let elementCount = 0;
	let attributeCount = 0;
	let formatExtendedDepth = -1;
	let formatExtendedNamespace = '';
	const parser = new SaxesParser({ xmlns: true, position: false });

	parser.on('doctype', () => { throw new Error('DOCTYPE declarations are not allowed in ADM AXML.'); });
	parser.on('processinginstruction', () => { throw new Error('Active XML processing instructions are not allowed in ADM AXML.'); });
	parser.on('opentag', (tag) => {
		elementCount += 1;
		if (elementCount > ADM_AXML_MAX_ELEMENTS) throw new RangeError('ADM AXML exceeds the element-count safety limit.');
		if (frames.length >= ADM_AXML_MAX_DEPTH) throw new RangeError('ADM AXML exceeds the maximum XML depth.');
		attributeCount += Object.keys(tag.attributes).length;
		if (attributeCount > ADM_AXML_MAX_ELEMENTS * 4) throw new RangeError('ADM AXML exceeds the attribute-count safety limit.');
		const name = tag.local;
		const formatRoot = name === 'audioFormatExtended' && isAdmNamespace(tag.uri);
		if (formatRoot) {
			formatExtendedCount += 1;
			if (formatExtendedCount > 1) throw new Error('ADM AXML must contain exactly one audioFormatExtended element.');
			version = attribute(tag, 'version') ?? '';
			formatExtendedDepth = frames.length;
			formatExtendedNamespace = tag.uri;
		}
		const inFormatExtended = formatExtendedDepth >= 0;
		const admElement = inFormatExtended && tag.uri === formatExtendedNamespace;
		const declaredId = admElement ? registerElementId(tag, name, declaredIds) : '';
		if (declaredId && (name === 'audioPackFormat' || name === 'audioChannelFormat' || name === 'audioTrackFormat')) {
			definedFormatIds.set(declaredId.toUpperCase(), declaredId);
		}
		const inheritedOwner = inFormatExtended ? frames.at(-1)?.owner ?? null : null;
		const owner = admElement
			? createBuilder(tag, name, declaredId, programmes, contents, objects, trackUids) ?? inheritedOwner
			: inheritedOwner;
		frames.push({
			name,
			owner,
			referenceName: admElement && Object.hasOwn(REFERENCE_PATTERNS, name) ? name : '',
			text: '',
			formatRoot,
		});
	});
	const appendText = (text: string): void => {
		const frame = frames.at(-1);
		if (!frame?.referenceName) return;
		frame.text += text;
		if (frame.text.length > MAX_REFERENCE_CHARACTERS) throw new RangeError('An ADM identifier reference exceeds the safety limit.');
	};
	parser.on('text', appendText);
	parser.on('cdata', appendText);
	parser.on('closetag', () => {
		const frame = frames.pop();
		if (!frame) throw new Error('ADM AXML contains an unexpected closing element.');
		if (frame.referenceName) applyReference(frame);
		if (frame.formatRoot) formatExtendedDepth = -1;
	});
	parser.write(xml).close();
	if (formatExtendedCount === 0) return null;
	validateLocalReferences(programmes, contents, objects, trackUids, definedFormatIds);
	return Object.freeze({
		rawXml: xml,
		version,
		programmes: Object.freeze(programmes.map(freezeProgramme)),
		contents: Object.freeze(contents.map(freezeContent)),
		objects: Object.freeze(objects.map(freezeObject)),
		trackUids: Object.freeze(trackUids.map(freezeTrackUid)),
		definedFormatIds: Object.freeze([...definedFormatIds.values()]),
	});
}

export function parseAdmAxml(input: string | Uint8Array | ArrayBuffer | ArrayBufferView): AdmAxmlDocument {
	const document = inspectAdmAxml(input);
	if (!document) throw new Error('ADM AXML must contain exactly one audioFormatExtended element.');
	return document;
}

export function parseRiffAxmlChunk(input: Uint8Array | ArrayBuffer | ArrayBufferView): AdmAxmlDocument {
	const bytes = byteView(input, 'RIFF AXML chunk');
	if (bytes.byteLength < 8) throw new Error('The RIFF AXML chunk is truncated.');
	if (new TextDecoder('ascii').decode(bytes.subarray(0, 4)) !== 'axml') {
		throw new Error('The RIFF chunk does not have the axml identifier.');
	}
	const payloadBytes = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
	if (payloadBytes > ADM_AXML_MAX_BYTES) throw new RangeError('The RIFF AXML payload exceeds 16 MiB.');
	const expectedBytes = 8 + payloadBytes + (payloadBytes & 1);
	if (bytes.byteLength < expectedBytes) throw new Error('The RIFF AXML chunk is truncated.');
	if (bytes.byteLength > expectedBytes) throw new Error('The RIFF AXML chunk contains trailing bytes.');
	if ((payloadBytes & 1) !== 0 && bytes[bytes.byteLength - 1] !== 0) {
		throw new Error('The RIFF AXML chunk has a non-zero alignment byte.');
	}
	return parseAdmAxml(bytes.subarray(8, 8 + payloadBytes));
}

function registerElementId(tag: SaxesTagNS, name: string, declaredIds: Map<string, string>): string {
	const specification = ELEMENT_IDS[name];
	if (!specification) return '';
	const [attributeName, pattern] = specification;
	const value = attribute(tag, attributeName);
	if (!value || !pattern.test(value)) throw new Error(`ADM ${attributeName} is missing or invalid.`);
	if (isZeroAdmElementId(value)) throw new Error(`ADM ${attributeName} cannot declare the reserved zero identifier.`);
	const key = value.toUpperCase();
	if (declaredIds.has(key)) throw new Error(`ADM contains duplicate identifier ${value}.`);
	declaredIds.set(key, value);
	return value;
}

function createBuilder(
	tag: SaxesTagNS,
	name: string,
	id: string,
	programmes: ProgrammeBuilder[],
	contents: ContentBuilder[],
	objects: ObjectBuilder[],
	trackUids: TrackUidBuilder[],
): AdmBuilder | null {
	if (name === 'audioProgramme') {
		const value: ProgrammeBuilder = { kind: 'programme', id, name: requiredName(tag, 'audioProgrammeName'), language: parsedLanguage(tag, 'audioProgrammeLanguage'), contentRefs: [] };
		programmes.push(value);
		return value;
	}
	if (name === 'audioContent') {
		const value: ContentBuilder = { kind: 'content', id, name: requiredName(tag, 'audioContentName'), language: parsedLanguage(tag, 'audioContentLanguage'), objectRefs: [] };
		contents.push(value);
		return value;
	}
	if (name === 'audioObject') {
		const value: ObjectBuilder = { kind: 'object', id, name: requiredName(tag, 'audioObjectName'), packRefs: [], trackUidRefs: [] };
		objects.push(value);
		return value;
	}
	if (name === 'audioTrackUID') {
		const value: TrackUidBuilder = { kind: 'trackUid', uid: id, trackRef: '', trackRefKind: '', packRef: '' };
		trackUids.push(value);
		return value;
	}
	return null;
}

function applyReference(frame: XmlFrame): void {
	const value = frame.text.trim();
	const pattern = REFERENCE_PATTERNS[frame.referenceName];
	if (!pattern?.test(value)) throw new Error(`ADM ${frame.referenceName} is missing or invalid.`);
	const owner = frame.owner;
	if (frame.referenceName === 'audioContentIDRef' && owner?.kind === 'programme') addUnique(owner.contentRefs, value, frame.referenceName);
	else if (frame.referenceName === 'audioObjectIDRef' && owner?.kind === 'content') addUnique(owner.objectRefs, value, frame.referenceName);
	else if (frame.referenceName === 'audioTrackUIDRef' && owner?.kind === 'object') {
		if (equalId(value, 'ATU_00000000')) owner.trackUidRefs.push(value);
		else addUnique(owner.trackUidRefs, value, frame.referenceName);
	}
	else if (frame.referenceName === 'audioPackFormatIDRef' && owner?.kind === 'object') addUnique(owner.packRefs, value, frame.referenceName);
	else if (frame.referenceName === 'audioPackFormatIDRef' && owner?.kind === 'trackUid') setOnce(owner, 'packRef', value, frame.referenceName);
	else if (frame.referenceName === 'audioChannelFormatIDRef' && owner?.kind === 'trackUid') setTrackReference(owner, value, 'audioChannelFormat');
	else if (frame.referenceName === 'audioTrackFormatIDRef' && owner?.kind === 'trackUid') setTrackReference(owner, value, 'audioTrackFormat');
}

function validateLocalReferences(
	programmes: readonly ProgrammeBuilder[],
	contents: readonly ContentBuilder[],
	objects: readonly ObjectBuilder[],
	trackUids: readonly TrackUidBuilder[],
	definedFormats: ReadonlyMap<string, string>,
): void {
	const contentIds = new Set(contents.map((value) => value.id.toUpperCase()));
	const objectIds = new Set(objects.map((value) => value.id.toUpperCase()));
	for (const programme of programmes) for (const ref of programme.contentRefs) requireDefined(ref, contentIds);
	for (const content of contents) for (const ref of content.objectRefs) requireDefined(ref, objectIds);
	for (const object of objects) {
		for (const ref of object.packRefs) requireFormatDefined(ref, definedFormats);
	}
	for (const track of trackUids) {
		if (track.trackRef) requireFormatDefined(track.trackRef, definedFormats);
		if (track.packRef) requireFormatDefined(track.packRef, definedFormats);
	}
}

function requireDefined(reference: string, ids: ReadonlySet<string>): void {
	if (!ids.has(reference.toUpperCase())) throw new Error(`ADM reference ${reference} is not defined in AXML.`);
}

export function requireFormatDefined(reference: string, ids: ReadonlyMap<string, string>): void {
	if (!isCommonDefinition(reference) && !ids.has(reference.toUpperCase())) {
		throw new Error(`Custom ADM reference ${reference} is not defined in AXML.`);
	}
}

export function isCommonDefinition(reference: string): boolean {
	const match = /^(?:A[PC]_([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})|AT_([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})_[0-9A-Fa-f]{2})$/u.exec(reference);
	const typeLabel = match?.[1] ?? match?.[3];
	const definitionValue = match?.[2] ?? match?.[4];
	if (typeLabel === undefined || definitionValue === undefined) return false;
	const type = Number.parseInt(typeLabel, 16);
	const value = Number.parseInt(definitionValue, 16);
	// BS.2076 reserves types 0001-0005 and values 0001-0FFF for common
	// definitions. This validates that namespace, not that BS.2094 assigns a
	// particular value inside it.
	return type >= 0x0001 && type <= 0x0005 && value >= 0x0001 && value <= 0x0fff;
}

function isZeroAdmElementId(value: string): boolean {
	return /^(?:(?:APR|ACO|AO)_0{4}|(?:ATU|AP|AC)_0{8}|AT_0{8}_0{2})$/iu.test(value);
}

function isAdmNamespace(namespace: string): boolean {
	return namespace === '' || /^urn:ebu:metadata-schema:ebucore(?:_\d{4})?$/iu.test(namespace);
}

function freezeProgramme(value: ProgrammeBuilder): AdmProgramme {
	return Object.freeze({ id: value.id, name: value.name, language: value.language, contentRefs: Object.freeze([...value.contentRefs]) });
}

function freezeContent(value: ContentBuilder): AdmContent {
	return Object.freeze({ id: value.id, name: value.name, language: value.language, objectRefs: Object.freeze([...value.objectRefs]) });
}

function freezeObject(value: ObjectBuilder): AdmObject {
	return Object.freeze({ id: value.id, name: value.name, packRefs: Object.freeze([...value.packRefs]), trackUidRefs: Object.freeze([...value.trackUidRefs]) });
}

function freezeTrackUid(value: TrackUidBuilder): AdmTrackUid {
	return Object.freeze({ uid: value.uid, trackRef: value.trackRef, trackRefKind: value.trackRefKind, packRef: value.packRef });
}

export function boundedString(value: unknown, field: string, maximumBytes: number, allowControls = false): string {
	if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
	if (!allowControls && /[\u0000-\u001f\u007f]/u.test(value)) throw new RangeError(`${field} cannot contain NUL or control characters.`);
	if (value.includes('\0')) throw new RangeError(`${field} cannot contain NUL.`);
	if (new TextEncoder().encode(value).byteLength > maximumBytes) throw new RangeError(`${field} exceeds its size limit.`);
	return value;
}

function attribute(tag: SaxesTagNS, name: string): string | undefined {
	return Object.values(tag.attributes).find((candidate) => (
		candidate.local === name && candidate.prefix === '' && candidate.uri === ''
	))?.value;
}

function requiredName(tag: SaxesTagNS, name: string): string {
	const value = attribute(tag, name);
	if (value === undefined) throw new Error(`ADM ${name} is required.`);
	return boundedString(value, `ADM ${name}`, MAX_ATTRIBUTE_BYTES).trim();
}

function parsedLanguage(tag: SaxesTagNS, name: string): string {
	const value = attribute(tag, name);
	if (value === undefined) return '';
	return boundedString(value, `ADM ${name}`, MAX_ATTRIBUTE_BYTES).trim();
}

function decodeAxml(input: string | Uint8Array | ArrayBuffer | ArrayBufferView): string {
	if (typeof input === 'string') return boundedString(input, 'ADM AXML', ADM_AXML_MAX_BYTES, true);
	const bytes = byteView(input, 'ADM AXML');
	if (bytes.byteLength > ADM_AXML_MAX_BYTES) throw new RangeError('ADM AXML exceeds 16 MiB.');
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error('ADM AXML must contain valid UTF-8.', { cause: error });
	}
}

export function byteView(input: Uint8Array | ArrayBuffer | ArrayBufferView, field: string): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	throw new TypeError(`${field} must be bytes.`);
}

export function equalId(left: string, right: string): boolean { return left.toUpperCase() === right.toUpperCase(); }

export function sameIds(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => equalId(value, right[index] ?? '')); }

function addUnique(values: string[], value: string, field: string): void {
	if (values.some((candidate) => equalId(candidate, value))) throw new Error(`ADM ${field} contains duplicate reference ${value}.`);
	values.push(value);
}

function setOnce<Target extends { [key in Key]: string }, Key extends keyof Target>(target: Target, key: Key, value: string, field: string): void {
	if (target[key]) throw new Error(`ADM ${field} occurs more than once for an element.`);
	target[key] = value as Target[Key];
}

function setTrackReference(target: TrackUidBuilder, value: string, kind: Exclude<AdmTrackUid['trackRefKind'], ''>): void {
	if (target.trackRef) throw new Error(`ADM audioTrackUID ${target.uid} has more than one track or channel reference.`);
	target.trackRef = value;
	target.trackRefKind = kind;
}

export function isAxmlDocument(value: unknown): value is AdmAxmlDocument {
	return Boolean(value && typeof value === 'object' && 'programmes' in value && 'trackUids' in value && 'rawXml' in value);
}
