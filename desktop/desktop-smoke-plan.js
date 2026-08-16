/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The project-library smoke plan: its wire format and everything that admits it.
 *
 * A plan arrives on the command line, from outside the process, describing a
 * project the packaged application is about to publish. Nothing downstream is
 * allowed to see a field the plan did not prove, so admission is total: the
 * encoding must be canonical base64url of canonical JSON, every record must be
 * closed against an exact key set, and the target document must hash to the
 * digest its own descriptor claims. A plan that is merely well-formed is still
 * refused unless it is also self-consistent.
 *
 * This lives apart from the probe because the probe drives Electron and this
 * does not: the whole module is pure, so the format it defines can be exercised
 * without a browser, a window, or a packaged build.
 */

import { createHash } from 'node:crypto';

import { DESKTOP_SMOKE_PROJECT_SCHEMA_VERSION } from './project-library-smoke-project.js';

export const PROJECT_LIBRARY_MODE = 'project-library-handoff-v1';

const MAXIMUM_PLAN_BYTES = 64 * 1024;
const DIGEST = /^[a-f\d]{64}$/u;
const STAGE_PRODUCTS = Object.freeze({
	publish: 'soundscaper',
	advance: 'framescaper',
	return: 'soundscaper',
});

export function decodeDesktopSmokePlan(encoded) {
	if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
		throw new TypeError('Desktop smoke plan must use canonical base64url');
	}
	const bytes = Buffer.from(encoded, 'base64url');
	if (bytes.toString('base64url') !== encoded) throw new TypeError('Desktop smoke plan must use canonical base64url');
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) throw new RangeError('Desktop smoke plan exceeds its 64 KiB byte limit');
	const text = bytes.toString('utf8');
	let value;
	try { value = JSON.parse(text); } catch (error) {
		throw new TypeError('Desktop smoke plan is not valid JSON', { cause: error });
	}
	if (canonicalJson(value) !== text) throw new TypeError('Desktop smoke plan must use canonical JSON');
	return validatePlan(value);
}

function validatePlan(value) {
	const plan = strictRecord(value, ['mode', 'previous', 'productId', 'schemaVersion', 'stage', 'target'], 'smoke plan');
	if (plan.schemaVersion !== 1 || plan.mode !== PROJECT_LIBRARY_MODE) {
		throw new TypeError('Desktop smoke plan has an unsupported schema or mode');
	}
	const productId = requiredProduct(plan.productId);
	const stage = String(plan.stage);
	if (!Object.hasOwn(STAGE_PRODUCTS, stage)) throw new TypeError('Unsupported smoke stage; expected publish, advance, or return');
	if (STAGE_PRODUCTS[stage] !== productId) throw new TypeError('Desktop smoke stage targets an unexpected product');
	const previous = plan.previous === null ? null : validateDescriptor(plan.previous, 'previous project');
	if (stage === 'publish' && previous !== null) throw new TypeError('Publish smoke previous descriptor must be null');
	if (stage !== 'publish' && previous === null) throw new TypeError(`${stage} smoke requires a previous project descriptor`);
	const targetRecord = strictRecord(
		plan.target,
		['document', 'id', 'revision', 'sha256', 'title'],
		'target project',
	);
	const target = {
		...validateDescriptor({
			id: targetRecord.id,
			title: targetRecord.title,
			revision: targetRecord.revision,
			sha256: targetRecord.sha256,
		}, 'target project'),
		document: requiredText(targetRecord.document, 'target document'),
	};
	if (previous && (previous.id !== target.id || previous.revision >= target.revision)) {
		throw new TypeError('Desktop smoke target must advance the previous project identity and revision');
	}
	validateMainDocument(target.document, target, 'Target project');
	return deepFreeze({
		schemaVersion: 1,
		mode: PROJECT_LIBRARY_MODE,
		stage,
		productId,
		previous,
		target,
	});
}

function validateDescriptor(value, label) {
	const descriptor = strictRecord(value, ['id', 'revision', 'sha256', 'title'], `${label} descriptor`);
	const id = requiredText(descriptor.id, `${label} id`);
	const title = requiredText(descriptor.title, `${label} title`);
	const revision = descriptor.revision;
	if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError(`${label} revision is invalid`);
	const sha256 = String(descriptor.sha256);
	if (!DIGEST.test(sha256)) throw new TypeError(`${label} SHA-256 is invalid`);
	return Object.freeze({ id, title, revision, sha256 });
}

function validateMainDocument(document, descriptor, label) {
	let project;
	try { project = JSON.parse(document); } catch (error) {
		throw new TypeError(`${label} is not a canonical document`, { cause: error });
	}
	if (JSON.stringify(project) !== document) throw new TypeError(`${label} is not a canonical document`);
	if (project?.schemaVersion !== DESKTOP_SMOKE_PROJECT_SCHEMA_VERSION || project.id !== descriptor.id
		|| project.title !== descriptor.title || project.revision !== descriptor.revision
		|| !Array.isArray(project.timelineAnnotations)) {
		throw new TypeError(`${label} does not match its descriptor`);
	}
	if (!Array.isArray(project.sources) || project.sources.length
		|| !Array.isArray(project.clips) || project.clips.length
		|| (project.tracks !== undefined && (!Array.isArray(project.tracks) || project.tracks.length))
		|| !project.projectBin || !Array.isArray(project.projectBin.clips) || project.projectBin.clips.length) {
		throw new TypeError(`${label} must remain source-free`);
	}
	if (sha256(document) !== descriptor.sha256) throw new TypeError(`${label} SHA-256 does not match its descriptor`);
}

export function strictRecord(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new TypeError(`Desktop ${label} has unsupported fields or is not a closed object`);
	}
	return value;
}

export function requiredText(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError(`Desktop smoke ${label} is invalid`);
	return value;
}

export function requiredProduct(value) {
	if (value !== 'soundscaper' && value !== 'framescaper') throw new TypeError('Desktop smoke product is invalid');
	return value;
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const item of Object.values(value)) deepFreeze(item);
	return Object.freeze(value);
}

function sha256(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
