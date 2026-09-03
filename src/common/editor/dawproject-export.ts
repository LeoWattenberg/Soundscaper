/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { reportInterchangeCaptionTrackOmission } from './interchange-omission-inventory.ts';
import { audioTrackChannelCount } from './project-audio-factory.js';
import { serializeXmlDocument, xmlElement, type XmlElement } from './dawproject-xml.ts';
import {
	DAWPROJECT_DELIVERY_FORMAT,
	DAWPROJECT_FILE_EXTENSION,
	DAWPROJECT_MIME_TYPE,
	DAWPROJECT_VERSION,
	DawprojectIdAllocator,
	isHexColor,
	panToNormalized,
	rationalToNumber,
} from './dawproject-format.ts';
import {
	type DataRecord,
	type DawprojectExportContext,
	type DawprojectMediaEntry,
	type DawprojectStructureNode,
	DawprojectMediaRegistry,
	channelIdFor,
	dawprojectStructureTree,
	finite,
	parameterIdFor,
	readDawprojectMixerRouting,
	record,
	records,
} from './dawproject-export-context.ts';
import { buildArrangement } from './dawproject-export-lanes.ts';
import type { HoldTempoMap } from './timeline-time.ts';

/**
 * DAWproject export.
 *
 * DAWproject is a project exchange, not an edit list, and that changes which
 * milestone-6 exporter rule applies. EDL, OTIO, and FCPXML describe the render,
 * so a muted track is left out of them; DAWproject carries mute and solo as
 * channel state, so the same track is written with its flag set and nothing is
 * left out on the render's behalf. What the format cannot carry — the editor's
 * own effect stacks, clip gain and envelopes, pitch shift, region extents — is
 * itemized in the delivery report with the same dispositions the other
 * profiles use, never approximated silently.
 *
 * Time is written in seconds. Every clip in the delivered project has an exact
 * sample position, and a double holds a sample count at any realistic length
 * without loss, whereas beats would round-trip through the tempo map twice.
 * The tempo and signature maps ride along as automation in beats, so the
 * receiving DAW's grid still agrees with ours. Embedded audio is float32 WAV
 * at the source's own rate: the same samples the project holds, no dither, no
 * resampling.
 */

export interface DawprojectExportRequest {
	readonly project: DataRecord;
	readonly title?: string;
	readonly sequenceId?: string;
	readonly application?: Readonly<{ name: string; version: string }>;
	/** Video sources whose original container the caller can embed; others are reported. */
	readonly embeddableVideoSourceIds?: Iterable<string>;
}

export interface DawprojectExportResult {
	readonly projectXml: string;
	readonly metadataXml: string;
	readonly document: XmlElement;
	readonly metadataDocument: XmlElement;
	readonly media: readonly DawprojectMediaEntry[];
	readonly fileName: string;
	readonly mimeType: typeof DAWPROJECT_MIME_TYPE;
	readonly report: DeliveryReport;
}

interface ChannelSpec {
	readonly role: 'regular' | 'master' | 'effect' | 'submix';
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly audioChannels: number;
	readonly destination: string | null;
	readonly sends: readonly Readonly<{ id: string; level: number }>[];
	readonly effects: readonly unknown[];
	readonly scope: DataRecord;
}

const DEFAULT_APPLICATION = Object.freeze({ name: 'Soundscaper', version: 'unknown' });

export function createDawprojectExport(request: DawprojectExportRequest): DawprojectExportResult {
	const project = request?.project;
	if (!project || typeof project !== 'object') throw new TypeError('A DAWproject export requires a project.');
	const sampleRate = Number(project.sampleRate);
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
		throw new RangeError('A DAWproject export requires a positive project sample rate.');
	}
	const title = String(request.title ?? project.title ?? 'Project');
	const draft = createDeliveryReport({
		format: DAWPROJECT_DELIVERY_FORMAT, container: 'DAWproject', codec: 'pcm_f32le',
		sampleRate, channelCount: null, lossless: true,
	});
	const context: DawprojectExportContext = {
		project,
		sampleRate,
		ids: new DawprojectIdAllocator(),
		draft,
		sourceById: new Map(records(project.sources).map((source) => [String(source.id), source])),
		clipById: new Map(records(project.clips).map((clip) => [String(clip.id), clip])),
		media: new DawprojectMediaRegistry(),
		routing: readDawprojectMixerRouting(project),
		embeddableVideoSourceIds: new Set(request.embeddableVideoSourceIds ?? []),
		tempoMap: tempoMapOf(project),
		consumedLaneIds: new Set(),
	};
	const structure = dawprojectStructureTree(project, request.sequenceId);
	const transport = buildTransport(context);
	const structureElement = xmlElement('Structure', {}, [
		...structure.map((node) => buildStructureNode(node, context)),
		...buildMixerNodeTracks(context),
		buildMasterTrack(context),
	]);
	const arrangement = buildArrangement(context, structure);
	const application = request.application ?? DEFAULT_APPLICATION;
	const document = xmlElement('Project', { version: DAWPROJECT_VERSION }, [
		xmlElement('Application', { name: application.name, version: application.version }),
		transport,
		structureElement,
		arrangement,
	]);
	const metadataDocument = buildMetadata(project, title);
	reportProjectOmissions(context, request.sequenceId);
	addDeliveryReportItem(draft, {
		code: 'dawproject.project-preserved',
		disposition: 'preserved',
		severity: 'info',
		data: { tracks: countTracks(structure), media: context.media.entries().length, sampleRate },
		message: 'Tracks, channels, routing, clips, fades, tempo, and markers are written in DAWproject 1.0 vocabulary; embedded audio is float32 WAV at each source\'s own rate.',
	});
	return Object.freeze({
		projectXml: serializeXmlDocument(document),
		metadataXml: serializeXmlDocument(metadataDocument),
		document,
		metadataDocument,
		media: context.media.entries(),
		fileName: `${sanitizeFileName(title)}${DAWPROJECT_FILE_EXTENSION}`,
		mimeType: DAWPROJECT_MIME_TYPE,
		report: sealDeliveryReport(draft),
	});
}

function buildTransport(context: DawprojectExportContext): XmlElement {
	const project = context.project;
	const firstTempo = records(record(project.tempoMap).events)[0];
	const bpm = firstTempo?.bpm ? rationalValue(firstTempo.bpm, 120) : finite(record(project.tempo).bpm, 120);
	const firstSignature = records(record(project.signatureMap).events)[0];
	const legacySignature = record(record(project.tempo).timeSignature);
	const numerator = finite(firstSignature?.numerator ?? legacySignature.numerator, 4);
	const denominator = finite(firstSignature?.denominator ?? legacySignature.denominator, 4);
	return xmlElement('Transport', {}, [
		xmlElement('Tempo', { max: 999, min: 1, unit: 'bpm', value: bpm, id: context.ids.id('tempo'), name: 'Tempo' }),
		xmlElement('TimeSignature', {
			denominator, numerator, id: context.ids.id('time-signature'), name: 'Time Signature',
		}),
	]);
}

function buildStructureNode(node: DawprojectStructureNode, context: DawprojectExportContext): XmlElement | null {
	if (node.kind === 'folder') return buildFolderTrack(node, context);
	const track = node.track ?? {};
	const type = String(track.type ?? '');
	if (type === 'audio') return buildAudioTrack(track, context);
	if (type === 'video') return buildVideoTrack(track, context);
	// Label tracks become arrangement markers; the arrangement reports that.
	if (type === 'label') return null;
	addDeliveryReportItem(context.draft, {
		code: 'dawproject.track-kind-omitted',
		disposition: 'omitted',
		severity: 'warning',
		scope: { kind: 'track', id: node.id },
		data: { type },
		message: 'DAWproject tracks carry audio, notes, video, automation, or markers; this track kind has no content type.',
	});
	return null;
}

function buildFolderTrack(node: DawprojectStructureNode, context: DawprojectExportContext): XmlElement {
	// A top-level folder that owns a group bus is a submix channel; a deeper
	// folder owns nothing and is structure only. The bus shares the folder's id.
	const bus = context.routing.groups.find((group) => group.id === node.id) ?? null;
	const children = node.children.map((child) => buildStructureNode(child, context));
	const contentTypes = ['tracks'];
	if (hasDescendant(node, 'audio')) contentTypes.push('audio');
	if (hasDescendant(node, 'video')) contentTypes.push('video');
	return xmlElement('Track', {
		contentType: contentTypes.join(' '),
		loaded: true,
		id: context.ids.id(`folder:${node.id}`),
		name: String(node.folder?.name ?? node.id),
	}, [
		bus ? buildChannel(context, `mixer-node:${bus.id}`, {
			role: 'submix', gain: bus.gain, pan: bus.pan, mute: bus.mute, solo: bus.solo,
			audioChannels: masterChannels(context), destination: channelIdFor(context, 'master'),
			sends: [], effects: bus.effects, scope: { kind: 'folder', id: node.id },
		}) : null,
		...children,
	]);
}

function buildAudioTrack(track: DataRecord, context: DawprojectExportContext): XmlElement {
	const trackId = String(track.id);
	const key = `track:${trackId}`;
	const route = context.routing.routes.get(trackId);
	const group = route?.groupId ? context.routing.groups.find((candidate) => candidate.id === route.groupId) : null;
	const sends = [...(route?.sends ?? [])]
		.filter(([sendId]) => context.routing.sends.some((send) => send.id === sendId))
		.map(([id, level]) => ({ id, level }));
	return xmlElement('Track', {
		contentType: 'audio',
		loaded: true,
		id: context.ids.id(key),
		name: String(track.name ?? trackId),
		color: isHexColor(track.color) ? track.color : null,
	}, [
		buildChannel(context, key, {
			role: 'regular',
			gain: finite(track.gain, 1),
			pan: finite(track.pan, 0),
			mute: track.mute === true,
			solo: track.solo === true,
			audioChannels: audioTrackChannelCount(context.project, track, masterChannels(context)),
			destination: group ? channelIdFor(context, `mixer-node:${group.id}`) : channelIdFor(context, 'master'),
			sends,
			effects: Array.isArray(track.effects) ? track.effects : [],
			scope: { kind: 'track', id: trackId },
		}),
	]);
}

function buildVideoTrack(track: DataRecord, context: DawprojectExportContext): XmlElement {
	const trackId = String(track.id);
	if (track.hidden === true) {
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.track-visibility-converted',
			disposition: 'converted',
			severity: 'info',
			scope: { kind: 'track', id: trackId },
			data: { hidden: true },
			message: 'DAWproject has no hidden flag for a video track; the track is written visible.',
		});
	}
	return xmlElement('Track', {
		contentType: 'video',
		loaded: true,
		id: context.ids.id(`track:${trackId}`),
		name: String(track.name ?? trackId),
	});
}

/** Group and send buses that no folder owns stand as their own tracks. */
function buildMixerNodeTracks(context: DawprojectExportContext): XmlElement[] {
	const folderIds = new Set(records(context.project.trackFolders).map((folder) => String(folder.id)));
	const result: XmlElement[] = [];
	for (const [role, strips] of [['submix', context.routing.groups], ['effect', context.routing.sends]] as const) {
		for (const strip of strips) {
			if (role === 'submix' && folderIds.has(strip.id)) continue;
			result.push(xmlElement('Track', {
				contentType: 'audio',
				loaded: true,
				id: context.ids.id(`strip-track:${strip.id}`),
				name: strip.name,
			}, [
				buildChannel(context, `mixer-node:${strip.id}`, {
					role, gain: strip.gain, pan: strip.pan, mute: strip.mute, solo: strip.solo,
					audioChannels: masterChannels(context), destination: channelIdFor(context, 'master'),
					sends: [], effects: strip.effects, scope: { kind: 'mixer-node', id: strip.id },
				}),
			]));
		}
	}
	if (context.routing.omittedNodes > 0) {
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.mixer-nodes-omitted',
			disposition: 'omitted',
			severity: 'warning',
			data: { nodes: context.routing.omittedNodes },
			message: 'Cue strips and VCA groups have no DAWproject channel role and are not written.',
		});
	}
	return result;
}

function buildMasterTrack(context: DawprojectExportContext): XmlElement {
	const master = record(context.project.master);
	return xmlElement('Track', {
		contentType: 'audio', loaded: true, id: context.ids.id('track:master'), name: 'Master',
	}, [
		buildChannel(context, 'master', {
			role: 'master',
			gain: finite(master.gain, 1),
			pan: finite(master.pan, 0),
			mute: master.mute === true,
			solo: master.solo === true,
			audioChannels: masterChannels(context),
			destination: null,
			sends: [],
			effects: Array.isArray(master.effects) ? master.effects : [],
			scope: { kind: 'master' },
		}),
	]);
}

function buildChannel(context: DawprojectExportContext, key: string, spec: ChannelSpec): XmlElement {
	if (spec.effects.length > 0) {
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.effects-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: spec.scope,
			data: { effects: spec.effects.length },
			message: 'DAWproject carries plug-in state by vendor identifier; the editor\'s effect stack has none, so the channel is written dry.',
		});
	}
	const sends = spec.sends.map(({ id, level }) => xmlElement('Send', {
		destination: channelIdFor(context, `mixer-node:${id}`),
		type: 'post',
		id: context.ids.id(`send:${key}:${id}`),
	}, [
		xmlElement('Volume', {
			max: 4, min: 0, unit: 'linear', value: Math.max(0, level),
			id: context.ids.id(`send:${key}:${id}:volume`), name: 'Send',
		}),
	]));
	// Child order is the schema's sequence: Devices, Mute, Pan, Sends, Volume.
	return xmlElement('Channel', {
		audioChannels: spec.audioChannels,
		destination: spec.destination,
		role: spec.role,
		solo: spec.solo,
		id: channelIdFor(context, key),
	}, [
		xmlElement('Mute', { value: spec.mute, id: parameterIdFor(context, key, 'mute'), name: 'Mute' }),
		xmlElement('Pan', {
			max: 1, min: 0, unit: 'normalized', value: panToNormalized(spec.pan),
			id: parameterIdFor(context, key, 'pan'), name: 'Pan',
		}),
		sends.length > 0 ? xmlElement('Sends', {}, sends) : null,
		xmlElement('Volume', {
			max: 4, min: 0, unit: 'linear', value: Math.max(0, spec.gain),
			id: parameterIdFor(context, key, 'volume'), name: 'Volume',
		}),
	]);
}

function buildMetadata(project: DataRecord, title: string): XmlElement {
	const metadata = record(project.metadata);
	const entries: [string, unknown][] = [
		['Title', metadata.title || title],
		['Artist', metadata.artist],
		['Album', metadata.album],
		['Year', metadata.year],
		['Comment', metadata.comments],
	];
	return xmlElement('MetaData', {}, entries
		.filter(([, value]) => typeof value === 'string' && value.trim() !== '')
		.map(([name, value]) => xmlElement(name, {}, [], String(value).trim())));
}

function reportProjectOmissions(context: DawprojectExportContext, sequenceId?: string): void {
	const { draft, project } = context;
	reportInterchangeCaptionTrackOmission(draft, project, 'dawproject', sequenceId);
	const sequences = records(project.sequences);
	if (sequences.length > 1) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.additional-sequences-omitted',
			disposition: 'omitted',
			severity: 'warning',
			data: { sequences: sequences.length },
			message: 'One arrangement is written; other sequences are not inlined into it.',
		});
	}
	const binClips = records(record(project.projectBin).clips);
	if (binClips.length > 0) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.project-bin-omitted',
			disposition: 'omitted',
			severity: 'info',
			data: { clips: binClips.length },
			message: 'DAWproject has no media bin; clips that are not on the timeline are not written.',
		});
	}
	const takeGroups = records(project.takeGroups);
	if (takeGroups.length > 0) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.take-groups-omitted',
			disposition: 'omitted',
			severity: 'info',
			data: { takeGroups: takeGroups.length },
			message: 'Take lanes and comps are written as their active clips only.',
		});
	}
}

function tempoMapOf(project: DataRecord): HoldTempoMap | null {
	const map = record(project.tempoMap);
	if (!Array.isArray(map.events) || map.events.length === 0) return null;
	return map as unknown as HoldTempoMap;
}

function masterChannels(context: DawprojectExportContext): number {
	const channels = Number(context.project.masterChannels);
	return Number.isSafeInteger(channels) && channels > 0 ? channels : 2;
}

function hasDescendant(node: DawprojectStructureNode, type: string): boolean {
	return node.children.some((child) => (
		child.kind === 'track' ? String(child.track?.type ?? '') === type : hasDescendant(child, type)
	));
}

function countTracks(nodes: readonly DawprojectStructureNode[]): number {
	return nodes.reduce((total, node) => total + (node.kind === 'track' ? 1 : countTracks(node.children)), 0);
}

function rationalValue(value: unknown, fallback: number): number {
	if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
	const rational = record(value);
	const num = Number(rational.num);
	const den = Number(rational.den);
	return Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? rationalToNumber({ num, den }) : fallback;
}

function sanitizeFileName(value: string): string {
	return value
		.trim()
		.replaceAll(/[^\w.-]+/gu, '-')
		.replaceAll(/[-.]{2,}/gu, '-')
		.replaceAll(/^[-.]+|[-.]+$/gu, '')
		.slice(0, 64) || 'project';
}
