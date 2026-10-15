/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

// Run the maintained driver with fake X11/GTK and a deterministic clock, never a display.
const program = `import contextlib,ctypes,io,json,os,runpy,sys,time,types
from pathlib import Path
driver,mode=sys.argv[1:];sys.path.insert(0,str(Path(driver).parent));sys.argv=[driver,'--sustained','/tmp/motionscaper-sustained-offline/300/output.mov']
os.environ['DISPLAY']=chr(0x1f600)*1000 if mode=='large-record' else ':987';state={'now':0.,'events':[],'sleeps':[],'confirmed':False,'published':False,'focus':0,'connections':0,'closed':[]};retained=[];callbacks=[]
class Call:
 def __init__(self,fn):self.fn=fn
 def __call__(self,*args):return self.fn(*args)
def opened(_name):
 state['connections']+=1
 return 0 if mode=='observer-open-error' and state['connections']>1 else state['connections']
def visible():
 if mode=='missing':return []
 if mode in ['many','wide','large-record']:return list(range(100,700))
 if state['confirmed'] and mode in ['closed','observer-error','observer-open-error','observer-close-error','writer-error','observer-clock-error','observer-xerror','observer-badwindow','original-xerror','original-badwindow','writer-primary-error','pid-absent','pid-invalid','pid-type','pid-trailing','pid-zero','pid-null']:return []
 if state['confirmed'] and mode=='other-title':return [200]
 return [100]
def name(_display,window,out):
 if window not in visible():return 0
 b=ctypes.create_string_buffer(b'other'if mode=='wide'and window!=100 else b'Export ProRes 4444');retained.append(b);out._obj.value=ctypes.addressof(b);return 1
def tree(_display,current,root,parent,children,count):
 values=visible() if current==1 else [];root._obj.value=1;parent._obj.value=1;count._obj.value=len(values)
 a=(ctypes.c_ulong*len(values))(*values);retained.append(a);ctypes.cast(children,ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)))[0]=ctypes.cast(a,ctypes.POINTER(ctypes.c_ulong));return 1
def attributes(_display,window,out):
 if window not in visible():return 0
 out._obj.x=4;out._obj.y=5;out._obj.width=1124;out._obj.height=822;out._obj.map_state=2;return 1
def focus(display,out,revert):
 if display==2 and mode in ['observer-error','observer-error-refusal']:raise OSError('passive focus read failed')
 if display==2 and mode in ['observer-xerror','observer-badwindow']:
  for _ in range(50):xerror(2,3 if mode=='observer-badwindow' else 2)
 out._obj.value=state['focus'];revert._obj.value=1;return 1
def set_focus(_display,window,_revert,_time):state['focus']=900 if mode=='foreign-focus' else window;state['events'].append(['focus',window]);return 1
def xerror(display,code=2):
 callback=callbacks[0];event=callback._argtypes_[1]._type_();event.display=display;event.error_code=code;callback(display,ctypes.pointer(event))
def key(_display,symbol,pressed,_delay):
 state['events'].append(['key',symbol,bool(pressed)])
 if symbol==0xFFE9:state['alt']=bool(pressed)
 if symbol==ord('s') and not pressed and state.get('alt'):
  state['confirmed']=True;state['published']=mode=='other-title'
  if mode in ['original-xerror','writer-primary-error']:xerror(1)
  if mode=='original-badwindow':xerror(1,3)
 return 1
def prop(_display,_window,_atom,_offset,_length,_delete,_requested,actual,form,items,after,data):
 if mode=='pid-absent':actual._obj.value=0;form._obj.value=0;items._obj.value=0;after._obj.value=0;data._obj.value=None;return 0
 value=ctypes.c_ulong(0 if mode=='pid-zero' else 10);retained.append(value);actual._obj.value=31 if mode=='pid-type' else 6;form._obj.value=8 if mode=='pid-invalid' else 32;items._obj.value=1;after._obj.value=1 if mode=='pid-trailing' else 0;data._obj.value=None if mode=='pid-null' else ctypes.addressof(value);return 0
def close(display):
 state['closed'].append(display)
 if display==2 and mode=='observer-close-error':raise OSError('passive close failed')
functions={'XOpenDisplay':opened,'XDefaultRootWindow':lambda _d:1,'XFetchName':name,'XQueryTree':tree,'XFree':lambda _p:0,'XGetWindowAttributes':attributes,'XRaiseWindow':lambda _d,w:state['events'].append(['raise',w]),'XSetInputFocus':set_focus,'XGetInputFocus':focus,'XKeysymToKeycode':lambda _d,s:s,'XFlush':lambda _d:0,'XSync':lambda _d,_discard:0,'XCloseDisplay':close,'XSetErrorHandler':lambda callback:callbacks.append(callback),'XInternAtom':lambda _d,_n,_existing:1,'XGetWindowProperty':prop}
x11=types.SimpleNamespace(**{k:Call(v)for k,v in functions.items()});xtst=types.SimpleNamespace(XTestFakeKeyEvent=Call(key));ctypes.CDLL=lambda name:x11 if name=='libX11.so.6' else xtst
def sleep(value):state['sleeps'].append(value);state['now']+=value
def monotonic():
 if mode=='observer-clock-error'and sys._getframe(1).f_code.co_name in ['record','_record']:raise OSError('passive clock failed')
 return state['now']
time.sleep=sleep;time.monotonic=monotonic
class Broken(io.StringIO):
 def write(self,_value):raise OSError('evidence writer unavailable')
out=io.StringIO();err=Broken()if mode in ['writer-error','writer-error-refusal','writer-primary-error']else io.StringIO();failure=None
with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
 try:runpy.run_path(driver,run_name='__main__')
 except Exception as error:failure=str(error)
records=[]
for line in err.getvalue().splitlines():
 if line.startswith('MOTIONSCAPER_CHOOSER_OBSERVATION '):records.append(json.loads(line.split(' ',1)[1]))
print(json.dumps({'state':state,'failure':failure,'stdout':out.getvalue(),'stderr':err.getvalue(),'records':records}))`;
interface WindowEvidence {
	window: number;
	mapState: number | null;
	ownerPid: { status: 'available'; pid: number } | { status: 'unavailable'; reason: string };
}
interface Evidence {
	stage: string;
	display: string;
	monotonicSeconds: number;
	targetWindow: number;
	focusedWindow: { status: 'available'; window: number } | { status: 'unavailable'; reason: string };
	target: WindowEvidence | null;
	sameTitle: { windows: readonly WindowEvidence[]; examinedWindows: number; truncated: boolean };
	errors: readonly string[];
	truncated?: boolean;
}
interface Result {
	failure: string | null;
	stdout: string;
	stderr: string;
	records: readonly Evidence[];
	state: { events: readonly (readonly (string | number | boolean)[])[]; sleeps: readonly number[];
		published: boolean; now: number; closed: readonly number[] };
}
async function observe(mode: string): Promise<Result> {
	const driver = fileURLToPath(new URL('../scripts/lib/motionscaper-scene-chooser-x11.py', import.meta.url));
	const result = await promisify(execFile)('/usr/bin/python3', ['-B', '-E', '-s', '-c', program, driver, mode], { timeout: 5000, maxBuffer: 262144 });
	return JSON.parse(result.stdout) as Result;
}
const stages = ['target-found', 'focused', 'confirming', 'closed'];
test('native chooser records actual display, retained target, owner, focus and phases without changing its successful actions', async () => {
	const result = await observe('closed');
	assert.equal(result.failure, null); assert.equal(result.stdout, 'MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED\n');
	assert.deepEqual(result.records.map(value => value.stage), stages);
	assert.ok(result.records.every(value => value.display === ':987' && value.targetWindow === 100));
	assert.deepEqual(result.records[1]!.focusedWindow, { status: 'available', window: 100, revert: 1 });
	assert.deepEqual(result.records[0]!.target!.ownerPid, { status: 'available', pid: 10 });
	assert.deepEqual(result.state.sleeps, [0.2, 0.2, 0.1, 0.6]);
	assert.deepEqual(result.state.closed, [2, 1]);
	assert.equal(result.records.at(-1)!.target, null); assert.deepEqual(result.records.at(-1)!.sameTitle.windows, []);
});
test('native chooser retains original refusal after publication when a different same-title window remains', async () => {
	const result = await observe('other-title');
	assert.equal(result.failure, 'Native file chooser remained open after selection.'); assert.equal(result.stdout, '');
	assert.equal(result.state.published, true);
	const last = result.records.at(-1)!; assert.equal(last.stage, 'timeout'); assert.equal(last.targetWindow, 100);
	assert.equal(last.target, null); assert.deepEqual(last.sameTitle.windows.map(value => value.window), [200]);
	assert.ok(result.state.now >= 6.1 && result.state.now < 6.2, 'Original five-second disappearance bound remains.');
});
test('native chooser records persistent original target and divergent focus without accepting or refocusing', async () => {
	const result = await observe('foreign-focus');
	assert.equal(result.failure, 'Native file chooser remained open after selection.');
	const last = result.records.at(-1)!; assert.equal(last.target!.window, 100);
	assert.deepEqual(last.focusedWindow, { status: 'available', window: 900, revert: 1 });
	assert.deepEqual(result.state.events.filter(value => value[0] === 'focus'), [['focus', 100]]);
});
for (const mode of ['pid-absent', 'pid-invalid', 'pid-type', 'pid-trailing', 'pid-zero', 'pid-null']) test(`native chooser optional ${mode} stays unavailable without changing success`, async () => {
	const result = await observe(mode); assert.equal(result.failure, null);
	assert.equal(result.records[0]!.target!.ownerPid.status, 'unavailable');
});
for (const mode of ['observer-error', 'observer-open-error', 'observer-close-error', 'observer-clock-error', 'writer-error']) test(`native chooser ${mode} cannot mask its original outcome or input sequence`, async () => {
	const result = await observe(mode), ordinary = await observe('closed');
	assert.equal(result.failure, ordinary.failure); assert.equal(result.stdout, ordinary.stdout);
	assert.deepEqual(result.state.events, ordinary.state.events); assert.deepEqual(result.state.sleeps, ordinary.state.sleeps);
	if (mode === 'observer-error') assert.ok(result.records.some(value => value.focusedWindow.status === 'unavailable'));
});
test('native chooser passive X11 errors are bounded and isolated from original request failures', async () => {
	const passive = await observe('observer-xerror'); assert.equal(passive.failure, null);
	assert.ok(passive.records.some(value => value.errors.length)); assert.ok(passive.records.every(value => value.errors.length <= 8));
	const badWindow = await observe('observer-badwindow'); assert.equal(badWindow.failure, null);
	assert.ok(badWindow.records.some(value => value.errors.includes('X11 error 3')));
	assert.equal((await observe('original-badwindow')).failure, null, 'Original disappearing-window exemption stays unchanged.');
	for (const mode of ['original-xerror', 'writer-primary-error']) {
		const original = await observe(mode); assert.equal(original.failure, 'Native chooser X11 request failed: [2]'); assert.equal(original.stdout, '');
	}
});
for (const mode of ['observer-error-refusal', 'writer-error-refusal']) test(`native chooser ${mode} retains the exact original timeout`, async () => {
	const result = await observe(mode); assert.equal(result.failure, 'Native file chooser remained open after selection.'); assert.equal(result.stdout, '');
});
test('native chooser candidate and stderr evidence stay bounded while original timeout remains a refusal', async () => {
	const result = await observe('many'); assert.equal(result.failure, 'Native file chooser remained open after selection.');
	assert.equal(result.records.length, 4); assert.ok(Buffer.byteLength(result.stderr) <= 8192);
	for (const value of result.records) { assert.ok(value.sameTitle.windows.length <= 8); assert.ok(value.sameTitle.examinedWindows <= 256); assert.equal(value.sameTitle.truncated, true); }
});
test('native chooser window traversal and single-record bytes have independent finite caps', async () => {
	const wide = await observe('wide'); assert.equal(wide.failure, 'Native file chooser remained open after selection.');
	assert.ok(wide.records.every(value => value.sameTitle.examinedWindows === 256 && value.sameTitle.truncated));
	const large = await observe('large-record'); assert.equal(large.failure, 'Native file chooser remained open after selection.');
	assert.ok(large.records.some(value => value.truncated));
	for (const line of large.stderr.split('\n').filter(Boolean)) assert.ok(Buffer.byteLength(line + '\n') <= 2048);
	assert.ok(Buffer.byteLength(large.stderr) <= 8192);
});
test('native chooser original opening refusal remains at fifteen seconds without injecting keys', async () => {
	const result = await observe('missing'); assert.equal(result.failure, 'The real native Motionscaper file chooser did not open.');
	assert.deepEqual(result.state.events, []); assert.ok(result.state.now >= 15 && result.state.now < 15.1);
});
