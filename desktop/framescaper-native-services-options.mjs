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
	return (value.candidateGeneration === 25 || value.candidateGeneration === 26)
		&& value.projectMutationSurface === 'image-sequence-import'
		&& value.professionalCharacteristicsContract === 'video-source-characteristics-v25'
		&& typeof value.isRouted === 'function';
}

export function projectAuthorityPort(value) {
	return value === null || (value && typeof value === 'object' && !Array.isArray(value)
		&& ['projectState', 'projectRecord', 'readProjectBundle', 'readBody']
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
