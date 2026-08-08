/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('packaged source-bearing handoff evidence stays fixed to its two Electron workflows', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'packaged-linux-x64-source-bearing-project-library-handoff',
	);

	assert.ok(control);
	assert.deepEqual(control.evidence, [
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
	].map(([kind, path]) => ({ kind, path })));
	assert.match(
		control.summary,
		/Linux x64 CI.*two frozen Electron workflow IDs.*six sequential packaged Soundscaper and Framescaper UI processes.*isolated shared appData.*separate product profiles.*origin profile.*exact schema 9.*one canonical-PCM audio track and clip.*one retained-original VP8 WebM video track and clip.*Project Bin.*fresh recipient.*normal project route into editor activation.*hashes the exact Project Bin Blob.*starts and stops transport.*edits the audio track name.*native input.*revision 2.*visible Edit in.*other product.*two exact-schema-9 read-only role witnesses.*project-audio-mix-v1.*audio-track-render-v1.*project-video-render-v1.*video-clip-render-v1.*role-specific compatibility indicator.*visible cross-product handoff.*Feature-requirement read-only.*only read-only.*busy.*lock-read-only.*blocked.*origin return.*indicator absent.*track-name editor enabled.*audio-whole-mix-electron-roundtrip.*audio-track-render-electron-roundtrip.*video-full-project-electron-roundtrip.*video-clip-render-electron-roundtrip.*canonical-document.*canonical-source-body.*fallback-body SHA-256.*increasing catalog revisions and fencing tokens/iu,
	);
	assert.match(
		control.summary,
		/qualifies only.*electron-soundscaper-to-framescaper-to-soundscaper-library.*electron-framescaper-to-soundscaper-to-framescaper-library.*four exact role-return workflow IDs.*fixed small first-party fixture.*Linux x64.*web `.scape` workflow matrix.*qualified separately.*muted audio.*audible or device output.*Packaged activation.*fallback playback.*unchanged project handoff.*editable origin return.*only.*four frozen rendered-fallback roles.*packaged rendered-media delivery.*fallback authoring.*other relationships.*general browser or codec.*linked or unmanaged media.*installers or file associations.*concurrency.*crash.*power loss.*Windows, macOS, (?:and|or) ARM64/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/separate maintained Linux x64 CI job.*two frozen Electron source-bearing shared-library workflows.*six sequential packaged UI processes.*isolated shared appData.*separate product profiles.*origin profile.*exact-schema-9 fixture.*canonical-PCM audio track and clip.*retained-original VP8 WebM video track and clip.*Project Bin.*fresh recipient.*normal editor project route.*exact Project Bin Blob.*starts and stops transport.*native input.*revision-2 save.*visible cross-product handoff action.*origin return.*exact edited revision.*both media bindings.*two exact-schema-9 read-only role witnesses.*project-audio-mix-v1.*audio-track-render-v1.*project-video-render-v1.*video-clip-render-v1.*role-specific compatibility indicator.*visible handoff action.*Feature-requirement read-only.*busy.*lock-read-only.*origin return.*indicator absent.*enabled track-name editor.*audio-whole-mix-electron-roundtrip.*audio-track-render-electron-roundtrip.*video-full-project-electron-roundtrip.*video-clip-render-electron-roundtrip.*unchanged canonical-document.*canonical-source-body.*fallback-body SHA-256.*electron-soundscaper-to-framescaper-to-soundscaper-library.*electron-framescaper-to-soundscaper-to-framescaper-library.*Packaged activation.*fallback playback.*unchanged project handoff.*editable origin return.*only.*four frozen rendered-fallback roles.*packaged rendered-media delivery/isu,
	);
});
