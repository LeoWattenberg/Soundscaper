/* SPDX-License-Identifier: AGPL-3.0-only */

import { positiveTakeCycleRoutedInteger } from './take-cycle-routed-capture-validation.ts';
import type { TakeCycleRoutedCaptureRuntime } from './take-cycle-routed-capture-types.ts';
import type { RecordingRoute, RecordingTrack } from './recording-transaction-types.ts';

export interface TakeCycleRoutedAcquisitionLane {
	readonly track: RecordingTrack;
	readonly route: RecordingRoute;
}

export interface TakeCycleRoutedAcquiredSource {
	readonly sourceKey: string;
	readonly kind: 'device' | 'display';
	readonly stream: Awaited<ReturnType<TakeCycleRoutedCaptureRuntime['capturePool']['acquireHardware']>>;
	readonly channelCount: number;
	readonly lanes: readonly TakeCycleRoutedAcquisitionLane[];
}

export async function acquireTakeCycleRoutedSources(
	groups: readonly Readonly<{ readonly sourceKey: string; readonly routes: readonly TakeCycleRoutedAcquisitionLane[] }>[],
	projectSampleRate: number,
	runtime: Pick<TakeCycleRoutedCaptureRuntime,
		'capturePool' | 'recordingStreamIsLive' | 'streamAudioChannelCount'
	>,
	failLane: (lane: TakeCycleRoutedAcquisitionLane, error: unknown) => Promise<void>,
): Promise<readonly TakeCycleRoutedAcquiredSource[]> {
	const acquisitions = groups.map(async ({ sourceKey, routes }) => {
		const first = routes[0]?.route;
		if (!first) throw new Error('Take cycle routed source group is empty.');
		const requiredChannels = Math.max(...routes.map(({ route }) => route.channelStart + route.channelCount));
		const stream = first.kind === 'display'
			? await runtime.capturePool.acquireDisplay()
			: await runtime.capturePool.acquireHardware(first.deviceId, {
				channelCount: requiredChannels, sampleRate: projectSampleRate,
			});
		return { sourceKey, routes, first, stream };
	});
	const settled = await Promise.allSettled(acquisitions);
	const sources: TakeCycleRoutedAcquiredSource[] = [];
	for (let index = 0; index < settled.length; index += 1) {
		const result = settled[index]!;
		const group = groups[index]!;
		if (result.status === 'rejected') {
			for (const route of group.routes) await failLane(route, result.reason);
			continue;
		}
		const { first, stream } = result.value;
		if (!runtime.recordingStreamIsLive(stream, first.kind)) {
			const error = new Error(`Take cycle routed input ${group.sourceKey} is disconnected.`);
			for (const route of group.routes) await failLane(route, error);
			continue;
		}
		const channelCount = positiveTakeCycleRoutedInteger(
			runtime.streamAudioChannelCount(stream), 64, 'routed input channel count',
		);
		const surviving: TakeCycleRoutedAcquisitionLane[] = [];
		for (const lane of group.routes) {
			if (lane.route.kind === 'display'
				|| lane.route.channelStart + lane.route.channelCount <= channelCount) {
				surviving.push(lane);
			} else {
				await failLane(lane, new Error(`Take cycle route ${lane.track.id} exceeds its input channels.`));
			}
		}
		sources.push({ sourceKey: group.sourceKey, kind: first.kind, stream, channelCount, lanes: surviving });
	}
	return Object.freeze(sources);
}
