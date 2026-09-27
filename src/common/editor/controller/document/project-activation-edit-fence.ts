/* SPDX-License-Identifier: AGPL-3.0-only */

const NO_FAILURE = Symbol('no-project-activation-failure');

export interface ProjectActivationEditFenceState {
	projectActivationPending: boolean;
	projectQueue: Promise<void>;
}

interface ProjectActivationReservation {
	release(): unknown;
}

export interface ProjectActivationEditFence {
	readonly pending: number;
	enqueue<Reservation extends ProjectActivationReservation>(
		reserve: () => Reservation,
		run: (reservation: Reservation) => PromiseLike<void> | void,
	): Promise<void>;
}

/** Serialize activation custody and keep edit admission closed until its cleanup settles. */
export function createProjectActivationEditFence(
	state: ProjectActivationEditFenceState,
	publish: () => void,
): ProjectActivationEditFence {
	let pending = 0;
	let published = false;
	return Object.freeze({
		get pending() { return pending; },
		enqueue,
	});

	function enqueue<Reservation extends ProjectActivationReservation>(
		reserve: () => Reservation,
		run: (reservation: Reservation) => PromiseLike<void> | void,
	): Promise<void> {
		const publishPending = pending === 0;
		pending += 1;
		state.projectActivationPending = true;
		let admit: () => void = () => undefined;
		const admission = new Promise<void>((resolve) => { admit = resolve; });
		let reservation: Reservation | null = null;
		let setupFailure: unknown | typeof NO_FAILURE = NO_FAILURE;
		let cleanupPending = true;
		const operation = state.projectQueue.then(async () => {
			await admission;
			if (setupFailure !== NO_FAILURE) throw setupFailure;
			await run(reservation!);
		});
		const settled = operation.then(
			() => settle(NO_FAILURE),
			(error: unknown) => settle(error),
		);
		state.projectQueue = settled.catch(() => undefined);
		try {
			reservation = reserve();
			if (publishPending) publishActive();
		} catch (error) {
			setupFailure = cleanup(error);
		}
		admit();
		return settled;

		function settle(failure: unknown | typeof NO_FAILURE): void {
			const result = cleanup(failure);
			if (result !== NO_FAILURE) throw result;
		}

		function cleanup(failure: unknown | typeof NO_FAILURE): unknown | typeof NO_FAILURE {
			if (!cleanupPending) return failure;
			cleanupPending = false;
			if (reservation) {
				try { reservation.release(); } catch (error) { failure = combineFailures(failure, error); }
			}
			try { end(); } catch (error) { failure = combineFailures(failure, error); }
			return failure;
		}
	}

	function publishActive(): void {
		published = true;
		try { publish(); } catch (error) { published = false; throw error; }
	}

	function end(): void {
		if (pending < 1) throw new Error('Project activation edit fence is not held.');
		pending -= 1;
		if (pending !== 0) return;
		state.projectActivationPending = false;
		if (!published) return;
		published = false;
		publish();
	}
}

/** Reject a command before it can diverge local history from reserved session history. */
export function assertProjectActivationEditAllowed(
	state: Pick<ProjectActivationEditFenceState, 'projectActivationPending'>,
): void {
	if (state.projectActivationPending) {
		throw new DOMException('The project is reserved for activation.', 'AbortError');
	}
}

function combineFailures(
	primary: unknown | typeof NO_FAILURE,
	cleanup: unknown,
): unknown {
	if (primary === NO_FAILURE) return cleanup;
	return new AggregateError(
		[primary, cleanup],
		'Project activation and cleanup both failed.',
		{ cause: primary },
	);
}
