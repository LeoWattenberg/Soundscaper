/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The Electron main harness for the native helper's real-process proof.
 *
 * Everything here happens across Electron's genuine utility-process boundary:
 * main forks the helper entry point, the helper loads the verified addon in
 * that separate process, and the whole contract-v1 exchange — handshake,
 * heartbeat, job, progress, result, cancellation, shutdown — travels over the
 * real channel. An injected in-process double would prove none of it.
 */

const { app, utilityProcess } = require('electron');

const CONTRACT_VERSION = 1;

function readArgument(name) {
	const prefix = `--${name}=`;
	const match = process.argv.find((value) => value.startsWith(prefix));
	return match ? match.slice(prefix.length) : null;
}

function emit(payload) {
	process.stdout.write(`NATIVE-HELPER-SMOKE ${JSON.stringify(payload)}\n`);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
	const plan = JSON.parse(readArgument('smoke-plan') ?? '{}');
	const observed = { messages: [], heartbeats: 0, exitCode: null, cancelSent: false };
	let settle;
	const finished = new Promise((resolve) => { settle = resolve; });
	const child = utilityProcess.fork(plan.helperModulePath, [
		`--helper-addon-config=${JSON.stringify({ addonPath: plan.addonPath, addonSha256: plan.addonSha256 })}`,
	], { serviceName: 'soundscaper-native-helper-smoke' });

	const timer = setTimeout(() => settle('timeout'), plan.timeoutMs ?? 30_000);
	timer.unref?.();

	child.on('exit', (code) => {
		observed.exitCode = code ?? null;
		settle('exit');
	});

	let stage = 'handshake';
	child.on('message', (message) => {
		if (message?.type === 'heartbeat') {
			observed.heartbeats += 1;
			return;
		}
		observed.messages.push(message);
		if (stage === 'cancelled-job' && message?.type === 'progress') {
			// Cancel only once the second job has demonstrably started. Posting
			// the cancellation together with the job would test whether the
			// helper wins a race, not whether it cancels.
			if (message.jobId === plan.secondJobId && !observed.cancelSent) {
				observed.cancelSent = true;
				child.postMessage({ contractVersion: CONTRACT_VERSION, type: 'cancel', jobId: plan.secondJobId });
			}
			return;
		}
		if (message?.type === 'progress') return;
		if (stage === 'handshake' && message?.type === 'hello') {
			stage = 'first-job';
			child.postMessage({
				contractVersion: CONTRACT_VERSION,
				type: 'job',
				jobId: plan.firstJobId,
				kind: 'audio-device',
				grant: plan.grant,
				resourcePolicy: plan.resourcePolicy,
			});
			return;
		}
		if (stage === 'first-job' && message?.type === 'result') {
			stage = 'cancelled-job';
			child.postMessage({
				contractVersion: CONTRACT_VERSION,
				type: 'job',
				jobId: plan.secondJobId,
				kind: 'audio-device',
				grant: plan.grant,
				resourcePolicy: plan.resourcePolicy,
			});
			return;
		}
		if (stage === 'cancelled-job' && message?.type === 'cancelled') {
			stage = 'refused-job';
			child.postMessage({
				contractVersion: CONTRACT_VERSION,
				type: 'job',
				jobId: plan.thirdJobId,
				kind: 'audio-device',
				grant: { ...plan.grant, deviceHandle: 'synthetic:not-a-device' },
				resourcePolicy: plan.resourcePolicy,
			});
			return;
		}
		if (stage === 'refused-job' && message?.type === 'error') {
			stage = 'liveness';
			// Hold idle across more than one heartbeat interval before shutting
			// down, so the proof covers a helper that keeps reporting liveness
			// with no job in flight rather than only one that answers requests.
			const held = setTimeout(() => {
				stage = 'shutdown';
				child.postMessage({ contractVersion: CONTRACT_VERSION, type: 'shutdown' });
			}, plan.livenessHoldMs ?? 2_500);
			held.unref?.();
		}
	});

	const outcome = await finished;
	clearTimeout(timer);
	emit({ outcome, stage, ...observed });
	app.exit(outcome === 'exit' && observed.exitCode === 0 ? 0 : 1);
});
