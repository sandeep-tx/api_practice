(() => {
  const API = (window.API_BASE_URL || '').replace(/\/$/, '');
  const $ = id => document.getElementById(id);
  let currentSessionId = null;
  let bearerToken = null;
  let toastTimer;
  const pretty = obj => JSON.stringify(obj, null, 2);
  function toast(message, isError=false) {
    const el = $('toast'); el.textContent = message; el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = 'toast', 2800);
  }
  async function api(path, options={}) {
    const headers = {'Content-Type':'application/json', ...(options.headers || {})};
    const res = await fetch(API + path, {...options, headers});
    const raw = await res.text(); let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {raw}; }
    return {res, data};
  }
  function showResponse(status, data) {
    $('responseStatus').textContent = status;
    $('responseStatus').style.color = status >= 200 && status < 300 ? '#15956e' : '#d84c61';
    $('responseStatus').style.background = status >= 200 && status < 300 ? '#e8faf3' : '#fff0f2';
    $('responseOutput').textContent = pretty(data);
  }
  async function refreshItems() {
    try {
      const {res,data} = await api('/api/items');
      if (!res.ok) throw new Error(data.error || 'Could not load items');
      const rows = data.data || []; $('rowCount').textContent = rows.length; $('tableSummary').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'} · API synced`;
      $('itemsBody').innerHTML = rows.length ? rows.map(item => `<tr><td>#${item.id}</td><td class="item-name">${esc(item.name)}</td><td><span class="category-pill">${esc(item.category)}</span></td><td>${item.quantity}</td><td>₹${Number(item.price).toFixed(2)}</td><td><div class="row-actions"><button class="row-action" data-edit="${item.id}">Edit</button><button class="row-action del" data-delete="${item.id}">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No records yet. Create one or POST from Postman to see it here.</td></tr>';
    } catch (e) { $('itemsBody').innerHTML = `<tr><td colspan="6" class="empty">API unavailable. Start Flask and check API_BASE_URL.<br>${esc(e.message)}</td></tr>`; $('tableSummary').textContent = 'API not reachable'; }
  }
  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function resetItemForm() { $('itemForm').reset(); $('editId').value=''; $('itemQuantity').value='1'; $('itemPrice').value='499'; $('formTitle').textContent='Add a record'; $('saveItem').textContent='＋ Create record'; $('cancelEdit').classList.add('hidden'); }
  $('itemForm').addEventListener('submit', async e => {
    e.preventDefault(); const id = $('editId').value;
    const body = {name:$('itemName').value.trim(), category:$('itemCategory').value.trim() || 'General', quantity:Number($('itemQuantity').value), price:Number($('itemPrice').value)};
    try { const {res,data}=await api(id ? `/api/items/${id}` : '/api/items', {method:id?'PUT':'POST',body:JSON.stringify(body)}); showResponse(res.status,data); if (!res.ok) throw new Error(data.error || 'Request failed'); toast(id?'Record updated':'Record created'); resetItemForm(); await refreshItems(); } catch(e) { toast(e.message,true); }
  });
  $('cancelEdit').onclick = resetItemForm;
  $('itemsBody').addEventListener('click', async e => {
    const edit = e.target.closest('[data-edit]'); const del = e.target.closest('[data-delete]');
    if (edit) { try { const {res,data}=await api(`/api/items/${edit.dataset.edit}`); if(!res.ok) throw new Error(data.error); const x=data.data; $('editId').value=x.id; $('itemName').value=x.name; $('itemCategory').value=x.category; $('itemQuantity').value=x.quantity; $('itemPrice').value=x.price; $('formTitle').textContent=`Edit record #${x.id}`; $('saveItem').textContent='Save changes (PUT)'; $('cancelEdit').classList.remove('hidden'); $('itemName').focus(); } catch(err){toast(err.message,true);} }
    if (del && confirm(`Delete record #${del.dataset.delete}?`)) { try { const {res,data}=await api(`/api/items/${del.dataset.delete}`,{method:'DELETE'}); showResponse(res.status,data); if(!res.ok)throw new Error(data.error); toast('Record deleted'); await refreshItems(); } catch(err){toast(err.message,true);} }
  });
  $('refreshItems').onclick = refreshItems;
  $('refreshAll').onclick = async () => { await refreshItems(); checkHealth(); toast('UI refreshed'); };
  $('clearItems').onclick = async () => { if(!confirm('Clear every practice record?'))return; const {res,data}=await api('/api/items/reset',{method:'POST',body:'{}'}); showResponse(res.status,data); await refreshItems(); toast('All records cleared'); };
  $('sendRequest').onclick = async () => { const method=$('httpMethod').value; let path=$('requestPath').value.trim(); if(!path.startsWith('/'))path='/'+path; const options={method}; if(['POST','PUT','PATCH'].includes(method)){try{options.body=JSON.stringify(JSON.parse($('requestBody').value || '{}'));}catch{toast('Request body is not valid JSON',true);return;}} try{const {res,data}=await api(path,options);showResponse(res.status,data);if(res.ok){await refreshItems();toast(`${method} completed (${res.status})`);}else toast(data.error||`HTTP ${res.status}`,true);}catch(e){showResponse('Network error',{error:e.message,tip:'Check that Flask is running and API_BASE_URL is correct.'});toast('API request failed',true);} };
  $('copyResponse').onclick = () => copyText($('responseOutput').textContent);
  function switchTab(name) { document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name)); ['crud','auth','docs'].forEach(x=>$(x+'Panel').classList.toggle('hidden',x!==name)); if(name==='crud')refreshItems(); }
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  async function checkHealth(){try{const {res,data}=await api('/health');$('apiStatus').textContent=res.ok?'API connected':'API error';$('apiStatus').style.color=res.ok?'#168b68':'#d84c61';if(res.ok){$('baseUrlDisplay').textContent=API||location.origin;}}catch{$('apiStatus').textContent='API offline';$('apiStatus').style.color='#d84c61';}}
  $('otpMobileForm').addEventListener('submit', async e=>{e.preventDefault();const mobile=$('mobileNumber').value.trim();if(!/^[6789]\d{9}$/.test(mobile)){toast('Enter exactly 10 digits starting with 6, 7, 8 or 9.',true);return;}try{const {res,data}=await api('/api/auth/otp/send',{method:'POST',body:JSON.stringify({mobile})});showResponse(res.status,data);if(!res.ok)throw new Error(data.error);currentSessionId=data.session_id;$('sessionText').textContent=currentSessionId;$('otpStage').classList.remove('hidden');$('otpHint').classList.add('hidden');$('otpInput').focus();toast('OTP session created. Retrieve OTP using session ID.');}catch(err){toast(err.message,true);}});
  $('getOtpHint').onclick=async()=>{if(!currentSessionId)return;try{const {res,data}=await api('/api/auth/otp/get',{method:'POST',body:JSON.stringify({session_id:currentSessionId})});showResponse(res.status,data);if(!res.ok)throw new Error(data.error);$('otpHint').textContent=`Practice OTP: ${data.otp} · Expires in ${data.expires_in_seconds}s`;$('otpHint').classList.remove('hidden');$('otpInput').value=data.otp;toast('OTP retrieved using session_id');}catch(err){toast(err.message,true);}};
  $('otpLoginForm').addEventListener('submit',async e=>{e.preventDefault();if(!currentSessionId){toast('Get OTP first',true);return;}try{const {res,data}=await api('/api/auth/otp/verify',{method:'POST',body:JSON.stringify({session_id:currentSessionId,otp:$('otpInput').value.trim()})});showResponse(res.status,data);if(!res.ok)throw new Error(data.error);setToken(data);toast('OTP login successful');}catch(err){toast(err.message,true);}});
  $('passwordForm').addEventListener('submit',async e=>{e.preventDefault();try{const {res,data}=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('loginEmail').value,password:$('loginPassword').value})});showResponse(res.status,data);if(!res.ok)throw new Error(data.error);setToken(data);toast('API login successful');}catch(err){toast(err.message,true);}});
  function setToken(data){bearerToken=data.token;$('tokenValue').textContent=bearerToken;$('tokenValue').classList.add('has-token');$('tokenState').textContent='Active';$('tokenState').style.color='#15956e';$('authBadge').textContent=`Bearer · ${data.user.auth_method}`;$('authBadge').classList.add('active');['copyToken','checkMe','logoutBtn','protectedRequest'].forEach(id=>$(id).disabled=false);$('authMessage').textContent=`Authenticated via ${data.user.auth_method}. Token expires in ${data.expires_in_seconds/60} minutes.`;$('authMessage').classList.remove('hidden');}
  $('copyToken').onclick=()=>copyText(bearerToken||'');
  async function protectedCall(path='/api/auth/me', method='GET'){if(!bearerToken)return;try{const {res,data}=await api(path,{method,headers:{Authorization:`Bearer ${bearerToken}`},...(method==='POST'?{body:'{}'}:{})});$('protectedOutput').textContent=pretty(data);if(!res.ok)throw new Error(data.error);toast('Protected API returned '+res.status);}catch(e){toast(e.message,true);}}
  $('checkMe').onclick=()=>protectedCall();$('protectedRequest').onclick=()=>protectedCall();
  $('logoutBtn').onclick=async()=>{try{const {res,data}=await api('/api/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${bearerToken}`},body:'{}'});$('protectedOutput').textContent=pretty(data);if(!res.ok)throw new Error(data.error);bearerToken=null;$('tokenValue').textContent='Logged out. Login again to generate a token.';$('tokenValue').classList.remove('has-token');$('tokenState').textContent='Signed out';$('tokenState').style.color='';$('authBadge').textContent='No token';$('authBadge').classList.remove('active');['copyToken','checkMe','logoutBtn','protectedRequest'].forEach(id=>$(id).disabled=true);$('authMessage').classList.add('hidden');toast('Logged out');}catch(e){toast(e.message,true);}};
  $('copyBaseUrl').onclick=()=>copyText(API||location.origin);
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>copyText(b.dataset.copy==='email'?$('demoEmail').textContent:$('demoPassword').textContent));
  async function copyText(text){try{await navigator.clipboard.writeText(text);toast('Copied to clipboard');}catch{toast('Copy not available in this browser',true);}}
  checkHealth(); refreshItems();
})();
