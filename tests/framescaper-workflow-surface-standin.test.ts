/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	canonicalParameterAddressKey,
	type ParameterAddress,
} from '../src/common/editor/parameter-address.ts';
import type {
	ParameterAutomationControlRouterV21,
} from '../src/common/editor/parameter-automation-control-router-v21.ts';
import {
	beginParameterAutomationGestureV21 as beginLiveGesture,
	parameterAutomationCaptureAvailableV21 as liveCaptureAvailable,
	releaseParameterAutomationGestureV21 as releaseLiveGesture,
	type ParameterAutomationGestureContextV21,
	type ParameterAutomationGestureSessionV21,
} from '../src/common/editor/parameter-automation-gesture-adapter-v21.ts';
import type {
	TrackAutomationMode,
	TrackAutomationRuntime,
} from '../src/common/editor/track-automation-runtime.ts';
import type {
	TrackAutomationTargetV21,
} from '../src/common/editor/track-automation-targets-v21.ts';
import * as standIn from '../src/framescaper/editor-soundscaper-workflow-product-runtime.tsx';

const {
	TrackAutomationCurveMenu,
	TrackAutomationOverlay,
	TrackAutomationRuntimeProvider,
	TrackAutomationSelectors,
	beginParameterAutomationGestureV21,
	cancelParameterAutomationGestureV21,
	createParameterAutomationControlRouterV21,
	createSoundscaperWorkflowApplicationMenuItems,
	parameterAutomationCaptureAvailableV21,
	previewParameterAutomationGestureV21,
	releaseParameterAutomationGestureV21,
	resolveSoundscaperMasteringSequenceCopy,
	resolveSoundscaperRoutingGraphCopy,
	resolveTrackAutomationCopy,
	useSoundscaperWorkflowWorkspace,
	useTrackAutomationControls,
	useTrackAutomationRuntime,
} = standIn;

const STAND_IN_SOURCE = source('../src/framescaper/editor-soundscaper-workflow-product-runtime.tsx');
const SOUNDSCAPER_SOURCE = source('../src/common/editor/ui/soundscaper-workflow-product-runtime.tsx');

const LANE_ID = 'lane-1';
const ADDRESS: ParameterAddress = {
	kind: 'strip',
	strip: { kind: 'track', id: 'track-1' },
	parameterId: 'gain',
};

interface RecordedCall {
	readonly method: string;
	readonly args: readonly unknown[];
}

/** A runtime the real adapter accepts, so "the stub refuses" is a real refusal. */
function recordingRuntime(calls: RecordedCall[], mode: TrackAutomationMode): TrackAutomationRuntime {
	return {
		snapshot: { mode, laneId: LANE_ID, gestureActive: false },
		setMode(...args) { calls.push({ method: 'setMode', args }); },
		beginGesture(...args) { calls.push({ method: 'beginGesture', args }); return 'token-1'; },
		previewGesture(...args) { calls.push({ method: 'previewGesture', args }); return 'previewed'; },
		releaseGesture(...args) { calls.push({ method: 'releaseGesture', args }); return 'released'; },
		cancelGesture(...args) { calls.push({ method: 'cancelGesture', args }); return 'cancelled'; },
	};
}

function liveContext(runtime: TrackAutomationRuntime): ParameterAutomationGestureContextV21 {
	return {
		runtime,
		target: {
			key: canonicalParameterAddressKey(ADDRESS),
			address: ADDRESS,
			lane: { id: LANE_ID },
		} as unknown as TrackAutomationTargetV21,
		address: ADDRESS,
	};
}

function source(relativePath: string): string {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function reExportedNames(moduleSource: string): readonly string[] {
	const names: string[] = [];
	for (const match of moduleSource.matchAll(/export\s*\{([^}]*)\}\s*from/gu)) {
		for (const clause of match[1].split(',')) {
			const name = clause.trim().split(/\s+as\s+/u).pop()?.trim();
			if (name) names.push(name);
		}
	}
	return names.sort();
}

test('the framescaper stand-in exports exactly the names the soundscaper workflow runtime re-exports', () => {
	const soundscaperNames = reExportedNames(SOUNDSCAPER_SOURCE);

	assert.equal(soundscaperNames.length, 17);
	assert.deepEqual(Object.keys(standIn).sort(), soundscaperNames);
});

test('the stand-in pulls no soundscaper workflow code or stylesheet into the framescaper bundle', () => {
	const valueImports = STAND_IN_SOURCE.split('\n').filter((line) => /^import\s+(?!type\b)/u.test(line));

	assert.deepEqual(valueImports, []);
	assert.equal(STAND_IN_SOURCE.includes('.css'), false);
	// The surface it replaces is exactly what must not reach Framescaper.
	assert.equal(SOUNDSCAPER_SOURCE.includes('08a-timeline-automation.css'), true);
});

test('the automation runtime provider returns its children unchanged and never reads the runtime', () => {
	const children = Object.freeze({ marker: 'children' });
	const render = TrackAutomationRuntimeProvider as unknown as (
		props: Readonly<{ runtime?: unknown; children: unknown }>,
	) => unknown;
	const hostileRuntime = new Proxy({}, {
		get(_target, property) {
			throw new Error(`The stand-in read ${String(property)} from the runtime.`);
		},
	});

	assert.equal(render({ runtime: hostileRuntime, children }), children);
	assert.equal(render({ children: null }), null);
	const siblings = [children, children];
	assert.equal(render({ runtime: null, children: siblings }), siblings);
});

test('the automation runtime hook reports no live automation runtime to any consumer', () => {
	assert.equal(useTrackAutomationRuntime(), null);
	assert.equal(useTrackAutomationRuntime(), null);
});

test('the workflow workspace hook returns no runtime and never reaches into the controller', () => {
	const surfaces: string[] = [];
	const controller = {
		get actions(): never {
			throw new Error('The stand-in read the workflow controller actions.');
		},
	};

	const workspace = useSoundscaperWorkflowWorkspace({
		productId: 'soundscaper',
		controller,
		project: { id: 'project-1', tracks: [{ id: 'track-1', type: 'audio' }] },
		selectedTrackId: 'track-1',
		openSurface(surface: string) { surfaces.push(surface); },
	});

	assert.equal(workspace, null);
	assert.deepEqual(surfaces, []);
});

test('the automation controls model is empty for a project whose tracks would otherwise carry targets', () => {
	const calls: RecordedCall[] = [];
	const runtime = recordingRuntime(calls, 'write');
	const project = {
		id: 'project-1',
		tracks: [{ id: 'track-1', type: 'audio' }, { id: 'track-2', type: 'audio' }],
		automationLanes: [{ id: LANE_ID, address: ADDRESS }],
	};

	const model = useTrackAutomationControls(project, true, runtime);

	assert.equal(model.visibleTrackIds.size, 0);
	assert.equal(model.targetsByTrackId.size, 0);
	assert.equal(model.selectedTargetByTrackId.size, 0);
	// The live runtime is never driven back to read mode, because nothing renders.
	assert.deepEqual(calls, []);
});

test('the automation controls model reports every track hidden and its mutators change nothing', () => {
	const model = useTrackAutomationControls({ id: 'project-1' }, true, null);

	assert.equal(model.isVisible('track-1'), false);
	assert.equal(model.toggle('track-1'), undefined);
	assert.equal(model.selectTarget('track-1', 'target-key'), undefined);
	assert.equal(model.isVisible('track-1'), false);
	assert.equal(model.visibleTrackIds.size, 0);
	assert.equal(model.targetsByTrackId.get('track-1'), undefined);
});

test('the automation controls model is frozen and is the same object on every render', () => {
	const first = useTrackAutomationControls(null, false, null);
	const second = useTrackAutomationControls({ id: 'other' }, true, recordingRuntime([], 'latch'));

	assert.equal(first, second);
	assert.equal(Object.isFrozen(first), true);
	assert.throws(() => {
		(first as { visibleTrackIds: unknown }).visibleTrackIds = new Set(['track-1']);
	}, TypeError);
});

test('the timeline automation components render nothing for any props', () => {
	const components = [TrackAutomationCurveMenu, TrackAutomationOverlay, TrackAutomationSelectors];

	for (const component of components) {
		const render = component as unknown as (props?: unknown) => unknown;
		assert.equal(render({ copy: {}, target: null, onSelect: () => undefined }), null);
		assert.equal(render(undefined), null);
	}
});

test('the automation copy catalog carries only the add-automation label, in english for every locale', () => {
	const english = resolveTrackAutomationCopy('en-GB');

	assert.deepEqual(english, { addAutomation: 'Add automation' });
	assert.deepEqual(resolveTrackAutomationCopy('de-DE'), english);
	assert.deepEqual(resolveTrackAutomationCopy(null), english);
	assert.deepEqual(resolveTrackAutomationCopy(undefined), english);
	assert.equal(english.automationMode, undefined);
});

test('the workflow application menu is empty in every group, even for the soundscaper product id', () => {
	const calls: string[] = [];
	const menu = createSoundscaperWorkflowApplicationMenuItems({
		productId: 'soundscaper',
		capabilities: { audioTrackFreeze: {}, masteringSequences: {} },
		project: { id: 'project-1', tracks: [{ id: 'track-1', type: 'audio' }] },
		selectedTrackId: 'track-1',
		freezeStatus: 'fresh',
		freezeActionsAvailable: true,
		editingBlocked: false,
	}, {
		openMasteringSequences() { calls.push('openMasteringSequences'); },
		freeze(operation, trackId) { calls.push(`${operation}:${trackId}`); },
	});

	assert.deepEqual(menu, { tracks: [], mixer: [], effect: [], analyze: [], tools: [] });
	assert.deepEqual(calls, []);
});

test('the workflow application menu is one frozen instance whose groups cannot be appended to', () => {
	const actions = {
		openMasteringSequences() { return undefined; },
		freeze() { return undefined; },
	};
	const input = {
		productId: 'framescaper',
		capabilities: {},
		project: null,
		editingBlocked: true,
		readOnly: true,
	};

	const first = createSoundscaperWorkflowApplicationMenuItems(input, actions);
	const second = createSoundscaperWorkflowApplicationMenuItems({
		...input,
		productId: 'soundscaper',
		editingBlocked: false,
	}, actions);

	assert.equal(first, second);
	assert.equal(Object.isFrozen(first), true);
	assert.throws(() => { (first.tools as unknown as unknown[]).push('item'); }, TypeError);
});

test('the mastering sequence copy catalog is empty even when the host supplies overrides', () => {
	const copy = resolveSoundscaperMasteringSequenceCopy({
		close: 'Schliessen',
		masteringSequences: 'Mastering-Sequenzen…',
	});

	assert.deepEqual(copy, {});
	assert.equal(copy.close, undefined);
	assert.deepEqual(resolveSoundscaperMasteringSequenceCopy(), {});
});

test('the routing graph copy carries only the two labels the mixer button renders', () => {
	const copy = resolveSoundscaperRoutingGraphCopy();

	assert.deepEqual(copy, { routing: 'Routing graph', channelStrips: 'Channel strips' });
	assert.equal(copy.zoomIn, undefined);
	assert.deepEqual(resolveSoundscaperRoutingGraphCopy({}), copy);
});

test('host overrides replace the two routing labels the stand-in keeps and unknown keys are dropped', () => {
	const copy = resolveSoundscaperRoutingGraphCopy({
		routing: 'Signalweg',
		channelStrips: 'Kanalzüge',
		zoomIn: 'Vergrössern',
	});

	assert.deepEqual(copy, { routing: 'Signalweg', channelStrips: 'Kanalzüge' });
});

test('an empty routing label override falls back to the shipped label', () => {
	const copy = resolveSoundscaperRoutingGraphCopy({ routing: '', channelStrips: undefined });

	assert.deepEqual(copy, { routing: 'Routing graph', channelStrips: 'Channel strips' });
});

test('the parameter automation router refuses every control event and never owns an address', () => {
	const router = createParameterAutomationControlRouterV21();

	assert.equal(router.captureAvailable(ADDRESS), false);
	assert.equal(router.begin(ADDRESS, 0.5), false);
	assert.equal(router.owns(ADDRESS), false);
	assert.equal(router.preview(ADDRESS, 0.75), false);
	assert.equal(router.release(ADDRESS, 1), false);
	assert.equal(router.release(ADDRESS), false);
	assert.equal(router.cancel(ADDRESS), false);
	assert.equal(router.cancel(), false);
	assert.equal(router.performAtomic(ADDRESS, 0.25), false);
});

test('the router ignores the context it is handed and gives every control surface the same frozen instance', () => {
	const create = createParameterAutomationControlRouterV21 as unknown as (
		context?: unknown,
	) => ParameterAutomationControlRouterV21;
	const hostileContext = new Proxy({}, {
		get(_target, property) {
			throw new Error(`The stand-in read ${String(property)} from the router context.`);
		},
	});

	const router = create(hostileContext);
	assert.equal(router.setContext(hostileContext as never), undefined);
	assert.equal(router.captureAvailable(ADDRESS), false);
	assert.equal(router, create());
	assert.equal(Object.isFrozen(router), true);
	assert.throws(() => { (router as { owns: unknown }).owns = () => true; }, TypeError);
});

test('automation capture is unavailable even for a context the real adapter accepts', () => {
	const context = liveContext(recordingRuntime([], 'write'));

	assert.equal(liveCaptureAvailable(context), true);
	assert.equal(parameterAutomationCaptureAvailableV21(context), false);
	assert.equal(parameterAutomationCaptureAvailableV21({ address: ADDRESS }), false);
});

test('beginning a gesture yields no session and never asks the runtime for a token', () => {
	const calls: RecordedCall[] = [];
	const context = liveContext(recordingRuntime(calls, 'touch'));

	assert.equal(beginParameterAutomationGestureV21(context, 0.5), null);
	assert.equal(beginParameterAutomationGestureV21(context, Number.NaN), null);
	assert.deepEqual(calls, []);
});

test('preview, release and cancel stay silent instead of dereferencing the session runtime', () => {
	const session = {
		type: 'parameter-automation-gesture-session-v21' as const,
		addressKey: canonicalParameterAddressKey(ADDRESS),
		laneId: LANE_ID,
		token: 'token-1',
		get runtime(): never {
			throw new Error('The stand-in dereferenced the gesture session runtime.');
		},
	} as unknown as ParameterAutomationGestureSessionV21;

	assert.equal(previewParameterAutomationGestureV21(session, 0.5), undefined);
	assert.equal(releaseParameterAutomationGestureV21(session, 0.5), undefined);
	assert.equal(releaseParameterAutomationGestureV21(session), undefined);
	assert.equal(cancelParameterAutomationGestureV21(session), undefined);
});

test('a finished session the real adapter refuses is still accepted silently by the stand-in', () => {
	const calls: RecordedCall[] = [];
	const runtime = recordingRuntime(calls, 'write');
	const session = beginLiveGesture(liveContext(runtime), 0.25);
	assert.ok(session);

	assert.equal(releaseLiveGesture(session, 0.5), 'released');
	assert.throws(() => releaseLiveGesture(session, 0.5), RangeError);
	const settled = calls.length;

	assert.equal(previewParameterAutomationGestureV21(session, 0.75), undefined);
	assert.equal(releaseParameterAutomationGestureV21(session, 0.75), undefined);
	assert.equal(cancelParameterAutomationGestureV21(session), undefined);
	assert.equal(calls.length, settled);
});
