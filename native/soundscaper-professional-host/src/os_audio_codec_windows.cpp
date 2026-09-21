/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec.h"
#include "os_audio_codec_contract.h"
#include "os_aac_m4a_profile.h"
#include "os_audio_codec_windows_file_bytes.h"
#include "os_audio_codec_windows_session.h"

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include "../../common/windows_utf8_path.h"
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wrl/client.h>

#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cmath>
#include <cstring>
#include <limits>
#include <string>
#include <vector>

namespace {

using Microsoft::WRL::ComPtr;
using soundscaper::os_audio::AacLcM4aRefusal;
using soundscaper::os_audio::EncodedOutputInspection;
using soundscaper::os_audio::exactAacLcInput;
using soundscaper::os_audio::inspectEncodedOutput;
using soundscaper::os_audio::MediaFoundationSession;
using soundscaper::os_audio::readFloat32StereoPcm16;

enum class ReviewedCodec {
	mp3,
	aacM4a,
};

/* Reported through the same refusal_detail as the portable profile parser, in a
 * disjoint range: 0 means nothing refused, 1 to 99 name a portable profile
 * layer, and these name a Media Foundation media type the target would not
 * admit. Only the canary reads them. */
enum class MediaTypeRefusal : uint32_t {
	none = 0u,
	attributes = 100u,
	mp3Format = 101u,
	aacFormat = 102u,
	aacPayloadType = 103u,
	floatOutputRefused = 107u,
	grantedFloatType = 108u,
};

soundscaper_pro_os_mp3_decode_result answer(
	soundscaper_pro_os_codec_status status,
	bool nativeApiReached = false)
{
	return soundscaper::os_audio::codecAnswer<soundscaper_pro_os_mp3_decode_result>(
		status, nativeApiReached);
}

soundscaper_pro_os_aac_m4a_encode_result encodeAnswer(
	soundscaper_pro_os_codec_status status,
	bool nativeApiReached = false)
{
	return soundscaper::os_audio::codecAnswer<soundscaper_pro_os_aac_m4a_encode_result>(
		status, nativeApiReached);
}

bool requestShape(const soundscaper_pro_os_mp3_decode_request *request)
{
	return request != nullptr && soundscaper::os_audio::exactScratchRequest(
		request->input_path_utf8, request->output_path_utf8,
		request->input_bytes, request->maximum_output_bytes);
}

bool exactInputFile(const std::wstring &path, uint64_t expectedBytes)
{
	WIN32_FILE_ATTRIBUTE_DATA metadata{};
	if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &metadata)
		|| (metadata.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0u) return false;
	ULARGE_INTEGER size{};
	size.HighPart = metadata.nFileSizeHigh;
	size.LowPart = metadata.nFileSizeLow;
	return size.QuadPart == expectedBytes;
}

bool exactEncodeRequest(const soundscaper_pro_os_aac_m4a_encode_request *request)
{
	return request != nullptr && soundscaper::os_audio::exactFloat32StereoEncodeRequest(
		request->input_path_utf8, request->output_path_utf8,
		request->input_bytes, request->maximum_output_bytes,
		request->sample_rate, request->channel_count, request->bitrate_kbps, 160u);
}

bool exactUnsigned(IMFMediaType *type, REFGUID key, uint32_t expected)
{
	UINT32 value = 0u;
	return SUCCEEDED(type->GetUINT32(key, &value)) && value == expected;
}

bool exactNativeType(
	IMFMediaType *type,
	ReviewedCodec codec,
	UINT32 &sampleRate,
	UINT32 &channelCount,
	MediaTypeRefusal &refusal)
{
	refusal = MediaTypeRefusal::attributes;
	GUID majorType{};
	GUID subtype{};
	if (FAILED(type->GetGUID(MF_MT_MAJOR_TYPE, &majorType)) || majorType != MFMediaType_Audio
		|| FAILED(type->GetGUID(MF_MT_SUBTYPE, &subtype))
		|| FAILED(type->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &sampleRate))
		|| FAILED(type->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &channelCount))) return false;
	if (codec == ReviewedCodec::mp3) {
		refusal = MediaTypeRefusal::mp3Format;
		if (subtype != MFAudioFormat_MP3 || sampleRate < 8000u || sampleRate > 192000u
			|| channelCount < 1u || channelCount > 2u) return false;
		refusal = MediaTypeRefusal::none;
		return true;
	}
	/* MF_MT_AAC_PAYLOAD_TYPE is optional and defaults to raw_data_block elements,
	 * so only a stated non-raw payload refuses. The profile-level indication and
	 * the sample description blob are deliberately not consulted: the first
	 * mirrors an initial object descriptor an ordinary M4A need not carry, and on
	 * a file without one this source reports a value that names no AAC profile at
	 * all; the second is documented only as the raw data in the sample
	 * description box, without pinning whether that includes the box header. Both
	 * restate what the caller proves byte-exactly from the file: one audio track,
	 * one mp4a sample entry, one esds, and an AAC-LC AudioSpecificConfig at the
	 * rate and channel count this media type reports. */
	refusal = MediaTypeRefusal::aacPayloadType;
	UINT32 payloadType = 0u;
	if (SUCCEEDED(type->GetUINT32(MF_MT_AAC_PAYLOAD_TYPE, &payloadType)) && payloadType != 0u) {
		return false;
	}
	refusal = MediaTypeRefusal::aacFormat;
	if (subtype != MFAudioFormat_AAC || sampleRate < 8000u || sampleRate > 48000u
		|| channelCount < 1u || channelCount > 6u) return false;
	refusal = MediaTypeRefusal::none;
	return true;
}

bool writeAll(HANDLE output, const BYTE *bytes, DWORD length)
{
	DWORD offset = 0u;
	while (offset < length) {
		DWORD written = 0u;
		if (!WriteFile(output, bytes + offset, length - offset, &written, nullptr) || written == 0u) return false;
		offset += written;
	}
	return true;
}

bool finiteFloatFrames(const BYTE *bytes, DWORD length)
{
	if (length % sizeof(float) != 0u) return false;
	for (DWORD offset = 0u; offset < length; offset += sizeof(float)) {
		float sample = 0.0f;
		std::memcpy(&sample, bytes + offset, sizeof(sample));
		if (!std::isfinite(sample)) return false;
	}
	return true;
}

soundscaper_pro_os_mp3_decode_result decodeOperatingSystemAudio(
	const soundscaper_pro_os_mp3_decode_request *request,
	ReviewedCodec codec)
{
	if (!requestShape(request)) return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	std::wstring inputPath;
	std::wstring outputPath;
	if (!soundscaper::windows_path::decode_bounded_path(inputPath, request->input_path_utf8)
		|| !soundscaper::windows_path::decode_bounded_path(outputPath, request->output_path_utf8)) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}
	if (!exactInputFile(inputPath, request->input_bytes)) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INPUT_CHANGED);
	}
	if (GetFileAttributesW(outputPath.c_str()) != INVALID_FILE_ATTRIBUTES) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}

	// Declared before every interface pointer below, so Media Foundation is shut
	// down only once each of them has already been released.
	MediaFoundationSession session;
	if (!session.start()) return answer(SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE);
	bool keepOutput = false;
	auto finish = [&](soundscaper_pro_os_mp3_decode_result result) {
		if (!keepOutput) DeleteFileW(outputPath.c_str());
		return result;
	};

	ComPtr<IMFSourceReader> reader;
	if (FAILED(MFCreateSourceReaderFromURL(inputPath.c_str(), nullptr, &reader))) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, true));
	}
	if (FAILED(reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE))
		|| FAILED(reader->SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM, TRUE))) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, true));
	}
	MediaTypeRefusal mediaType = MediaTypeRefusal::attributes;
	auto refusedType = [](MediaTypeRefusal reason) {
		auto refused = answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true);
		refused.refusal_detail = static_cast<uint32_t>(reason);
		return refused;
	};
	ComPtr<IMFMediaType> nativeType;
	UINT32 sourceSampleRate = 0u;
	UINT32 sourceChannelCount = 0u;
	if (FAILED(reader->GetNativeMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0u, &nativeType))
		|| !exactNativeType(nativeType.Get(), codec, sourceSampleRate, sourceChannelCount,
			mediaType)) {
		return finish(refusedType(mediaType));
	}

	ComPtr<IMFMediaType> requestedType;
	if (FAILED(MFCreateMediaType(&requestedType))
		|| FAILED(requestedType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio))
		|| FAILED(requestedType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_Float))
		|| FAILED(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, requestedType.Get()))) {
		return finish(refusedType(MediaTypeRefusal::floatOutputRefused));
	}
	ComPtr<IMFMediaType> grantedType;
	GUID grantedSubtype{};
	UINT32 sampleRate = 0u;
	UINT32 channelCount = 0u;
	if (FAILED(reader->GetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, &grantedType))
		|| FAILED(grantedType->GetGUID(MF_MT_SUBTYPE, &grantedSubtype))
		|| grantedSubtype != MFAudioFormat_Float
		|| !exactUnsigned(grantedType.Get(), MF_MT_AUDIO_BITS_PER_SAMPLE, 32u)
		|| FAILED(grantedType->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &sampleRate))
		|| FAILED(grantedType->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &channelCount))
		|| sampleRate < 8000u || sampleRate > 192000u
		|| channelCount < 1u || channelCount > (codec == ReviewedCodec::mp3 ? 2u : 6u)
		|| sampleRate != sourceSampleRate || channelCount != sourceChannelCount
		|| !exactUnsigned(grantedType.Get(), MF_MT_AUDIO_BLOCK_ALIGNMENT,
			channelCount * static_cast<uint32_t>(sizeof(float)))) {
		return finish(refusedType(MediaTypeRefusal::grantedFloatType));
	}

	AacLcM4aRefusal refusal = AacLcM4aRefusal::none;
	if (codec == ReviewedCodec::aacM4a
		&& !exactAacLcInput(inputPath, request->input_bytes, sampleRate, channelCount, refusal)) {
		auto refused = answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true);
		refused.refusal_detail = static_cast<uint32_t>(refusal);
		return finish(refused);
	}

	HANDLE output = CreateFileW(outputPath.c_str(), GENERIC_WRITE, 0u, nullptr, CREATE_NEW,
		FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
	if (output == INVALID_HANDLE_VALUE) return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED, true));
	uint64_t outputBytes = 0u;
	uint64_t frameCount = 0u;
	soundscaper_pro_os_codec_status terminal = SOUNDSCAPER_PRO_OS_CODEC_OK;
	for (;;) {
		DWORD actualStream = 0u;
		DWORD flags = 0u;
		LONGLONG timestamp = 0;
		ComPtr<IMFSample> sample;
		const HRESULT readStatus = reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0u,
			&actualStream, &flags, &timestamp, &sample);
		(void)actualStream;
		(void)timestamp;
		if (FAILED(readStatus)
			|| (flags & (MF_SOURCE_READERF_ERROR | MF_SOURCE_READERF_NATIVEMEDIATYPECHANGED
				| MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED)) != 0u) {
			terminal = SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED;
			break;
		}
		if (sample) {
			ComPtr<IMFMediaBuffer> buffer;
			BYTE *data = nullptr;
			DWORD capacity = 0u;
			DWORD length = 0u;
			if (FAILED(sample->ConvertToContiguousBuffer(&buffer))
				|| FAILED(buffer->Lock(&data, &capacity, &length))) {
				terminal = SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED;
				break;
			}
			(void)capacity;
			const uint64_t next = outputBytes + static_cast<uint64_t>(length);
			const uint32_t bytesPerFrame = channelCount * static_cast<uint32_t>(sizeof(float));
			const bool valid = next >= outputBytes && next <= request->maximum_output_bytes
				&& length % bytesPerFrame == 0u && finiteFloatFrames(data, length);
			const bool written = valid && writeAll(output, data, length);
			buffer->Unlock();
			if (!valid) { terminal = SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT; break; }
			if (!written) { terminal = SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED; break; }
			outputBytes = next;
			frameCount += length / bytesPerFrame;
		}
		if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0u) break;
	}
	const bool flushed = FlushFileBuffers(output) != 0;
	const bool closed = CloseHandle(output) != 0;
	if (!flushed || !closed) terminal = SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED;
	if (terminal != SOUNDSCAPER_PRO_OS_CODEC_OK || outputBytes == 0u || frameCount == 0u) {
		return finish(answer(terminal == SOUNDSCAPER_PRO_OS_CODEC_OK
			? SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED : terminal, true));
	}
	soundscaper_pro_os_mp3_decode_result result = answer(SOUNDSCAPER_PRO_OS_CODEC_OK, true);
	result.exact_tuple_passed = 1u;
	result.output_bytes = outputBytes;
	result.frame_count = frameCount;
	result.sample_rate = sampleRate;
	result.channel_count = channelCount;
	keepOutput = true;
	return finish(result);
}

soundscaper_pro_os_aac_m4a_encode_result encodeOperatingSystemAacM4a(
	const soundscaper_pro_os_aac_m4a_encode_request *request)
{
	if (!exactEncodeRequest(request)) return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	std::wstring inputPath;
	std::wstring outputPath;
	if (!soundscaper::windows_path::decode_bounded_path(inputPath, request->input_path_utf8)
		|| !soundscaper::windows_path::decode_bounded_path(outputPath, request->output_path_utf8)) {
		return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}
	if (!exactInputFile(inputPath, request->input_bytes)) {
		return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INPUT_CHANGED);
	}
	if (GetFileAttributesW(outputPath.c_str()) != INVALID_FILE_ATTRIBUTES) {
		return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}
	std::vector<int16_t> pcm;
	uint64_t frameCount = 0u;
	if (!readFloat32StereoPcm16(inputPath, request->input_bytes, pcm, frameCount)) {
		return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}

	// Declared before every interface pointer below, so Media Foundation is shut
	// down only once each of them has already been released.
	MediaFoundationSession session;
	if (!session.start()) return encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE);
	bool keepOutput = false;
	ComPtr<IMFSinkWriter> writer;
	auto finish = [&](soundscaper_pro_os_aac_m4a_encode_result result) {
		// Released here as well as at scope exit: the sink writer holds the output
		// file open, and Windows refuses to delete a file that is still open.
		writer.Reset();
		if (!keepOutput) DeleteFileW(outputPath.c_str());
		return result;
	};

	if (FAILED(MFCreateSinkWriterFromURL(outputPath.c_str(), nullptr, nullptr, &writer))) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
	}
	ComPtr<IMFMediaType> outputType;
	if (FAILED(MFCreateMediaType(&outputType))
		|| FAILED(outputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio))
		|| FAILED(outputType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_AAC))
		|| FAILED(outputType->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16u))
		|| FAILED(outputType->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, request->sample_rate))
		|| FAILED(outputType->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, request->channel_count))
		|| FAILED(outputType->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
			request->bitrate_kbps * 1000u / 8u))
		|| FAILED(outputType->SetUINT32(MF_MT_AVG_BITRATE, request->bitrate_kbps * 1000u))
		|| FAILED(outputType->SetUINT32(MF_MT_AAC_PAYLOAD_TYPE, 0u))
		|| FAILED(outputType->SetUINT32(MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, 0x29u))) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}
	DWORD streamIndex = 0u;
	if (FAILED(writer->AddStream(outputType.Get(), &streamIndex))) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}
	ComPtr<IMFMediaType> inputType;
	constexpr UINT32 pcmChannelCount = 2u;
	constexpr UINT32 pcmBlockAlignment = pcmChannelCount * sizeof(int16_t);
	assert(request->channel_count == pcmChannelCount);
	if (FAILED(MFCreateMediaType(&inputType))
		|| FAILED(inputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio))
		|| FAILED(inputType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16u))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, request->sample_rate))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, request->channel_count))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, pcmBlockAlignment))
		|| FAILED(inputType->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
			request->sample_rate * pcmBlockAlignment))
		|| FAILED(writer->SetInputMediaType(streamIndex, inputType.Get(), nullptr))) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}
	if (FAILED(writer->BeginWriting())) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
	}
	constexpr uint64_t blockFrames = 1024u;
	for (uint64_t frameOffset = 0u; frameOffset < frameCount;) {
		const uint64_t frames = std::min(blockFrames, frameCount - frameOffset);
		const uint64_t bufferBytes64 = frames * pcmBlockAlignment;
		if (bufferBytes64 > std::numeric_limits<DWORD>::max()) {
			return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		const DWORD bufferBytes = static_cast<DWORD>(bufferBytes64);
		ComPtr<IMFMediaBuffer> buffer;
		BYTE *destination = nullptr;
		DWORD capacity = 0u;
		DWORD current = 0u;
		if (FAILED(MFCreateMemoryBuffer(bufferBytes, &buffer))
			|| FAILED(buffer->Lock(&destination, &capacity, &current))) {
			return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		if (capacity < bufferBytes) {
			(void)buffer->Unlock();
			return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		std::memcpy(destination, pcm.data() + frameOffset * pcmChannelCount, bufferBytes);
		if (FAILED(buffer->Unlock()) || FAILED(buffer->SetCurrentLength(bufferBytes))) {
			return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		ComPtr<IMFSample> sample;
		const LONGLONG sampleTime = static_cast<LONGLONG>(
			frameOffset * 10000000u / request->sample_rate);
		const LONGLONG nextTime = static_cast<LONGLONG>(
			(frameOffset + frames) * 10000000u / request->sample_rate);
		if (nextTime <= sampleTime || FAILED(MFCreateSample(&sample))
			|| FAILED(sample->AddBuffer(buffer.Get()))
			|| FAILED(sample->SetSampleTime(sampleTime))
			|| FAILED(sample->SetSampleDuration(nextTime - sampleTime))
			|| FAILED(writer->WriteSample(streamIndex, sample.Get()))) {
			return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
		}
		frameOffset += frames;
	}
	if (FAILED(writer->Finalize())) {
		return finish(encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true));
	}
	writer.Reset();
	uint64_t outputBytes = 0u;
	AacLcM4aRefusal outputRefusal = AacLcM4aRefusal::none;
	const auto inspected = inspectEncodedOutput(
		outputPath, request->maximum_output_bytes, outputBytes, outputRefusal);
	if (inspected != EncodedOutputInspection::exact) {
		auto refused = encodeAnswer(inspected == EncodedOutputInspection::overLimit
			? SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT
			: inspected == EncodedOutputInspection::notExact
				? SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED
				: SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, true);
		refused.refusal_detail = static_cast<uint32_t>(outputRefusal);
		return finish(refused);
	}
	soundscaper_pro_os_aac_m4a_encode_result result = encodeAnswer(SOUNDSCAPER_PRO_OS_CODEC_OK, true);
	result.exact_tuple_passed = 1u;
	result.output_bytes = outputBytes;
	result.frame_count = frameCount;
	result.sample_rate = request->sample_rate;
	result.channel_count = request->channel_count;
	result.bitrate_kbps = request->bitrate_kbps;
	keepOutput = true;
	return finish(result);
}

} // namespace

extern "C" soundscaper_pro_os_mp3_decode_result soundscaper_pro_os_mp3_decode(
	const soundscaper_pro_os_mp3_decode_request *request)
{
	return decodeOperatingSystemAudio(request, ReviewedCodec::mp3);
}

extern "C" soundscaper_pro_os_mp3_decode_result soundscaper_pro_os_aac_m4a_decode(
	const soundscaper_pro_os_mp3_decode_request *request)
{
	return decodeOperatingSystemAudio(request, ReviewedCodec::aacM4a);
}

extern "C" soundscaper_pro_os_aac_m4a_encode_result soundscaper_pro_os_aac_m4a_encode(
	const soundscaper_pro_os_aac_m4a_encode_request *request)
{
	return encodeOperatingSystemAacM4a(request);
}
