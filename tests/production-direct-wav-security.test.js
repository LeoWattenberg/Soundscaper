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
	const controllerIoBoundary = matrix.boundaries.find(({ id }) => id === 'controller-task-to-io');
	assert.ok(controllerIoBoundary, 'controller-task-to-io');

	for (const path of [
		'desktop/validation.js',
		'src/common/editor/controller/direct-wav-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/file-save-stream.ts',
		'src/common/editor/pcm-sink.js',
		'tests/audio-editor-export-direct-wav.test.ts',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/audio-editor-pcm-sink.test.js',
		'tests/desktop-pcm-mix-save-purpose.test.js',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
	]) assert.ok(exactDirectWav.evidence.some((item) => item.path === path), path);
	assert.ok(
		controllerIoBoundary.evidence.some((item) => item.path === 'tests/browser/audio-editor-direct-wav-save.spec.js'),
		'controller-task-to-io browser evidence',
	);
	assert.ok(
		controllerIoBoundary.evidence.some((item) => item.path === 'tests/audio-editor-export-direct-wav-reference.test.ts'),
		'controller-task-to-io threshold-scale evidence',
	);
	assert.match(
		exactDirectWav.summary,
		/dedicated `audio-pcm-mix` purpose.*one plain-WAV mix.*`realtime-stream`.*65 GiB.*exact-size.*not maximum-bounded.*File System Access or Electron.*encoder-emission retention.*one destination write at a time.*64-packet PCM queue.*planned.*encoder-finalized.*destination-written.*committed-result.*four-way.*no final renderer `Blob`.*BWF.*BW64.*AIFF.*compressed.*video.*stems.*outside/iu,
	);
	assert.match(
		exactDirectWav.summary,
		/Chromium and Firefox.*injected File System Access target.*mobile planner profile.*valid RIFF.*no Object URL.*native picker.*65 GiB.*reference-scale.*packaged Electron.*not qualified/iu,
	);
	assert.match(
		exactDirectWav.summary,
		/385 MiB.*403,701,804-byte RIFF.*SHA-256.*planner.*controller.*64-packet.*resampler.*WAV encoder.*34,603,352-byte.*64 MiB.*zero.*payload\s+retention.*first\s+PCM\s+packet.*renderer heap.*process RSS.*not qualified/iu,
	);

	for (const path of [
		'src/common/editor/controller/direct-wav-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/file-save-stream.ts',
		'src/common/editor/pcm-sink.js',
		'tests/audio-editor-export-direct-wav.test.ts',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/audio-editor-pcm-sink.test.js',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
	]) assert.ok(directWavRollback.evidence.some((item) => item.path === path), path);
	assert.match(
		directWavRollback.summary,
		/target before rendering.*owned export task signal.*awaits each destination write.*64-packet PCM queue.*failure or cancellation before commit.*abort.*staging cleanup.*planned.*encoder-finalized.*destination-written.*before.*non-cancellable commit.*ownership.*lost during commit.*committed result.*stale success UI.*post-publication integrity failure.*not.*rollback/iu,
	);
	assert.match(
		directWavRollback.summary,
		/Chromium and Firefox.*after PCM.*one abort.*no close.*commit-race.*Node-only/iu,
	);
	assert.match(
		directWavRollback.summary,
		/385 MiB.*first\s+PCM\s+packet.*abort.*without close or commit.*partial.*publication/iu,
	);
});

test('direct WAV documentation records byte, buffering, rollback, and acceptance limits', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(
		documentation,
		/one plain-WAV mix.*`realtime-stream`.*65 GiB.*direct File System Access or Electron.*encoder-emission retention.*one destination write at a time.*64-packet.*planned.*encoder-finalized.*destination-written.*committed-result.*four-way.*without a final renderer `Blob`.*BWF.*BW64.*AIFF.*compressed audio.*video.*stems.*remain.*existing paths.*non-cancellable commit boundary.*ownership.*lost during commit.*committed result.*stale success UI.*post-publication integrity failure.*not.*rollback/isu,
	);
	assert.match(
		documentation,
		/Chromium and Firefox.*injected File System Access target.*mobile\s+planner profile.*valid RIFF.*no Object URL.*after\s+PCM.*abort.*without close.*native picker.*65 GiB.*reference-scale.*commit-race.*Node-only.*packaged Electron.*not qualified/isu,
	);
	assert.match(
		documentation,
		/385 MiB.*403,701,804-byte RIFF.*SHA-256.*planner.*controller.*64-packet.*resampler.*WAV.*34,603,352-byte.*64 MiB.*zero.*payload\s+retention.*first\s+PCM\s+packet.*renderer heap.*process RSS.*unqualified/isu,
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
		/direct route.*without a final\s+renderer-sized `Blob`.*other PCM.*compressed.*audio.*video.*stems.*browser-download.*existing final.*`Blob`/isu,
	);
	assert.match(
		roadmap,
		/Chromium and Firefox.*injected File System Access target.*mobile\s+planner profile.*valid RIFF.*no Object URL.*after\s+PCM.*abort.*without close.*native picker.*65 GiB.*reference-scale.*commit-race.*Node-only.*packaged Electron.*not qualified/isu,
	);
	assert.match(
		roadmap,
		/385 MiB.*403,701,804-byte RIFF.*SHA-256.*64-packet PCM queue.*34,603,352-byte.*64 MiB.*zero.*payload\s+retention.*first\s+PCM\s+packet.*renderer heap.*process RSS.*unqualified/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, `${riskId}/${controlId}`);
	return control;
}
