let contacts = [];
const $ = id => document.getElementById(id);
function renderContacts() {
  const eligible = contacts.filter(c => c.optedIn);
  $('total').textContent = contacts.length;
  $('eligible').textContent = eligible.length;
  $('excluded').textContent = contacts.length - eligible.length;
  $('campaignTotal').textContent = eligible.length;
  $('contacts').innerHTML = contacts.slice(0, 100).map((c,i) => '<div class="row"><span>'+(i+1)+'</span><strong>'+escapeHtml(c.name||'')+'</strong><span>'+escapeHtml(c.phone||'')+'</span><button class="pill '+(c.optedIn?'on':'')+'" data-index="'+i+'">'+(c.optedIn?'Opted in':'Excluded')+'</button></div>').join('');
  document.querySelectorAll('.pill').forEach(b => b.onclick = () => { const i=Number(b.dataset.index); contacts[i].optedIn=!contacts[i].optedIn; renderContacts(); });
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function parseCsv(text) {
  const lines=text.split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  const headers=lines.shift().split(',').map(x=>x.trim().toLowerCase());
  return lines.map(line=>{const cells=line.split(',').map(x=>x.trim());const o={};headers.forEach((h,i)=>o[h]=cells[i]||'');return {name:o.name||'',phone:o.phone||'',optedIn:['true','1','yes','y'].includes(String(o.opted_in).toLowerCase())};}).filter(x=>x.phone);
}
$('connect').onclick=async()=>{ $('error').textContent=''; try{await window.careerWings.connect();}catch(e){$('error').textContent=e.message;}};
$('disconnect').onclick=()=>window.careerWings.disconnect();
$('import').onclick=async()=>{const text=await window.careerWings.importCsv();if(text){contacts=parseCsv(text);renderContacts();}};
$('send').onclick=async()=>{try{await window.careerWings.sendCampaign({contacts,message:$('message').value,delayMs:Number($('delay').value)*1000});}catch(e){$('error').textContent=e.message;}};
$('stop').onclick=()=>window.careerWings.stopCampaign();
window.careerWings.onState(s=>{
  $('status').textContent=s.status==='connected'?'WhatsApp Connected':s.status==='qr'?'Scan QR':s.status==='authenticated'?'Authenticating…':'Not Connected';
  $('status').className='status '+(s.status==='connected'?'on':'');
  $('sent').textContent=s.sent||0; $('failed').textContent=s.failed||0; $('campaignTotal').textContent=s.total||contacts.filter(c=>c.optedIn).length;
  if(s.qr){$('qr').innerHTML='<img class="qrImage" alt="WhatsApp QR code" src="'+s.qr+'">';$('qrText').textContent='Phone WhatsApp → Linked Devices → Link a Device → Scan this QR.';}
  else if(s.status==='connected'){$('qr').innerHTML='<div class="qrPlaceholder"><strong>WhatsApp Connected</strong><br>Session saved on this computer.</div>'; $('qrText').textContent='Connected';}
  if(s.error)$('error').textContent=s.error;
});
renderContacts();
