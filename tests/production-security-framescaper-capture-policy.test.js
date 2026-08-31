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
	assert.match(capture.summary, /Framescaper family v1.*active.*standalone web and desktop.*framescaperCapture true.*capture route authority.*controller.*app binding.*runtime probe.*Recording Setup.*default-hidden.*View > Panels.*opt-in.*active or recovery-owned.*Record.*source.*video encoder.*audio packet.*cross-context Web Locks.*encoded\/raw\/manifest.*video probe.*canonical publication store.*partial stack.*unavailable/isu);
	assert.match(capture.summary, /family v1.*direct user action.*getDisplayMedia.*before.*getUserMedia.*later.*failure.*releases/isu);
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
	assert.match(capture.summary, /proxy request.*session.*origin.*source.*revision.*content digest.*Framescaper family v1.*owned revision lineage.*inactive-origin.*active app.*reclaim.*determinate failure/isu);
	assert.match(capture.summary, /landed proxy target.*claim cleanup.*session-history.*playback.*app-snapshot.*without regenerating.*later project edit/isu);
	assert.match(capture.summary, /Framescaper family v1 capture-derived scheduler.*post-commit generation.*separate from Framescaper family v1's menu-reached general editorial proxy lifecycle.*generation.*adaptive Original\/Proxy\/Auto preview selection.*offline editing.*relink.*regeneration.*cancellation.*atomic cleanup.*Neither route.*memory.*RSS/isu);
	assert.match(capture.summary, /implementation.*active on Framescaper family-v1 web and desktop.*default-hidden Record-menu surface enabled for testing.*manual.*qualification.*milestone-9 stable 1\.0 admission evidence.*never disables.*implemented route.*synthetic media.*packaged no-device smoke.*control-plane/isu);
	assert.match(capture.summary,
		/Configured Chromium, Firefox, and WebKit.*eight-case workflow.*synthetic media.*24 configured-engine cases.*neither substitutes for qualification/isu);
	assert.match(capture.summary, /no aggregate duration.*global byte.*browser heap.*RSS.*quota reservation.*30-minute.*unprovisioned/isu);
	assertEvidence(capture, [
		'src/common/editor/framescaper-capture-domain.ts',
		'src/common/editor/framescaper-capture-session-manifest.ts',
		'src/common/editor/controller/framescaper-capture-app-binding.ts',
		'src/common/editor/controller/framescaper-capture-runtime-probe.ts',
		'src/common/editor/controller/framescaper-capture-durable-session.ts',
		'src/common/editor/controller/framescaper-capture-canonical-publication.ts',
		'src/common/editor/controller/framescaper-capture-origin-guard.ts',
		'src/common/editor/storage/capture-spool-append-intent-repository.ts',
		'src/common/editor/storage/capture-spool-operation-lock.ts',
		'src/common/editor/storage/framescaper-capture-session-manifest-repository.ts',
		'src/framescaper/product.js',
		'src/framescaper/editor-captured-video-proxy-desktop-publication.ts',
		'src/framescaper/editor-captured-video-proxy-scheduler.ts',
		'tests/audio-editor-framescaper-capture-app-composition.test.ts',
		'tests/audio-editor-framescaper-capture-origin-guard.test.ts',
		'tests/audio-editor-framescaper-capture-rollback-lock.test.ts',
		'tests/audio-editor-framescaper-capture-terminal-retirement.test.ts',
		'tests/framescaper-capture-cloudflare-policy.test.js',
	]);
	assert.match(threatModel, /policy-narrative:framescaper-capture-durability-and-atomic-publication/u);
	assert.match(privacy, /after canonical capture and manifest commit.*without awaiting.*audio.*never a proxy job.*every valid owned captured video.*one\s+proxy job.*warning.*does not roll back/isu);
	assert.match(privacy, /outer project\/session Web\s+Lock.*authoritative manifest.*nested.*spool Web Locks.*next manifest.*prefix.*previous prefix.*unacknowledged tail.*fails closed/isu);
	assert.match(privacy, /Record is available.*Framescaper family-v1.*standalone web and desktop.*cross-context Web Locks.*complete\s+encoded\/raw\/manifest.*video probe.*canonical publication\s+store.*partial stack.*unavailable.*Pre-release capture generations.*provenance only/isu);
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
	assert.match(desktop.summary, /Framescaper family v1.*framescaperCapture true.*active on standalone web and desktop.*Recording Setup.*default-hidden.*capture route authority.*desktop control plane/isu);
	assert.match(desktop.summary, /real packaged, no-device smoke.*control-plane.*status.*grant.*teardown.*activation.*not qualification.*actual packaged cameras.*remain unqualified/isu);
	assertEvidence(desktop, [
		'desktop/framescaper-capture-artifact-smoke.js',
		'desktop/framescaper-capture-desktop-port.ts',
		'desktop/framescaper-capture-preload.ts',
		'desktop/framescaper-capture-registration.mjs',
		'desktop/framescaper-capture-session-security.ts',
		'desktop/protocol.js',
		'electron-builder.config.cjs',
		'src/framescaper/product.js',
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

test('capability activates the Framescaper family-v1 baseline while real-device qualification remains pending', async () => {
	const [capabilities, quality, roadmap, plan] = await Promise.all([
		json('config/production-capabilities.json'),
		json('config/quality-budgets.json'),
		text('roadmap.md'),
		text('docs/milestone-8a-plan.md'),
	]);
	const framescaper = capabilities.products.framescaper;
	assert.equal(framescaper.projectFeatures.audioRecording, false);
	assert.deepEqual(framescaper.applicationFeatures, {
		framescaperCapture: true, framescaperWebVcr: true,
	});
	assert.equal(framescaper.platforms['web-core'].status, 'available');
	assert.equal(framescaper.platforms['web-enhanced'].status, 'partial');
	assert.equal(framescaper.platforms['electron-enhanced'].status, 'partial');
	assert.equal(framescaper.platforms['electron-only'].status, 'partial');
	for (const [tier, paths] of Object.entries({
		'web-core': [
			'src/framescaper/editor-project.ts',
			'src/framescaper/editor-controller.ts',
			'src/common/editor/controller/framescaper-capture-session-service.ts',
			'src/common/editor/ui/workspace/RecordingSetupPanel.tsx',
			'tests/audio-editor-framescaper-capture-ui.test.tsx',
		],
		'web-enhanced': [
			'src/framescaper/product-route.ts',
			'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx',
			'src/framescaper/editor-controller.ts',
			'src/framescaper/editor-project-environment.ts',
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
			'tests/audio-editor-framescaper-capture-derivative-scheduler.test.ts',
			'tests/framescaper-capture-cloudflare-policy.test.js',
		],
		'electron-enhanced': [
			'desktop/framescaper-capture-artifact-smoke.js',
			'desktop/framescaper-capture-registration.mjs',
			'desktop/framescaper-capture-session-security.ts',
			'tests/desktop-framescaper-capture-packaging.test.js',
			'tests/desktop-framescaper-capture-artifact-smoke.test.js',
			'src/framescaper/editor-captured-video-proxy-desktop-publication.ts',
			'src/framescaper/editor-controller.ts',
			'tests/audio-editor-framescaper-capture-app-composition.test.ts',
		],
	})) for (const path of paths) assert.ok(
		framescaper.platforms[tier].evidence.includes(path), `${tier} needs ${path}`,
	);

	const capture = roadmap.slice(
		roadmap.indexOf('### 8A. Framescaper recording setup'),
		roadmap.indexOf('## 8+. Post-milestone-8 Framescaper Web VCR extension'),
	);
	assert.match(capture, /Status:.*Implemented and active on selected Framescaper F31 web and desktop.*framescaperCapture: true.*Recording Setup.*default-hidden.*View > Panels.*manual qualification.*milestone 9.*framescaperWebVcr: true/isu);
	assert.doesNotMatch(roadmap, /Blocked until milestone 8:\*\*[^\n]*(?:Framescaper camera|Framescaper capture)/iu);
	assert.doesNotMatch(capture, /— Planned:/u);
	assert.equal((capture.match(/— Implemented \(active; qualification open\):/gu) ?? []).length, 11);
	assert.match(capture, /milestone-8a-plan\.md.*framescaper-capture-privacy\.md/isu);
	const captureFixture = quality.fixtures.find(({ id }) => id === 'm8a-capture-30m-all-sources-v1');
	const captureWorkload = quality.workloads.find(({ id }) => id === 'm8a-capture-long-session');
	assert.equal(captureFixture?.kind, 'observed-capture-session');
	assert.equal(captureWorkload?.behavior, 'blocking');
	assert.deepEqual(captureWorkload?.fixtureIds, ['m8a-capture-30m-all-sources-v1']);
	assert.deepEqual(captureWorkload?.measurementIds, [
		'capture.sourceCombinationsCompleted', 'capture.avDriftMaximumMs',
		'capture.droppedFrameRatio', 'capture.unreportedDroppedFrames',
		'capture.audioDropoutFrames', 'capture.deviceTeardownP95Ms',
		'capture.unrecoverableDurableFragments', 'capture.unauthorizedDeviceOpens',
	]);
	assert.equal(Object.hasOwn(quality, 'environments'), false);
	assert.match(
		roadmap.slice(roadmap.indexOf('## 9+. Post-1.0 extensions')),
		/### 8B\. MIDI.*Status:.*Planned.*not implemented.*excluded from stable 1\.0.*Audacity.*post-1\.0/isu,
	);
	assert.match(plan, /capture-only proxy route landed in commit `4f4d9d5a`.*framescaper-capture-canonical-publication\.ts.*editor-captured-video-proxy-scheduler\.ts.*captured-video-proxy-final-fence\.test\.ts/isu);
	assert.match(plan, /crash-safe creation and append protocol landed in commit `917add78`.*framescaper-capture-app-composition\.ts.*capture-spool-append-intent-repository\.ts.*capture-spool-operation-lock\.ts.*capture-rollback-lock\.test\.ts.*capture-terminal-retirement\.test\.ts/isu);
	assert.match(plan, /Commit `15a50dcb`.*framescaper-capture-stream-timing\.ts.*numeric.*null.*capture-shared-timing\.test\.ts/isu);
	assert.match(plan, /Commit `70d1192e`.*framescaper-v19-capture\.spec\.js.*eight configured-Chromium.*incomplete-runtime denial.*mixed.*inactive origin.*source-ended recovery.*does not.*qualify.*external/isu);
	assert.match(plan,
		/Commits `5ccf6447`, `2c6e2a94`, and `16029166`.*selected F31.*Chromium, Firefox, and WebKit.*eight cases.*24 configured-engine cases.*synthetic.*still unqualified/isu);
	assert.match(plan, /Milestone 8B MIDI remains planned but unimplemented and is outside this plan/iu);
	assert.match(plan, /Status:.*Implemented and active on selected F31 standalone web and desktop.*framescaperCapture: true.*Recording Setup.*default-hidden.*View > Panels.*framescaperWebVcr: true.*manual.*review.*milestone 9/isu);
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
