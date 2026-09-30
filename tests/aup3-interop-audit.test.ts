/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { auditAup3ProfileInterop } from '../scripts/audit-aup3-interop.mjs';

const UPSTREAM_COMMIT = '86d74c770974b25188ca2f23bcce47c1181bd08a';

test('AUP3 audit reproduces and reopens the pinned Audacity 3 export profile', async () => {
	const first = await auditAup3ProfileInterop();
	const second = await auditAup3ProfileInterop();

	assert.deepEqual(second, first);
	assert.equal(first.schemaVersion, 1);
	assert.deepEqual(first.audacity, {
		version: '3.7.9',
		commit: UPSTREAM_COMMIT,
		nativeAudacityExecuted: false,
	});
	assert.equal(first.profile.applicationId, 0x41554459);
	assert.equal(first.profile.userVersion, 0x03070000);
	assert.equal(first.profile.pageSize, 65_536);
	assert.equal(first.profile.binaryXmlVersion, '1.3.0');
	assert.deepEqual(first.profile.tableNames, ['autosave', 'project', 'sampleblocks', 'sqlite_sequence']);
	assert.match(first.profile.databaseSha256, /^[0-9a-f]{64}$/u);
	assert.ok(first.profile.databaseByteLength > 0);
	assert.equal(first.project.audioTrackCount, 1);
	assert.equal(first.project.clipCount, 1);
	assert.equal(first.project.distinctSampleBlockCount, 1);
	assert.equal(first.project.blobOmissionCount, 1);
	assert.match(first.project.summary256Sha256, /^[0-9a-f]{64}$/u);
	assert.match(first.project.summary64kSha256, /^[0-9a-f]{64}$/u);
	assert.match(first.project.samplesSha256, /^[0-9a-f]{64}$/u);
});

test('AUP3 provenance names the exact upstream sources and maintained audit', async () => {
	const [notices, matrix, packageMetadata] = await Promise.all([
		readFile(new URL('../THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8'),
		readFile(new URL('../config/production-licensing-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
		readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
	]);
	const provenance = matrix.runtimeProvenance.find(({ id }: { id: string }) => (
		id === 'audacity-3-aup3-export-profile'
	));

	assert.ok(provenance);
	assert.match(provenance.description, new RegExp(UPSTREAM_COMMIT, 'u'));
	assert.deepEqual(provenance.evidence, [
		'THIRD_PARTY_LICENSES.md',
		'src/common/editor/aup3-profile.ts',
		'src/common/editor/aup3-effect-profile.ts',
		'src/common/editor/aup3-database.ts',
		'scripts/audit-aup3-interop.mjs',
		'tests/aup3-profile-database.test.ts',
		'tests/aup3-effect-profile.test.ts',
		'tests/aup3-interop-audit.test.ts',
	]);
	for (const source of [
		'libraries/lib-project-file-io/ProjectFileIO.cpp',
		'libraries/lib-project-file-io/DBConnection.cpp',
		'libraries/lib-project-file-io/ProjectSerializer.cpp',
		'libraries/lib-project-file-io/SqliteSampleBlock.cpp',
		'libraries/lib-wave-track/WaveClip.cpp',
		'libraries/lib-numeric-formats/ProjectTimeSignature.cpp',
		'libraries/lib-effects/Effect.cpp',
		'libraries/lib-realtime-effects/RealtimeEffectState.cpp',
		'libraries/lib-builtin-effects/BassTrebleBase.cpp',
		'libraries/lib-builtin-effects/DistortionBase.cpp',
		'libraries/lib-builtin-effects/PhaserBase.cpp',
		'libraries/lib-builtin-effects/ReverbBase.cpp',
		'libraries/lib-builtin-effects/WahWahBase.cpp',
		'src/effects/Compressor.cpp',
		'src/effects/Limiter.cpp',
		'src/ProjectFileManager.cpp',
		'src/tracks/ui/ChannelView.cpp',
		'libraries/lib-project/ProjectFormatVersion.cpp',
	]) assert.match(notices, new RegExp(source.replaceAll('.', '\\.'), 'u'));
	assert.match(notices, new RegExp(UPSTREAM_COMMIT, 'u'));
	assert.equal(packageMetadata.scripts['audit:aup3-interop'], 'node --import tsx scripts/audit-aup3-interop.mjs');
	assert.match(packageMetadata.scripts['audit:ci'], /npm run audit:aup3-interop/u);
});
