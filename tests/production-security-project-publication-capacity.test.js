/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('project publication evidence keeps canonical admission distinct from backend capacity', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	assert.ok(projectDocuments);
	const admission = projectDocuments.currentControls.find(
		({ id }) => id === 'maintained-project-publication-admission',
	);
	const accounting = projectDocuments.residualRisks.find(
		({ id }) => id === 'project-publication-capacity-accounting',
	);
	assert.ok(admission);
	assert.match(
		admission.summary,
		/maintained caller save.*`AudioEditorProjectStore\.saveProject`.*once for admission.*canonical.*UTF-8.*non-raiseable 256 MiB.*lower-only.*before repository save.*queued controller.*direct maintained.*actual backend.*twice.*gross proxy.*current.*revision.*ceil\(10%\).*Direct IndexedDB.*one normalized estimate.*queued autosave.*callback.*without a second canonical serialization.*known insufficient.*direct and queued.*before repository.*success side effects.*unknown or malformed.*memory backend.*proceed.*successor/isu,
	);
	for (const path of [
		'src/common/editor/project-publication-admission.ts', 'src/common/editor/storage.js', 'src/common/editor/types.ts',
		'src/common/editor/controller/project-save-service.ts',
		'src/common/editor/controller/storage-capacity-runtime.ts',
		'src/common/editor/controller/storage-capacity-service.ts', 'src/common/editor/app.js',
		'tests/audio-editor-project-publication-admission.test.ts',
		'tests/audio-editor-project-store-publication-admission.test.ts',
		'tests/audio-editor-project-save-publication-admission.test.ts',
		'tests/audio-editor-controller-disposal.test.js', 'tests/audio-editor-controller.test.js',
		'tests/audio-editor-storage-capacity-runtime.test.ts',
		'tests/audio-editor-storage-capacity-service.test.ts',
	]) assert.ok(admission.evidence.some((item) => item.path === path), path);
	assert.ok(accounting);
	assert.match(
		accounting.exposure,
		/twice-canonical.*not.*structured-clone.*repository compaction.*revision-wrapper.*record.*key.*property.*transaction.*journal.*replacement.*pruning.*allocation-unit.*after canonical serialization.*snapshot clone.*serializer string.*heap.*RSS.*garbage collection.*capacity check.*maintained facade saves.*point-in-time.*unreserved.*estimates may lag.*concurrent writers.*oversubscribe.*write-time quota.*memory fallback.*unknown estimates.*no durable-capacity claim/isu,
	);
	assert.match(
		accounting.exposure,
		/desktop shared projects.*browser-side estimate.*local IndexedDB shadow.*exact-absent managed-media body publication.*prospective catalog geometry.*same-store point-in-time managed-root admission.*before body or optional hard-link work.*does not cover.*renderer\/main IPC.*appData project-document staging.*SQLite catalog or WAL allocation.*filesystem allocation overhead.*cross-store or cross-process coordination.*whole-handoff reservation.*later external allocation.*write-time success.*shared-project load.*local shadow.*outside the save facade.*Scape rollback restoration.*aggregated rollback failure.*directly constructed repository.*pre-existing over-limit.*route-specific controls/isu,
	);
	assert.match(
		accounting.requiredControl,
		/actual backend publication geometry.*resident working set.*reserve capacity across concurrent writes.*qualified typed write-time space refusal beyond the desktop save-target surface.*complete desktop appData admission.*project-document staging.*catalog allocation.*extend managed-media admission.*whole-handoff.*cross-store.*cross-process.*exact-allocation.*write-time guarantees/isu,
	);
	assert.match(
		accounting.acceptanceCriteria.join(' '),
		/backend-specific publication tests.*transaction overhead.*resident-set evidence.*concurrent writes.*cannot oversubscribe.*complete desktop appData admission.*project-document or catalog publication.*managed-media guarantees.*whole-handoff.*write-time scope/isu,
	);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(documentation, /maintained-project-publication-admission.*`AudioEditorProjectStore\.saveProject`.*once for admission.*canonical.*256 MiB.*maintained direct.*actual backend.*twice.*gross proxy.*ceil\(10%\).*Direct IndexedDB.*queued autosave.*explicit flush.*terminal flush.*callback.*without a second canonical serialization.*known insufficient.*unknown or malformed.*memory backend.*successor/isu);
	assert.match(documentation, /project-publication-capacity-accounting.*not an exact IndexedDB byte count.*structured-clone.*snapshot clone.*serializer string.*heap.*RSS.*maintained facade saves.*point-in-time.*unreserved.*memory fallback.*unknown estimates.*desktop shared projects.*browser-side estimate.*local IndexedDB shadow.*exact-absent managed-media body publication.*prospective catalog geometry.*same-store point-in-time managed-root admission.*not cover.*renderer\/main IPC.*appData project-document staging.*SQLite catalog or WAL allocation.*filesystem allocation overhead.*cross-store or cross-process coordination.*whole-handoff reservation.*later external allocation.*write-time success.*shared-project load.*outside the save facade.*Scape rollback restoration.*aggregated rollback failure.*directly constructed repository/isu);
});
