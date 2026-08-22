/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SECURITY_CONTROL = 'framescaper-capture-durability-and-atomic-publication';
const DESKTOP_CONTROL = 'framescaper-capture-desktop-consent-authority';

test('Framescaper capture policy binds consent, recovery, origin, and publication evidence', async () => {
	const [matrix, threatModel, privacy] = await Promise.all([
		json('config/production-security-matrix.json'),
		text('docs/production-threat-model.md'),
		text('docs/framescaper-capture-privacy.md'),
	]);
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	const capture = cancellation?.currentControls.find(({ id }) => id === SECURITY_CONTROL);
	assert.ok(capture);
	assert.equal(cancellation.status, 'partial');
	assert.match(capture.summary, /Record is available only.*schema-18.*schema-19.*selected schema-20.*source.*video encoder.*audio packet.*cross-context Web Locks.*encoded\/raw\/manifest.*video probe.*canonical publication store.*partial stack.*unavailable/isu);
	assert.match(capture.summary, /Framescaper-only.*direct user action.*getDisplayMedia.*before.*getUserMedia.*later.*failure.*releases/isu);
	assert.match(capture.summary, /before.*recorder.*accept.*creation inventory.*origin project ID.*tokens.*spools.*manifest.*contiguous packet sequence.*manifest-acknowledged prefix/isu);
	assert.match(capture.summary, /partial creation.*cleanup-pending.*startup globally retries.*origin project is absent.*changed storage ownership fails closed/isu);
	assert.match(capture.summary, /outer project\/session Web Lock.*before.*nested exact spool Web Lock.*previous-to-next.*before writing the body.*manifest.*session lock remains held/isu);
	assert.match(capture.summary, /Passive spool inspection.*cannot roll metadata-next.*without an authoritative manifest prefix.*next prefix retires.*previous prefix restores.*physical tail.*other prefix.*fails closed.*Multi-stream.*total order/isu);
	assert.match(capture.summary, /Tail rollback.*metadata rewind.*physical-tail cleanup.*OPFS.*fallback.*raw cleanup.*Terminal retirement.*deleting state.*raw global reservation/isu);
	assert.match(capture.summary, /encoded presentation time.*prior acknowledged end.*PCM.*non-pause hole.*one microsecond.*1,048,576.*zero-valued.*1,048,576/isu);
	assert.match(capture.summary, /one through four.*4,096 pause spans.*1,000,000 encoded packets.*16,000,000 chunks/isu);
	assert.match(capture.summary, /browser PCM.*32 channels.*16,384 frames.*durable raw store independently.*64 channels.*65,536 frames.*8 MiB/isu);
	assert.match(capture.summary, /stored project IDs current-first.*one global recovery.*closed exact-origin project.*inactive tab/isu);
	assert.match(capture.summary, /origin.*project ID.*revision.*SHA-256.*playhead.*edit.*close.*delete.*handoff.*successful live or recovery publication.*explicit discard.*failed Stop.*protected recovery/isu);
	assert.match(capture.summary, /canonical publication materializes each acknowledged spool.*one ordinary durable source.*before project mutation.*fence.*one project batch.*CAS mismatch.*rolls back.*indeterminate.*retryable recovery/isu);
	assert.match(capture.summary, /Project Bin.*one bin item.*timeline.*one dedicated track, lane, and clip.*reuse the same ordinary sources/isu);
	assert.match(capture.summary, /after canonical capture and manifest commit.*without awaiting.*zero audio proxies.*exactly one captured-video proxy.*warning sink.*without rolling back/isu);
	assert.match(capture.summary, /proxy request.*session.*origin.*source.*revision.*content digest.*schema-18.*schema-19.*selected schema-20.*inactive-origin.*active app.*reclaim.*determinate failure/isu);
	assert.match(capture.summary, /landed proxy target.*claim cleanup.*session-history.*playback.*app-snapshot.*without regenerating.*later project edit/isu);
	assert.match(capture.summary, /capture-derived post-commit generation.*not a user-invoked general editorial proxy.*adaptive selection.*offline generation.*relink.*memory.*RSS/isu);
	assert.match(capture.summary, /implementation is complete.*qualification remains provisional.*synthetic media.*packaged no-device smoke.*control-plane/isu);
	assert.match(capture.summary, /no aggregate duration.*global byte.*browser heap.*RSS.*quota reservation.*30-minute.*unprovisioned/isu);
	assertEvidence(capture, [
		'src/common/editor/controller/framescaper-browser-capture-source.ts',
		'src/common/editor/controller/framescaper-capture-session-service.ts',
		'src/common/editor/controller/framescaper-capture-app-composition.ts',
		'src/common/editor/controller/framescaper-capture-durable-session.ts',
		'src/common/editor/controller/framescaper-capture-canonical-pcm.ts',
		'src/common/editor/controller/framescaper-capture-canonical-publication.ts',
		'src/common/editor/controller/framescaper-capture-durable-creation.ts',
		'src/common/editor/controller/framescaper-capture-durable-finalization.ts',
		'src/common/editor/controller/framescaper-capture-durable-manifest.ts',
		'src/common/editor/controller/framescaper-capture-origin-guard.ts',
		'src/common/editor/controller/framescaper-capture-publication-service.ts',
		'src/common/editor/controller/framescaper-capture-stream-timing.ts',
		'src/common/editor/framescaper-capture-session-manifest.ts',
		'src/common/editor/storage/capture-spool-append-intent-repository.ts',
		'src/common/editor/storage/capture-spool-creation-fence.ts',
		'src/common/editor/storage/capture-spool-operation-lock.ts',
		'src/common/editor/storage/capture-spool-tail-cleanup-repository.ts',
		'src/common/editor/storage/encoded-capture-spool-append.ts',
		'src/common/editor/storage/encoded-capture-spool-create.ts',
		'src/common/editor/storage/encoded-capture-spool-repository.ts',
		'src/common/editor/storage/encoded-capture-spool-tail-cleanup.ts',
		'src/common/editor/storage/framescaper-capture-creation-admission.ts',
		'src/common/editor/storage/framescaper-capture-session-creation-repository.ts',
		'src/common/editor/storage/framescaper-capture-session-manifest-repository.ts',
		'src/common/editor/storage/framescaper-capture-spool-prefix-repair.ts',
		'src/common/editor/storage/key-value-repository.ts',
		'src/common/editor/storage/opfs-repository.ts',
		'src/common/editor/storage/raw-pcm-spool-append.ts',
		'src/common/editor/storage/raw-pcm-spool-create.ts',
		'src/common/editor/storage/raw-pcm-spool-global-inventory.ts',
		'src/common/editor/storage/raw-pcm-spool-repository.ts',
		'src/common/editor/storage/raw-pcm-spool-tail-cleanup.ts',
		'src/common/editor/controller/project-save-service.ts',
		'src/common/editor/app.js',
		'src/framescaper/desktop-project-library-v10-renderer.ts',
		'src/framescaper/editor-captured-video-proxy-bodies.ts',
		'src/framescaper/editor-captured-video-proxy-claim-cleanup.ts',
		'src/framescaper/editor-captured-video-proxy-controller-fence.ts',
		'src/framescaper/editor-captured-video-proxy-desktop-publication.ts',
		'src/framescaper/editor-captured-video-proxy-indeterminate-reconciliation.ts',
		'src/framescaper/editor-captured-video-proxy-landed-reconciliation.ts',
		'src/framescaper/editor-captured-video-proxy-preservation.ts',
		'src/framescaper/editor-captured-video-proxy-project.ts',
		'src/framescaper/editor-captured-video-proxy-request.ts',
		'src/framescaper/editor-captured-video-proxy-scheduler-composition.ts',
		'src/framescaper/editor-captured-video-proxy-scheduler-state.ts',
		'src/framescaper/editor-captured-video-proxy-scheduler.ts',
		'src/framescaper/editor-captured-video-proxy-session-reconciliation.ts',
		'src/framescaper/editor-controller-v18.ts',
		'src/framescaper/editor-controller-v19.ts',
		'src/framescaper/editor-project-claim-cleanup-profile.ts',
		'src/framescaper/editor-project-environment-v19.ts',
		'src/framescaper/editor-video-proxy-attachment-capacity-v18.ts',
		'tests/audio-editor-framescaper-browser-capture-source.test.ts',
		'tests/audio-editor-framescaper-capture-app-binding.test.ts',
		'tests/audio-editor-framescaper-capture-app-composition.test.ts',
		'tests/audio-editor-framescaper-capture-canonical-pcm-timing.test.ts',
		'tests/audio-editor-framescaper-capture-creation-recovery.test.ts',
		'tests/audio-editor-framescaper-capture-session-service.test.ts',
		'tests/audio-editor-framescaper-capture-durable-session.test.ts',
		'tests/audio-editor-framescaper-capture-journal-split.test.ts',
		'tests/audio-editor-framescaper-capture-opfs-cleanup.test.ts',
		'tests/audio-editor-framescaper-capture-prewrite-intent.test.ts',
		'tests/audio-editor-framescaper-capture-rollback-lock.test.ts',
		'tests/audio-editor-framescaper-capture-tail-cleanup.test.ts',
		'tests/audio-editor-framescaper-capture-terminal-retirement.test.ts',
		'tests/audio-editor-framescaper-capture-origin-guard.test.ts',
		'tests/audio-editor-framescaper-capture-ordinary-asset-exit.test.ts',
		'tests/audio-editor-framescaper-capture-publication.test.ts',
		'tests/audio-editor-framescaper-capture-shared-timing.test.ts',
		'tests/audio-editor-framescaper-captured-video-proxy-final-fence.test.ts',
		'tests/audio-editor-framescaper-captured-video-proxy-scheduler.test.ts',
		'tests/audio-editor-framescaper-captured-video-proxy-reconciliation.test.ts',
		'tests/audio-editor-project-services.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/browser/framescaper-v19-capture.spec.js',
		'tests/quality-budget-m8a-capture-collector.test.ts',
	]);
	assert.match(threatModel, /policy-narrative:framescaper-capture-durability-and-atomic-publication/u);
	assert.match(privacy, /after canonical capture and manifest commit.*without awaiting.*audio.*never a proxy job.*every valid owned captured video.*one\s+proxy job.*warning.*does not roll back/isu);
	assert.match(privacy, /outer project\/session Web\s+Lock.*authoritative manifest.*nested.*spool Web Locks.*next manifest.*prefix.*previous prefix.*unacknowledged tail.*fails closed/isu);
	assert.match(privacy, /Record becomes available only.*schema-19 web.*schema-18 desktop.*cross-context Web Locks.*complete encoded\/raw\/manifest.*video\s+probe.*canonical publication store.*partial stack.*unavailable/isu);
	assert.match(privacy, /Framescaper recording is unavailable in Soundscaper.*Soundscaper.*microphone\/display policy.*camera denied/isu);

	const ipc = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const desktop = ipc?.currentControls.find(({ id }) => id === DESKTOP_CONTROL);
	assert.ok(desktop);
	assert.equal(ipc.status, 'enforced');
	assert.match(desktop.summary, /Framescaper.*control plane.*no media bytes.*native source IDs.*filesystem paths.*Electron objects/isu);
	assert.match(desktop.summary, /current owner.*focused trusted main document/isu);
	assert.match(desktop.summary, /64.*five minutes.*owner- and generation-bound.*15-second single-use/isu);
	assert.match(desktop.summary, /macOS 15.*system picker.*Windows.*loopback.*other.*unavailable/isu);
	assert.match(desktop.summary, /standalone Framescaper.*camera.*microphone.*display.*Soundscaper.*camera.*embedded.*deny/isu);
	assert.match(desktop.summary, /real packaged, no-device smoke.*control-plane.*status.*grant.*teardown.*actual packaged cameras.*remain unqualified/isu);
	assertEvidence(desktop, [
		'desktop/framescaper-capture-artifact-smoke.js',
		'desktop/framescaper-capture-desktop-port.ts',
		'desktop/framescaper-capture-preload.ts',
		'desktop/framescaper-capture-registration.mjs',
		'desktop/framescaper-capture-session-security.ts',
		'desktop/protocol.js',
		'electron-builder.config.cjs',
		'tests/desktop-framescaper-capture-desktop-port.test.ts',
		'tests/desktop-framescaper-capture-artifact-smoke.test.js',
		'tests/desktop-framescaper-capture-session-security.test.ts',
		'tests/desktop-framescaper-capture-packaging.test.js',
		'tests/desktop-framescaper-capture-protocol-policy.test.js',
		'tests/desktop-protocol.test.js',
		'tests/framescaper-capture-cloudflare-policy.test.js',
	]);
	assert.match(threatModel, /policy-narrative:framescaper-capture-desktop-consent-authority/u);
});

test('capability, quality, and roadmap records expose implementation without claiming device qualification', async () => {
	const [capabilities, quality, roadmap, plan] = await Promise.all([
		json('config/production-capabilities.json'),
		json('config/quality-budgets.json'),
		text('roadmap.md'),
		text('docs/milestone-8a-plan.md'),
	]);
	const framescaper = capabilities.products.framescaper;
	assert.equal(framescaper.projectFeatures.audioRecording, false);
	assert.deepEqual(framescaper.applicationFeatures, {
		framescaperCapture: true, framescaperWebVcr: false,
	});
	assert.equal(framescaper.platforms['web-core'].status, 'available');
	assert.equal(framescaper.platforms['web-enhanced'].status, 'partial');
	assert.equal(framescaper.platforms['electron-enhanced'].status, 'partial');
	assert.equal(framescaper.platforms['electron-only'].status, 'not-applicable');
	for (const [tier, paths] of Object.entries({
		'web-core': [
			'src/common/editor/controller/framescaper-capture-session-service.ts',
			'src/common/editor/ui/workspace/RecordingSetupPanel.tsx',
			'tests/audio-editor-framescaper-capture-ui.test.tsx',
		],
		'web-enhanced': [
			'src/common/editor/controller/framescaper-browser-capture-source.ts',
			'src/common/editor/controller/framescaper-capture-app-composition.ts',
			'src/common/editor/controller/framescaper-capture-canonical-pcm.ts',
			'src/common/editor/controller/framescaper-capture-canonical-publication.ts',
			'src/common/editor/controller/framescaper-capture-durable-session.ts',
			'src/common/editor/storage/capture-spool-append-intent-repository.ts',
			'src/common/editor/storage/capture-spool-operation-lock.ts',
			'src/common/editor/storage/capture-spool-tail-cleanup-repository.ts',
			'src/common/editor/storage/framescaper-capture-session-creation-repository.ts',
			'src/common/editor/storage/raw-pcm-spool-global-inventory.ts',
			'src/framescaper/editor-captured-video-proxy-scheduler-composition.ts',
			'src/framescaper/editor-captured-video-proxy-scheduler.ts',
			'tests/audio-editor-framescaper-capture-app-composition.test.ts',
			'tests/audio-editor-framescaper-capture-prewrite-intent.test.ts',
			'tests/audio-editor-framescaper-capture-rollback-lock.test.ts',
			'tests/audio-editor-framescaper-capture-terminal-retirement.test.ts',
			'tests/audio-editor-framescaper-captured-video-proxy-final-fence.test.ts',
			'tests/audio-editor-framescaper-captured-video-proxy-reconciliation.test.ts',
			'tests/browser/framescaper-v19-capture.spec.js',
			'tests/framescaper-capture-cloudflare-policy.test.js',
		],
		'electron-enhanced': [
			'desktop/framescaper-capture-artifact-smoke.js',
			'desktop/framescaper-capture-registration.mjs',
			'desktop/framescaper-capture-session-security.ts',
			'tests/desktop-framescaper-capture-packaging.test.js',
			'tests/desktop-framescaper-capture-artifact-smoke.test.js',
			'src/framescaper/editor-captured-video-proxy-desktop-publication.ts',
			'src/framescaper/editor-controller-v18.ts',
			'tests/audio-editor-framescaper-captured-video-proxy-final-fence.test.ts',
		],
	})) for (const path of paths) assert.ok(
		framescaper.platforms[tier].evidence.includes(path), `${tier} needs ${path}`,
	);

	const capture = roadmap.slice(
		roadmap.indexOf('### 8A. Framescaper recording setup'),
		roadmap.indexOf('### 8B. MIDI, strictly after Audacity design review'),
	);
	assert.match(capture, /Status:.*Implemented \(provisional\).*external\s+qualification remains pending/isu);
	assert.doesNotMatch(capture, /— Planned:/u);
	assert.equal((capture.match(/— Implemented \(provisional\):/gu) ?? []).length, 11);
	assert.match(capture, /milestone-8a-plan\.md.*framescaper-capture-privacy\.md/isu);
	assert.equal(quality.fixtures.find(({ id }) => id === 'm8a-capture-30m-all-sources-v1')?.status, 'provisional');
	assert.equal(quality.workloads.find(({ id }) => id === 'm8a-capture-long-session')?.status, 'provisional');
	const environment = quality.environments.find(({ id }) => id === 'capture-os-browser-lab-matrix');
	assert.equal(environment?.status, 'unprovisioned');
	assert.equal(environment?.qualificationEligible, false);
	assert.match(roadmap.slice(roadmap.indexOf('### 8B.')), /Status:.*Blocked.*Audacity/isu);
	assert.match(plan, /capture-only proxy route landed in commit `4f4d9d5a`.*framescaper-capture-canonical-publication\.ts.*editor-captured-video-proxy-scheduler\.ts.*captured-video-proxy-final-fence\.test\.ts/isu);
	assert.match(plan, /crash-safe creation and append protocol landed in commit `917add78`.*framescaper-capture-app-composition\.ts.*capture-spool-append-intent-repository\.ts.*capture-spool-operation-lock\.ts.*capture-rollback-lock\.test\.ts.*capture-terminal-retirement\.test\.ts/isu);
	assert.match(plan, /Commit `15a50dcb`.*framescaper-capture-stream-timing\.ts.*numeric.*null.*capture-shared-timing\.test\.ts/isu);
	assert.match(plan, /Commit `70d1192e`.*framescaper-v19-capture\.spec\.js.*eight configured-Chromium.*incomplete-runtime denial.*mixed.*inactive origin.*source-ended recovery.*does not.*qualify.*external/isu);
	assert.match(plan, /Milestone 8B MIDI remains independently blocked and is outside this plan/iu);
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.ok(evidence.has(path), path);
}
