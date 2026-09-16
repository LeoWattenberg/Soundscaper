/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { auditEditorCopyTree } from './lib/editor-copy-audit.mjs';

const issues = await auditEditorCopyTree('src/common/editor/ui', EDITOR_ENGLISH_COPY);
if (issues.length) {
	for (const issue of issues) console.error(`${issue.path}:${issue.line}: unregistered editor copy ${issue.kind}: ${issue.key}`);
	process.exitCode = 1;
} else console.log(`Verified static editor presentation references against ${Object.keys(EDITOR_ENGLISH_COPY).length} messages.`);
