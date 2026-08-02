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
		'desktop/read-capability-admission.js',
		'desktop/read-selection-service.js',
		'desktop/renderer-save-owner.js',
		'desktop/protocol.js',
		'tests/desktop-file-association-delivery.test.js',
		'tests/desktop-read-capability-ownership.test.js',
		'tests/desktop-read-selection-service.test.js',
		'tests/desktop-renderer-save-owner.test.js',
		'tests/desktop-scape-read-capabilities.test.js',
		'tests/desktop-project-library-packaging.test.js',
		'tests/desktop-protocol.test.js',
		'tests/desktop-save.test.js',
	]) assert.ok(rendererOwnedRead.evidence.some((item) => item.path === path));
	assert.match(
		rendererOwnedRead.summary,
		/opaque main-owned.*committed main-frame document.*immutable profile.*all three profiles.*128 pending or live capability slots per owner.*before the first file-open await.*`materialized-v1`.*512 MiB.*per owner.*`scape-range-v1`.*four capabilities.*65 GiB.*globally and per owner.*`linked-video-range-v1`.*128 capabilities.*64 GiB.*globally and per owner.*512 MiB per file.*16 active range requests.*count reserves before open.*bytes charge after stat.*before publication/iu,
	);
	assert.match(
		rendererOwnedRead.summary,
		/cleanup retains its range charge.*fences new range admission.*wrong-owner release.*correct release and expiry for the expiring profiles.*linked playback.*without wall-clock expiry.*navigation.*renderer loss.*window close.*shutdown.*delayed dialog, open, or stat.*without publication.*partial multi-file.*rollback release/iu,
	);
	assert.match(
		rendererOwnedRead.summary,
		/OS-open paths.*visible queue head.*four real Scape descriptors.*fifth refuses before open.*acknowledged release redispatches.*renderer-send failure releases its descriptor.*transient count or aggregate-byte pressure.*retryable without eviction.*individually oversized file is not/iu,
	);

	const leasedRangeRead = desktopRead.currentControls.find(
		({ id }) => id === 'serialized-range-request-lifecycle',
	);
	assert.ok(leasedRangeRead);
	for (const path of [
		'desktop/constants.js',
		'desktop/file-capabilities.js',
		'desktop/preload.mjs',
		'desktop/protocol.js',
		'desktop/read-capability-admission.js',
		'src/common/editor/desktop-scape-archive-byte-source.ts',
		'src/common/editor/desktop-read-profile.ts',
		'src/common/editor/file-service.js',
		'src/common/editor/scape-abort.ts',
		'src/common/editor/scape-archive-byte-source.ts',
		'src/common/editor/ui/workspace/AudioEditorWorkspace.jsx',
		'src/common/editor/ui/workspace/desktop-project-file-routing.ts',
		'src/common/editor/ui/workspace/useDesktopEditorBridge.js',
		'tests/audio-editor-app-modules.test.js',
		'tests/audio-editor-desktop-project-file-routing.test.ts',
		'tests/audio-editor-desktop-scape-archive-byte-source.test.ts',
		'tests/audio-editor-file-service-scape-ranges.test.ts',
		'tests/desktop-preload-read-descriptors.test.js',
		'tests/desktop-read-capability-leases.test.js',
		'tests/desktop-protocol.test.js',
		'tests/desktop-scape-range-protocol.test.js',
		'tests/desktop-scape-read-capabilities.test.js',
	]) assert.ok(leasedRangeRead.evidence.some((item) => item.path === path));
	assert.match(
		leasedRangeRead.summary,
		/immutable main-assigned read profile.*store entry.*frozen descriptor.*canonical URL.*lookup.*request lease.*unknown or mismatched profiles.*malformed range.*before lease acquisition or TTL renewal.*store repeats.*expected-profile.*before renewal.*`scape-range-v1`.*only `GET`.*exact closed range.*inside.*16 MiB.*always responds `206`.*full-file.*`HEAD`.*suffix.*open-ended.*multiple.*oversized.*EOF-overrun.*refuse.*one active range request globally.*successful Web response body.*done.*pinned handle.*body cancellation.*request abort.*inner stream failure.*retires.*entire capability.*native stream close.*pinned handle close.*cleanup barrier.*release.*expiry.*owner revocation.*shutdown.*same retirement.*failed cleanup tombstone.*correct owner.*owner or store teardown.*no raw handle.*preload.*exact profile.*name.*MIME.*profile-size.*canonical URL-path.*no query or fragment.*renderer.*excludes Scape.*generic materialization.*exact release.*success.*failure.*cancellation.*abort.*invalid routing.*project-dialog.*OS-association.*awaited scope.*Browser Blob.*Audacity/iu,
	);

	const linkedVideoPlayback = desktopRead.currentControls.find(
		({ id }) => id === 'owner-scoped-linked-video-playback-range-lifecycle',
	);
	assert.ok(linkedVideoPlayback);
	for (const path of [
		'desktop/linked-video-locator-ipc.js',
		'desktop/read-capability-admission.js',
		'desktop/read-capability-range-stream.js',
		'src/common/editor/storage/desktop-linked-video-range-reader.ts',
		'src/common/editor/storage/linked-video-original-resolver.ts',
		'tests/desktop-linked-video-playback-capability.test.js',
		'tests/desktop-linked-video-playback-locator.test.ts',
		'tests/audio-editor-desktop-linked-video-playback-port.test.ts',
		'tests/audio-editor-linked-video-playback-resolver.test.ts',
	]) assert.ok(linkedVideoPlayback.evidence.some((item) => item.path === path));
	assert.match(
		linkedVideoPlayback.summary,
		/mandatory playback mode.*exact locator revision.*pathname stat.*device, inode, size, modification-time, and change-time.*owner-scoped handle.*`linked-video-range-v1`.*replacement during admission fails closed.*replacement after admission cannot retarget.*512 MiB.*128 capabilities.*64 GiB.*globally and per owner.*16 active requests.*no wall-clock expiry.*`HEAD`.*start-based closed or open-ended `GET`.*4 MiB.*rejects.*full-body GET.*suffix.*multiple.*oversized.*EOF-overrun/iu,
	);
	assert.match(
		linkedVideoPlayback.summary,
		/success and ordinary seek cancellation.*preserve the capability.*inner stream failure retires.*explicit release.*owner revocation.*navigation.*renderer loss.*window close.*shutdown.*exact revision.*video MIME.*canonical pathless URL.*exact closed GET ranges.*full handle sequentially.*at-most-4-MiB ranges.*exact `206`.*Accept-Ranges.*Content-Range.*Content-Length.*Content-Type.*binding and CAS fence.*media URL and one-shot release.*cleanup failures.*aggregated/iu,
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
		'src/common/editor/desktop-read-profile.ts',
		'src/common/editor/desktop-read-materialization.ts',
		'src/common/editor/file-service.js',
		'src/common/editor/platform/bounded-transfer.ts',
		'src/common/editor/ui/workspace/AudioEditorWorkspace.jsx',
		'src/common/editor/ui/workspace/ProjectBinPanel.jsx',
		'src/common/editor/ui/workspace/useDesktopEditorBridge.js',
		'tests/audio-editor-app-modules.test.js',
		'tests/audio-editor-desktop-project-file-routing.test.ts',
		'tests/audio-editor-desktop-read-materialization.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/desktop-preload-read-descriptors.test.js',
		'tests/desktop-read-capability-ownership.test.js',
		'tests/desktop-protocol.test.js',
	]) assert.ok(boundedMaterialization.evidence.some((item) => item.path === path));
	assert.match(
		boundedMaterialization.summary,
		/only.*main-assigned `materialized-v1`.*authoritative main-process admission.*aggregate active declared selected-file bytes.*512 MiB.*per committed-document owner.*before publication.*preload.*exact materialized profile.*name.*MIME.*safe size.*canonical profile-bearing URL.*renderer.*before fetch.*rejects.*Scape name.*canonical Scape MIME.*`scape-range-v1`.*`linked-video-range-v1`.*instead of materializing.*exact declared Content-Length.*emitted-byte.*final Blob-size.*response body stream.*copied and split.*16 MiB.*caller.*AbortSignal.*stalled body read.*exact reason.*never calls response\.blob.*scoped descriptor batch.*releases every capability.*success.*failure.*cancellation.*request abort.*destroys.*file stream.*bounded whole-Blob tier.*not.*decoder amplification.*whole-process RSS.*Scape and linked-video playback.*excluded.*separately admitted range profiles/iu,
	);
	assert.equal(desktopRead.releaseDisposition, 'qualified-current-surface');
	assert.deepEqual(desktopRead.residualRisks, []);
});
