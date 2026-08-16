/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_DIRECT_WAV_CHILD_MARGIN_MS,
	DESKTOP_DIRECT_WAV_CHILD_TIMEOUT_MS,
	createDesktopDirectWavSmokePlan,
} from '../scripts/lib/desktop-direct-wav-smoke.mjs';
import {
	DESKTOP_DIRECT_WAV_SMOKE_STAGE_KEY,
	DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS,
	directWavRendererSmokeContract,
	runDirectWavRendererSmoke,
} from '../desktop/direct-wav-smoke.js';
import { createRendererScope } from './helpers/desktop-direct-wav-renderer-scope.js';

const TOKEN = '0123456789abcdef0123456789abcdef';

test('each direct-WAV timeout outlasts the one it supervises', async () => {
	// The budgets nest: the driver kills the child, the child's watchdog gives
	// up on the renderer, and the renderer bounds each stage. A budget that is
	// shorter than what it supervises fires first and hides the real stall,
	// which is how the packaged smoke came to report only "timed out". Every
	// stage draws its window from the routine's own table, so none of them can
	// contribute time these budgets have not counted.
	const { stageWindows } = await directWavRendererSmokeContract();
	assert.equal(Object.isFrozen(stageWindows), true);
	const windows = Object.values(stageWindows);
	assert.ok(windows.length >= 4, `expected the renderer stage windows to be declared, found ${windows.length}`);
	assert.ok(
		windows.every((stageWindow) => Number.isSafeInteger(stageWindow) && stageWindow > 0),
		'every declared stage window is a positive count of milliseconds',
	);

	const supervised = windows.reduce((total, stageWindow) => total + stageWindow, 0);
	assert.ok(
		DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS >= supervised * 1.25,
		`watchdog ${DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS}ms must exceed its ${supervised}ms of stage windows with headroom`,
	);
	assert.ok(
		DESKTOP_DIRECT_WAV_CHILD_TIMEOUT_MS > supervised,
		`driver bound ${DESKTOP_DIRECT_WAV_CHILD_TIMEOUT_MS}ms must cover its ${supervised}ms of stage windows`,
	);
});

test('the direct-WAV driver bound is the application watchdog plus its declared margin', async () => {
	// A hand-set driver bound can silently fall behind a stage window the
	// watchdog gained, so it is derived from the watchdog the stage-window table
	// already bounds rather than written out independently.
	assert.ok(
		Number.isSafeInteger(DESKTOP_DIRECT_WAV_CHILD_MARGIN_MS) && DESKTOP_DIRECT_WAV_CHILD_MARGIN_MS > 0,
		'the driver margin is a positive count of milliseconds',
	);
	assert.equal(
		DESKTOP_DIRECT_WAV_CHILD_TIMEOUT_MS,
		DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS + DESKTOP_DIRECT_WAV_CHILD_MARGIN_MS,
	);
	assert.ok(
		DESKTOP_DIRECT_WAV_CHILD_TIMEOUT_MS > DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS,
		'the driver must outlast the application watchdog so the stalled stage is reported',
	);
});

test('the direct-WAV watchdog reads the stage marker the renderer smoke writes', async () => {
	// The watchdog names the stalled stage by reading this key out of the
	// renderer, and the renderer smoke is stringified rather than imported, so
	// nothing but this test holds the two ends of that key together.
	const contract = await directWavRendererSmokeContract();
	assert.equal(Object.isFrozen(contract), true);
	assert.equal(contract.stageKey, DESKTOP_DIRECT_WAV_SMOKE_STAGE_KEY);

	const scope = createRendererScope();
	const serializedRoutine = Function(`"use strict"; return (${runDirectWavRendererSmoke.toString()});`)();
	await serializedRoutine(scope, createDesktopDirectWavSmokePlan({ token: TOKEN }));
	assert.equal(typeof scope[DESKTOP_DIRECT_WAV_SMOKE_STAGE_KEY], 'string');
	assert.ok(scope[DESKTOP_DIRECT_WAV_SMOKE_STAGE_KEY], 'the renderer publishes the stage it last waited on');
});

test('a direct-WAV stage cannot draw a window its table does not declare', async () => {
	const source = runDirectWavRendererSmoke.toString().replace("'WAV fixture')", "'WAV fixture', 90_000)");
	assert.match(source, /'WAV fixture', 90_000\)/u);
	const serializedRoutine = Function(`"use strict"; return (${source});`)();
	await assert.rejects(
		serializedRoutine(createRendererScope(), createDesktopDirectWavSmokePlan({ token: TOKEN })),
		/WAV fixture import has no declared window/iu,
	);
});
