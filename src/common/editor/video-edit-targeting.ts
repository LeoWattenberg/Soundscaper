/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which tracks a three-point edit lands on.
 *
 * Targeting is a working choice rather than a fact about the document, so it is
 * never persisted; this module only resolves a choice the controller is holding
 * against the live document, and answers the same way when that choice names a
 * track that has since been removed as when it named nothing.
 *
 * Until the user targets anything, the edit follows the selected track and its
 * lane-group partner — the rule import already applies when it decides where a
 * new A/V pair goes. Once the user targets explicitly, the explicit choice is
 * complete: an untargeted lane stays untargeted rather than quietly falling
 * back, because the user turned it off on purpose.
 */

export interface VideoEditTargeting {
	readonly videoTrackId: string | null;
	readonly audioTrackId: string | null;
}

export interface VideoEditTargetsRequest {
	/** The controller's explicit choice, or null while the user has made none. */
	readonly targeting?: VideoEditTargeting | null;
	readonly selectedTrackId?: string | null;
	readonly sequenceId?: string | null;
}

export interface VideoEditTargets {
	readonly sequenceId: string;
	readonly videoTrackId: string | null;
	readonly audioTrackId: string | null;
	/** True when the user chose these lanes rather than inheriting the selection. */
	readonly explicit: boolean;
}

type DataRecord = Readonly<Record<string, unknown>>;

/** Resolve the video and audio lanes an edit would land on. */
export function resolveVideoEditTargets(
	projectValue: unknown,
	request: VideoEditTargetsRequest = {},
): VideoEditTargets {
	const project = record(projectValue, 'project');
	const sequenceId = String(request.sequenceId ?? project.primarySequenceId ?? '');
	if (!sequenceId) throw new TypeError('A sequence is required to resolve edit targets.');
	const sequence = arrayOf(project.sequences).find((candidate) => String(candidate.id) === sequenceId);
	if (!sequence) throw new ReferenceError(`Unknown sequence: ${sequenceId}.`);
	const memberIds = new Set((Array.isArray(sequence.trackIds) ? sequence.trackIds : []).map(String));
	const tracks = arrayOf(project.tracks).filter((track) => memberIds.has(String(track.id)));
	const trackOfType = (id: unknown, type: string): DataRecord | null => {
		const track = tracks.find((candidate) => candidate.id === id && candidate.type === type);
		return track ?? null;
	};

	if (request.targeting) {
		return Object.freeze({
			sequenceId,
			videoTrackId: trackOfType(request.targeting.videoTrackId, 'video')?.id as string ?? null,
			audioTrackId: trackOfType(request.targeting.audioTrackId, 'audio')?.id as string ?? null,
			explicit: true,
		});
	}

	const selected = tracks.find((track) => track.id === request.selectedTrackId) ?? null;
	const laneGroupId = selected && typeof selected.laneGroupId === 'string' ? selected.laneGroupId : null;
	const partner = (type: string): DataRecord | null => (laneGroupId === null
		? null
		: tracks.find((track) => track.type === type && track.laneGroupId === laneGroupId) ?? null);
	const video = selected?.type === 'video' ? selected : partner('video');
	const audio = selected?.type === 'audio' ? selected : partner('audio');
	return Object.freeze({
		sequenceId,
		videoTrackId: (video?.id as string) ?? null,
		audioTrackId: (audio?.id as string) ?? null,
		explicit: false,
	});
}

/** Toggle one lane of an explicit choice, starting from the resolved fallback. */
export function toggleVideoEditTarget(
	current: VideoEditTargets,
	trackId: string,
	trackType: string,
): VideoEditTargeting {
	const base: VideoEditTargeting = {
		videoTrackId: current.videoTrackId,
		audioTrackId: current.audioTrackId,
	};
	if (trackType === 'video') {
		return Object.freeze({
			...base,
			videoTrackId: base.videoTrackId === trackId ? null : trackId,
		});
	}
	if (trackType === 'audio') {
		return Object.freeze({
			...base,
			audioTrackId: base.audioTrackId === trackId ? null : trackId,
		});
	}
	throw new RangeError(`A ${trackType} track cannot receive a three-point edit.`);
}

function arrayOf(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function record(value: unknown, name: string): DataRecord {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
