/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Owns short-lived project-ID reservations used while asynchronous activation
 * work is in flight. Reservation state is deliberately private and ephemeral.
 */
export function createProjectActivationReservations(findTab) {
	const reservations = new Map();
	const reservationErrors = new WeakSet();
	const reservedError = () => {
		const error = projectActivationReservedError();
		reservationErrors.add(error);
		return error;
	};

	function begin(projectId, options = {}) {
		if (typeof projectId !== 'string' || !projectId.trim()) {
			throw new TypeError('An activation project ID is required.');
		}
		if (!options || typeof options !== 'object' || Array.isArray(options)) {
			throw new TypeError('Project activation reservation options are required.');
		}
		const expectsHistory = Object.hasOwn(options, 'expectedHistoryToken');
		const requiresAbsent = options.requireAbsent === true;
		const exclusive = options.exclusive === true;
		if (expectsHistory === requiresAbsent) {
			throw new TypeError('Reserve either an existing project history or an absent project ID.');
		}
		if (reservations.size) throw reservedError();
		const tab = findTab(projectId);
		if (expectsHistory) {
			if (!tab || tab.historyToken !== options.expectedHistoryToken) throw projectHistoryChangedError();
		} else if (tab) throw projectHistoryChangedError();
		const token = Object.freeze({});
		const reservation = {
			mode: expectsHistory ? 'existing' : 'absent',
			historyToken: expectsHistory ? options.expectedHistoryToken : null,
			exclusive,
			opened: false,
			token,
		};
		reservations.set(projectId, reservation);
		return Object.freeze({
			token,
			release() {
				if (reservations.get(projectId) !== reservation) return false;
				reservations.delete(projectId);
				return true;
			},
		});
	}

	function assertMutable(projectId, changesActiveProject = false) {
		if (reservations.has(projectId)
			|| [...reservations.values()].some((reservation) => reservation.exclusive)
			|| (changesActiveProject && reservations.size)) {
			throw reservedError();
		}
	}

	function assertExclusiveMutable() {
		if ([...reservations.values()].some((reservation) => reservation.exclusive)) {
			throw reservedError();
		}
	}

	function assertSwitch(projectId, options = {}) {
		const reservation = matchingReservation(projectId, options);
		if (!reservation) {
			if (reservations.size) throw reservedError();
			return;
		}
		const tab = findTab(projectId);
		if (reservation.mode !== 'existing' || reservation.opened) throw reservedError();
		if (!tab || tab.historyToken !== reservation.historyToken) throw projectHistoryChangedError();
	}

	function assertOpen(projectId, options = {}, activates = true) {
		const reservation = matchingReservation(projectId, options);
		if (!reservation) {
			if ((activates || [...reservations.values()].some((entry) => entry.exclusive))
				&& reservations.size) throw reservedError();
			return;
		}
		if (reservation.mode !== 'absent' || reservation.opened || findTab(projectId)) {
			throw reservedError();
		}
	}

	function markOpened(projectId, options = {}) {
		const reservation = matchingReservation(projectId, options);
		if (reservation) reservation.opened = true;
	}

	function assertInstall(projectId, options = {}) {
		const reservation = matchingReservation(projectId, options);
		const tab = findTab(projectId);
		if (!reservation || reservation.mode !== 'existing' || reservation.opened
			|| !tab || tab.historyToken !== reservation.historyToken
			|| options.expectedHistoryToken !== reservation.historyToken) {
			throw reservedError();
		}
		return true;
	}

	function matchingReservation(projectId, options) {
		const reservation = reservations.get(projectId);
		const supplied = Object.hasOwn(options, 'activationToken');
		if (!reservation) {
			if (supplied) throw reservedError();
			return null;
		}
		if (!supplied || options.activationToken !== reservation.token) throw reservedError();
		return reservation;
	}

	return Object.freeze({
		begin,
		assertMutable,
		assertExclusiveMutable,
		assertOpen,
		assertSwitch,
		assertInstall,
		markOpened,
		assertRestorable() {
			if (reservations.size) throw reservedError();
		},
		publish(listeners, snapshot) {
			for (const listener of [...listeners]) {
				try {
					listener(snapshot);
				} catch (error) {
					if (!reservations.size || !reservationErrors.has(error)) throw error;
				}
			}
		},
		clear() { reservations.clear(); },
	});
}

export function projectHistoryChangedError() {
	return new DOMException('The project history changed before activation.', 'AbortError');
}

function projectActivationReservedError() {
	return new DOMException('The project is reserved for activation.', 'AbortError');
}
