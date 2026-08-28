/* SPDX-License-Identifier: AGPL-3.0-only */

import { SaxesParser, type SaxesTagNS } from 'saxes';
import type {
	VideoCaptionCueV1,
	VideoCaptionRegionV1,
	VideoCaptionSpeakerV1,
	VideoCaptionStyleV1,
	VideoCaptionTrackV1,
	VideoCaptionWordV1,
} from './video-caption-track-v27.ts';
import {
	IMSC_XML_ID_V1,
	createImscXmlIdentitiesV1,
	type ImscXmlIdentitiesV1,
} from './video-caption-imsc-identities-v27.ts';
import {
	VideoCaptionInterchangeError,
	VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1,
	assertCaptionOutputBytes,
	captionLoss,
	freezeCaptionLosses,
	interchangeError,
	timeUnitsToFrame,
	type VideoCaptionImportOptionsV1,
	type VideoCaptionImportResultV1,
	type VideoCaptionInterchangeLimitsV1,
	type VideoCaptionInterchangeLossV1,
	type VideoCaptionTrackNormalizerV1,
	type VideoCaptionExportResultV1,
} from './video-caption-interchange-contract-v27.ts';

const TT = 'http://www.w3.org/ns/ttml';
const TTP = 'http://www.w3.org/ns/ttml#parameter';
const TTS = 'http://www.w3.org/ns/ttml#styling';
const TTM = 'http://www.w3.org/ns/ttml#metadata';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const IMSC_TEXT_PROFILE = 'http://www.w3.org/ns/ttml/profile/imsc1.1/text';
const PASSIVE_NAMESPACES = new Set([TT, TTP, TTS, TTM, XML]);
const FONT_TO_TTML = Object.freeze({
	'soundscaper-sans': 'sansSerif',
	'soundscaper-serif': 'serif',
	'soundscaper-mono': 'monospace',
} as const);
const TTML_TO_FONT: Readonly<Record<string, VideoCaptionStyleV1['fontFamily']>> = Object.freeze({
	sansSerif: 'soundscaper-sans',
	serif: 'soundscaper-serif',
	monospace: 'soundscaper-mono',
});

interface CueBuilder {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
	text: string;
	readonly styleId: string | null;
	readonly regionId: string | null;
	readonly speakerId: string | null;
	readonly words: VideoCaptionWordV1[];
}

interface SpeakerBuilder {
	readonly schemaVersion: 1;
	readonly id: string;
	name: string;
}

type FrameKind = 'tt' | 'head' | 'metadata' | 'title' | 'agent' | 'name'
	| 'styling' | 'style' | 'layout' | 'region' | 'body' | 'div' | 'p' | 'span' | 'br';

interface XmlFrame {
	readonly kind: FrameKind;
	text: string;
	cue?: CueBuilder;
	wordTiming?: Readonly<{ startFrame: number; endFrame: number }>;
	speaker?: SpeakerBuilder;
	nameSeen?: boolean;
}

interface ParseState {
	readonly options: VideoCaptionImportOptionsV1;
	readonly limits: Readonly<VideoCaptionInterchangeLimitsV1>;
	readonly losses: VideoCaptionInterchangeLossV1[];
	readonly styles: VideoCaptionStyleV1[];
	readonly regions: VideoCaptionRegionV1[];
	readonly speakers: VideoCaptionSpeakerV1[];
	readonly cues: CueBuilder[];
	readonly stack: XmlFrame[];
	readonly singletonElements: Set<FrameKind>;
	readonly xmlIds: Set<string>;
	elements: number;
	tickRate: number;
	trackId: string;
	trackName: string;
	language: string;
	rootSeen: boolean;
	titleSeen: boolean;
}

export function importImscCaptionTrackV1(
	xml: string,
	options: VideoCaptionImportOptionsV1,
	limits: Readonly<VideoCaptionInterchangeLimitsV1>,
	normalize: VideoCaptionTrackNormalizerV1,
): VideoCaptionImportResultV1 {
	assertNoActiveXml(xml);
	const state: ParseState = {
		options,
		limits,
		losses: [],
		styles: [],
		regions: [],
		speakers: [],
		cues: [],
		stack: [],
		singletonElements: new Set(),
		xmlIds: new Set(),
		elements: 0,
		tickRate: 0,
		trackId: options.trackId,
		trackName: options.trackName,
		language: options.language,
		rootSeen: false,
		titleSeen: false,
	};
	const parser = new SaxesParser({ xmlns: true, position: false });
	parser.on('doctype', () => { throw activeContent('IMSC does not allow a document type declaration.'); });
	parser.on('processinginstruction', () => { throw activeContent('IMSC does not allow processing instructions.'); });
	parser.on('cdata', () => { throw activeContent('The maintained IMSC subset does not allow CDATA.'); });
	parser.on('opentag', (tag) => openImscElement(tag, state));
	parser.on('text', (text) => appendImscText(text, state));
	parser.on('closetag', () => closeImscElement(state));
	try {
		parser.write(xml).close();
	} catch (error) {
		if (error instanceof VideoCaptionInterchangeError) throw error;
		throw interchangeError('IMSC input is not well-formed XML.', 'INVALID_XML', {}, error);
	}
	if (!state.rootSeen || state.stack.length !== 0) throw interchangeError('IMSC input must contain one complete tt root.', 'INVALID_XML');
	const track = normalize({
		schemaVersion: 1,
		id: state.trackId,
		sequenceId: options.sequenceId,
		name: state.trackName,
		language: state.language,
		styles: state.styles,
		regions: state.regions,
		speakers: state.speakers,
		cues: state.cues,
	});
	return Object.freeze({ format: 'imsc1.1', track, losses: freezeCaptionLosses(state.losses) });
}

export function exportImscCaptionTrackV1(
	track: VideoCaptionTrackV1,
	sampleRate: number,
): VideoCaptionExportResultV1 {
	const elements = 8 + (track.speakers.length * 2) + track.styles.length + track.regions.length
		+ track.cues.length + track.cues.reduce((total, cue) => total + cue.words.length, 0);
	if (elements > VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1.maximumElements) {
		throw interchangeError('IMSC output exceeds its element-count limit.', 'ELEMENT_LIMIT', {
			maximum: VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1.maximumElements,
			observed: elements,
		});
	}
	const losses: VideoCaptionInterchangeLossV1[] = [captionLoss(
		'sequence-binding-omitted',
		'track.sequenceId',
		'IMSC does not carry the Soundscaper project sequence binding.',
		{ sequenceId: track.sequenceId },
	)];
	const identities = createImscXmlIdentitiesV1(track, losses);
	const speakers = track.speakers.map((speaker) => '<ttm:agent xml:id="'
		+ `${xml(mapped(identities.speakers, speaker.id))}" type="person"><ttm:name>${xml(speaker.name)}</ttm:name></ttm:agent>`).join('');
	const styles = track.styles.map((style) => exportStyle(style, identities)).join('');
	const regions = track.regions.map((region) => exportRegion(region, identities)).join('');
	const cues = track.cues.map((cue) => exportCue(cue, identities, losses)).join('');
	const text = `<tt xmlns="${TT}" xmlns:ttp="${TTP}" xmlns:tts="${TTS}" xmlns:ttm="${TTM}"`
		+ ` xml:id="${xml(identities.trackId)}" xml:lang="${xml(track.language)}" xml:space="preserve"`
		+ ` ttp:contentProfiles="${IMSC_TEXT_PROFILE}" ttp:timeBase="media" ttp:tickRate="${sampleRate}">`
		+ `<head><metadata><ttm:title>${xml(track.name)}</ttm:title>${speakers}</metadata>`
		+ `<styling>${styles}</styling><layout>${regions}</layout></head>`
		+ `<body><div>${cues}</div></body></tt>`;
	assertCaptionOutputBytes(text);
	return Object.freeze({
		format: 'imsc1.1',
		mediaType: 'application/ttml+xml',
		text,
		losses: freezeCaptionLosses(losses),
	});
}

function openImscElement(tag: SaxesTagNS, state: ParseState): void {
	state.elements += 1;
	if (state.elements > state.limits.maximumElements) throw interchangeError('IMSC exceeds its element-count limit.', 'ELEMENT_LIMIT', { maximum: state.limits.maximumElements, observed: state.elements });
	if (state.stack.length >= state.limits.maximumDepth) throw interchangeError('IMSC exceeds its XML depth limit.', 'DEPTH_LIMIT', { maximum: state.limits.maximumDepth, observed: state.stack.length + 1 });
	const kind = imscKind(tag);
	const parent = state.stack.at(-1)?.kind ?? null;
	assertHierarchy(kind, parent);
	if (isSingletonElement(kind)) {
		if (state.singletonElements.has(kind)) throw interchangeError(`The maintained IMSC subset allows only one ${kind} element.`, 'UNSUPPORTED_CONSTRUCT');
		state.singletonElements.add(kind);
	}
	validateAttributes(tag, kind);
	registerXmlIdentity(tag, state);
	const space = attribute(tag, XML, 'space');
	if (space !== null && space !== 'preserve') {
		throw interchangeError('The maintained IMSC subset requires preserved XML whitespace.', 'UNSUPPORTED_PROFILE');
	}
	const frame: XmlFrame = { kind, text: '' };
	if (kind === 'tt') readRoot(tag, state);
	else if (kind === 'style') state.styles.push(readStyle(tag, state));
	else if (kind === 'region') state.regions.push(readRegion(tag));
	else if (kind === 'agent') frame.speaker = readSpeaker(tag);
	else if (kind === 'p') {
		if (state.cues.length >= state.limits.maximumCues) throw interchangeError('IMSC exceeds its cue-count limit.', 'CUE_LIMIT', { maximum: state.limits.maximumCues, observed: state.cues.length + 1 });
		frame.cue = readCue(tag, state);
	} else if (kind === 'span') {
		const cue = state.stack.at(-1)?.cue;
		if (!cue) throw interchangeError('IMSC word spans must be direct cue children.', 'INVALID_XML');
		frame.wordTiming = readTiming(
			tag, state, 'caption word', cue.startFrame, `${cue.id}.words.${cue.words.length}`,
		);
	}
	state.stack.push(frame);
}

function closeImscElement(state: ParseState): void {
	const frame = state.stack.pop();
	if (!frame) throw interchangeError('IMSC has an unexpected closing element.', 'INVALID_XML');
	const parent = state.stack.at(-1);
	if (frame.kind === 'title') {
		if (state.titleSeen) throw interchangeError('IMSC may contain at most one caption title.', 'INVALID_CAPTION');
		state.titleSeen = true;
		state.trackName = frame.text;
	}
	else if (frame.kind === 'name') {
		if (!parent?.speaker) throw interchangeError('IMSC speaker name is outside an agent.', 'INVALID_XML');
		if (parent.nameSeen) throw interchangeError('IMSC speaker agents may contain exactly one name.', 'INVALID_CAPTION');
		parent.nameSeen = true;
		parent.speaker.name = frame.text;
	} else if (frame.kind === 'agent') {
		if (!frame.speaker || !frame.nameSeen || frame.speaker.name.length === 0) throw interchangeError('IMSC speaker agents require exactly one name.', 'INVALID_CAPTION');
		state.speakers.push(Object.freeze({
			schemaVersion: 1,
			id: frame.speaker.id,
			name: frame.speaker.name,
		}));
	} else if (frame.kind === 'span') {
		if (!parent?.cue || !frame.wordTiming) throw interchangeError('IMSC word spans must be direct cue children.', 'INVALID_XML');
		parent.text += frame.text;
		parent.cue.words.push(Object.freeze({ ...frame.wordTiming, text: frame.text }));
	} else if (frame.kind === 'br') {
		if (!parent || (parent.kind !== 'p' && parent.kind !== 'span')) throw interchangeError('IMSC line breaks must be inside cue text.', 'INVALID_XML');
		parent.text += '\n';
	} else if (frame.kind === 'p') {
		if (!frame.cue) throw interchangeError('IMSC cue state is incomplete.', 'INVALID_XML');
		frame.cue.text = frame.text;
		state.cues.push(frame.cue);
	}
}

function appendImscText(text: string, state: ParseState): void {
	const frame = state.stack.at(-1);
	if (!frame) {
		if (text.trim() !== '') throw interchangeError('IMSC has text outside its root.', 'INVALID_XML');
		return;
	}
	if (frame.kind === 'p' || frame.kind === 'span' || frame.kind === 'title' || frame.kind === 'name') {
		frame.text += text;
		return;
	}
	if (text.trim() !== '') throw activeContent(`IMSC ${frame.kind} contains unsupported text.`);
}

function readRoot(tag: SaxesTagNS, state: ParseState): void {
	if (state.rootSeen) throw interchangeError('IMSC must contain exactly one tt root.', 'INVALID_XML');
	state.rootSeen = true;
	const profile = attribute(tag, TTP, 'contentProfiles') ?? attribute(tag, TTP, 'profile');
	if (profile !== IMSC_TEXT_PROFILE || attribute(tag, TTP, 'timeBase') !== 'media') {
		throw interchangeError('IMSC must declare the reviewed IMSC 1.1 text profile and media time base.', 'UNSUPPORTED_PROFILE');
	}
	if (attribute(tag, XML, 'space') !== 'preserve') {
		throw interchangeError('The maintained IMSC subset requires xml:space="preserve" on tt.', 'UNSUPPORTED_PROFILE');
	}
	const tickRate = attribute(tag, TTP, 'tickRate');
	state.tickRate = tickRate === null ? 0 : positiveInteger(tickRate, 'IMSC tickRate', 1_000_000_000);
	state.trackId = attribute(tag, XML, 'id') ?? state.options.trackId;
	state.language = attribute(tag, XML, 'lang') ?? state.options.language;
}

function readStyle(tag: SaxesTagNS, state: ParseState): VideoCaptionStyleV1 {
	const id = requiredAttribute(tag, XML, 'id', 'IMSC style ID');
	const values = [
		attribute(tag, TTS, 'fontFamily'), attribute(tag, TTS, 'fontSize'),
		attribute(tag, TTS, 'color'), attribute(tag, TTS, 'backgroundColor'),
		attribute(tag, TTS, 'fontWeight'), attribute(tag, TTS, 'fontStyle'),
		attribute(tag, TTS, 'textDecoration'), attribute(tag, TTS, 'textAlign'),
	];
	if (values.some((value) => value === null)) state.losses.push(captionLoss('style-properties-defaulted', `styles.${id}`, 'Missing IMSC style properties use bounded caption defaults.'));
	const familyToken = values[0] ?? 'sansSerif';
	if (!Object.hasOwn(TTML_TO_FONT, familyToken)) {
		throw interchangeError(`Unsupported IMSC font family: ${familyToken}.`, 'UNSUPPORTED_STYLE');
	}
	const family = TTML_TO_FONT[familyToken]!;
	return Object.freeze({
		schemaVersion: 1,
		id,
		fontFamily: family,
		fontSizePercent: percent(values[1] ?? '5%', 'IMSC font size'),
		foregroundColor: color(values[2] ?? '#ffffffff', 'IMSC foreground color'),
		backgroundColor: color(values[3] ?? '#000000cc', 'IMSC background color'),
		fontWeight: choice(values[4] ?? 'normal', ['normal', 'bold'] as const, 'IMSC font weight'),
		fontStyle: choice(values[5] ?? 'normal', ['normal', 'italic'] as const, 'IMSC font style'),
		textDecoration: choice(values[6] ?? 'none', ['none', 'underline'] as const, 'IMSC text decoration'),
		textAlign: choice(values[7] ?? 'center', ['start', 'center', 'end'] as const, 'IMSC text alignment'),
	});
}

function readRegion(tag: SaxesTagNS): VideoCaptionRegionV1 {
	const origin = pair(requiredAttribute(tag, TTS, 'origin', 'IMSC region origin'), 'IMSC region origin');
	const extent = pair(requiredAttribute(tag, TTS, 'extent', 'IMSC region extent'), 'IMSC region extent');
	return Object.freeze({
		schemaVersion: 1,
		id: requiredAttribute(tag, XML, 'id', 'IMSC region ID'),
		xPercent: origin[0],
		yPercent: origin[1],
		widthPercent: extent[0],
		heightPercent: extent[1],
		displayAlign: choice(requiredAttribute(tag, TTS, 'displayAlign', 'IMSC region display alignment'), ['before', 'center', 'after'] as const, 'IMSC region display alignment'),
	});
}

function readSpeaker(tag: SaxesTagNS): SpeakerBuilder {
	const type = attribute(tag, '', 'type') ?? 'person';
	if (type !== 'person') throw interchangeError(`Unsupported IMSC agent type: ${type}.`, 'UNSUPPORTED_CAPTION');
	return { schemaVersion: 1, id: requiredAttribute(tag, XML, 'id', 'IMSC speaker ID'), name: '' };
}

function readCue(tag: SaxesTagNS, state: ParseState): CueBuilder {
	const timing = readTiming(tag, state, 'caption cue');
	return {
		schemaVersion: 1,
		id: requiredAttribute(tag, XML, 'id', 'IMSC cue ID'),
		...timing,
		text: '',
		styleId: attribute(tag, '', 'style'),
		regionId: attribute(tag, '', 'region'),
		speakerId: attribute(tag, TTM, 'agent'),
		words: [],
	};
}

function readTiming(
	tag: SaxesTagNS,
	state: ParseState,
	name: string,
	baseFrame = 0,
	ownerId?: string,
): Readonly<{ startFrame: number; endFrame: number }> {
	const startValue = requiredAttribute(tag, '', 'begin', `${name} begin`);
	const endValue = requiredAttribute(tag, '', 'end', `${name} end`);
	const start = parseImscTime(startValue, state.tickRate, state.options.sampleRate);
	const end = parseImscTime(endValue, state.tickRate, state.options.sampleRate);
	const startFrame = baseFrame + start.frame;
	const endFrame = baseFrame + end.frame;
	if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)) throw interchangeError(`${name} exceeds the safe sample-frame range.`, 'INVALID_TIMING');
	const id = ownerId ?? attribute(tag, XML, 'id') ?? `${state.cues.length}`;
	if (!start.exact) state.losses.push(imscTimingLoss(id, 'startFrame', startValue, startFrame));
	if (!end.exact) state.losses.push(imscTimingLoss(id, 'endFrame', endValue, endFrame));
	if (endFrame <= startFrame) throw interchangeError(`${name} must end after it starts.`, 'INVALID_TIMING');
	return Object.freeze({ startFrame, endFrame });
}

function parseImscTime(value: string, tickRate: number, sampleRate: number): { readonly frame: number; readonly exact: boolean } {
	const ticks = value.match(/^(\d+)t$/u);
	if (ticks) {
		if (tickRate === 0) throw interchangeError('IMSC tick timing requires ttp:tickRate.', 'UNSUPPORTED_PROFILE');
		return timeUnitsToFrame(BigInt(ticks[1] ?? 0), BigInt(tickRate), sampleRate);
	}
	const clock = value.match(/^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?$/u);
	if (!clock) throw interchangeError(`Unsupported IMSC time expression: ${value}.`, 'INVALID_TIMING');
	const fraction = clock[4] ?? '';
	const denominator = 10n ** BigInt(fraction.length);
	const seconds = (BigInt(clock[1] ?? 0) * 60n + BigInt(clock[2] ?? 0)) * 60n + BigInt(clock[3] ?? 0);
	return timeUnitsToFrame(seconds * denominator + BigInt(fraction || 0), denominator, sampleRate);
}

function exportStyle(style: VideoCaptionStyleV1, identities: ImscXmlIdentitiesV1): string {
	return `<style xml:id="${xml(mapped(identities.styles, style.id))}" tts:fontFamily="${FONT_TO_TTML[style.fontFamily]}"`
		+ ` tts:fontSize="${style.fontSizePercent}%" tts:color="${style.foregroundColor}"`
		+ ` tts:backgroundColor="${style.backgroundColor}" tts:fontWeight="${style.fontWeight}"`
		+ ` tts:fontStyle="${style.fontStyle}" tts:textDecoration="${style.textDecoration}"`
		+ ` tts:textAlign="${style.textAlign}"/>`;
}

function exportRegion(region: VideoCaptionRegionV1, identities: ImscXmlIdentitiesV1): string {
	return `<region xml:id="${xml(mapped(identities.regions, region.id))}" tts:origin="${region.xPercent}% ${region.yPercent}%"`
		+ ` tts:extent="${region.widthPercent}% ${region.heightPercent}%" tts:displayAlign="${region.displayAlign}"/>`;
}

function exportCue(
	cue: VideoCaptionCueV1,
	identities: ImscXmlIdentitiesV1,
	losses: VideoCaptionInterchangeLossV1[],
): string {
	const references = `${cue.styleId === null ? '' : ` style="${xml(mapped(identities.styles, cue.styleId))}"`}`
		+ `${cue.regionId === null ? '' : ` region="${xml(mapped(identities.regions, cue.regionId))}"`}`
		+ `${cue.speakerId === null ? '' : ` ttm:agent="${xml(mapped(identities.speakers, cue.speakerId))}"`}`;
	return `<p xml:id="${xml(mapped(identities.cues, cue.id))}" begin="${cue.startFrame}t" end="${cue.endFrame}t"${references}>`
		+ `${exportCueText(cue, losses)}</p>`;
}

function exportCueText(cue: VideoCaptionCueV1, losses: VideoCaptionInterchangeLossV1[]): string {
	if (cue.words.length === 0) return xml(cue.text);
	let cursor = 0;
	let result = '';
	for (const word of cue.words) {
		const index = cue.text.indexOf(word.text, cursor);
		if (index < cursor) {
			losses.push(captionLoss('word-timing-omitted', `cues.${cue.id}.words`, 'Word text cannot be mapped sequentially into the cue text.', { count: cue.words.length }));
			return xml(cue.text);
		}
		result += xml(cue.text.slice(cursor, index));
		result += `<span begin="${word.startFrame - cue.startFrame}t" end="${word.endFrame - cue.startFrame}t">${xml(word.text)}</span>`;
		cursor = index + word.text.length;
	}
	return result + xml(cue.text.slice(cursor));
}

function imscKind(tag: SaxesTagNS): FrameKind {
	const key = `${tag.uri}|${tag.local}`;
	const kind = ({
		[`${TT}|tt`]: 'tt', [`${TT}|head`]: 'head', [`${TT}|metadata`]: 'metadata',
		[`${TTM}|title`]: 'title', [`${TTM}|agent`]: 'agent', [`${TTM}|name`]: 'name',
		[`${TT}|styling`]: 'styling', [`${TT}|style`]: 'style', [`${TT}|layout`]: 'layout',
		[`${TT}|region`]: 'region', [`${TT}|body`]: 'body', [`${TT}|div`]: 'div',
		[`${TT}|p`]: 'p', [`${TT}|span`]: 'span', [`${TT}|br`]: 'br',
	} as Record<string, FrameKind>)[key];
	if (!kind) throw activeContent(`Element ${tag.name} is outside the passive IMSC subset.`);
	return kind;
}

function assertHierarchy(kind: FrameKind, parent: FrameKind | null): void {
	const parents: Readonly<Record<FrameKind, readonly (FrameKind | null)[]>> = Object.freeze({
		tt: [null], head: ['tt'], metadata: ['head'], title: ['metadata'], agent: ['metadata'],
		name: ['agent'], styling: ['head'], style: ['styling'], layout: ['head'], region: ['layout'],
		body: ['tt'], div: ['body'], p: ['div'], span: ['p'], br: ['p', 'span'],
	});
	if (!parents[kind].includes(parent)) throw activeContent(`IMSC ${kind} is not allowed inside ${parent ?? 'the document'}.`);
}

function isSingletonElement(kind: FrameKind): boolean {
	return kind === 'tt' || kind === 'head' || kind === 'metadata' || kind === 'styling'
		|| kind === 'layout' || kind === 'body' || kind === 'div';
}

function validateAttributes(tag: SaxesTagNS, kind: FrameKind): void {
	const allowed: Readonly<Record<FrameKind, readonly string[]>> = Object.freeze({
		tt: [key(TTP, 'contentProfiles'), key(TTP, 'profile'), key(TTP, 'timeBase'), key(TTP, 'tickRate'), key(XML, 'id'), key(XML, 'lang'), key(XML, 'space')],
		head: [], metadata: [], title: [], styling: [], layout: [], body: [], div: [], name: [], br: [],
		agent: [key(XML, 'id'), key('', 'type')],
		style: [key(XML, 'id'), key(TTS, 'fontFamily'), key(TTS, 'fontSize'), key(TTS, 'color'), key(TTS, 'backgroundColor'), key(TTS, 'fontWeight'), key(TTS, 'fontStyle'), key(TTS, 'textDecoration'), key(TTS, 'textAlign')],
		region: [key(XML, 'id'), key(TTS, 'origin'), key(TTS, 'extent'), key(TTS, 'displayAlign')],
		p: [key(XML, 'id'), key('', 'begin'), key('', 'end'), key('', 'style'), key('', 'region'), key(TTM, 'agent'), key(XML, 'space')],
		span: [key('', 'begin'), key('', 'end'), key(XML, 'space')],
	});
	for (const candidate of Object.values(tag.attributes)) {
		if (candidate.uri === XMLNS) {
			if (!PASSIVE_NAMESPACES.has(candidate.value)) throw activeContent(`Namespace ${candidate.value} is outside the passive IMSC subset.`);
			continue;
		}
		if (!allowed[kind].includes(key(candidate.uri, candidate.local))) {
			throw activeContent(`Attribute ${candidate.name} is outside the passive IMSC subset.`);
		}
	}
}

function attribute(tag: SaxesTagNS, uri: string, local: string): string | null {
	return Object.values(tag.attributes).find((candidate) => candidate.uri === uri && candidate.local === local)?.value ?? null;
}

function registerXmlIdentity(tag: SaxesTagNS, state: ParseState): void {
	const id = attribute(tag, XML, 'id');
	if (id === null) return;
	if (!IMSC_XML_ID_V1.test(id) || state.xmlIds.has(id)) {
		throw interchangeError('IMSC xml:id values must be unique bounded XML identities.', 'INVALID_CAPTION');
	}
	state.xmlIds.add(id);
}

function mapped(identities: ReadonlyMap<string, string>, source: string): string {
	const identity = identities.get(source);
	if (identity === undefined) throw interchangeError('IMSC identity mapping is incomplete.', 'INVALID_CAPTION');
	return identity;
}

function requiredAttribute(tag: SaxesTagNS, uri: string, local: string, name: string): string {
	const value = attribute(tag, uri, local);
	if (value === null || value.length === 0) throw interchangeError(`${name} is required.`, 'INVALID_CAPTION');
	return value;
}

function pair(value: string, name: string): readonly [number, number] {
	const match = value.match(/^(\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/u);
	if (!match) throw interchangeError(`${name} must contain two percentages.`, 'INVALID_CAPTION');
	return [Number(match[1]), Number(match[2])];
}

function percent(value: string, name: string): number {
	const match = value.match(/^(\d+(?:\.\d+)?)%$/u);
	if (!match) throw interchangeError(`${name} must be a percentage.`, 'UNSUPPORTED_STYLE');
	return Number(match[1]);
}

function color(value: string, name: string): string {
	const normalized = /^#[a-f0-9]{6}$/iu.test(value) ? `${value}ff`.toLowerCase() : value.toLowerCase();
	if (!/^#[a-f0-9]{8}$/u.test(normalized)) throw interchangeError(`${name} must be #rrggbb or #rrggbbaa.`, 'UNSUPPORTED_STYLE');
	return normalized;
}

function choice<const Values extends readonly string[]>(value: string, values: Values, name: string): Values[number] {
	if (!values.includes(value)) throw interchangeError(`${name} is unsupported.`, 'UNSUPPORTED_STYLE');
	return value as Values[number];
}

function positiveInteger(value: string | null, name: string, maximum: number): number {
	if (value === null || !/^\d+$/u.test(value)) throw interchangeError(`${name} must be a positive integer.`, 'UNSUPPORTED_PROFILE');
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw interchangeError(`${name} is outside its bound.`, 'UNSUPPORTED_PROFILE');
	return number;
}

function assertNoActiveXml(value: string): void {
	const withoutDeclaration = value.replace(/^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?\s*\?>/iu, '');
	if (/<!\s*(?:DOCTYPE|ENTITY)\b|<\?|<!\[CDATA\[/iu.test(withoutDeclaration)) {
		throw activeContent('DTD, entity declarations, processing instructions, and CDATA are not allowed in IMSC.');
	}
}

function imscTimingLoss(id: string, field: 'startFrame' | 'endFrame', source: string, frame: number): VideoCaptionInterchangeLossV1 {
	return captionLoss('timing-quantized', `cues.${id}.${field}`, 'The IMSC time is not an exact sample-frame boundary.', { source, frame });
}

function key(uri: string, local: string): string {
	return `${uri}|${local}`;
}

function xml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function activeContent(message: string): VideoCaptionInterchangeError {
	return interchangeError(message, 'ACTIVE_CONTENT');
}
