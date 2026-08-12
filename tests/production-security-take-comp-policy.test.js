/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('take/comp security truth binds native Soundscaper to read-only Framescaper preservation', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'take-comp-native-and-cross-product-preservation',
	);
	assert.notEqual(control, undefined);
	assert.match(
		control.summary,
		/schema 17 take groups.*mandatory closed canonical records.*sequence and audio-track ownership.*audio-source bounds.*canonical lane, take, region, and group ordering.*4,096.*160-character.*nonoverlap/iu,
	);
	assert.match(
		control.summary,
		/`soundscaper\.take-comp`.*`org\.soundscaper\.capability\.take-comp`.*`bypass`.*no fallback.*refuses publisher substitution.*excluded from audio and video rendered-fallback/iu,
	);
	assert.match(
		control.summary,
		/Soundscaper.*true.*available\/native.*writable.*typed domain.*group add, update, remove, and flatten.*exact lane and take audition.*range promotion.*boundary editing.*stale-safe exact flatten publication.*Tracks-menu dialog/iu,
	);
	assert.match(
		control.summary,
		/Framescaper.*false but known.*unavailable\/bypassed.*intrinsically read-only.*no take\/comp menu/iu,
	);
	assert.match(
		control.summary,
		/clipboard V4.*take-owned source roots.*independently identified graph.*current-format `\.scape` collision copy.*production-recovered cycle output.*only logical roots.*exact PCM.*source and storage identities.*take source IDs?.*recipient collisions untouched.*reopens.*fresh-recipient desktop handoff.*production-finalized cycle output.*managed PCM.*no missing sources/iu,
	);
	assert.match(
		control.summary,
		/routed cycle capture.*durability.*explicit open recovery.*bounded-resource truth.*dedicated `durable-routed-take-cycle-capture-and-recovery` control/iu,
	);

	const evidencePaths = new Set(control.evidence.map(({ path }) => path));
	for (const path of [
		'src/common/editor/take-comp-domain.ts',
		'src/common/editor/commands/take-comp-runtime.ts',
		'src/common/editor/commands/take-comp-clipboard.ts',
		'src/common/editor/controller/take-comp-flatten-service.ts',
		'src/common/editor/ui/dialogs/TakeCompDialog.tsx',
		'src/common/editor/scape-project.js',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'tests/audio-editor-take-comp-composition.test.ts',
		'tests/audio-editor-take-comp-clipboard.test.ts',
		'tests/browser/audio-editor-take-comp.spec.js',
		'tests/helpers/cycle-produced-take-fixture.ts',
		'tests/audio-editor-cycle-produced-take-fixture.test.ts',
		'tests/audio-editor-scape-take-comp-roundtrip.test.ts',
		'tests/desktop-project-library-take-comp-handoff.test.ts',
	]) assert.equal(evidencePaths.has(path), true, path);

	const threatModel = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(threatModel, /policy-narrative:take-comp-native-and-cross-product-preservation/iu);
	assert.match(threatModel, /Soundscaper.*available\/native.*Framescaper.*unavailable\/bypassed.*intrinsically read-only/iu);
	assert.match(threatModel, /current-format `\.scape` collision copy.*production-recovered cycle output.*fresh-recipient desktop handoff.*production-finalized cycle output.*durable-routed-take-cycle-capture-and-recovery/iu);
});
