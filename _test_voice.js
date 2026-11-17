// 用假的 speechSynthesis 模拟：在线语音 慢/失败/正常 三种情况
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const a = html.indexOf('var voices = [], gbVoice'), b = html.indexOf('function markUAReady');
const code = html.slice(a, b);
const V = [
  {name:'Microsoft Hazel - English (United Kingdom)', lang:'en-GB', localService:true, voiceURI:'hazel'},
  {name:'Microsoft David - English (United States)', lang:'en-US', localService:true, voiceURI:'david'},
  {name:'Google US English', lang:'en-US', localService:false, voiceURI:'gus'},
  {name:'Google UK English Female', lang:'en-GB', localService:false, voiceURI:'gukf'},
];
let mode = 'ok', log = [], toasts = [], saves = 0, pending = null;
const speechSynthesis = {
  paused:false, getVoices:()=>V,
  cancel(){ if(pending){ const u=pending; pending=null; setTimeout(()=>u.onerror&&u.onerror({error:'interrupted'}),0);} },
  resume(){},
  speak(u){ log.push('speak:'+(u.voice&&u.voice.name)); pending=u;
    const delay = u.voice.localService ? 50 : (mode==='slow2s'?2000: mode==='dead'?1e9 : mode==='err'?300 : 400);
    if(mode==='err' && !u.voice.localService){ setTimeout(()=>{ if(pending===u){pending=null; u.onerror({error:'synthesis-failed'});} },delay); return; }
    if(delay<1e8) setTimeout(()=>{ if(pending===u){ log.push('START:'+u.voice.name); u.onstart&&u.onstart(); pending=null; u.onend&&u.onend(); } }, delay);
  }
};
global.window = {speechSynthesis}; global.speechSynthesis = speechSynthesis;
global.SpeechSynthesisUtterance = function(t){ this.text=t; };
global.document = {getElementById:()=>null};
global.DB = {set:{voiceURI:process.argv[3]||'', rate:0.9}};
global.saveDB = ()=>{ saves++; }; global.toast = m=>toasts.push(m); global.esc = s=>s; global.renderVoiceTests=()=>{};
eval(code + ';global.say=say;global.refreshVoices=refreshVoices;global.pickVoice=pickVoice;global.ST=()=>LAST_SPEECH_ERR;');
refreshVoices();
const wait = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  console.log('自动模式选中:', pickVoice().name);
  for (const m of ['ok','slow2s','err','dead','ok']) {
    mode=m; log=[]; say('kettle', false); await wait(4600);
    console.log(`[在线=${m}]`, log.join(' | '), '| 设置voiceURI=', JSON.stringify(DB.set.voiceURI), '| 报错=', ST());
  }
  console.log('saveDB 调用次数:', saves, '| toast:', toasts);
  // 连按两次：旧句子的 interrupted 不应清掉新句子的看门狗
  mode='dead'; log=[]; say('a',false); await wait(10); say('b',false); await wait(4600);
  console.log('[连按两次, 在线=dead]', log.join(' | '));
})();
