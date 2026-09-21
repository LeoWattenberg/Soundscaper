/* SPDX-License-Identifier: AGPL-3.0-only */

import { auditEditorCopyTree } from './lib/editor-copy-audit.mjs';
import { EDITOR_COPY_AUDIT_INVENTORY } from './lib/editor-copy-audit-inventory.mjs';

const issues = await auditEditorCopyTree('src/common/editor/ui', EDITOR_COPY_AUDIT_INVENTORY);
if (issues.length) {
	for (const issue of issues) console.error(`${issue.path}:${issue.line}: unregistered editor copy ${issue.kind}: ${issue.key}`);
	process.exitCode = 1;
} else console.log(`Verified static editor presentation references against ${Object.keys(EDITOR_COPY_AUDIT_INVENTORY).length} messages.`);
