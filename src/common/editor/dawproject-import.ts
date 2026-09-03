/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	attribute,
	booleanAttribute,
	childElement,
	childElements,
	integerAttribute,
	numberAttribute,
	parseXmlDocument,
	walkXml,
	type XmlElement,
} from './dawproject-xml.ts';
import { normalizeEntryPath } from './dawproject-format.ts';

/**
 * The reading half of DAWproject, part one: `project.xml` and `metadata.xml`
 * into a typed document.
 *
 * This is deliberately thin. Structure — tracks, channels, parameters, sends —
 * is fully typed because every field of it maps onto a project field. The
 * arrangement is kept as element trees, because clips nest to arbitrary depth
 * with their own time units and are only meaningful once the tempo map exists;
 * `dawproject-import-timeline.ts` flattens them with that map in hand.
 */

export interface DawprojectParameter {
	readonly id: string | null;
	readonly value: number | null;
	readonly unit: string | null;
}

export interface DawprojectBoolParameter {
	readonly id: string | null;
	readonly value: boolean | null;
}

export interface DawprojectSend {
	readonly destination: string | null;
	readonly type: string | null;
	readonly volume: DawprojectParameter | null;
	readonly enabled: boolean;
}

export interface DawprojectChannel {
	readonly id: string | null;
	readonly role: string | null;
	readonly audioChannels: number | null;
	readonly destination: string | null;
	readonly solo: boolean;
	readonly volume: DawprojectParameter | null;
	readonly pan: DawprojectParameter | null;
	readonly mute: DawprojectBoolParameter | null;
	readonly sends: readonly DawprojectSend[];
	readonly devices: number;
}

export interface DawprojectTrack {
	readonly id: string | null;
	readonly name: string;
	readonly color: string | null;
	readonly contentTypes: readonly string[];
	readonly channel: DawprojectChannel | null;
	readonly children: readonly DawprojectTrack[];
}

export interface DawprojectTransport {
	readonly tempo: DawprojectParameter | null;
	readonly timeSignature: Readonly<{ id: string | null; numerator: number; denominator: number }> | null;
}

export interface DawprojectArrangement {
	readonly lanes: XmlElement | null;
	readonly markers: XmlElement | null;
	readonly tempoAutomation: XmlElement | null;
	readonly timeSignatureAutomation: XmlElement | null;
}

export interface DawprojectMetadata {
	readonly title: string | null;
	readonly artist: string | null;
	readonly album: string | null;
	readonly year: string | null;
	readonly comment: string | null;
}

export interface DawprojectMediaReference {
	readonly path: string;
	readonly external: boolean;
	readonly kind: 'audio' | 'video';
}

export interface DawprojectDocument {
	readonly root: XmlElement;
	readonly version: string | null;
	readonly application: Readonly<{ name: string; version: string }> | null;
	readonly transport: DawprojectTransport;
	readonly tracks: readonly DawprojectTrack[];
	readonly arrangement: DawprojectArrangement | null;
	readonly scenes: number;
	readonly elementsById: ReadonlyMap<string, XmlElement>;
	readonly metadata: DawprojectMetadata;
}

export function parseDawprojectDocument(projectXml: string, metadataXml?: string | null): DawprojectDocument {
	const root = parseXmlDocument(projectXml);
	const metadataRoot = typeof metadataXml === 'string' && metadataXml.trim() ? parseXmlDocument(metadataXml) : null;
	return parseDawprojectProjectElement(root, metadataRoot);
}

export function parseDawprojectProjectElement(root: XmlElement, metadataRoot: XmlElement | null = null): DawprojectDocument {
	if (root.name !== 'Project') {
		throw new SyntaxError(`A DAWproject project.xml starts with <Project>, not <${root.name}>.`);
	}
	const application = childElement(root, 'Application');
	const arrangementElement = childElement(root, 'Arrangement');
	const elementsById = new Map<string, XmlElement>();
	for (const element of walkXml(root)) {
		const id = attribute(element, 'id');
		if (id !== null && !elementsById.has(id)) elementsById.set(id, element);
	}
	return Object.freeze({
		root,
		version: attribute(root, 'version'),
		application: application
			? { name: attribute(application, 'name') ?? '', version: attribute(application, 'version') ?? '' }
			: null,
		transport: parseTransport(childElement(root, 'Transport')),
		tracks: Object.freeze(childElements(childElement(root, 'Structure') ?? root, 'Track').map(parseTrack)),
		arrangement: arrangementElement
			? Object.freeze({
				lanes: childElement(arrangementElement, 'Lanes'),
				markers: childElement(arrangementElement, 'Markers'),
				tempoAutomation: childElement(arrangementElement, 'TempoAutomation'),
				timeSignatureAutomation: childElement(arrangementElement, 'TimeSignatureAutomation'),
			})
			: null,
		scenes: childElements(childElement(root, 'Scenes') ?? xmlEmpty, 'Scene').length,
		elementsById,
		metadata: parseMetadata(metadataRoot),
	});
}

/** Every embedded or external media file the document references, once each. */
export function dawprojectMediaReferences(document: DawprojectDocument): readonly DawprojectMediaReference[] {
	const references = new Map<string, DawprojectMediaReference>();
	for (const element of walkXml(document.root)) {
		if (element.name !== 'Audio' && element.name !== 'Video') continue;
		const file = childElement(element, 'File');
		const path = file ? attribute(file, 'path') : null;
		if (!file || path === null || !path.trim()) continue;
		const normalized = normalizeEntryPath(path.trim());
		if (references.has(normalized)) continue;
		references.set(normalized, Object.freeze({
			path: normalized,
			external: booleanAttribute(file, 'external') === true,
			kind: element.name === 'Audio' ? 'audio' : 'video',
		}));
	}
	return Object.freeze([...references.values()]);
}

const xmlEmpty: XmlElement = Object.freeze({ name: 'empty', attributes: {}, children: [], text: '' });

function parseTransport(element: XmlElement | null): DawprojectTransport {
	if (!element) return Object.freeze({ tempo: null, timeSignature: null });
	const tempo = childElement(element, 'Tempo');
	const signature = childElement(element, 'TimeSignature');
	return Object.freeze({
		tempo: tempo ? parseRealParameter(tempo) : null,
		timeSignature: signature
			? Object.freeze({
				id: attribute(signature, 'id'),
				numerator: positiveInteger(integerAttribute(signature, 'numerator'), 4),
				denominator: positiveInteger(integerAttribute(signature, 'denominator'), 4),
			})
			: null,
	});
}

function parseTrack(element: XmlElement): DawprojectTrack {
	const channel = childElement(element, 'Channel');
	return Object.freeze({
		id: attribute(element, 'id'),
		name: attribute(element, 'name') ?? '',
		color: attribute(element, 'color'),
		contentTypes: Object.freeze((attribute(element, 'contentType') ?? '').split(/\s+/u).filter(Boolean)),
		channel: channel ? parseChannel(channel) : null,
		children: Object.freeze(childElements(element, 'Track').map(parseTrack)),
	});
}

function parseChannel(element: XmlElement): DawprojectChannel {
	const volume = childElement(element, 'Volume');
	const pan = childElement(element, 'Pan');
	const mute = childElement(element, 'Mute');
	const sends = childElement(element, 'Sends');
	const devices = childElement(element, 'Devices');
	return Object.freeze({
		id: attribute(element, 'id'),
		role: attribute(element, 'role'),
		audioChannels: integerAttribute(element, 'audioChannels'),
		destination: attribute(element, 'destination'),
		solo: booleanAttribute(element, 'solo') === true,
		volume: volume ? parseRealParameter(volume) : null,
		pan: pan ? parseRealParameter(pan) : null,
		mute: mute ? Object.freeze({ id: attribute(mute, 'id'), value: booleanAttribute(mute, 'value') }) : null,
		sends: Object.freeze(sends ? childElements(sends, 'Send').map(parseSend) : []),
		devices: devices ? devices.children.length : 0,
	});
}

function parseSend(element: XmlElement): DawprojectSend {
	const volume = childElement(element, 'Volume');
	const enable = childElement(element, 'Enable');
	return Object.freeze({
		destination: attribute(element, 'destination'),
		type: attribute(element, 'type'),
		volume: volume ? parseRealParameter(volume) : null,
		enabled: enable ? booleanAttribute(enable, 'value') !== false : true,
	});
}

function parseRealParameter(element: XmlElement): DawprojectParameter {
	return Object.freeze({
		id: attribute(element, 'id'),
		value: numberAttribute(element, 'value'),
		unit: attribute(element, 'unit'),
	});
}

function parseMetadata(root: XmlElement | null): DawprojectMetadata {
	const text = (elementName: string): string | null => {
		if (!root || root.name !== 'MetaData') return null;
		const value = childElement(root, elementName)?.text.trim() ?? '';
		return value || null;
	};
	return Object.freeze({
		title: text('Title'), artist: text('Artist'), album: text('Album'), year: text('Year'), comment: text('Comment'),
	});
}

function positiveInteger(value: number | null, fallback: number): number {
	return value !== null && value > 0 ? value : fallback;
}
