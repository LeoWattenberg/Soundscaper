/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec.h"

#include <AudioToolbox/AudioToolbox.h>
#include <CoreFoundation/CoreFoundation.h>

#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <limits>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace {

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

bool exactInputFile(const char *path, uint64_t expectedBytes)
{
	struct stat metadata{};
	return lstat(path, &metadata) == 0 && S_ISREG(metadata.st_mode)
		&& static_cast<uint64_t>(metadata.st_size) == expectedBytes;
}

CFURLRef fileUrl(const char *path)
{
	return CFURLCreateFromFileSystemRepresentation(
		kCFAllocatorDefault,
		reinterpret_cast<const UInt8 *>(path),
		static_cast<CFIndex>(std::strlen(path)),
		false);
}

bool writeAll(int descriptor, const uint8_t *bytes, size_t length)
{
	size_t offset = 0u;
	while (offset < length) {
		const ssize_t written = write(descriptor, bytes + offset, length - offset);
		if (written < 0 && errno == EINTR) continue;
		if (written <= 0) return false;
		offset += static_cast<size_t>(written);
	}
	return true;
}

bool finiteSamples(const float *samples, size_t count)
{
	for (size_t index = 0u; index < count; ++index) {
		if (!std::isfinite(samples[index])) return false;
	}
	return true;
}

} // namespace

extern "C" soundscaper_pro_os_mp3_decode_result soundscaper_pro_os_mp3_decode(
	const soundscaper_pro_os_mp3_decode_request *request)
{
	if (!requestShape(request)) return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	if (!exactInputFile(request->input_path_utf8, request->input_bytes)) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INPUT_CHANGED);
	}
	struct stat outputMetadata{};
	if (lstat(request->output_path_utf8, &outputMetadata) == 0 || errno != ENOENT) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	}

	CFURLRef inputUrl = fileUrl(request->input_path_utf8);
	if (inputUrl == nullptr) return answer(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST);
	ExtAudioFileRef input = nullptr;
	const OSStatus openStatus = ExtAudioFileOpenURL(inputUrl, &input);
	CFRelease(inputUrl);
	if (openStatus != noErr || input == nullptr) {
		return answer(SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, true);
	}
	auto finish = [&](soundscaper_pro_os_mp3_decode_result result, int output) {
		ExtAudioFileDispose(input);
		if (output >= 0) close(output);
		if (result.status != SOUNDSCAPER_PRO_OS_CODEC_OK) std::remove(request->output_path_utf8);
		return result;
	};

	AudioStreamBasicDescription source{};
	UInt32 descriptionBytes = sizeof(source);
	if (ExtAudioFileGetProperty(input, kExtAudioFileProperty_FileDataFormat,
		&descriptionBytes, &source) != noErr || source.mFormatID != kAudioFormatMPEGLayer3) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true), -1);
	}
	if (!(source.mSampleRate >= 8000.0 && source.mSampleRate <= 192000.0)
		|| source.mSampleRate != static_cast<uint32_t>(source.mSampleRate)
		|| source.mChannelsPerFrame < 1u || source.mChannelsPerFrame > 8u) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true), -1);
	}
	const uint32_t sampleRate = static_cast<uint32_t>(source.mSampleRate);
	const uint32_t channelCount = source.mChannelsPerFrame;
	AudioStreamBasicDescription client{};
	client.mSampleRate = source.mSampleRate;
	client.mFormatID = kAudioFormatLinearPCM;
	client.mFormatFlags = kAudioFormatFlagsNativeFloatPacked;
	client.mBytesPerPacket = channelCount * static_cast<uint32_t>(sizeof(float));
	client.mFramesPerPacket = 1u;
	client.mBytesPerFrame = client.mBytesPerPacket;
	client.mChannelsPerFrame = channelCount;
	client.mBitsPerChannel = 32u;
	if (ExtAudioFileSetProperty(input, kExtAudioFileProperty_ClientDataFormat,
		sizeof(client), &client) != noErr) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, true), -1);
	}

	const int output = open(request->output_path_utf8,
		O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR);
	if (output < 0) return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED, true), -1);
	constexpr UInt32 blockFrames = 4096u;
	std::vector<float> samples(static_cast<size_t>(blockFrames) * channelCount);
	uint64_t outputBytes = 0u;
	uint64_t frameCount = 0u;
	for (;;) {
		UInt32 frames = blockFrames;
		AudioBufferList buffers{};
		buffers.mNumberBuffers = 1u;
		buffers.mBuffers[0].mNumberChannels = channelCount;
		buffers.mBuffers[0].mDataByteSize = static_cast<UInt32>(samples.size() * sizeof(float));
		buffers.mBuffers[0].mData = samples.data();
		if (ExtAudioFileRead(input, &frames, &buffers) != noErr) {
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, true), output);
		}
		if (frames == 0u) break;
		const uint64_t bytes = static_cast<uint64_t>(frames) * channelCount * sizeof(float);
		if (bytes > buffers.mBuffers[0].mDataByteSize || outputBytes > request->maximum_output_bytes
			|| bytes > request->maximum_output_bytes - outputBytes
			|| !finiteSamples(samples.data(), static_cast<size_t>(frames) * channelCount)) {
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT, true), output);
		}
		if (!writeAll(output, reinterpret_cast<const uint8_t *>(samples.data()), static_cast<size_t>(bytes))) {
			return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED, true), output);
		}
		outputBytes += bytes;
		frameCount += frames;
	}
	if (outputBytes == 0u || frameCount == 0u || fsync(output) != 0) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, true), output);
	}
	if (close(output) != 0) {
		return finish(answer(SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED, true), -1);
	}
	soundscaper_pro_os_mp3_decode_result result = answer(SOUNDSCAPER_PRO_OS_CODEC_OK, true);
	result.exact_tuple_passed = 1u;
	result.output_bytes = outputBytes;
	result.frame_count = frameCount;
	result.sample_rate = sampleRate;
	result.channel_count = channelCount;
	return finish(result, -1);
}
