/* SPDX-License-Identifier: AGPL-3.0-only */

export type FreesoundOAuthClientKind = 'web' | 'desktop';
export type FreesoundPublishLicense = 'cc0' | 'cc-by' | 'cc-by-nc';

export interface FreesoundOAuthUser {
	readonly id: number;
	readonly username: string;
}

export interface FreesoundTokenPair {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresInSeconds: number;
}

export interface FreesoundDescribeInput {
	readonly uploadFilename: string;
	readonly title: string;
	readonly description: string;
	readonly tags: readonly string[];
	readonly categoryId: string;
	readonly license: FreesoundPublishLicense;
}

export interface FreesoundPendingSound {
	readonly id: number;
	readonly name: string;
	readonly tags: readonly string[];
	readonly description: string;
	readonly createdAt: string;
	readonly license: string;
	readonly processingState?: string;
}

export interface FreesoundPendingUploads {
	readonly pendingDescription: readonly string[];
	readonly pendingProcessing: readonly FreesoundPendingSound[];
	readonly pendingModeration: readonly FreesoundPendingSound[];
}

export class FreesoundOAuthContractError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'FreesoundOAuthContractError';
	}
}

const CATEGORY_IDS = new Set([
	'fx-a', 'fx-el', 'fx-ex', 'fx-h', 'fx-m', 'fx-n', 'fx-o', 'fx-other', 'fx-v',
	'is-e', 'is-k', 'is-other', 'is-p', 'is-s', 'is-w',
	'm-m', 'm-other', 'm-si', 'm-sp',
	'sp-c', 'sp-other', 'sp-p', 'sp-s',
	'ss-i', 'ss-n', 'ss-other', 'ss-s', 'ss-u',
]);

export function parseOAuthStartInput(value: unknown): { readonly client: FreesoundOAuthClientKind } {
	const source = exactRecord(value, ['client'], 'OAuth start request');
	if (source.client !== 'web' && source.client !== 'desktop') {
		throw new FreesoundOAuthContractError('OAuth start request.client is invalid.');
	}
	return { client: source.client };
}

export function parseOAuthPollInput(value: unknown): Readonly<{ attemptId: string; handoffToken: string }> {
	const source = exactRecord(value, ['attemptId', 'handoffToken'], 'OAuth poll request');
	return {
		attemptId: capability(source.attemptId, 'OAuth poll request.attemptId'),
		handoffToken: capability(source.handoffToken, 'OAuth poll request.handoffToken'),
	};
}

export function parseDescribeInput(value: unknown): FreesoundDescribeInput {
	const source = exactRecord(
		value,
		['uploadFilename', 'title', 'description', 'tags', 'categoryId', 'license'],
		'describe request',
	);
	const uploadFilename = boundedString(source.uploadFilename, 'describe request.uploadFilename', 255).trim();
	const title = boundedString(source.title, 'describe request.title', 512).trim();
	const description = boundedString(source.description, 'describe request.description', 65_536).trim();
	if (title.length === 0 || description.length === 0) {
		throw new FreesoundOAuthContractError('The title and description are required.');
	}
	if (!Array.isArray(source.tags) || source.tags.length < 3 || source.tags.length > 30) {
		throw new FreesoundOAuthContractError('Between 3 and 30 tags are required.');
	}
	const tags = source.tags.map((tag, index) => {
		const normalized = boundedString(tag, `describe request.tags[${String(index)}]`, 64).trim();
		if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(normalized)) {
			throw new FreesoundOAuthContractError('Tags may contain letters, numbers, underscores, and hyphens.');
		}
		return normalized;
	});
	if (new Set(tags.map((tag) => tag.toLocaleLowerCase('en-US'))).size !== tags.length) {
		throw new FreesoundOAuthContractError('Tags must be unique.');
	}
	if (tags.join(' ').length > 512) throw new FreesoundOAuthContractError('The tags are too long.');
	const categoryId = boundedString(source.categoryId, 'describe request.categoryId', 32).trim();
	if (!CATEGORY_IDS.has(categoryId)) throw new FreesoundOAuthContractError('The sound category is invalid.');
	if (source.license !== 'cc0' && source.license !== 'cc-by' && source.license !== 'cc-by-nc') {
		throw new FreesoundOAuthContractError('The sound license is invalid.');
	}
	return { uploadFilename, title, description, tags, categoryId, license: source.license };
}

export function normalizeTokenPair(value: unknown): FreesoundTokenPair {
	const source = record(value, 'token response');
	const expiresInSeconds = integer(source.expires_in, 'token response.expires_in', 60, 604_800);
	return {
		accessToken: credential(source.access_token, 'token response.access_token'),
		refreshToken: credential(source.refresh_token, 'token response.refresh_token'),
		expiresInSeconds,
	};
}

export function normalizeOAuthUser(value: unknown): FreesoundOAuthUser {
	const source = record(value, 'user response');
	return {
		id: integer(source.unique_id, 'user response.unique_id', 1, Number.MAX_SAFE_INTEGER),
		username: boundedString(source.username, 'user response.username', 128),
	};
}

export function normalizeUploadedFilename(value: unknown): string {
	const source = record(value, 'upload response');
	return safeFilename(source.filename, 'upload response.filename');
}

export function normalizeDescribedSound(value: unknown): Readonly<{ id: number }> {
	const source = record(value, 'describe response');
	const id = typeof source.id === 'string' && /^[1-9]\d{0,15}$/u.test(source.id)
		? Number(source.id)
		: source.id;
	return { id: integer(id, 'describe response.id', 1, Number.MAX_SAFE_INTEGER) };
}

export function normalizePendingUploads(value: unknown): FreesoundPendingUploads {
	const source = record(value, 'pending uploads response');
	if (!Array.isArray(source.pending_description)
		|| !Array.isArray(source.pending_processing)
		|| !Array.isArray(source.pending_moderation)) {
		throw new FreesoundOAuthContractError('Freesound returned invalid pending uploads.');
	}
	return {
		pendingDescription: source.pending_description.map((item) => safeFilename(item, 'pending upload filename')),
		pendingProcessing: source.pending_processing.map((item) => pendingSound(item, true)),
		pendingModeration: source.pending_moderation.map((item) => pendingSound(item, false)),
	};
}

function pendingSound(value: unknown, processing: boolean): FreesoundPendingSound {
	const source = record(value, 'pending sound');
	const normalized: FreesoundPendingSound = {
		id: integer(source.id, 'pending sound.id', 1, Number.MAX_SAFE_INTEGER),
		name: boundedString(source.name, 'pending sound.name', 512),
		tags: stringArray(source.tags, 'pending sound.tags', 200, 128),
		description: boundedString(source.description, 'pending sound.description', 65_536, true),
		createdAt: boundedString(source.created, 'pending sound.created', 80),
		license: boundedString(source.license, 'pending sound.license', 2_048),
	};
	if (!processing) return normalized;
	return {
		...normalized,
		processingState: boundedString(source.processing_state, 'pending sound.processing_state', 80),
	};
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	const source = record(value, label);
	const actual = Object.keys(source).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new FreesoundOAuthContractError(`${label} has unexpected fields.`);
	}
	return source;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new FreesoundOAuthContractError(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximum: number, empty = false): string {
	if (typeof value !== 'string' || value.length > maximum || (!empty && value.length === 0)) {
		throw new FreesoundOAuthContractError(`${label} is invalid.`);
	}
	return value;
}

function stringArray(value: unknown, label: string, maximumItems: number, maximumLength: number): string[] {
	if (!Array.isArray(value) || value.length > maximumItems) {
		throw new FreesoundOAuthContractError(`${label} is invalid.`);
	}
	return value.map((item, index) => boundedString(item, `${label}[${String(index)}]`, maximumLength));
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new FreesoundOAuthContractError(`${label} is invalid.`);
	}
	return value as number;
}

function credential(value: unknown, label: string): string {
	const token = boundedString(value, label, 4_096);
	if (/\s/u.test(token)) throw new FreesoundOAuthContractError(`${label} is invalid.`);
	return token;
}

function capability(value: unknown, label: string): string {
	const token = boundedString(value, label, 128);
	if (!/^[A-Za-z0-9_-]{32,128}$/u.test(token)) throw new FreesoundOAuthContractError(`${label} is invalid.`);
	return token;
}

function safeFilename(value: unknown, label: string): string {
	const filename = boundedString(value, label, 255).trim();
	if (filename === '' || filename === '.' || filename === '..'
		|| hasControlCharacter(filename) || /[/\\]/u.test(filename)) {
		throw new FreesoundOAuthContractError(`${label} is invalid.`);
	}
	return filename;
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 0x1f || code === 0x7f;
	});
}
