/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertAudioWarpClipAuthority,
	normalizeAudioWarpMapForClip,
	type AudioWarpAuthorityProject,
} from '../audio-warp-clip-authority.ts';
import {
	audioWarpMapFingerprint,
} from '../audio-warp-runtime.ts';
import {
	quantizeAudioWarpTransients,
	type AudioWarpMap,
	type AudioWarpQuantizeOptions,
} from '../audio-warp-domain.ts';
import { isAudioWarpProjectSchema } from '../project-schema-version.ts';
import {
	defineAudioWarpCommandHandlers,
	type AudioWarpCommandHandlers,
} from './audio-warp.ts';
import type {
	AudioEditorCommand,
	EditorCommandProject,
} from './protocol.ts';

type DataRecord = Record<string, unknown>;

interface MutableAudioWarpProject extends AudioWarpAuthorityProject {
	readonly clips: readonly DataRecord[];
}

export function createAudioWarpRuntimeHandlers(): Readonly<AudioWarpCommandHandlers> {
	return defineAudioWarpCommandHandlers({
		'audio-warp/set': (project, command) => setWarpMap(warpProject(project), command),
		'audio-warp/clear': (project, command) => clearWarpMap(warpProject(project), command),
		'audio-warp/quantize': (project, command) => quantizeWarpMap(warpProject(project), command),
	});
}

function setWarpMap(
	project: MutableAudioWarpProject,
	command: Extract<AudioEditorCommand, { readonly type: 'audio-warp/set' }>,
): void {
	const clip = writableAuthorizedClip(project, command.clipId, command.expectedClipAuthority);
	const map = normalizeAudioWarpMapForClip(project, clip, command.warpMap);
	replaceWarpMap(clip, map);
}

function clearWarpMap(
	project: MutableAudioWarpProject,
	command: Extract<AudioEditorCommand, { readonly type: 'audio-warp/clear' }>,
): void {
	const clip = writableAuthorizedClip(project, command.clipId, command.expectedClipAuthority);
	if (clip.warpMap == null) throw new RangeError(`Audio clip ${command.clipId} has no warp map.`);
	clip.warpMap = null;
	incrementRenderCacheRevision(clip);
}

function quantizeWarpMap(
	project: MutableAudioWarpProject,
	command: Extract<AudioEditorCommand, { readonly type: 'audio-warp/quantize' }>,
): void {
	const clip = writableAuthorizedClip(project, command.clipId, command.expectedClipAuthority);
	if (clip.warpMap == null) throw new RangeError(`Audio clip ${command.clipId} has no warp map.`);
	const current = normalizeAudioWarpMapForClip(project, clip, clip.warpMap);
	const next = quantizeAudioWarpTransients(
		current,
		command.transientSources,
		command.options as unknown as AudioWarpQuantizeOptions,
	);
	const exact = normalizeAudioWarpMapForClip(project, clip, next);
	replaceWarpMap(clip, exact);
}

function writableAuthorizedClip(
	project: MutableAudioWarpProject,
	clipId: string,
	expectedClipAuthority: unknown,
): DataRecord {
	const context = assertAudioWarpClipAuthority(project, clipId, expectedClipAuthority);
	return context.clip as DataRecord;
}

function replaceWarpMap(clip: DataRecord, map: Readonly<AudioWarpMap>): void {
	const current = clip.warpMap;
	if (current != null && audioWarpMapFingerprint(current) === audioWarpMapFingerprint(map)) {
		clip.warpMap = map;
		return;
	}
	clip.warpMap = map;
	incrementRenderCacheRevision(clip);
}

function incrementRenderCacheRevision(clip: DataRecord): void {
	const current = clip.renderCacheRevision;
	if (!Number.isSafeInteger(current) || Number(current) < 0 || Number(current) >= Number.MAX_SAFE_INTEGER) {
		throw new RangeError('Audio warp render cache revision cannot be incremented.');
	}
	clip.renderCacheRevision = Number(current) + 1;
}

function warpProject(project: EditorCommandProject): MutableAudioWarpProject {
	const candidate = project as MutableAudioWarpProject;
	if (!isAudioWarpProjectSchema(candidate)) {
		throw new RangeError('Audio warp commands require an exact audio-warp project schema.');
	}
	if (!Array.isArray(candidate.clips) || !Array.isArray(candidate.tracks)) {
		throw new TypeError('An audio warp command project requires clips and tracks.');
	}
	return candidate;
}
