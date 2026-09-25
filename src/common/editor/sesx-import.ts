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
import { SESX_XML_MAXIMUM_BYTES } from './sesx-format.ts';

/** The subset of Audition's XML session vocabulary used for an audio timeline. */
export interface SesxAudioReference {
	readonly id: string;
	readonly relativePath: string | null;
	readonly absolutePath: string | null;
	readonly name: string;
}

export interface SesxClip {
	readonly id: string | null;
	readonly fileId: string;
	readonly name: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceInFrame: number;
	readonly sourceOutFrame: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly fadeCurvesChanged: boolean;
	readonly gain: number;
	readonly muted: boolean;
	readonly offline: boolean;
	readonly looped: boolean;
	readonly linkedCrossfade: boolean;
	readonly unsupportedPan: boolean;
	readonly remappedChannels: boolean;
	readonly stretch: boolean;
}

export interface SesxTrack {
	readonly id: string | null;
	readonly name: string;
	readonly channelCount: 1 | 2;
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly clips: readonly SesxClip[];
}

export interface SesxOmissions {
	readonly effects: number;
	readonly automation: number;
	readonly routing: number;
	readonly video: number;
	readonly markers: number;
	readonly clipGroups: number;
}

export interface SesxDocument {
	readonly version: string | null;
	readonly applicationVersion: string | null;
	readonly sampleRate: number;
	readonly channelCount: 1 | 2;
	readonly tracks: readonly SesxTrack[];
	readonly master: Readonly<{ gain: number; pan: number; mute: boolean }>;
	readonly files: ReadonlyMap<string, SesxAudioReference>;
	readonly omissions: SesxOmissions;
}

const SESX_XML_LIMITS = Object.freeze({
	maximumBytes: SESX_XML_MAXIMUM_BYTES,
	maximumDepth: 80,
	maximumElements: 500_000,
	maximumTextBytes: 2 * 1024 * 1024,
});
const SIMPLE_DOCTYPE = /<!DOCTYPE\s+sesx\s*>/iu;
const DECLARATION = /<!\s*(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)\b/iu;

export function parseSesxDocument(xml: string): SesxDocument {
	if (typeof xml !== 'string') throw new TypeError('An SESX session must be XML text.');
	// Audition writes <!DOCTYPE sesx> without an external or internal subset.
	// Removing only that spelling lets the bounded shared SAX reader parse the
	// document while refusing DTD entities and external declarations.
	const withoutDoctype = xml.replace(SIMPLE_DOCTYPE, '');
	if (DECLARATION.test(withoutDoctype)) throw new SyntaxError('SESX contains an unsupported doctype or entity declaration.');
	const root = parseXmlDocument(withoutDoctype, SESX_XML_LIMITS);
	if (root.name !== 'sesx') throw new SyntaxError(`An SESX document starts with <sesx>, not <${root.name}>.`);
	const session = childElement(root, 'session');
	if (!session) throw new SyntaxError('SESX has no <session> element.');
	const sampleRate = requiredInteger(session, 'sampleRate', 1);
	const channelCount = channelType(session, null);
	const tracksNode = childElement(session, 'tracks');
	if (!tracksNode) throw new SyntaxError('SESX session has no <tracks> element.');
	const audioTracks = childElements(tracksNode, 'audioTrack');
	const indexedTracks = audioTracks.map((element, position) => ({
		element, position, index: integerAttribute(element, 'index'),
	}));
	if (indexedTracks.every((track) => track.index !== null)) {
		indexedTracks.sort((a, b) => Number(a.index) - Number(b.index) || a.position - b.position);
	}
	const masterTrack = childElement(tracksNode, 'masterTrack');
	const masterParameters = masterTrack ? childElement(masterTrack, 'trackAudioParameters') : null;
	if (masterParameters) channelType(masterParameters, channelCount);
	const files = readFiles(childElement(root, 'files'));
	const masterControls = staticControls(masterParameters, 'track');
	const omissions = countOmissions(session, tracksNode, audioTracks, masterTrack);
	return Object.freeze({
		version: attribute(root, 'version'),
		applicationVersion: attribute(session, 'appVersion'),
		sampleRate,
		channelCount,
		tracks: Object.freeze(indexedTracks.map((track, index) => readTrack(track.element, index, channelCount))),
		master: Object.freeze({ gain: masterControls.gain, pan: masterControls.pan, mute: masterControls.mute }),
		files,
		omissions,
	});
}

/** File-table entries actually reached by audio clips, in first-clip order. */
export function sesxAudioReferences(document: SesxDocument): readonly SesxAudioReference[] {
	const refs = new Map<string, SesxAudioReference>();
	for (const track of document.tracks) {
		for (const clip of track.clips) {
			if (clip.offline) continue;
			const ref = document.files.get(clip.fileId);
			if (ref && !refs.has(ref.id)) refs.set(ref.id, ref);
		}
	}
	return Object.freeze([...refs.values()]);
}

function readFiles(files: XmlElement | null): ReadonlyMap<string, SesxAudioReference> {
	const refs = new Map<string, SesxAudioReference>();
	for (const file of files ? childElements(files, 'file') : []) {
		const id = requiredTextAttribute(file, 'id');
		if (refs.has(id)) throw new SyntaxError(`Duplicate SESX file ID: ${id}.`);
		const relativePath = attribute(file, 'relativePath')?.trim() || null;
		const absolutePath = attribute(file, 'absolutePath')?.trim() || null;
		const path = relativePath || absolutePath || '';
		refs.set(id, Object.freeze({
			id, relativePath, absolutePath,
			name: path.split(/[\\/]/u).filter(Boolean).at(-1) ?? id,
		}));
	}
	return refs;
}

function readTrack(element: XmlElement, index: number, sessionChannels: 1 | 2): SesxTrack {
	const parameters = childElement(element, 'trackAudioParameters');
	const controls = staticControls(parameters, 'track');
	return Object.freeze({
		id: attribute(element, 'id'),
		name: childElement(childElement(element, 'trackParameters') ?? element, 'name')?.text.trim() || `Track ${String(index + 1)}`,
		channelCount: channelType(parameters, sessionChannels),
		gain: controls.gain,
		pan: controls.pan,
		mute: controls.mute,
		solo: parameters ? booleanAttribute(parameters, 'solo') ?? false : false,
		clips: Object.freeze(childElements(element, 'audioClip').map(readClip)),
	});
}

function readClip(element: XmlElement): SesxClip {
	const startFrame = requiredInteger(element, 'startPoint', 0);
	const endFrame = requiredInteger(element, 'endPoint', startFrame + 1);
	const sourceInFrame = requiredInteger(element, 'sourceInPoint', 0);
	const sourceOutFrame = requiredInteger(element, 'sourceOutPoint', sourceInFrame + 1);
	const controls = staticControls(element, 'clip');
	const fadeIn = childElement(element, 'fadeIn');
	const fadeOut = childElement(element, 'fadeOut');
	const fadeInFrames = fadeLength(fadeIn);
	const fadeOutFrames = fadeLength(fadeOut);
	const clipPan = childElements(element, 'component').find((component) => attribute(component, 'id') === 'clipPan');
	const channelMap = childElement(element, 'channelMap');
	return Object.freeze({
		id: attribute(element, 'id'),
		fileId: requiredTextAttribute(element, 'fileID'),
		name: attribute(element, 'name')?.trim() ?? '',
		startFrame, endFrame, sourceInFrame, sourceOutFrame,
		fadeInFrames, fadeOutFrames,
		fadeCurvesChanged: (fadeInFrames > 0 && fadeTypeChanged(fadeIn)) || (fadeOutFrames > 0 && fadeTypeChanged(fadeOut)),
		gain: controls.gain,
		muted: controls.mute,
		offline: booleanAttribute(element, 'offline') ?? false,
		looped: booleanAttribute(element, 'looped') ?? false,
		linkedCrossfade: ['crossFadeHeadClipID', 'crossFadeTailClipID'].some((name) => {
			const id = attribute(element, name)?.trim();
			return Boolean(id && id !== '-1');
		}),
		unsupportedPan: Boolean(clipPan?.children.length),
		remappedChannels: Boolean(channelMap && childElements(channelMap, 'channel').some((channel) =>
			attribute(channel, 'index') !== attribute(channel, 'sourceIndex'))),
		stretch: Boolean(attribute(element, 'stretchMode') || attribute(element, 'stretchRatio')
			|| element.children.some((child) => /stretch|warp/iu.test(child.name))),
	});
}

function staticControls(element: XmlElement | null, scope: 'track' | 'clip'): Readonly<{ gain: number; pan: number; mute: boolean }> {
	const components = element ? childElements(element, 'component') : [];
	const find = (id: string): XmlElement | undefined => components.find((component) => attribute(component, 'id') === id);
	const fader = find(scope === 'track' ? 'trackFader' : 'clipGain');
	const mute = find(scope === 'track' ? 'trackMute' : 'clipMute');
	const pan = scope === 'track' ? find('trackPan') : undefined;
	const volume = parameter(fader, 'volume') ?? 1;
	const staticGain = parameter(fader, 'static gain') ?? 1;
	if (volume < 0 || staticGain < 0) throw new RangeError('SESX volume and static gain must be non-negative.');
	const panValue = parameter(pan, 'Pan') ?? 0;
	if (panValue < -1 || panValue > 1) throw new RangeError('SESX pan must be between -1 and 1.');
	return Object.freeze({
		gain: volume * staticGain,
		pan: panValue,
		mute: (parameter(mute, 'mute') ?? 0) !== 0,
	});
}

function parameter(component: XmlElement | undefined, name: string): number | null {
	if (!component) return null;
	const item = childElements(component, 'parameter').find((entry) => attribute(entry, 'name') === name);
	return item ? numberAttribute(item, 'parameterValue') : null;
}

function fadeLength(fade: XmlElement | null): number {
	if (!fade) return 0;
	const start = requiredInteger(fade, 'startPoint', 0);
	const end = requiredInteger(fade, 'endPoint', 0);
	return Math.abs(end - start);
}

function fadeTypeChanged(fade: XmlElement | null): boolean {
	const type = fade ? attribute(fade, 'type') : null;
	return Boolean(type && type !== 'linear');
}

function channelType(element: XmlElement | null, fallback: 1 | 2 | null): 1 | 2 {
	const value = element ? attribute(element, 'audioChannelType') : null;
	if (!value && fallback) return fallback;
	if (value === 'mono') return 1;
	if (value === 'stereo') return 2;
	throw new RangeError('SESX audioChannelType must be mono or stereo. Surround sessions are unsupported.');
}

function requiredInteger(element: XmlElement, name: string, minimum: number): number {
	const value = integerAttribute(element, name);
	if (value === null || value < minimum) {
		throw new RangeError(`<${element.name}> ${name} must be an integer at least ${String(minimum)}.`);
	}
	return value;
}

function requiredTextAttribute(element: XmlElement, name: string): string {
	const value = attribute(element, name)?.trim();
	if (!value) throw new SyntaxError(`<${element.name}> requires ${name}.`);
	return value;
}

function countOmissions(session: XmlElement, tracks: XmlElement, audioTracks: readonly XmlElement[], master: XmlElement | null): SesxOmissions {
	const known = new Set(['trackFader', 'trackMute', 'trackPan', 'clipGain', 'clipMute', 'clipPan']);
	let effects = 0;
	let automation = 0;
	let routing = 0;
	for (const track of [...audioTracks, ...(master ? [master] : [])]) {
		const parameters = childElement(track, 'trackAudioParameters');
		const output = parameters ? childElement(parameters, 'trackOutput') : null;
		if (track.name === 'audioTrack' && output && master
			&& attribute(output, 'outputID') !== attribute(master, 'id')) routing += 1;
		for (const element of walkXml(track)) {
			if (element.name === 'component' && attribute(element, 'powered') !== 'false'
				&& !known.has(attribute(element, 'id') ?? '')) effects += 1;
			if (/automation(?:lane|curve|point|track)?$/iu.test(element.name)) automation += 1;
		}
	}
	routing += tracks.children.filter((element) => !['audioTrack', 'masterTrack', 'videoTrack'].includes(element.name)).length;
	const markers = [...walkXml(session)].filter((element) => element.name === 'marker').length;
	const clipGroups = childElement(session, 'clipGroups')?.children.length ?? 0;
	const video = [...walkXml(tracks)].filter((element) => element.name === 'videoTrack' || element.name === 'videoClip').length;
	return Object.freeze({ effects, automation, routing, video, markers, clipGroups });
}
