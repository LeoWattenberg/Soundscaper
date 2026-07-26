/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PreparedTimedRecordingInputs,
	TimedRecordingOptions,
	TimedRecordingPreparationScope,
} from './timed-recording-service.ts';

type MaybePromise<Value> = Value | PromiseLike<Value>;

export interface TimedRecordingInputTrack {
	readonly id: string;
	readonly type?: string;
	readonly armed?: boolean;
}

export interface TimedRecordingInputProject {
	readonly tracks: readonly TimedRecordingInputTrack[];
	readonly sampleRate?: number;
}

export type TimedRecordingInputRoute = Readonly<{
	readonly kind: 'device';
	readonly deviceId: string;
	readonly channelStart: number;
	readonly channelCount: number;
}> | Readonly<{
	readonly kind: 'display';
	readonly deviceId?: string;
	readonly channelStart: number;
	readonly channelCount: number;
}>;

export interface PrepareTimedRecordingInputsOptions extends TimedRecordingOptions {
	readonly reusePreparedInputsOnly?: boolean;
}

export type TimedRecordingRouteHealth = 'skipped' | 'opening' | 'unavailable' | 'open';

export interface TimedRecordingCapturePoolPort<Stream> {
	getHardware?(deviceId: string): Stream | null;
	getDisplay?(): Stream | null;
	acquireHardware(
		deviceId: string,
		options: Readonly<{ channelCount: number; sampleRate: number }>,
	): MaybePromise<Stream>;
	acquireDisplay(): MaybePromise<Stream>;
}

export interface TimedRecordingInputMessages {
	readonly armTrack: string;
	readonly assignInput: string;
	readonly preparedInputClosed: string;
	readonly assignedInputsUnavailable: string;
}

export interface TimedRecordingInputServiceRuntime<Stream> {
	readonly getProject: () => TimedRecordingInputProject;
	readonly findTrack: (
		project: TimedRecordingInputProject,
		trackId: string,
	) => TimedRecordingInputTrack | null;
	readonly projectSampleRate: (project: TimedRecordingInputProject) => number;
	readonly getPreferredInputChannelCount: () => number;
	readonly getRecordingRoutes: () => Readonly<Record<string, TimedRecordingInputRoute>>;
	readonly setRecordingRouteHealth: (trackId: string, health: TimedRecordingRouteHealth) => void;
	readonly capturePool: TimedRecordingCapturePoolPort<Stream>;
	readonly defaultDeviceId: string;
	readonly recordingRouteSourceKey: (route: TimedRecordingInputRoute) => string;
	readonly streamAudioChannelCount: (stream: Stream) => number;
	readonly recordingStreamIsLive: (stream: Stream, kind: TimedRecordingInputRoute['kind']) => boolean;
	readonly messages: TimedRecordingInputMessages;
}

interface RoutedTrack {
	readonly track: TimedRecordingInputTrack;
	readonly route: TimedRecordingInputRoute;
}

interface InputAcquisition<Stream> {
	readonly sourceKey: string;
	readonly routes: readonly RoutedTrack[];
	readonly promise: PromiseLike<Stream> | Stream;
}

/**
 * Open and validate every input needed to arm a timed recording. Timer
 * generation, project ownership, and release policy remain with the timed
 * recording service; this service owns only route planning and capture-pool
 * acquisition.
 */
export function createTimedRecordingInputService<Stream>(
	runtime: TimedRecordingInputServiceRuntime<Stream>,
) {
	async function prepareTimedRecordingInputs(
		options: PrepareTimedRecordingInputsOptions = {},
		scope: TimedRecordingPreparationScope,
	): Promise<PreparedTimedRecordingInputs> {
		scope.assertCurrent();
		const project = runtime.getProject();
		const sampleRate = runtime.projectSampleRate(project);
		const routes = runtime.getRecordingRoutes();
		if (options.trackId) {
			return prepareExplicitTrack(project, routes, sampleRate, options.trackId, options, scope);
		}
		return prepareArmedTracks(project, routes, sampleRate, scope);
	}

	async function prepareExplicitTrack(
		project: TimedRecordingInputProject,
		routes: Readonly<Record<string, TimedRecordingInputRoute>>,
		sampleRate: number,
		trackId: string,
		options: PrepareTimedRecordingInputsOptions,
		scope: TimedRecordingPreparationScope,
	): Promise<PreparedTimedRecordingInputs> {
		const track = runtime.findTrack(project, trackId);
		if (!track || track.type !== 'audio') throw new Error(runtime.messages.armTrack);
		const explicitRoute = routes[track.id];
		const needsRoutedRecording = Boolean(explicitRoute && (
			explicitRoute.kind === 'display'
				|| explicitRoute.deviceId !== runtime.defaultDeviceId
				|| explicitRoute.channelStart > 0
				|| explicitRoute.channelCount !== 2
		));
		const route: TimedRecordingInputRoute = needsRoutedRecording && explicitRoute
			? explicitRoute
			: {
				kind: 'device',
				deviceId: runtime.defaultDeviceId,
				channelStart: 0,
				channelCount: runtime.getPreferredInputChannelCount(),
			};
		const requestedChannels = route.channelStart + route.channelCount;
		const retained = route.kind === 'display'
			? runtime.capturePool.getDisplay?.()
			: runtime.capturePool.getHardware?.(route.deviceId);
		if (options.reusePreparedInputsOnly && (!retained
			|| (route.kind !== 'display'
				&& runtime.streamAudioChannelCount(retained) < requestedChannels))) {
			throw new Error(runtime.messages.preparedInputClosed);
		}
		const stream = route.kind === 'display'
			? retained || await runtime.capturePool.acquireDisplay()
			: await runtime.capturePool.acquireHardware(route.deviceId, {
				channelCount: requestedChannels,
				sampleRate,
			});
		scope.assertCurrent();
		if (!runtime.recordingStreamIsLive(stream, route.kind)) {
			throw new Error(runtime.messages.preparedInputClosed);
		}
		return frozenInputs([runtime.recordingRouteSourceKey(route)]);
	}

	async function prepareArmedTracks(
		project: TimedRecordingInputProject,
		routes: Readonly<Record<string, TimedRecordingInputRoute>>,
		sampleRate: number,
		scope: TimedRecordingPreparationScope,
	): Promise<PreparedTimedRecordingInputs> {
		const armedTracks = project.tracks.filter((track) => track.type === 'audio' && track.armed);
		if (!armedTracks.length) throw new Error(runtime.messages.armTrack);
		const groups = new Map<string, RoutedTrack[]>();
		for (const track of armedTracks) {
			const route = routes[track.id];
			if (!route) {
				runtime.setRecordingRouteHealth(track.id, 'skipped');
				continue;
			}
			const sourceKey = runtime.recordingRouteSourceKey(route);
			const group = groups.get(sourceKey) || [];
			group.push({ track, route });
			groups.set(sourceKey, group);
			runtime.setRecordingRouteHealth(track.id, 'opening');
		}
		if (!groups.size) throw new Error(runtime.messages.assignInput);
		const orderedGroups = [...groups.entries()].sort(([left], [right]) => (
			left === 'display' ? -1 : right === 'display' ? 1 : 0
		));
		const acquisitions: InputAcquisition<Stream>[] = orderedGroups.map(([sourceKey, groupRoutes]) => {
			const firstRoute = groupRoutes[0]?.route;
			if (!firstRoute) throw new Error(runtime.messages.assignedInputsUnavailable);
			const requiredChannels = Math.max(...groupRoutes.map(({ route }) => (
				route.channelStart + route.channelCount
			)));
			const promise = firstRoute.kind === 'display'
				? runtime.capturePool.acquireDisplay()
				: runtime.capturePool.acquireHardware(firstRoute.deviceId, {
					channelCount: requiredChannels,
					sampleRate,
				});
			return { sourceKey, routes: groupRoutes, promise };
		});
		const settled = await Promise.allSettled(acquisitions.map(({ promise }) => promise));
		scope.assertCurrent();
		let availableRoutes = 0;
		let failedRoutes = 0;
		for (let index = 0; index < acquisitions.length; index += 1) {
			const acquisition = acquisitions[index];
			const result = settled[index];
			if (!acquisition || !result) continue;
			if (result.status === 'rejected') {
				for (const { track } of acquisition.routes) {
					runtime.setRecordingRouteHealth(track.id, 'unavailable');
				}
				failedRoutes += acquisition.routes.length;
				continue;
			}
			const availableChannels = runtime.streamAudioChannelCount(result.value);
			for (const { track, route } of acquisition.routes) {
				const available = runtime.recordingStreamIsLive(result.value, route.kind)
					&& (route.kind === 'display'
						|| route.channelStart + route.channelCount <= availableChannels);
				runtime.setRecordingRouteHealth(track.id, available ? 'open' : 'skipped');
				if (available) availableRoutes += 1;
				else failedRoutes += 1;
			}
		}
		if (!availableRoutes || failedRoutes) {
			throw new Error(runtime.messages.assignedInputsUnavailable);
		}
		return frozenInputs(acquisitions.map(({ sourceKey }) => sourceKey));
	}

	return Object.freeze({ prepareTimedRecordingInputs });
}

function frozenInputs(inputKeys: readonly string[]): PreparedTimedRecordingInputs {
	return Object.freeze({ inputKeys: Object.freeze([...inputKeys]) });
}
