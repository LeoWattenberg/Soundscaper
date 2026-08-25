/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact authority and result contract for speech work in the M5 helper. */

import {
	SPEECH_RUNTIME_MODULE_ID,
	normalizeRecognition,
	type SpeechRecognitionResult,
	type SpeechRuntimeStatus,
} from './assistance-speech-runtime.ts';
import {
	normalizeVoiceActivityResult,
	type VoiceActivityResult,
} from './assistance-vad-runtime.ts';
import {
	HelperContractViolationError,
	assertHelperWireEnvelope,
} from './helper-wire-admission.ts';

export const ASSISTANCE_SPEECH_JOB_SUBCONTRACT_VERSION = 1;
export const ASSISTANCE_SPEECH_FILE_ROLES = Object.freeze([
	'audio', 'encoder', 'decoder', 'joiner', 'tokens', 'vad-model',
] as const);

export type AssistanceSpeechFileRole = (typeof ASSISTANCE_SPEECH_FILE_ROLES)[number];

export interface AssistanceSpeechFileGrant {
	readonly role: AssistanceSpeechFileRole;
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly identity: Readonly<{ dev: number; ino: number }>;
}

export interface AssistanceSpeechStatusGrant {
	readonly operation: 'status';
	readonly moduleId: typeof SPEECH_RUNTIME_MODULE_ID;
}

export interface AssistanceSpeechRecognitionGrant {
	readonly operation: 'recognize';
	readonly moduleId: typeof SPEECH_RUNTIME_MODULE_ID;
	readonly modelId: string;
	readonly audio: AssistanceSpeechFileGrant;
	readonly model: Readonly<{
		encoder: AssistanceSpeechFileGrant;
		decoder: AssistanceSpeechFileGrant;
		joiner: AssistanceSpeechFileGrant;
		tokens: AssistanceSpeechFileGrant;
	}>;
	readonly language: string | null;
	readonly threads: number;
}

export interface AssistanceSpeechVoiceActivityGrant {
	readonly operation: 'detect-voice-activity';
	readonly moduleId: typeof SPEECH_RUNTIME_MODULE_ID;
	readonly modelId: string;
	readonly audio: AssistanceSpeechFileGrant;
	readonly model: AssistanceSpeechFileGrant;
}

export type AssistanceSpeechJobGrant =
	| AssistanceSpeechStatusGrant
	| AssistanceSpeechRecognitionGrant
	| AssistanceSpeechVoiceActivityGrant;
export type AssistanceSpeechJobResult = SpeechRuntimeStatus | SpeechRecognitionResult | VoiceActivityResult;

const SHA256 = /^[a-f0-9]{64}$/u;
const MODEL_ID = /^[a-z\d][a-z\d.-]{0,62}[a-z\d]$/u;
const STATUS_KEYS = Object.freeze(['operation', 'moduleId']);
const RECOGNITION_KEYS = Object.freeze([
	'operation', 'moduleId', 'modelId', 'audio', 'model', 'language', 'threads',
]);
const VOICE_ACTIVITY_KEYS = Object.freeze(['operation', 'moduleId', 'modelId', 'audio', 'model']);
const FILE_KEYS = Object.freeze(['role', 'path', 'bytes', 'sha256', 'identity']);
const IDENTITY_KEYS = Object.freeze(['dev', 'ino']);
const MODEL_KEYS = Object.freeze(['encoder', 'decoder', 'joiner', 'tokens']);
const STATUS_RESULT_KEYS = Object.freeze(['available', 'reason', 'moduleId']);

export function validateAssistanceSpeechJobGrant(value: unknown): AssistanceSpeechJobGrant {
	assertHelperWireEnvelope(value);
	const record = plainRecord(value, 'An assistance speech grant must be a plain record.');
	if (record.operation === 'status') {
		exactKeys(record, STATUS_KEYS, 'An assistance status grant');
		assertRuntimeModule(record.moduleId);
		return Object.freeze({ operation: 'status', moduleId: SPEECH_RUNTIME_MODULE_ID });
	}
	if (record.operation === 'detect-voice-activity') {
		exactKeys(record, VOICE_ACTIVITY_KEYS, 'A voice-activity grant');
		assertRuntimeModule(record.moduleId);
		assertModelId(record.modelId, 'A voice-activity grant');
		return Object.freeze({
			operation: 'detect-voice-activity', moduleId: SPEECH_RUNTIME_MODULE_ID,
			modelId: record.modelId as string,
			audio: validateFileGrant(record.audio, 'audio'),
			model: validateFileGrant(record.model, 'vad-model'),
		});
	}
	if (record.operation !== 'recognize') {
		throw unsafe('An assistance speech grant must name status, recognize, or detect voice activity.');
	}
	exactKeys(record, RECOGNITION_KEYS, 'An assistance recognition grant');
	assertRuntimeModule(record.moduleId);
	assertModelId(record.modelId, 'An assistance recognition grant');
	const model = plainRecord(record.model, 'An assistance model grant must be a plain record.');
	exactKeys(model, MODEL_KEYS, 'An assistance model grant');
	const language = record.language;
	if (language !== null && (typeof language !== 'string' || language.trim() === '' || language.length > 32)) {
		throw unsafe('An assistance recognition language must be bounded text or null.');
	}
	if (!Number.isSafeInteger(record.threads) || (record.threads as number) < 1 || (record.threads as number) > 16) {
		throw unsafe('An assistance recognition job admits between one and 16 threads.');
	}
	return Object.freeze({
		operation: 'recognize',
		moduleId: SPEECH_RUNTIME_MODULE_ID,
		modelId: record.modelId as string,
		audio: validateFileGrant(record.audio, 'audio'),
		model: Object.freeze({
			encoder: validateFileGrant(model.encoder, 'encoder'),
			decoder: validateFileGrant(model.decoder, 'decoder'),
			joiner: validateFileGrant(model.joiner, 'joiner'),
			tokens: validateFileGrant(model.tokens, 'tokens'),
		}),
		language: language as string | null,
		threads: record.threads as number,
	});
}

export function assistanceSpeechGrantInputBytes(value: unknown): number {
	const grant = validateAssistanceSpeechJobGrant(value);
	if (grant.operation === 'status') return 0;
	if (grant.operation === 'detect-voice-activity') return grant.audio.bytes + grant.model.bytes;
	return grant.audio.bytes + Object.values(grant.model).reduce((total, file) => total + file.bytes, 0);
}

export function validateAssistanceSpeechJobResult(
	value: unknown,
	grantValue: unknown,
): AssistanceSpeechJobResult {
	const grant = validateAssistanceSpeechJobGrant(grantValue);
	if (grant.operation === 'recognize') return normalizeRecognition(value);
	if (grant.operation === 'detect-voice-activity') return normalizeVoiceActivityResult(value);
	assertHelperWireEnvelope(value);
	const record = plainRecord(value, 'An assistance runtime status must be a plain record.');
	exactKeys(record, STATUS_RESULT_KEYS, 'An assistance runtime status');
	if (typeof record.available !== 'boolean'
		|| (record.reason !== null && (typeof record.reason !== 'string' || record.reason.length > 2_000))
		|| record.moduleId !== SPEECH_RUNTIME_MODULE_ID) {
		throw new HelperContractViolationError('malformed', 'An assistance runtime status is invalid.');
	}
	return Object.freeze({
		available: record.available,
		reason: record.reason as string | null,
		moduleId: SPEECH_RUNTIME_MODULE_ID,
	});
}

function assertModelId(value: unknown, label: string): void {
	if (typeof value !== 'string' || !MODEL_ID.test(value)) {
		throw unsafe(`${label} needs a bounded model id.`);
	}
}

function validateFileGrant(value: unknown, role: AssistanceSpeechFileRole): AssistanceSpeechFileGrant {
	const record = plainRecord(value, `The assistance ${role} grant must be a plain record.`);
	exactKeys(record, FILE_KEYS, `The assistance ${role} grant`);
	if (record.role !== role) throw unsafe(`The assistance ${role} grant has the wrong role.`);
	if (typeof record.path !== 'string' || record.path === '' || record.path.includes('\0')
		|| !(record.path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(record.path))
		|| record.path.split(/[\\/]/u).includes('..') || Buffer.byteLength(record.path, 'utf8') > 4_096) {
		throw unsafe(`The assistance ${role} grant needs one bounded absolute path.`);
	}
	if (!Number.isSafeInteger(record.bytes) || (record.bytes as number) < 1 || (record.bytes as number) > 4 * 1024 ** 3) {
		throw unsafe(`The assistance ${role} grant byte length is out of range.`);
	}
	if (typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
		throw unsafe(`The assistance ${role} grant needs a lowercase SHA-256 digest.`);
	}
	const identity = plainRecord(record.identity, `The assistance ${role} identity must be a plain record.`);
	exactKeys(identity, IDENTITY_KEYS, `The assistance ${role} identity`);
	if (!Number.isSafeInteger(identity.dev) || (identity.dev as number) < 0
		|| !Number.isSafeInteger(identity.ino) || (identity.ino as number) < 0) {
		throw unsafe(`The assistance ${role} grant needs an exact file identity.`);
	}
	return Object.freeze({
		role,
		path: record.path,
		bytes: record.bytes as number,
		sha256: record.sha256,
		identity: Object.freeze({ dev: identity.dev as number, ino: identity.ino as number }),
	});
}

function assertRuntimeModule(value: unknown): void {
	if (value !== SPEECH_RUNTIME_MODULE_ID) {
		throw unsafe('The assistance helper may load only the pinned speech runtime module.');
	}
}

function plainRecord(value: unknown, message: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) {
		throw unsafe(message);
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw unsafe(`${label} must carry exactly its schema keys.`);
	}
}

function unsafe(message: string): HelperContractViolationError {
	return new HelperContractViolationError('unsafe-grant', message);
}
