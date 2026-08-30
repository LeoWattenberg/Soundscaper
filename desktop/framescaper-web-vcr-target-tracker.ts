/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_WEB_VCR_TARGET_BINDING = '__framescaperWebVcrTargetV1';

export const FRAMESCAPER_WEB_VCR_TARGET_TRACKER_SOURCE = String.raw`(() => {
	'use strict';
	if (globalThis.top !== globalThis) return;
	const binding = globalThis.${FRAMESCAPER_WEB_VCR_TARGET_BINDING};
	if (typeof binding !== 'function' || globalThis.__framescaperWebVcrTrackerInstalledV1 === true) return;
	Object.defineProperty(globalThis, '__framescaperWebVcrTrackerInstalledV1', { value: true });
	const identities = new WeakMap();
	let nextSlot = 1;
	let sequence = 0;
	let scheduled = false;
	let pendingEnded = null;
	let activeRecordingToken = null;
	Object.defineProperty(globalThis, '__framescaperWebVcrRecordingFenceV1', {
		value: Object.freeze({ set(token) {
			if (token !== null && (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token))) return false;
			activeRecordingToken = token;
			return true;
		} }),
	});
	const position = (raw) => {
		const token = String(raw || '50%').trim().toLowerCase();
		if (token === 'left' || token === 'top') return { fraction: 0, offsetPixels: 0 };
		if (token === 'center') return { fraction: 0.5, offsetPixels: 0 };
		if (token === 'right' || token === 'bottom') return { fraction: 1, offsetPixels: 0 };
		if (/^-?\d+(?:\.\d+)?%$/.test(token)) return { fraction: Number.parseFloat(token) / 100, offsetPixels: 0 };
		if (/^-?\d+(?:\.\d+)?px$/.test(token)) return { fraction: 0, offsetPixels: Number.parseFloat(token) };
		return null;
	};
	const identity = (element) => {
		const fingerprint = element instanceof HTMLVideoElement
			? String(element.currentSrc || '').slice(0, 2048) + '|' + String(element.videoWidth) + 'x' + String(element.videoHeight)
			: 'canvas|' + String(element.width) + 'x' + String(element.height);
		let value = identities.get(element);
		if (!value) {
			value = { slot: nextSlot++, generation: 1, fingerprint };
			identities.set(element, value);
		} else if (value.fingerprint !== fingerprint) {
			value.fingerprint = fingerprint;
			value.generation += 1;
		}
		return value;
	};
	const visibleClip = (element, rect) => {
		if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
			|| rect.width <= 0 || rect.height <= 0) return null;
		let left = 0;
		let top = 0;
		let right = globalThis.innerWidth;
		let bottom = globalThis.innerHeight;
		let current = element;
		for (let depth = 0; current && depth < 64; depth += 1, current = current.parentElement) {
			const style = getComputedStyle(current);
			if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
				|| Number.parseFloat(style.opacity || '1') <= 0) return null;
			if (current === element) continue;
			const bounds = current.getBoundingClientRect();
			const clipsX = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX);
			const clipsY = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY);
			if (clipsX) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
			if (clipsY) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
			if (right <= left || bottom <= top) return null;
		}
		if (current || right <= left || bottom <= top) return null;
		return { x: left, y: top, width: right - left, height: bottom - top };
	};
	const hasTransformedAncestor = (element) => {
		let current = element;
		for (let depth = 0; current && depth < 64; depth += 1, current = current.parentElement) {
			const transform = getComputedStyle(current).transform;
			if (transform && transform !== 'none') return true;
		}
		return current !== null;
	};
	const contentRect = (element, style) => {
		const border = element.getBoundingClientRect();
		const insets = [
			style.borderLeftWidth, style.paddingLeft, style.borderTopWidth, style.paddingTop,
			style.borderRightWidth, style.paddingRight, style.borderBottomWidth, style.paddingBottom,
		].map((value) => Number.parseFloat(value));
		if (insets.some((value) => !Number.isFinite(value) || value < 0)) return null;
		const [leftBorder, leftPadding, topBorder, topPadding,
			rightBorder, rightPadding, bottomBorder, bottomPadding] = insets;
		const left = leftBorder + leftPadding;
		const top = topBorder + topPadding;
		return {
			x: border.x + left, y: border.y + top,
			width: border.width - left - rightBorder - rightPadding,
			height: border.height - top - bottomBorder - bottomPadding,
		};
	};
	const objectPosition = (raw) => {
		const parts = String(raw || '50% 50%').trim().toLowerCase().split(/\s+/);
		if (parts.length < 1 || parts.length > 2) return null;
		let first = parts[0];
		let second = parts[1] || 'center';
		if (parts.length === 1 && (first === 'top' || first === 'bottom')) {
			second = first;
			first = 'center';
		} else if ((first === 'top' || first === 'bottom')
			&& (second === 'left' || second === 'right')) {
			const swapped = first;
			first = second;
			second = swapped;
		}
		const x = position(first);
		const y = position(second);
		return x && y ? { x, y } : null;
	};
	const boundedRect = (rect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
		&& rect.x >= -32_768 && rect.x <= 32_768 && rect.y >= -32_768 && rect.y <= 32_768
		&& rect.width > 0 && rect.width <= 32_768 && rect.height > 0 && rect.height <= 32_768;
	const candidateGeometryWithinBounds = (elementRect, clipRect, intrinsic, position) =>
		boundedRect(elementRect) && boundedRect(clipRect)
		&& Number.isInteger(intrinsic.width) && intrinsic.width > 0 && intrinsic.width <= 16_384
		&& Number.isInteger(intrinsic.height) && intrinsic.height > 0 && intrinsic.height <= 16_384
		&& [position.x, position.y].every((component) => Number.isFinite(component.fraction)
			&& component.fraction >= -4 && component.fraction <= 4
			&& Number.isFinite(component.offsetPixels)
			&& component.offsetPixels >= -16_384 && component.offsetPixels <= 16_384);
	const publish = (ended = null) => {
		const candidates = [];
		for (const video of Array.from(document.querySelectorAll('video')).slice(0, 16)) {
			const style = getComputedStyle(video);
			const rect = contentRect(video, style);
			if (!rect) continue;
			const clip = visibleClip(video, rect);
			if (!clip) continue;
			const parsedPosition = objectPosition(style.objectPosition);
			const resolvedPosition = parsedPosition || {
				x: { fraction: 0.5, offsetPixels: 0 }, y: { fraction: 0.5, offsetPixels: 0 },
			};
			const intrinsic = { width: video.videoWidth || 1, height: video.videoHeight || 1 };
			if (!candidateGeometryWithinBounds(rect, clip, intrinsic, resolvedPosition)) continue;
			const mediaIdentity = identity(video);
			const transformed = hasTransformedAncestor(video);
			candidates.push({
				slot: mediaIdentity.slot, generation: mediaIdentity.generation,
				mediaState: video.ended ? 'ended' : video.paused ? 'paused' : 'playing',
				elementRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				clipRect: clip,
				intrinsicSize: intrinsic,
				objectFit: ['fill', 'contain', 'cover', 'none', 'scale-down'].includes(style.objectFit)
					? style.objectFit : 'contain',
				objectPosition: resolvedPosition,
				manualFallbackReason: transformed || !parsedPosition ? 'unsupported-transform' : null,
			});
		}
		if (candidates.length === 0) {
			for (const canvas of Array.from(document.querySelectorAll('canvas')).slice(0, 16)) {
				const rect = canvas.getBoundingClientRect();
				const clip = visibleClip(canvas, rect);
				const intrinsic = { width: canvas.width || 1, height: canvas.height || 1 };
				const position = {
					x: { fraction: 0.5, offsetPixels: 0 }, y: { fraction: 0.5, offsetPixels: 0 },
				};
				if (!clip || !candidateGeometryWithinBounds(rect, clip, intrinsic, position)) continue;
				const mediaIdentity = identity(canvas);
				candidates.push({
					slot: mediaIdentity.slot, generation: mediaIdentity.generation, mediaState: 'playing',
					elementRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
					clipRect: clip, intrinsicSize: intrinsic,
					objectFit: 'fill', objectPosition: position, manualFallbackReason: 'canvas-player',
				});
				break;
			}
		}
		try { binding(JSON.stringify({ version: 1, sequence: ++sequence, candidates, ended })); } catch {}
	};
	const schedule = (ended = null) => {
		if (ended) pendingEnded = ended;
		if (scheduled) return;
		scheduled = true;
		globalThis.setTimeout(() => {
			scheduled = false;
			const endedTarget = pendingEnded;
			pendingEnded = null;
			publish(endedTarget);
		}, 100);
	};
	document.addEventListener('play', (event) => { if (event.target instanceof HTMLVideoElement) schedule(); }, true);
	document.addEventListener('pause', (event) => { if (event.target instanceof HTMLVideoElement) schedule(); }, true);
	document.addEventListener('ended', (event) => {
		if (!(event.target instanceof HTMLVideoElement)) return;
		const mediaIdentity = identity(event.target);
		schedule({
			slot: mediaIdentity.slot,
			generation: mediaIdentity.generation,
			recordingToken: activeRecordingToken,
		});
	}, true);
	new MutationObserver(() => schedule()).observe(document, { childList: true, subtree: true, attributes: true });
	globalThis.addEventListener('resize', () => schedule(), { passive: true });
	globalThis.setInterval(() => schedule(), 500);
	publish();
})();`;
