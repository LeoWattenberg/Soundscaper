/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('compatibility rules distinguish enforced guarantees from planned lossless fallbacks', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));
	assert.equal(rules.size, policy.rules.length);

	const expectedStatuses = {
		'legacy-schema-migration': 'implemented',
		'current-schema-editing': 'implemented', 'current-video-retime-v16-preservation': 'implemented',
		'framescaper-v18-product-isolation': 'implemented',
		'current-local-assistance-transcript-custody': 'implemented',
		'framescaper-v22-v26-compatibility-custody': 'implemented',
		'framescaper-v18-nested-sequence-native': 'implemented',
		'framescaper-v18-multicamera-native': 'implemented',
		'framescaper-v18-video-proxy-preservation': 'implemented',
		'current-take-comp-v17-preservation': 'implemented', 'current-audio-warp-capability': 'implemented', 'current-track-locking': 'implemented', 'current-timeline-annotation-capability': 'implemented',
		'current-track-folder-capability': 'implemented', 'current-source-characteristics-capability': 'implemented',
		'current-linked-pcm-portable-archive': 'implemented',
		'current-desktop-project-catalog-commit': 'implemented', 'current-desktop-electron-lease-protections': 'partial',
		'current-desktop-managed-mixed-media-handoff': 'implemented', 'current-desktop-packaged-source-bearing-handoff': 'implemented', 'current-web-scape-mixed-media-handoff': 'implemented',
		'current-desktop-recipient-media-admission': 'implemented',
		'current-desktop-linked-retained-video-original': 'implemented',
		'current-kindful-linked-original-save-roots': 'implemented',
		'current-desktop-linked-pcm-managed-handoff': 'implemented',
		'current-disposable-video-preview-relationship': 'implemented',
		'project-feature-requirements-core': 'implemented',
		'current-scape-feature-requirements': 'implemented',
		'current-scape-rendered-fallback-integrity': 'implemented',
		'current-controller-feature-report': 'implemented',
		'current-post-open-feature-report': 'implemented',
		'current-first-party-audio-effect-playback-bypass': 'implemented',
		'current-audio-whole-mix-rendered-fallback': 'implemented',
		'current-audio-track-rendered-fallback': 'implemented',
		'current-first-party-video-effect-playback-bypass': 'implemented',
		'current-video-rendered-fallback-playback': 'implemented',
		'current-controller-rendered-fallback-integrity': 'implemented',
		'current-scape-pre-open-feature-report': 'implemented',
		'current-scape-open-feature-decision': 'implemented',
		'future-core-read-only': 'implemented',
		'future-scape-round-trip': 'implemented',
		'json-opaque-extensions': 'implemented',
		'binary-opaque-native-state': 'implemented',
		'unavailable-native-feature': 'planned',
		'video-proxy-fallback': 'implemented',
		'audio-freeze-fallback': 'implemented',
		'future-archive-format-rejection': 'implemented',
	};
	assert.deepEqual(
		Object.fromEntries([...rules].map(([id, rule]) => [id, rule.status])),
		expectedStatuses,
	);

	for (const rule of rules.values()) {
		assert.ok(rule.requiredOutcome.length > 0, rule.id);
		assert.ok(rule.currentBehavior.length > 0, rule.id);
		assert.ok(rule.evidence.length > 0, rule.id);
		if (rule.status !== 'implemented') assert.match(rule.milestone, /^(?:2|3|4)$/u, rule.id);
		for (const reference of rule.evidence) {
			const [repositoryPath] = reference.split('#');
			await assert.doesNotReject(
				access(new URL(`../${repositoryPath}`, import.meta.url)),
				`Missing compatibility evidence: ${reference}`,
			);
		}
	}

	const localAssistance = rules.get('current-local-assistance-transcript-custody');
	assert.match(localAssistance.requiredOutcome,
		/reviewed.*Parakeet transcripts and link-aware cleanup.*Silero silences.*anonymous Pyannote.*ERes2Net speaker regions.*external-FFmpeg shot markers.*unavailable.*non-authoritative/isu);
	assert.match(localAssistance.currentBehavior,
		/four.*closed operations.*Parakeet.*Silero.*Pyannote.*ERes2Net.*external FFmpeg.*remaining eleven.*typed unavailable/isu);
	assert.match(localAssistance.currentBehavior,
		/content-addressed transcript-v1.*ordinary label track.*Silences.*anonymous Speakers.*timeline annotations.*link-aware.*track-ripple-delete.*A\/V link membership.*no assistance asset/isu);
	assert.match(localAssistance.currentBehavior,
		/manual.*owner-lab qualification.*neither disables.*nor relaxes.*hard gate/isu);
	for (const reference of [
		'desktop/assistance-operation-service.ts',
		'desktop/assistance-sherpa-vad.ts',
		'desktop/assistance-sherpa-diarizer.ts',
		'desktop/assistance-external-ffmpeg-shot-runtime.ts',
		'src/common/editor/controller/local-assistance-range-label-acceptance.ts',
		'src/common/editor/controller/local-assistance-shot-acceptance.ts',
		'src/common/editor/controller/local-assistance-cleanup-acceptance.ts',
	]) assert.ok(localAssistance.evidence.includes(reference), reference);

	const featureRequirements = rules.get('project-feature-requirements-core');
	for (const reference of [
		'src/common/editor/project-feature-requirements.ts', 'src/common/editor/project-feature-video-clip-render-v1.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/video-effects.js',
		'src/common/editor/project-foundation-factory.ts',
		'src/common/editor/project-structure-factory.ts',
		'src/common/editor/project-retime-factory.ts',
		'src/common/editor/project-v17.ts',
		'src/common/editor/project-v17-validation.ts',
		'src/common/editor/project.js',
		'src/common/editor/migration.js',
		'tests/audio-editor-project-feature-requirements.test.ts', 'tests/audio-editor-project-feature-video-clip-render-v1.test.ts',
		'tests/audio-editor-project-feature-capabilities.test.ts',
		'tests/audio-editor-project-owned-feature-requirements.test.ts',
		'tests/audio-editor-project-v9.test.ts',
	]) assert.ok(featureRequirements.evidence.includes(reference), reference);
	assert.match(featureRequirements.currentBehavior, /manifest schema 2.*bounded.*rendered-fallback.*closed fallback roles.*project-audio-mix-v1.*project-video-render-v1.*video-clip-render-v1.*legacy nested manifest schema 1.*deterministically normalizes.*whole-project roles only.*clip role.*videoEffects.*exact target clip ID/iu);
	assert.match(
		featureRequirements.requiredOutcome,
		/create, load, clone, and commit.*editor-owned first-party/iu,
	);
	assert.match(
		featureRequirements.currentBehavior,
		/exact-schema-17 create, load, clone, and commit.*reserved soundscaper\.audio-effects.*non-label.*non-video.*mixer group.*mixer send.*master rack/iu,
	);
	assert.match(
		featureRequirements.currentBehavior,
		/reserved soundscaper\.video-effects.*timeline.*Project Bin.*video clip.*disabled effects.*inactive audio racks.*missing or foreign.*non-video clips.*explicit publisher.*wins without duplication.*conflicting.*reserved requirement ID rejects/iu,
	);
	assert.match(featureRequirements.currentBehavior, /Audacity importers.*exact-current.*same owned reconciliation.*without routing an older outer schema/iu);
	assert.match(featureRequirements.currentBehavior, /without mutating/iu);
	assert.match(featureRequirements.currentBehavior, /exact-schema-17 non-null V2 retime state.*either video clip store.*framescaper\.video-retime.*org\.soundscaper\.capability\.video-retime.*Video retime maps.*bypass.*fallback null.*publisher-authored same-feature.*cannot suppress or replace.*rendered fallback rejects.*Null-only V17.*no retime requirement/iu);

	const currentScapeFeatureRequirements = rules.get('current-scape-feature-requirements');
	assert.deepEqual(currentScapeFeatureRequirements.evidence, [
		'src/common/editor/retention.js', 'src/common/editor/project-feature-requirements.ts',
		'src/common/editor/scape-export-plan.ts', 'src/common/editor/scape-project.js',
		'src/common/editor/scape-project-assets.ts',
		'tests/audio-editor-feature-requirement-retention.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts', 'tests/audio-editor-scape-video-clip-fallback-roundtrip.test.ts',
		'tests/audio-editor-scape-audio-track-fallback-roundtrip.test.ts',
		'tests/audio-editor-scape-return-roundtrip.test.ts', 'tests/audio-editor-scape-video-return-roundtrip.test.ts',
	]);
	assert.match(
		currentScapeFeatureRequirements.currentBehavior,
		/rendered-fallback.*compaction.*every project source asset.*preserves each closed relationship.*video-clip-render-v1.*exact target clip ID.*audio-track-render-v1.*exact target track ID.*copy collision.*remaps the fallback source ID.*preserving.*target clip or track ID/iu,
	);
	assert.match(currentScapeFeatureRequirements.currentBehavior, /product-identified return roundtrips.*portable-archive route in both directions for all four closed roles.*Soundscaper-sent audio-track-render-v1 and whole-mix project-audio-mix-v1.*Framescaper-sent video-clip-render-v1.*whole-project project-video-render-v1.*rendered-fallback on the less-capable recipient.*re-export the exact portable bodies.*reopen natively editable at the origin.*byte-identical manifests, native effect payloads, and asset digests/iu);
	assert.match(
		currentScapeFeatureRequirements.currentBehavior,
		/digest integrity.*route-specific.*arbitrary future schemas/iu,
	);

	const fallbackIntegrity = rules.get('current-scape-rendered-fallback-integrity');
	assert.deepEqual(fallbackIntegrity.evidence, [
		'src/common/editor/scape-project-assets.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/scape-archive-video.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-project-assets.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts',
		'tests/audio-editor-scape-export-fallback-integrity.test.ts',
		'tests/audio-editor-scape-project.test.js',
		'tests/audio-editor-scape-streaming-video.test.ts', 'tests/audio-editor-scape-video-clip-fallback-roundtrip.test.ts',
	]);
	assert.match(
		fallbackIntegrity.requiredOutcome,
		/current-format.*exact-current-schema.*rendered fallback.*canonical archive asset.*before publication/iu,
	);
	assert.match(
		fallbackIntegrity.currentBehavior,
		/export.*snapshot.*admitted project.*source records.*same source snapshots.*normalized fallback manifest.*accessors.*toJSON hooks.*without invocation.*hash.*reject.*manifest.*commit.*import.*before.*collision.*storage.*body.*SHA-256.*publication/iu,
	);
	assert.match(
		fallbackIntegrity.currentBehavior,
		/import and inspection.*fallback role.*optional target clip or track ID.*source ID.*kind.*SHA-256.*canonical manifest asset.*before collision.*storage.*inspection.*does not read or hash.*asset bodies/iu,
	);
	assert.match(
		fallbackIntegrity.currentBehavior,
		/copy import.*fallback source ID.*preserving.*verified digest.*canonical target clip or track ID.*raw-project.*stored-project.*runtime fallback use.*outside/iu,
	);

	const currentControllerFeatureReport = rules.get('current-controller-feature-report');
	assert.deepEqual(currentControllerFeatureReport.evidence, [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-report-metadata.ts',
		'src/common/editor/session.js',
		'src/common/editor/controller/project-feature-compatibility-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'tests/audio-editor-project-feature-capabilities.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/audio-editor-document-snapshot.test.ts',
	]);
	assert.match(
		currentControllerFeatureReport.currentBehavior,
		/stable broad.*map one-to-one.*strict true.*unavailable.*unregistered.*unknown/iu,
	);
	assert.match(
		currentControllerFeatureReport.currentBehavior,
		/exact schema 17.*actual project history.*before activation side effects.*unavailable or unknown.*intrinsically read-only.*deeply frozen.*session metadata clones.*document snapshot/iu,
	);
	assert.match(currentControllerFeatureReport.currentBehavior, /same-ID tab.*stored read-only declaration.*ignored incoming.*flags/iu);
	assert.match(
		currentControllerFeatureReport.currentBehavior,
		/future schemas.*no report.*featureRequirements is not traversed/iu,
	);

	const postOpenFeatureReport = rules.get('current-post-open-feature-report');
	assert.deepEqual(postOpenFeatureReport.evidence, [
		'src/common/editor/project-feature-requirements.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'src/common/editor/ui/workspace/project-feature-compatibility-notice.ts',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx',
		'tests/audio-editor-project-feature-requirements.test.ts',
		'tests/audio-editor-document-snapshot.test.ts',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]);
	assert.match(
		postOpenFeatureReport.requiredOutcome,
		/activated.*exact-current-schema.*incompatible.*persistent.*structured.*active tab/iu,
	);
	assert.match(
		postOpenFeatureReport.currentBehavior,
		/document snapshot.*directly.*frozen notice.*only unavailable and unknown.*counts/iu,
	);
	assert.match(postOpenFeatureReport.currentBehavior, /non-dismissible.*localized.*document-level.*bounded display names.*stable feature IDs.*availability.*declared.*disposition/iu);
	assert.match(postOpenFeatureReport.currentBehavior, /effective disposition.*structured metadata/iu);
	assert.match(
		postOpenFeatureReport.currentBehavior,
		/available items.*excluded.*evaluator messages.*fallback internals.*not read.*no activation controls.*rendered-fallback substitution.*third-party/iu,
	);
	assert.match(
		postOpenFeatureReport.currentBehavior,
		/compatible or null-report tab.*removes.*switching back.*active tab/iu,
	);
	assert.match(postOpenFeatureReport.currentBehavior, /future schemas.*null report.*does not inspect.*featureRequirements/iu);
	assert.match(
		postOpenFeatureReport.currentBehavior,
		/outside.*separate first-party audio- and video-effect bypass.*role-defined audio.*closed video rendered-fallback rules.*not a generic affected-object placeholder.*per-feature bypass control/iu,
	);

	const audioEffectPlaybackBypass = rules.get('current-first-party-audio-effect-playback-bypass');
	assert.deepEqual(audioEffectPlaybackBypass.evidence, [
		'src/common/editor/project-feature-audio-effect-bypass.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-report-metadata.ts',
		'src/common/editor/session.js',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx',
		'tests/audio-editor-project-feature-audio-effect-bypass.test.ts',
		'tests/audio-editor-project-feature-capabilities.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/audio-editor-document-snapshot.test.ts',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]);
	assert.match(
		audioEffectPlaybackBypass.requiredOutcome,
		/exact-current-schema.*unavailable.*first-party audio rack effects.*bounded non-persisted bypass projection.*canonical state.*visibly identified.*active tab/iu,
	);
	assert.match(
		audioEffectPlaybackBypass.currentBehavior,
		/authoritative actual project history.*exact schema 17.*soundscaper-project.*audioEffects.*unavailable.*declares bypass.*effective bypassed/iu,
	);
	assert.match(
		audioEffectPlaybackBypass.currentBehavior,
		/active, enabled, not-already-bypassed.*track.*mixer-group.*mixer-send.*master.*inactive racks.*disabled or already-bypassed.*missing or foreign/iu,
	);
	assert.match(
		audioEffectPlaybackBypass.currentBehavior,
		/bounded.*4,096.*overflow rejects.*placeholder metadata.*never reads or retains.*params.*context.*state.*payloads/iu,
	);
	assert.match(
		audioEffectPlaybackBypass.currentBehavior,
		/only engine loading.*canonical project.*history.*source loading.*persistence.*save paths.*unchanged.*deeply frozen.*per-tab.*document snapshot/iu,
	);
	assert.match(
		audioEffectPlaybackBypass.currentBehavior,
		/active compatibility notice.*one qualifying requirement.*localized control-free affected-effect placeholders.*effect labels.*track, group, send, or master.*without reading effect payloads/iu,
	);
	assert.match(
		audioEffectPlaybackBypass.currentBehavior,
		/future schemas.*before rack traversal.*unknown or third-party effects.*rendered-fallback substitution.*offline render or export.*activation controls/iu,
	);

	const videoEffectPlaybackBypass = rules.get('current-first-party-video-effect-playback-bypass');
	assert.deepEqual(videoEffectPlaybackBypass.evidence, [
		'src/common/editor/project-feature-video-effect-bypass.ts',
		'src/common/editor/video-effects.js',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-report-metadata.ts',
		'src/common/editor/session.js',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'src/common/editor/ui/workspace/video-preview-effect-bypass.ts',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx',
		'tests/audio-editor-project-feature-video-effect-bypass.test.ts',
		'tests/audio-editor-video-preview-effect-bypass.test.ts',
		'tests/audio-editor-project-feature-capabilities.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/audio-editor-document-snapshot.test.ts',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]);
	assert.match(
		videoEffectPlaybackBypass.requiredOutcome,
		/exact-current-schema.*unavailable.*first-party video effects.*bounded non-persisted bypass projection.*canonical state.*timeline or Project Bin.*active tab/iu,
	);
	assert.match(
		videoEffectPlaybackBypass.currentBehavior,
		/authoritative actual project history.*exact schema 17.*soundscaper-project.*videoEffects.*unavailable.*declares bypass.*effective bypassed/iu,
	);
	assert.match(
		videoEffectPlaybackBypass.currentBehavior,
		/enabled maintained effects.*timeline.*Project Bin.*minimal disabled.*disabled effects.*missing, foreign, or wrong-kind.*untouched/iu,
	);
	assert.match(
		videoEffectPlaybackBypass.currentBehavior,
		/256 characters.*128 characters.*4,096.*across both locations.*overflow rejects.*placeholder entry.*location.*clip ID.*effect ID.*effect type.*without reading or retaining.*params.*context.*state.*opaque payloads/iu,
	);
	assert.match(
		videoEffectPlaybackBypass.currentBehavior,
		/transient engine loading.*WebGL preview.*exact affected effects.*timeline stacks.*trusted metadata.*caching selectors.*unchanged stack references.*canonical project.*history.*source loading.*persistence.*save.*export or offline-render.*unchanged/iu,
	);
	assert.match(
		videoEffectPlaybackBypass.currentBehavior,
		/deeply frozen.*per-tab.*document snapshot.*one qualifying requirement.*localized control-free affected-effect placeholders.*effect labels.*Timeline or Project Bin.*without reading effect payloads/iu,
	);
	assert.match(
		videoEffectPlaybackBypass.currentBehavior,
		/future schemas.*before clip or Project Bin traversal.*unknown or third-party effects.*rendered-fallback substitution.*export or offline render.*activation controls.*earlier Soundscaper project schemas/iu,
	);

	const controllerFallbackIntegrity = rules.get('current-controller-rendered-fallback-integrity');
	assert.deepEqual(controllerFallbackIntegrity.evidence, [
		'src/common/editor/project-fallback-integrity.ts',
			'src/common/editor/project-fallback-integrity-audio.ts', 'src/common/editor/project-fallback-integrity-video.ts', 'src/common/editor/project-fallback-integrity-snapshot.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage.js',
		'src/common/editor/storage/source-read-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/media-asset-load-repository.ts',
		'src/common/editor/storage/media-repository.ts',
		'src/common/editor/controller/project-switch-service.ts',
			'src/common/editor/controller/audio-rendered-fallback-export.ts', 'src/common/editor/controller/video-rendered-fallback-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/session-activation.js',
		'src/common/editor/session.js',
		'src/common/editor/app.js',
		'tests/audio-editor-project-fallback-integrity.test.ts',
			'tests/audio-editor-project-fallback-integrity-selection.test.ts', 'tests/audio-editor-project-fallback-integrity-relationships.test.ts', 'tests/audio-editor-project-fallback-integrity-mixed-selection.test.ts',
			'tests/audio-editor-audio-track-render-fallback-delivery.test.ts',
		'tests/audio-editor-source-read-cancellation.test.ts',
		'tests/audio-editor-media-asset-load.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
			'tests/audio-editor-video-rendered-fallback-export.test.ts', 'tests/audio-editor-mixed-rendered-fallback-video-export.test.ts',
		'tests/desktop-project-library-video-rendered-fallback-handoff.test.ts', 'tests/audio-editor-desktop-shared-project-video-clip-fallback-handoff.test.ts',
		'tests/audio-editor-session-project-activation.test.js',
	]);
	assert.match(
		controllerFallbackIntegrity.requiredOutcome,
		/exact-current-schema.*raw or stored project.*maintained controller.*canonical local stored bytes.*before activation side effects/iu,
	);
		assert.match(controllerFallbackIntegrity.requiredOutcome, /project-video-render-v1 and videoEffects-only video-clip-render-v1 delivery.*exact active claim.*export signal.*canonical native video Blob.*directly reuse.*immutable bytes.*one.*audio whole-mix.*joint.*admission.*before.*plan.*media.*FFmpeg.*output/iu);
	assert.match(
		controllerFallbackIntegrity.currentBehavior,
		/authoritative exact-schema-17.*same-ID tab history.*session-owned history token.*exclusive session activation reservation.*before project-generation invalidation.*engine shutdown.*lock changes.*source loading.*persistence.*history replacement.*close.reopen.*competing active-project publication.*session publication.*released in finally/iu,
	);
	assert.match(
		controllerFallbackIntegrity.currentBehavior,
		/audio-f32le-chunks-v1.*65,536-chunk.*video.*immutable.*Blob.*4 MiB.*64 GiB.*before fallback body reads/iu,
	);
	assert.match(controllerFallbackIntegrity.currentBehavior, /Admission reads publish no storage maintenance/iu);
	assert.match(controllerFallbackIntegrity.currentBehavior, /sequential.*cooperatively cancellable.*read-only video-metadata.*raced against cancellation.*signal-ignoring provider.*continue after admission rejects.*provider-stalled fallback body read.*delay cancellation settlement.*iterator cleanup/iu);
	assert.match(controllerFallbackIntegrity.currentBehavior, /deduplicates identical source claims.*conflicting digests.*conflicting relationship roles.*target clip or track IDs.*before storage reads/iu);
		assert.match(controllerFallbackIntegrity.currentBehavior, /joint.*selector.*audio.*video.*active requirement ID.*feature ID.*relationship role.*target clip ID.*kind.*source ID.*SHA-256.*admission snapshot.*canonical source.*duration.*maintained video effects.*role, target, or context drift.*cumulative.*before.*body reads.*private.*provider.*whole-project plan.*sole video input.*clip-local plan.*selected target input.*without a second fallback storage read/iu);
	assert.match(
		controllerFallbackIntegrity.currentBehavior,
			/empty manifests.*future schemas.*no asset reads.*not traversed.*point-in-time.*provider.*immutable-Blob identity reuse.*not a durable lease.*storage record.*cross-process replacement.*nonselected fallback body.*simultaneous.*beyond.*one-audio.one-video.*direct store\.loadProject.*publisher authenticity.*other-role.*third-party feature-code/iu,
	);

	const currentScapePreOpenFeatureReport = rules.get('current-scape-pre-open-feature-report');
	assert.deepEqual(currentScapePreOpenFeatureReport.evidence, [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/controller/project-feature-compatibility-service.ts',
		'src/common/editor/controller/scape-inspection-service.ts',
		'src/common/editor/controller/scape-project-file-service.ts',
		'src/common/editor/scape-project.js',
		'src/common/editor/app.js',
		'tests/audio-editor-scape-feature-requirements.test.ts',
		'tests/audio-editor-scape-inspection-service.test.ts',
		'tests/audio-editor-scape-project-file-service.test.ts',
	]);
	assert.match(
		currentScapePreOpenFeatureReport.currentBehavior,
		/selected product.*provider-owned.*caller.*override.*archive.*source.*validation.*exact schema 17.*before.*collision lookup.*deeply frozen/iu,
	);
	assert.match(
		currentScapePreOpenFeatureReport.currentBehavior,
		/future project schemas.*null.*featureRequirements.*not traversed.*foundation.*open.*decision/iu,
	);

	const currentScapeOpenFeatureDecision = rules.get('current-scape-open-feature-decision');
	assert.equal(currentScapeOpenFeatureDecision.status, 'implemented');
	for (const reference of [
		'src/common/editor/controller/scape-open-request-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/ui/workspace/scape-open-decision-continuation.ts',
		'src/common/editor/ui/workspace/ScapeOpenDecisionDialog.jsx',
		'tests/audio-editor-scape-open-request-service.test.ts',
		'tests/audio-editor-scape-open-decision-continuation.test.ts',
		'tests/audio-editor-scape-open-decision-dialog.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]) assert.ok(currentScapeOpenFeatureDecision.evidence.includes(reference), reference);
	assert.match(
		currentScapeOpenFeatureDecision.currentBehavior,
		/no-collision.*open-read-only.*cancel.*combined.*copy-read-only.*cancel.*one.*decision/iu,
	);
	assert.match(
		currentScapeOpenFeatureDecision.currentBehavior,
		/cancel.*before.*import.*persistence.*activation.*actual project history.*intrinsically read-only/iu,
	);
	assert.match(currentScapeOpenFeatureDecision.currentBehavior, /localized.*stable feature ID.*declared disposition.*default focus.*Cancel.*Escape/iu);

	const binaryOpaqueState = rules.get('binary-opaque-native-state');
	assert.deepEqual(binaryOpaqueState.evidence, [
		'src/common/editor/aup4-effects.js',
		'src/common/editor/scape-project-document.ts',
		'src/common/editor/scape-project-json-preflight.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-project.js',
		'tests/aup4-effects.test.js',
		'tests/audio-editor-scape-project-document.test.ts',
		'tests/audio-editor-scape-project.test.js',
	]);
	assert.match(binaryOpaqueState.requiredOutcome, /Uint8Array.*ArrayBuffer.*exact-current-schema.*current-format.*tagged.*bounded.*byte-exactly.*without activation/iu);
	assert.match(
		binaryOpaqueState.currentBehavior,
		/before JSON\.parse.*every schema.*iterative raw-JSON structural preflight.*101,536 values.*depth 130.*descriptor allowance.*round-trip closure/iu,
	);
	assert.match(
		binaryOpaqueState.currentBehavior,
		/exact schema 17.*export.*Uint8Array.*offset-view.*ArrayBuffer.*reserved tagged descriptor.*export and post-parse decode.*independently.*100,000 traversal nodes.*depth 128.*other ArrayBuffer views reject/iu,
	);
	assert.match(
		binaryOpaqueState.currentBehavior,
		/binary budget.*256 payloads.*4 MiB.*8 MiB/iu,
	);
	assert.match(
		binaryOpaqueState.currentBehavior,
		/import and inspection.*closed descriptor.*unique positive IDs.*canonical base64.*exact byte lengths.*before allocating.*declared binary type.*without interpreting.*reserved-tag collisions.*accessor.*toJSON.*future-schema tag-shaped data.*structurally counted.*raw preflight.*neither decoded nor interpreted/iu,
	);

	const unavailable = rules.get('unavailable-native-feature');
	assert.equal(unavailable.status, 'planned');
	assert.match(
		unavailable.currentBehavior,
		/controller report.*\.scape.*inspection report.*owned first-party audio- and video-effects requirements.*audio-effect slice.*transient engine bypass projection.*video-effect slice.*minimal disabled activation copies.*WebGL preview.*persistent localized control-free affected-object placeholders.*actionable.*pre-open.*persistent document-level post-open report.*intrinsically read-only/iu,
	);
	assert.match(
		unavailable.currentBehavior,
		/archive.*fallback.*integrity.*controller activation.*local audio and video fallback bytes.*supported Uint8Array.*ArrayBuffer.*opaque native\/effect state.*byte-exactly.*without activation.*other buffer views.*unsupported/iu,
	);
	assert.match(
		unavailable.currentBehavior,
			/role-defined audio whole-mix, first-party audioEffects-only track-local audio, and whole-project video or first-party videoEffects-only clip-local fallback slices.*editor playback.*whole-project role.*neutral full-source clip.*frame zero.*closed clip role.*only its exact target.*controller body and relationship verification.*required-source activation.*one-audio.one-video final-video composition.*generic per-object placeholders.*rendered-fallback runtime use beyond the closed audio whole-mix, audio track, and maintained video relationships.*simultaneous fallback delivery beyond that composition.*fallback-authoring workflows beyond the closed relationship.*future-schema archive preservation.*not implemented/iu,
	);
	assert.ok(unavailable.evidence.includes('src/common/editor/project-feature-video-rendered-fallback.ts')); assert.ok(unavailable.evidence.includes('src/common/editor/project-feature-video-clip-render-v1.ts'));
	assert.ok(unavailable.evidence.includes('tests/audio-editor-project-feature-video-rendered-fallback.test.ts')); assert.ok(unavailable.evidence.includes('tests/audio-editor-project-feature-video-clip-render-v1.test.ts'));

	const audioFreezeFallback = rules.get('audio-freeze-fallback');
	assert.match(
		audioFreezeFallback.currentBehavior,
		/Selected Soundscaper V23 owns audio-track freeze, refresh, unfreeze, and commit.*post-insert, pre-strip.*no PCM enters project JSON.*digest-bound.*Only a fresh record owns an audio-track-render-v1 rendered fallback.*stale or unverifiable record.*bypass with no fallback.*never selected for playback.*format-1 Scape.*Soundscaper desktop V10.*Administrative Scape source-ID remapping.*Framescaper keeps audioTrackFreeze unavailable.*exact V23 archive.*byte-stable return/iu,
	);
	assert.ok(audioFreezeFallback.evidence.includes('src/common/editor/audio-track-freeze-v21.ts'));
	assert.ok(audioFreezeFallback.evidence.includes('src/soundscaper/editor-project-feature-requirements-v23.ts'));
	assert.ok(audioFreezeFallback.evidence.includes('tests/audio-editor-soundscaper-v23-persistence-interchange.test.ts'));
	const videoProxyFallback = rules.get('video-proxy-fallback');
	assert.match(
		videoProxyFallback.currentBehavior,
		/originals remain authoritative.*shipped FFmpeg.*every frame at the presentation time.*display geometry.*conformance refuses a body whose boundaries drift.*selected F31 lazy menu workflow.*immutable V28 foundation.*generation.*attach existing.*detach.*relink.*regenerate.*Original, Proxy, or Auto.*progress.*cancellation.*atomic stale-safe history swap.*leaves the tab editable.*carry an attachment forward only while.*relink.*replace.*reprobe.*reimport.*trim-media.*consolidate.*drops stale state in the same transaction.*reattests each session.*source domain before occurrence retime.*retiming does not detach.*Auto adapts.*original is offline.*Browser export.*V14 evaluated-RGBA carrier.*final delivery.*original.*visibly refuse.*Framescaper owns the videoProxy requirement.*Soundscaper receives V18 attachments only as copy-only preservation.*rendered-fallback relationships remain separate.*not original-to-proxy/iu,
	);
});

test('schema retirement and forward-read rules fail closed without claiming unsupported losslessness', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const retirement = policy.schemaRetirement;

	assert.equal(retirement.currentMinimumVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(retirement.automaticRemoval, false);
	assert.deepEqual(retirement.requiredConditions, ['first-shipped-release-baseline']);
	assert.equal(retirement.approval, 'first-release-versioned-policy-change');
	assert.equal(policy.forwardReadOnly.allowMutation, false);
	assert.equal(policy.forwardReadOnly.allowOverwrite, false);
	assert.equal(policy.forwardReadOnly.opaqueClone, 'structured-clone');
	assert.equal(policy.forwardReadOnly.portableArchiveStatus, 'planned');

	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /Core document versus `\.scape`/u);
	assert.match(documentation, /do not promise\s+byte-for-byte/u);
	assert.match(documentation, /exact schema 17.*JSON-semantic.*byte-exact preservation.*supported bounded tagged binary/isu);
	assert.match(documentation, /binary opaque/iu);
	assert.match(
		documentation,
		/before `JSON\.parse`.*every project schema.*iterative raw-JSON\s+structural preflight.*101,536 values.*depth 130.*1,536 values.*two levels.*tagged-descriptor\s+allowance.*round-trip closed/isu,
	);
	assert.match(
		documentation,
		/exact schema 17.*format 1.*Uint8Array.*offset view.*ArrayBuffer.*\$soundscaperOpaqueBinary.*encoding and post-parse decoding.*independently.*100,000 traversed nodes.*depth 128.*256 payloads.*4 MiB.*8 MiB/isu,
	);
	assert.match(
		documentation,
		/validate every descriptor.*unique positive\s+payload ID.*base64.*declared\s+length.*before allocating decoded bytes/isu,
	);
	assert.match(
		documentation,
		/future-schema tag-shaped data.*structurally counted.*raw\s+preflight.*neither decoded nor interpreted/isu,
	);
	assert.match(documentation, /Project feature requirements.*current nested manifest schema 2.*closed rendered-fallback roles.*`video-clip-render-v1`.*nested manifest\s+schema 1.*deterministically normalizes.*whole-project roles.*cannot\s+declare the clip or track relationship/isu);
	assert.match(documentation, /do not hash or authenticate the referenced media bytes/iu);
	assert.match(
		documentation,
		/Schemas 1 through 16.*rejected at the raw-project boundary.*before feature-\s+requirement reconciliation.*exact-schema-17 create, load, clone, and\s+commit.*`soundscaper\.audio-effects`.*non-label.*non-video.*mixer group.*mixer send.*master rack/isu,
	);
	assert.match(
		documentation,
		/`soundscaper\.video-effects`.*timeline or Project Bin.*video clip.*Disabled effects.*inactive audio racks.*missing or foreign.*non-video clips.*publisher declaration.*wins without duplication.*conflicting use.*reserved.*rejects/isu,
	);
	assert.match(documentation, /Current-schema and current-format `\.scape` preservation/iu);
	assert.match(documentation, /independent\s+retention root/iu);
	assert.match(
		documentation,
		/explicit stable broad capability IDs map one-to-one\s+to the maintained keys in each selected product profile/iu,
	);
	assert.match(documentation, /Only a strict `true` value makes a registered feature\s+available/iu);
	assert.match(documentation, /exact schema 17[\s\S]*before activation side effects/iu);
	assert.match(documentation, /actual project history[\s\S]*deeply frozen across session metadata[\s\S]*document snapshot/iu);
	assert.match(documentation, /same-ID tab[\s\S]*stored read-only declaration[\s\S]*ignored incoming[\s\S]*flags/iu);
	assert.match(documentation, /future schemas produce no\s+feature report, and\s+their `featureRequirements` value is not traversed/iu);
	assert.match(
		documentation,
		/first-party audio-effect slice.*transient playback projection.*authoritative activation project.*exact schema 17.*registered audio-effects.*unavailable.*declares bypass.*effective bypassed/isu,
	);
	assert.match(
		documentation,
		/Active, enabled, not-already-bypassed.*track.*mixer-group.*mixer-send.*master.*Inactive\s+racks.*disabled or already-bypassed.*missing or foreign.*4,096.*rejects rather than truncates.*future schemas.*before rack traversal/isu,
	);
	assert.match(
		documentation,
		/canonical project.*history.*source loading.*persistence.*save paths.*do\s+not receive.*Deeply frozen per-tab.*document snapshot.*scope.*owner ID.*effect ID.*effect\s+type.*without reading or retaining.*params.*context.*state.*payloads/isu,
	);
	assert.match(
		documentation,
		/first-party video-effect slice.*transient activation projection.*exact schema 17.*registered video-effects.*unavailable.*declares bypass.*effective bypassed/isu,
	);
	assert.match(
		documentation,
		/Enabled maintained effects.*timeline.*Project Bin.*minimal disabled copies.*disabled effects.*missing, foreign, or wrong-kind.*256 characters.*128 characters.*4,096.*rejects rather\s+than truncates.*future schemas.*before clip or Project Bin traversal/isu,
	);
	assert.match(
		documentation,
		/WebGL\s+preview.*exact affected effects.*timeline stacks.*trusted\s+metadata.*caches.*preserves unchanged stack references.*Canonical project.*history.*source loading.*persistence.*save.*export.*offline-render.*do\s+not receive.*placeholder entry.*location.*clip ID.*effect ID.*effect type.*opaque payloads.*earlier\s+Soundscaper/isu,
	);
	assert.match(
		documentation,
		/active workspace.*`featureRequirementsCompatibility`.*directly.*frozen.*only unavailable and unknown/isu,
	);
	assert.match(documentation, /persistent.*non-dismissible.*document-level.*localized.*counts.*bounded display name.*stable feature ID.*availability.*declared disposition.*active tab/isu);
	assert.match(documentation, /effective\s+disposition.*structured metadata/iu);
	assert.match(
		documentation,
		/does not render.*evaluator.*message.*fallback.*activation control.*feature-code loading/isu,
	);
	assert.match(
		documentation,
		/qualifying audio- or video-effects items.*frozen projection metadata.*one requirement.*persistent localized.*control-free affected-effect placeholders.*Audio rows.*track, group, send, or master.*video rows.*Timeline or Project\s+Bin.*Neither inventory reads effect payloads/isu,
	);
	assert.match(documentation, /compatible or `null`\s+report.*no notice.*future.*not traversed/isu);
	assert.match(
		documentation,
		/programmatic current-format `\.scape`\s+inspection.*selected product.*caller.*override.*exact schema\s+10.*before.*collision lookup.*deeply\s+frozen.*import.*persistence.*activation/isu,
	);
	assert.match(documentation, /Future project\s+schemas.*`null`.*`featureRequirements`.*not traversed/isu);
	assert.match(documentation, /normal no-collision open.*Open read-only.*Cancel/isu);
	assert.match(documentation, /collision.*Open as read-only copy.*Cancel.*single decision/isu);
	assert.match(documentation, /Cancel.*before\s+import, persistence, or\s+activation/isu);
	assert.match(documentation, /controller.*actual project history.*intrinsically read-only/isu);
	assert.match(documentation, /does not establish arbitrary future-schema archive preservation/iu);
	assert.match(documentation, /export.*snapshots.*fallback claims.*before.*destination/isu);
	assert.match(documentation, /inspection.*descriptor binding.*does not read or\s+hash.*asset bodies/isu);
	assert.match(documentation, /import.*hashes.*asset body.*before.*source or project publication/isu);
	assert.match(documentation, /raw and stored-project.*controller activation.*verif(?:y|ies).*authoritative project.*fallback media at runtime.*complete\s+third-party\s+activation gate/isu);
	assert.match(
		documentation,
		/first-party audio- and video-effect bypass slices.*first two\s+steps.*editor playback only/isu,
	);
	assert.match(
		documentation,
		/exact-schema-17 mono\/stereo role-defined audio whole-mix.*role-defined video\s+whole-project.*one first-party video-effects clip-target slice.*narrow forms of step 3.*editor playback.*maintained delivery.*operation-time integrity admission/isu,
	);
	assert.match(documentation,
		/clip and track relationships are\s+durable\s+publisher state.*does not create them.*do not freeze,\s+unfreeze, relink, watch, or refresh a fallback/isu);
	assert.match(documentation,
		/bypass slices do not\s+generalize to unknown or third-party effects.*fallback authoring and selection\s+beyond the closed audio and maintained video roles.*simultaneous fallback\s+delivery beyond the exact one-audio.one-video final-video\s+composition remain\s+planned/isu);
	assert.match(documentation,
		/selected F31 authored proxy lifecycle.*immutable V28 foundation.*source-complete.*resource.*decoder-memory.*external qualification remain open/isu);
	assert.match(documentation,
		/browser export.*V14 carrier.*original-authoritative.*broad\s+rendered-fallback offline-render parity.*outside/isu);
	assert.match(documentation, /Freeze and proxy fallback/u);
});
