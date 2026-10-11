/* SPDX-License-Identifier: AGPL-3.0-only */
import { canonicalJsonSha256 } from '../common/canonical-json-sha256.ts';
import { motionDigest, motionId, motionInteger, motionRecord, freezeMotionValue } from '../common/editor/motion-values.ts';
import { createMotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { addRationals, subtractRationals, multiplyRationals, divideRationals, roundRational, type Rational } from '../common/editor/timeline-time.ts';
import { normalizeVideoRetimeCurveV16 } from '../common/editor/video-retime-v16.ts';
import { normalizeAudioWarpMap } from '../common/editor/audio-warp-domain.ts';
import { cloneFramescaperProject } from './editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { normalizeFramescaperCompositionLink, type FramescaperCompositionLink } from './editor-project-successor-link.ts';
import { createFramescaperCompositionSource, resolveFramescaperCompositionSource, resolveFramescaperCompositionAudioSource } from './editor-composition-link-source.ts';
export interface FramescaperCompositionConformCommand {
	readonly type: 'composition-link/conform'; readonly policy: 'fit-source-window';
	readonly sourceId: string; readonly expectedDigest: string; readonly expectedProjectDigest: string;
	readonly link: FramescaperCompositionLink;
}
export interface FramescaperCompositionConformWindow {
	readonly start: number; readonly count: number; readonly rate: Rational; readonly speedRatio: number;
	readonly sourceDuration: Rational; readonly timelineDuration: Rational;
	readonly trimStart: number; readonly trimEnd: number; readonly trimRate: Rational;
}
export interface FramescaperCompositionConformChange {
	readonly scope: 'timeline' | 'project-bin'; readonly sequenceId: string | null; readonly clipId: string; readonly kind: 'video' | 'audio';
	readonly before: FramescaperCompositionConformWindow; readonly after: FramescaperCompositionConformWindow;
	readonly clamped: boolean; readonly retimeMapChanged: boolean; readonly warpMapChanged: boolean; readonly reversed: boolean;
}
export const FRAMESCAPER_CONFORM_MAXIMUM_OCCURRENCES = 1024;
type Clip = Readonly<Record<string, unknown>>;
export function snapshotFramescaperCompositionConformCommand(value: unknown): FramescaperCompositionConformCommand {
	const record = motionRecord(value, ['type', 'policy', 'sourceId', 'expectedDigest', 'expectedProjectDigest', 'link'], 'composition Conform command');
	if (record.type !== 'composition-link/conform' || record.policy !== 'fit-source-window') throw new RangeError('Unsupported composition Conform policy.');
	const sourceId = motionId(record.sourceId), link = normalizeFramescaperCompositionLink(record.link);
	if (link.sourceId !== sourceId) throw new RangeError('Composition Conform source identity differs from its command.');
	return freezeMotionValue({ type: 'composition-link/conform', policy: 'fit-source-window', sourceId, expectedDigest: motionDigest(record.expectedDigest), expectedProjectDigest: motionDigest(record.expectedProjectDigest), link });
}
/** All source/clip updates enter validation together; no invalid intermediate source grid is published. */
export function prepareFramescaperCompositionConform(project: FramescaperSuccessorProject, link: FramescaperCompositionLink) {
	const prior = project.compositionLinks.find(entry => entry.sourceId === link.sourceId);
	if (!prior || prior.projectId !== link.projectId || prior.compositionId !== link.compositionId || prior.audioSourceId !== link.audioSourceId) throw new RangeError('Composition Conform must preserve its existing external and companion identities.');
	const { compositionLinks: _links, ...intent } = project;
	const baseline = cloneFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { ...intent, schemaVersion: 1 });
	if ([...baseline.clips, ...baseline.projectBin.clips].filter(clip => clip.sourceId === link.sourceId || clip.sourceId === link.audioSourceId).length > FRAMESCAPER_CONFORM_MAXIMUM_OCCURRENCES) throw new RangeError('Composition Conform exceeds its 1024-occurrence review budget.');
	const picture = baseline.sources.find(source => source.id === prior.sourceId)!;
	resolveFramescaperCompositionSource(project, picture);
	if (prior.audioSourceId) resolveFramescaperCompositionAudioSource(project, baseline.sources.find(source => source.id === prior.audioSourceId)!);
	const next = createFramescaperCompositionSource({ sourceId: link.sourceId, audioSourceId: link.audioSourceId,
		offer: createMotionCompositionOffer(link.compositionId, link.snapshot), sampleRate: baseline.sampleRate, name: picture.name });
	const changes: FramescaperCompositionConformChange[] = [];
	const sequenceRates = new Map(baseline.sequences.map(sequence => [sequence.id, sequence.rate]));
	const sequenceForAudio = new Map<string, string>(), tracks = new Map(baseline.tracks.map(track => [track.id, track]));
	for (const sequence of baseline.sequences) for (const trackId of sequence.trackIds) {
		const track = tracks.get(trackId); if (track && Array.isArray(track.clipIds)) for (const clipId of track.clipIds) sequenceForAudio.set(String(clipId), sequence.id);
	}
	const adjust = (clip: Clip, scope: FramescaperCompositionConformChange['scope']) => {
		const video = clip.kind === 'video' && clip.sourceId === link.sourceId;
		if (!video && !(clip.kind === 'audio' && clip.sourceId === link.audioSourceId)) return clip;
		const oldRate = video ? prior.output.frameRate : { num: prior.snapshot.project.sampleRate, den: 1 };
		const newRate = video ? link.output.frameRate : { num: link.snapshot.project.sampleRate, den: 1 };
		const timelineRate = video ? sequenceRates.get(String(clip.sequenceId)) : baseline.sampleRate;
		if (timelineRate === undefined) throw new RangeError('Composition Conform clip sequence is unavailable.');
		const timelineDuration = divideRationals(integer(clip, video ? 'sequenceFrameCount' : 'durationFrames', 1), timelineRate);
		const total = video ? link.output.durationFrames : next.audioSource!.frameCount;
		const start = integer(clip, video ? 'sourceInFrame' : 'sourceStartFrame'), count = integer(clip, video ? 'sourceFrameCount' : 'sourceDurationFrames', 1);
		const mappedStart = round(multiplyRationals(start, divideRationals(newRate, oldRate))), mappedEnd = round(multiplyRationals(start + count, divideRationals(newRate, oldRate)));
		const nextStart = Math.min(mappedStart, total - 1), nextEnd = Math.min(total, Math.max(nextStart + 1, mappedEnd)), nextCount = nextEnd - nextStart;
		const scale = divideRationals(nextCount, count), map = (value: Rational) => addRationals(nextStart, multiplyRationals(subtractRationals(value, start), scale));
		const speedScale = multiplyRationals(scale, divideRationals(oldRate, newRate));
		const speed = Number(clip.speedRatio), nextSpeed = speed * speedScale.num / speedScale.den;
		if (!Number.isFinite(nextSpeed) || nextSpeed <= 0 || (!video && (nextSpeed < .001 || nextSpeed > 1000))) throw new RangeError(`Conform cannot preserve a legal playback rate for clip ${String(clip.id)}.`);
		const trimRate = video ? { num: baseline.sampleRate, den: 1 } : oldRate, nextTrimRate = video ? trimRate : newRate;
		const trimStart = integer(clip, 'trimStartFrames'), trimEnd = integer(clip, 'trimEndFrames');
		const nextTrimStart = Math.min(round(multiplyRationals(trimStart, divideRationals(nextTrimRate, trimRate))), round(multiplyRationals(nextStart, divideRationals(nextTrimRate, newRate))));
		const nextTrimEnd = Math.min(round(multiplyRationals(trimEnd, divideRationals(nextTrimRate, trimRate))), round(multiplyRationals(total - nextEnd, divideRationals(nextTrimRate, newRate))));
		let updated: Record<string, unknown> = { ...clip, speedRatio: nextSpeed, trimStartFrames: nextTrimStart, trimEndFrames: nextTrimEnd };
		if (video) {
			const retime = normalizeVideoRetimeCurveV16(clip.retimeMap, { sequenceFrameCount: clip.sequenceFrameCount, sourceInFrame: start, sourceFrameCount: count });
			updated = { ...updated, sourceInFrame: nextStart, sourceFrameCount: nextCount, retimeMap: retime && {
				...retime, points: retime.points.map(point => ({ ...point, sourceFrame: map(point.sourceFrame) })),
				segments: retime.segments.map(segment => 'startVelocity' in segment ? { ...segment, startVelocity: multiplyRationals(segment.startVelocity, scale), endVelocity: multiplyRationals(segment.endVelocity, scale) } : segment),
			} };
		} else {
			const warp = clip.warpMap === null ? null : normalizeAudioWarpMap(clip.warpMap);
			updated = { ...updated, sourceStartFrame: nextStart, sourceDurationFrames: nextCount,
				renderCacheRevision: motionInteger(integer(clip, 'renderCacheRevision') + 1, 'conformed audio render revision'),
				warpMap: warp && { ...warp, points: warp.points.map(point => ({ ...point, source: map(point.source) })) } };
		}
		changes.push({ scope, sequenceId: video ? String(clip.sequenceId) : sequenceForAudio.get(String(clip.id)) ?? null, clipId: String(clip.id), kind: video ? 'video' : 'audio',
			before: { start, count, rate: oldRate, speedRatio: speed, sourceDuration: divideRationals(count, oldRate), timelineDuration, trimStart, trimEnd, trimRate },
			after: { start: nextStart, count: nextCount, rate: newRate, speedRatio: nextSpeed, sourceDuration: divideRationals(nextCount, newRate), timelineDuration, trimStart: nextTrimStart, trimEnd: nextTrimEnd, trimRate: nextTrimRate },
			clamped: nextStart !== mappedStart || nextEnd !== mappedEnd, reversed: video ? hasReverse(clip.retimeMap) : clip.reversed === true,
			retimeMapChanged: video && canonicalJsonSha256(clip.retimeMap) !== canonicalJsonSha256(updated.retimeMap),
			warpMapChanged: !video && canonicalJsonSha256(clip.warpMap) !== canonicalJsonSha256(updated.warpMap) });
		return updated;
	};
	const sources = baseline.sources.map(source => source.id === link.sourceId ? { ...source, ...next.source }
		: source.id === link.audioSourceId ? { ...next.audioSource!, name: source.name } : source);
	const candidate = normalizeFramescaperSuccessorProject({ ...baseline, schemaVersion: 2, sources,
		clips: baseline.clips.map(clip => adjust(clip, 'timeline')), projectBin: { ...baseline.projectBin, clips: baseline.projectBin.clips.map(clip => adjust(clip, 'project-bin')) },
		compositionLinks: project.compositionLinks.map(value => value.sourceId === link.sourceId ? link : value) });
	return freezeMotionValue({ project: candidate, changes });
}
export function applyFramescaperCompositionConform(project: FramescaperSuccessorProject, command: FramescaperCompositionConformCommand, now?: string | number | Date): FramescaperSuccessorProject {
	if (canonicalJsonSha256(project) !== command.expectedProjectDigest || project.compositionLinks.find(link => link.sourceId === command.sourceId)?.acceptedDigest !== command.expectedDigest) throw new Error('Composition Conform review is stale; the project or accepted link changed.');
	const result = prepareFramescaperCompositionConform(project, command.link), revision = motionInteger(Number(project.revision) + 1, 'Conform project revision');
	const timestamp = now === undefined ? new Date() : new Date(now); if (!Number.isFinite(timestamp.getTime())) throw new TypeError('Composition Conform timestamp is invalid.');
	return normalizeFramescaperSuccessorProject({ ...result.project, revision, updatedAt: timestamp.toISOString() });
}
function integer(value: Clip, key: string, min = 0): number { return motionInteger(value[key], `Conform clip ${key}`, min); }
function round(value: Rational): number { return roundRational(value.num, value.den, 'point'); }
function hasReverse(value: unknown): boolean {
	return Boolean(value && typeof value === 'object' && Array.isArray(Reflect.get(value, 'segments')) && (Reflect.get(value, 'segments') as readonly { mode: string }[]).some(segment => segment.mode.endsWith('-reverse')));
}
