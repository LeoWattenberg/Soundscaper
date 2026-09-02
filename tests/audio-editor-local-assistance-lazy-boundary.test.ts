/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the workspace defers Local Assistance bridge resolution with its dialog', () => {
	const workspace = source('src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx');
	assert.match(
		workspace,
		/lazyEditorModule\(\(\) => import\('\.\.\/dialogs\/LocalAssistanceDialogSurface\.tsx'\)\)/u,
	);
	assert.doesNotMatch(
		workspace,
		/import \{ resolveLocalAssistanceBridge \} from '\.\.\/local-assistance-bridge\.ts'/u,
	);
	assert.match(workspace, /bridgeScope=\{fileService\.bridge\}/u);
	assert.doesNotMatch(workspace, /const localAssistanceBridge =/u);

	const surface = source('src/common/editor/ui/dialogs/LocalAssistanceDialogSurface.tsx');
	assert.match(surface, /import \{ useMemo \} from 'react'/u);
	assert.match(surface,
		/const bridge = useMemo\(\(\) => resolveLocalAssistanceBridge\(bridgeScope\), \[bridgeScope\]\)/u);
	assert.match(surface, /<LocalAssistanceDialog \{\.\.\.props\} bridge=\{bridge\}/u);
	assert.doesNotMatch(surface,
		/<LocalAssistanceDialog \{\.\.\.props\} bridge=\{resolveLocalAssistanceBridge\(bridgeScope\)\}/u);
	assert.match(surface, /<LocalAssistanceDialog/u);
});

function source(path: string): string {
	return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}
