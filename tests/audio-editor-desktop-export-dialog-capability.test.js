/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop export dialog queries main status, filters formats, and refuses stale selections', async () => {
	const [dialog, overlays] = await Promise.all([
		readFile('src/common/editor/ui/inspector/ExportDialog.jsx', 'utf8'),
		readFile('src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', 'utf8'),
	]);
	assert.match(overlays, /<ExportDialog[\s\S]*?fileService=\{fileService\}/u);
	assert.match(dialog, /fileService\.getDesktopAudioCodecCapabilities\(desktopCodecQuery\)/u);
	assert.match(dialog, /audioFormatDescriptors\.map/u);
	assert.match(dialog, /desktopExportFormatAvailable\(descriptor\.id, desktopCodecCapabilities\)/u);
	assert.match(dialog, /desktopExportWavPackCompressionLevels\(desktopCodecCapabilities\)/u);
	assert.match(dialog, /formats\.wavpack\?\.provider === 'bundled'[\s\S]*?desktopExportWavPackCompressionLevels/u);
	assert.match(dialog, /disabled=\{blocked \|\| admRequired \|\| Boolean\(desktopFormatRefusal\)\}/u);
	assert.match(dialog, /data-desktop-codec-status/u);
});
