/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('security policy scopes the bounded Scape binary codec to the current schema', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'scape-archive-structure-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'bounded-current-schema-opaque-binary-codec',
	);
	assert.ok(control);
	for (const path of [
		'src/common/editor/scape-project-document.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-project-document.test.ts',
		'tests/audio-editor-scape-project.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
	assert.match(
		control.summary,
		/exact-schema-9.*current-format.*copies.*Uint8Array.*offset-view.*ArrayBuffer.*256 payloads.*4 MiB.*8 MiB.*100,000.*depth 128/iu,
	);
	assert.match(
		control.summary,
		/import and inspection.*closed descriptors.*unique positive IDs.*canonical base64.*before decoded-byte allocation.*collision lookup.*storage.*never interprets or activates.*other project schemas.*ordinary JSON.*not traversed/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/exact schema 9.*opaque `Uint8Array`.*offset-view.*`ArrayBuffer`.*reserved.*versioned JSON tag.*256 payloads.*4 MiB.*8 MiB.*100,000.*depth 128/isu,
	);
	assert.match(
		threatModel,
		/before decoded-byte allocation.*collision lookup.*storage.*does not interpret or activate.*future state is not traversed.*does not claim unchanged future-archive re-export/isu,
	);
});
