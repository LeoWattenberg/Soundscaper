/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { DAWPROJECT_DELIVERY_FORMAT, clamp, entryBaseName } from './dawproject-format.ts';
import type { DawprojectDocument } from './dawproject-import.ts';
import { buildSignatureMap, buildTempoMap } from './dawproject-import-maps.ts';
import {
	type Build,
	type DataRecord,
	applyAutomation,
	resolveRouting,
	stripRecord,
	trackForEvent,
	walkTrack,
} from './dawproject-import-structure.ts';
import {
	createDawprojectTimeResolver,
	flattenDawprojectArrangement,
	type DawprojectAudioEvent,
} from './dawproject-import-timeline.ts';

/**
 * The reading half of DAWproject, part three: a parsed document plus the
 * decoded media it references, assembled into the options of a current
 * project document.
 *
 * The report has the export report's shape and dispositions with the
 * direction reversed, so the same dialog shows what an import could not carry
 * as shows what an export left behind. Anything the format states that the
 * project cannot hold — notes, plug-ins, clip looping, non-volume automation,
 * a marker's colour — is itemized rather than dropped on the way in.
 */

export type DawprojectImportReport = Omit<DeliveryReport, 'direction'> & Readonly<{ direction: 'import' }>;

export interface DawprojectDecodedMediaInfo {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}

export interface DawprojectImportOptions {
	readonly fileName?: string;
	/**
	 * Decoded geometry per normalized entry path. An absent entry is media the
	 * archive does not hold; a null entry is media it holds but nothing could
	 * decode. The report tells the two apart.
	 */
	readonly media: ReadonlyMap<string, DawprojectDecodedMediaInfo | null>;
	readonly createStableId: (prefix: string) => string;
	readonly sampleRate?: number;
}

export interface DawprojectImportMediaBinding {
	readonly path: string;
	readonly sourceId: string;
}

export interface DawprojectImportPlan {
	readonly title: string;
	readonly sampleRate: number;
	/** Options for `createCurrentAudioEditorProject`. */
	readonly project: Record<string, unknown>;
	readonly media: readonly DawprojectImportMediaBinding[];
	readonly report: DawprojectImportReport;
}

const DEFAULT_SAMPLE_RATE = 48_000;

export function buildDawprojectProject(document: DawprojectDocument, options: DawprojectImportOptions): DawprojectImportPlan {
	if (typeof options?.createStableId !== 'function') throw new TypeError('A DAWproject import requires an id factory.');
	const sampleRate = chooseSampleRate(options);
	const draft = createDeliveryReport({
		format: DAWPROJECT_DELIVERY_FORMAT, container: 'DAWproject', codec: null, sampleRate, channelCount: null, lossless: null,
	});
	const build: Build = {
		draft, sampleRate, createStableId: options.createStableId,
		tracks: [], trackByDawId: new Map(), trackNodes: [], folders: [], groups: [], sends: [],
		stripByChannelId: new Map(), parameters: new Map(), routes: new Map(), parentFolderIds: new Map(),
		master: { id: 'master', name: 'Master', gain: 1, pan: 0, mute: false, solo: false, envelope: [] },
		omittedTracks: 0, omittedNodes: 0, devices: 0,
	};
	const tempoMap = buildTempoMap(document, draft);
	const signatureMap = buildSignatureMap(document, draft);
	for (const track of document.tracks) walkTrack(track, null, build, document);
	resolveRouting(document, build);
	const resolver = createDawprojectTimeResolver(tempoMap, sampleRate);
	const flattened = flattenDawprojectArrangement(document, resolver);

	const sources: DataRecord[] = [];
	const clips: DataRecord[] = [];
	const media: DawprojectImportMediaBinding[] = [];
	const sourceByPath = new Map<string, DataRecord>();
	const missingPaths = new Set<string>();
	let disabledClips = 0;
	for (const event of flattened.audio) {
		if (!event.enabled) {
			disabledClips += 1;
			continue;
		}
		const info = event.external ? null : options.media.get(event.path);
		if (!info) {
			if (!missingPaths.has(event.path)) {
				missingPaths.add(event.path);
				const undecodable = !event.external && options.media.has(event.path);
				addDeliveryReportItem(draft, {
					code: undecodable ? 'dawproject.media-undecodable' : 'dawproject.media-missing',
					disposition: 'missing',
					severity: 'error',
					scope: { kind: 'media', id: event.path },
					data: { path: event.path, external: event.external },
					message: event.external
						? 'The clip plays a file outside the archive; DAWproject import embeds only what the archive holds, so the clip is not imported.'
						: undecodable
							? 'The archive holds the clip\'s audio file but no decoder could read it, so the clip is not imported.'
							: 'The archive has no entry for the clip\'s audio file, so the clip is not imported.',
				});
			}
			continue;
		}
		let source = sourceByPath.get(event.path);
		if (!source) {
			source = createSource(event, info, build);
			sourceByPath.set(event.path, source);
			sources.push(source);
			media.push({ path: event.path, sourceId: String(source.id) });
		}
		const clip = createClip(event, info, source, build);
		if (!clip) continue;
		const track = trackForEvent(event, build, document);
		track.clipIds.push(String(clip.id));
		clips.push(clip);
	}
	applyAutomation(flattened.automation, build);
	const annotations = createMarkers(flattened.markers, build);
	reportOmissions(document, flattened.omitted, disabledClips, build);
	const title = document.metadata.title ?? stripExtension(options.fileName ?? '') ?? 'DAWproject';
	addDeliveryReportItem(draft, {
		code: 'dawproject.project-imported',
		disposition: 'preserved',
		severity: 'info',
		data: {
			application: document.application?.name ?? null,
			tracks: build.tracks.length, folders: build.folders.length, clips: clips.length,
			sources: sources.length, markers: annotations.length, sampleRate,
		},
		message: 'Tracks, channels, routing, clips, fades, tempo, and markers are read from DAWproject 1.0 vocabulary; embedded audio becomes float32 sources at its own rate.',
	});
	const project: DataRecord = {
		id: build.createStableId('project'),
		title,
		sampleRate,
		masterChannels: 2,
		metadata: {
			title,
			artist: document.metadata.artist ?? '',
			album: document.metadata.album ?? '',
			year: document.metadata.year ?? '',
			comments: document.metadata.comment ?? '',
		},
		sources,
		clips,
		tracks: build.tracks.map((track) => ({
			type: 'audio', id: track.id, name: track.name, gain: track.gain, pan: track.pan,
			mute: track.mute, solo: track.solo, clipIds: track.clipIds, envelope: track.envelope,
		})),
		trackFolders: build.folders,
		sequences: [{ id: 'main-sequence', trackNodes: build.trackNodes }],
		mixer: {
			groups: build.groups.map(stripRecord),
			sends: build.sends.map(stripRecord),
			routes: Object.fromEntries([...build.routes].map(([trackId, route]) => [trackId, route])),
		},
		master: { gain: build.master.gain, pan: build.master.pan, mute: build.master.mute, envelope: build.master.envelope },
		timelineAnnotations: annotations,
		tempoMap,
		signatureMap,
	};
	const sealed = sealDeliveryReport(draft);
	return Object.freeze({
		title,
		sampleRate,
		project,
		media: Object.freeze(media),
		report: Object.freeze({ ...sealed, direction: 'import' as const }),
	});
}

function chooseSampleRate(options: DawprojectImportOptions): number {
	if (options.sampleRate !== undefined) {
		if (!Number.isSafeInteger(options.sampleRate) || options.sampleRate <= 0) {
			throw new RangeError('The import sample rate must be a positive integer.');
		}
		return options.sampleRate;
	}
	const counts = new Map<number, number>();
	for (const info of options.media.values()) {
		if (info && Number.isSafeInteger(info.sampleRate) && info.sampleRate > 0) {
			counts.set(info.sampleRate, (counts.get(info.sampleRate) ?? 0) + 1);
		}
	}
	let chosen = DEFAULT_SAMPLE_RATE;
	let best = 0;
	for (const [rate, count] of counts) {
		if (count > best || (count === best && rate > chosen)) {
			chosen = rate;
			best = count;
		}
	}
	return chosen;
}

function createSource(event: DawprojectAudioEvent, info: DawprojectDecodedMediaInfo, build: Build): DataRecord {
	const id = build.createStableId('source');
	const name = entryBaseName(event.path) || id;
	addDeliveryReportItem(build.draft, {
		code: 'dawproject.audio-imported',
		disposition: 'preserved',
		severity: 'info',
		scope: { kind: 'source', id },
		data: { path: event.path, frames: info.frameCount, channels: info.channelCount, sampleRate: info.sampleRate },
		message: 'The embedded audio file is decoded once and stored as a float32 source at its own sample rate.',
	});
	return {
		id, name, mimeType: mimeTypeFor(name), storageKey: id,
		frameCount: info.frameCount, channelCount: info.channelCount,
		sampleRate: info.sampleRate, originalSampleRate: info.sampleRate,
		sampleFormat: 'float32',
	};
}

function createClip(event: DawprojectAudioEvent, info: DawprojectDecodedMediaInfo, source: DataRecord, build: Build): DataRecord | null {
	const { sampleRate, draft } = build;
	const sourceRate = info.sampleRate;
	const clipId = build.createStableId('clip');
	let startFrame = event.startFrame;
	let sourceOffset = event.sourceOffsetSeconds;
	let span = event.contentSpanSeconds;
	const timelineSeconds = (event.endFrame - startFrame) / sampleRate;
	if (startFrame < 0) {
		// The clip begins before the timeline does; its head is trimmed away.
		const trimmed = -startFrame / sampleRate;
		const speed = timelineSeconds > 0 ? span / timelineSeconds : 1;
		sourceOffset += trimmed * speed;
		span -= trimmed * speed;
		startFrame = 0;
		addDeliveryReportItem(draft, {
			code: 'dawproject.clip-head-trimmed', disposition: 'converted', severity: 'warning',
			scope: { kind: 'clip', id: clipId }, data: { seconds: trimmed },
			message: 'The clip started before the arrangement origin; the part before it is not imported.',
		});
	}
	const durationCandidate = event.endFrame - startFrame;
	if (durationCandidate <= 0 || span <= 0) return null;
	const sourceStartFrame = clamp(Math.round(sourceOffset * sourceRate), 0, Math.max(0, info.frameCount - 1));
	const available = info.frameCount - sourceStartFrame;
	if (available <= 0) return null;
	const requested = Math.max(1, Math.round(span * sourceRate));
	let durationFrames = durationCandidate;
	let sourceDurationFrames = requested;
	if (requested > available) {
		sourceDurationFrames = available;
		durationFrames = Math.max(1, Math.round(durationCandidate * available / requested));
		addDeliveryReportItem(draft, {
			code: 'dawproject.clip-extent-converted', disposition: 'converted', severity: 'warning',
			scope: { kind: 'clip', id: clipId }, data: { looped: event.looped, requestedFrames: requested, availableFrames: available },
			message: event.looped
				? 'The clip loops its content; clips here play their source once, so the clip ends where the audio does.'
				: 'The clip runs past the end of its audio file; it is shortened to the audio that exists.',
		});
	}
	const speed = (sourceDurationFrames * sampleRate / sourceRate) / durationFrames;
	let speedRatio = 1;
	if (Math.abs(speed - 1) < 1e-4) {
		durationFrames = Math.max(1, Math.round(sourceDurationFrames * sampleRate / sourceRate));
	} else {
		speedRatio = clamp(speed, 0.001, 1000);
		addDeliveryReportItem(draft, {
			code: 'dawproject.speed-change-converted', disposition: 'converted', severity: 'info',
			scope: { kind: 'clip', id: clipId }, data: { speedRatio, warpPoints: event.warpPoints },
			message: 'The clip\'s warp becomes a time stretch at its average speed, rendered by the editor\'s own algorithm.',
		});
	}
	if (event.warpPoints > 2) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.warp-points-converted', disposition: 'converted', severity: 'warning',
			scope: { kind: 'clip', id: clipId }, data: { warpPoints: event.warpPoints },
			message: 'Only the clip\'s overall stretch is kept; the interior Warp points that varied its speed are not.',
		});
	}
	if (event.contentInBeats) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.content-beats-converted', disposition: 'converted', severity: 'info',
			scope: { kind: 'clip', id: clipId }, data: {},
			message: 'The clip\'s audio content is positioned in beats; it is read as seconds at the tempo of its origin.',
		});
	}
	if (event.crossfade) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.crossfade-converted', disposition: 'converted', severity: 'info',
			scope: { kind: 'clip', id: clipId }, data: {},
			message: 'A negative fade-in marks a crossfade with the previous clip; it is imported as a fade-in of the same length.',
		});
	}
	return {
		id: clipId,
		sourceId: String(source.id),
		title: event.name || String(source.name),
		timelineStartFrame: startFrame,
		sourceStartFrame,
		sourceDurationFrames,
		durationFrames,
		fadeInFrames: Math.min(durationFrames, Math.max(0, event.fadeInFrames)),
		fadeOutFrames: Math.min(durationFrames, Math.max(0, event.fadeOutFrames)),
		speedRatio,
	};
}

function createMarkers(markers: readonly Readonly<{ frame: number; name: string; color: string | null }>[], build: Build): DataRecord[] {
	let clamped = 0;
	let colored = 0;
	const annotations = markers.map((marker) => {
		if (marker.frame < 0) clamped += 1;
		if (marker.color) colored += 1;
		return {
			id: build.createStableId('marker'),
			sequenceId: 'main-sequence',
			kind: 'marker',
			anchor: 'sample',
			positionFrame: Math.max(0, marker.frame),
			name: marker.name,
			color: 'auto',
			batchId: null,
			opaqueExtensions: {},
		};
	});
	if (clamped > 0) {
		addDeliveryReportItem(build.draft, {
			code: 'dawproject.markers-clamped', disposition: 'converted', severity: 'warning',
			data: { markers: clamped }, message: 'Markers before the arrangement origin are placed at the origin.',
		});
	}
	if (colored > 0) {
		addDeliveryReportItem(build.draft, {
			code: 'dawproject.marker-colors-omitted', disposition: 'omitted', severity: 'info',
			data: { markers: colored }, message: 'Marker colours are a fixed palette here; imported markers take the automatic colour.',
		});
	}
	if (annotations.length > 0) {
		addDeliveryReportItem(build.draft, {
			code: 'dawproject.markers-preserved', disposition: 'preserved', severity: 'info',
			data: { markers: annotations.length }, message: 'Arrangement markers become timeline markers at their sample positions.',
		});
	}
	return annotations;
}

function reportOmissions(
	document: DawprojectDocument,
	omitted: Readonly<{ notes: number; video: number; clipAutomation: number; unresolvedReferences: number; unsupportedContent: number }>,
	disabledClips: number,
	build: Build,
): void {
	const { draft } = build;
	const items: [string, number, string][] = [
		['dawproject.notes-omitted', omitted.notes, 'Note events have no instrument to play here and are not imported.'],
		['dawproject.video-omitted', omitted.video, 'Video clips are not imported by the audio project importer.'],
		['dawproject.clip-automation-omitted', omitted.clipAutomation, 'Automation inside clips has no clip-local envelope to become.'],
		['dawproject.clip-references-unresolved', omitted.unresolvedReferences, 'Alias clips whose referenced timeline is missing or circular are not imported.'],
		['dawproject.content-unsupported', omitted.unsupportedContent, 'Timeline content outside the audio, warp, clip, and marker vocabulary is not imported.'],
		['dawproject.disabled-clips-omitted', disabledClips, 'Disabled clips are not played and are not imported.'],
		['dawproject.devices-omitted', build.devices, 'Plug-ins and built-in devices are not imported; channels come in dry.'],
		['dawproject.mixer-nodes-omitted', build.omittedNodes, 'VCA channels have no equivalent here and are not imported.'],
		['dawproject.scenes-omitted', document.scenes, 'Clip launcher scenes have no arrangement position and are not imported.'],
	];
	for (const [code, count, message] of items) {
		if (count <= 0) continue;
		addDeliveryReportItem(draft, { code, disposition: 'omitted', severity: 'warning', data: { count }, message });
	}
}

function mimeTypeFor(name: string): string {
	const extension = /\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase() ?? '';
	switch (extension) {
		case 'aif': case 'aiff': return 'audio/aiff';
		case 'flac': return 'audio/flac';
		case 'mp3': return 'audio/mpeg';
		case 'ogg': case 'oga': return 'audio/ogg';
		case 'opus': return 'audio/opus';
		case 'm4a': case 'mp4': return 'audio/mp4';
		default: return 'audio/wav';
	}
}

function stripExtension(fileName: string): string | null {
	const base = entryBaseName(fileName).replace(/\.dawproject$/iu, '').trim();
	return base || null;
}
