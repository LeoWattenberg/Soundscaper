/* SPDX-License-Identifier: AGPL-3.0-only */

import { SaxesParser } from 'saxes';
import { scaleBextTimeReference } from './broadcast-wave-project.ts';
import { encodeIxmlPayload, normalizeIxmlMetadata, parseIxmlPayload, type IxmlMetadata, type IxmlMetadataInput } from './ixml.ts';
import type { MasteringSequenceDeliveryPlan } from './mastering-sequence-delivery.ts';

interface XmlNode {
	readonly name: string;
	readonly start: number;
	readonly contentStart: number;
	readonly opening: string;
	readonly selfClosing: boolean;
	contentEnd: number;
	end: number;
	text: string;
	readonly children: XmlNode[];
}
interface Replacement { readonly start: number; readonly end: number; readonly text: string }
interface MappedPoint { readonly position: bigint; readonly duration: bigint | null }
interface DeliveryRange { readonly startFrame: number; readonly endFrame: number }
const MAX_UINT64 = 0xffff_ffff_ffff_ffffn;

/** Relative recorder sync points become project positions; source XML remains a separate original. */
export function ixmlAtImportOrigin(
	input: IxmlMetadataInput,
	sourceSampleRate: number,
	projectSampleRate: number,
	timelineStartFrame: number,
): IxmlMetadata {
	const origin = safeFrame(timelineStartFrame);
	return transform(input, sourceSampleRate, projectSampleRate, undefined, (position, duration) => [{
		position: bounded(scale(position, sourceSampleRate, projectSampleRate) + origin),
		duration: duration === null ? null : scale(duration, sourceSampleRate, projectSampleRate),
	}]);
}

/** File-relative sync points follow the audio range and clock that this delivery actually writes. */
export function ixmlForDeliveryRange(
	input: IxmlMetadataInput | null | undefined,
	range: DeliveryRange,
	projectSampleRate: number,
	outputSampleRate: number,
	bitDepth: number,
	assembly?: MasteringSequenceDeliveryPlan | null,
): IxmlMetadata | null {
	if (input == null) return null;
	const segments = assembly?.segments ?? [{ sourceStartFrame: range.startFrame, sourceEndFrame: range.endFrame, outputStartFrame: 0 }];
	return transform(input, projectSampleRate, outputSampleRate, bitDepth, (position, duration) => {
		const mapped: MappedPoint[] = [];
		for (const segment of segments) {
			const start = safeFrame(segment.sourceStartFrame);
			const end = safeFrame(segment.sourceEndFrame);
			if (end < start) throw new RangeError('An iXML delivery range cannot end before it starts.');
			const eventEnd = duration === null ? position : position + duration;
			if (position > end || eventEnd < start || (duration !== null && duration > 0n && eventEnd === start)) continue;
			const clippedStart = position < start ? start : position;
			const clippedEnd = eventEnd > end ? end : eventEnd;
			const relative = scale(clippedStart - start, projectSampleRate, outputSampleRate);
			mapped.push({ position: bounded(safeFrame(segment.outputStartFrame) + relative),
				duration: duration === null ? null : scale(clippedEnd - clippedStart, projectSampleRate, outputSampleRate) });
		}
		return mapped;
	});
}

function transform(
	input: IxmlMetadataInput,
	inputRate: number,
	outputRate: number,
	bitDepth: number | undefined,
	mapPoint: (position: bigint, duration: bigint | null) => readonly MappedPoint[],
): IxmlMetadata {
	// Reuse the bounded metadata parser before inspecting offsets in its original XML.
	const metadata = parseIxmlPayload(encodeIxmlPayload(input));
	scale(0n, inputRate, outputRate);
	const xml = metadata.rawXml;
	const root = xmlTree(xml);
	const replacements: Replacement[] = [];
	const speed = child(root, 'SPEED');
	if (speed) {
		replaceField(child(speed, 'FILE_SAMPLE_RATE'), String(outputRate), replacements);
		if (bitDepth !== undefined) replaceField(child(speed, 'AUDIO_BIT_DEPTH'), String(bitDepth), replacements);
	}
	for (const list of root.children.filter(node => node.name === 'SYNC_POINT_LIST')) {
		let pointCount = 0;
		for (const point of list.children.filter(node => node.name === 'SYNC_POINT')) {
			const type = child(point, 'SYNC_POINT_TYPE') ?? child(point, 'POINT_TYPE');
			const purpose = child(point, 'SYNC_POINT_FUNCTION') ?? child(point, 'FUNCTION');
			// GROUP_OFFSET is in the original digitizer clock, not a location in this file's audio.
			if (type?.text.trim() !== 'RELATIVE' || purpose?.text.trim() === 'GROUP_OFFSET') { pointCount += 1; continue; }
			const low = child(point, 'SYNC_POINT_LOW');
			const high = child(point, 'SYNC_POINT_HIGH');
			const legacy = child(point, 'SAMPLE_COUNT');
			if (!low && !legacy) { pointCount += 1; continue; }
			const position = low ? unsigned(low, 0xffff_ffffn) + (high ? unsigned(high, 0xffff_ffffn) << 32n : 0n) : unsigned(legacy!, MAX_UINT64);
			const durationField = child(point, 'SYNC_POINT_EVENT_DURATION');
			const duration = durationField ? unsigned(durationField, MAX_UINT64) : null;
			const mapped = mapPoint(position, duration);
			pointCount += mapped.length;
			const copies = mapped.map(value => {
				const fields: Replacement[] = [];
				if (low) {
					replaceField(low, String(value.position & 0xffff_ffffn), fields);
					if (high) replaceField(high, String(value.position >> 32n), fields);
					else if (value.position > 0xffff_ffffn) throw new RangeError('An iXML sync point needs its high sample-count word.');
				} else replaceField(legacy!, String(value.position), fields);
				if (durationField && value.duration !== null) replaceField(durationField, String(value.duration), fields);
				return applyReplacements(xml.slice(point.start, point.end), fields.map(field => ({ ...field, start: field.start - point.start, end: field.end - point.start })));
			}).join('');
			const original = xml.slice(point.start, point.end);
			if (copies !== original) replacements.push({ start: point.start, end: point.end, text: copies });
		}
		replaceField(child(list, 'SYNC_POINT_COUNT'), String(pointCount), replacements);
	}
	const transformed = applyReplacements(xml, replacements);
	return transformed === xml ? normalizeIxmlMetadata(input) : parseIxmlPayload(new TextEncoder().encode(transformed));
}

function xmlTree(xml: string): XmlNode {
	const stack: XmlNode[] = [];
	let root: XmlNode | null = null;
	const parser = new SaxesParser({ position: true, xmlns: false });
	parser.on('opentag', tag => {
		const start = xml.lastIndexOf('<', parser.position - 1);
		const node: XmlNode = { name: tag.name, start, contentStart: parser.position, opening: xml.slice(start, parser.position), selfClosing: tag.isSelfClosing,
			contentEnd: parser.position, end: parser.position, text: '', children: [] };
		if (stack.length) stack[stack.length - 1]!.children.push(node);
		else root = node;
		stack.push(node);
	});
	const text = (value: string): void => { if (stack.length) stack[stack.length - 1]!.text += value; };
	parser.on('text', text);
	parser.on('cdata', text);
	parser.on('closetag', tag => {
		const node = stack.pop()!;
		node.contentEnd = tag.isSelfClosing ? node.contentStart : xml.lastIndexOf('</', parser.position - 1);
		node.end = parser.position;
	});
	parser.write(xml).close();
	if (!root) throw new RangeError('iXML has no root.');
	return root;
}

function child(node: XmlNode, name: string): XmlNode | undefined { return node.children.find(value => value.name === name); }
function replaceField(field: XmlNode | undefined, text: string, replacements: Replacement[]): void {
	if (!field || field.text.trim() === text) return;
	if (field.selfClosing) { replacements.push({ start: field.start, end: field.end, text: `${field.opening.slice(0, -2)}>${text}</${field.name}>` }); return; }
	if (field.children.length > 0 || field.contentStart > field.contentEnd) throw new RangeError('iXML timing fields must contain scalar text.');
	replacements.push({ start: field.contentStart, end: field.contentEnd, text });
}
function applyReplacements(xml: string, replacements: readonly Replacement[]): string {
	const pieces: string[] = [];
	let offset = 0;
	for (const replacement of [...replacements].sort((a, b) => a.start - b.start)) {
		pieces.push(xml.slice(offset, replacement.start), replacement.text);
		offset = replacement.end;
	}
	pieces.push(xml.slice(offset));
	return pieces.join('');
}
function unsigned(node: XmlNode, maximum: bigint): bigint {
	const text = node.text.trim();
	if (node.children.length > 0 || !/^\d+$/u.test(text) || BigInt(text) > maximum) throw new RangeError('iXML timing must be an unsigned sample count.');
	return BigInt(text);
}
function bounded(value: bigint): bigint { if (value < 0n || value > MAX_UINT64) throw new RangeError('iXML sync position exceeds unsigned 64-bit samples.'); return value; }
function safeFrame(value: number): bigint { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('iXML timeline positions must be non-negative safe sample frames.'); return BigInt(value); }
function scale(value: bigint, inputRate: number, outputRate: number): bigint { return BigInt(scaleBextTimeReference(String(value), inputRate, outputRate)); }
