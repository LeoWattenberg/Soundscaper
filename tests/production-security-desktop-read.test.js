/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('desktop read capability evidence remains qualified for its current surface', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const desktopRead = matrix.risks.find(({ id }) => id === 'desktop-read-path-capabilities');
	assert.ok(desktopRead);

	const rendererOwnedRead = desktopRead.currentControls.find(
		({ id }) => id === 'renderer-document-owned-read-lifecycle',
	);
	assert.ok(rendererOwnedRead);
	for (const path of [
		'desktop/constants.js',
		'desktop/file-capabilities.js',
		'desktop/file-associations.js',
		'desktop/main.mjs',
		'desktop/renderer-save-owner.js',
		'desktop/protocol.js',
		'tests/desktop-read-capability-ownership.test.js',
		'tests/desktop-renderer-save-owner.test.js',
		'tests/desktop-project-library-packaging.test.js',
		'tests/desktop-protocol.test.js',
		'tests/desktop-save.test.js',
	]) assert.ok(rendererOwnedRead.evidence.some((item) => item.path === path));
	assert.match(
		rendererOwnedRead.summary,
		/opaque main-owned.*committed main-frame document.*for each committed-document owner.*128 pending or live.*before.*file-open await.*before descriptor publication.*owner's aggregate declared selected-file bytes.*512 MiB.*wrong-owner release.*release.*expiry.*non-same-document navigation.*renderer loss.*actual window close.*shutdown.*synchronously.*lookup.*drain.*delayed.*open or stat.*without publication.*partial multi-file.*every rollback release.*primary and cleanup failures.*OS-open paths.*serially deduplicated.*visible queue head.*refuses.*without evicting.*cleanup failure/iu,
	);

	const leasedRangeRead = desktopRead.currentControls.find(
		({ id }) => id === 'serialized-range-request-lifecycle',
	);
	assert.ok(leasedRangeRead);
	for (const path of [
		'desktop/file-capabilities.js',
		'desktop/protocol.js',
		'tests/desktop-read-capability-leases.test.js',
		'tests/desktop-protocol.test.js',
	]) assert.ok(leasedRangeRead.evidence.some((item) => item.path === path));
	assert.match(
		leasedRangeRead.summary,
		/one active protocol request.*exact single byte ranges.*successful.*Web response body.*done.*preserv.*pinned handle.*cancellation.*request abort.*inner stream failure.*retires.*entire capability.*native stream close.*pinned handle close.*cleanup barrier.*release.*expiry.*owner revocation.*shutdown.*same retirement.*failed cleanup tombstone.*correct owner.*owner or store teardown.*does not expose.*raw handle.*not yet.*archive byte source/iu,
	);

	assert.equal(desktopRead.residualRisks.some(({ id }) => id === 'read-capability-owner-lifecycle'), false);
	const boundedMaterialization = desktopRead.currentControls.find(
		({ id }) => id === 'bounded-abortable-renderer-read-materialization',
	);
	assert.ok(boundedMaterialization);
	for (const path of [
		'desktop/constants.js',
		'desktop/file-capabilities.js',
		'desktop/preload.mjs',
		'desktop/protocol.js',
		'src/common/editor/desktop-read-materialization.ts',
		'src/common/editor/file-service.js',
		'src/common/editor/platform/bounded-transfer.ts',
		'src/common/editor/ui/workspace/AudioEditorWorkspace.jsx',
		'src/common/editor/ui/workspace/ProjectBinPanel.jsx',
		'src/common/editor/ui/workspace/useDesktopEditorBridge.js',
		'tests/audio-editor-app-modules.test.js',
		'tests/audio-editor-desktop-read-materialization.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/desktop-preload-read-descriptors.test.js',
		'tests/desktop-read-capability-ownership.test.js',
		'tests/desktop-protocol.test.js',
	]) assert.ok(boundedMaterialization.evidence.some((item) => item.path === path));
	assert.match(
		boundedMaterialization.summary,
		/authoritative main-process admission.*aggregate active declared selected-file bytes.*512 MiB.*per committed-document owner.*before descriptor publication.*preload.*descriptor size.*renderer materializer.*before fetch.*exact declared Content-Length.*emitted-byte.*final Blob-size.*response body stream.*copied and split.*16 MiB.*platform media-chunk limit.*caller.*AbortSignal.*stalled body read.*exact reason.*never calls response\.blob.*scoped descriptor batch.*release.*success.*failure.*cancellation.*request abort.*destroys.*file stream.*bounded whole-Blob tier.*not.*decoder amplification.*whole-process RSS/iu,
	);
	assert.equal(desktopRead.releaseDisposition, 'qualified-current-surface');
	assert.deepEqual(desktopRead.residualRisks, []);
});
