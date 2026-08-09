/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packetDocumentUrl = new URL('../docs/milestone-3a-work-packets.md', import.meta.url);
const milestonePlanUrl = new URL('../docs/milestone-3-plan.md', import.meta.url);

const PACKETS = [
	'3A-1 — Musical timeline editing',
	'3A-2 — Markers and named regions',
	'3A-3 — Nested track folders',
	'3A-4 — Punch, count-in, and approved Audacity gaps',
	'3A-5 — Take lanes, cycle recording, comping, and recovery',
	'3A-6 — Transients, warp, quantization, and groove',
	'3A-7 — Exit evidence',
];

test('milestone 3A has bounded pickup packets with the required implementation contract', async () => {
	const document = await readFile(packetDocumentUrl, 'utf8');
	for (const packet of PACKETS) {
		const start = document.indexOf(`## ${packet}`);
		assert.notEqual(start, -1, `missing ${packet}`);
		const next = document.indexOf('\n## ', start + 1);
		const section = document.slice(start, next < 0 ? document.length : next);
		for (const field of ['Outcome', 'Invariants', 'Acceptance', 'Non-goals', 'Stop condition']) {
			assert.match(section, new RegExp(`\\*\\*${field}:\\*\\*`, 'u'), `${packet} is missing ${field}`);
		}
	}
	assert.match(document, /schema revisions are serialized/iu);
	assert.match(document, /Electron.*pending-external/isu);
	assert.match(document, /MIDI.*out of scope/isu);
});

test('the milestone 3 plan links the implementing 3A packet contract', async () => {
	const plan = await readFile(milestonePlanUrl, 'utf8');
	assert.match(plan, /docs\/milestone-3a-work-packets\.md/u);
});
