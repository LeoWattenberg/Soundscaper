/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('security policy bounds owning-family-v1 JSON admission and leaves opaque custody uninterpreted', async () => {
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
		/every admitted owning-family-v1 project.*structural scan.*before `?JSON\.parse`?.*101,536 JSON values.*depth 130/iu,
	);
	assert.match(
		control.summary,
		/six additional JSON values per payload.*two additional depth levels.*round-trip closure/iu,
	);
	assert.match(
		control.summary,
		/exact owning-family v1.*current-format export.*copies.*Uint8Array.*offset-view.*ArrayBuffer.*independent lower-only ceilings.*256 payloads.*4 MiB.*8 MiB.*100,000 logical traversed nodes.*depth 128/iu,
	);
	assert.match(
		control.summary,
		/import and inspection.*closed descriptors.*unique positive IDs.*canonical base64.*complete decoded budget.*before decoded-byte allocation.*collision lookup.*storage.*never interprets or activates/iu,
	);
	assert.match(
		control.summary,
		/known foreign-family and future-version projects.*opaque.*not decoded or interpreted/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(threatModel, /1\.0 project-identity boundary.*schemaFamily:'soundscaper'.*schemaFamily:'framescaper'/isu);
	assert.match(threatModel, /other known family.*later version.*opaque read-only custody.*not semantic validation/isu);
	assert.match(threatModel, /no project migration, copy-forward, predecessor-validator dispatch/isu);
});
