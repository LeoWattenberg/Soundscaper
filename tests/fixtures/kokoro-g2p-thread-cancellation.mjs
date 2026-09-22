/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';

import {
	createAssistanceKokoroOfflinePhonemizerV1,
} from '../../desktop/assistance-kokoro-g2p-runtime.ts';
import { bindAssistanceRuntimeFamilyCancellationV1 } from
	'../../desktop/assistance-runtime-family-cancellation.ts';

if (!parentPort) throw new Error('The cancellation fixture requires a worker parent.');
const settings = JSON.parse(workerData.grant.settingsJson);
const cancellation = bindAssistanceRuntimeFamilyCancellationV1(parentPort, workerData.jobId);
const phonemize = createAssistanceKokoroOfflinePhonemizerV1({
	manifestPath: settings.manifestPath, runtimeRoot: settings.runtimeRoot,
	platform: 'linux', architecture: 'x64',
	spawn: (entry, _args, options) => {
		const child = spawn(process.execPath, [entry], options);
		void writeFile(settings.pidPath, String(child.pid)).then(() => {
			if (settings.malformedAfterSpawn) {
				setTimeout(() => parentPort.postMessage({ type: 'shell' }), 150);
			}
		});
		return child;
	},
});
void phonemize({ language: 'a', voice: 'af_heart', text: 'hello',
	signal: cancellation.signal }).catch(() => undefined).finally(() => {
	cancellation.dispose();
});
