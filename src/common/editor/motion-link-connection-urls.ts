/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionLinkNonce } from './motion-link-wire.ts';

export const MOTION_LINK_SEND_PATH = '/composition-link/send/';
export const MOTION_LINK_RECEIVE_PATH = '/composition-link/receive/';
export interface MotionLinkOrigins { readonly senderOrigin: string; readonly receiverOrigin: string }
export function motionLinkOrigin(value: unknown): string {
	if (typeof value !== 'string' || value.length > 2048) throw new TypeError('Motion link origin must be exact.');
	const url = new URL(value);
	if (url.origin !== value || !['http:', 'https:'].includes(url.protocol)) throw new TypeError('Motion link origin must be exact HTTP(S).'); return value;
}
export function resolveMotionLinkOrigins(productId: 'motionscaper' | 'framescaper', selfOrigin: string, configuredPeer?: unknown): MotionLinkOrigins {
	const own = motionLinkOrigin(selfOrigin); const peer = motionLinkOrigin(configuredPeer ?? (productId === 'motionscaper' ? 'https://framescaper.org' : 'https://motionscaper.org'));
	if (own === peer) throw new TypeError('Composition links require separate product origins.');
	return productId === 'motionscaper' ? { senderOrigin: own, receiverOrigin: peer } : { senderOrigin: peer, receiverOrigin: own };
}
export function createMotionLinkConnectionUrl(receiverOrigin: string, cap: string): string {
	return `${motionLinkOrigin(receiverOrigin)}${MOTION_LINK_RECEIVE_PATH}#cap=${motionLinkNonce(cap)}`;
}
export function readMotionLinkConnectionUrl(value: unknown, receiverOrigin: string): URL {
	if (typeof value !== 'string' || value.length > 2400) throw new TypeError('Motion link pairing URL is malformed.');
	const url = new URL(value); const params = new URLSearchParams(url.hash.slice(1));
	if (url.origin !== motionLinkOrigin(receiverOrigin) || url.pathname !== MOTION_LINK_RECEIVE_PATH || url.search || url.username || url.password || [...params.keys()].join() !== 'cap') throw new TypeError('Motion link pairing URL must name the configured receiver route.');
	motionLinkNonce(params.get('cap')); return url;
}
export function createMotionLinkNonce(): string { return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
