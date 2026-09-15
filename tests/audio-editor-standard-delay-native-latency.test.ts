/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';
import { standardDelayPitchDeliveryFrames, standardDelayPitchStageLatencyFrames } from '../src/common/editor/first-party-effects/standard/delay-definition.ts';

test('pitched delay compensation matches native StaffPad float arithmetic at high sample rates', async () => {
	const runtime = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
	for (const sampleRate of [8000, 44100, 176400, 192000]) {
		const session = runtime.createSession(sampleRate, 1, false);
		try {
			for (const pitchShift of [-.21, .21, -2, 2]) {
				const params = { pitchShift };
				const delivery = standardDelayPitchDeliveryFrames(params, sampleRate);
				const native = session.latency(2 ** (pitchShift / 12));
				assert.equal(standardDelayPitchStageLatencyFrames(params, sampleRate), delivery + native,
					`${pitchShift} semitones at ${sampleRate} Hz`);
			}
		} finally { session.destroy(); }
	}
});
