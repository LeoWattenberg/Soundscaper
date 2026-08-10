/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('security policy separates all-schema JSON admission from exact-V14 binary decoding', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'scape-archive-structure-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'bounded-current-schema-opaque-binary-codec',
	);
	assert.ok(control);
	for (const path of [
		'src/common/editor/scape-project-document.ts',
		'src/common/editor/scape-project-json-preflight.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-project-document.test.ts',
		'tests/audio-editor-scape-project.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
	assert.match(
		control.summary,
		/every project schema.*structural scan.*before `?JSON\.parse`?.*101,536 JSON values.*depth 130/iu,
	);
	assert.match(
		control.summary,
		/six additional JSON values per payload.*two additional depth levels.*round-trip closure/iu,
	);
	assert.match(
		control.summary,
		/exact-schema-14.*current-format export.*copies.*Uint8Array.*offset-view.*ArrayBuffer.*independent lower-only ceilings.*256 payloads.*4 MiB.*8 MiB.*100,000 logical traversed nodes.*depth 128/iu,
	);
	assert.match(
		control.summary,
		/import and inspection.*closed descriptors.*unique positive IDs.*canonical base64.*complete decoded budget.*before decoded-byte allocation.*collision lookup.*storage.*never interprets or activates/iu,
	);
	assert.match(
		control.summary,
		/tag-shaped future state.*structurally scanned and counted.*not decoded or interpreted/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/every project schema.*structurally scanned.*before `JSON\.parse`.*101,536 JSON values.*depth 130.*six additional JSON values per payload.*two additional depth levels.*round-trip closed/isu,
	);
	assert.match(
		threatModel,
		/exact schema 14.*opaque `Uint8Array`.*offset-view.*`ArrayBuffer`.*reserved.*versioned JSON tag.*export.*independently.*256 payloads.*4 MiB.*8 MiB.*100,000 logical traversed nodes.*depth 128.*complete decoded budget/isu,
	);
	assert.match(
		threatModel,
		/before decoded-byte allocation.*collision lookup.*storage.*does not interpret or activate.*tag-shaped future state.*structurally scanned and counted.*not decoded or interpreted.*does not claim unchanged future-archive re-export/isu,
	);
});
