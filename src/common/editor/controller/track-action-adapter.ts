/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EditorTrackService,
	TrackCreateOptions,
	TrackMoveDirection,
	VideoTrackPairOptions,
} from './track-service.ts';

export interface TrackActionAdapterDependencies {
	readonly service: Pick<EditorTrackService,
		'addTrack'
		| 'addVideoTrackPair'
		| 'assignPreferredInputToTrack'
		| 'addLabelTrack'
		| 'reorderTrack'
		| 'moveTrack'
		| 'setTrackDisplayMode'
		| 'setTrackRate'
		| 'setTrackSampleFormat'>;
	getSelectedTrackId(): string | null;
	projectSampleRate(): number;
}

export interface TrackActionAdapter {
	addTrack(options?: TrackCreateOptions): string | undefined;
	addVideoTrackPair(options?: VideoTrackPairOptions): string | null;
	assignPreferredInputToTrack(trackId: string): boolean;
	addLabelTrack(options?: TrackCreateOptions): string | null;
	reorderTrack(trackId: string, requestedIndex: unknown): string | null;
	moveTrack(trackId: string | null, direction: TrackMoveDirection): string | null;
	setTrackDisplayMode(trackId: string, displayMode: string): unknown;
	setTrackRate(trackId?: string | null, requestedSampleRate?: unknown): Promise<string | null>;
	setTrackSampleFormat(trackId?: string | null, sampleFormat?: string): unknown;
}

/** Keep composition-root defaults and selected-track lookup out of the track domain service. */
export function createTrackActionAdapter(
	dependencies: TrackActionAdapterDependencies,
): Readonly<TrackActionAdapter> {
	const { service } = dependencies;
	return Object.freeze({
		addTrack: (options: TrackCreateOptions = {}) => service.addTrack(options),
		addVideoTrackPair: (options: VideoTrackPairOptions = {}) => service.addVideoTrackPair(options),
		assignPreferredInputToTrack: (trackId: string) => service.assignPreferredInputToTrack(trackId),
		addLabelTrack: (options: TrackCreateOptions = {}) => service.addLabelTrack(options),
		reorderTrack: (trackId: string, requestedIndex: unknown) => service.reorderTrack(trackId, requestedIndex),
		moveTrack: (trackId: string | null, direction: TrackMoveDirection) => service.moveTrack(trackId, direction),
		setTrackDisplayMode: (trackId: string, displayMode: string) => service.setTrackDisplayMode(trackId, displayMode),
		setTrackRate: (
			trackId: string | null = dependencies.getSelectedTrackId(),
			requestedSampleRate: unknown = dependencies.projectSampleRate(),
		) => service.setTrackRate(trackId, requestedSampleRate),
		setTrackSampleFormat: (
			trackId: string | null = dependencies.getSelectedTrackId(),
			sampleFormat = 'float32',
		) => service.setTrackSampleFormat(trackId, sampleFormat),
	});
}
