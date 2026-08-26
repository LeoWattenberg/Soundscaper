/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const STATUS_VALUES = ['enforced', 'partial', 'planned', 'release-blocked'];
const DISPOSITION_VALUES = ['qualified-current-surface', 'conditional', 'surface-disabled', 'blocked'];
const ROADMAP_THREAT_AREAS = [
	'malformed-projects-media',
	'archive-expansion',
	'native-helpers',
	'third-party-plugins',
	'path-capabilities',
	'job-cancellation',
];
const IMPLEMENTED_ARCHIVE_PREFLIGHT_CONTROLS = [
	'bounded-manifest-and-project-json',
	'central-directory-preflight',
	'cumulative-expanded-byte-limit',
	'descriptor-entry-size-match',
	'encrypted-entry-rejection',
	'inspect-import-validation-parity',
	'reserved-and-extra-entry-ownership',
];
const PENDING_ARCHIVE_EXPANSION_GATES = [];
const IMPLEMENTED_ARCHIVE_EXPANSION_CONTROLS = {
	'cumulative-actual-expanded-byte-limit': [
		'src/common/editor/scape-expanded-byte-budget.ts',
		'src/common/editor/scape-archive-envelope.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'point-in-time-import-capacity-admission': [
		'src/common/editor/app.js',
		'src/common/editor/controller/native-project-service.ts',
		'src/common/editor/controller/storage-capacity-service.ts',
		'src/common/editor/scape-import-capacity.ts',
		'src/common/editor/scape-import-transaction.ts',
		'src/common/editor/scape-project.js',
		'src/common/editor/storage.js',
		'tests/audio-editor-native-scape-open-cancellation.test.ts',
		'tests/audio-editor-scape-import-capacity.test.ts',
		'tests/audio-editor-scape-import-capacity-admission.test.ts',
		'tests/audio-editor-storage-capacity-service.test.ts',
		'tests/audio-editor-storage-persistence.test.ts',
		'tests/desktop-scape-sparse-full-import-integration.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	],
	'safe-pcm-frame-arithmetic': [
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/wavpack/pcm.js',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'zipjs-local-header-and-pairwise-overlap-preflight': [
		'src/common/editor/scape-archive-envelope.ts',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'local-header-and-overlap-validation': [
		'src/common/editor/scape-archive-layout.ts',
		'src/common/editor/scape-archive-reader.ts',
		'src/common/editor/scape-archive-zip-profile.ts',
		'src/common/editor/scape-export-estimate.ts',
		'tests/audio-editor-scape-archive-layout.test.ts',
		'tests/audio-editor-scape-export-estimate.test.ts',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'bounded-archive-operation-counts': [
		'src/common/editor/scape-archive-envelope.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'compression-ratio-or-store-policy': [
		'src/common/editor/scape-archive-envelope.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-archive-envelope.test.ts',
		'tests/audio-editor-scape-expansion.test.ts',
		'tests/audio-editor-scape-project.test.js',
	],
	'bounded-streaming-media-extraction': [
		'src/common/editor/scape-archive-video.ts',
		'src/common/editor/scape-project.js',
		'src/common/editor/storage/media-asset-write-repository.ts',
		'src/common/editor/storage/media-asset-chunk-records.ts',
		'tests/audio-editor-scape-streaming-video.test.ts',
		'tests/audio-editor-streaming-media-storage.test.ts',
		'tests/audio-editor-streaming-media-lifecycle.test.ts',
	],
	'bounded-direct-archive-publication': [
		'src/common/editor/scape-export-destination.ts',
		'src/common/editor/controller/native-scape-save.ts',
		'src/common/editor/file-save-stream.ts',
		'tests/audio-editor-scape-export-destination.test.ts',
		'tests/audio-editor-native-scape-save.test.ts',
		'tests/browser/audio-editor-scape-direct-save.spec.js',
	],
};

async function readMatrix() {
	return JSON.parse(await readFile(matrixUrl, 'utf8'));
}

test('security matrix covers the production threat-model surfaces without promoting gaps', async () => {
	const matrix = await readMatrix();
	const risks = new Map(matrix.risks.map((risk) => [risk.id, risk]));

	assert.equal(matrix.schemaVersion, 1);
	assert.match(matrix.groundedAt, /^\d{4}-\d{2}-\d{2}$/u);
	assert.ok(Date.parse(`${matrix.groundedAt}T00:00:00Z`) <= Date.now());
	assert.deepEqual(Object.keys(matrix.roadmapThreatCoverage).sort(), [...ROADMAP_THREAT_AREAS].sort());
	assert.equal(risks.size, matrix.risks.length, 'risk IDs must be unique');

	for (const area of ROADMAP_THREAT_AREAS) {
		const riskIds = matrix.roadmapThreatCoverage[area];
		assert.ok(riskIds.length > 0, `${area} must map to a risk`);
		for (const riskId of riskIds) assert.ok(risks.has(riskId), `${area} references unknown risk ${riskId}`);
	}

	const expectedStatuses = {
		'external-project-document-validation': 'partial',
		'external-media-parser-bounds': 'partial',
		'scape-archive-structure-integrity': 'enforced',
		'scape-archive-expansion': 'enforced',
		'electron-renderer-ipc-boundary': 'enforced',
		'desktop-static-resource-paths': 'enforced',
		'desktop-read-path-capabilities': 'enforced',
		'desktop-write-path-capabilities': 'partial',
		'shared-desktop-project-library-integrity': 'partial',
		'nyquist-untrusted-code-runtime': 'enforced',
		'reviewed-web-effect-packages': 'enforced',
		'native-helper-processes': 'partial',
		'native-plugin-hosting': 'planned',
		'long-job-cancellation': 'partial',
		'runtime-supply-chain': 'partial',
	};
	assert.deepEqual(
		Object.fromEntries(matrix.risks.map((risk) => [risk.id, risk.status])),
		expectedStatuses,
	);

	for (const risk of matrix.risks) {
		assert.match(risk.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
		assert.ok(STATUS_VALUES.includes(risk.status), `${risk.id} has an invalid status`);
		assert.ok(DISPOSITION_VALUES.includes(risk.releaseDisposition), `${risk.id} has an invalid disposition`);
		assert.ok(risk.boundaryIds.length > 0, `${risk.id} needs a trust boundary`);
		assert.ok(risk.assets.length > 0, `${risk.id} needs a protected asset`);
		assert.ok(risk.currentControls.length > 0, `${risk.id} needs a current control or surface fence`);

		if (risk.status === 'enforced') {
			assert.equal(risk.releaseDisposition, 'qualified-current-surface', risk.id);
			assert.deepEqual(risk.residualRisks, [], `${risk.id} must be narrowly scoped if enforced`);
			for (const control of risk.currentControls) {
				const kinds = new Set(control.evidence.map(({ kind }) => kind));
				assert.ok(kinds.has('implementation'), `${risk.id}/${control.id} needs implementation evidence`);
				assert.ok(kinds.has('test'), `${risk.id}/${control.id} needs test evidence`);
			}
		}
		if (risk.status === 'partial' || risk.status === 'release-blocked') {
			assert.ok(risk.residualRisks.length > 0, `${risk.id} must record residual risk`);
			for (const residual of risk.residualRisks) {
				assert.ok(residual.requiredControl.length > 0, `${risk.id}/${residual.id} needs a required control`);
				assert.ok(residual.acceptanceCriteria.length > 0, `${risk.id}/${residual.id} needs acceptance criteria`);
			}
		}
		if (risk.status === 'planned') {
			assert.equal(risk.releaseDisposition, 'surface-disabled', risk.id);
			assert.ok(risk.residualRisks.length > 0, `${risk.id} needs enablement criteria`);
		}
	}
});

test('planned native plug-in surfaces stay disabled and portable archive controls are qualified', async () => {
	const matrix = await readMatrix();
	const risks = new Map(matrix.risks.map((risk) => [risk.id, risk]));

	for (const riskId of ['native-plugin-hosting']) {
		const risk = risks.get(riskId);
		assert.equal(risk.status, 'planned');
		assert.equal(risk.releaseDisposition, 'surface-disabled');
	}

	const helperProcesses = risks.get('native-helper-processes');
	assert.equal(helperProcesses.status, 'partial');
	assert.equal(helperProcesses.releaseDisposition, 'conditional');
	assert.deepEqual(helperProcesses.currentControls.map(({ id }) => id), [
		'pathless-probe-helper-bridge',
		'helper-contract-v1-wire-validation',
		'supervised-helper-lifecycle',
		'verified-helper-engine-payload',
		'verified-native-helper-payload-selection',
		'native-helper-real-process-proof',
	]);
	for (const control of helperProcesses.currentControls) {
		const kinds = new Set(control.evidence.map(({ kind }) => kind));
		assert.ok(kinds.has('implementation'), `${control.id} needs implementation evidence`);
		assert.ok(kinds.has('test'), `${control.id} needs test evidence`);
	}
	assert.match(
		helperProcesses.residualRisks[0].acceptanceCriteria.join(' '),
		/m5-helper-fault-and-loopback-v1/u,
		'helper qualification stays tied to the registered fixture',
	);

	const archiveStructure = risks.get('scape-archive-structure-integrity');
	assert.equal(archiveStructure.status, 'enforced');
	assert.deepEqual(archiveStructure.residualRisks, []);
	const sourceBijection = archiveStructure.currentControls.find(
		({ id }) => id === 'migrated-project-source-bijection',
	);
	assert.ok(sourceBijection);
	for (const path of [
		'src/common/editor/scape-project-assets.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-project-assets.test.ts',
		'tests/audio-editor-scape-archive-envelope.test.ts',
		'tests/audio-editor-scape-project.test.js',
	]) assert.ok(
		sourceBijection.evidence.some((item) => item.path === path),
		`project source bijection needs evidence from ${path}`);
	assert.match(sourceBijection.summary, /equal source\/descriptor counts.*case-sensitive source IDs.*audio\/video kinds.*before.*storage call/iu);
	const fallbackIntegrity = archiveStructure.currentControls.find(
		({ id }) => id === 'rendered-fallback-asset-integrity');
	assert.ok(fallbackIntegrity);
	for (const path of [
		'src/common/editor/scape-project-assets.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-archive-media.ts', 'src/common/editor/scape-archive-video.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-project-assets.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts',
		'tests/audio-editor-scape-export-fallback-integrity.test.ts',
		'tests/audio-editor-scape-project.test.js', 'tests/audio-editor-scape-streaming-video.test.ts',
		'tests/audio-editor-scape-video-clip-fallback-roundtrip.test.ts',
	]) assert.ok(
		fallbackIntegrity.evidence.some((item) => item.path === path),
		`rendered fallback integrity needs evidence from ${path}`);
	assert.match(
		fallbackIntegrity.summary,
		/exact schema 17.*claim.*relationship role.*target clip ID.*source ID.*kind.*SHA-256.*canonical asset descriptor.*before.*collision.*storage.*export.*project root.*source records.*same sources.*accessors.*toJSON hooks.*without invocation.*completed.*digest.*before.*manifest.*commit.*import.*body.*SHA-256.*publication.*copy collision.*remaps.*source ID.*preserving.*target clip ID.*inspection.*does not hash.*asset bodies/iu,
	);
	const archiveExpansion = risks.get('scape-archive-expansion');
	assert.equal(archiveExpansion.status, 'enforced');
	assert.equal(archiveExpansion.releaseGate.status, 'satisfied');
	assert.deepEqual(
		[...archiveExpansion.releaseGate.requiredControlIds].sort(),
		[...PENDING_ARCHIVE_EXPANSION_GATES].sort(),
	);
	const implementedControls = new Map(archiveExpansion.currentControls.map((control) => [control.id, control]));
	for (const controlId of IMPLEMENTED_ARCHIVE_PREFLIGHT_CONTROLS) {
		const control = implementedControls.get(controlId);
		assert.ok(control, `${controlId} must remain recorded as implemented`);
		assert.ok(
			control.evidence.some(({ path }) => path === 'src/common/editor/scape-archive-envelope.ts'),
			`${controlId} needs envelope implementation evidence`,
		);
		assert.ok(
			control.evidence.some(({ path }) => path === 'tests/audio-editor-scape-archive-envelope.test.ts'),
			`${controlId} needs envelope test evidence`,
		);
	}
	for (const [controlId, paths] of Object.entries(IMPLEMENTED_ARCHIVE_EXPANSION_CONTROLS)) {
		const control = implementedControls.get(controlId);
		assert.ok(control, `${controlId} must be recorded as implemented`);
		for (const path of paths) assert.ok(
			control.evidence.some((item) => item.path === path),
			`${controlId} needs evidence from ${path}`,
		);
	}
	assert.match(
		implementedControls.get('zipjs-local-header-and-pairwise-overlap-preflight').summary,
		/pairwise entry-range overlap/iu,
	);
	assert.match(
		implementedControls.get('local-header-and-overlap-validation').summary,
		/33 MiB.*exact classic\/Zip64.*data descriptor.*without extracting or hashing entry bodies.*before zip\.js construction.*fixed ZIP end-record search.*65,557 bytes.*final payload tail.*greater-than-4-GiB/iu,
	);
	assert.match(
		implementedControls.get('compression-ratio-or-store-policy').summary,
		/central-directory.*ZIP STORE.*before.*body reads/iu,
	);
	assert.match(
		implementedControls.get('bounded-streaming-media-extraction').summary,
		/4 MiB.*awaited transactional storage write.*byte-backed chunks.*legacy Blob rows.*canonical Blob reads.*64 MiB/iu,
	);
	assert.match(
		implementedControls.get('bounded-direct-archive-publication').summary,
		/4 MiB.*independent byte counts.*File System Access.*desktop.*512 MiB/iu,
	);
	const capacitySummary = implementedControls.get('point-in-time-import-capacity-admission').summary;
	for (const claim of [
		/validated manifest assets.*collision-cancel decision.*before copy remapping.*transaction construction.*writer creation/iu,
		/checked safe-integer sum.*ceil\(10%\).*obtains exactly one storage estimate/iu,
		/cancel performs no estimate.*copy and replace.*full incoming asset total.*absent or unknown estimate permits.*known insufficient.*stable frozen.*QUOTA_EXCEEDED/iu,
		/maintained native-controller route.*exclusively.*decorated preflight callback.*raw asset-byte total.*composed import task signal/iu,
		/storage-capacity service.*same exact headroom requirement.*checking.*ready.*unknown.*insufficient.*lastPreflight.*one normalized estimate.*Scape quota decision/iu,
		/cancellation.*signal-ignoring estimate.*no writer or extraction.*restores the prior settled preflight snapshot.*late provider resolution or rejection.*generation-fences older work.*newer state/iu,
		/standalone undecorated imports.*optional direct store estimator.*do not update controller state/iu,
		/8,589,930,860.*9,448,923,946.*before its media writer/iu,
		/does not reserve capacity.*real browser or filesystem quota accuracy.*durable OPFS or IndexedDB 8 GiB.*overhead.*policy headroom.*write-time success.*concurrent writers/iu,
	]) assert.match(capacitySummary, claim);
	const residuals = new Map(archiveExpansion.residualRisks.map((risk) => [risk.id, risk]));
	assert.equal(residuals.has('compression-amplification-policy'), false);
	assert.equal(residuals.has('incomplete-zip-layout-validation'), false);
	const cancellationControl = implementedControls.get('abort-signal-propagation-and-rollback');
	assert.ok(cancellationControl, 'tested archive cancellation must remain recorded as implemented');
	for (const path of [
		'src/common/editor/scape-archive-reader.ts',
		'src/common/editor/scape-import-transaction.ts',
		'src/common/editor/scape-export-destination.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'tests/audio-editor-scape-cancellation.test.ts',
		'tests/audio-editor-source-read-cancellation.test.ts',
		'tests/audio-editor-source-write-cancellation.test.ts',
		'tests/audio-editor-native-project-service.test.ts',
		'tests/audio-editor-native-scape-open-cancellation.test.ts',
		'tests/audio-editor-file-service.test.js',
	]) {
		assert.ok(
			cancellationControl.evidence.some((item) => item.path === path),
			`archive cancellation needs evidence from ${path}`,
		);
	}
	assert.ok(implementedControls.has('bounded-streaming-media-extraction'));
	const cancellation = risks.get('long-job-cancellation');
	const scapeInspection = cancellation.currentControls.find(
		({ id }) => id === 'owned-scape-inspection-lifecycle',
	);
	assert.ok(scapeInspection);
	for (const path of [
		'src/common/editor/controller/scape-inspection-service.ts',
		'src/common/editor/controller/action-facade.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/scape-abort.ts',
		'src/common/editor/scape-project.js',
		'src/common/editor/storage.js',
		'src/common/editor/storage/project-repository.ts',
		'src/common/editor/app.js',
		'tests/audio-editor-scape-inspection-service.test.ts',
		'tests/audio-editor-scape-inspection-controller.test.ts',
		'tests/audio-editor-scape-inspection-storage-cancellation.test.ts',
		'tests/audio-editor-project-load-cancellation.test.ts',
		'tests/audio-editor-storage-repositories.test.ts',
		'tests/audio-editor-controller-action-facade.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
	]) assert.ok(scapeInspection.evidence.some((item) => item.path === path));
	assert.match(
		scapeInspection.summary,
		/distinct named controller task.*snapshots caller options.*composes the caller signal.*replacement.*project switching.*terminal disposal.*post-await current-task check.*signal-ignoring late results.*finally releases completed tasks.*project-collision read.*races stalled database admission.*aborts and drains.*read-only IndexedDB transaction.*exact cancellation reason.*retention capability.*normalizes and registers.*same inspection admission.*synchronous read callback.*returning the provider promise.*abort race.*signal-ignoring provider.*closes its archive reader.*suppresses the late result or failure/iu,
	);
	const scapeInspectionQuiescence = cancellation.currentControls.find(
		({ id }) => id === 'fenced-scape-inspection-quiescence',
	);
	assert.ok(scapeInspectionQuiescence);
	for (const path of [
		'src/common/editor/controller/scape-inspection-quiescence.ts',
		'src/common/editor/controller/scape-inspection-service.ts',
		'src/common/editor/controller/scape-project-file-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/scape-abort.ts',
		'src/common/editor/scape-archive-reader.ts',
		'src/common/editor/app.js',
		'tests/audio-editor-scape-inspection-quiescence.test.ts',
		'tests/audio-editor-scape-inspection-quiescence-bounds.test.ts',
		'tests/audio-editor-scape-inspection-service.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-project-switch-inspection-timeout.test.ts',
		'tests/audio-editor-scape-inspection-controller.test.ts',
	]) assert.ok(scapeInspectionQuiescence.evidence.some((item) => item.path === path));
	assert.match(
		scapeInspectionQuiescence.summary,
		/registers before its first await.*retains current and superseded generations.*archive-reader cleanup.*registered injected collision-provider settlement.*eight lower-only production slots.*synchronously before task creation or archive work.*reference-counted temporary fence.*shared legacy supersession AbortError per admission.*permanent fence.*exact lifetime reason.*30-second settlement deadline per inspection.*reused without reset.*exact registration abort reason.*provider fulfillment or rejection.*without replacing.*primary outcome.*typed non-benign barrier failure.*aggregates.*cleanup failures.*does not remove or release.*capacity charge.*actually settles.*project switching rejects before project work.*disposal continues remaining engine and storage teardown.*rejecting/iu,
	);
	const scapeOpenDecisionContinuation = cancellation.currentControls.find(
		({ id }) => id === 'owned-scape-open-decision-continuation',
	);
	assert.ok(scapeOpenDecisionContinuation);
	for (const path of [
		'src/common/editor/controller/scape-open-request-service.ts',
		'src/common/editor/controller/scape-project-file-service.ts',
		'src/common/editor/controller/action-facade.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/ui/workspace/scape-open-decision-continuation.ts',
		'src/common/editor/ui/workspace/useScapeOpenDecisionContinuation.ts',
		'src/common/editor/ui/workspace/ScapeOpenDecisionDialog.jsx',
		'src/common/editor/ui/workspace/AudioEditorWorkspace.jsx',
		'src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx',
		'src/common/editor/ui/workspace/useAudioEditorWorkspaceLifecycle.js',
		'src/common/editor/ui/AudioEditorDialogShell.tsx',
		'src/common/editor/app.js',
		'src/common/editor/controller/native-project-service.ts',
		'tests/audio-editor-scape-open-request-service.test.ts',
		'tests/audio-editor-native-scape-open-cancellation.test.ts',
		'tests/audio-editor-scape-project-file-service.test.ts',
		'tests/audio-editor-scape-open-decision-continuation.test.ts',
		'tests/audio-editor-scape-open-decision-dialog.test.ts',
		'tests/audio-editor-scape-inspection-controller.test.ts',
		'tests/audio-editor-controller-action-facade.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/browser/audio-editor-scape-direct-save.spec.js',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]) assert.ok(scapeOpenDecisionContinuation.evidence.some((item) => item.path === path));
	assert.match(
		scapeOpenDecisionContinuation.summary,
		/replaceable request task.*before inspection.*signal.*closed.*open decision.*native-open settlement.*opaque prompt.*exact identity.*replacement.*project switching.*terminal disposal.*exact cancellation reasons.*explicit user cancel.*native-import cleanup.*cleared busy flag.*project activation.*generation.*default.*Cancel.*Escape.*focus/iu,
	);
	const generationGuards = cancellation.currentControls.find(
		({ id }) => id === 'controller-generation-and-abort-guards',
	);
	assert.ok(generationGuards);
	assert.ok(generationGuards.evidence.some(
		({ path }) => path === 'tests/audio-editor-native-scape-open-cancellation.test.ts',
	));
	assert.match(generationGuards.summary, /importing flag.*external project generation change.*older owner.*newer work/iu);
	const projectIoResidual = cancellation.residualRisks.find(
		({ id }) => id === 'project-io-signal-propagation',
	);
	assert.ok(projectIoResidual);
	assert.doesNotMatch(projectIoResidual.exposure, /inspection has no owned controller task/iu);
	assert.doesNotMatch(projectIoResidual.exposure, /collision continuation.*outside controller lifetime/iu);
	assert.doesNotMatch(projectIoResidual.exposure, /inspection store lookup.*no abortable repository API/iu);
	assert.doesNotMatch(projectIoResidual.exposure, /do not join inspection cleanup|abort but do not join|injected lookup can continue after that boundary rejects|hold lifecycle barriers indefinitely|no provider deadline or admission cap/iu);
	assert.doesNotMatch(projectIoResidual.exposure, /whole-file desktop reads/iu);
	assert.match(
		projectIoResidual.exposure,
		/inspection.*collision continuation.*own cancellation.*default inspection collision lookup.*owned signal.*races stalled database admission.*aborts and drains.*read-only IndexedDB transaction.*signal-ignoring injected lookups.*closes the archive reader.*registers and retains.*normalized provider promise.*project switching.*controller disposal.*join.*provider settlement.*lower-only per-inspection deadline.*admission.*capacity-bounded.*provider.*continue consuming resources.*typed barrier timeout.*keeps its admission slot.*does not sandbox or force-terminate.*desktop materializer.*supplied signal.*release.*abort.*open.*import.*does not consistently own or provide.*AUP4.*broad storage operations/iu,
	);
	const streamedMaintenance = cancellation.currentControls.find(
		({ id }) => id === 'streamed-media-maintenance-abort',
	);
	assert.ok(streamedMaintenance);
	for (const path of [
		'src/common/editor/storage/media-asset-cleanup-error.ts',
		'src/common/editor/storage/media-asset-lifecycle-coordinator.ts',
		'src/common/editor/storage/media-asset-staged-sink.ts',
		'src/common/editor/storage/media-asset-write-admission.ts',
		'src/common/editor/storage/media-asset-write-repository.ts',
		'src/common/editor/storage/media-repository.ts',
		'src/common/editor/storage/opfs-repository.ts',
		'src/common/editor/storage/retention-repository.ts',
		'src/common/editor/storage.js',
		'tests/audio-editor-media-write-admission.test.ts',
		'tests/audio-editor-streaming-media-lifecycle.test.ts',
	]) assert.ok(streamedMaintenance.evidence.some((item) => item.path === path));
	assert.match(
		streamedMaintenance.summary,
		/every streamed-writer begin.*passes synchronous argument and signal validation.*per-store lifecycle.*before its first awaited backend operation.*after staging preparation returns.*chunk-token or OPFS-path identity.*terminal writer abort.*before begin can return.*clear.*temporary admission fence.*close.*permanent.*reject later begins.*drain captured pre-staging begins.*abort staged chunk or OPFS sinks.*active writers.*cannot settle.*pre-fence begin.*return a live writer.*publish late state.*cleanup failure.*rejects the maintenance barrier/iu,
	);
	const serializedMaintenance = cancellation.currentControls.find(
		({ id }) => id === 'serialized-store-maintenance-shutdown',
	);
	assert.ok(serializedMaintenance);
	for (const path of [
		'src/common/editor/storage.js',
		'src/common/editor/storage/retention-repository.ts',
		'tests/audio-editor-media-digest-lifecycle.test.ts',
		'tests/audio-editor-storage-lifecycle.test.js',
	]) assert.ok(serializedMaintenance.evidence.some((item) => item.path === path));
	assert.match(
		serializedMaintenance.summary,
		/one active clear.*one shared close barrier.*clear establishes media maintenance.*captures its backend-admission promise.*before its first wait.*close installs the permanent media fence.*terminal facade state.*before its first await.*joins an already admitted clear.*concurrent close callers return the same terminal-cleanup promise.*admitted clear retains its normal memory fallback.*unrelated pending database admission remains fenced when no clear is active.*clear settles before close.*neither close caller settles.*media operation drains/iu,
	);
	assert.ok(cancellation.currentControls.some(({ id }) => id === 'direct-scape-save-rollback'));
	const stagingLeases = cancellation.currentControls.find(
		({ id }) => id === 'cross-context-streamed-media-staging-leases',
	);
	assert.ok(stagingLeases);
	for (const path of [
		'src/common/editor/storage/media-asset-staging-schema.ts',
		'src/common/editor/storage/media-asset-staging-repository.ts',
		'src/common/editor/storage/media-asset-staged-sink.ts',
		'src/common/editor/storage/media-asset-disposal-repository.ts',
		'src/common/editor/storage/media-asset-write-repository.ts',
		'src/common/editor/storage/retention-repository.ts',
		'tests/audio-editor-cross-context-media-lifecycle.test.ts',
		'tests/audio-editor-media-asset-disposal.test.ts',
		'tests/browser/audio-editor-storage-publication.spec.js',
	]) assert.ok(stagingLeases.evidence.some((item) => item.path === path));
	assert.equal(cancellation.currentControls.some(
		({ id }) => id === 'lazy-legacy-media-digest-backfill',
	), false);
	const digestMaintenance = cancellation.currentControls.find(
		({ id }) => id === 'retained-media-load-maintenance-quiescence',
	);
	assert.ok(digestMaintenance);
	for (const path of [
		'src/common/editor/storage/media-asset-lifecycle-coordinator.ts',
		'src/common/editor/storage/media-asset-load-repository.ts',
		'src/common/editor/storage/media-repository.ts',
		'src/common/editor/storage/retention-repository.ts',
		'src/common/editor/storage.js',
		'tests/audio-editor-media-digest-lifecycle.test.ts',
		'tests/audio-editor-media-asset-load.test.ts',
	]) assert.ok(digestMaintenance.evidence.some((item) => item.path === path));
	assert.match(
		digestMaintenance.summary,
		/registers synchronously.*same per-store lifecycle.*before its first await.*clear.*temporary admission fence.*close.*permanent fence.*signal captured loads.*await terminal settlement.*data deletion or database close.*multi-chunk.*observes the maintenance abort.*cannot return a payload.*standalone clear.*reopens admission.*close remains terminal/iu,
	);
	assert.equal(cancellation.residualRisks.some(
		({ id }) => id === 'legacy-media-digest-lifecycle-quiescence',
	), false);
	assert.equal(
		cancellation.residualRisks.some(({ id }) => id === 'cross-context-storage-maintenance'),
		false,
	);
	const desktopWrite = risks.get('desktop-write-path-capabilities');
	const saveShutdown = desktopWrite.currentControls.find(
		({ id }) => id === 'terminal-save-shutdown-quiescence',
	);
	assert.ok(saveShutdown);
	for (const path of [
		'desktop/save-targets.js',
		'desktop/main.mjs',
		'desktop/application-lifecycle.ts',
		'tests/desktop-save.test.js',
		'tests/desktop-application-lifecycle.test.ts',
	]) assert.ok(saveShutdown.evidence.some((item) => item.path === path));
	assert.match(
		saveShutdown.summary,
		/synchronously rejects new target and save-session admission.*sync-and-rename.*late-opened staging.*idempotent disposal barrier.*rejects on unacknowledged handle close or staging removal/iu,
	);
	const rendererOwnedSave = desktopWrite.currentControls.find(
		({ id }) => id === 'renderer-document-owned-save-lifecycle',
	);
	assert.ok(rendererOwnedSave);
	for (const path of [
		'desktop/renderer-save-owner.js',
		'desktop/save-targets.js',
		'desktop/main.mjs',
		'tests/desktop-renderer-save-owner.test.js',
		'tests/desktop-save-ownership.test.js',
		'tests/desktop-project-library-packaging.test.js',
		'tests/desktop-protocol.test.js',
	]) assert.ok(rendererOwnedSave.evidence.some((item) => item.path === path));
	assert.match(
		rendererOwnedSave.summary,
		/committed main-document owner.*synchronously fences admission.*delayed dialog results.*drains admitted begin.*chunk.*finish.*abort.*sync-and-rename.*aborts remaining staging.*fresh-owner session admission waits.*stale commit cannot overtake/iu,
	);
	assert.equal(desktopWrite.residualRisks.some(
		({ id }) => id === 'write-capacity-and-disk-admission',
	), false);
	assert.equal(
		desktopWrite.residualRisks.some(({ id }) => id === 'write-owner-and-capacity-lifecycle'),
		false,
	);

});
