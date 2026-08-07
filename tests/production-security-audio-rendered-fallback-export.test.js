/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('role-defined audio rendered-fallback export stays private and narrowly qualified', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'audio-whole-mix-rendered-fallback-export',
	);
	assert.ok(control);
	assert.equal(
		projectDocuments?.currentControls.some(
			({ id }) => id === 'first-party-audio-effects-rendered-fallback-export',
		),
		false,
	);

	for (const path of [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-audio-rendered-fallback.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-audio.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/project-admin-service.ts',
		'src/common/editor/controller/audio-rendered-fallback-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/app.js',
		'tests/audio-editor-audio-rendered-fallback-delivery-projection.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export-service.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-selection.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-provider.test.ts',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/desktop-project-library-audio-rendered-fallback-handoff.test.ts',
		'tests/production-security-audio-rendered-fallback-export.test.js',
	]) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
		assert.ok(control.evidence.some((item) => item.path === path), path);
	}

	assert.match(
		control.summary,
		/exact schema 9.*canonical namespaced feature ID.*unavailable or unknown.*declared and effective rendered-fallback.*closed project-audio-mix-v1 role.*canonical manifest.*only.*standalone final audio mix delivery/iu,
	);
	assert.match(control.summary, /standalone.*simultaneous rendered fallback.*reject.*separate.*final-video.*one-audio.one-video/iu);
	assert.match(control.summary, /role supplies.*media semantics.*feature ID.*opaque identity.*does not discover, load, or execute.*feature code/iu);
	assert.match(
		control.summary,
		/selector.mode.*requirement ID.*feature ID.*audio kind.*source ID.*SHA-256.*only.*selected.*PCM.*unrelated.*fallback.*not read/iu,
	);
	assert.match(
		control.summary,
		/full canonical audio-f32le-chunks-v1.*65,536.*64 GiB.*32(?: bytes|-bytes)-per-chunk digest table.*2 MiB/iu,
	);
	assert.match(
		control.summary,
		/private provider.*each requested stored chunk.*migration disabled.*copies.*Float32Array.*index.*frame.*channel.*geometry.*digest.*currentness.*before.*after.*return/iu,
	);
	assert.match(
		control.summary,
		/stems.*BW64.*ADM.*before verification.*verification.*precede(?:s)?.*plan.*picker.*storage preflight.*render.*output publication/iu,
	);
	assert.match(
		control.summary,
		/empty private source-buffer map.*sole private chunk source.*global.*buffers.*providers.*caches.*unpublished.*time-pitch cache preparation.*offline.*realtime.*direct PCM/iu,
	);
	assert.match(
		control.summary,
		/stable.*integrity.*does not.*retry.*realtime.*ordinary audio export.*keeps.*existing/iu,
	);
	assert.match(
		control.summary,
		/corrupt.*after activation.*before.*render.*download.*restor.*exact PCM.*expected fallback samples.*canonical.*unchanged/iu,
	);
	assert.match(
		control.summary,
		/org\.example\.future-mixer.*unknown-feature composed Soundscaper-to-fresh-Framescaper.*manifest.*metadata.*localized.*UI.*exact feature ID.*requirement ID/iu,
	);
	assert.match(
		control.summary,
		/operation-time.*selector.*exact requirement ID.*feature ID.*audio kind.*source ID.*SHA-256.*tamper.*refus.*repair.*canonical project.*shadow.*unchanged/iu,
	);
	assert.match(
		control.summary,
		/not a durable storage-record or byte lease.*cross-process immutability.*non-audio roles.*more than one.*feature identities.*publisher authenticity.*third-party feature-code activation.*authored.*freeze.*proxy.*linked-only.*unmanaged.*stems.*BW64.*ADM.*surround.*packaged runtime or UI.*browser.*reference-scale.*future.*earlier/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	const sectionStart = threatModel.indexOf('Final audio rendered-fallback delivery');
	const sectionEnd = threatModel.indexOf('\nWhen exact schema 9 reports registered `videoEffects`', sectionStart);
	assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
	const documentation = threatModel.slice(sectionStart, sectionEnd).replace(/\s+/gu, ' ');
	assert.match(
		documentation,
		/final audio rendered-fallback delivery.*exact schema 9.*canonical namespaced feature ID.*unavailable or unknown.*declared and effective `rendered-fallback`.*closed `project-audio-mix-v1` role.*only.*standalone final mix/iu,
	);
	assert.match(documentation, /standalone.*simultaneous rendered fallback.*reject.*separate.*final-video.*one-audio.one-video/iu);
	assert.match(documentation, /role supplies.*media semantics.*feature ID.*opaque identity.*does not discover, load, or execute.*feature code/iu);
	assert.match(
		documentation,
		/selector.*requirement ID.*feature ID.*audio kind.*source ID.*SHA-256.*only.*selected.*PCM.*unrelated.*fallback.*not read/iu,
	);
	assert.match(
		documentation,
		/full canonical `audio-f32le-chunks-v1`.*65,536.*64 GiB.*32 bytes per chunk.*digest table.*2 MiB/iu,
	);
	assert.match(
		documentation,
		/private provider.*requested stored chunk.*migration.*cop(?:y|ies).*Float32Array.*index.*frame.*channel.*geometry.*digest.*currentness.*before.*after.*return/iu,
	);
	assert.match(
		documentation,
		/stems.*BW64.*ADM.*before integrity verification.*verification.*complete.*before.*plan.*picker.*storage preflight.*render.*output publication/iu,
	);
	assert.match(
		documentation,
		/empty private source-buffer map.*sole private chunk source.*global.*unchanged.*time-pitch cache preparation.*offline.*realtime.*direct PCM/iu,
	);
	assert.match(
		documentation,
		/stable integrity.*not.*retry.*realtime.*ordinary audio exports.*unchanged/iu,
	);
	assert.match(
		documentation,
		/corrupt.*after activation.*before.*render.*download.*restor.*exact PCM.*expected fallback samples.*canonical.*unchanged/iu,
	);
	assert.match(
		documentation,
		/`org\.example\.future-mixer`.*unknown-feature composed Soundscaper-to-fresh-Framescaper.*manifest.*metadata.*localized.*UI.*exact feature ID.*requirement ID/iu,
	);
	assert.match(
		documentation,
		/operation-time.*selector.*exact requirement ID.*feature ID.*audio kind.*source ID.*SHA-256.*tamper.*refus.*repair.*canonical project.*shadow.*unchanged/iu,
	);
	assert.match(
		documentation,
		/not a durable storage-record or byte lease.*cross-process immutability.*non-audio roles.*more than one.*feature identities.*publisher authenticity.*third-party feature-code activation.*authored.*freeze.*proxy.*linked-only.*unmanaged.*stems.*BW64.*ADM.*surround.*packaged runtime or UI.*browser.*reference-scale.*future.*earlier/iu,
	);
});
