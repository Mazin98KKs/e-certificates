// server.js – final compact version
require('dotenv').config();
const express            = require('express');
const bodyParser         = require('body-parser');
const axios              = require('axios');
const cloudinary         = require('cloudinary').v2;
const fs                 = require('fs');
const path               = require('path');
const ExcelJS            = require('exceljs');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const Stripe             = require('stripe');
const { createClient }   = require('redis');

const stripe  = Stripe(process.env.STRIPE_SECRET_KEY);
const app     = express();
const redis   = createClient({ url: process.env.REDIS_URL });

/* ─ Redis ───────────────────────────────────── */
redis.connect()
     .then(()=>console.log('✅ Redis connected'))
     .catch(e=>{ console.error(e); process.exit(1); });

/* ─ Cloudinary ──────────────────────────────── */
cloudinary.config(process.env.CLOUDINARY_URL_UK);

/* ─ In‑memory (per process) ─────────────────── */
const checkoutLinks   = {};
const sessionMetadata = {};
const userSessions    = {};
const dailyBizInit    = new Set();  // numbers we started with today
let   dailyBizCount   = 0;

/* reset business‑init count every 24 h */
setInterval(()=>{ dailyBizInit.clear(); dailyBizCount=0; },24*60*60*1e3);
/* prune idle WA sessions every 30 s */
setInterval(()=>{
  const now=Date.now();
  Object.keys(userSessions).forEach(k=>{
    if(now-userSessions[k].lastActivity>5*60*1e3) delete userSessions[k];
  });
},30e3);

/* ─ Constants ───────────────────────────────── */
const WA_API       = 'https://graph.facebook.com/v22.0/511694895370910/messages';
const CERTIFICATE_PUBLIC_IDS = {
  1:"friendship_izeffy",   2:"BFF_gq9uvn",      3:"king_negative_lppdtt",
  4:"LGBTQ_ggrnfx",        5:"goodvibes_j1pwa7",6:"coffeead_ot6pfn",
  7:"awsomeness_abfqao",   8:"gossip_w3esd9",   9:"do_nothing_rfcws5",
 10:"overthinker_m7p4tw",
};
const FREE_CERTIFICATES = [1];
const PRICE_IDS = {
  2:"price_1R2AsnBH45p3WHSsiRKGkSR3", 3:"price_1R2LIYBH45p3WHSsaLS2zDvR",
  4:"price_1R2LJ7BH45p3WHSsCGmpENqT", 5:"price_1R2LJuBH45p3WHSs0J12FKNS",
  6:"price_1R2LKPBH45p3WHSsEkbP0zNE", 7:"price_1R2LKtBH45p3WHSsqtyuMm1t",
  8:"price_1R2LLIBH45p3WHSssBVBri6r", 9:"price_1R2LLsBH45p3WHSsKBlo6kSL",
 10:"price_1R2LMIBH45p3WHSsaLdB2QXQ"
};

/* ─ Express parsers ─────────────────────────── */
app.use('/webhook',        bodyParser.json());
app.use('/stripe-webhook', bodyParser.raw({ type:'application/json' }));

/* ─ Utilities ───────────────────────────────── */
const waPost = p=>axios.post(WA_API,p,{
  headers:{ Authorization:`Bearer ${process.env.WHATSAPP_API_TOKEN}`,
            'Content-Type':'application/json'}
});
const sendText    =(to,body)=>waPost({messaging_product:'whatsapp',to,type:'text',text:{body}});
const sendWelcome =(to)=>waPost({messaging_product:'whatsapp',to,type:'template',
                                 template:{name:'wel_en',language:{code:'en'}}});

function formatIntl(raw){
  const p = parsePhoneNumberFromString('+'+raw.replace(/\D/g,''));
  return p&&p.isValid()?p.format('E.164').slice(1):null;
}
async function logXLSX(sender,name,num){
  const file=path.join('/data','sent_certificates.xlsx');
  const wb=new ExcelJS.Workbook();
  let ws;
  if(fs.existsSync(file)){
    await wb.xlsx.readFile(file);
    ws=wb.getWorksheet('sent certificates')||wb.addWorksheet('sent certificates');
  }else{
    ws=wb.addWorksheet('sent certificates');
    ws.addRow(['Timestamp','Sender','Recipient Name','Recipient Number']);
  }
  ws.addRow([new Date().toISOString(),sender,name,num]);
  await wb.xlsx.writeFile(file);
}

/* send certificate & record in Redis */
async function sendCertificate(sender,recipient,certId,recName,custom=''){
  await logXLSX(sender,recName,recipient);
  await redis.set(`hiddenSender:${recipient}`,sender);
  await redis.incr(`sentCount:${sender}`);

  const url = cloudinary.url(CERTIFICATE_PUBLIC_IDS[certId],{
    transformation:[{ overlay:{font_family:'Arial',font_size:80,text:recName},
                      gravity:'center', y:-30}]
  });

  await waPost({
    messaging_product:'whatsapp',to:recipient,type:'template',
    template:{
      name:'gift1',language:{code:'en'},
      components:[
        {type:'header',parameters:[{type:'image',image:{link:url}}]},
        {type:'body', parameters:[
          {type:'text',text:recName},
          {type:'text',text:custom}
        ]}
      ]
    }
  });
}

/* Stripe checkout helper */
async function createCheckout(certId,sender,recipient,name){
  const price=PRICE_IDS[certId];
  if(!price) return null;
  const session = await stripe.checkout.sessions.create({
    payment_method_types:['card'],
    line_items:[{price,quantity:1}],
    mode:'payment',
    metadata:{senderNumber:sender,recipientNumber:recipient,
              certificateId:certId,recipientName:name},
    success_url:"https://e-certificates.onrender.com/success.html",
    cancel_url :"https://e-certificates.onrender.com/cancel.html",
    billing_address_collection:'auto'
  });

  checkoutLinks[sender]=session.url;
  sessionMetadata[session.id]={ ...session.metadata,
    customMessage:userSessions[sender]?.customMessage||'' };
  return `https://e-certificates.onrender.com/checkout/${sender}`;
}

/* ─ Verification (GET) ──────────────────────── */
app.get('/webhook',(req,res)=>{
  const {['hub.mode']:mode,
         ['hub.verify_token']:token,
         ['hub.challenge']:c}=req.query;
  if(mode==='subscribe' && token===process.env.VERIFY_TOKEN_UK)
      return res.status(200).send(c);
  res.sendStatus(403);
});

/* ─ WhatsApp messages (POST) ────────────────── */
app.post('/webhook', async (req,res)=>{
  try{
    if(req.body.object!=='whatsapp_business_account') return res.sendStatus(200);
    for(const entry of req.body.entry||[]){
      for(const change of entry.changes||[]){
        for(const msg of change.value?.messages||[]){
          const from = msg.from;
          const text = (msg.text?.body||'').trim();

          if(!dailyBizInit.has(from)){
            if(dailyBizCount>=990){ await sendText(from,'Busy, try later'); continue;}
            dailyBizInit.add(from); dailyBizCount++;
          }

          if(text.toLowerCase()==='who sent me?'){
            const cnt=+(await redis.get(`sentCount:${from}`)||'0');
            if(cnt<3) await sendText(from,`Send 3 certificates first (${cnt}/3).`);
            else{
              const sender = await redis.get(`hiddenSender:${from}`);
              sender ? await sendText(from,`Sender ends with ***${sender.slice(-3)}`)
                     : await sendText(from,'Sender info not found.');
            }
            continue;
          }

          await handleUserMessage(from,msg);
        }
      }
    }
    res.sendStatus(200);
  }catch(e){ console.error(e); res.sendStatus(500);}
});

/* ─ Conversation FSM ────────────────────────── */
async function handleUserMessage(from,msg){
  const choice=(msg.text?.body||msg.interactive?.button_reply?.id||'').trim();
  if(choice==='Start'){
    userSessions[from]={step:'welcome',certificatesSent:0,lastActivity:Date.now()};
    await sendWelcome(from); userSessions[from].step='select_certificate'; return;
  }
  if(choice==='Stop'){ delete userSessions[from]; await sendText(from,'Session ended'); return;}

  if(!userSessions[from]){ await sendText(from,"Type 'Start' to begin."); return;}
  const s=userSessions[from]; s.lastActivity=Date.now();

  switch(s.step){
    case 'welcome': await sendWelcome(from); s.step='select_certificate'; break;
    case 'select_certificate':{
      const id=parseInt(choice,10);
      if(id>=1&&id<=10){ s.selectedCertificate=id; s.step='ask_recipient_name';
        await sendText(from,"Recipient's name?"); }
      else               await sendText(from,'Choose a number 1‑10.');
      break;}
    case 'ask_recipient_name':
      if(choice){ s.recipientName=choice; s.step='ask_recipient_number';
        await sendText(from,'Recipient phone inc. country code:'); }
      else       await sendText(from,'Enter a valid name.');
      break;
    case 'ask_recipient_number':
      const num=formatIntl(choice);
      if(num){ s.recipientNumber=num; s.step='ask_custom_message';
        await sendText(from,'Custom message (≤50 chars, single line):'); }
      else    await sendText(from,'Invalid phone number.');
      break;
    case 'ask_custom_message':
      if(choice && choice.length<=50 && !choice.includes('\n')){
        s.customMessage=choice; s.step='confirm_send';
        await sendText(from,`Send to ${s.recipientName} (${s.recipientNumber}) – "${choice}" ? (Yes/No)`);
      }else await sendText(from,'Invalid, try again.');
      break;
    case 'confirm_send':
      if(/^yes$/i.test(choice)){
        if(FREE_CERTIFICATES.includes(s.selectedCertificate)){
          await sendCertificate(from,s.recipientNumber,s.selectedCertificate,
                                s.recipientName,s.customMessage);
          s.certificatesSent++; s.step='ask_another';
          await sendText(from,'Sent ✅  Send another? (Yes/No)');
        }else{
          const url=await createCheckout(s.selectedCertificate,from,
                                         s.recipientNumber,s.recipientName);
          if(url){ s.step='await_payment'; await sendText(from,'Pay here:\n'+url);}
          else    await sendText(from,'Payment error, try later.');
        }
      }else if(/^no$/i.test(choice)){ delete userSessions[from]; await sendText(from,'Session ended.'); }
      else await sendText(from,'Yes or No?');
      break;
    case 'await_payment': await sendText(from,'Waiting for payment…'); break;
    case 'ask_another':
      if(/^yes$/i.test(choice)){ s.step='welcome'; await sendWelcome(from); s.step='select_certificate'; }
      else if(/^no$/i.test(choice)){ delete userSessions[from]; await sendText(from,'Thanks!'); }
      else await sendText(from,'Yes or No?');
      break;
    default: delete userSessions[from]; await sendText(from,"Type 'Start' to begin.");
  }
}

/* ─ Stripe webhook ──────────────────────────── */
app.post('/stripe-webhook',async(req,res)=>{
  let e;
  try{ e=stripe.webhooks.constructEvent(req.body,
        req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}
  catch(err){ console.error('Stripe sig fail'); return res.status(400).send(); }

  if(e.type==='checkout.session.completed'){
    const meta=sessionMetadata[e.data.object.id];
    if(meta){
      await sendCertificate(meta.senderNumber,meta.recipientNumber,
                            meta.certificateId,meta.recipientName,
                            meta.customMessage);
      await sendText(meta.senderNumber,'Payment received – certificate sent!');
      delete sessionMetadata[e.data.object.id];
      delete checkoutLinks[meta.senderNumber];
    }
  }
  res.sendStatus(200);
});

/* ─ Misc endpoints ──────────────────────────── */
app.get('/checkout/:id',(req,res)=>{
  const url=checkoutLinks[req.params.id]; url?res.redirect(302,url):res.status(404).send('Expired');
});
app.get('/status',(req,res)=>res.json({initiatedConversations:dailyBizCount}));
app.get('/download-certificates',(req,res)=>{
  const f='/data/sent_certificates.xlsx';
  fs.existsSync(f)?res.download(f,'sent_certificates.xlsx'):res.status(404).send('No file');
});

/* ─ Start server ───────────────────────────── */
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀  Running on ${PORT}`));
