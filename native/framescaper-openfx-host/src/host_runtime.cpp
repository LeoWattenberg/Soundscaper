/* SPDX-License-Identifier: AGPL-3.0-only */
#include "host_runtime.hpp"
#include "host_parameter_hydration.hpp"
#include "parameter_values.hpp"
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <map>
#include <mutex>
#include <new>
#include <set>
#include <stdexcept>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>
namespace framescaper::openfx {
namespace {
constexpr std::uint64_t kPropertyMagic = 0x46534f4658505250ULL;
constexpr std::uint64_t kEffectMagic = 0x46534f4658454646ULL;
constexpr std::uint64_t kParamSetMagic = 0x46534f4658505345ULL;
constexpr std::uint64_t kParamMagic = 0x46534f4658504152ULL;
constexpr std::uint64_t kClipMagic = 0x46534f4658434c49ULL;
constexpr std::uint64_t kInteractMagic = 0x46534f4658494e54ULL;
constexpr std::uint64_t kDrawMagic = 0x46534f4658445241ULL;
constexpr std::size_t kMaximumPropertyDimension = 4'096;
constexpr std::size_t kMaximumParameters = 4'096;
constexpr std::size_t kOffscreenDimension = 64;
struct HostState;
using PropertyValue = std::variant<void*, std::string, double, int>;
struct PropertySet {
	std::uint64_t magic = kPropertyMagic;
	HostState* owner = nullptr;
	std::map<std::string, std::vector<PropertyValue>> values;
};
struct Parameter {
	std::uint64_t magic = kParamMagic;
	PropertySet properties;
	std::string name;
	std::string type;
	ParameterValues values;
};
struct ParameterSet {
	std::uint64_t magic = kParamSetMagic;
	PropertySet properties;
	std::map<std::string, std::unique_ptr<Parameter>> parameters;
};
struct Image {
	PropertySet properties;
	RgbaFrame frame;
};
struct Clip {
	std::uint64_t magic = kClipMagic;
	PropertySet properties;
	Image image;
};
struct Effect {
	std::uint64_t magic = kEffectMagic;
	PropertySet properties;
	ParameterSet parameters;
	std::map<std::string, std::unique_ptr<Clip>> clips;
	std::atomic_bool cancelled{false};
	std::function<bool()> cancellation_probe;
	double time = 0;
};
struct DrawContext {
	std::uint64_t magic = kDrawMagic;
	std::array<unsigned char, kOffscreenDimension * kOffscreenDimension * 4> rgba{};
	OfxRGBAColourF colour{1, 1, 1, 1};
	float line_width = 1;
	std::size_t calls = 0;
	std::size_t pixels_touched = 0;
};
struct Interact {
	std::uint64_t magic = kInteractMagic;
	PropertySet properties;
	DrawContext* active_draw = nullptr;
	std::size_t swaps = 0;
	bool redraw_requested = false;
};
struct ImageMemory { std::vector<unsigned char> bytes; };
struct MutexRecord { std::recursive_mutex mutex; };
PropertySet* property_set(OfxPropertySetHandle handle) {
	auto* value = reinterpret_cast<PropertySet*>(handle);
	return value != nullptr && value->magic == kPropertyMagic ? value : nullptr;
}
Effect* effect(OfxImageEffectHandle handle) {
	auto* value = reinterpret_cast<Effect*>(handle);
	return value != nullptr && value->magic == kEffectMagic ? value : nullptr;
}
bool observe_cancellation(Effect* value) noexcept {
	if (value == nullptr || value->cancelled.load()) return true;
	try { if (value->cancellation_probe && value->cancellation_probe()) value->cancelled.store(true); }
	catch (...) { value->cancelled.store(true); }
	return value->cancelled.load();
}
ParameterSet* parameter_set(OfxParamSetHandle handle) {
	auto* value = reinterpret_cast<ParameterSet*>(handle);
	return value != nullptr && value->magic == kParamSetMagic ? value : nullptr;
}
Parameter* parameter(OfxParamHandle handle) {
	auto* value = reinterpret_cast<Parameter*>(handle);
	return value != nullptr && value->magic == kParamMagic ? value : nullptr;
}
Clip* clip(OfxImageClipHandle handle) {
	auto* value = reinterpret_cast<Clip*>(handle);
	return value != nullptr && value->magic == kClipMagic ? value : nullptr;
}
Interact* interact(OfxInteractHandle handle) {
	auto* value = reinterpret_cast<Interact*>(handle);
	return value != nullptr && value->magic == kInteractMagic ? value : nullptr;
}
DrawContext* draw_context(OfxDrawContextHandle handle) {
	auto* value = reinterpret_cast<DrawContext*>(handle);
	return value != nullptr && value->magic == kDrawMagic ? value : nullptr;
}
OfxPropertySetHandle handle(PropertySet& value) {
	return reinterpret_cast<OfxPropertySetHandle>(&value);
}
bool valid_property_name(const char* name) {
	return name != nullptr && *name != '\0' && std::strlen(name) <= 256;
}
template <typename Value>
OfxStatus set_property(OfxPropertySetHandle set_handle, const char* name, int index, Value value) {
	auto* set = property_set(set_handle);
	if (set == nullptr || !valid_property_name(name)) return kOfxStatErrBadHandle;
	if (index < 0 || static_cast<std::size_t>(index) >= kMaximumPropertyDimension) return kOfxStatErrBadIndex;
	auto& entries = set->values[name];
	if (entries.size() <= static_cast<std::size_t>(index)) entries.resize(static_cast<std::size_t>(index) + 1, Value{});
	entries[static_cast<std::size_t>(index)] = std::move(value);
	return kOfxStatOK;
}
template <typename Value>
OfxStatus get_property(OfxPropertySetHandle set_handle, const char* name, int index, Value* output) {
	auto* set = property_set(set_handle);
	if (set == nullptr || output == nullptr || !valid_property_name(name)) return kOfxStatErrBadHandle;
	const auto found = set->values.find(name);
	if (index < 0 || found == set->values.end()
		|| static_cast<std::size_t>(index) >= found->second.size()) return kOfxStatErrBadIndex;
	const auto* value = std::get_if<Value>(&found->second[static_cast<std::size_t>(index)]);
	if (value == nullptr) return kOfxStatErrValue;
	*output = *value;
	return kOfxStatOK;
}
OfxStatus prop_set_pointer(OfxPropertySetHandle h, const char* n, int i, void* v) { return set_property(h, n, i, v); }
OfxStatus prop_set_string(OfxPropertySetHandle h, const char* n, int i, const char* v) {
	return v == nullptr ? kOfxStatErrValue : set_property(h, n, i, std::string{v});
}
OfxStatus prop_set_double(OfxPropertySetHandle h, const char* n, int i, double v) { return set_property(h, n, i, v); }
OfxStatus prop_set_int(OfxPropertySetHandle h, const char* n, int i, int v) { return set_property(h, n, i, v); }
template <typename Value, typename Setter>
OfxStatus set_many(OfxPropertySetHandle h, const char* n, int count, const Value* values, Setter setter) {
	if (count < 0 || static_cast<std::size_t>(count) > kMaximumPropertyDimension || (count > 0 && values == nullptr)) return kOfxStatErrValue;
	for (int index = 0; index < count; ++index) if (const auto status = setter(h, n, index, values[index]); status != kOfxStatOK) return status;
	return kOfxStatOK;
}
OfxStatus prop_set_pointer_n(OfxPropertySetHandle h, const char* n, int c, void* const* v) { return set_many(h, n, c, v, prop_set_pointer); }
OfxStatus prop_set_string_n(OfxPropertySetHandle h, const char* n, int c, const char* const* v) { return set_many(h, n, c, v, prop_set_string); }
OfxStatus prop_set_double_n(OfxPropertySetHandle h, const char* n, int c, const double* v) { return set_many(h, n, c, v, prop_set_double); }
OfxStatus prop_set_int_n(OfxPropertySetHandle h, const char* n, int c, const int* v) { return set_many(h, n, c, v, prop_set_int); }
OfxStatus prop_get_pointer(OfxPropertySetHandle h, const char* n, int i, void** v) { return get_property(h, n, i, v); }
OfxStatus prop_get_string(OfxPropertySetHandle h, const char* n, int i, char** v) {
	if (v == nullptr) return kOfxStatErrBadHandle;
	std::string value;
	const auto status = get_property(h, n, i, &value);
	if (status != kOfxStatOK) return status;
	auto* set = property_set(h);
	*v = const_cast<char*>(std::get<std::string>(set->values[n][static_cast<std::size_t>(i)]).c_str());
	return kOfxStatOK;
}
OfxStatus prop_get_double(OfxPropertySetHandle h, const char* n, int i, double* v) { return get_property(h, n, i, v); }
OfxStatus prop_get_int(OfxPropertySetHandle h, const char* n, int i, int* v) { return get_property(h, n, i, v); }
template <typename Value, typename Getter>
OfxStatus get_many(OfxPropertySetHandle h, const char* n, int count, Value* values, Getter getter) {
	if (count < 0 || static_cast<std::size_t>(count) > kMaximumPropertyDimension || (count > 0 && values == nullptr)) return kOfxStatErrValue;
	for (int index = 0; index < count; ++index) if (const auto status = getter(h, n, index, &values[index]); status != kOfxStatOK) return status;
	return kOfxStatOK;
}
OfxStatus prop_get_pointer_n(OfxPropertySetHandle h, const char* n, int c, void** v) { return get_many(h, n, c, v, prop_get_pointer); }
OfxStatus prop_get_string_n(OfxPropertySetHandle h, const char* n, int c, char** v) { return get_many(h, n, c, v, prop_get_string); }
OfxStatus prop_get_double_n(OfxPropertySetHandle h, const char* n, int c, double* v) { return get_many(h, n, c, v, prop_get_double); }
OfxStatus prop_get_int_n(OfxPropertySetHandle h, const char* n, int c, int* v) { return get_many(h, n, c, v, prop_get_int); }
OfxStatus prop_reset(OfxPropertySetHandle h, const char* n) {
	auto* set = property_set(h);
	if (set == nullptr || !valid_property_name(n)) return kOfxStatErrBadHandle;
	return set->values.erase(n) == 0 ? kOfxStatErrUnknown : kOfxStatOK;
}
OfxStatus prop_dimension(OfxPropertySetHandle h, const char* n, int* count) {
	auto* set = property_set(h);
	if (set == nullptr || count == nullptr || !valid_property_name(n)) return kOfxStatErrBadHandle;
	const auto found = set->values.find(n);
	if (found == set->values.end()) return kOfxStatErrUnknown;
	*count = static_cast<int>(found->second.size());
	return kOfxStatOK;
}
bool valid_parameter_type(const char* type) {
	if (type == nullptr) return false;
	static constexpr std::array<const char*, 16> types{
		kOfxParamTypeInteger, kOfxParamTypeInteger2D, kOfxParamTypeInteger3D,
		kOfxParamTypeDouble, kOfxParamTypeDouble2D, kOfxParamTypeDouble3D,
		kOfxParamTypeRGB, kOfxParamTypeRGBA, kOfxParamTypeBoolean,
		kOfxParamTypeChoice, kOfxParamTypeString, kOfxParamTypeGroup,
		kOfxParamTypePage, kOfxParamTypePushButton, kOfxParamTypeParametric,
		kOfxParamTypeCustom,
	};
	return std::any_of(types.begin(), types.end(), [type](const char* value) { return std::strcmp(type, value) == 0; });
}
OfxStatus param_define(OfxParamSetHandle h, const char* type, const char* name, OfxPropertySetHandle* output) {
	auto* set = parameter_set(h);
	if (set == nullptr || !valid_parameter_type(type) || !valid_plugin_id(name == nullptr ? "" : name)) return kOfxStatErrValue;
	if (set->parameters.size() >= kMaximumParameters) return kOfxStatErrMemory;
	if (set->parameters.contains(name)) return kOfxStatErrExists;
	auto value = std::make_unique<Parameter>();
	value->properties.owner = set->properties.owner; value->name = name; value->type = type;
	if (!initialize_parameter_values(value->values, type)) return kOfxStatErrValue;
	prop_set_int(handle(value->properties), kOfxParamPropAnimates, 0, 1);
	if (output != nullptr) *output = handle(value->properties);
	set->parameters.emplace(name, std::move(value));
	return kOfxStatOK;
}
OfxStatus param_get_handle(OfxParamSetHandle h, const char* name, OfxParamHandle* out, OfxPropertySetHandle* props) {
	auto* set = parameter_set(h);
	if (set == nullptr || name == nullptr || out == nullptr) return kOfxStatErrBadHandle;
	const auto found = set->parameters.find(name);
	if (found == set->parameters.end()) return kOfxStatErrUnknown;
	*out = reinterpret_cast<OfxParamHandle>(found->second.get());
	if (props != nullptr) *props = handle(found->second->properties);
	return kOfxStatOK;
}
OfxStatus param_set_props(OfxParamSetHandle h, OfxPropertySetHandle* out) { auto* s = parameter_set(h); if (s == nullptr || out == nullptr) return kOfxStatErrBadHandle; *out = handle(s->properties); return kOfxStatOK; }
OfxStatus param_props(OfxParamHandle h, OfxPropertySetHandle* out) { auto* p = parameter(h); if (p == nullptr || out == nullptr) return kOfxStatErrBadHandle; *out = handle(p->properties); return kOfxStatOK; }
OfxStatus param_get_value(OfxParamHandle h, ...) { auto* p = parameter(h); if (p == nullptr) return kOfxStatErrBadHandle; std::va_list a; va_start(a, h); const auto s = parameter_get(p->values, a); va_end(a); return s; }
OfxStatus param_get_value_at(OfxParamHandle h, OfxTime t, ...) { auto* p = parameter(h); if (p == nullptr) return kOfxStatErrBadHandle; std::va_list a; va_start(a, t); const auto s = parameter_get_at(p->values, t, a); va_end(a); return s; }
OfxStatus param_derivative(OfxParamHandle h, OfxTime t, ...) { auto* p = parameter(h); if (p == nullptr) return kOfxStatErrBadHandle; std::va_list a; va_start(a, t); const auto s = parameter_derivative(p->values, t, a); va_end(a); return s; }
OfxStatus param_integral(OfxParamHandle h, OfxTime f, OfxTime l, ...) { auto* p = parameter(h); if (p == nullptr) return kOfxStatErrBadHandle; std::va_list a; va_start(a, l); const auto s = parameter_integral(p->values, f, l, a); va_end(a); return s; }
OfxStatus param_set_value(OfxParamHandle h, ...) { auto* p = parameter(h); if (p == nullptr) return kOfxStatErrBadHandle; std::va_list a; va_start(a, h); const auto s = parameter_set(p->values, a); va_end(a); return s; }
OfxStatus param_set_value_at(OfxParamHandle h, OfxTime t, ...) { auto* p = parameter(h); if (p == nullptr) return kOfxStatErrBadHandle; std::va_list a; va_start(a, t); const auto s = parameter_set_at(p->values, t, a); va_end(a); return s; }
OfxStatus param_num_keys(OfxParamHandle h, unsigned int* count) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : parameter_key_count(p->values, count); }
OfxStatus param_key_time(OfxParamHandle h, unsigned int i, OfxTime* t) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : parameter_key_time(p->values, i, t); }
OfxStatus param_key_index(OfxParamHandle h, OfxTime t, int d, int* i) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : parameter_key_index(p->values, t, d, i); }
OfxStatus param_delete_key(OfxParamHandle h, OfxTime t) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : parameter_delete_key(p->values, t); }
OfxStatus param_delete_all(OfxParamHandle h) { auto* p = parameter(h); if (p == nullptr) return kOfxStatErrBadHandle; parameter_delete_all_keys(p->values); return kOfxStatOK; }
OfxStatus param_copy(OfxParamHandle to, OfxParamHandle from, OfxTime offset, const OfxRangeD* range) { auto* destination = parameter(to); auto* source = parameter(from); return destination == nullptr || source == nullptr ? kOfxStatErrBadHandle : parameter_copy(destination->values, source->values, offset, range); }
OfxStatus param_edit_begin(OfxParamSetHandle h, const char*) { return parameter_set(h) == nullptr ? kOfxStatErrBadHandle : kOfxStatOK; }
OfxStatus param_edit_end(OfxParamSetHandle h) { return parameter_set(h) == nullptr ? kOfxStatErrBadHandle : kOfxStatOK; }
OfxStatus image_get_props(OfxImageEffectHandle h, OfxPropertySetHandle* out) { auto* e = effect(h); if (e == nullptr || out == nullptr) return kOfxStatErrBadHandle; *out = handle(e->properties); return kOfxStatOK; }
OfxStatus image_get_params(OfxImageEffectHandle h, OfxParamSetHandle* out) { auto* e = effect(h); if (e == nullptr || out == nullptr) return kOfxStatErrBadHandle; *out = reinterpret_cast<OfxParamSetHandle>(&e->parameters); return kOfxStatOK; }
OfxStatus clip_define(OfxImageEffectHandle h, const char* name, OfxPropertySetHandle* out) {
	auto* e = effect(h); if (e == nullptr || !valid_plugin_id(name == nullptr ? "" : name)) return kOfxStatErrBadHandle;
	if (e->clips.contains(name)) return kOfxStatErrExists;
	auto value = std::make_unique<Clip>(); value->properties.owner = e->properties.owner; value->image.properties.owner = e->properties.owner;
	prop_set_pointer(handle(value->image.properties), kOfxImagePropData, 0, value->image.frame.rgba.data());
	prop_set_int(handle(value->image.properties), kOfxImagePropRowBytes, 0, 4);
	const int bounds[]{0, 0, 1, 1}; prop_set_int_n(handle(value->image.properties), kOfxImagePropBounds, 4, bounds);
	prop_set_string(handle(value->image.properties), kOfxImageEffectPropComponents, 0, kOfxImageComponentRGBA);
	prop_set_string(handle(value->image.properties), kOfxImageEffectPropPixelDepth, 0, kOfxBitDepthByte);
	if (out != nullptr) *out = handle(value->properties);
	e->clips.emplace(name, std::move(value)); return kOfxStatOK;
}
OfxStatus clip_get(OfxImageEffectHandle h, const char* name, OfxImageClipHandle* out, OfxPropertySetHandle* props) {
	auto* e = effect(h); if (e == nullptr || name == nullptr || out == nullptr) return kOfxStatErrBadHandle;
	const auto found = e->clips.find(name); if (found == e->clips.end()) return kOfxStatErrUnknown;
	*out = reinterpret_cast<OfxImageClipHandle>(found->second.get()); if (props != nullptr) *props = handle(found->second->properties); return kOfxStatOK;
}
OfxStatus clip_props(OfxImageClipHandle h, OfxPropertySetHandle* out) { auto* c = clip(h); if (c == nullptr || out == nullptr) return kOfxStatErrBadHandle; *out = handle(c->properties); return kOfxStatOK; }
OfxStatus clip_image(OfxImageClipHandle h, OfxTime, const OfxRectD*, OfxPropertySetHandle* out) { auto* c = clip(h); if (c == nullptr || out == nullptr) return kOfxStatErrBadHandle; *out = handle(c->image.properties); return kOfxStatOK; }
OfxStatus release_image(OfxPropertySetHandle h) { return property_set(h) == nullptr ? kOfxStatErrBadHandle : kOfxStatOK; }
OfxStatus clip_rod(OfxImageClipHandle h, OfxTime, OfxRectD* bounds) { auto* value = clip(h); if (value == nullptr || bounds == nullptr) return kOfxStatErrBadHandle; *bounds = {0, 0, static_cast<double>(value->image.frame.layout.width), static_cast<double>(value->image.frame.layout.height)}; return kOfxStatOK; }
int image_abort(OfxImageEffectHandle h) { return observe_cancellation(effect(h)) ? 1 : 0; }
std::mutex allocation_mutex;
std::unordered_set<void*> allocations;
std::unordered_set<ImageMemory*> image_allocations;
OfxStatus memory_alloc(void*, std::size_t size, void** out) { if (out == nullptr || size > (1ULL << 30)) return kOfxStatErrMemory; void* data = std::malloc(std::max<std::size_t>(size, 1)); if (data == nullptr) return kOfxStatErrMemory; { std::lock_guard lock{allocation_mutex}; allocations.insert(data); } *out = data; return kOfxStatOK; }
OfxStatus memory_free(void* data) { std::lock_guard lock{allocation_mutex}; if (!allocations.erase(data)) return kOfxStatErrBadHandle; std::free(data); return kOfxStatOK; }
OfxStatus image_memory_alloc(OfxImageEffectHandle h, std::size_t size, OfxImageMemoryHandle* out) { if (effect(h) == nullptr || out == nullptr || size > (1ULL << 30)) return kOfxStatErrMemory; auto* memory = new (std::nothrow) ImageMemory; if (memory == nullptr) return kOfxStatErrMemory; try { memory->bytes.resize(size); } catch (...) { delete memory; return kOfxStatErrMemory; } { std::lock_guard lock{allocation_mutex}; image_allocations.insert(memory); } *out = reinterpret_cast<OfxImageMemoryHandle>(memory); return kOfxStatOK; }
OfxStatus image_memory_free(OfxImageMemoryHandle h) { auto* memory = reinterpret_cast<ImageMemory*>(h); { std::lock_guard lock{allocation_mutex}; if (!image_allocations.erase(memory)) return kOfxStatErrBadHandle; } delete memory; return kOfxStatOK; }
OfxStatus image_memory_lock(OfxImageMemoryHandle h, void** out) { auto* memory = reinterpret_cast<ImageMemory*>(h); std::lock_guard lock{allocation_mutex}; if (!image_allocations.contains(memory) || out == nullptr) return kOfxStatErrBadHandle; *out = memory->bytes.data(); return kOfxStatOK; }
OfxStatus image_memory_unlock(OfxImageMemoryHandle h) { std::lock_guard lock{allocation_mutex}; return image_allocations.contains(reinterpret_cast<ImageMemory*>(h)) ? kOfxStatOK : kOfxStatErrBadHandle; }
thread_local unsigned int thread_index = 0;
thread_local bool spawned_thread = false;
std::atomic_bool threading{false};
OfxStatus multi_thread(OfxThreadFunctionV1* function, unsigned int requested, void* argument) {
	if (function == nullptr || requested == 0 || requested > 64 || threading.exchange(true)) return kOfxStatFailed;
	const auto count = std::min(requested, std::max(1U, std::thread::hardware_concurrency()));
	std::vector<std::thread> threads; threads.reserve(count);
	try { for (unsigned int index = 0; index < count; ++index) threads.emplace_back([=] { thread_index = index; spawned_thread = true; function(index, count, argument); spawned_thread = false; }); }
	catch (...) { for (auto& thread : threads) if (thread.joinable()) thread.join(); threading = false; return kOfxStatFailed; }
	for (auto& thread : threads) thread.join();
	threading = false;
	return kOfxStatOK;
}
OfxStatus thread_cpus(unsigned int* out) { if (out == nullptr) return kOfxStatErrBadHandle; *out = std::max(1U, std::thread::hardware_concurrency()); return kOfxStatOK; }
OfxStatus thread_index_value(unsigned int* out) { if (out == nullptr) return kOfxStatErrBadHandle; *out = thread_index; return kOfxStatOK; }
int is_spawned_thread() { return spawned_thread ? 1 : 0; }
OfxStatus mutex_create(OfxMutexHandle* out, int count) { if (out == nullptr || count < 0 || count > 1'024) return kOfxStatErrValue; auto* value = new (std::nothrow) MutexRecord; if (value == nullptr) return kOfxStatErrMemory; for (int index = 0; index < count; ++index) value->mutex.lock(); *out = reinterpret_cast<OfxMutexHandle>(value); return kOfxStatOK; }
OfxStatus mutex_destroy(OfxMutexHandle h) { if (h == nullptr) return kOfxStatErrBadHandle; delete reinterpret_cast<MutexRecord*>(h); return kOfxStatOK; }
OfxStatus mutex_lock(OfxMutexHandle h) { if (h == nullptr) return kOfxStatErrBadHandle; reinterpret_cast<MutexRecord*>(h)->mutex.lock(); return kOfxStatOK; }
OfxStatus mutex_unlock(OfxMutexHandle h) { if (h == nullptr) return kOfxStatErrBadHandle; reinterpret_cast<MutexRecord*>(h)->mutex.unlock(); return kOfxStatOK; }
OfxStatus mutex_try_lock(OfxMutexHandle h) { if (h == nullptr) return kOfxStatErrBadHandle; return reinterpret_cast<MutexRecord*>(h)->mutex.try_lock() ? kOfxStatOK : kOfxStatFailed; }
OfxStatus message(void*, const char*, const char*, const char*, ...) { return kOfxStatOK; }
OfxStatus persistent_message(void*, const char*, const char*, const char*, ...) { return kOfxStatOK; }
OfxStatus clear_message(void*) { return kOfxStatOK; }
OfxStatus progress_start_v1(void* h, const char*) { return h == nullptr ? kOfxStatErrBadHandle : kOfxStatOK; }
OfxStatus progress_start_v2(void* h, const char*, const char*) { return h == nullptr ? kOfxStatErrBadHandle : kOfxStatOK; }
OfxStatus progress_update(void* h, double value) { auto* e = effect(reinterpret_cast<OfxImageEffectHandle>(h)); if (e == nullptr || value < 0 || value > 1) return kOfxStatErrValue; return observe_cancellation(e) ? kOfxStatReplyDefault : kOfxStatOK; }
OfxStatus progress_end(void* h) { return effect(reinterpret_cast<OfxImageEffectHandle>(h)) == nullptr ? kOfxStatErrBadHandle : kOfxStatOK; }
OfxStatus timeline_get(void* h, double* out) { auto* e = effect(reinterpret_cast<OfxImageEffectHandle>(h)); if (e == nullptr || out == nullptr) return kOfxStatErrBadHandle; *out = e->time; return kOfxStatOK; }
OfxStatus timeline_goto(void*, double) { return kOfxStatErrUnsupported; }
OfxStatus timeline_bounds(void* h, double* first, double* last) { if (effect(reinterpret_cast<OfxImageEffectHandle>(h)) == nullptr || first == nullptr || last == nullptr) return kOfxStatErrBadHandle; *first = 0; *last = 0; return kOfxStatOK; }
OfxStatus interact_swap(OfxInteractHandle h) { auto* i = interact(h); if (i == nullptr || i->active_draw == nullptr) return kOfxStatErrBadHandle; ++i->swaps; return kOfxStatOK; }
OfxStatus interact_redraw(OfxInteractHandle h) { auto* i = interact(h); if (i == nullptr) return kOfxStatErrBadHandle; i->redraw_requested = true; return kOfxStatOK; }
OfxStatus interact_props(OfxInteractHandle h, OfxPropertySetHandle* out) { auto* i = interact(h); if (i == nullptr || out == nullptr) return kOfxStatErrBadHandle; *out = handle(i->properties); return kOfxStatOK; }
OfxStatus draw_colour(OfxDrawContextHandle h, OfxStandardColour, OfxRGBAColourF* out) { if (draw_context(h) == nullptr || out == nullptr) return kOfxStatErrBadHandle; *out = {0, 0, 0, 1}; return kOfxStatOK; }
OfxStatus draw_set_colour(OfxDrawContextHandle h, const OfxRGBAColourF* colour) { auto* d = draw_context(h); if (d == nullptr || colour == nullptr || !std::isfinite(colour->r) || !std::isfinite(colour->g) || !std::isfinite(colour->b) || !std::isfinite(colour->a) || colour->r < 0 || colour->r > 1 || colour->g < 0 || colour->g > 1 || colour->b < 0 || colour->b > 1 || colour->a < 0 || colour->a > 1) return kOfxStatErrValue; d->colour = *colour; return kOfxStatOK; }
OfxStatus draw_width(OfxDrawContextHandle h, float width) { auto* d = draw_context(h); if (d == nullptr || !std::isfinite(width) || width <= 0 || width > 64) return kOfxStatErrValue; d->line_width = width; return kOfxStatOK; }
OfxStatus draw_stipple(OfxDrawContextHandle h, OfxDrawLineStipplePattern) { return draw_context(h) == nullptr ? kOfxStatErrBadHandle : kOfxStatOK; }
void draw_pixel(DrawContext& draw, const OfxPointD point) {
	if (!std::isfinite(point.x) || !std::isfinite(point.y)) return;
	const auto x = static_cast<long>(std::lround(point.x)); const auto y = static_cast<long>(std::lround(point.y));
	if (x < 0 || y < 0 || x >= static_cast<long>(kOffscreenDimension) || y >= static_cast<long>(kOffscreenDimension)) return;
	const auto offset = (static_cast<std::size_t>(y) * kOffscreenDimension + static_cast<std::size_t>(x)) * 4;
	const std::array<float, 4> colour{draw.colour.r, draw.colour.g, draw.colour.b, draw.colour.a};
	for (std::size_t channel = 0; channel < colour.size(); ++channel) draw.rgba[offset + channel] = static_cast<unsigned char>(std::lround(std::clamp(colour[channel], 0.0F, 1.0F) * 255.0F));
	++draw.pixels_touched;
}
OfxStatus draw_primitive(OfxDrawContextHandle h, OfxDrawPrimitive, const OfxPointD* points, int count) { auto* d = draw_context(h); if (d == nullptr || points == nullptr || count <= 0 || count > 65'536 || d->calls >= 4'096) return kOfxStatErrValue; for (int index = 0; index < count; ++index) draw_pixel(*d, points[index]); ++d->calls; return kOfxStatOK; }
OfxStatus draw_text(OfxDrawContextHandle h, const char* text, const OfxPointD* point, int) { auto* d = draw_context(h); if (d == nullptr || text == nullptr || point == nullptr || *text == '\0' || std::strlen(text) > 4'096 || d->calls >= 4'096) return kOfxStatErrValue; const auto count = std::min<std::size_t>(std::strlen(text), kOffscreenDimension); for (std::size_t index = 0; index < count; ++index) draw_pixel(*d, {point->x + static_cast<double>(index), point->y}); ++d->calls; return kOfxStatOK; }
OfxStatus deny_vendor_dialog(void*) { return kOfxStatErrUnsupported; }
OfxStatus redraw_pending() { return kOfxStatOK; }
OfxStatus parametric_value(OfxParamHandle h, int c, OfxTime t, double x, double* out) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : parametric_get_value(p->values, c, t, x, out); }
OfxStatus parametric_count(OfxParamHandle h, int c, double t, int* out) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : parametric_point_count(p->values, c, t, out); }
OfxStatus parametric_get_point(OfxParamHandle h, int c, double t, int i, double* x, double* out) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : framescaper::openfx::parametric_get_point(p->values, c, t, i, x, out); }
OfxStatus parametric_set_point(OfxParamHandle h, int c, double t, int i, double x, double v, bool a) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : framescaper::openfx::parametric_set_point(p->values, c, t, i, x, v, a); }
OfxStatus parametric_add_point(OfxParamHandle h, int c, double t, double x, double v, bool a) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : framescaper::openfx::parametric_add_point(p->values, c, t, x, v, a); }
OfxStatus parametric_delete_point(OfxParamHandle h, int c, int i) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : framescaper::openfx::parametric_delete_point(p->values, c, i); }
OfxStatus parametric_delete_all(OfxParamHandle h, int c) { auto* p = parameter(h); return p == nullptr ? kOfxStatErrBadHandle : parametric_delete_all_points(p->values, c); }
struct HostState {
	PropertySet host_properties;
	Effect effect_record;
	std::set<std::string> requested_suites;
	OfxPropertySuiteV1 property_suite{prop_set_pointer, prop_set_string, prop_set_double, prop_set_int, prop_set_pointer_n, prop_set_string_n, prop_set_double_n, prop_set_int_n, prop_get_pointer, prop_get_string, prop_get_double, prop_get_int, prop_get_pointer_n, prop_get_string_n, prop_get_double_n, prop_get_int_n, prop_reset, prop_dimension};
	OfxImageEffectSuiteV1 image_suite{image_get_props, image_get_params, clip_define, clip_get, clip_props, clip_image, release_image, clip_rod, image_abort, image_memory_alloc, image_memory_free, image_memory_lock, image_memory_unlock};
	OfxParameterSuiteV1 parameter_suite{param_define, param_get_handle, param_set_props, param_props, param_get_value, param_get_value_at, param_derivative, param_integral, param_set_value, param_set_value_at, param_num_keys, param_key_time, param_key_index, param_delete_key, param_delete_all, param_copy, param_edit_begin, param_edit_end};
	OfxMemorySuiteV1 memory_suite{memory_alloc, memory_free};
	OfxMultiThreadSuiteV1 thread_suite{multi_thread, thread_cpus, thread_index_value, is_spawned_thread, mutex_create, mutex_destroy, mutex_lock, mutex_unlock, mutex_try_lock};
	OfxMessageSuiteV1 message_suite_v1{message};
	OfxMessageSuiteV2 message_suite_v2{message, persistent_message, clear_message};
	OfxProgressSuiteV1 progress_suite_v1{progress_start_v1, progress_update, progress_end};
	OfxProgressSuiteV2 progress_suite_v2{progress_start_v2, progress_update, progress_end};
	OfxTimeLineSuiteV1 timeline_suite{timeline_get, timeline_goto, timeline_bounds};
	OfxInteractSuiteV1 interact_suite{interact_swap, interact_redraw, interact_props};
	OfxDrawSuiteV1 draw_suite{draw_colour, draw_set_colour, draw_width, draw_stipple, draw_primitive, draw_text};
	OfxDialogSuiteV1 dialog_suite{deny_vendor_dialog, redraw_pending};
	OfxParametricParameterSuiteV1 parametric_suite{parametric_value, parametric_count, parametric_get_point, parametric_set_point, parametric_add_point, parametric_delete_point, parametric_delete_all};
	OfxHost host_record{};
	HostState() {
		host_properties.owner = this; effect_record.properties.owner = this;
		effect_record.parameters.properties.owner = this;
		host_record = {handle(host_properties), fetch_suite};
	}
	static const void* fetch_suite(OfxPropertySetHandle host, const char* name, int version) {
		auto* properties = property_set(host); if (properties == nullptr || properties->owner == nullptr || name == nullptr) return nullptr;
		auto& state = *properties->owner;
		const auto expose = [&state, name](const void* suite) { state.requested_suites.insert(name); return suite; };
		if (std::strcmp(name, kOfxPropertySuite) == 0 && version == 1) return expose(&state.property_suite);
		if (std::strcmp(name, kOfxImageEffectSuite) == 0 && version == 1) return expose(&state.image_suite);
		if (std::strcmp(name, kOfxParameterSuite) == 0 && version == 1) return expose(&state.parameter_suite);
		if (std::strcmp(name, kOfxMemorySuite) == 0 && version == 1) return expose(&state.memory_suite);
		if (std::strcmp(name, kOfxMultiThreadSuite) == 0 && version == 1) return expose(&state.thread_suite);
		if (std::strcmp(name, kOfxMessageSuite) == 0 && version == 1) return expose(&state.message_suite_v1);
		if (std::strcmp(name, kOfxMessageSuite) == 0 && version == 2) return expose(&state.message_suite_v2);
		if (std::strcmp(name, kOfxProgressSuite) == 0 && version == 1) return expose(&state.progress_suite_v1);
		if (std::strcmp(name, kOfxProgressSuite) == 0 && version == 2) return expose(&state.progress_suite_v2);
		if (std::strcmp(name, kOfxTimeLineSuite) == 0 && version == 1) return expose(&state.timeline_suite);
		if (std::strcmp(name, kOfxInteractSuite) == 0 && version == 1) return expose(&state.interact_suite);
		if (std::strcmp(name, kOfxDrawSuite) == 0 && version == 1) return expose(&state.draw_suite);
		if (std::strcmp(name, kOfxDialogSuite) == 0 && version == 1) return expose(&state.dialog_suite);
		if (std::strcmp(name, kOfxParametricParameterSuite) == 0 && version == 1) return expose(&state.parametric_suite);
		return nullptr;
	}
	void reset(bool cancelled, std::function<bool()> cancellation_probe = {}) {
		requested_suites.clear(); effect_record.cancelled = cancelled; effect_record.cancellation_probe = std::move(cancellation_probe); effect_record.time = 0;
		effect_record.properties.values.clear(); effect_record.parameters.properties.values.clear();
		effect_record.parameters.parameters.clear(); effect_record.clips.clear();
	}
	bool suites_ready() const { return property_suite.propSetString != nullptr && image_suite.abort != nullptr && parameter_suite.paramDefine != nullptr; }
	bool descriptor_valid(std::optional<Context> required_context = std::nullopt) const {
		const auto threading_value = effect_record.properties.values.find(kOfxImageEffectPluginRenderThreadSafety);
		if (threading_value == effect_record.properties.values.end() || threading_value->second.size() != 1) return false;
		const auto* threading_name = std::get_if<std::string>(&threading_value->second.front());
		if (threading_name == nullptr || (*threading_name != kOfxImageEffectRenderUnsafe
			&& *threading_name != kOfxImageEffectRenderInstanceSafe
			&& *threading_name != kOfxImageEffectRenderFullySafe)) return false;
		const auto contexts = effect_record.properties.values.find(kOfxImageEffectPropSupportedContexts);
		if (contexts == effect_record.properties.values.end() || contexts->second.empty()
			|| contexts->second.size() > kContexts.size()) return false;
		bool contains_required = !required_context.has_value();
		std::set<std::string> unique;
		for (const auto& value : contexts->second) {
			const auto* name = std::get_if<std::string>(&value);
			if (name == nullptr || !unique.insert(*name).second) return false;
			const bool known = std::any_of(kContexts.begin(), kContexts.end(), [name](std::string_view context) {
				const auto parsed = parse_context(context);
				return parsed.has_value() && *name == official_context(*parsed);
			});
			if (!known) return false;
			if (required_context.has_value() && *name == official_context(*required_context)) contains_required = true;
		}
		return contains_required;
	}
	bool rgba_byte_ready() const;
	std::optional<PluginInspection> inspection() const;
};

bool accepted_status(OfxStatus status);
OfxStatus call(
	OfxPlugin& plugin,
	const char* action,
	const void* target,
	PropertySet* input = nullptr,
	PropertySet* output = nullptr
);
#include "host_scan_inspection.inc"

bool accepted_status(OfxStatus status) { return status == kOfxStatOK || status == kOfxStatReplyDefault; }
OfxStatus call(OfxPlugin& plugin, const char* action, const void* target, PropertySet* input, PropertySet* output) {
	try { return plugin.mainEntry(action, target, input == nullptr ? nullptr : handle(*input), output == nullptr ? nullptr : handle(*output)); }
	catch (...) { return kOfxStatErrFatal; }
}
bool render_overlay_interact_v2(HostState& state, InvocationResult& result) {
	const auto found = state.effect_record.properties.values.find(kOfxImageEffectPluginPropOverlayInteractV2);
	if (found == state.effect_record.properties.values.end()) return true;
	if (found->second.size() != 1) return false;
	const auto* pointer = std::get_if<void*>(&found->second.front());
	if (pointer == nullptr || *pointer == nullptr) return false;
	auto* entry = reinterpret_cast<OfxPluginEntryPoint*>(*pointer);
	Interact interact_record; interact_record.properties.owner = &state;
	prop_set_pointer(handle(interact_record.properties), kOfxPropEffectInstance, 0, &state.effect_record);
	DrawContext draw; PropertySet draw_args; draw_args.owner = &state;
	prop_set_pointer(handle(draw_args), kOfxInteractPropDrawContext, 0, &draw);
	const auto invoke = [&](const char* action, PropertySet* input = nullptr) {
		try { return entry(action, &interact_record, input == nullptr ? nullptr : handle(*input), nullptr); }
		catch (...) { return kOfxStatErrFatal; }
	};
	const bool described = accepted_status(invoke(kOfxActionDescribe));
	const bool created = described && accepted_status(invoke(kOfxActionCreateInstance));
	interact_record.active_draw = &draw;
	const bool rendered = created && accepted_status(invoke(kOfxInteractActionDraw, &draw_args));
	interact_record.active_draw = nullptr;
	const bool destroyed = !created || accepted_status(invoke(kOfxActionDestroyInstance));
	result.offscreen_ui_rendered = rendered && destroyed && draw.calls > 0
		&& draw.pixels_touched > 0 && interact_record.swaps > 0;
	result.overlay_interact_version = 2;
	result.offscreen_draw_calls = draw.calls;
	result.offscreen_pixels_touched = draw.pixels_touched;
	return result.offscreen_ui_rendered;
}
const char* official_action(std::string_view action) {
	if (action == "load") return kOfxActionLoad;
	if (action == "unload") return kOfxActionUnload;
	if (action == "describe") return kOfxActionDescribe;
	if (action == "describe-in-context") return kOfxImageEffectActionDescribeInContext;
	if (action == "create-instance") return kOfxActionCreateInstance;
	if (action == "destroy-instance") return kOfxActionDestroyInstance;
	if (action == "begin-instance-changed") return kOfxActionBeginInstanceChanged;
	if (action == "instance-changed") return kOfxActionInstanceChanged;
	if (action == "end-instance-changed") return kOfxActionEndInstanceChanged;
	if (action == "get-region-of-definition") return kOfxImageEffectActionGetRegionOfDefinition;
	if (action == "get-regions-of-interest") return kOfxImageEffectActionGetRegionsOfInterest;
	if (action == "frames-needed") return kOfxImageEffectActionGetFramesNeeded;
	if (action == "get-time-domain") return kOfxImageEffectActionGetTimeDomain;
	if (action == "is-identity") return kOfxImageEffectActionIsIdentity;
	if (action == "begin-sequence-render") return kOfxImageEffectActionBeginSequenceRender;
	if (action == "render") return kOfxImageEffectActionRender;
	if (action == "end-sequence-render") return kOfxImageEffectActionEndSequenceRender;
	if (action == "sync-private-data") return kOfxActionSyncPrivateData;
	if (action == "purge-caches") return kOfxActionPurgeCaches;
	return nullptr;
}
} // namespace
class HostRuntime::Impl { public: HostState state; };
HostRuntime::HostRuntime() : impl_(std::make_unique<Impl>()) {}
HostRuntime::~HostRuntime() = default;
OfxHost* HostRuntime::host() { return &impl_->state.host_record; }
std::optional<PluginInspection> HostRuntime::inspect(OfxPlugin& plugin) {
	return inspect_plugin_contexts(impl_->state, host(), plugin);
}
InvocationResult HostRuntime::invoke(OfxPlugin& plugin, Context context, std::string_view action,
	Backend backend, bool cancelled,
	std::vector<InvocationFrame> inputs,
	const std::vector<HydratedParameterState>& parameters,
	std::function<bool()> cancellation_probe,
	RgbaFrameLayout output_layout,
	bool exact_frames,
	OfxTime render_time) {
	if (!member_of(action, kActions)) throw std::invalid_argument("The OpenFX action is outside the closed host contract.");
	if (!std::isfinite(render_time) || render_time < 0) throw std::invalid_argument("The OpenFX render time is outside its exact frame domain.");
	if (exact_frames && backend != Backend::cpu) throw std::runtime_error("The exact V12 host has no authenticated GPU backend.");
	InvocationResult result; result.requested_backend = kRenderBackends[static_cast<std::size_t>(backend)];
	result.backend = "cpu"; result.retried_on_cpu = backend != Backend::cpu; result.reports_degradation = result.retried_on_cpu;
	result.suites_dispatched = impl_->state.suites_ready();
	if (cancelled || action == "abort") { result.cancellation_observed = true; return result; }
	impl_->state.reset(false, std::move(cancellation_probe)); impl_->state.effect_record.time = render_time; plugin.setHost(host());
	auto& state = impl_->state; auto* target = &state.effect_record;
	PropertySet context_args; context_args.owner = &state; prop_set_string(handle(context_args), kOfxImageEffectPropContext, 0, official_context(context));
	const bool loaded = accepted_status(call(plugin, kOfxActionLoad, nullptr));
	const bool described = loaded && accepted_status(call(plugin, kOfxActionDescribe, target));
	const bool in_context = described && state.descriptor_valid(context)
		&& accepted_status(call(plugin, kOfxImageEffectActionDescribeInContext, target, &context_args));
	bool frames_bound = in_context;
	if (frames_bound) {
		std::set<std::string> names;
		const auto output = state.effect_record.clips.find("Output");
		if (!valid_rgba_frame_layout(output_layout) || output == state.effect_record.clips.end()) {
			frames_bound = false;
		} else {
			try { output->second->image.frame = {output_layout, std::vector<unsigned char>(output_layout.byte_length)}; }
			catch (...) { frames_bound = false; }
		}
		for (auto& input : inputs) {
			const auto found = state.effect_record.clips.find(input.name);
			if (input.name == "Output" || !names.insert(input.name).second
				|| found == state.effect_record.clips.end()
				|| !valid_rgba_frame_layout(input.frame.layout)
				|| input.frame.rgba.size() != input.frame.layout.byte_length) {
				frames_bound = false;
				break;
			}
			found->second->image.frame = std::move(input.frame);
		}
		if (exact_frames && state.effect_record.clips.size() != inputs.size() + 1U) frames_bound = false;
		for (auto& clip_entry : state.effect_record.clips) {
			auto& image = clip_entry.second->image;
			prop_set_pointer(handle(image.properties), kOfxImagePropData, 0, image.frame.rgba.data());
			prop_set_int(handle(image.properties), kOfxImagePropRowBytes, 0, static_cast<int>(image.frame.layout.row_bytes));
			const int bounds[]{0, 0, static_cast<int>(image.frame.layout.width), static_cast<int>(image.frame.layout.height)};
			prop_set_int_n(handle(image.properties), kOfxImagePropBounds, 4, bounds);
		}
	}
	PropertySet render_args; render_args.owner = &state; prop_set_double(handle(render_args), kOfxPropTime, 0, render_time); const double scale[]{1, 1}; prop_set_double_n(handle(render_args), kOfxImageEffectPropRenderScale, 2, scale); const int window[]{0, 0, static_cast<int>(output_layout.width), static_cast<int>(output_layout.height)}; prop_set_int_n(handle(render_args), kOfxImageEffectPropRenderWindow, 4, window);
	const bool parameters_bound = frames_bound && hydrate_parameter_state(
		state.effect_record.parameters, parameters,
		result.hydrated_parameter_count, result.hydrated_keyframe_count
	);
	const bool created = parameters_bound && !observe_cancellation(target)
		&& accepted_status(call(plugin, kOfxActionCreateInstance, target));
	if (created) static_cast<void>(render_overlay_interact_v2(state, result));
	bool invoked = false;
	if (created) {
		if (const auto* mapped = official_action(action); mapped != nullptr) {
			invoked = accepted_status(call(plugin, mapped, target, action == "render" ? &render_args : &context_args));
			if (invoked && action == "render"
				&& state.effect_record.clips.find("Output") == state.effect_record.clips.end()) invoked = false;
		}
		else if (action == "get-frame-varying") invoked = true;
	}
	const bool cancellation_observed = observe_cancellation(target);
	if (created) call(plugin, kOfxActionDestroyInstance, target);
	if (loaded) call(plugin, kOfxActionUnload, nullptr);
	if (cancellation_observed) { result.cancellation_observed = true; return result; }
	if (!created || !invoked) throw std::runtime_error("The OpenFX plug-in failed the admitted action lifecycle.");
	if (action == "render") result.output_frame = std::move(state.effect_record.clips.at("Output")->image.frame);
	result.cpu_rendered = action == "render"; return result;
}
bool valid_plugin_entry(const OfxPlugin& plugin) {
	return plugin.pluginApi != nullptr && std::strcmp(plugin.pluginApi, kOfxImageEffectPluginApi) == 0
		&& plugin.apiVersion == kOfxImageEffectPluginApiVersion
		&& valid_plugin_id(plugin.pluginIdentifier == nullptr ? "" : plugin.pluginIdentifier)
		&& plugin.setHost != nullptr && plugin.mainEntry != nullptr;
}
const char* official_context(Context context) {
	switch (context) {
		case Context::generator: return kOfxImageEffectContextGenerator; case Context::filter: return kOfxImageEffectContextFilter;
		case Context::transition: return kOfxImageEffectContextTransition; case Context::paint: return kOfxImageEffectContextPaint;
		case Context::retimer: return kOfxImageEffectContextRetimer; case Context::general: return kOfxImageEffectContextGeneral;
	}
	throw std::invalid_argument("The OpenFX context is unsupported.");
}
} // namespace framescaper::openfx
