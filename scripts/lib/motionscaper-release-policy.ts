/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFileSync } from 'node:child_process';
import { readProductReleaseLinesSync, resolveProductApplicationVersion, resolveProductReleaseTag, validateProductReleaseLines } from './product-release-lines.mjs';

export type MotionReleaseChannel = 'candidate' | 'stable';
export interface MotionReleaseSelection {
	readonly productId: 'motionscaper'; readonly tag: string; readonly channel: MotionReleaseChannel; readonly version: string;
}
export interface MotionReleaseIdentity extends MotionReleaseSelection { readonly sourceRevision: string }
const CORE = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`;
const IDENTIFIER = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const STABLE = new RegExp(`^${CORE}$`, 'u');
const CANDIDATE = new RegExp(String.raw`^${CORE}-(?:alpha|beta|rc)\.${IDENTIFIER}(?:\.${IDENTIFIER})*$`, 'u');

export function motionReleaseVersionChannel(version: string): MotionReleaseChannel {
	if (version.trim() === version && STABLE.test(version)) return 'stable';
	if (version.trim() === version && CANDIDATE.test(version)) return 'candidate';
	throw new Error('Motion release version is invalid.');
}
export function admitMotionRelease(options: { lines?: unknown; tag: string; expectedChannel?: unknown }): MotionReleaseSelection {
	const expected = options.expectedChannel ?? 'candidate';
	if (expected !== 'candidate' && expected !== 'stable') throw new Error('Motion expected release channel must be candidate or stable.');
	const lines = options.lines === undefined ? readProductReleaseLinesSync() : validateProductReleaseLines(options.lines);
	const release = resolveProductReleaseTag(options.tag, lines);
	if (release.productId !== 'motionscaper') throw new Error('Motion preview or stable assembly requires its own release tag.');
	if (release.channel !== expected) throw new Error(`Motion release expected ${expected}, received ${release.channel}.`);
	const version = resolveProductApplicationVersion('motionscaper', lines);
	if (version !== release.version || motionReleaseVersionChannel(version) !== expected) throw new Error('Motion active application version and release channel differ.');
	return Object.freeze({ productId: 'motionscaper', tag: options.tag, channel: expected, version });
}
export function bindMotionReleaseSource(selection: MotionReleaseSelection, sourceRevision: string, tagRevision: string, expectedRevision = sourceRevision): MotionReleaseIdentity {
	if (![sourceRevision, tagRevision, expectedRevision].every(value => /^[a-f\d]{40}$/u.test(value))
		|| sourceRevision !== tagRevision || sourceRevision !== expectedRevision) throw new Error('Motion release tag, checkout and expected source revision differ.');
	return Object.freeze({ ...selection, sourceRevision });
}
export function verifyMotionRelease(options: { root: string; tag: string; expectedChannel?: unknown; sourceRevision?: string }): MotionReleaseIdentity {
	const selection = admitMotionRelease({ lines: readProductReleaseLinesSync(options.root), tag: options.tag, expectedChannel: options.expectedChannel });
	if (execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: options.root, encoding: 'utf8', stdio: 'pipe' }).trim()) throw new Error('Motion release source must be clean, including nonignored untracked files.');
	const revision = (reference: string) => execFileSync('git', ['rev-parse', '--verify', reference], { cwd: options.root, encoding: 'utf8' }).trim();
	return bindMotionReleaseSource(selection, revision('HEAD'), revision(`refs/tags/${selection.tag}^{commit}`), options.sourceRevision);
}
