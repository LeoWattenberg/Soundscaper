/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron utility-process entry for one authenticated OpenFX scanner or fingerprint runtime. */

import {
	validateFramescaperOpenFxHelperProcessConfig,
} from './project-library-runtime/desktop/framescaper-openfx-runtime.js';
import {
	createOpenFxHelperJobRunner,
	selfTestFramescaperOpenFxHelper,
} from './project-library-runtime/desktop/openfx-helper-job.js';
import {
	createOpenFxHelperWorker,
} from './project-library-runtime/desktop/openfx-helper-worker.js';

const parentPort = globalThis.process?.parentPort;
if (parentPort && typeof parentPort.on === 'function') {
	void (async () => {
		const argument = process.argv.find((value) => value.startsWith('--framescaper-openfx-config='));
		const config = validateFramescaperOpenFxHelperProcessConfig(JSON.parse(
			argument?.slice('--framescaper-openfx-config='.length) ?? 'null',
		));
		await selfTestFramescaperOpenFxHelper(config.descriptor, config.mode);
		const worker = createOpenFxHelperWorker({
			mode: config.mode,
			post: (message) => parentPort.postMessage(message),
			runner: createOpenFxHelperJobRunner(config),
			exit: (code) => process.exit(code),
		});
		parentPort.on('message', (event) => worker.handleMessage(event.data, event.ports ?? []));
	})().catch(() => {
		process.exit(1);
	});
}
