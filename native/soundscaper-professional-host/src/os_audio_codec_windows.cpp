/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wrl/client.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <iterator>
#include <limits>
#include <string>
#include <vector>

namespace {

using Microsoft::WRL::ComPtr;

enum class ReviewedCodec {
	mp3,
	aacM4a,
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

bool requestShape(const soundscaper_pro_os_mp3_decode_request *request)
{
	return request != nullptr && request->input_path_utf8 != nullptr
		&& request->output_path_utf8 != nullptr && request->input_bytes > 0u
		&& request->maximum_output_bytes > 0u
		&& std::strlen(request->input_path_utf8) > 0u
		&& std::strlen(request->input_path_utf8) <= 4096u
		&& std::strlen(request->output_path_utf8) > 0u
		&& std::strlen(request->output_path_utf8) <= 4096u
		&& std::strcmp(request->input_path_utf8, request->output_path_utf8) != 0;
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
	UINT32 profile = 0u;
	return subtype == MFAudioFormat_AAC
		&& sampleRate >= 8000u && sampleRate <= 48000u
		&& channelCount >= 1u && channelCount <= 6u
		&& exactUnsigned(type, MF_MT_AAC_PAYLOAD_TYPE, 0u)
		&& SUCCEEDED(type->GetUINT32(MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, &profile))
		&& (profile == 0x29u || profile == 0x2au || profile == 0x2bu)
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

	const HRESULT comStatus = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
	const bool uninitializeCom = SUCCEEDED(comStatus);
	if (FAILED(comStatus) && comStatus != RPC_E_CHANGED_MODE) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE);
	}
	const HRESULT startupStatus = MFStartup(MF_VERSION, MFSTARTUP_FULL);
	if (FAILED(startupStatus)) {
		if (uninitializeCom) CoUninitialize();
		return answer(SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE);
	}
	bool keepOutput = false;
	auto finish = [&](soundscaper_pro_os_mp3_decode_result result) {
		if (!keepOutput) DeleteFileW(outputPath.c_str());
		MFShutdown();
		if (uninitializeCom) CoUninitialize();
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
