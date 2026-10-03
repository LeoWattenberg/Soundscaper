/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the workspace defers Local Assistance bridge resolution with its dialog', () => {
	const workspace = source('src/common/editor/ui/workspace/LocalProcessingOverlays.tsx');
	assert.match(
		workspace,
		/lazyEditorModule\(\(\) => import\('\.\.\/dialogs\/LocalAssistanceDialogSurface\.tsx'\)\)/u,
	);
	// The bridge moved to `assistance/` when the vocabulary left the presentation layer;
	// this guard names the specifier, so it has to name the one the workspace could write.
	assert.doesNotMatch(
		workspace,
		/import \{ resolveLocalAssistanceBridge \} from '[^']*local-assistance-bridge\.ts'/u,
	);
	assert.match(workspace, /bridgeScope=\{fileService\.bridge\}/u);
	assert.doesNotMatch(workspace, /const localAssistanceBridge =/u);

	const surface = source('src/common/editor/ui/dialogs/LocalAssistanceDialogSurface.tsx');
	assert.match(surface, /<LocalAssistanceDialog/u);
	assert.doesNotMatch(surface, /import LocalAssistanceDialog[^\n]*from/u);
	assert.doesNotMatch(surface, /import \{ resolveLocalAssistanceBridge \}/u);
	assert.match(surface, /lazyEditorModule\(\(\) => import\('\.\/LocalAssistanceRuntimeDialog\.tsx'\)\)/u);
	assert.match(surface, /<AssistanceModelGate[\s\S]*<LocalAssistanceDialog/u);
	const runtime = source('src/common/editor/ui/dialogs/LocalAssistanceRuntimeDialog.tsx');
	assert.match(runtime, /const bridge = useMemo\(\(\) => resolveLocalAssistanceBridge\(bridgeScope\), \[bridgeScope\]\)/u);
	assert.match(runtime, /<LocalAssistanceDialog \{\.\.\.props\} bridge=\{bridge\}/u);
});

function source(path: string): string {
	return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}
