/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionProcessIdentity } from './motionscaper-sustained-process.ts';

export interface MotionApplicationExit { readonly code: number | null; readonly signal: NodeJS.Signals | null }
interface ShutdownOptions {
	readonly owner: MotionProcessIdentity | undefined;
	retained(): readonly MotionProcessIdentity[];
	prepare(): Promise<void>;
	readonly closed: Promise<MotionApplicationExit>;
	isAlive(identity: MotionProcessIdentity): Promise<boolean>;
	send(identity: MotionProcessIdentity, signal: NodeJS.Signals): void | Promise<void>;
	signalUnadmitted(signal: NodeJS.Signals): void;
	waitGone(identities: readonly MotionProcessIdentity[]): Promise<void>;
}
interface ShutdownSignal {
	readonly identity: MotionProcessIdentity | null; readonly signal: NodeJS.Signals;
	readonly phase: string; readonly observedAt: string; readonly result: string;
}

/** Signal only authenticated PID/start identities; a deadline callback is always awaited. */
export async function shutdownMotionSustainedApplication(options: ShutdownOptions) {
	const errors: unknown[] = [], signals: ShutdownSignal[] = [];
	const identities = () => [...new Map([...options.retained(), ...(options.owner ? [options.owner] : [])]
		.map(value => [`${value.pid}:${value.startTicks}`, value])).values()];
	let journalExceeded = false;
	const record = (value: ShutdownSignal) => {
		if (signals.length < 256) signals.push(value);
		else if (!journalExceeded) { journalExceeded = true; errors.push(new Error('Application shutdown signal journal admission exceeded.')); }
	};
	const signal = async (values: readonly MotionProcessIdentity[], requested: NodeJS.Signals, phase: string, includeUnadmitted = false) => {
		for (const identity of values) {
			try {
				if (!await options.isAlive(identity)) continue;
				await options.send(identity, requested);
				record({ identity, signal: requested, phase, observedAt: new Date().toISOString(), result: 'sent' });
			} catch (error) { errors.push(error); record({ identity, signal: requested, phase, observedAt: new Date().toISOString(), result: String(error) }); }
		}
		if (!options.owner && includeUnadmitted) {
			try { options.signalUnadmitted(requested); record({ identity: null, signal: requested, phase, observedAt: new Date().toISOString(), result: 'actual ChildProcess authority before identity admission' }); }
			catch (error) { errors.push(error); }
		}
	};
	let escalation: Promise<void> | undefined;
	const timer = setTimeout(() => {
		errors.push(new Error('Application cleanup escalation deadline exceeded.'));
		escalation = signal(identities(), 'SIGKILL', 'deadline', true);
		void escalation.catch(error => errors.push(error));
	}, 10000);
	let exit: MotionApplicationExit;
	try {
		try { await options.prepare(); } catch (error) { errors.push(error); }
		// Let Electron retire its own zygotes/GPU/renderers. Residual descendants
		// become eligible for signalling only after the direct owner has closed.
		await signal(options.owner ? [options.owner] : [], 'SIGTERM', 'graceful-owner', true);
		exit = await options.closed;
		if (!(exit.code === 0 && exit.signal === null) && !(exit.code === null && exit.signal === 'SIGTERM')) errors.push(new Error('Application closed with an unqualified exit code or signal.'));
		await signal(identities().filter(value => !options.owner || value.pid !== options.owner.pid || value.startTicks !== options.owner.startTicks), 'SIGTERM', 'residual-descendants');
		try { await options.waitGone(identities()); }
		catch {
			await signal(identities(), 'SIGKILL', 'remaining-descendants');
			try { await options.waitGone(identities()); } catch (error) { errors.push(error); }
		}
	} finally {
		clearTimeout(timer);
		if (escalation) await escalation;
	}
	return { exit, errors, signals };
}
