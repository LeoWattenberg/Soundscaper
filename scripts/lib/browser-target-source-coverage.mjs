/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	excludeCdpJavaScriptCoverage,
	isBrowserInternalCdpScript,
	observeCdpScript,
	readCdpScriptSourceUntilTeardown,
} from './cdp-javascript-coverage.mjs';

/** Capture source identities and bytes only while this target still records. */
export function attachBrowserTargetScriptCoverage({
	captureSource,
	failures,
	pending,
	recorder,
	workletCoverageCheckpointUrl,
}) {
	const { session } = recorder;
	session.on('Debugger.scriptParsed', (event) => {
		if (!recorder.active || !recorder.acceptsScripts) return;
		const { scriptId, url } = event;
		const webAssembly = observeCdpScript({
			event, isActive: () => recorder.active, session, state: recorder.cdpState,
		});
		if (webAssembly !== null) {
			pending.push(webAssembly.catch((error) => { failures.push(error); }));
			return;
		}
		if (isBrowserInternalCdpScript(event)) {
			excludeCdpJavaScriptCoverage(recorder.cdpState, scriptId);
			return;
		}
		if (url === workletCoverageCheckpointUrl) recorder.coverageHookScriptIds.add(String(scriptId));
		if (typeof url !== 'string' || !captureSource(url)) return;
		const work = readCdpScriptSourceUntilTeardown({
			isActive: () => recorder.active, scriptId, session,
		}).then((response) => {
			if (response === null) return;
			const { scriptSource } = response;
			if (typeof scriptSource !== 'string') throw new Error(`Browser target supplied no source bytes for ${url}.`);
			const previous = recorder.sources.get(url);
			if (previous !== undefined && previous !== scriptSource) throw new Error(`Browser target supplied conflicting source bytes for ${url}.`);
			recorder.sources.set(url, scriptSource);
		}).catch((error) => { failures.push(error); });
		pending.push(work);
	});
}
