/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

// Execute the maintained action branch itself against a GTK completion-grab model.
// This is a driver regression; real GTK behavior is qualified by the native workflow.
const program = `import ast,json,sys,types
from pathlib import Path
source=ast.parse(Path(sys.argv[1]).read_text());mode=sys.argv[2];popup=sys.argv[3]=='true';foreign=sys.argv[4]=='true'
blocks=[node for node in source.body if isinstance(node,ast.Try)]
branches=[node for node in blocks[-1].body if isinstance(node,ast.If) and ast.unparse(node.test)=="mode == 'cancel-export'"]
assert len(branches)==1
class Value:
 def __init__(self,value=0):self.value=value
class Call:
 def __init__(self,fn):self.fn=fn
 def __call__(self,*args):return self.fn(*args)
state={'popup':popup,'saved':False,'cancelled':False,'clicks':0,'tabs':0,'pointer':None,'events':[],'sleeps':[]}
def key(symbol,pressed):
 state['events'].append(['key',symbol,pressed])
 if symbol==0xFF09 and not pressed:state['tabs']+=1;state['popup']=False
 if symbol==0xFF1B and not pressed:state['cancelled']=True
 if symbol==0xFF0D:raise AssertionError('Return must not accidentally activate a completion')
def attributes(_display,_target,value):value.width=1124;value.height=822;value.map_state=2;return 1
def focus(_display,value,revert):value.value=3;return 1
def origin(_display,_target,_root,_x,_y,x,y,_child):x.value=40;y.value=25;return 1
def motion(_display,_screen,x,y,_delay):state['pointer']=[x,y];return 1
def button(_display,number,pressed,_delay):
 assert number==1
 state['events'].append(['button',pressed])
 if not pressed:
  state['clicks']+=1
  if state['popup']:state['popup']=False
  else:state['saved']=True
 return 1
def validate(*args):
 if foreign:raise RuntimeError('Foreign dialog')
 assert args==(10,10,3,3,3,1124,822,2)
def flush(_display):state['events'].append(['flush']);return 1
x11=types.SimpleNamespace(XFlush=Call(flush),XGetWindowAttributes=Call(attributes),XGetInputFocus=Call(focus),XTranslateCoordinates=Call(origin),XDefaultRootWindow=Call(lambda _display:1))
xtst=types.SimpleNamespace(XTestFakeMotionEvent=Call(motion),XTestFakeButtonEvent=Call(button))
ctypes=types.SimpleNamespace(c_int=Value,c_uint=Value,c_ulong=Value,POINTER=lambda _type:object,byref=lambda value:value)
env={'mode':mode,'display':1,'target':3,'selected_path':'/owned/saved.mscape','saving':True,'x11':x11,'xtst':xtst,'ctypes':ctypes,'ptr':object,'window':Value,'XWindowAttributes':types.SimpleNamespace,'key':key,'chord':lambda symbol:state['events'].append(['chord',symbol]),'time':types.SimpleNamespace(sleep=lambda value:state['sleeps'].append(value)),'selection':{'owner_pid':10},'owned_window_pid':lambda _target:10,'find_dialog':lambda _root:3,'validate_window':validate,'observe_owned_dialog':lambda _stage,_target:None}
try:exec(compile(ast.Module(body=branches,type_ignores=[]),'maintained-action-branch','exec'),env)
except RuntimeError as error:state['refused']=str(error)
print(json.dumps(state))`;
interface Observation {
	popup: boolean;
	saved: boolean;
	cancelled: boolean;
	clicks: number;
	tabs: number;
	pointer: readonly number[] | null;
	events: readonly (readonly (string | number | boolean)[])[];
	sleeps: readonly number[];
	refused?: string;
}
async function observe(mode: string, popup: boolean, foreign = false): Promise<Observation> {
	const driver = fileURLToPath(new URL('../scripts/lib/motionscaper-authored-chooser-x11.py', import.meta.url));
	const result = await promisify(execFile)('python3', ['-B', '-E', '-s', '-c', program, driver, mode, String(popup), String(foreign)], { timeout: 5000, maxBuffer: 65536 });
	return JSON.parse(result.stdout) as Observation;
}
for (const mode of ['save-project', 'export']) {
	test(`Motionscaper authored ${mode} releases completion before exactly one physical Save click`, async () => {
		const result = await observe(mode, true);
		assert.equal(result.saved, true, 'The only click must activate Save, not dismiss the Name completion grab.');
		assert.equal(result.tabs, 1); assert.equal(result.clicks, 1); assert.equal(result.cancelled, false);
		assert.deepEqual(result.pointer, [1115, 824], 'Button coordinates still translate the authenticated window origin.');
		assert.deepEqual(result.sleeps, [0.2, 0.2, 0.1, 0.6], 'No extra delay or retry is introduced.');
		const tabRelease = result.events.findIndex(event => event[0] === 'key' && event[1] === 0xFF09 && event[2] === false);
		const buttonPress = result.events.findIndex(event => event[0] === 'button' && event[1] === true);
		assert.ok(tabRelease >= 0 && tabRelease < buttonPress);
		assert.deepEqual(result.events[tabRelease + 1], ['flush']);
	});
}
test('Motionscaper authored Save without a completion still activates once and retains ownership refusal', async () => {
	const ordinary = await observe('save-project', false);
	assert.equal(ordinary.saved, true); assert.equal(ordinary.clicks, 1); assert.equal(ordinary.tabs, 1);
	const foreign = await observe('save-project', true, true);
	assert.equal(foreign.refused, 'Foreign dialog'); assert.equal(foreign.saved, false); assert.equal(foreign.clicks, 0);
});
test('Motionscaper authored export cancellation keeps its Escape-only path', async () => {
	const result = await observe('cancel-export', false);
	assert.equal(result.cancelled, true); assert.equal(result.saved, false); assert.equal(result.tabs, 0); assert.equal(result.clicks, 0);
	assert.deepEqual(result.sleeps, []);
	assert.deepEqual(result.events, [['key', 0xFF1B, true], ['key', 0xFF1B, false], ['flush']]);
});
