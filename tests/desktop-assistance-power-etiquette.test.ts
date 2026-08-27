/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_POWER_HOLD_BUDGET_MS,
	admitAssistancePower,
	applyAssistanceBackgroundPriority,
	awaitAssistancePowerAdmission,
	normalizeAssistanceThermalState,
	validateAssistancePowerObservation,
	type AssistancePowerEtiquettePort,
	type AssistancePowerObservation,
} from '../desktop/assistance-power-etiquette-v1.ts';

class FakePowerPort implements AssistancePowerEtiquettePort {
	observation: AssistancePowerObservation;
	subscriptions = 0;
	unsubscribes = 0;
	readonly #listeners = new Set<() => void>();

	constructor(observation: AssistancePowerObservation) {
		this.observation = observation;
	}

	observe(): AssistancePowerObservation { return this.observation; }

	subscribe(listener: () => void): () => void {
		this.subscriptions += 1;
		this.#listeners.add(listener);
		return () => { this.unsubscribes += 1; this.#listeners.delete(listener); };
	}

	change(observation: AssistancePowerObservation): void {
		this.observation = observation;
		for (const listener of [...this.#listeners]) listener();
	}

	get listenerCount(): number { return this.#listeners.size; }
}

const MAINS: AssistancePowerObservation = Object.freeze({
	onBatteryPower: false, thermalState: 'nominal',
});

test('mains power under a cool machine admits optional inference', () => {
	assert.deepEqual(admitAssistancePower(MAINS), { admitted: true });
	assert.deepEqual(admitAssistancePower({ onBatteryPower: false, thermalState: 'unknown' }),
		{ admitted: true });
	assert.deepEqual(admitAssistancePower({ onBatteryPower: false, thermalState: 'fair' }),
		{ admitted: true });
});

test('battery power and serious thermal pressure each hold new inference', () => {
	const battery = admitAssistancePower({ onBatteryPower: true, thermalState: 'nominal' });
	assert.equal(battery.admitted, false);
	assert.equal(battery.admitted === false && battery.reason, 'on-battery');

	for (const thermalState of ['serious', 'critical'] as const) {
		const hot = admitAssistancePower({ onBatteryPower: false, thermalState });
		assert.equal(hot.admitted, false);
		assert.equal(hot.admitted === false && hot.reason, 'thermal-pressure');
		assert.match(hot.admitted === false ? hot.detail : '', new RegExp(thermalState, 'u'));
	}
});

test('thermal pressure outranks battery so the reported reason is the worse one', () => {
	const both = admitAssistancePower({ onBatteryPower: true, thermalState: 'critical' });
	assert.equal(both.admitted === false && both.reason, 'thermal-pressure');
});

test('the power observation refuses a foreign shape, key set, or thermal word', () => {
	assert.throws(() => validateAssistancePowerObservation(null), TypeError);
	assert.throws(() => validateAssistancePowerObservation([]), TypeError);
	assert.throws(() => validateAssistancePowerObservation({ onBatteryPower: false }), TypeError);
	assert.throws(() => validateAssistancePowerObservation({
		onBatteryPower: false, thermalState: 'nominal', extra: 1,
	}), TypeError);
	assert.throws(() => validateAssistancePowerObservation({
		onBatteryPower: 'no', thermalState: 'nominal',
	}), TypeError);
	assert.throws(() => validateAssistancePowerObservation({
		onBatteryPower: false, thermalState: 'toasty',
	}), TypeError);
	assert.deepEqual(validateAssistancePowerObservation({ ...MAINS }), MAINS);
});

test('an unrecognised host thermal word reads as unknown rather than refusing the machine', () => {
	assert.equal(normalizeAssistanceThermalState('serious'), 'serious');
	assert.equal(normalizeAssistanceThermalState('toasty'), 'unknown');
	assert.equal(normalizeAssistanceThermalState(undefined), 'unknown');
	assert.equal(normalizeAssistanceThermalState(3), 'unknown');
});

test('an admitted machine never subscribes or waits', async () => {
	const port = new FakePowerPort(MAINS);
	const outcome = await awaitAssistancePowerAdmission({
		port, holdBudgetMs: ASSISTANCE_POWER_HOLD_BUDGET_MS,
		setTimeoutImpl: (() => {
			throw new Error('an admitted machine must not arm a hold timer');
		}) as unknown as typeof setTimeout,
		clearTimeoutImpl: (() => {}) as unknown as typeof clearTimeout,
	});
	assert.deepEqual(outcome, { outcome: 'admitted' });
	assert.equal(port.subscriptions, 0);
});

test('a transient hold resumes as soon as the machine returns to mains power', async () => {
	const port = new FakePowerPort({ onBatteryPower: true, thermalState: 'nominal' });
	const held: string[] = [];
	let fired: (() => void) | null = null;
	const pending = awaitAssistancePowerAdmission({
		port,
		holdBudgetMs: ASSISTANCE_POWER_HOLD_BUDGET_MS,
		onHold: (reason) => held.push(reason),
		setTimeoutImpl: ((callback: () => void) => {
			fired = callback;
			return 1 as unknown as ReturnType<typeof setTimeout>;
		}) as unknown as typeof setTimeout,
		clearTimeoutImpl: (() => {}) as unknown as typeof clearTimeout,
	});
	await Promise.resolve();
	assert.deepEqual(held, ['on-battery']);
	assert.equal(port.listenerCount, 1);
	port.change(MAINS);
	assert.deepEqual(await pending, { outcome: 'admitted' });
	assert.equal(port.unsubscribes, 1);
	assert.equal(port.listenerCount, 0);
	assert.notEqual(fired, null);
});

test('a sustained hold reports its typed deferral once the budget elapses', async () => {
	const port = new FakePowerPort({ onBatteryPower: false, thermalState: 'critical' });
	let fire!: () => void;
	const pending = awaitAssistancePowerAdmission({
		port,
		holdBudgetMs: 5_000,
		setTimeoutImpl: ((callback: () => void) => {
			fire = callback;
			return 1 as unknown as ReturnType<typeof setTimeout>;
		}) as unknown as typeof setTimeout,
		clearTimeoutImpl: (() => {}) as unknown as typeof clearTimeout,
	});
	await Promise.resolve();
	fire();
	const outcome = await pending;
	assert.equal(outcome.outcome, 'deferred');
	assert.equal(outcome.outcome === 'deferred' && outcome.reason, 'thermal-pressure');
	assert.equal(port.unsubscribes, 1);
});

test('a deferral reports the condition that still holds, not the one it started with', async () => {
	const port = new FakePowerPort({ onBatteryPower: true, thermalState: 'nominal' });
	let fire!: () => void;
	const pending = awaitAssistancePowerAdmission({
		port,
		holdBudgetMs: 5_000,
		setTimeoutImpl: ((callback: () => void) => {
			fire = callback;
			return 1 as unknown as ReturnType<typeof setTimeout>;
		}) as unknown as typeof setTimeout,
		clearTimeoutImpl: (() => {}) as unknown as typeof clearTimeout,
	});
	await Promise.resolve();
	port.change({ onBatteryPower: false, thermalState: 'serious' });
	fire();
	const outcome = await pending;
	assert.equal(outcome.outcome === 'deferred' && outcome.reason, 'thermal-pressure');
});

test('cancelling during a hold releases the subscription and reports cancellation', async () => {
	const port = new FakePowerPort({ onBatteryPower: true, thermalState: 'nominal' });
	const controller = new AbortController();
	const pending = awaitAssistancePowerAdmission({
		port,
		holdBudgetMs: 5_000,
		signal: controller.signal,
		setTimeoutImpl: (() => 1 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
		clearTimeoutImpl: (() => {}) as unknown as typeof clearTimeout,
	});
	await Promise.resolve();
	controller.abort();
	assert.deepEqual(await pending, { outcome: 'cancelled' });
	assert.equal(port.unsubscribes, 1);
});

test('an already aborted job never subscribes to power changes', async () => {
	const port = new FakePowerPort({ onBatteryPower: true, thermalState: 'nominal' });
	const outcome = await awaitAssistancePowerAdmission({
		port, holdBudgetMs: 5_000, signal: AbortSignal.abort(),
	});
	assert.deepEqual(outcome, { outcome: 'cancelled' });
	assert.equal(port.subscriptions, 0);
});

test('a power reading the host cannot supply admits the job instead of stalling it', async () => {
	const port: AssistancePowerEtiquettePort = Object.freeze({
		observe: () => { throw new Error('powerMonitor is unavailable'); },
		subscribe: () => { throw new Error('the hold must never be armed'); },
	});
	assert.deepEqual(await awaitAssistancePowerAdmission({ port, holdBudgetMs: 5_000 }),
		{ outcome: 'admitted' });
});

test('a change the port cannot read keeps the hold rather than admitting on a bad sample', async () => {
	const port = new FakePowerPort({ onBatteryPower: true, thermalState: 'nominal' });
	let fire!: () => void;
	const pending = awaitAssistancePowerAdmission({
		port,
		holdBudgetMs: 5_000,
		setTimeoutImpl: ((callback: () => void) => {
			fire = callback;
			return 1 as unknown as ReturnType<typeof setTimeout>;
		}) as unknown as typeof setTimeout,
		clearTimeoutImpl: (() => {}) as unknown as typeof clearTimeout,
	});
	await Promise.resolve();
	port.change({ onBatteryPower: 'nonsense' } as unknown as AssistancePowerObservation);
	fire();
	const outcome = await pending;
	assert.equal(outcome.outcome === 'deferred' && outcome.reason, 'on-battery');
});

test('the hold budget and port are validated before any wait begins', async () => {
	const port = new FakePowerPort(MAINS);
	await assert.rejects(() => awaitAssistancePowerAdmission({
		port: null as unknown as AssistancePowerEtiquettePort, holdBudgetMs: 1_000,
	}), TypeError);
	await assert.rejects(() => awaitAssistancePowerAdmission({ port, holdBudgetMs: 0 }), RangeError);
	await assert.rejects(() => awaitAssistancePowerAdmission({ port, holdBudgetMs: 600_001 }), RangeError);
	await assert.rejects(() => awaitAssistancePowerAdmission({ port, holdBudgetMs: 1.5 }), RangeError);
	await assert.rejects(() => awaitAssistancePowerAdmission({
		port, holdBudgetMs: 1_000, onHold: 'later' as unknown as () => void,
	}), TypeError);
});

test('background priority reports whether the operating system accepted the change', () => {
	const calls: Array<readonly [number, number]> = [];
	assert.equal(applyAssistanceBackgroundPriority(4_321, (pid, priority) => {
		calls.push([pid, priority]);
	}, 10), true);
	assert.deepEqual(calls, [[4_321, 10]]);
	assert.equal(applyAssistanceBackgroundPriority(4_321, () => {
		throw new Error('EPERM');
	}, 10), false);
});

test('background priority refuses a request that names no real process', () => {
	assert.throws(() => applyAssistanceBackgroundPriority(0, () => {}, 10), TypeError);
	assert.throws(() => applyAssistanceBackgroundPriority(1.5, () => {}, 10), TypeError);
	assert.throws(() => applyAssistanceBackgroundPriority(
		12, null as unknown as (pid: number, priority: number) => void, 10), TypeError);
	assert.throws(() => applyAssistanceBackgroundPriority(12, () => {}, 1.5), TypeError);
});
