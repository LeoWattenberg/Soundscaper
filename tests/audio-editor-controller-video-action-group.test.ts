/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createGroupedEditorActions } from '../src/common/editor/controller/action-facade.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

/**
 * The facade's `video` group, which is capability-gated end to end.
 *
 * Soundscaper composes the same facade as Framescaper but declares no video compositing,
 * so every entry in this group must refuse rather than reach a service that is not there —
 * and the transport must not consult one either, which is the case an ordinary play would
 * otherwise get wrong.
 */

test('Framescaper video navigation actions share one capability-gated service', () => {
	const calls: string[] = [];
	const statuses: string[] = [];
	const view = (rate: number, positionFrame: number) => ({ rate, positionFrame, sequenceId: 'main' });
	const service = {
		view: () => { calls.push('view'); return view(0, 0); },
		shuttleReverse: () => { calls.push('reverse'); return view(-1, 10); },
		shuttleStop: () => { calls.push('stop'); return view(0, 10); },
		shuttleForward: () => { calls.push('forward'); return view(1, 20); },
		previousEditPoint: () => { calls.push('previous'); return 10; },
		nextEditPoint: () => { calls.push('next'); return 20; },
	};
	const runtime = new Proxy(createActionFacadeRuntime(), {
		get(target, name, receiver) {
			if (name === 'videoNavigationService') return service;
			if (name === 'sequenceTimingService') return {
				label: (frame: unknown) => `TC-${String(frame)}`,
				playheadLabel: () => 'TC-playhead',
			};
			if (name === 'setStatus') return (message: unknown) => statuses.push(String(message));
			if (name === 'copy') return {
				shuttleBackward: 'Reverse shuttle', shuttleForward: 'Forward shuttle',
				shuttleStatus: '{direction} {rate}× at {timecode}',
				shuttleStoppedStatus: 'Shuttle stopped at {timecode}',
				previousEditStatus: 'Previous edit at {timecode}', nextEditStatus: 'Next edit at {timecode}',
				noPreviousEdit: 'No previous edit point', noNextEdit: 'No next edit point',
			};
			return Reflect.get(target, name, receiver);
		},
	});
	const navigation = createGroupedEditorActions(runtime).video.navigation;
	if (typeof navigation !== 'object' || navigation === null) {
		throw new TypeError('The video navigation action group is unavailable.');
	}
	for (const name of ['view', 'shuttleBackward', 'shuttleStop', 'shuttleForward', 'previousEdit', 'nextEdit']) {
		const action = navigation[name];
		if (typeof action !== 'function') throw new TypeError(`Missing video navigation action: ${name}.`);
		action();
	}
	assert.deepEqual(calls, ['view', 'reverse', 'stop', 'forward', 'previous', 'next']);
	assert.deepEqual(statuses, [
		'Reverse shuttle 1× at TC-10',
		'Shuttle stopped at TC-10',
		'Forward shuttle 1× at TC-20',
		'Previous edit at TC-playhead',
		'Next edit at TC-playhead',
	]);
	assert.equal(Object.isFrozen(navigation), true);

	const unavailable = createGroupedEditorActions(new Proxy(runtime, {
		get(target, name, receiver) {
			if (name === 'capabilities') return { videoCompositing: false };
			return Reflect.get(target, name, receiver);
		},
	})).video.navigation;
	const unavailableForward = typeof unavailable === 'object' && unavailable !== null
		? unavailable.shuttleForward
		: null;
	if (typeof unavailableForward !== 'function') {
		throw new TypeError('The guarded video navigation action is unavailable.');
	}
	assert.throws(() => unavailableForward(), /does not support videoCompositing/u);
});

test('ordinary transport retires Framescaper shuttle without touching Soundscaper projects', () => {
	const run = (videoCompositing: boolean) => {
		const calls: string[] = [];
		const runtime = new Proxy(createActionFacadeRuntime(), {
			get(target, name, receiver) {
				if (name === 'capabilities') return { videoCompositing };
				if (name === 'videoNavigationService') return { shuttleStop: () => calls.push('shuttle-stop') };
				if (name === 'handleTransport') return () => calls.push('play');
				return Reflect.get(target, name, receiver);
			},
		});
		const playPause = createGroupedEditorActions(runtime).transport.playPause;
		if (typeof playPause !== 'function') throw new TypeError('The play action is unavailable.');
		playPause();
		return calls;
	};
	assert.deepEqual(run(true), ['shuttle-stop', 'play']);
	assert.deepEqual(run(false), ['play']);
});

test('controller action facade exposes source-level video visual ownership', async () => {
	const expected = Object.freeze({ mediaUrl: 'blob:fallback-video' });
	const releases: unknown[][] = [];
	const base = createActionFacadeRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'getVideoSourceVisualData') return (sourceId: unknown) => {
				assert.equal(sourceId, 'fallback-video');
				return expected;
			};
			if (name === 'releaseVideoSourceVisual') return (...args: unknown[]) => {
				releases.push(args);
				return true;
			};
			return Reflect.get(target, name, receiver);
		},
	});
	const actions = createGroupedEditorActions(runtime);
	const getSourceVisualData = actions.video.getSourceVisualData;
	if (typeof getSourceVisualData !== 'function') throw new TypeError('Video source lookup must be callable.');
	assert.strictEqual(getSourceVisualData('fallback-video'), expected);
	const releaseSourceVisual = actions.video.releaseSourceVisual;
	if (typeof releaseSourceVisual !== 'function') throw new TypeError('Video source release must be callable.');
	assert.equal(await releaseSourceVisual('fallback-video', 'blob:fallback-video'), true);
	assert.deepEqual(releases, [['fallback-video', 'blob:fallback-video']]);
});
