/* SPDX-License-Identifier: AGPL-3.0-only */

// Single source for the packaged source-bearing handoff qualification pins
// shared by tests/production-security-packaged-source-bearing-handoff.test.js
// and tests/project-compatibility-desktop-library-policy.test.js. The
// workflow-ID groups come from scripts/lib/policy-narratives.mjs, and the
// threat-model paragraph is a derived narrative of the matrix summary, so the
// same fragment chain pins both texts.

import {
	ELECTRON_LIBRARY_WORKFLOWS,
	FALLBACK_ROUNDTRIP_WORKFLOWS,
	FALLBACK_WITNESS_ROLES,
} from '../../scripts/lib/policy-narratives.mjs';

export { ELECTRON_LIBRARY_WORKFLOWS, FALLBACK_ROUNDTRIP_WORKFLOWS, FALLBACK_WITNESS_ROLES };

export const PACKAGED_HANDOFF_EVIDENCE = Object.freeze([
	['implementation', 'desktop/project-library-source-bearing-smoke.js'],
	['implementation', 'desktop/project-library-fallback-role-witnesses.js'],
	['implementation', 'desktop/project-library-source-bearing-renderer-smoke.js'],
	['implementation', 'desktop/project-library-source-bearing-smoke-session.js'],
	['implementation', 'src/common/editor/edit-blocking.ts'],
	['implementation', 'src/common/editor/controller/document-snapshot.ts'],
	['implementation', 'src/common/editor/ui/application-menus.js'],
	['implementation', 'src/common/editor/ui/workspace/AudioEditorWorkspace.jsx'],
	['implementation', 'src/common/editor/ui/workspace/workspace-application-menu-runtime.js'],
	['implementation', 'desktop/project-library-smoke-evidence.js'],
	['implementation', 'desktop/desktop-smoke.js'],
	['implementation', 'desktop/main.mjs'],
	['implementation', 'scripts/lib/desktop-project-library-source-bearing-handoff.mjs'],
	['implementation', 'scripts/desktop-project-library-source-bearing-handoff-smoke.mjs'],
	['test', 'tests/desktop-project-library-source-bearing-smoke.test.js'],
	['test', 'tests/desktop-project-library-source-bearing-session.test.js'],
	['test', 'tests/desktop-project-library-source-bearing-probe.test.js'],
	['test', 'tests/desktop-project-library-source-bearing-handoff-runner.test.js'],
	['test', 'tests/desktop-project-library-fallback-return-roundtrip.test.js'],
	['test', 'tests/audio-editor-ui-edit-blocking.test.ts'],
	['test', 'tests/desktop-project-library-smoke-evidence.test.js'],
	['test', 'tests/desktop-project-library-packaging.test.js'],
	['implementation', 'package.json'],
	['workflow', '.github/workflows/desktop-preview.yml'],
].map(([kind, path]) => Object.freeze({ kind, path })));

export function claimChain(fragments, flags) {
	return new RegExp(fragments.flat().join('.*'), flags);
}

// The security-matrix summary narrative; the threat-model paragraph is its
// derived policy narrative, so the identical fragments pin both documents.
const HANDOFF_NARRATIVE_FRAGMENTS = Object.freeze([
	'Linux x64 CI',
	'two frozen Electron workflow IDs',
	'six sequential packaged Soundscaper and Framescaper UI processes',
	'isolated shared appData',
	'separate product profiles',
	'origin profile',
	'exact schema 15',
	'one canonical-PCM audio track and clip',
	'one retained-original VP8 WebM video track and clip',
	'Project Bin',
	'fresh recipient',
	'normal project route into editor activation',
	'hashes the exact Project Bin Blob',
	'starts and stops transport',
	'edits the audio track name',
	'native input',
	'revision 2',
	'visible Edit in',
	'other product',
	'two exact-schema-15 read-only role witnesses',
	...FALLBACK_WITNESS_ROLES,
	'role-specific compatibility indicator',
	'visible cross-product handoff',
	'Feature-requirement read-only',
	'only read-only',
	'busy',
	'lock-read-only',
	'blocked',
	'origin return',
	'indicator absent',
	'track-name editor enabled',
	...FALLBACK_ROUNDTRIP_WORKFLOWS,
	'canonical-document',
	'canonical-source-body',
	'fallback-body SHA-256',
	'increasing catalog revisions and fencing tokens',
]);

const HANDOFF_QUALIFICATION_FRAGMENTS = Object.freeze([
	'qualifies only',
	...ELECTRON_LIBRARY_WORKFLOWS,
	'four exact role-return workflow IDs',
	'fixed small first-party fixture',
	'Linux x64',
	'web `.scape` workflow matrix',
	'qualified separately',
	'muted audio',
	'audible or device output',
	'Packaged activation',
	'fallback playback',
	'unchanged project handoff',
	'editable origin return',
	'only',
	'four frozen rendered-fallback roles',
	'packaged rendered-media delivery',
	'fallback authoring',
	'other relationships',
	'general browser or codec',
	'linked or unmanaged media',
	'installers or file associations',
	'concurrency',
	'crash',
	'power loss',
	'Windows, macOS, (?:and|or) ARM64',
]);

// The compatibility register narrative; docs/project-compatibility.md carries
// its derived, 80-column-wrapped policy narrative, so the doc chains reuse
// these fragments with every space made wrap-tolerant.
const RULE_BEHAVIOR_NARRATIVE_FRAGMENTS = Object.freeze([
	'Linux x64',
	'two frozen Electron workflows',
	'six sequential packaged executable processes',
	'isolated shared appData',
	'separate product profiles',
	'origin profile',
	'exact schema 15',
	'canonical PCM',
	'retained-original VP8 WebM',
	'Project Bin',
	'fresh recipient',
	'normal project route into editor activation',
	'hashes the exact Project Bin Blob',
	'starts and stops transport',
	'edits the audio track name',
	'native input',
	'revision 2',
	'visible Edit in',
	'other product',
	'two additional exact-schema-15 role witnesses',
	...FALLBACK_WITNESS_ROLES,
	'role-specific compatibility indicator',
	'visible cross-product handoff',
	'Feature-requirement read-only',
	'busy',
	'read-only project lock',
	'blocked',
	'origin return',
	'compatibility indicator absent',
	'track-name editor',
	'without mutation',
	...FALLBACK_ROUNDTRIP_WORKFLOWS,
	'canonical-document',
	'canonical-source-body',
	'fallback-body SHA-256',
	'increasing catalog revisions and fencing tokens',
]);

const RULE_BEHAVIOR_QUALIFICATION_FRAGMENTS = Object.freeze([
	'qualifies only',
	...ELECTRON_LIBRARY_WORKFLOWS,
	'four exact role-return workflow IDs',
	'web `.scape` workflow matrix is qualified separately',
	'fixed small first-party fixtures',
	'Linux x64',
	'muted audio',
	'qualifies packaged activation',
	'fallback playback',
	'unchanged project handoff',
	'editable origin return only for the four frozen rendered-fallback roles',
	'does not qualify packaged rendered-media delivery',
	'fallback authoring',
	'other relationships',
	'audible or device-output fidelity',
	'general browser or codec coverage',
	'linked or unmanaged media',
	'installers or file associations',
	'concurrent opens',
	'crash',
	'power[- ]loss',
	'Windows, macOS, or ARM64',
]);

function wrapTolerant(fragments) {
	return fragments.flat().map((fragment) => fragment.replaceAll(' ', '\\s+'));
}

export const PACKAGED_HANDOFF_CLAIMS = Object.freeze({
	matrixSummary: claimChain(HANDOFF_NARRATIVE_FRAGMENTS, 'iu'),
	matrixQualification: claimChain(HANDOFF_QUALIFICATION_FRAGMENTS, 'iu'),
	threatModel: claimChain([
		...HANDOFF_NARRATIVE_FRAGMENTS,
		...HANDOFF_QUALIFICATION_FRAGMENTS,
	], 'isu'),
	compatibilityRuleBehavior: claimChain(RULE_BEHAVIOR_NARRATIVE_FRAGMENTS, 'iu'),
	compatibilityRuleQualification: claimChain(RULE_BEHAVIOR_QUALIFICATION_FRAGMENTS, 'iu'),
	compatibilityDocWorkflow: claimChain(wrapTolerant([
		'second maintained Linux x64 CI job',
		...RULE_BEHAVIOR_NARRATIVE_FRAGMENTS.slice(1),
	]), 'isu'),
	compatibilityDocQualification: claimChain(wrapTolerant(RULE_BEHAVIOR_QUALIFICATION_FRAGMENTS), 'isu'),
});
