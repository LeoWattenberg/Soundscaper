/* SPDX-License-Identifier: AGPL-3.0-only */

#include "gpu_runtime.hpp"

#include "openfx_abi.hpp"

#include <algorithm>
#include <array>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string_view>
#include <unordered_map>
#include <utility>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace framescaper::openfx {
namespace {

thread_local GpuRenderSession* current_session = nullptr;

class RuntimeLibrary final {
public:
	explicit RuntimeLibrary(const std::initializer_list<const char*> names) {
		for (const auto* name : names) {
#ifdef _WIN32
			handle_ = reinterpret_cast<void*>(LoadLibraryExA(
				name, nullptr, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS
			));
#else
			handle_ = dlopen(name, RTLD_NOW | RTLD_LOCAL);
#endif
			if (handle_ != nullptr) break;
		}
		if (handle_ == nullptr) {
			throw gpu_runtime_error{"unsupported-backend", "The qualified GPU runtime library is unavailable."};
		}
	}
	~RuntimeLibrary() {
#ifdef _WIN32
		if (handle_ != nullptr) FreeLibrary(reinterpret_cast<HMODULE>(handle_));
#else
		if (handle_ != nullptr) dlclose(handle_);
#endif
	}
	RuntimeLibrary(const RuntimeLibrary&) = delete;
	RuntimeLibrary& operator=(const RuntimeLibrary&) = delete;

	template <typename Function>
	Function require(const char* name) const {
#ifdef _WIN32
		auto* symbol = reinterpret_cast<void*>(GetProcAddress(reinterpret_cast<HMODULE>(handle_), name));
#else
		auto* symbol = dlsym(handle_, name);
#endif
		if (symbol == nullptr) {
			throw gpu_runtime_error{"unsupported-backend", "The qualified GPU runtime ABI is incomplete."};
		}
		return reinterpret_cast<Function>(symbol);
	}

private:
	void* handle_{};
};

template <typename Release>
class PendingResource final {
public:
	explicit PendingResource(Release release) noexcept : release_{std::move(release)} {}
	~PendingResource() noexcept { if (armed_) release_(); }
	PendingResource(const PendingResource&) = delete;
	PendingResource& operator=(const PendingResource&) = delete;
	void dismiss() noexcept { armed_ = false; }

private:
	Release release_;
	bool armed_{true};
};

class FixtureSession final : public GpuRenderSession {
public:
	FixtureSession(const Backend backend, const std::vector<GpuFrameBinding>& frames)
		: backend_{backend} {
		static_cast<void>(frames);
		const auto* failure = std::getenv("FRAMESCAPER_OPENFX_FIXTURE_GPU_FAILURE");
		if (failure != nullptr && std::string_view{failure} == kRenderBackends[static_cast<std::size_t>(backend)]) {
			throw gpu_runtime_error{"gpu-execution-failed", "The conformance GPU setup failed as requested."};
		}
	}
	void* image_data(RgbaFrame& frame) override { return frame.rgba.data(); }
	void* opencl_image(RgbaFrame& frame) override { return frame.rgba.data(); }
	void* command_queue() const override { return const_cast<FixtureSession*>(this); }
	std::uint32_t open_gl_texture(RgbaFrame& frame, const bool output) override {
		static_cast<void>(output);
		const auto found = textures_.find(&frame);
		if (found != textures_.end()) return found->second;
		const auto index = next_texture_++;
		textures_.emplace(&frame, index);
		return index;
	}
	std::uint32_t open_gl_target() const override { return 0x0DE1U; }
	void free_open_gl_texture(const std::uint32_t index, const bool output) override {
		if (output) return;
		for (auto iterator = textures_.begin(); iterator != textures_.end(); ++iterator) {
			if (iterator->second == index) { textures_.erase(iterator); return; }
		}
	}
	void flush() override {}
	void complete() override {}
	void release() noexcept override { released_ = true; }
	bool released() const noexcept override { return released_; }
	Backend backend() const noexcept override { return backend_; }

private:
	Backend backend_;
	std::unordered_map<RgbaFrame*, std::uint32_t> textures_;
	std::uint32_t next_texture_{1};
	bool released_{};
};

class OpenClSession final : public GpuRenderSession {
public:
	[[nodiscard]] static std::unique_ptr<OpenClSession> create(
		const std::vector<GpuFrameBinding>& frames
	) {
		auto session = std::unique_ptr<OpenClSession>{new OpenClSession{}};
		session->initialize(frames);
		return session;
	}
	~OpenClSession() override { release(); }
	void* image_data(RgbaFrame& frame) override { return buffers_.at(&frame).handle; }
	void* command_queue() const override { return queue_; }
	void flush() override { if (finish_(queue_) != 0) failed(); }
	void complete() override {
		flush();
		for (const auto& [frame, buffer] : buffers_) if (buffer.output) {
			if (read_buffer_(queue_, buffer.handle, 1, 0, frame->rgba.size(), frame->rgba.data(), 0, nullptr, nullptr) != 0) failed();
		}
	}
	void release() noexcept override {
		if (released_) return;
		for (const auto& [frame, buffer] : buffers_) { static_cast<void>(frame); release_memory_(buffer.handle); }
		buffers_.clear();
		for (auto* program : programs_) release_program_(program);
		if (queue_ != nullptr) release_queue_(queue_);
		if (context_ != nullptr) release_context_(context_);
		queue_ = nullptr; context_ = nullptr; released_ = true;
	}
	bool released() const noexcept override { return released_; }
	Backend backend() const noexcept override { return Backend::opencl; }
	OfxStatus compile(const char* source, int optional, void* result) noexcept {
		if (source == nullptr || result == nullptr || optional != 0) return kOfxStatReplyDefault;
		try {
			const std::size_t length = std::strlen(source);
			int error = 0; const char* sources[]{source}; const std::size_t lengths[]{length};
			auto* program = create_program_(context_, 1, sources, lengths, &error);
			if (program == nullptr) return kOfxStatGPURenderFailed;
			PendingResource pending{[this, program]() noexcept { release_program_(program); }};
			const void* selected_device = device_;
			if (error != 0 || build_program_(program, 1, &selected_device, "", nullptr, nullptr) != 0) return kOfxStatGPURenderFailed;
			programs_.push_back(program); pending.dismiss();
			*static_cast<void**>(result) = program; return kOfxStatOK;
		} catch (...) { return kOfxStatGPURenderFailed; }
	}

private:
	OpenClSession()
		: library_({
#ifdef _WIN32
			"OpenCL.dll"
#elif defined(__APPLE__)
			"/System/Library/Frameworks/OpenCL.framework/OpenCL", "libOpenCL.dylib"
#else
			"libOpenCL.so.1", "libOpenCL.so"
#endif
		}) {
		load_api();
	}
	void initialize(const std::vector<GpuFrameBinding>& frames) {
		buffers_.reserve(frames.size());
		unsigned platform_count = 0;
		if (get_platforms_(0, nullptr, &platform_count) != 0 || platform_count == 0) unavailable();
		std::vector<void*> platforms(platform_count);
		if (get_platforms_(platform_count, platforms.data(), nullptr) != 0) unavailable();
		for (auto* platform : platforms) {
			unsigned count = 0;
			if (get_devices_(platform, 1U << 2U, 0, nullptr, &count) != 0 || count == 0) continue;
			std::vector<void*> devices(count);
			if (get_devices_(platform, 1U << 2U, count, devices.data(), nullptr) == 0) {
				device_ = devices.front(); break;
			}
		}
		if (device_ == nullptr) unavailable();
		int error = 0;
		const void* selected_device = device_;
		context_ = create_context_(nullptr, 1, &selected_device, nullptr, nullptr, &error);
		if (context_ == nullptr || error != 0) failed();
		queue_ = create_queue_(context_, device_, 0, &error);
		if (queue_ == nullptr || error != 0) failed();
		for (const auto& binding : frames) {
			void* host = binding.output ? nullptr : binding.frame->rgba.data();
			const auto flags = 1ULL | (host == nullptr ? 0ULL : 1ULL << 5U);
			auto* buffer = create_buffer_(context_, flags, binding.frame->rgba.size(), host, &error);
			if (buffer == nullptr) failed();
			PendingResource pending{[this, buffer]() noexcept { release_memory_(buffer); }};
			if (error != 0) failed();
			const auto [iterator, inserted] = buffers_.emplace(
				binding.frame, Buffer{buffer, binding.output}
			);
			static_cast<void>(iterator);
			if (!inserted) failed();
			pending.dismiss();
		}
	}
	struct Buffer { void* handle{}; bool output{}; };
	using GetPlatforms = int (*)(unsigned, void**, unsigned*);
	using GetDevices = int (*)(void*, unsigned long long, unsigned, void**, unsigned*);
	using CreateContext = void* (*)(const std::intptr_t*, unsigned, const void**, void (*)(const char*, const void*, std::size_t, void*), void*, int*);
	using CreateQueue = void* (*)(void*, void*, unsigned long long, int*);
	using CreateBuffer = void* (*)(void*, unsigned long long, std::size_t, void*, int*);
	using ReadBuffer = int (*)(void*, void*, unsigned, std::size_t, std::size_t, void*, unsigned, const void**, void**);
	using Finish = int (*)(void*);
	using Release = int (*)(void*);
	using CreateProgram = void* (*)(void*, unsigned, const char**, const std::size_t*, int*);
	using BuildProgram = int (*)(void*, unsigned, const void**, const char*, void (*)(void*, void*), void*);
	[[noreturn]] static void unavailable() { throw gpu_runtime_error{"unsupported-backend", "No qualified OpenCL GPU device is available."}; }
	[[noreturn]] static void failed() { throw gpu_runtime_error{"gpu-execution-failed", "The OpenCL render context failed."}; }
	void load_api() {
		get_platforms_ = library_.require<GetPlatforms>("clGetPlatformIDs");
		get_devices_ = library_.require<GetDevices>("clGetDeviceIDs");
		create_context_ = library_.require<CreateContext>("clCreateContext");
		create_queue_ = library_.require<CreateQueue>("clCreateCommandQueue");
		create_buffer_ = library_.require<CreateBuffer>("clCreateBuffer");
		read_buffer_ = library_.require<ReadBuffer>("clEnqueueReadBuffer");
		finish_ = library_.require<Finish>("clFinish");
		release_memory_ = library_.require<Release>("clReleaseMemObject");
		release_queue_ = library_.require<Release>("clReleaseCommandQueue");
		release_context_ = library_.require<Release>("clReleaseContext");
		create_program_ = library_.require<CreateProgram>("clCreateProgramWithSource");
		build_program_ = library_.require<BuildProgram>("clBuildProgram");
		release_program_ = library_.require<Release>("clReleaseProgram");
	}
	RuntimeLibrary library_;
	GetPlatforms get_platforms_{}; GetDevices get_devices_{}; CreateContext create_context_{};
	CreateQueue create_queue_{}; CreateBuffer create_buffer_{}; ReadBuffer read_buffer_{};
	Finish finish_{}; Release release_memory_{}; Release release_queue_{}; Release release_context_{};
	CreateProgram create_program_{}; BuildProgram build_program_{}; Release release_program_{};
	void* device_{}; void* context_{}; void* queue_{};
	std::unordered_map<RgbaFrame*, Buffer> buffers_; std::vector<void*> programs_; bool released_{};
};

class CudaSession final : public GpuRenderSession {
public:
	[[nodiscard]] static std::unique_ptr<CudaSession> create(
		const std::vector<GpuFrameBinding>& frames
	) {
		auto session = std::unique_ptr<CudaSession>{new CudaSession{}};
		session->initialize(frames);
		return session;
	}
	~CudaSession() override { release(); }
	void* image_data(RgbaFrame& frame) override { return reinterpret_cast<void*>(buffers_.at(&frame).address); }
	void* command_queue() const override { return stream_; }
	void flush() override { if (synchronize_context_() != 0) failed(); }
	void complete() override {
		flush();
		for (const auto& [frame, buffer] : buffers_) if (buffer.output
			&& copy_from_(frame->rgba.data(), buffer.address, frame->rgba.size()) != 0) failed();
	}
	void release() noexcept override {
		if (released_) return;
		for (const auto& [frame, buffer] : buffers_) { static_cast<void>(frame); free_(buffer.address); }
		buffers_.clear(); if (stream_ != nullptr) destroy_stream_(stream_);
		if (context_ != nullptr) destroy_context_(context_);
		stream_ = nullptr; context_ = nullptr; released_ = true;
	}
	bool released() const noexcept override { return released_; }
	Backend backend() const noexcept override { return Backend::cuda; }

private:
	CudaSession()
		: library_({
#ifdef _WIN32
			"nvcuda.dll"
#else
			"libcuda.so.1", "libcuda.so"
#endif
		}) {
		load_api();
	}
	void initialize(const std::vector<GpuFrameBinding>& frames) {
		buffers_.reserve(frames.size());
		int device = 0;
		if (initialize_(0) != 0 || get_device_(&device, 0) != 0) unavailable();
		if (create_context_(&context_, 0, device) != 0 || create_stream_(&stream_, 0) != 0) failed();
		for (const auto& binding : frames) {
			std::uintptr_t allocation = 0;
			const auto status = allocate_(&allocation, binding.frame->rgba.size());
			PendingResource pending{[this, allocation]() noexcept {
				if (allocation != 0) free_(allocation);
			}};
			if (status != 0) failed();
			if (!binding.output && copy_to_(allocation, binding.frame->rgba.data(), binding.frame->rgba.size()) != 0) failed();
			const auto [iterator, inserted] = buffers_.emplace(
				binding.frame, Buffer{allocation, binding.output}
			);
			static_cast<void>(iterator);
			if (!inserted) failed();
			pending.dismiss();
		}
	}
	struct Buffer { std::uintptr_t address{}; bool output{}; };
	using Initialize = int (*)(unsigned); using GetDevice = int (*)(int*, int);
	using CreateContext = int (*)(void**, unsigned, int); using DestroyContext = int (*)(void*);
	using CreateStream = int (*)(void**, unsigned); using DestroyStream = int (*)(void*);
	using Allocate = int (*)(std::uintptr_t*, std::size_t); using Free = int (*)(std::uintptr_t);
	using CopyTo = int (*)(std::uintptr_t, const void*, std::size_t);
	using CopyFrom = int (*)(void*, std::uintptr_t, std::size_t); using SynchronizeContext = int (*)();
	[[noreturn]] static void unavailable() { throw gpu_runtime_error{"unsupported-backend", "No qualified CUDA GPU device is available."}; }
	[[noreturn]] static void failed() { throw gpu_runtime_error{"gpu-execution-failed", "The CUDA render context failed."}; }
	template <typename Function> Function versioned(const char* v2, const char* plain) {
		try { return library_.require<Function>(v2); } catch (const gpu_runtime_error&) { return library_.require<Function>(plain); }
	}
	void load_api() {
		initialize_ = library_.require<Initialize>("cuInit"); get_device_ = library_.require<GetDevice>("cuDeviceGet");
		create_context_ = versioned<CreateContext>("cuCtxCreate_v2", "cuCtxCreate"); destroy_context_ = versioned<DestroyContext>("cuCtxDestroy_v2", "cuCtxDestroy");
		create_stream_ = library_.require<CreateStream>("cuStreamCreate"); destroy_stream_ = versioned<DestroyStream>("cuStreamDestroy_v2", "cuStreamDestroy");
		allocate_ = versioned<Allocate>("cuMemAlloc_v2", "cuMemAlloc"); free_ = versioned<Free>("cuMemFree_v2", "cuMemFree");
		copy_to_ = versioned<CopyTo>("cuMemcpyHtoD_v2", "cuMemcpyHtoD"); copy_from_ = versioned<CopyFrom>("cuMemcpyDtoH_v2", "cuMemcpyDtoH");
		synchronize_context_ = library_.require<SynchronizeContext>("cuCtxSynchronize");
	}
	RuntimeLibrary library_; Initialize initialize_{}; GetDevice get_device_{}; CreateContext create_context_{};
	DestroyContext destroy_context_{}; CreateStream create_stream_{}; DestroyStream destroy_stream_{};
	Allocate allocate_{}; Free free_{}; CopyTo copy_to_{}; CopyFrom copy_from_{}; SynchronizeContext synchronize_context_{};
	void* context_{}; void* stream_{}; std::unordered_map<RgbaFrame*, Buffer> buffers_; bool released_{};
};

class EglOpenGlSession final : public GpuRenderSession {
public:
	[[nodiscard]] static std::unique_ptr<EglOpenGlSession> create(
		const std::vector<GpuFrameBinding>& frames
	) {
		auto session = std::unique_ptr<EglOpenGlSession>{new EglOpenGlSession{}};
		session->initialize(frames);
		return session;
	}
	~EglOpenGlSession() override { release(); }
	void* image_data(RgbaFrame&) override { return nullptr; }
	void* command_queue() const override { return context_; }
	std::uint32_t open_gl_texture(RgbaFrame& frame, const bool output) override {
		const auto found = textures_.find(&frame);
		if (found == textures_.end() || found->second.output != output) failed();
		if (output) bind_framebuffer_(0x8D40U, framebuffer_);
		return found->second.index;
	}
	std::uint32_t open_gl_target() const override { return 0x0DE1U; }
	void free_open_gl_texture(const std::uint32_t index, const bool output) override {
		if (output) return;
		const auto found = std::find_if(textures_.begin(), textures_.end(), [index](const auto& entry) { return entry.second.index == index; });
		if (found != textures_.end()) { delete_textures_(1, &found->second.index); textures_.erase(found); }
	}
	void flush() override { finish_(); if (get_error_() != 0) failed(); }
	void complete() override {
		flush(); const auto output = std::find_if(textures_.begin(), textures_.end(), [](const auto& entry) { return entry.second.output; });
		if (output == textures_.end()) failed();
		auto& frame = *output->first;
		std::vector<unsigned char> packed(frame.layout.width * frame.layout.height * 4U);
		bind_framebuffer_(0x8D40U, framebuffer_); read_pixels_(0, 0, static_cast<int>(frame.layout.width), static_cast<int>(frame.layout.height), 0x1908U, 0x1401U, packed.data());
		if (get_error_() != 0) failed();
		for (std::size_t row = 0; row < frame.layout.height; ++row) std::copy_n(
			packed.data() + (frame.layout.height - row - 1U) * frame.layout.width * 4U,
			frame.layout.width * 4U, frame.rgba.data() + row * frame.layout.row_bytes
		);
	}
	void release() noexcept override {
		if (released_) return;
		if (display_ != nullptr && context_ != nullptr) make_current_(display_, surface_, surface_, context_);
		for (const auto& [frame, texture] : textures_) { static_cast<void>(frame); delete_textures_(1, &texture.index); }
		textures_.clear(); if (framebuffer_ != 0) delete_framebuffers_(1, &framebuffer_);
		if (display_ != nullptr && initialized_) { make_current_(display_, nullptr, nullptr, nullptr); if (context_ != nullptr) destroy_context_(display_, context_); if (surface_ != nullptr) destroy_surface_(display_, surface_); terminate_(display_); }
		display_ = nullptr; context_ = nullptr; surface_ = nullptr; released_ = true;
	}
	bool released() const noexcept override { return released_; }
	Backend backend() const noexcept override { return Backend::opengl; }

private:
	EglOpenGlSession()
		: egl_({
#ifdef _WIN32
			"libEGL.dll", "EGL.dll"
#elif defined(__APPLE__)
			"libEGL.dylib"
#else
			"libEGL.so.1", "libEGL.so"
#endif
		}) {
		load_egl();
	}
	void initialize(const std::vector<GpuFrameBinding>& frames) {
		textures_.reserve(frames.size());
		display_ = get_display_(nullptr);
		int major = 0; int minor = 0;
		if (display_ == nullptr || initialize_(display_, &major, &minor) == 0) unavailable();
		initialized_ = true;
		if (bind_api_(0x30A2U) == 0) unavailable();
		const int attributes[]{0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3033, 1, 0x3040, 8, 0x3038};
		void* config = nullptr; int count = 0;
		if (choose_config_(display_, attributes, &config, 1, &count) == 0 || count != 1) unavailable();
		const int pbuffer[]{0x3057, 1, 0x3056, 1, 0x3038};
		surface_ = create_surface_(display_, config, pbuffer);
		context_ = create_context_(display_, config, nullptr, nullptr);
		if (surface_ == nullptr || context_ == nullptr || make_current_(display_, surface_, surface_, context_) == 0) failed();
		load_gl();
		for (const auto& binding : frames) create_texture(binding);
	}
	struct Texture { std::uint32_t index{}; bool output{}; };
	using GetDisplay = void* (*)(void*); using Initialize = unsigned (*)(void*, int*, int*);
	using BindApi = unsigned (*)(unsigned); using ChooseConfig = unsigned (*)(void*, const int*, void**, int, int*);
	using CreateSurface = void* (*)(void*, void*, const int*); using CreateContext = void* (*)(void*, void*, void*, const int*);
	using MakeCurrent = unsigned (*)(void*, void*, void*, void*); using Destroy = unsigned (*)(void*, void*);
	using Terminate = unsigned (*)(void*); using GetProc = void* (*)(const char*);
	using Gen = void (*)(int, std::uint32_t*); using Delete = void (*)(int, const std::uint32_t*); using Bind = void (*)(std::uint32_t, std::uint32_t);
	using TexParameter = void (*)(std::uint32_t, std::uint32_t, int);
	using TexImage = void (*)(std::uint32_t, int, int, int, int, int, std::uint32_t, std::uint32_t, const void*);
	using FrameTexture = void (*)(std::uint32_t, std::uint32_t, std::uint32_t, std::uint32_t, int);
	using ReadPixels = void (*)(int, int, int, int, std::uint32_t, std::uint32_t, void*);
	using Finish = void (*)(); using GetError = std::uint32_t (*)();
	[[noreturn]] static void unavailable() { throw gpu_runtime_error{"unsupported-backend", "No qualified EGL OpenGL context is available."}; }
	[[noreturn]] static void failed() { throw gpu_runtime_error{"gpu-execution-failed", "The OpenGL render context failed."}; }
	template <typename Function> Function gl(const char* name) { auto* value = get_proc_(name); if (value == nullptr) unavailable(); return reinterpret_cast<Function>(value); }
	void load_egl() {
		get_display_ = egl_.require<GetDisplay>("eglGetDisplay"); initialize_ = egl_.require<Initialize>("eglInitialize"); bind_api_ = egl_.require<BindApi>("eglBindAPI");
		choose_config_ = egl_.require<ChooseConfig>("eglChooseConfig"); create_surface_ = egl_.require<CreateSurface>("eglCreatePbufferSurface"); create_context_ = egl_.require<CreateContext>("eglCreateContext");
		make_current_ = egl_.require<MakeCurrent>("eglMakeCurrent"); destroy_context_ = egl_.require<Destroy>("eglDestroyContext"); destroy_surface_ = egl_.require<Destroy>("eglDestroySurface"); terminate_ = egl_.require<Terminate>("eglTerminate"); get_proc_ = egl_.require<GetProc>("eglGetProcAddress");
	}
	void load_gl() {
		gen_textures_ = gl<Gen>("glGenTextures"); delete_textures_ = gl<Delete>("glDeleteTextures"); bind_texture_ = gl<Bind>("glBindTexture"); tex_parameter_ = gl<TexParameter>("glTexParameteri"); tex_image_ = gl<TexImage>("glTexImage2D");
		gen_framebuffers_ = gl<Gen>("glGenFramebuffers"); delete_framebuffers_ = gl<Delete>("glDeleteFramebuffers"); bind_framebuffer_ = gl<Bind>("glBindFramebuffer"); frame_texture_ = gl<FrameTexture>("glFramebufferTexture2D"); read_pixels_ = gl<ReadPixels>("glReadPixels"); finish_ = gl<Finish>("glFinish"); get_error_ = gl<GetError>("glGetError");
	}
	void create_texture(const GpuFrameBinding& binding) {
		std::uint32_t texture = 0; gen_textures_(1, &texture); bind_texture_(0x0DE1U, texture);
		PendingResource pending{[this, texture]() noexcept {
			if (texture != 0) delete_textures_(1, &texture);
		}};
		tex_parameter_(0x0DE1U, 0x2801U, 0x2600); tex_parameter_(0x0DE1U, 0x2800U, 0x2600);
		std::vector<unsigned char> packed; const void* bytes = nullptr;
		if (!binding.output) { packed.resize(binding.frame->layout.width * binding.frame->layout.height * 4U); for (std::size_t row = 0; row < binding.frame->layout.height; ++row) std::copy_n(binding.frame->rgba.data() + row * binding.frame->layout.row_bytes, binding.frame->layout.width * 4U, packed.data() + row * binding.frame->layout.width * 4U); bytes = packed.data(); }
		tex_image_(0x0DE1U, 0, 0x8058, static_cast<int>(binding.frame->layout.width), static_cast<int>(binding.frame->layout.height), 0, 0x1908U, 0x1401U, bytes);
		const auto [iterator, inserted] = textures_.emplace(
			binding.frame, Texture{texture, binding.output}
		);
		static_cast<void>(iterator);
		if (!inserted) failed();
		pending.dismiss();
		if (binding.output) { gen_framebuffers_(1, &framebuffer_); bind_framebuffer_(0x8D40U, framebuffer_); frame_texture_(0x8D40U, 0x8CE0U, 0x0DE1U, texture, 0); }
		if (get_error_() != 0) failed();
	}
	RuntimeLibrary egl_; GetDisplay get_display_{}; Initialize initialize_{}; BindApi bind_api_{}; ChooseConfig choose_config_{}; CreateSurface create_surface_{}; CreateContext create_context_{}; MakeCurrent make_current_{}; Destroy destroy_context_{}; Destroy destroy_surface_{}; Terminate terminate_{}; GetProc get_proc_{};
	Gen gen_textures_{}; Delete delete_textures_{}; Bind bind_texture_{}; TexParameter tex_parameter_{}; TexImage tex_image_{}; Gen gen_framebuffers_{}; Delete delete_framebuffers_{}; Bind bind_framebuffer_{}; FrameTexture frame_texture_{}; ReadPixels read_pixels_{}; Finish finish_{}; GetError get_error_{};
	void* display_{}; void* surface_{}; void* context_{}; std::uint32_t framebuffer_{}; std::unordered_map<RgbaFrame*, Texture> textures_; bool initialized_{}; bool released_{};
};

#ifdef __APPLE__
class MetalSession final : public GpuRenderSession {
public:
	[[nodiscard]] static std::unique_ptr<MetalSession> create(
		const std::vector<GpuFrameBinding>& frames
	) {
		auto session = std::unique_ptr<MetalSession>{new MetalSession{}};
		session->initialize(frames);
		return session;
	}
	~MetalSession() override { release(); }
	void* image_data(RgbaFrame& frame) override { return buffers_.at(&frame).handle; }
	void* command_queue() const override { return queue_; }
	void flush() override {
		auto* command = message0_(queue_, selector_("commandBuffer")); if (command == nullptr) failed();
		message_void_(command, selector_("commit")); message_void_(command, selector_("waitUntilCompleted"));
	}
	void complete() override { flush(); for (const auto& [frame, buffer] : buffers_) if (buffer.output) { auto* bytes = message0_(buffer.handle, selector_("contents")); if (bytes == nullptr) failed(); std::memcpy(frame->rgba.data(), bytes, frame->rgba.size()); } }
	void release() noexcept override { if (released_) return; for (const auto& [frame, buffer] : buffers_) { static_cast<void>(frame); if (buffer.handle != nullptr) release_object_(buffer.handle); } buffers_.clear(); if (queue_ != nullptr) release_object_(queue_); if (device_ != nullptr) release_object_(device_); queue_ = nullptr; device_ = nullptr; released_ = true; }
	bool released() const noexcept override { return released_; }
	Backend backend() const noexcept override { return Backend::metal; }

private:
	using CreateDevice = void* (*)();
	MetalSession()
		: metal_({"/System/Library/Frameworks/Metal.framework/Metal"}), objc_({"/usr/lib/libobjc.A.dylib"}) {
		create_device_ = metal_.require<CreateDevice>("MTLCreateSystemDefaultDevice");
		selector_ = objc_.require<void* (*)(const char*)>("sel_registerName"); retain_object_ = objc_.require<void* (*)(void*)>("objc_retain"); release_object_ = objc_.require<void (*)(void*)>("objc_release");
		message0_ = objc_.require<void* (*)(void*, void*)>("objc_msgSend");
		message_bytes_ = objc_.require<void* (*)(void*, void*, const void*, std::size_t, std::uint64_t)>("objc_msgSend");
		message_length_ = objc_.require<void* (*)(void*, void*, std::size_t, std::uint64_t)>("objc_msgSend"); message_void_ = objc_.require<void (*)(void*, void*)>("objc_msgSend");
	}
	void initialize(const std::vector<GpuFrameBinding>& frames) {
		buffers_.reserve(frames.size());
		auto* device = create_device_();
		if (device == nullptr) failed();
		device_ = retain_object_(device);
		if (device_ == nullptr) failed();
		queue_ = message0_(device_, selector_("newCommandQueue"));
		if (queue_ == nullptr) failed();
		for (const auto& binding : frames) {
			auto* buffer = binding.output ? message_length_(device_, selector_("newBufferWithLength:options:"), binding.frame->rgba.size(), 0)
				: message_bytes_(device_, selector_("newBufferWithBytes:length:options:"), binding.frame->rgba.data(), binding.frame->rgba.size(), 0);
			if (buffer == nullptr) failed();
			PendingResource pending{[this, buffer]() noexcept { release_object_(buffer); }};
			const auto [iterator, inserted] = buffers_.emplace(
				binding.frame, Buffer{buffer, binding.output}
			);
			static_cast<void>(iterator);
			if (!inserted) failed();
			pending.dismiss();
		}
	}
	struct Buffer { void* handle{}; bool output{}; };
	[[noreturn]] static void failed() { throw gpu_runtime_error{"gpu-execution-failed", "The Metal render context failed."}; }
	RuntimeLibrary metal_; RuntimeLibrary objc_; CreateDevice create_device_{}; void* (*selector_)(const char*){}; void* (*retain_object_)(void*){}; void (*release_object_)(void*){}; void* (*message0_)(void*, void*){}; void* (*message_bytes_)(void*, void*, const void*, std::size_t, std::uint64_t){}; void* (*message_length_)(void*, void*, std::size_t, std::uint64_t){}; void (*message_void_)(void*, void*){}; void* device_{}; void* queue_{}; std::unordered_map<RgbaFrame*, Buffer> buffers_; bool released_{};
};
#endif

} // namespace

std::unique_ptr<GpuRenderSession> GpuRenderSession::create(
	const Backend backend,
	const std::vector<GpuFrameBinding>& frames
) {
	if (backend == Backend::cpu) throw gpu_runtime_error{"unsupported-backend", "CPU rendering does not use a GPU session."};
	if (frames.empty() || std::count_if(frames.begin(), frames.end(), [](const auto& frame) {
		return frame.output;
	}) != 1 || std::any_of(frames.begin(), frames.end(), [](const auto& frame) {
		return frame.frame == nullptr || !valid_rgba_frame_layout(frame.frame->layout)
			|| frame.frame->rgba.size() != frame.frame->layout.byte_length;
	})) throw gpu_runtime_error{"gpu-execution-failed", "The GPU frame set is invalid."};
	if (conformance_fixture_execution()) return std::make_unique<FixtureSession>(backend, frames);
	if (backend == Backend::opengl) return EglOpenGlSession::create(frames);
	if (backend == Backend::opencl) return OpenClSession::create(frames);
	if (backend == Backend::cuda) return CudaSession::create(frames);
#ifdef __APPLE__
	if (backend == Backend::metal) return MetalSession::create(frames);
#endif
	throw gpu_runtime_error{"unsupported-backend", "The requested qualified GPU provider is unavailable on this host."};
}

void GpuRenderSession::make_active() noexcept { current_session = this; }
void GpuRenderSession::clear_active() noexcept { if (current_session == this) current_session = nullptr; }
GpuRenderSession* active_gpu_session() noexcept { return current_session; }

OfxStatus compile_active_opencl_program(const char* source, const int optional, void* result) noexcept {
	auto* session = active_gpu_session();
	if (session == nullptr || session->backend() != Backend::opencl) return kOfxStatErrMissingHostFeature;
	if (conformance_fixture_execution()) {
		if (source == nullptr || result == nullptr) return kOfxStatErrValue;
		*static_cast<void**>(result) = session;
		return optional == 0 ? kOfxStatOK : kOfxStatReplyDefault;
	}
	auto* opencl = dynamic_cast<OpenClSession*>(session);
	return opencl == nullptr ? kOfxStatErrMissingHostFeature : opencl->compile(source, optional, result);
}

} // namespace framescaper::openfx
