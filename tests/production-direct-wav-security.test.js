/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

test('direct WAV security controls stay limited to the exact maintained route', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const exactDirectWav = findControl(matrix, 'desktop-write-path-capabilities', 'exact-direct-wav-mix-save');
	const directWavRollback = findControl(matrix, 'long-job-cancellation', 'direct-wav-mix-save-rollback');

	for (const path of [
		'desktop/validation.js',
		'src/common/editor/controller/direct-wav-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/file-save-stream.ts',
		'src/common/editor/pcm-sink.js',
		'tests/audio-editor-export-direct-wav.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/audio-editor-pcm-sink.test.js',
		'tests/desktop-pcm-mix-save-purpose.test.js',
	]) assert.ok(exactDirectWav.evidence.some((item) => item.path === path), path);
	assert.match(
		exactDirectWav.summary,
		/dedicated `audio-pcm-mix` purpose.*one plain-WAV mix.*`realtime-stream`.*65 GiB.*exact-size.*not maximum-bounded.*File System Access or Electron.*encoder-emission retention.*one destination write at a time.*64-packet PCM queue.*planned.*encoder-finalized.*destination-written.*committed-result.*four-way.*no final renderer `Blob`.*BWF.*BW64.*AIFF.*compressed.*video.*stems.*outside.*browser workflow acceptance.*not qualified/iu,
	);

	for (const path of [
		'src/common/editor/controller/direct-wav-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/file-save-stream.ts',
		'src/common/editor/pcm-sink.js',
		'tests/audio-editor-export-direct-wav.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/audio-editor-pcm-sink.test.js',
	]) assert.ok(directWavRollback.evidence.some((item) => item.path === path), path);
	assert.match(
		directWavRollback.summary,
		/target before rendering.*owned export task signal.*awaits each destination write.*64-packet PCM queue.*failure or cancellation before commit.*abort.*staging cleanup.*planned.*encoder-finalized.*destination-written.*before.*non-cancellable commit.*ownership.*lost during commit.*committed result.*stale success UI.*post-publication integrity failure.*not.*rollback.*browser workflow acceptance.*not qualified/iu,
	);
});

test('direct WAV documentation records byte, buffering, rollback, and acceptance limits', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(
		documentation,
		/one plain-WAV mix.*`realtime-stream`.*65 GiB.*direct File System Access or Electron.*encoder-emission retention.*one destination write at a time.*64-packet.*planned.*encoder-finalized.*destination-written.*committed-result.*four-way.*without a final renderer `Blob`.*BWF.*BW64.*AIFF.*compressed audio.*video.*stems.*remain.*existing paths.*non-cancellable commit boundary.*ownership.*lost during commit.*committed result.*stale success UI.*post-publication integrity failure.*not.*rollback.*browser workflow acceptance.*not yet qualified/isu,
	);

	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(
		roadmap,
		/Web Enhanced \/ Electron Enhanced — In progress:.*one mix.*format `wav`.*`realtime-stream`.*65 GiB.*File System Access or Electron.*exact-size writing/isu,
	);
	assert.match(
		roadmap,
		/adapter.*encoder-emission retention.*one destination write at a time.*64-packet PCM queue.*planned.*encoder-finalized.*destination-written.*committed-result.*four-way\s+agreement/isu,
	);
	assert.match(
		roadmap,
		/non-cancellable commit boundary.*ownership lost during commit.*committed result.*stale\s+success UI.*post-publication integrity\s+failure.*not rollback/isu,
	);
	assert.match(
		roadmap,
		/direct route.*without a final\s+renderer-sized `Blob`.*other PCM.*compressed.*audio.*video.*stems.*browser-download.*existing final.*`Blob`.*focused Node evidence.*browser workflow.*not yet qualified/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, `${riskId}/${controlId}`);
	return control;
}
