/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
	type FramescaperNativeQueueProjection,
	type FramescaperNativeServicesBridge,
	type FramescaperNativeServicesProjection,
	type FramescaperNativeServicesRendererSnapshot,
} from '../../src/common/editor/ui/framescaper-native-services-bridge.ts';
import {
	createFramescaperNativeProjectActionRuntime,
} from '../../src/common/editor/ui/framescaper-native-project-actions.ts';

export const FRAMESCAPER_NATIVE_JOB_ID = '12'.repeat(20);

export function createFramescaperNativeServicesBridgeFixture(
	overrides: Partial<FramescaperNativeServicesBridge> = {},
) {
	const calls: unknown[][] = [];
	let state: FramescaperNativeQueueProjection['state'] = 'queued';
	const bridge: FramescaperNativeServicesBridge = {
		snapshot: () => {
			calls.push(['snapshot']);
			return Promise.resolve(framescaperNativeServiceSnapshot(state));
		},
		control: (request) => {
			calls.push(['control', request.jobId, request.action]);
			state = request.action === 'pause' ? 'paused' : state;
			return Promise.resolve(framescaperNativeQueueRow(state));
		},
		reorder: (request) => {
			calls.push(['reorder', request.jobId, request.index]);
			return Promise.resolve([framescaperNativeQueueRow(state)]);
		},
		remove: (request) => {
			calls.push(['remove', request.jobId]);
			return Promise.resolve(true);
		},
		...overrides,
	};
	return { bridge, calls };
}

export function framescaperNativeServiceSnapshot(
	state: FramescaperNativeQueueProjection['state'] = 'queued',
): FramescaperNativeServicesProjection {
	return {
		snapshotVersion: 1 as const,
		runtimeAvailable: true,
		nativeMediaEnabled: true,
		queue: [framescaperNativeQueueRow(state)],
		roots: [{ grantId: 'ab'.repeat(16), displayName: 'Exports', revoked: false }],
		watchRules: [],
	};
}

export function framescaperNativeQueueRow(
	state: FramescaperNativeQueueProjection['state'] = 'queued',
): FramescaperNativeQueueProjection {
	return {
		jobId: FRAMESCAPER_NATIVE_JOB_ID,
		taskKind: 'encoded-export',
		projectId: 'project-1',
		relativeDestination: 'exports/reel.mp4',
		state,
		position: 0,
		progress: null,
		attempt: 0,
		lastFailureCode: null,
	};
}

export function framescaperNativeRendererSnapshot(overrides: Readonly<{
	runtimeAvailable: boolean;
	nativeMediaEnabled: boolean;
}>): FramescaperNativeServicesRendererSnapshot {
	return {
		services: { ...framescaperNativeServiceSnapshot(), ...overrides },
		capabilitySnapshot: null,
		preferences: DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
		controllablePreferences: [],
		externalDisplays: [],
		activeExternalDisplayId: null,
	};
}

export function createFramescaperNativeCandidateActions() {
	return createFramescaperNativeProjectActionRuntime({
		'image-sequence-import': async () => undefined,
		'render-queue-enqueue': async () => undefined,
		'proxy-generate': async () => undefined,
		'proxy-attach': async () => undefined,
		'proxy-detach': async () => undefined,
		'proxy-relink': async () => undefined,
		'ofx-add': async () => undefined,
	});
}
