/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { dawprojectImportedAudioMimeType } from './dawproject-import-project.ts';
import type { SesxClip, SesxDocument, SesxTrack } from './sesx-import.ts';

export type SesxImportReport = Omit<DeliveryReport, 'direction'> & Readonly<{ direction: 'import' }>;

export interface SesxDecodedMediaInfo {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}

export interface SesxImportOptions {
	readonly fileName?: string;
	/** Geometry is keyed by Audition file ID; null means present but undecodable. */
	readonly media: ReadonlyMap<string, SesxDecodedMediaInfo | null>;
	readonly resolutionIssues?: ReadonlyMap<string, 'ambiguous' | 'scan-limited'>;
	readonly stagedSourceIds?: ReadonlyMap<string, string>;
	readonly createStableId: (prefix: string) => string;
}

export interface SesxImportMediaBinding {
	readonly fileId: string;
	readonly sourceId: string;
}

export interface SesxImportPlan {
	readonly title: string;
	readonly sampleRate: number;
	/** Options for createCurrentAudioEditorProject. */
	readonly project: Record<string, unknown>;
	readonly media: readonly SesxImportMediaBinding[];
	readonly report: SesxImportReport;
}

type DataRecord = Record<string, unknown>;
type Draft = ReturnType<typeof createDeliveryReport>;

export function buildSesxProject(document: SesxDocument, options: SesxImportOptions): SesxImportPlan {
	if (typeof options?.createStableId !== 'function') throw new TypeError('An SESX import requires an id factory.');
	if (!options.media || typeof options.media.get !== 'function') throw new TypeError('An SESX import requires decoded media geometry.');
	const { sampleRate } = document;
	const title = options.fileName?.split(/[\\/]/u).at(-1)?.replace(/\.sesx$/iu, '').trim() || 'Audition session';
	const draft = createDeliveryReport({
		format: 'sesx', container: 'Adobe Audition SESX', codec: null,
		sampleRate, channelCount: document.channelCount, lossless: null,
	});
	const sources: DataRecord[] = [];
	const clips: DataRecord[] = [];
	const tracks: DataRecord[] = [];
	const trackNodes: DataRecord[] = [];
	const media: SesxImportMediaBinding[] = [];
	const sourceByFileId = new Map<string, DataRecord>();
	const rejectedFileIds = new Set<string>();
	for (const track of document.tracks) {
		const trackId = options.createStableId('track');
		const builtTrack: DataRecord = {
			type: 'audio', id: trackId, name: track.name,
			gain: boundedGain(track.gain, 4, draft, { kind: 'track', id: trackId }),
			pan: track.pan, mute: track.mute, solo: track.solo, clipIds: [], envelope: [],
		};
		tracks.push(builtTrack);
		trackNodes.push({ kind: 'track', id: trackId, parentFolderId: null });
		for (const clip of track.clips) {
			if (clip.offline) {
				addDeliveryReportItem(draft, {
					code: 'sesx.offline-clip-omitted', disposition: 'omitted', severity: 'warning',
					scope: { kind: 'clip', id: clip.id ?? '', track: track.name },
					message: 'An offline Audition clip is not imported.',
				});
				continue;
			}
			const info = usableMedia(document, options, clip, rejectedFileIds, draft);
			if (!info) continue;
			const imported = buildClip(clip, track, info, draft, options.createStableId);
			if (!imported) continue;
			let source = sourceByFileId.get(clip.fileId);
			if (!source) {
				const id = options.stagedSourceIds?.get(clip.fileId) ?? options.createStableId('source');
				const name = document.files.get(clip.fileId)?.name || clip.name || id;
				source = {
					id, name, mimeType: dawprojectImportedAudioMimeType(name), storageKey: id,
					frameCount: info.frameCount, channelCount: info.channelCount,
					sampleRate: info.sampleRate, originalSampleRate: info.sampleRate,
					sampleFormat: 'float32',
				};
				sources.push(source);
				sourceByFileId.set(clip.fileId, source);
				media.push({ fileId: clip.fileId, sourceId: id });
			}
			imported.sourceId = source.id;
			clips.push(imported);
			(builtTrack.clipIds as string[]).push(String(imported.id));
		}
	}
	reportOmissions(document, draft);
	addDeliveryReportItem(draft, {
		code: 'sesx.project-imported', disposition: 'preserved', severity: 'info',
		data: { tracks: tracks.length, clips: clips.length, sources: sources.length, sampleRate, applicationVersion: document.applicationVersion },
		message: 'Audition audio tracks and playable clips were imported into a local project.',
	});
	const project: DataRecord = {
		id: options.createStableId('project'), title, sampleRate, masterChannels: document.channelCount,
		metadata: { title },
		sources, clips, tracks,
		sequences: [{ id: 'main-sequence', trackNodes }],
		master: {
			gain: boundedGain(document.master.gain, 4, draft, { kind: 'master' }),
			pan: document.master.pan, mute: document.master.mute, envelope: [],
		},
	};
	const sealed = sealDeliveryReport(draft);
	return Object.freeze({
		title, sampleRate, project,
		media: Object.freeze(media),
		report: Object.freeze({ ...sealed, direction: 'import' as const }),
	});
}

function usableMedia(
	document: SesxDocument,
	options: SesxImportOptions,
	clip: SesxClip,
	rejected: Set<string>,
	draft: Draft,
): SesxDecodedMediaInfo | null {
	const info = options.media.get(clip.fileId);
	if (!info) {
		if (!rejected.has(clip.fileId)) {
			rejected.add(clip.fileId);
			const undecodable = options.media.has(clip.fileId);
			const resolutionIssue = options.resolutionIssues?.get(clip.fileId);
			addDeliveryReportItem(draft, {
				code: undecodable ? 'sesx.media-undecodable'
					: resolutionIssue === 'ambiguous' ? 'sesx.media-ambiguous'
					: resolutionIssue === 'scan-limited' ? 'sesx.media-scan-limited' : 'sesx.media-missing',
				disposition: 'missing', severity: 'error',
				scope: { kind: 'media', id: clip.fileId },
				data: { path: document.files.get(clip.fileId)?.relativePath ?? document.files.get(clip.fileId)?.absolutePath ?? null },
				message: undecodable ? 'The referenced audio could not be decoded, so its clips are omitted.'
					: resolutionIssue === 'ambiguous' ? 'Several audio files match this reference, so its clips are omitted.'
					: resolutionIssue === 'scan-limited' ? 'The media folder search reached its safety limit before resolving this reference, so its clips are omitted.'
					: 'The referenced audio file was not found, so its clips are omitted.',
			});
		}
		return null;
	}
	if (info.sampleRate !== document.sampleRate || !Number.isSafeInteger(info.frameCount) || info.frameCount <= 0
		|| !Number.isSafeInteger(info.channelCount) || info.channelCount < 1 || info.channelCount > 2) {
		if (!rejected.has(clip.fileId)) {
			rejected.add(clip.fileId);
			const mismatch = info.sampleRate !== document.sampleRate;
			addDeliveryReportItem(draft, {
				code: mismatch ? 'sesx.sample-rate-mismatch' : 'sesx.media-unsupported',
				disposition: 'omitted', severity: 'warning', scope: { kind: 'media', id: clip.fileId },
				data: { sampleRate: info.sampleRate, sessionSampleRate: document.sampleRate, channels: info.channelCount },
				message: mismatch
					? 'The decoded file has a different sample rate from the SESX session; its source offsets cannot be verified, so its clips are omitted.'
					: 'The decoded file has unsupported audio geometry, so its clips are omitted.',
			});
		}
		return null;
	}
	return info;
}

function buildClip(
	clip: SesxClip,
	track: SesxTrack,
	info: SesxDecodedMediaInfo,
	draft: Draft,
	createStableId: (prefix: string) => string,
): DataRecord | null {
	const id = createStableId('clip');
	const requested = clip.endFrame - clip.startFrame;
	const sourceSpan = clip.sourceOutFrame - clip.sourceInFrame;
	const available = info.frameCount - clip.sourceInFrame;
	if (available <= 0) {
		addDeliveryReportItem(draft, {
			code: 'sesx.clip-out-of-range', disposition: 'omitted', severity: 'warning',
			scope: { kind: 'clip', id }, data: { sourceInFrame: clip.sourceInFrame, frameCount: info.frameCount },
			message: 'The clip starts beyond the end of its audio file and is omitted.',
		});
		return null;
	}
	const duration = Math.min(requested, sourceSpan, available);
	if (duration < requested || duration < sourceSpan) {
		addDeliveryReportItem(draft, {
			code: 'sesx.clip-extent-converted', disposition: 'converted', severity: 'warning',
			scope: { kind: 'clip', id },
			data: { timelineFrames: requested, sourceFrames: sourceSpan, availableFrames: available, importedFrames: duration },
			message: 'The imported clip is limited to the source audio that plays once at the session sample rate.',
		});
	}
	if (clip.looped) {
		addDeliveryReportItem(draft, {
			code: 'sesx.loops-omitted', disposition: 'omitted', severity: 'warning', scope: { kind: 'clip', id },
			message: 'Audition clip looping is not imported; only one pass of the source is kept.',
		});
	}
	if (clip.linkedCrossfade) reportClipOmission(draft, 'sesx.crossfade-omitted', id,
		'Audition linked crossfades are not imported; clip fades remain independent.');
	if (clip.stretch) reportClipOmission(draft, 'sesx.stretch-omitted', id, 'Audition clip stretching is not imported.');
	if (clip.unsupportedPan) reportClipOmission(draft, 'sesx.clip-pan-omitted', id, 'Audition clip pan is not imported.');
	if (clip.remappedChannels) reportClipOmission(draft, 'sesx.channel-map-omitted', id, 'Audition clip channel remapping is not imported.');
	if (clip.fadeCurvesChanged) {
		addDeliveryReportItem(draft, {
			code: 'sesx.fade-curve-converted', disposition: 'converted', severity: 'warning', scope: { kind: 'clip', id },
			message: 'Audition fade length is kept, but its non-linear curve becomes the editor default curve.',
		});
	}
	return {
		id, sourceId: '', title: clip.name || track.name,
		timelineStartFrame: clip.startFrame,
		sourceStartFrame: clip.sourceInFrame,
		sourceDurationFrames: duration,
		durationFrames: duration,
		fadeInFrames: Math.min(clip.fadeInFrames, duration),
		fadeOutFrames: Math.min(clip.fadeOutFrames, duration),
		gain: clip.muted ? 0 : boundedGain(clip.gain, 16, draft, { kind: 'clip', id }),
		speedRatio: 1,
	};
}

function reportClipOmission(draft: Draft, code: string, id: string, message: string): void {
	addDeliveryReportItem(draft, {
		code, disposition: 'omitted', severity: 'warning', scope: { kind: 'clip', id }, message,
	});
}

function boundedGain(gain: number, maximum: number, draft: Draft, scope: Readonly<Record<string, unknown>>): number {
	if (!Number.isFinite(gain) || gain < 0) throw new RangeError('SESX gain must be finite and non-negative.');
	if (gain <= maximum) return gain;
	addDeliveryReportItem(draft, {
		code: 'sesx.gain-clamped', disposition: 'converted', severity: 'warning',
		scope, data: { authoredGain: gain, importedGain: maximum },
		message: 'Audition gain exceeds the editor range and is limited to its maximum.',
	});
	return maximum;
}

function reportOmissions(document: SesxDocument, draft: Draft): void {
	const omissionItems: readonly [keyof SesxDocument['omissions'], string, string][] = [
		['effects', 'sesx.effects-omitted', 'Audition effects and plug-ins are not imported; tracks play dry.'],
		['automation', 'sesx.automation-omitted', 'Audition automation is not imported; static controls are used.'],
		['routing', 'sesx.routing-omitted', 'Non-master Audition routing is not imported.'],
		['video', 'sesx.video-omitted', 'Audition video tracks and clips are not imported.'],
		['markers', 'sesx.markers-omitted', 'Audition markers are not imported.'],
		['clipGroups', 'sesx.clip-groups-omitted', 'Audition clip group relationships are not imported.'],
	];
	for (const [field, code, message] of omissionItems) {
		const count = document.omissions[field];
		if (count <= 0) continue;
		addDeliveryReportItem(draft, {
			code, disposition: 'omitted', severity: 'warning', data: { count }, message,
		});
	}
}
