/* SPDX-License-Identifier: AGPL-3.0-only */
import exporter from './ae-bridge/Motionscaper-Export.jsx.txt?raw';
import json from './ae-bridge/motion-ae-host-json.jsxinc?raw';
import property from './ae-bridge/motion-ae-host-property.jsxinc?raw';
import hostExport from './ae-bridge/motion-ae-host-export.jsxinc?raw';
import installedExport from './ae-bridge/motion-ae-installed-export.jsxinc?raw';
import { createMotionAeBridgeArchive } from '../common/editor/motion-ae-bridge-archive.ts';

export const MOTIONSCAPER_AE_BRIDGE_DOWNLOAD_NAME = 'Motionscaper-AE-Bridge-0.1.0.zip';
export const MOTIONSCAPER_AE_BRIDGE_PROFILE = Object.freeze({ version: '0.1.0', qualification: 'unqualified' as const,
	exportFromAfterEffects: true, importIntoAfterEffects: false, importIntoMotionscaper: false, sampledExpressions: false, renderedFallback: false });
export function createMotionscaperAeBridgeDownload(signal?: AbortSignal): Promise<Blob> {
	return createMotionAeBridgeArchive({
		'Motionscaper-Export.jsx': exporter,
		'motion-ae-host-json.jsxinc': json,
		'motion-ae-host-property.jsxinc': property,
		'motion-ae-host-export.jsxinc': hostExport,
		'motion-ae-installed-export.jsxinc': installedExport,
		'README.txt': 'Motionscaper AE Bridge 0.1.0 — development, unqualified\n\n'
			+ 'No installed After Effects version is qualified yet. Preserve the original project and compare every transfer.\n'
			+ 'Extract every file in this archive into one folder. Open the source project in installed After Effects.\n'
			+ 'Use File > Scripts > Run Script File and choose Motionscaper-Export.jsx.\n'
			+ 'If needed, enable script file access yourself in After Effects preferences. The bridge never changes preferences.\n'
			+ 'Choose a parent folder. The script creates a new motion-transfer-* folder, copies media and publishes motionae.json last.\n'
			+ 'The original project and media are not saved or overwritten. Keep all .jsxinc files beside the .jsx script.\n'
			+ 'This build captures authored values and inert expression text. Editable conversion, import scripts, expression sampling and rendered fallback are still in development.\n'
			+ 'Read all unsupported reports in motionae.json. Text runs, mask attributes, solids, footage interpretation and plug-ins need further mapping.\n'
			+ 'AEP and AEPX are not parsed natively by Motionscaper. Use the installed-After-Effects bridge workflow.\n'
			+ 'Source and generated scripts are AGPL-3.0-only; SPDX notices are retained in every script.\n',
	}, signal);
}
