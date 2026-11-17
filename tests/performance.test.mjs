import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context=vm.createContext({console});
vm.runInContext(readFileSync(new URL('../js/audio.js',import.meta.url),'utf8'),context);
const a=Object.create(context.Wilds.AudioDirector.prototype);
class VoiceNode extends EventTarget {disconnect(){this.disconnected=true;}}
a.ctx={createOscillator:()=>new VoiceNode(),createGain:()=>new VoiceNode()};
const voice={nodes:[],active:0};
const first=a.createVoiceNode(voice,'createOscillator'),gain=a.createVoiceNode(voice,'createGain'),second=a.createVoiceNode(voice,'createOscillator');
first.dispatchEvent(new Event('ended'));assert.equal(a.activeAudioNodes,3);assert(!gain.disconnected,'Shared gain must stay connected until the final oscillator ends');
second.dispatchEvent(new Event('ended'));assert.equal(a.activeAudioNodes,0);assert(gain.disconnected);assert(first.disconnected&&second.disconnected);
second.dispatchEvent(new Event('ended'));assert.equal(a.activeAudioNodes,0);
a.ctx={currentTime:1000,state:'running'};a.scene='day1';a.nextNoteTime=0;a.step=0;const scheduled=[];
a.scheduleStep=(track,step,when)=>scheduled.push(when);a.tick();
assert(scheduled.length>0&&scheduled.length<=3);assert(scheduled.every(when=>when>=1000),'Background recovery must skip expired audio, not replay hundreds of old notes');
console.log('Performance regressions passed: audio nodes released after all voices end and expired music is never replayed.');
