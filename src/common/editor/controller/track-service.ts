/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddLabelCommand,
	createAddLabelTrackCommand,
	createAddTrackCommand,
} from '../commands/factories.ts';
import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';
import {
	findControllerClip,
	findControllerTrack,
	type ControllerProject,
	type ControllerTrack,
} from './track-domain-types.ts';

export type TrackMoveDirection = 'up' | 'down' | 'top' | 'bottom';
export type TrackDisplayMode = 'waveform' | 'spectrogram' | 'multiview' | 'half-wave';
export type TrackSampleFormat = 'int16' | 'int24' | 'int32' | 'float32' | 'float64';

interface TrackCopy {
	readonly track: string;
	readonly labels: string;
	readonly recordingDesktopAudio: string;
	readonly trackDestinationInvalid: string;
	readonly trackNotFound: string;
	readonly v2Required: string;
	readonly audioTrackRequired: string;
	readonly unknownTrackDisplay: string;
	readonly unsupportedSampleFormat: string;
}

export interface TrackCreateOptions extends Record<string, unknown> {
	readonly id?: string;
	readonly name?: unknown;
	readonly color?: string;
	readonly armed?: boolean;
	readonly height?: number;
}

export interface VideoTrackPairOptions extends TrackCreateOptions {
	readonly laneGroupId?: string;
	readonly videoTrackId?: string;
	readonly audioTrackId?: string;
	readonly videoHeight?: number;
	readonly audioHeight?: number;
	readonly index?: unknown;
}

export interface LabelCreateOptions extends Record<string, unknown> {
	readonly id?: string;
	readonly startFrame?: number;
	readonly endFrame?: number;
}

export interface RecordingRoute extends Readonly<Record<string, unknown>> {
	readonly kind: 'device' | 'display';
	readonly deviceId?: string;
	readonly deviceLabel?: string;
	readonly channelStart: number;
	readonly channelCount: number;
}

export interface RecordingRouting extends Readonly<Record<string, unknown>> {
	readonly routes: Readonly<Record<string, RecordingRoute>>;
}

interface RecordingDevice {
	readonly deviceId: string;
	readonly label?: string;
	readonly channelCount?: number;
	readonly status?: string;
}

interface RecordingPoolSource {
	readonly kind: 'device' | 'display';
	readonly channelCount?: number;
}

export interface TrackRecordingRoutingPort {
	readonly defaultDeviceId: string;
	readonly displaySourceKey: string;
	getRouting(): RecordingRouting;
	setRouting(routing: RecordingRouting): void;
	getPreferredDeviceId(): string;
	getPreferredChannelCount(): number;
	getDevices(): readonly RecordingDevice[];
	getPoolSources(): readonly RecordingPoolSource[];
	setTrackRoute(
		routing: RecordingRouting,
		track: ControllerTrack,
		route: Readonly<Record<string, unknown>>,
	): RecordingRouting;
	setRouteHealth(trackId: string, health: string): void;
	updateDeviceRows(): void;
	persistRouting(): Promise<unknown>;
	publish(): void;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface EditorTrackServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly copy: TrackCopy;
	readonly trackColors: readonly string[];
	readonly recording: TrackRecordingRoutingPort;
	getProject(): ControllerProject;
	getSelectedTrackId(): string | null;
	editingBlocked(): boolean;
	createId(prefix: string): string;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	getPositionFrames(): number;
	snapTimelineFrame(frame: number): number;
	setTimelineView(displayMode: TrackDisplayMode): void;
	resampleTrack?(trackId?: string | null, requestedSampleRate?: unknown): Promise<string | null>;
}

export interface EditorTrackService {
	addTrack(options?: TrackCreateOptions): string | undefined;
	addVideoTrackPair(options?: VideoTrackPairOptions): string | null;
	assignPreferredInputToTrack(trackId: string): boolean;
	addLabelTrack(options?: TrackCreateOptions): string | null;
	reorderTrack(trackId: string, requestedIndex: unknown): string | null;
	moveTrack(trackId: string | null, direction: TrackMoveDirection): string | null;
	setTrackDisplayMode(trackId: string, displayMode: string): unknown;
	setTrackRate(trackId?: string | null, requestedSampleRate?: unknown): Promise<string | null>;
	setTrackSampleFormat(trackId?: string | null, sampleFormat?: string): unknown;
	addLabel(trackId?: string | null, options?: LabelCreateOptions): string | null;
}

export function createEditorTrackService(
	dependencies: EditorTrackServiceDependencies,
): Readonly<EditorTrackService> {
	return Object.freeze({
		addTrack,
		addVideoTrackPair,
		assignPreferredInputToTrack,
		addLabelTrack,
		reorderTrack,
		moveTrack,
		setTrackDisplayMode,
		setTrackRate,
		setTrackSampleFormat,
		addLabel,
	});

	function addTrack(options: TrackCreateOptions = {}): string | undefined {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return undefined;
		const project = dependencies.getProject();
		const trackId = options.id || dependencies.createId('track');
		const audioTrackCount = project.tracks.filter((track) => track.type === 'audio').length;
		const color = options.color || dependencies.trackColors[audioTrackCount % dependencies.trackColors.length];
		const command = createAddTrackCommand({
			...options,
			schemaVersion: 2,
			type: 'audio',
			id: trackId,
			name: String(options.name || `${dependencies.copy.track} ${project.tracks.length + 1}`).trim()
				|| dependencies.copy.track,
			...(color ? { color } : {}),
			armed: options.armed ?? project.tracks.length === 0,
			height: options.height ?? 300,
		});
		dependencies.commit(command, { selectTrackId: trackId });
		assignPreferredInputToTrack(trackId);
		return trackId;
	}

	function addVideoTrackPair(options: VideoTrackPairOptions = {}): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const laneGroupId = options.laneGroupId || dependencies.createId('media-lane');
		const videoTrackId = options.videoTrackId || options.id || dependencies.createId('video-track');
		const audioTrackId = options.audioTrackId || dependencies.createId('track');
		const requestedIndex = options.index == null
			? project.tracks.length
			: Math.max(0, Math.min(project.tracks.length, Math.round(Number(options.index))));
		if (!Number.isSafeInteger(requestedIndex)) throw new TypeError(dependencies.copy.trackDestinationInvalid);
		const baseName = String(options.name
			|| `Video ${project.tracks.filter((track) => track.type === 'video').length + 1}`).trim();
		const commands: AudioEditorCommand[] = [{
			...createAddTrackCommand({
				schemaVersion: 4,
				type: 'video',
				id: videoTrackId,
				name: baseName,
				laneGroupId,
				height: options.height ?? options.videoHeight ?? 300,
			}),
			index: requestedIndex,
		}, {
			...createAddTrackCommand({
				schemaVersion: 4,
				type: 'audio',
				id: audioTrackId,
				name: `${baseName} Audio`,
				laneGroupId,
				armed: false,
				height: options.height ?? options.audioHeight ?? 300,
			}),
			index: requestedIndex + 1,
		}];
		dependencies.commit({ type: 'batch', commands }, { selectTrackId: videoTrackId });
		return videoTrackId;
	}

	function assignPreferredInputToTrack(trackId: string): boolean {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const routing = dependencies.recording.getRouting();
		if (routing.routes[trackId]) return false;
		const track = findControllerTrack(project, trackId);
		if (!track || track.type !== 'audio') return false;
		const deviceId = dependencies.recording.getPreferredDeviceId()
			|| dependencies.recording.defaultDeviceId;
		const displayInput = deviceId === dependencies.recording.displaySourceKey;
		const device = dependencies.recording.getDevices().find((candidate) => candidate.deviceId === deviceId);
		const channelCount = dependencies.recording.getPreferredChannelCount() === 2 ? 2 : 1;
		const displaySource = displayInput
			? dependencies.recording.getPoolSources().find((source) => source.kind === 'display')
			: null;
		const discoveredChannelCount = Math.max(0, Number(displaySource?.channelCount ?? device?.channelCount) || 0);
		if (discoveredChannelCount > 0 && discoveredChannelCount < channelCount) return false;
		const maximumChannels = Math.max(channelCount, discoveredChannelCount || 2);
		for (let channelStart = 0; channelStart + channelCount <= maximumChannels; channelStart += channelCount) {
			try {
				const next = dependencies.recording.setTrackRoute(routing, track, {
					...(displayInput
						? { kind: 'display', label: dependencies.copy.recordingDesktopAudio }
						: { kind: 'device', deviceId, deviceLabel: device?.label || '' }),
					channelStart,
					channelCount,
				});
				dependencies.recording.setRouting(next);
				dependencies.recording.setRouteHealth(trackId, device?.status || 'available');
				dependencies.recording.updateDeviceRows();
				void dependencies.recording.persistRouting().catch(() => undefined);
				dependencies.recording.publish();
				return true;
			} catch {
				// Try the next free channel and leave the track unassigned when none remain.
			}
		}
		return false;
	}

	function addLabelTrack(options: TrackCreateOptions = {}): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const trackId = options.id || dependencies.createId('label-track');
		dependencies.commit(createAddLabelTrackCommand({
			...options,
			id: trackId,
			name: String(options.name || dependencies.copy.labels).trim(),
			height: options.height ?? 300,
		}), { selectTrackId: trackId });
		return trackId;
	}

	function reorderTrack(trackId: string, requestedIndex: unknown): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const track = findControllerTrack(project, trackId);
		if (!track) throw new Error(dependencies.copy.trackNotFound);
		const index = Math.max(0, Math.min(project.tracks.length - 1, Math.round(Number(requestedIndex))));
		if (!Number.isFinite(index)) throw new TypeError(dependencies.copy.trackDestinationInvalid);
		if (project.tracks[index]?.id === track.id) return track.id;
		dependencies.commit({ type: 'track/reorder', trackId: track.id, index }, { selectTrackId: track.id });
		return track.id;
	}

	function moveTrack(trackId: string | null, direction: TrackMoveDirection): string | null {
		dependencies.lifetime.assertActive();
		if (!trackId) return null;
		const project = dependencies.getProject();
		const index = project.tracks.findIndex((track) => track.id === trackId);
		if (index < 0) throw new Error(dependencies.copy.trackNotFound);
		const blocks: ControllerTrack[][] = [];
		const consumedLaneGroups = new Set<string>();
		for (const track of project.tracks) {
			if (!track.laneGroupId) blocks.push([track]);
			else if (!consumedLaneGroups.has(track.laneGroupId)) {
				consumedLaneGroups.add(track.laneGroupId);
				blocks.push(project.tracks.filter((candidate) => candidate.laneGroupId === track.laneGroupId));
			}
		}
		const blockIndex = blocks.findIndex((block) => block.some((track) => track.id === trackId));
		const adjacent = direction === 'up' ? blocks[blockIndex - 1]
			: direction === 'down' ? blocks[blockIndex + 1] : null;
		const destination = direction === 'top' ? 0
			: direction === 'bottom' ? project.tracks.length - 1
				: direction === 'up' || direction === 'down'
					? project.tracks.findIndex((track) => track.id === adjacent?.[0]?.id)
					: index;
		return destination < 0 ? trackId : reorderTrack(trackId, destination);
	}

	function setTrackDisplayMode(trackId: string, displayMode: string): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		if (project.schemaVersion < 2) throw new Error(dependencies.copy.v2Required);
		const track = findControllerTrack(project, trackId);
		if (!track || track.type !== 'audio') throw new Error(dependencies.copy.audioTrackRequired);
		if (!isTrackDisplayMode(displayMode)) throw new RangeError(dependencies.copy.unknownTrackDisplay);
		dependencies.setTimelineView(displayMode);
		return dependencies.commit({ type: 'track/update', trackId: track.id, changes: { displayMode } }, { selectTrackId: track.id });
	}

	function setTrackRate(
		trackId: string | null = dependencies.getSelectedTrackId(),
		requestedSampleRate: unknown = dependencies.getProject().sampleRate,
	): Promise<string | null> {
		dependencies.lifetime.assertActive();
		if (!dependencies.resampleTrack) throw new TypeError('Track resampling is unavailable.');
		return dependencies.resampleTrack(trackId, requestedSampleRate);
	}

	function setTrackSampleFormat(
		trackId: string | null = dependencies.getSelectedTrackId(),
		sampleFormat = 'float32',
	): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		if (project.schemaVersion < 2) throw new Error(dependencies.copy.v2Required);
		const track = findControllerTrack(project, trackId);
		if (!track || track.type !== 'audio') throw new Error(dependencies.copy.audioTrackRequired);
		if (!isTrackSampleFormat(sampleFormat)) throw new RangeError(dependencies.copy.unsupportedSampleFormat);
		const sourceIds = new Set(track.clipIds
			.map((clipId) => findControllerClip(project, clipId)?.sourceId)
			.filter((sourceId): sourceId is string => Boolean(sourceId)));
		const commands: AudioEditorCommand[] = [...sourceIds].map((sourceId) => ({
			type: 'source/update', sourceId, changes: { sampleFormat },
		}));
		return commands.length
			? dependencies.commit({ type: 'batch', commands }, { selectTrackId: track.id })
			: track.id;
	}

	function addLabel(trackId: string | null = null, options: LabelCreateOptions = {}): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		let project = dependencies.getProject();
		let target = findControllerTrack(project, trackId || dependencies.getSelectedTrackId());
		if (target?.type !== 'label') {
			const createdTrackId = addLabelTrack();
			project = dependencies.getProject();
			target = findControllerTrack(project, createdTrackId);
		}
		if (!target || target.type !== 'label') throw new Error(dependencies.copy.trackNotFound);
		const startFrame = dependencies.snapTimelineFrame(options.startFrame ?? dependencies.getPositionFrames());
		const endFrame = dependencies.snapTimelineFrame(options.endFrame ?? startFrame);
		const labelId = options.id || dependencies.createId('label');
		const command = createAddLabelCommand(target.id, {
			...options,
			id: labelId,
			startFrame: Math.min(startFrame, endFrame),
			endFrame: Math.max(startFrame, endFrame),
		} as CommandObject);
		dependencies.commit(command, { selectTrackId: target.id });
		return labelId;
	}
}

function isTrackDisplayMode(value: string): value is TrackDisplayMode {
	return value === 'waveform' || value === 'spectrogram' || value === 'multiview' || value === 'half-wave';
}

function isTrackSampleFormat(value: string): value is TrackSampleFormat {
	return value === 'int16' || value === 'int24' || value === 'int32'
		|| value === 'float32' || value === 'float64';
}
