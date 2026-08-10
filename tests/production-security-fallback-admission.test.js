/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('controller fallback admission keeps its byte-integrity claim narrow and evidenced', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	assert.ok(projectDocuments);
	const fallbackAdmission = projectDocuments.currentControls.find(
		({ id }) => id === 'controller-rendered-fallback-admission',
	);
	assert.ok(fallbackAdmission);
	for (const path of [
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-audio.ts',
		'src/common/editor/project-fallback-integrity-snapshot.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage.js',
		'src/common/editor/storage/source-read-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/media-asset-digest-backfill.ts',
		'src/common/editor/storage/media-repository.ts',
			'src/common/editor/controller/project-switch-service.ts',
			'src/common/editor/controller/audio-rendered-fallback-export.ts',
			'src/common/editor/controller/video-rendered-fallback-export.ts',
			'src/common/editor/controller/video-export-service.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/session-activation.js',
		'src/common/editor/session.js',
		'src/common/editor/app.js',
		'tests/audio-editor-project-fallback-integrity.test.ts',
		'tests/audio-editor-project-fallback-integrity-relationships.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-selection.test.ts',
			'tests/audio-editor-project-fallback-integrity-audio-provider.test.ts',
			'tests/audio-editor-project-fallback-integrity-mixed-selection.test.ts',
			'tests/audio-editor-mixed-rendered-fallback-video-export.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export-service.test.ts',
		'tests/audio-editor-source-read-cancellation.test.ts',
		'tests/audio-editor-media-asset-load.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-session-project-activation.test.js',
	]) assert.ok(fallbackAdmission.evidence.some((item) => item.path === path), path);
	assert.match(
		fallbackAdmission.summary,
		/exact-schema-14.*same-ID tab history.*session-owned history token.*local bytes.*before activation side effects.*exclusive session activation reservation.*history replacement.*competing active-project publication.*session publication.*released in finally.*audio-f32le-chunks-v1.*65,536-chunk.*original-media Blob.*4 MiB.*64 GiB.*before fallback body reads/iu,
	);
	assert.match(fallbackAdmission.summary, /disable on-access retained-media digest claim.backfill.*does not publish storage maintenance/iu);
	assert.match(fallbackAdmission.summary, /read-only video-metadata.*raced against cancellation.*signal-ignoring provider.*continue after admission rejects.*provider-stalled fallback body read.*delay cancellation settlement.*iterator cleanup/iu);
	assert.match(fallbackAdmission.summary, /conflicting digests.*relationship roles.*target clip or track IDs.*before storage reads/iu);
	assert.match(fallbackAdmission.summary, /video selector.*currentness snapshot.*role.*target clip ID.*source ID.*SHA-256.*source geometry.*drift.*before media use/iu);
	assert.match(
		fallbackAdmission.summary,
		/selected role-defined audio whole-mix delivery.*operation-time full-source verification.*bounded per-chunk digest table.*private provider.*currentness.*geometry.*digest.*each requested stored chunk.*activation admission remains point-in-time.*operation-scoped per-read validation.*selected video delivery.*immutable Blob.*none establishes.*durable storage-record lease.*cross-process immutability/iu,
	);
	assert.match(
		fallbackAdmission.summary,
		/joint final-video admission.*one audio.*one video selector.*cumulative.*64 GiB.*before.*body reads.*audio.*before.*video.*private provider.*exact immutable Blob.*both selector identities.*currentness/iu,
	);
	assert.match(
		fallbackAdmission.summary,
		/direct store\.loadProject.*publisher authenticity.*relationship roles beyond the closed audio and maintained video roles.*simultaneous.*beyond.*one-audio.one-video.*linked-only.*unmanaged.*discover, load, or execute third-party feature code.*future schemas.*placeholder.*bypass.*third-party activation gating/iu,
	);
});
