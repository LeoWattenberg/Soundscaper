/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Shape admission for the Framescaper native-services registration surface.
 *
 * Every port the registration accepts is authority the main process hands to a
 * dormant native service, so each one is admitted by exact shape rather than by
 * duck-typing: an unexpected key, a non-enumerable property or a missing method is
 * a refusal, not a value to work around. The predicates live beside the
 * registration they guard rather than inside it, so that mounting the services and
 * deciding what may be mounted stay separately readable.
 */

import { isAbsolute } from 'node:path';

export function registrationOptions(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper native-services registration options are required.');
	}
	const fields = [
		'productId', 'userDataPath', 'instanceId', 'processId',
		'settings', 'onFenced', 'onServiceError',
		'selectDirectory', 'selectImageSequenceFiles', 'selectOpenFxPluginBinary',
		'imageSequenceImportAuthority',
		'externalDisplay', 'projectAuthority', 'watchImportAuthority', 'createMessageChannel',
	].sort();
	const actual = Object.keys(value).sort();
	if (actual.length !== fields.length || actual.some((field, index) => field !== fields[index])
		|| !['framescaper', 'soundscaper'].includes(value.productId)
		|| typeof value.userDataPath !== 'string' || !isAbsolute(value.userDataPath)
		|| typeof value.instanceId !== 'string' || value.instanceId.length < 8
		|| !Number.isSafeInteger(value.processId) || value.processId < 1
		|| typeof value.selectDirectory !== 'function'
		|| typeof value.selectImageSequenceFiles !== 'function'
		|| typeof value.selectOpenFxPluginBinary !== 'function'
		|| typeof value.createMessageChannel !== 'function'
		|| !projectAuthorityPort(value.projectAuthority)
		|| !watchImportAuthorityPort(value.watchImportAuthority)
		|| !imageSequenceImportAuthorityPort(value.imageSequenceImportAuthority)
		|| !externalDisplayOptions(value.externalDisplay)
		|| !value.settings || ['snapshot', 'setNativeMediaEnabled', 'setNativeHardwareDecodeEnabled',
			'setNativeHardwareEncodeEnabled', 'setOfxConsentEnabled']
			.some((method) => typeof value.settings[method] !== 'function')
		|| typeof value.onFenced !== 'function' || typeof value.onServiceError !== 'function') {
		throw new TypeError('Framescaper native-services registration options are invalid.');
	}
	return value;
}

export function imageSequenceImportAuthorityPort(value) {
	if (value === null) return true;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		return false;
	}
	const fields = [
		'candidateGeneration', 'projectMutationSurface',
		'professionalCharacteristicsContract', 'isRouted',
	].sort();
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string')
		|| keys.map(String).sort().some((key, index) => key !== fields[index])) return false;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
	}
	return [25, 26, 28].includes(value.candidateGeneration)
		&& value.projectMutationSurface === 'image-sequence-import'
		&& value.professionalCharacteristicsContract === 'video-source-characteristics-v25'
		&& typeof value.isRouted === 'function';
}

export function projectAuthorityPort(value) {
	return value === null || (value && typeof value === 'object' && !Array.isArray(value)
		&& ['projectState', 'projectRecord', 'readProjectBundle', 'readBody', 'materializeBody']
			.every((method) => typeof value[method] === 'function'));
}

export function watchImportAuthorityPort(value) {
	if (value === null) return true;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join('|') !== 'currentOwner|isOwnerCurrent|locator') return false;
	const locator = value.locator;
	return typeof value.currentOwner === 'function' && typeof value.isOwnerCurrent === 'function'
		&& locator && typeof locator === 'object' && !Array.isArray(locator)
		&& Object.keys(locator).sort().join('|') === 'registerPath|release'
		&& typeof locator.registerPath === 'function' && typeof locator.release === 'function';
}

export function externalDisplayOptions(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const fields = [
		'platform', 'linuxSessionType', 'isEnabled', 'listDisplays',
		'createWindow', 'sinkSelfTestPassed', 'subscribe', 'onError',
	].sort();
	const actual = Object.keys(value).sort();
	return actual.length === fields.length && actual.every((field, index) => field === fields[index])
		&& typeof value.platform === 'string'
		&& (value.linuxSessionType === undefined || typeof value.linuxSessionType === 'string')
		&& ['isEnabled', 'listDisplays', 'createWindow', 'sinkSelfTestPassed', 'subscribe', 'onError']
			.every((method) => typeof value[method] === 'function');
}

/** Main-only V14 replay/working-space admission shared by staging and enqueue. */
export function createFramescaperNativeQueueStorageAuthority(options) {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| typeof options.projectAuthority !== 'function'
		|| typeof options.renderInputStaging !== 'object'
		|| typeof options.renderInputStaging.scratchReservation !== 'function'
		|| typeof options.renderInputStaging.outstandingLiveScratchByteLength !== 'function'
		|| typeof options.queueCapacity !== 'function' || typeof options.runtime !== 'function'
		|| typeof options.reserveBackend !== 'function') {
		throw new TypeError('Selected V14 storage admission requires exact main-owned authorities.');
	}
	const reservation = (request, replayScratchByteLength) => {
		const authority = options.projectAuthority();
		if (authority === null) throw new Error('Selected V14 project storage authority is unavailable.');
		const base = authority.queueReservations(request, replayScratchByteLength);
		return options.reserveBackend({ ...request, reservations: base });
	};
	return Object.freeze({
		admitStage: async (request, replayScratchByteLength, outstandingReplayBytes, availableBytes) => {
			const reserved = reservation({ ...request, taskKind: 'encoded-export' }, replayScratchByteLength);
			const workingBytes = reservationWorkingBytes(reserved, replayScratchByteLength);
			assertStorageAvailable(availableBytes, safeStorageSum([
				outstandingReplayBytes, replayScratchByteLength, workingBytes, reserved.minimumFreeBytes,
			]));
		},
		reserveQueue: async (owner, request) => {
			const replayScratchByteLength = request.derivedInputStageId === null ? 0
				: options.renderInputStaging.scratchReservation(owner, request);
			const reserved = reservation(request, replayScratchByteLength);
			const workingBytes = reservationWorkingBytes(reserved, replayScratchByteLength);
			const runtime = await options.runtime();
			const [outstandingReplayBytes, capacity] = await Promise.all([
				options.renderInputStaging.outstandingLiveScratchByteLength(),
				options.queueCapacity({ queue: runtime.queue.list(), scratch: runtime.scratch.list() }),
			]);
			assertStorageAvailable(capacity.volumeFreeBytes, safeStorageSum([
				outstandingReplayBytes, workingBytes, reserved.minimumFreeBytes,
			]));
			return reserved;
		},
	});
}

export function failClosedFramescaperMediaRevalidation(helperBuildMatches, rootGrantAuthorized) {
	return Object.freeze({
		projectRevisionMatches: false, planFingerprintMatches: true,
		inputFingerprintsMatch: false, rootGrantAuthorized, rootGrantValid: false,
		licensingCleared: false, helperBuildMatches, scratchIdentityMatches: false,
	});
}

function reservationWorkingBytes(reservation, replayScratchByteLength) {
	if (!Number.isSafeInteger(replayScratchByteLength) || replayScratchByteLength < 0
		|| !Number.isSafeInteger(reservation?.scratchBytes)
		|| reservation.scratchBytes < replayScratchByteLength
		|| !Number.isSafeInteger(reservation.minimumFreeBytes) || reservation.minimumFreeBytes < 0) {
		throw new RangeError('Selected V14 queue storage exceeds the safe integer domain.');
	}
	return reservation.scratchBytes - replayScratchByteLength;
}
function assertStorageAvailable(availableBytes, requiredBytes) {
	if (!Number.isSafeInteger(availableBytes) || availableBytes < requiredBytes) {
		throw new RangeError('The selected V14 queue cannot reserve its replay and working storage.');
	}
}
function safeStorageSum(values) {
	return values.reduce((sum, value) => {
		const next = sum + value;
		if (!Number.isSafeInteger(next) || next < 0) {
			throw new RangeError('Selected V14 queue storage exceeds the safe integer domain.');
		}
		return next;
	}, 0);
}
