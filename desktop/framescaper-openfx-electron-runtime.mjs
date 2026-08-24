/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron composition that reopens readiness before launching actual isolated native children. */

import { dirname, join } from 'node:path';

import { app } from 'electron/main';

import {
	startFramescaperOpenFxRuntime,
} from './project-library-runtime/desktop/framescaper-openfx-runtime.js';
import { createFramescaperOpenFxReviewPayloadPorts } from './framescaper-openfx-review-policy.mjs';

export async function startFramescaperOpenFxElectronRuntime(options = {}) {
	const desktopRoot = import.meta.dirname;
	const applicationRoot = dirname(desktopRoot);
	const runtime = await startFramescaperOpenFxRuntime({
		location: {
			applicationRoot,
			packaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
			externalRuntimeRoot: app.isPackaged
				? join(process.resourcesPath, 'runtime')
				: join(dirname(desktopRoot), '..', 'runtime'),
			platform: process.platform,
			arch: process.arch,
		},
		payloadPorts: createFramescaperOpenFxReviewPayloadPorts({
			applicationRoot,
			packaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
			platform: process.platform,
			arch: process.arch,
		}),
		...(options.maximumRuntimeProcesses === undefined
			? {} : { maximumRuntimeProcesses: options.maximumRuntimeProcesses }),
	});
	return runtime;
}
