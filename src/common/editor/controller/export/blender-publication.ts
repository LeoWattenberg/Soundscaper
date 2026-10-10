/* SPDX-License-Identifier: AGPL-3.0-only */

import { BLENDER_CHUNK_BYTE_LIMIT, BLENDER_TRACK_LIMIT, type BlenderBridge } from '../../blender-contract.ts';
import { createWavStreamEncoder } from '../../wav.js';
import { projectEffectTailFrames } from '../../effects.js';
import { stemProject } from './temporary-export.ts';
import { projectTrackFolderMediaStateV12 } from '../../track-folder-media-runtime.ts';
import { audioBufferChannels, type RenderedAudio } from '../../rendered-audio-channels.ts';

export interface BlenderRenderProject {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly sampleRate: number;
	readonly tracks: readonly { readonly id: string; readonly type: string; readonly name?: string;
		readonly clipIds: readonly string[]; readonly mute?: boolean; readonly solo?: boolean }[];
	readonly clips: readonly { readonly id: string; readonly timelineStartFrame: number; readonly durationFrames: number }[];
}
export interface BlenderPublishRequest {
	readonly bridge: BlenderBridge;
	readonly sessionId: string;
	readonly projectId: string;
	readonly revision: number;
	readonly signal?: AbortSignal;
}
interface RenderRange {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly includeTail: number;
	readonly includeMaster: false;
	readonly respectMuteSolo: true;
}
export interface BlenderPublicationRuntime {
	getProject(): BlenderRenderProject | null | undefined;
	renderSnapshot(project: BlenderRenderProject, range: RenderRange, signal?: AbortSignal): Promise<RenderedAudio>;
	stemProject?(project: BlenderRenderProject, trackId: string): BlenderRenderProject;
	tailFrames?(project: BlenderRenderProject, trackId: string): number;
}
const effectTailFrames = projectEffectTailFrames as unknown as (project: BlenderRenderProject,
	options: { trackId: string; includeMaster: boolean }) => number;

/** Publish detached stems; a failed or superseded render never replaces Blender's last complete revision. */
export async function publishBlenderTracks(runtime: BlenderPublicationRuntime, request: BlenderPublishRequest) {
	const original = runtime.getProject();
	const assertCurrent = () => {
		request.signal?.throwIfAborted();
		const current = runtime.getProject();
		if (!original || current?.id !== request.projectId || current.revision !== request.revision) {
			throw new DOMException('The project changed while publishing to Blender.', 'AbortError');
		}
	};
	assertCurrent();
	if (!original) throw new Error('Blender export requires an open project.');
	const project = projectTrackFolderMediaStateV12(original);
	const tracks = project.tracks.filter((track) => track.type === 'audio' && track.clipIds.length > 0);
	if (tracks.length > BLENDER_TRACK_LIMIT) throw new Error(`Blender supports at most ${String(BLENDER_TRACK_LIMIT)} audio tracks per export.`);
	const solo = project.tracks.some((track) => track.type === 'audio' && track.solo);
	const endFrame = project.clips.reduce((end, clip) => Math.max(end, clip.timelineStartFrame + clip.durationFrames), 0);
	const prepared = tracks.map((track) => {
		const snapshot = (runtime.stemProject ?? stemProject)(project, track.id);
		const tail = runtime.tailFrames?.(snapshot, track.id) ?? effectTailFrames(snapshot, { trackId: track.id, includeMaster: false });
		return { frames: endFrame + tail, tail, track };
	});
	const { bridge, sessionId } = request;
	const { publicationId } = await bridge.begin({ sessionId, projectId: project.id,
		projectName: cleanName(project.title, 'Untitled project'), tracks: prepared.map(({ track, frames }) => ({
			id: track.id, name: cleanName(track.name, 'Audio track'), startSeconds: 0,
			durationSeconds: frames / project.sampleRate, mute: Boolean(track.mute || (solo && !track.solo)),
		})) });
	try {
		assertCurrent();
		for (const { frames, tail, track } of prepared) {
			const snapshot = (runtime.stemProject ?? stemProject)(project, track.id);
			const audio = await runtime.renderSnapshot(snapshot, { startFrame: 0, endFrame,
				includeTail: tail / project.sampleRate, includeMaster: false, respectMuteSolo: true }, request.signal);
			assertCurrent();
			const channels = audioBufferChannels(audio);
			const length = channels[0]?.length ?? 0;
			if (!channels.length || channels.length > 64 || length !== frames
				|| channels.some((channel) => channel.length !== length)
				|| ('sampleRate' in audio && audio.sampleRate !== project.sampleRate)) {
				throw new Error('The rendered Blender stem does not match its published audio duration or format.');
			}
			let offset = 0;
			const encoder = createWavStreamEncoder({ sampleRate: project.sampleRate, channelCount: channels.length,
				totalFrames: length, bitDepth: 24, collect: false, onChunk: async (bytes: Uint8Array) => {
					for (let start = 0; start < bytes.byteLength; start += BLENDER_CHUNK_BYTE_LIMIT) {
						assertCurrent();
						const chunk = bytes.slice(start, start + BLENDER_CHUNK_BYTE_LIMIT);
						await bridge.write({ sessionId, publicationId, trackId: track.id, offset, bytes: chunk });
						offset += chunk.byteLength;
					}
				} });
			await encoder.settled();
			const windowFrames = Math.min(65_536, Math.floor(BLENDER_CHUNK_BYTE_LIMIT / (channels.length * 3)));
			for (let start = 0; start < length; start += windowFrames) {
				assertCurrent();
				encoder.write(channels.map((channel) => channel.subarray(start, start + windowFrames)));
				await encoder.settled();
			}
			encoder.finalize();
			await encoder.settled();
		}
		assertCurrent();
		return await bridge.commit({ sessionId, publicationId });
	} catch (error) {
		try { await bridge.abort({ sessionId, publicationId }); }
		catch (cleanupError) {
			if (!request.signal?.aborted) throw new AggregateError([error, cleanupError], 'Blender publication and cleanup both failed.', { cause: cleanupError });
		}
		throw error;
	}
}

function cleanName(value: string | undefined, fallback: string): string {
	return value?.replace(/\p{Cc}/gu, ' ').trim().slice(0, 1024) || fallback;
}
