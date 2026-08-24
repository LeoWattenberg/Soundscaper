/* SPDX-License-Identifier: AGPL-3.0-only */

/** Binds the closed desktop audio request to the main-owned external FFmpeg runner. */

import { dirname, isAbsolute } from 'node:path';

import {
	assertDesktopAudioCodecRequest,
	normalizeDesktopAudioCodecRequest,
	type DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.ts';
import {
	buildDesktopAudioFfmpegPlan,
	deriveDesktopAudioFfmpegCapabilityTuple,
	isDesktopAudioFfmpegCapabilityTupleSatisfied,
} from './desktop-audio-ffmpeg-plan.ts';
import type {
	ExternalFfmpegAudioOperationContract,
	ExternalFfmpegAudioOperationFiles,
} from './external-ffmpeg-audio-operation-runner.ts';
import type { ExternalFfmpegRuntimeAdmission } from './external-ffmpeg-preference-service.ts';

const FILE_FIELDS = Object.freeze(['inputPath', 'outputPath', 'maximumOutputBytes'] as const);
const MAXIMUM_PATH_LENGTH = 4_096;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const REJECTED = Object.freeze({ status: 'rejected' } as const);

export function createDesktopAudioExternalFfmpegOperationContract(
): ExternalFfmpegAudioOperationContract<DesktopAudioCodecRequest> {
	return Object.freeze({
		admitOperation(value: unknown) {
			try {
				return Object.freeze({
					status: 'admitted' as const,
					operation: normalizeDesktopAudioCodecRequest(value),
				});
			} catch { return REJECTED; }
		},
		maximumOutputBytes(operation: DesktopAudioCodecRequest): number {
			assertDesktopAudioCodecRequest(operation);
			return operation.maximumOutputBytes;
		},
		buildArguments(
			operation: DesktopAudioCodecRequest,
			files: ExternalFfmpegAudioOperationFiles,
		): unknown {
			return substitutedArguments(operation, files);
		},
		validateArguments(
			arguments_: readonly string[],
			operation: DesktopAudioCodecRequest,
			files: ExternalFfmpegAudioOperationFiles,
		): boolean {
			try {
				const expected = substitutedArguments(operation, files);
				return Array.isArray(arguments_) && arguments_.length === expected.length
					&& arguments_.every((argument, index) => argument === expected[index]);
			} catch { return false; }
		},
	});
}

export function externalFfmpegAdmissionSupportsDesktopAudioRequest(
	request: unknown,
	admission: ExternalFfmpegRuntimeAdmission | null,
): boolean {
	if (admission === null) return false;
	try {
		assertDesktopAudioCodecRequest(request);
		const tuple = deriveDesktopAudioFfmpegCapabilityTuple(request);
		return isDesktopAudioFfmpegCapabilityTupleSatisfied(tuple, admission.capabilities);
	} catch { return false; }
}

function substitutedArguments(
	operation: DesktopAudioCodecRequest,
	files: ExternalFfmpegAudioOperationFiles,
): readonly string[] {
	assertDesktopAudioCodecRequest(operation);
	assertOperationFiles(files, operation.maximumOutputBytes);
	const plan = buildDesktopAudioFfmpegPlan(operation);
	if (plan.inputName === plan.outputName
		|| occurrenceCount(plan.arguments, plan.inputName) !== 1
		|| occurrenceCount(plan.arguments, plan.outputName) !== 1) {
		throw new TypeError('The fixed desktop audio FFmpeg plan is invalid.');
	}
	return Object.freeze(plan.arguments.map((argument) => (
		argument === plan.inputName ? files.inputPath
			: argument === plan.outputName ? files.outputPath : argument
	)));
}

function assertOperationFiles(
	value: ExternalFfmpegAudioOperationFiles,
	requestMaximumOutputBytes: number,
): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== FILE_FIELDS.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !FILE_FIELDS.includes(key as never))
		|| !validAbsolutePath(value.inputPath) || !validAbsolutePath(value.outputPath)
		|| value.inputPath === value.outputPath || dirname(value.inputPath) !== dirname(value.outputPath)
		|| value.maximumOutputBytes !== requestMaximumOutputBytes) {
		throw new TypeError('The external FFmpeg audio operation file grant is invalid.');
	}
}

function validAbsolutePath(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 1 && value.length <= MAXIMUM_PATH_LENGTH
		&& isAbsolute(value) && !CONTROL_CHARACTER.test(value);
}

function occurrenceCount(values: readonly string[], expected: string): number {
	return values.reduce((count, value) => count + Number(value === expected), 0);
}
