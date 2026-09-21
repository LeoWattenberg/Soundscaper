/* SPDX-License-Identifier: AGPL-3.0-only */

const TARGET_FILTER = Object.freeze([
	Object.freeze({ type: 'worker' }),
	Object.freeze({ type: 'shared_worker' }),
	Object.freeze({ type: 'service_worker' }),
	Object.freeze({ type: 'worklet' }),
	Object.freeze({ type: 'shared_storage_worklet' }),
	Object.freeze({ exclude: true }),
]);

/**
 * Record precise V8 coverage in the non-page targets related to watched pages.
 *
 * Target auto-attach pauses a new worker before its first instruction. The
 * profiler starts first and only then releases it, so short-lived workers do
 * not execute their startup outside the measured window. Triggered updates are
 * retained as well as the final take because a worker may exit before teardown.
 */
export function createBrowserTargetCoverageCollector(session) {
	let nextCommandId = 1;
	let closed = false;
	let sessionClosed = false;
	const commands = new Map();
	const recorders = new Map();
	const pending = [];
	const failures = [];

	session.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
		const payload = parseMessage(message);
		if (payload === null) return;
		if (payload.id !== undefined) {
			const command = commands.get(payload.id);
			if (!command) return;
			commands.delete(payload.id);
			if (payload.error) command.reject(new Error(payload.error.message ?? 'Target command failed.'));
			else command.resolve(payload.result ?? {});
			return;
		}
		if (payload.method === 'Profiler.preciseCoverageDeltaUpdate') {
			const recorder = recorders.get(sessionId);
			if (recorder && Array.isArray(payload.params?.result)) {
				recorder.taken.push(...payload.params.result);
			}
		}
	});
	session.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
		if (closed) return;
		const recorder = { sessionId, targetInfo, active: true, taken: [] };
		recorders.set(sessionId, recorder);
		const work = startRecorder(recorder).catch((error) => {
			if (recorder.active) failures.push(error);
		});
		pending.push(work);
	});
	session.on('Target.detachedFromTarget', ({ sessionId }) => {
		const recorder = recorders.get(sessionId);
		if (recorder) recorder.active = false;
		for (const [id, command] of commands) {
			if (command.sessionId !== sessionId) continue;
			commands.delete(id);
			command.reject(new Error('Browser coverage target detached.'));
		}
	});
	session.on('close', () => {
		sessionClosed = true;
		for (const recorder of recorders.values()) recorder.active = false;
		for (const [id, command] of commands) {
			commands.delete(id);
			command.reject(new Error('Browser coverage session closed.'));
		}
	});

	async function send(sessionId, method, params = {}) {
		if (!recorders.get(sessionId)?.active) throw new Error('Browser coverage target detached.');
		const id = nextCommandId;
		nextCommandId += 1;
		const response = new Promise((resolve, reject) => {
			commands.set(id, { sessionId, resolve, reject });
		});
		try {
			const [, result] = await Promise.all([
				session.send('Target.sendMessageToTarget', {
					sessionId,
					message: JSON.stringify({ id, method, params }),
				}),
				response,
			]);
			return result;
		} catch (error) {
			commands.delete(id);
			throw error;
		}
	}

	async function startRecorder(recorder) {
		await send(recorder.sessionId, 'Profiler.enable');
		await send(recorder.sessionId, 'Runtime.enable');
		await send(recorder.sessionId, 'Profiler.startPreciseCoverage', {
			callCount: false,
			detailed: true,
			allowTriggeredUpdates: true,
		});
		await send(recorder.sessionId, 'Runtime.runIfWaitingForDebugger');
	}

	async function settle() {
		while (pending.length > 0) await Promise.all(pending.splice(0, pending.length));
		if (failures.length === 1) throw failures.shift();
		if (failures.length > 1) throw new AggregateError(failures.splice(0), 'Browser targets could not record coverage.');
	}

	return Object.freeze({
		async start() {
			await session.send('Target.setAutoAttach', {
				autoAttach: true,
				waitForDebuggerOnStart: true,
				flatten: false,
				filter: TARGET_FILTER,
			});
		},
		settle,
		async collect() {
			closed = true;
			let entries = [];
			let collectionFailure = null;
			try {
				await settle();
				for (const recorder of recorders.values()) {
					if (!recorder.active) continue;
					try {
						const { result } = await send(recorder.sessionId, 'Profiler.takePreciseCoverage');
						recorder.taken.push(...result);
						await send(recorder.sessionId, 'Profiler.stopPreciseCoverage');
						await send(recorder.sessionId, 'Profiler.disable');
					} catch (error) {
						if (recorder.active) throw error;
					}
				}
				entries = [...recorders.values()].flatMap(({ taken }) => taken);
			} catch (error) {
				collectionFailure = error;
			}
			let cleanupFailure = null;
			if (!sessionClosed) {
				try {
					await session.send('Target.setAutoAttach', {
						autoAttach: false,
						waitForDebuggerOnStart: false,
						flatten: false,
					});
				} catch (error) {
					// A workflow can deliberately close every page before the
					// fixture collects. Its ranges are already banked above; only
					// the best-effort root auto-attach cleanup has lost its target.
					if (!rootTargetClosed(error)) cleanupFailure = error;
				}
			}
			if (collectionFailure !== null && cleanupFailure !== null) {
				throw new AggregateError(
					[collectionFailure, cleanupFailure],
					'Browser target coverage collection and cleanup both failed.',
				);
			}
			if (collectionFailure !== null) throw collectionFailure;
			if (cleanupFailure !== null) throw cleanupFailure;
			return entries;
		},
	});
}

function rootTargetClosed(error) {
	if (!(error instanceof Error)) return false;
	return error.name === 'TargetClosedError'
		|| /Target page, context or browser has been closed|Session closed\.?$/iu.test(error.message);
}

function parseMessage(message) {
	try { return JSON.parse(message); } catch { return null; }
}
