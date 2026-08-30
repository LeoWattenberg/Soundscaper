/* SPDX-License-Identifier: AGPL-3.0-only */

/** Hostile probes whose receipts depend on observed target isolation denial. */

import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';

import { canonicalNativeChildFileIdentity } from '../../desktop/native-child-file-identity.ts';

const SCENARIOS = Object.freeze({
	'isolation-broker-filesystem-grant': Object.freeze({
		argument: 'filesystem',
		stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE filesystem authorized-read unauthorized-denied\n',
	}),
	'isolation-network-denial': Object.freeze({
		argument: 'network',
		stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE network denied\n',
	}),
	'isolation-child-process-denial': Object.freeze({
		argument: 'child-process',
		stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE child-process denied\n',
	}),
	'isolation-rss-ceiling': Object.freeze({
		argument: 'rss-ceiling',
		stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling pressure-started\n',
		maximumRssBytes: 128 * 1024 ** 2,
	}),
});

export async function runSoundscaperProfessionalNativeContainmentProbe(options, dependencies = {}) {
	const scenario = scenarioValue(options?.scenario);
	const authority = options?.launcher;
	if (!authority || typeof authority.launch !== 'function') {
		throw new TypeError('The hostile containment probe requires the installed isolation launcher.');
	}
	const peer = artifact(options?.peer, 'professional peer');
	const entryExecutable = artifact(options?.entryExecutable ?? peer,
		'professional entry executable');
	const entryArguments = Object.freeze([...(options?.entryArguments ?? [])]);
	if (entryArguments.length > 0 && (entryArguments.length !== 3
		|| entryArguments[0] !== '--inhibit-cache' || entryArguments[1] !== '--library-path'
		|| typeof entryArguments[2] !== 'string' || entryArguments[2].length > 32_768
		|| entryArguments[2].includes('\0') || entryArguments[2].split(':').length > 48
		|| entryArguments[2].split(':').some((path) => resolve(path) !== path))) {
		throw new TypeError('The hostile containment probe loader arguments are invalid.');
	}
	const runtimeClosure = Object.freeze((options?.runtimeClosure ?? [])
		.map((entry) => artifact(entry, 'runtime closure')));
	const arguments_ = [`--soundscaper-containment-probe=${SCENARIOS[scenario].argument}`];
	if (entryExecutable.path !== peer.path) {
		arguments_.unshift(...(entryArguments.length === 0
			? ['--library-path', dirname(entryExecutable.path)] : entryArguments), peer.path);
	}
	let readOnly = [];
	let server = null;
	let networkAccepted = false;
	try {
		if (scenario === 'isolation-broker-filesystem-grant') {
			const authorized = artifact(options?.authorizedFile, 'authorized probe file');
			if (typeof options?.unauthorizedPath !== 'string' || !options.unauthorizedPath.startsWith('/')
				&& !/^[A-Z]:\\/iu.test(options?.unauthorizedPath ?? '')) {
				throw new TypeError('The hostile filesystem probe requires an absolute unauthorized path.');
			}
			arguments_.push(`--authorized-path=${authorized.path}`,
				`--unauthorized-path=${options.unauthorizedPath}`);
			readOnly = [{ path: authorized.path, kind: 'file', identity: authorized.identity }];
		} else if (scenario === 'isolation-network-denial') {
			server = (dependencies.createServer ?? createServer)(() => { networkAccepted = true; });
			await listenLoopback(server);
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('The hostile probe loopback server is unavailable.');
			arguments_.push(`--loopback-port=${String(address.port)}`);
		}
		const launch = await authority.launch({
			executable: entryExecutable,
			workloadPayload: peer,
			arguments: Object.freeze(arguments_),
			readOnly: Object.freeze(readOnly),
			readExecute: Object.freeze([]),
			writeOnly: Object.freeze([]),
			runtimeClosure,
			stdin: 'ignore',
			framedControl: null,
			resourcePolicy: Object.freeze({
				maximumJobDurationMs: 30_000,
				maximumRssBytes: SCENARIOS[scenario].maximumRssBytes ?? 512 * 1024 ** 2,
			}),
		});
		if (launch?.enforcement?.kind !== 'native-child-os-isolation-enforced') {
			launch?.kill?.('SIGKILL');
			throw new Error('The hostile containment probe did not traverse enforced target isolation.');
		}
		if (scenario === 'isolation-rss-ceiling' && launch.enforcement.target !== 'mac-arm64') {
			launch.kill?.('SIGKILL');
			throw new Error('The RSS ceiling probe did not traverse the macOS isolation launcher.');
		}
		const completion = await launch.completion;
		if (scenario === 'isolation-network-denial') {
			await new Promise((resolve) => setImmediate(resolve));
			if (networkAccepted) {
				throw new Error('The hostile network probe reached its unauthorized loopback listener.');
			}
		}
		return Object.freeze({
			...assertSoundscaperProfessionalContainmentProbeResult(scenario, completion),
			launcherId: launch.enforcement.launcherId,
			peerSha256: peer.sha256,
			...(scenario === 'isolation-network-denial'
				? { loopbackAccepted: networkAccepted } : {}),
		});
	} finally {
		if (server !== null) await closeServer(server);
	}
}

export function assertSoundscaperProfessionalContainmentProbeResult(scenarioValue_, completion) {
	const scenario = scenarioValue(scenarioValue_);
	const expected = SCENARIOS[scenario];
	if (scenario === 'isolation-rss-ceiling') {
		if (!completion || completion.exitCode !== 128 || completion.signal !== 'SIGKILL'
			|| completion.stdout !== expected.stdout || completion.stderr !== '') {
			throw new Error('The hostile containment probe observed no RSS ceiling termination.');
		}
		return Object.freeze({ scenario, status: 'observed-terminated' });
	}
	if (!completion || completion.exitCode !== 0 || completion.signal !== null
		|| completion.stdout !== expected.stdout || completion.stderr !== '') {
		throw new Error(`The ${scenario} hostile containment probe emitted no observed denial.`);
	}
	return Object.freeze({ scenario, status: 'observed-denied' });
}

function artifact(value, label) {
	if (!value || typeof value !== 'object' || typeof value.path !== 'string'
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| !/^[a-f\d]{64}$/u.test(String(value.sha256))) {
		throw new TypeError(`The ${label} hostile-probe artifact is invalid.`);
	}
	try { canonicalNativeChildFileIdentity(value.identity); }
	catch { throw new TypeError(`The ${label} hostile-probe artifact is invalid.`); }
	return value;
}

function scenarioValue(value) {
	if (typeof value !== 'string' || !Object.hasOwn(SCENARIOS, value)) {
		throw new TypeError('The hostile containment probe scenario is invalid.');
	}
	return value;
}

function listenLoopback(server) {
	return new Promise((resolve, reject) => {
		const onError = (error) => { server.off('listening', onListening); reject(error); };
		const onListening = () => { server.off('error', onError); resolve(); };
		server.once('error', onError);
		server.once('listening', onListening);
		server.listen({ host: '127.0.0.1', port: 0, exclusive: true });
	});
}

function closeServer(server) {
	return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
