/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrix = JSON.parse(
	await readFile(new URL('../config/production-security-matrix.json', import.meta.url), 'utf8'),
);
const closure = JSON.parse(
	await readFile(new URL('../config/milestone-2-closure.json', import.meta.url), 'utf8'),
);
const threatModel = await readFile(
	new URL('../docs/production-threat-model.md', import.meta.url),
	'utf8',
);
const register = matrix.publicationFaultVerification;
const item = closure.items.find(({ id }) => id === 'm2-publication-fault-matrix');

const OUTCOME_VOCABULARY = ['inapplicable', 'platform-delegated', 'unverified', 'witnessed'];
const EXPECTED_TALLY = Object.freeze({
	witnessed: 103,
	inapplicable: 9,
	'platform-delegated': 8,
	unverified: 0,
});

test('the fault register covers the exact closure path and fault cross product', () => {
	assert.ok(item, 'the closure inventory must keep the fault-matrix item');
	assert.equal(register?.status, 'implemented');
	assert.match(register.summary, /unsupported fault injection.*never silently skipped/iu);
	assert.deepEqual(Object.keys(register.outcomes).sort(), OUTCOME_VOCABULARY);
	assert.deepEqual(
		register.paths.map(({ id }) => id),
		item.publicationPathIds,
		'register paths must mirror the closure inventory exactly, in order',
	);
	for (const path of register.paths) {
		assert.deepEqual(
			Object.keys(path.faults),
			item.faultIds,
			`${path.id} must record every fault class exactly once, in inventory order`,
		);
	}
});

test('every fault cell is witnessed with real evidence or carries an explicit recorded outcome', async () => {
	const tally = { witnessed: 0, inapplicable: 0, 'platform-delegated': 0, unverified: 0 };
	for (const path of register.paths) {
		for (const [faultId, cell] of Object.entries(path.faults)) {
			const label = `${path.id}/${faultId}`;
			assert.ok(OUTCOME_VOCABULARY.includes(cell.outcome), `${label} has an unknown outcome`);
			tally[cell.outcome] += 1;
			if (cell.outcome === 'witnessed') {
				assert.ok(Array.isArray(cell.evidence) && cell.evidence.length > 0, `${label} needs evidence`);
			} else {
				assert.ok(
					typeof cell.reason === 'string' && cell.reason.length >= 20,
					`${label} needs a recorded reason`,
				);
			}
			if (cell.outcome === 'platform-delegated') {
				assert.match(cell.reason, /unsupported/u, `${label} must record why injection is unsupported`);
			}
			for (const entry of cell.evidence ?? []) {
				assert.equal(entry.kind, 'test', `${label} evidence must be automated tests`);
				await assert.doesNotReject(
					access(new URL(`../${entry.path}`, import.meta.url)),
					`${label} evidence path ${entry.path} must exist`,
				);
			}
		}
	}
	assert.deepEqual(tally, EXPECTED_TALLY, 'outcome counts may only change with a reviewed register edit');
});

test('the threat model owns the register narrative and its residuals', () => {
	assert.match(threatModel, /### Crash-safe publication fault register/u);
	assert.match(threatModel, /fifteen publication paths\ncrossed with eight fault classes, one hundred twenty cells in total/u);
	assert.match(threatModel, /An `unverified` cell\nhas no supporting evidence and is an explicit failed check, never a silent\nskip; the register currently contains none/u);
	assert.match(threatModel, /does not convert simulation limits into broader claims/u);
	assert.match(threatModel, /hard worker termination is not\ninjected/u);
	assert.match(threatModel, /abrupt process death, power loss,\nparent-directory fsync, and non-Linux packaged behavior remain\nunverified/u);
	assert.match(threatModel, /dot-prefixed orphan `\.soundscaper-part` file/u);
	assert.match(threatModel, /never replaced and the orphan is never advertised/u);
});
