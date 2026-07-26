/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertFrame,
	clipEndFrame,
	createStableId,
} from '../project.js';
import {
	assertUnusedClipId,
	normalizeClipForProject,
	normalizeCommandIds,
	replaceClip,
	requireClip,
	requireClipTrack,
	requireStableCommandId,
	segmentOfClip,
	sortTrack,
} from './shared-runtime.js';

export function splitClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const atFrame = assertFrame(command.atFrame, 'split.atFrame');
	if (atFrame <= clip.timelineStartFrame || atFrame >= clipEndFrame(clip)) {
		throw new RangeError('A split must be inside the clip.');
	}
	if (!command.rightClipId) throw new TypeError('A stable rightClipId is required for a replayable split.');
	assertUnusedClipId(project, command.rightClipId);
	if (!clip.avLinkId) {
		splitSingleClip(project, clip, atFrame, command.rightClipId, null, command.rightVideoEffectIds);
		return;
	}
	const linkedClip = project.clips.find((candidate) => (
		candidate.id !== clip.id && candidate.avLinkId === clip.avLinkId
	));
	if (!linkedClip) throw new RangeError(`A/V link ${clip.avLinkId} is incomplete.`);
	if (
		linkedClip.timelineStartFrame !== clip.timelineStartFrame
		|| linkedClip.durationFrames !== clip.durationFrames
	) {
		throw new RangeError(`A/V link ${clip.avLinkId} is not aligned.`);
	}
	const linkedRightClipId = requireStableCommandId(command.linkedRightClipId, 'linked right clip');
	const rightAvLinkId = requireStableCommandId(command.rightAvLinkId, 'right A/V link');
	assertUnusedClipId(project, linkedRightClipId);
	if (linkedRightClipId === command.rightClipId) throw new RangeError('Split clip IDs must be unique.');
	splitSingleClip(project, clip, atFrame, command.rightClipId, rightAvLinkId, command.rightVideoEffectIds);
	splitSingleClip(project, linkedClip, atFrame, linkedRightClipId, rightAvLinkId, command.linkedRightVideoEffectIds);
}

export function prepareSplitCommand(clipId, atFrame, idFactory = createStableId, videoEffects = []) {
	return {
		type: 'clip/split',
		clipId,
		atFrame,
		rightClipId: idFactory('clip'),
		...(videoEffects.length ? {
			rightVideoEffectIds: videoEffects.map(() => idFactory('video-effect')),
		} : {}),
	};
}

export function prepareLinkedSplitCommand(project, clipId, atFrame, idFactory = createStableId) {
	const clip = requireClip(project, clipId);
	if (!clip.avLinkId) return prepareSplitCommand(clipId, atFrame, idFactory, clip.videoEffects || []);
	const linkedClip = project.clips.find((candidate) => (
		candidate.id !== clip.id && candidate.avLinkId === clip.avLinkId
	));
	if (!linkedClip) throw new RangeError(`A/V link ${clip.avLinkId} is incomplete.`);
	return {
		type: 'clip/split',
		clipId,
		atFrame,
		rightClipId: idFactory('clip'),
		linkedRightClipId: idFactory('clip'),
		rightAvLinkId: idFactory('av-link'),
		...(clip.videoEffects?.length ? {
			rightVideoEffectIds: clip.videoEffects.map(() => idFactory('video-effect')),
		} : {}),
		...(linkedClip.videoEffects?.length ? {
			linkedRightVideoEffectIds: linkedClip.videoEffects.map(() => idFactory('video-effect')),
		} : {}),
	};
}

function splitSingleClip(project, clip, atFrame, rightClipId, rightAvLinkId = null, rightVideoEffectIds = undefined) {
	const track = requireClipTrack(project, clip.id);
	const left = segmentOfClip(clip, clip.timelineStartFrame, atFrame, clip.timelineStartFrame, clip.id);
	const right = segmentOfClip(
		clip,
		atFrame,
		clipEndFrame(clip),
		atFrame,
		rightClipId,
		rightVideoEffectIds,
	);
	if (rightAvLinkId) right.avLinkId = rightAvLinkId;
	replaceClip(project, left);
	project.clips.push(right);
	const index = track.clipIds.indexOf(clip.id);
	track.clipIds.splice(index + 1, 0, right.id);
	sortTrack(project, track);
}

export function linkAvClips(project, command) {
	if (project.schemaVersion < 4) throw new RangeError('A/V links require an AudioEditorProjectV4 project.');
	const video = requireClip(project, command.videoClipId);
	const audio = requireClip(project, command.audioClipId);
	if (video.kind !== 'video' || audio.kind !== 'audio') {
		throw new RangeError('An A/V link requires one video clip and one audio clip.');
	}
	if (video.avLinkId || audio.avLinkId) throw new RangeError('A clip must be unlinked before it can be relinked.');
	if (
		video.timelineStartFrame !== audio.timelineStartFrame
		|| video.durationFrames !== audio.durationFrames
	) {
		throw new RangeError('A/V clips must have aligned timeline ranges.');
	}
	const videoTrack = requireClipTrack(project, video.id);
	const audioTrack = requireClipTrack(project, audio.id);
	if (!videoTrack.laneGroupId || videoTrack.laneGroupId !== audioTrack.laneGroupId) {
		throw new RangeError('A/V clips must belong to the same media lane group.');
	}
	const avLinkId = requireStableCommandId(command.avLinkId, 'A/V link');
	for (const candidate of project.clips) {
		if (candidate.avLinkId === avLinkId) throw new RangeError(`Duplicate A/V link ID: ${avLinkId}.`);
	}
	replaceClip(project, normalizeClipForProject(project, { ...video, avLinkId, id: video.id }));
	replaceClip(project, normalizeClipForProject(project, { ...audio, avLinkId, id: audio.id }));
}

export function unlinkAvClips(project, command) {
	if (project.schemaVersion < 4) throw new RangeError('A/V links require an AudioEditorProjectV4 project.');
	const requestedClip = command.clipId ? requireClip(project, command.clipId) : null;
	const avLinkId = command.avLinkId || requestedClip?.avLinkId;
	if (!avLinkId) return;
	const linked = project.clips.filter((clip) => clip.avLinkId === avLinkId);
	if (!linked.length) throw new ReferenceError(`Unknown A/V link: ${avLinkId}.`);
	for (const clip of linked) {
		replaceClip(project, normalizeClipForProject(project, { ...clip, avLinkId: null, id: clip.id }));
	}
}

export function prepareLinkAvCommand(videoClipId, audioClipId, idFactory = createStableId) {
	return {
		type: 'clip/link-av',
		videoClipId: requireStableCommandId(videoClipId, 'video clip'),
		audioClipId: requireStableCommandId(audioClipId, 'audio clip'),
		avLinkId: idFactory('av-link'),
	};
}

export function prepareUnlinkAvCommand(clipId) {
	return { type: 'clip/unlink-av', clipId: requireStableCommandId(clipId, 'clip') };
}

export function prepareGroupClipsCommand(clipIds, idFactory = createStableId) {
	const normalizedIds = normalizeCommandIds(clipIds, 'clipIds');
	return { type: 'clip/group', clipIds: normalizedIds, groupId: idFactory('clip-group') };
}

export function groupClips(project, clipIds, groupId) {
	if (project.schemaVersion < 2) throw new RangeError('Clip grouping requires an AudioEditorProjectV2 or newer project.');
	const ids = normalizeCommandIds(clipIds, 'clipIds');
	if (ids.length < 2) throw new RangeError('At least two clips are required to create a group.');
	const stableGroupId = requireStableCommandId(groupId, 'clip group');
	for (const clipId of ids) {
		const clip = requireClip(project, clipId);
		replaceClip(project, normalizeClipForProject(project, { ...clip, groupId: stableGroupId, id: clip.id }));
	}
}

export function ungroupClips(project, clipIds) {
	if (project.schemaVersion < 2) throw new RangeError('Clip grouping requires an AudioEditorProjectV2 or newer project.');
	const ids = normalizeCommandIds(clipIds, 'clipIds');
	for (const clipId of ids) {
		const clip = requireClip(project, clipId);
		replaceClip(project, normalizeClipForProject(project, { ...clip, groupId: null, id: clip.id }));
	}
}

export function joinClips(project, clipIds) {
	const ids = normalizeCommandIds(clipIds, 'clipIds');
	if (ids.length < 2) throw new RangeError('At least two clips are required to join.');
	const clips = ids.map((clipId) => requireClip(project, clipId))
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id));
	const clipsByTrack = new Map();
	for (const clip of clips) {
		const track = requireClipTrack(project, clip.id);
		const trackClips = clipsByTrack.get(track.id) || [];
		trackClips.push(clip.id);
		clipsByTrack.set(track.id, trackClips);
	}
	if (clipsByTrack.size > 1) {
		if (project.schemaVersion < 4 || clipsByTrack.size !== 2 || clips.some((clip) => !clip.avLinkId)) {
			throw new RangeError('Joined clips must belong to the same track.');
		}
		const selectedIds = new Set(ids);
		for (const clip of clips) {
			const linked = project.clips.filter((candidate) => candidate.avLinkId === clip.avLinkId);
			if (linked.length !== 2 || linked.some((candidate) => !selectedIds.has(candidate.id))) {
				throw new RangeError('Linked A/V clips must be joined together.');
			}
		}
		const tracks = project.tracks.filter((track) => clipsByTrack.has(track.id));
		if (
			tracks.length !== 2
			|| tracks[0].type !== 'video'
			|| tracks[1].type !== 'audio'
			|| !tracks[0].laneGroupId
			|| tracks[0].laneGroupId !== tracks[1].laneGroupId
		) {
			throw new RangeError('Joined A/V clips must belong to one media lane group.');
		}
		const linkOrder = tracks.map((track) => clipsByTrack.get(track.id)
			.map((clipId) => requireClip(project, clipId))
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame)
			.map((clip) => clip.avLinkId));
		if (
			linkOrder[0].length !== linkOrder[1].length
			|| linkOrder[0].some((avLinkId, index) => avLinkId !== linkOrder[1][index])
		) {
			throw new RangeError('Joined A/V clips must have matching linked segments.');
		}
		for (const track of tracks) joinClips(project, clipsByTrack.get(track.id));
		return;
	}
	const track = requireClipTrack(project, clips[0].id);
	for (let index = 1; index < clips.length; index += 1) {
		const previous = clips[index - 1];
		const current = clips[index];
		if (clipEndFrame(previous) !== current.timelineStartFrame) {
			throw new RangeError('Only adjacent clips can be joined without rendering.');
		}
		if (!clipsHaveContiguousSource(previous, current)) {
			throw new RangeError('Clips with different processing or source regions must be rendered before joining.');
		}
	}
	const first = clips[0];
	const last = clips.at(-1);
	const joinedDurationFrames = clipEndFrame(last) - first.timelineStartFrame;
	const joinedSourceDurationFrames = clips.reduce((sum, clip) => sum + (clip.sourceDurationFrames ?? clip.durationFrames), 0);
	const joined = normalizeClipForProject(project, {
		...first,
		durationFrames: joinedDurationFrames,
		sourceDurationFrames: joinedSourceDurationFrames,
		trimEndFrames: last.trimEndFrames,
		fadeOutFrames: last.fadeOutFrames,
		envelope: joinClipEnvelopes(clips),
		id: first.id,
	});
	const removedIds = new Set(clips.slice(1).map((clip) => clip.id));
	project.clips = project.clips
		.filter((clip) => !removedIds.has(clip.id))
		.map((clip) => clip.id === joined.id ? joined : clip);
	track.clipIds = track.clipIds.filter((clipId) => !removedIds.has(clipId));
	sortTrack(project, track);
}

function clipsHaveContiguousSource(left, right) {
	if (
		left.sourceId !== right.sourceId
		|| left.reversed !== right.reversed
		|| left.gain !== right.gain
		|| (left.pitchCents ?? 0) !== (right.pitchCents ?? 0)
		|| (left.speedRatio ?? 1) !== (right.speedRatio ?? 1)
		|| Boolean(left.preserveFormants) !== Boolean(right.preserveFormants)
		|| Boolean(left.stretchToTempo) !== Boolean(right.stretchToTempo)
		|| !videoEffectStacksEquivalent(left.videoEffects, right.videoEffects)
	) return false;
	const leftDuration = left.sourceDurationFrames ?? left.durationFrames;
	const rightDuration = right.sourceDurationFrames ?? right.durationFrames;
	return left.reversed
		? right.sourceStartFrame + rightDuration === left.sourceStartFrame
		: left.sourceStartFrame + leftDuration === right.sourceStartFrame;
}

function videoEffectStacksEquivalent(left, right) {
	const leftStack = Array.isArray(left) ? left : [];
	const rightStack = Array.isArray(right) ? right : [];
	if (leftStack.length !== rightStack.length) return false;
	return leftStack.every((effect, index) => {
		const candidate = rightStack[index];
		return Boolean(candidate)
			&& effect.type === candidate.type
			&& effect.enabled === candidate.enabled
			&& JSON.stringify(effect.params) === JSON.stringify(candidate.params);
	});
}

function joinClipEnvelopes(clips) {
	const result = [];
	let offset = 0;
	for (const clip of clips) {
		for (const point of clip.envelope || []) {
			const frame = offset + point.frame;
			const previous = result.at(-1);
			if (previous?.frame === frame) result[result.length - 1] = { ...point, frame };
			else result.push({ ...point, frame });
		}
		offset += clip.durationFrames;
	}
	return result;
}
