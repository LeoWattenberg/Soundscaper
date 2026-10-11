/* SPDX-License-Identifier: AGPL-3.0-only */
import exporter from './ae-bridge/Motionscaper-Export.jsx.txt?raw';
import renderedExporter from './ae-bridge/Motionscaper-Export-Rendered.jsx.txt?raw';
import rendering from './ae-bridge/motion-ae-host-render.jsxinc?raw';
import installedRender from './ae-bridge/motion-ae-installed-render.jsxinc?raw';
import sampledExporter from './ae-bridge/Motionscaper-Export-Sampled.jsx.txt?raw';
import sampling from './ae-bridge/motion-ae-host-sampling.jsxinc?raw';
import json from './ae-bridge/motion-ae-host-json.jsxinc?raw';
import property from './ae-bridge/motion-ae-host-property.jsxinc?raw';
import hostExport from './ae-bridge/motion-ae-host-export.jsxinc?raw';
import installedExport from './ae-bridge/motion-ae-installed-export.jsxinc?raw';
import importer from './ae-bridge/Motionscaper-Import.jsx.txt?raw';
import sha256 from './ae-bridge/motion-ae-host-sha256.jsxinc?raw';
import importPlan from './ae-bridge/motion-ae-host-import-plan.jsxinc?raw';
import hostImport from './ae-bridge/motion-ae-host-import.jsxinc?raw';
import installedImport from './ae-bridge/motion-ae-installed-import.jsxinc?raw';
import license from '../../LICENSE?raw';
import { createMotionAeBridgeArchive } from '../common/editor/motion-ae-bridge-archive.ts';

export const MOTIONSCAPER_AE_BRIDGE_DOWNLOAD_NAME = 'Motionscaper-AE-Bridge-0.1.0.zip';
export const MOTIONSCAPER_AE_BRIDGE_PROFILE = Object.freeze({ version: '0.1.0', qualification: 'unqualified' as const,
	exportFromAfterEffects: true, exportFromMotionscaper: true, importIntoAfterEffects: true, importIntoMotionscaper: true, sampledExpressions: true, renderedFallback: true });
export function createMotionscaperAeBridgeDownload(signal?: AbortSignal): Promise<Blob> {
	return createMotionAeBridgeArchive({
		'Motionscaper-Export.jsx': exporter,
		'Motionscaper-Export-Sampled.jsx': sampledExporter,
		'Motionscaper-Export-Rendered.jsx': renderedExporter,
		'motion-ae-host-render.jsxinc': rendering,
		'motion-ae-installed-render.jsxinc': installedRender,
		'motion-ae-host-sampling.jsxinc': sampling,
		'motion-ae-host-json.jsxinc': json,
		'motion-ae-host-property.jsxinc': property,
		'motion-ae-host-export.jsxinc': hostExport,
		'motion-ae-installed-export.jsxinc': installedExport,
		'Motionscaper-Import.jsx': importer,
		'motion-ae-host-sha256.jsxinc': sha256,
		'motion-ae-host-import-plan.jsxinc': importPlan,
		'motion-ae-host-import.jsxinc': hostImport,
		'motion-ae-installed-import.jsxinc': installedImport,
		'LICENSE.txt': license,
		'README.txt': 'Motionscaper AE Bridge 0.1.0 — development, unqualified\n\n'
			+ 'No installed After Effects version is qualified yet. Preserve the original project and compare every transfer.\n'
			+ 'Extract every file in this archive into one folder. Open the source project in installed After Effects.\n'
			+ 'Use File > Scripts > Run Script File and choose Motionscaper-Export.jsx.\n'
			+ 'If needed, enable script file access yourself in After Effects preferences. The bridge never changes preferences.\n'
			+ 'Choose a parent folder. The script creates a new motion-transfer-* folder, copies media and publishes motionae.json last.\n'
			+ 'The original project and media are not saved or overwritten. Keep all .jsxinc files beside the .jsx script.\n'
			+ 'The standard exporter captures authored values and inert expression text. Motionscaper supports a limited, explicitly reviewed 2D conversion; whole-composition rendered fallback is available through an unqualified explicit entry.\n'
			+ 'Choose motionae.json and all package media through the Motionscaper bridge menu. Original exchange intent, conversion reports and every retained media body survive normal Save and .mscape export. Unsupported original media types must be converted or carried by a future inert binary format before import.\n'
			+ 'For explicit numeric expression/animation sampling, run Motionscaper-Export-Sampled.jsx and confirm evaluation. It adds separate samples at each composition frame, retaining original keys and expression text.\n'
			+ 'Sampling is limited to 4096 values per property and 262144 total keys/samples. It does not preserve subframe motion or motion blur. Native expression calls may block; installed-AE cancellation behavior is unqualified.\n'
			+ 'For a complete active-composition PNG sequence, run Motionscaper-Export-Rendered.jsx and explicitly confirm. The existing render queue must be empty. Enter the exact name of your own installed full-size 8-bit RGB+Alpha PNG sequence template. The bridge owns one temporary queue item and fresh output folder.\n'
			+ 'The staged image-layer carrier accepts at most 256 frames; larger projects may hit the unchanged overall project budget. Every frame must be present. It carries no audio. Original authored exchange and media remain retained. PNG channel metadata is not alpha/color fidelity qualification. Native rendering blocks; AE cancellation/Escape and actual setting names remain unqualified.\n'
			+ 'To export a Motion-authored project, open File > After Effects Bridge, review Export Current Project to AE and download the package. It contains original.mscape, every original asset, the partial editable manifest and its omission report. The source archive is limited to 128 MiB and the final package to 256 MiB. Motion-authored transfers are video-only: the importer mutes every new layer.\n'
			+ 'For a limited AE re-import, use Run Script File with Motionscaper-Import.jsx and choose motionae.json.\n'
			+ 'The importer creates a new folder with compositions, footage, null layers, parent links and transform keys/easing. Existing project items and files are not overwritten or saved.\n'
			+ 'Text, shapes, solid sources, cameras and lights are not yet admitted by this importer. Render complete compositions in AE when unsupported content is required.\n'
			+ 'Expressions are never activated. Unmapped effects/masks/mattes/blends produce warnings. The importer requires matching destination color settings and verifies declared media byte lengths and SHA-256 digests.\n'
			+ 'Read all unsupported reports in motionae.json. Text runs, mask attributes, solids, footage interpretation and plug-ins need further mapping.\n'
			+ 'AEP and AEPX are not parsed natively by Motionscaper. Use the installed-After-Effects bridge workflow.\n'
			+ 'Source and generated scripts are AGPL-3.0-only; SPDX notices are retained in every script.\n',
	}, signal);
}
