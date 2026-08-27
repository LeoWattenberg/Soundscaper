/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec.h"
#include "os_aac_m4a_profile.h"
#include "os_audio_codec_windows_file_bytes.h"
#include "os_audio_codec_windows_session.h"

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wrl/client.h>

#include <algorithm>
#include <cstdint>
#include <cmath>
#include <cstring>
#include <iterator>
#include <limits>
#include <string>
#include <vector>

namespace {

using Microsoft::WRL::ComPtr;
using soundscaper::os_audio::AacLcM4aRefusal;
using soundscaper::os_audio::BoundedFileRead;
using soundscaper::os_audio::MediaFoundationSession;

enum class ReviewedCodec {
	mp3,
	aacM4a,
};

enum class EncodedOutputInspection {
	exact,
	invalid,
	/* The completed file was read whole and is not the exact admitted tuple.
	 * That is a verdict about the encoder's output, not a failure to encode. */
	notExact,
	overLimit,
};

soundscaper_pro_os_mp3_decode_result answer(
	soundscaper_pro_os_codec_status status,
	bool nativeApiReached = false)
{
	soundscaper_pro_os_mp3_decode_result result{};
	result.status = status;
	result.native_api_reached = nativeApiReached ? 1u : 0u;
	return result;
}

soundscaper_pro_os_aac_m4a_encode_result encodeAnswer(
	soundscaper_pro_os_codec_status status,
	bool nativeApiReached = false)
{
	soundscaper_pro_os_aac_m4a_encode_result result{};
	result.status = status;
	result.native_api_reached = nativeApiReached ? 1u : 0u;
	return result;
}

bool requestShapeValues(
	const char *inputPath,
	const char *outputPath,
	uint64_t inputBytes,
	uint64_t maximumOutputBytes)
{
	return inputPath != nullptr && outputPath != nullptr && inputBytes > 0u
		&& maximumOutputBytes > 0u && std::strlen(inputPath) > 0u
		&& std::strlen(inputPath) <= 4096u && std::strlen(outputPath) > 0u
		&& std::strlen(outputPath) <= 4096u && std::strcmp(inputPath, outputPath) != 0;
}

bool requestShape(const soundscaper_pro_os_mp3_decode_request *request)
{
	return request != nullptr && requestShapeValues(
		request->input_path_utf8, request->output_path_utf8,
		request->input_bytes, request->maximum_output_bytes);
}

bool widePath(const char *value, std::wstring &result)
{
	const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, nullptr, 0);
	if (length <= 1 || length > 32768) return false;
	result.resize(static_cast<size_t>(length));
	if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1,
		result.data(), length) != length) return false;
	result.pop_back();
	return true;
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
	return request != nullptr && requestShapeValues(
		request->input_path_utf8, request->output_path_utf8,
		request->input_bytes, request->maximum_output_bytes)
		&& request->input_bytes <= 32u * 1024u * 1024u
		&& request->maximum_output_bytes <= 128u * 1024u * 1024u
		&& request->input_bytes % (2u * sizeof(float)) == 0u
		&& request->sample_rate == 48000u && request->channel_count == 2u
		&& request->bitrate_kbps == 160u;
}

bool readExactFloatInput(
	const std::wstring &path,
	uint64_t expectedBytes,
	std::vector<int16_t> &pcm,
	uint64_t &frameCount)
{
	if (expectedBytes == 0u || expectedBytes > 32u * 1024u * 1024u
		|| expectedBytes % (2u * sizeof(float)) != 0u
		|| expectedBytes > std::numeric_limits<DWORD>::max()) return false;
	HANDLE input = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
		FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
	if (input == INVALID_HANDLE_VALUE) return false;
	BY_HANDLE_FILE_INFORMATION information{};
	ULARGE_INTEGER size{};
	const bool metadata = GetFileInformationByHandle(input, &information) != 0;
	size.HighPart = information.nFileSizeHigh;
	size.LowPart = information.nFileSizeLow;
	std::vector<BYTE> bytes(static_cast<size_t>(expectedBytes));
	const bool read = metadata && (information.dwFileAttributes
		& (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) == 0u
		&& size.QuadPart == expectedBytes
		&& soundscaper::os_audio::readAllBytes(input, bytes.data(), bytes.size());
	const bool closed = CloseHandle(input) != 0;
	if (!read || !closed) return false;
	pcm.resize(bytes.size() / sizeof(float));
	for (size_t index = 0u; index < pcm.size(); ++index) {
		const size_t offset = index * sizeof(float);
		const uint32_t bits = static_cast<uint32_t>(bytes[offset])
			| static_cast<uint32_t>(bytes[offset + 1u]) << 8u
			| static_cast<uint32_t>(bytes[offset + 2u]) << 16u
			| static_cast<uint32_t>(bytes[offset + 3u]) << 24u;
		float sample = 0.0f;
		std::memcpy(&sample, &bits, sizeof(sample));
		if (!std::isfinite(sample)) return false;
		pcm[index] = sample <= -1.0f ? std::numeric_limits<int16_t>::min()
			: sample >= 1.0f ? std::numeric_limits<int16_t>::max()
				: static_cast<int16_t>(std::lround(sample * 32767.0f));
	}
	frameCount = pcm.size() / 2u;
	return frameCount > 0u;
}

EncodedOutputInspection inspectEncodedOutput(
	const std::wstring &path,
	uint64_t maximumBytes,
	uint64_t &outputBytes,
	AacLcM4aRefusal &refusal)
{
	std::vector<uint8_t> bytes;
	const BoundedFileRead outcome = soundscaper::os_audio::boundedFileBytes(path, maximumBytes, bytes);
	if (outcome == BoundedFileRead::overLimit) return EncodedOutputInspection::overLimit;
	if (outcome != BoundedFileRead::read) return EncodedOutputInspection::invalid;
	if (!soundscaper::os_audio::exactAacLcM4a(bytes, 48000u, 2u, refusal)) {
		return EncodedOutputInspection::notExact;
	}
	outputBytes = bytes.size();
	return EncodedOutputInspection::exact;
}

/**
 * Proves the admitted M4A input is exact AAC-LC from its own bytes. The length
 * was already authenticated, so a file that is no longer exactly that long is
 * refused by the bound rather than read in part.
 */
bool exactAacLcInput(
	const std::wstring &path,
	uint64_t expectedBytes,
	uint32_t sampleRate,
	uint32_t channelCount,
	AacLcM4aRefusal &refusal)
{
	std::vector<uint8_t> bytes;
	refusal = AacLcM4aRefusal::bounds;
	if (expectedBytes == 0u || expectedBytes > 32u * 1024u * 1024u
		|| soundscaper::os_audio::boundedFileBytes(path, expectedBytes, bytes) != BoundedFileRead::read
		|| bytes.size() != expectedBytes) return false;
	return soundscaper::os_audio::exactAacLcM4a(bytes, sampleRate, channelCount, refusal);
}

bool exactUnsigned(IMFMediaType *type, REFGUID key, uint32_t expected)
{
	UINT32 value = 0u;
	return SUCCEEDED(type->GetUINT32(key, &value)) && value == expected;
}

uint32_t bigEndian32(const BYTE *bytes)
{
	return static_cast<uint32_t>(bytes[0]) << 24u
		| static_cast<uint32_t>(bytes[1]) << 16u
		| static_cast<uint32_t>(bytes[2]) << 8u
		| static_cast<uint32_t>(bytes[3]);
}

bool exactMp4aSampleDescription(IMFMediaType *type)
{
	UINT32 currentEntry = 0u;
	UINT32 blobBytes = 0u;
	if (FAILED(type->GetUINT32(MF_MT_MPEG4_CURRENT_SAMPLE_ENTRY, &currentEntry))
		|| currentEntry != 0u
		|| FAILED(type->GetBlobSize(MF_MT_MPEG4_SAMPLE_DESCRIPTION, &blobBytes))
		|| blobBytes < 24u || blobBytes > 1024u * 1024u) return false;
	std::vector<BYTE> blob(blobBytes);
	UINT32 copied = 0u;
	if (FAILED(type->GetBlob(MF_MT_MPEG4_SAMPLE_DESCRIPTION,
		blob.data(), blobBytes, &copied)) || copied != blobBytes) return false;
	constexpr BYTE stsd[] = { 's', 't', 's', 'd' };
	constexpr BYTE mp4a[] = { 'm', 'p', '4', 'a' };
	if (bigEndian32(blob.data()) != blobBytes
		|| !std::equal(std::begin(stsd), std::end(stsd), blob.begin() + 4u)
		|| bigEndian32(blob.data() + 8u) != 0u) return false;
	const uint32_t entryCount = bigEndian32(blob.data() + 12u);
	if (entryCount < 1u || entryCount > 64u) return false;
	size_t offset = 16u;
	for (uint32_t index = 0u; index < entryCount; ++index) {
		if (offset > blob.size() || blob.size() - offset < 8u) return false;
		const uint32_t entryBytes = bigEndian32(blob.data() + offset);
		if (entryBytes < 8u || entryBytes > blob.size() - offset) return false;
		if (index == currentEntry
			&& !std::equal(std::begin(mp4a), std::end(mp4a), blob.begin() + offset + 4u)) return false;
		offset += entryBytes;
	}
	return offset == blob.size();
}

bool exactNativeType(
	IMFMediaType *type,
	ReviewedCodec codec,
	UINT32 &sampleRate,
	UINT32 &channelCount)
{
	GUID majorType{};
	GUID subtype{};
	if (FAILED(type->GetGUID(MF_MT_MAJOR_TYPE, &majorType)) || majorType != MFMediaType_Audio
		|| FAILED(type->GetGUID(MF_MT_SUBTYPE, &subtype))
		|| FAILED(type->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &sampleRate))
		|| FAILED(type->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &channelCount))) return false;
	if (codec == ReviewedCodec::mp3) return subtype == MFAudioFormat_MP3
		&& sampleRate >= 8000u && sampleRate <= 192000u
		&& channelCount >= 1u && channelCount <= 2u;
	/* Both of these are optional on an MPEG-4 media type. MF_MT_AAC_PAYLOAD_TYPE
	 * is documented to default to 0, raw_data_block elements, when it is absent,
	 * and MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION carries the file's
	 * audioProfileLevelIndication, which only exists when the file carries an
	 * initial object descriptor. Requiring either to be present refuses ordinary
	 * conforming M4A files. The AudioSpecificConfig in the file itself is the
	 * witness that the stream is AAC-LC, and the caller proves it from the bytes. */
	UINT32 payloadType = 0u;
	if (SUCCEEDED(type->GetUINT32(MF_MT_AAC_PAYLOAD_TYPE, &payloadType)) && payloadType != 0u) {
		return false;
	}
	UINT32 profile = 0u;
	if (SUCCEEDED(type->GetUINT32(MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, &profile))
		&& profile != 0x29u && profile != 0x2au && profile != 0x2bu) return false;
	return subtype == MFAudioFormat_AAC
		&& sampleRate >= 8000u && sampleRate <= 48000u
		&& channelCount >= 1u && channelCount <= 6u
		&& exactMp4aSampleDescription(type);
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
	if (!widePath(request->input_path_utf8, inputPath) || !widePath(request->output_path_utf8, outputPath)) {
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
	ComPtr<IMFMediaType> nativeType;
	UINT32 sourceSampleRate = 0u;
	UINT32 sourceChannelCount = 0u;
	if (FAILED(reader->GetNativeMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0u, &nativeType))
		|| !exactNativeType(nativeType.Get(), codec, sourceSampleRate, sourceChannelCount)) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
	}

	ComPtr<IMFMediaType> requestedType;
	if (FAILED(MFCreateMediaType(&requestedType))
		|| FAILED(requestedType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio))
		|| FAILED(requestedType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_Float))
		|| FAILED(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, requestedType.Get()))) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
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
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true));
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
	if (!widePath(request->input_path_utf8, inputPath) || !widePath(request->output_path_utf8, outputPath)) {
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
	if (!readExactFloatInput(inputPath, request->input_bytes, pcm, frameCount)) {
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
	constexpr UINT32 pcmBlockAlignment = 2u * sizeof(int16_t);
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
		std::memcpy(destination, pcm.data() + frameOffset * request->channel_count, bufferBytes);
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
