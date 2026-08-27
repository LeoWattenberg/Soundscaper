/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { exportDialogCompressionLevels } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';

test('desktop export dialog queries main status, filters formats, and refuses stale selections', async () => {
	const [dialog, overlays] = await Promise.all([
		readFile('src/common/editor/ui/inspector/ExportDialog.jsx', 'utf8'),
		readFile('src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', 'utf8'),
	]);
	assert.match(overlays, /<ExportDialog[\s\S]*?fileService=\{fileService\}/u);
	assert.match(dialog, /fileService\.getDesktopAudioCodecCapabilities\(desktopCodecQuery\)/u);
	assert.match(dialog, /audioFormatDescriptors\.map/u);
	assert.match(dialog, /desktopExportFormatAvailable\(descriptor\.id, desktopCodecCapabilities\)/u);
	assert.match(dialog, /exportDialogCompressionLevels\(settings\.format, desktop\)/u);
	assert.deepEqual(exportDialogCompressionLevels('wavpack', true), [0, 1, 2, 3, 4, 5]);
	assert.match(dialog, /desktopExportSelectionReason\(settings, desktopCodecCapabilities/u);
	assert.match(dialog, /useDesktopVideoExportCapabilities\(fileService, isOpen\)/u);
	assert.match(dialog, /desktopVideoCapabilities\.reason\(settings\.format\)/u);
	assert.match(dialog, /VIDEO_EXPORT_DIALOG_FORMATS\.filter\(\(descriptor\) => \(\s*!desktop \|\| desktopVideoCapabilities\.available\(descriptor\.id\)\s*\)\)/u);
	assert.match(dialog, /desktopVideoCapabilities\.resolved[\s\S]{0,300}setPresetId\(''\); setPresetName\(''\);[\s\S]{0,200}format: 'wav', deliveryTarget: ''/u);
	assert.match(dialog, /exportDialogBitRateOptions\(settings\.format, desktop, settings\.sampleRate/u);
	assert.match(dialog, /exportDialogVorbisQualityOptions\(desktop\)/u);
	assert.match(dialog, /max=\{maximumAudioSampleRate\}/u);
	assert.match(dialog, /disabled=\{blocked \|\| admRequired \|\| Boolean\(desktopFormatRefusal\)\}/u);
	assert.match(dialog, /data-desktop-codec-status/u);
});
