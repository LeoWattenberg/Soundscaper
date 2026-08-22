/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	createFramescaperNativeServicesStore,
	DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
	resolveFramescaperNativeServicesBridge,
	type FramescaperNativeQueueProjection,
	type FramescaperNativeServicesBridge,
	type FramescaperNativeServicesProjection,
	type FramescaperNativeServicesRendererSnapshot,
} from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import FramescaperNativeServicesDialog from '../src/common/editor/ui/dialogs/FramescaperNativeServicesDialog.tsx';
import {
	createFramescaperNativeProjectActionRuntime,
	FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	createFramescaperNativeServicesSurfaceHost,
	resolveFramescaperNativeServicesWorkspaceRuntime,
	wrapFramescaperNativeServicesMenuRuntime,
} from '../src/common/editor/ui/workspace/FramescaperNativeServicesSurface.tsx';

const JOB_ID = '12'.repeat(20);

test('only an exact nested framescaperDesktop.v1.nativeServices bridge is admitted', () => {
	const nativeServices = fakeBridge().bridge;
	assert.equal(resolveFramescaperNativeServicesBridge({
		framescaperDesktop: { v1: { nativeServices } },
	}), nativeServices);
	assert.equal(resolveFramescaperNativeServicesBridge({
		framescaperDesktop: { v1: { nativeServices: { snapshot: nativeServices.snapshot } } },
	}), null);
	assert.equal(resolveFramescaperNativeServicesBridge({
		soundscaperDesktop: { v1: { nativeServices } },
	}), null);
});

test('the renderer store starts fail-closed and re-reads main after queue controls', async () => {
	const fixture = fakeBridge();
	const store = createFramescaperNativeServicesStore(fixture.bridge, () => 1_000);
	assert.equal(store.getSnapshot(), null);

	const first = await store.refresh();
	assert.deepEqual(first.preferences, {
		...DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
		nativeMediaEnabled: true,
	});
	assert.equal(first.services.runtimeAvailable, true);
	assert.equal(first.capabilitySnapshot, null);
	assert.deepEqual(first.externalDisplays, []);

	await store.control({ jobId: JOB_ID, action: 'pause' });
	assert.deepEqual(fixture.calls, [
		['snapshot'], ['control', JOB_ID, 'pause'], ['snapshot'],
	]);
	assert.equal(store.getSnapshot()?.services.queue[0]?.state, 'paused');
});

test('the renderer refuses a path leak or malformed projection from preload', async () => {
	const fixture = fakeBridge({
		snapshot: () => Promise.resolve({
			...serviceSnapshot(),
			queue: [{ ...queueRow(), relativeDestination: '../private/reel.mp4' }],
		}),
	});
	await assert.rejects(
		() => createFramescaperNativeServicesStore(fixture.bridge).refresh(),
		/granted root/u,
	);
});

test('optional authenticated preference and capability ports are reflected without optimism', async () => {
	const fixture = fakeBridge({
		capabilities: () => Promise.resolve({
			snapshotVersion: 1,
			masterEnabled: true,
			buildFingerprint: null,
			entries: [],
		}),
		preferences: () => Promise.resolve({
			nativeMediaEnabled: true,
			hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false,
			ofxConsentEnabled: false,
		}),
		setPreference: (request) => {
			fixture.calls.push(['setPreference', request.preference, request.enabled]);
			return Promise.resolve(true);
		},
	});
	const store = createFramescaperNativeServicesStore(fixture.bridge);
	const snapshot = await store.refresh();
	assert.equal(snapshot.preferences.nativeMediaEnabled, true);
	assert.deepEqual(snapshot.controllablePreferences, [
		'native-media', 'hardware-decode', 'hardware-encode', 'ofx-consent',
	]);

	await store.setPreference({ preference: 'hardware-decode', enabled: true });
	await store.setPreference({ preference: 'hardware-encode', enabled: false });
	assert.deepEqual(fixture.calls.filter((call) => call[0] === 'setPreference'), [
		['setPreference', 'hardware-decode', true],
		['setPreference', 'hardware-encode', false],
	]);
});

test('the lazy dialog reports blocked native state and keeps preference switches visible', () => {
	const snapshot = rendererSnapshot({ runtimeAvailable: false, nativeMediaEnabled: false });
	const markup = renderToStaticMarkup(<FramescaperNativeServicesDialog
		bridge={fakeBridge().bridge}
		initialSurface="native-media-preferences"
		initialSnapshot={snapshot}
		onClose={() => undefined}
	/>);

	assert.match(markup, /role="dialog"/u);
	assert.match(markup, /data-framescaper-native-services-dialog="true"/u);
	assert.match(markup, /Native media master/u);
	assert.match(markup, /Hardware decode/u);
	assert.match(markup, /Hardware encode/u);
	assert.match(markup, /OpenFX consent/u);
	assert.match(markup, /Native media runtime is unavailable/u);
	assert.match(markup, /disabled=""/u);
});

test('the background-jobs surface exposes only state-valid queue controls', () => {
	const markup = renderToStaticMarkup(<FramescaperNativeServicesDialog
		bridge={fakeBridge().bridge}
		initialSurface="background-jobs"
		initialSnapshot={rendererSnapshot({ runtimeAvailable: true, nativeMediaEnabled: true })}
		onClose={() => undefined}
	/>);

	assert.match(markup, /reel\.mp4/u);
	assert.match(markup, /Pause/u);
	assert.match(markup, /Cancel/u);
	assert.doesNotMatch(markup, />Retry</u);
	assert.doesNotMatch(markup, />Remove</u);
});

test('the background-jobs surface disables every reorder while the native runtime is unusable', () => {
	const base = rendererSnapshot({ runtimeAvailable: false, nativeMediaEnabled: false });
	const queue = [0, 1, 2].map((position) => ({
		...queueRow(), jobId: String(position + 1).repeat(40), position,
	}));
	const markup = renderToStaticMarkup(<FramescaperNativeServicesDialog
		bridge={fakeBridge().bridge}
		initialSurface="background-jobs"
		initialSnapshot={{ ...base, services: { ...base.services, queue } }}
		onClose={() => undefined}
	/>);
	assert.equal(markup.match(/disabled="">Move (?:earlier|later)<\/button>/gu)?.length, 6);
});

test('Manage OFX reports consent and runtime evidence instead of a generic unavailable panel', () => {
	const markup = renderToStaticMarkup(<FramescaperNativeServicesDialog
		bridge={fakeBridge().bridge}
		initialSurface="ofx-manage"
		initialSnapshot={rendererSnapshot({ runtimeAvailable: false, nativeMediaEnabled: false })}
		onClose={() => undefined}
	/>);

	assert.match(markup, /OpenFX consent/u);
	assert.match(markup, /Runtime capability status/u);
	assert.match(markup, /Detailed runtime capability evidence is unavailable/u);
	assert.doesNotMatch(markup, /This operation is unavailable until/u);
});

test('candidate project actions render a lazy opt-in operation instead of a placeholder', () => {
	const actions = candidateActions();
	const markup = renderToStaticMarkup(<FramescaperNativeServicesDialog
		bridge={fakeBridge().bridge}
		initialSurface="ofx-add"
		initialSnapshot={rendererSnapshot({ runtimeAvailable: true, nativeMediaEnabled: true })}
		projectActions={actions}
		onClose={() => undefined}
	/>);

	assert.match(markup, /data-framescaper-native-project-action="ofx-add"/u);
	assert.match(markup, />Continue</u);
	assert.match(markup, /exact project and runtime gates passed/u);
	assert.doesNotMatch(markup, /This operation is unavailable until/u);
});

test('watch-folder surface exposes create, reconcile, enable, and remove lifecycle controls', () => {
	const bridge = fakeBridge({
		createWatch: () => Promise.reject(new Error('not invoked during server render')),
		setWatchEnabled: () => Promise.reject(new Error('not invoked during server render')),
		removeWatch: () => Promise.reject(new Error('not invoked during server render')),
		reconcileWatch: () => Promise.reject(new Error('not invoked during server render')),
	}).bridge;
	const base = rendererSnapshot({ runtimeAvailable: true, nativeMediaEnabled: true });
	const snapshot: FramescaperNativeServicesRendererSnapshot = {
		...base,
		services: {
			...base.services,
			watchRules: [{
				ruleId: 'cd'.repeat(16), grantId: 'ab'.repeat(16), projectId: 'project-1',
				extensions: ['wav'], importMode: 'link', generateProxies: false, enabled: true,
			}],
		},
	};
	const markup = renderToStaticMarkup(<FramescaperNativeServicesDialog
		bridge={bridge}
		initialSurface="watch-folders"
		initialSnapshot={snapshot}
		context={{ projectId: 'project-1', binId: null, allowProxyGeneration: false }}
		onClose={() => undefined}
	/>);

	for (const label of ['Add watch folder', 'Reconcile now', 'Disable', 'Remove']) {
		assert.match(markup, new RegExp(label, 'u'));
	}
	assert.doesNotMatch(markup, /This operation is unavailable until/u);
});

test('native preferences expose root authorization lifecycle and verified scratch cleanup', () => {
	const bridge = fakeBridge({
		selectRoot: () => Promise.resolve(null),
		revalidateRoot: () => Promise.resolve(true),
		revokeRoot: () => Promise.resolve(true),
		cleanupScratch: () => Promise.resolve([]),
	}).bridge;
	const markup = renderToStaticMarkup(<FramescaperNativeServicesDialog
		bridge={bridge}
		initialSurface="native-media-preferences"
		initialSnapshot={rendererSnapshot({ runtimeAvailable: true, nativeMediaEnabled: true })}
		onClose={() => undefined}
	/>);

	for (const label of ['Authorize folder', 'Revalidate', 'Revoke', 'Clean verified scratch']) {
		assert.match(markup, new RegExp(label, 'u'));
	}
});

test('the menu-opened surface creates no host before open and disposes one root', () => {
	const rendered: unknown[] = [];
	let unmounted = 0;
	let removed = 0;
	const container = {
		dataset: {},
		remove: () => { removed += 1; },
	} as unknown as HTMLElement;
	const documentValue = {
		createElement: () => container,
		querySelector: () => null,
		body: { append: () => undefined },
	} as unknown as Document;
	const host = createFramescaperNativeServicesSurfaceHost({
		bridge: fakeBridge().bridge,
		documentValue,
		createHostRoot: () => ({
			render: (node) => rendered.push(node),
			unmount: () => { unmounted += 1; },
		}),
	});

	assert.equal(rendered.length, 0);
	host.open('ofx-manage');
	assert.equal(rendered.length, 1);
	host.close();
	assert.equal(rendered.at(-1), null);
	host.dispose();
	assert.equal(unmounted, 1);
	assert.equal(removed, 1);
});

test('workspace resolution is Framescaper-only and keeps blocked-state surfaces reachable', () => {
	const bridge = fakeBridge().bridge;
	assert.equal(resolveFramescaperNativeServicesWorkspaceRuntime({
		productId: 'soundscaper', bridge,
	}), null);
	const runtime = resolveFramescaperNativeServicesWorkspaceRuntime({
		productId: 'framescaper', bridge,
	});
	assert.ok(runtime);
	assert.equal(runtime.capabilitySnapshot, null);
	assert.equal(runtime.services.runtimeAvailable, false,
		'the pending projection must not claim helper availability');
});

test('workspace resolution admits only a branded candidate project-action runtime', () => {
	const actions = candidateActions();
	const runtime = resolveFramescaperNativeServicesWorkspaceRuntime({
		productId: 'framescaper', bridge: fakeBridge().bridge, projectActions: actions,
	});
	assert.deepEqual(runtime?.projectActionSurfaces, FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES);

	const forged = resolveFramescaperNativeServicesWorkspaceRuntime({
		productId: 'framescaper', bridge: fakeBridge().bridge,
		projectActions: { ...actions } as never,
	});
	assert.deepEqual(forged?.projectActionSurfaces, []);
});

test('external-display menu selection runs through the workspace error boundary', () => {
	const events: unknown[] = [];
	const runtime = {
		services: serviceSnapshot(), capabilitySnapshot: null,
		externalDisplays: [], activeExternalDisplayId: null,
		lifecycleMethods: [], projectActionSurfaces: [], open: () => undefined,
		openExternalDisplay: (displayId: string | null) => {
			events.push(['open', displayId]);
			return Promise.reject(new Error('display disappeared'));
		},
	};
	const wrapped = wrapFramescaperNativeServicesMenuRuntime(runtime as never, (operation) => {
		events.push(['run']);
		void Promise.resolve(operation()).catch((error) => events.push(['error', String(error)]));
	});
	wrapped?.openExternalDisplay('display-2');
	assert.deepEqual(events.slice(0, 2), [['run'], ['open', 'display-2']]);
});

function fakeBridge(overrides: Partial<FramescaperNativeServicesBridge> = {}) {
	const calls: unknown[][] = [];
	let state: FramescaperNativeQueueProjection['state'] = 'queued';
	const bridge: FramescaperNativeServicesBridge = {
		snapshot: () => {
			calls.push(['snapshot']);
			return Promise.resolve(serviceSnapshot(state));
		},
		control: (request) => {
			calls.push(['control', request.jobId, request.action]);
			state = request.action === 'pause' ? 'paused' : state;
			return Promise.resolve(queueRow(state));
		},
		reorder: (request) => {
			calls.push(['reorder', request.jobId, request.index]);
			return Promise.resolve([queueRow(state)]);
		},
		remove: (request) => {
			calls.push(['remove', request.jobId]);
			return Promise.resolve(true);
		},
		...overrides,
	};
	return { bridge, calls };
}

function serviceSnapshot(
	state: FramescaperNativeQueueProjection['state'] = 'queued',
): FramescaperNativeServicesProjection {
	return {
		snapshotVersion: 1 as const,
		runtimeAvailable: true,
		nativeMediaEnabled: true,
		queue: [queueRow(state)],
		roots: [{ grantId: 'ab'.repeat(16), displayName: 'Exports', revoked: false }],
		watchRules: [],
	};
}

function queueRow(
	state: FramescaperNativeQueueProjection['state'] = 'queued',
): FramescaperNativeQueueProjection {
	return {
		jobId: JOB_ID,
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

function rendererSnapshot(overrides: Readonly<{
	runtimeAvailable: boolean;
	nativeMediaEnabled: boolean;
}>): FramescaperNativeServicesRendererSnapshot {
	return {
		services: { ...serviceSnapshot(), ...overrides },
		capabilitySnapshot: null,
		preferences: DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
		controllablePreferences: [],
		externalDisplays: [],
		activeExternalDisplayId: null,
	};
}

function candidateActions() {
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
