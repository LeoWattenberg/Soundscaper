/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Owns short-lived project-ID reservations used while asynchronous activation
 * work is in flight. Reservation state is deliberately private and ephemeral.
 */
export function createProjectActivationReservations(findTab) {
	const reservations = new Map();

	function begin(projectId, options = {}) {
		if (typeof projectId !== 'string' || !projectId.trim()) {
			throw new TypeError('An activation project ID is required.');
		}
		if (!options || typeof options !== 'object' || Array.isArray(options)) {
			throw new TypeError('Project activation reservation options are required.');
		}
		const expectsHistory = Object.hasOwn(options, 'expectedHistoryToken');
		const requiresAbsent = options.requireAbsent === true;
		if (expectsHistory === requiresAbsent) {
			throw new TypeError('Reserve either an existing project history or an absent project ID.');
		}
		if (reservations.size) throw projectActivationReservedError();
		const tab = findTab(projectId);
		if (expectsHistory) {
			if (!tab || tab.historyToken !== options.expectedHistoryToken) throw projectHistoryChangedError();
		} else if (tab) throw projectHistoryChangedError();
		const token = Object.freeze({});
		const reservation = {
			mode: expectsHistory ? 'existing' : 'absent',
			historyToken: expectsHistory ? options.expectedHistoryToken : null,
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
		if (reservations.has(projectId) || (changesActiveProject && reservations.size)) {
			throw projectActivationReservedError();
		}
	}

	function assertSwitch(projectId, options = {}) {
		const reservation = matchingReservation(projectId, options);
		if (!reservation) {
			if (reservations.size) throw projectActivationReservedError();
			return;
		}
		const tab = findTab(projectId);
		if (reservation.mode !== 'existing' || reservation.opened) throw projectActivationReservedError();
		if (!tab || tab.historyToken !== reservation.historyToken) throw projectHistoryChangedError();
	}

	function assertOpen(projectId, options = {}, activates = true) {
		const reservation = matchingReservation(projectId, options);
		if (!reservation) {
			if (activates && reservations.size) throw projectActivationReservedError();
			return;
		}
		if (reservation.mode !== 'absent' || reservation.opened || findTab(projectId)) {
			throw projectActivationReservedError();
		}
	}

	function markOpened(projectId, options = {}) {
		const reservation = matchingReservation(projectId, options);
		if (reservation) reservation.opened = true;
	}

	function matchingReservation(projectId, options) {
		const reservation = reservations.get(projectId);
		const supplied = Object.hasOwn(options, 'activationToken');
		if (!reservation) {
			if (supplied) throw projectActivationReservedError();
			return null;
		}
		if (!supplied || options.activationToken !== reservation.token) throw projectActivationReservedError();
		return reservation;
	}

	return Object.freeze({
		begin,
		assertMutable,
		assertOpen,
		assertSwitch,
		markOpened,
		assertRestorable() {
			if (reservations.size) throw projectActivationReservedError();
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
