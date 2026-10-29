(() => {
  const API = (window.API_BASE_URL || '').replace(/\/$/, '');
  const $ = id => document.getElementById(id);
  let currentSessionId = null;
  let bearerToken = null;
  let toastTimer;
  const TOKEN_STORAGE_KEY = 'api_practice_lab_access_token';
  const AUTH_USER_STORAGE_KEY = 'api_practice_lab_auth_user';
  const AUTH_EXPIRES_STORAGE_KEY = 'api_practice_lab_auth_expires_at';
  const pretty = obj => JSON.stringify(obj, null, 2);

  // Center-screen success/error popup used by the Authorization flows and other UI actions.
  // Styles are injected here so this replacement file works without editing style.css.
  function ensurePopupStyles() {
    if ($('centerPopupStyles')) return;
    const style = document.createElement('style');
    style.id = 'centerPopupStyles';
    style.textContent = `
      #toast.center-popup-overlay {
        position: fixed; inset: 0; z-index: 9999; display: flex;
        align-items: center; justify-content: center; padding: 22px;
        background: rgba(15, 20, 38, .48); backdrop-filter: blur(4px);
        opacity: 0; visibility: hidden; pointer-events: none;
        transition: opacity .18s ease, visibility .18s ease;
        max-width: none; width: 100%; height: 100%; box-sizing: border-box;
        right: auto; bottom: auto; transform: none; border-radius: 0;
      }
      #toast.center-popup-overlay.popup-visible {
        opacity: 1; visibility: visible; pointer-events: auto;
      }
      #toast .center-popup-card {
        position: relative; width: min(100%, 410px); box-sizing: border-box;
        padding: 30px 26px 24px; border-radius: 18px; background: #fff;
        color: #20263a; text-align: center; box-shadow: 0 24px 80px rgba(12, 18, 40, .28);
        border-top: 5px solid #16a36a; animation: popupIn .2s ease-out;
      }
      #toast.popup-error .center-popup-card { border-top-color: #dc3545; }
      #toast .center-popup-icon {
        display: grid; place-items: center; width: 58px; height: 58px;
        margin: 0 auto 15px; border-radius: 50%; background: #e7f8ef;
        color: #12834f; font: 700 30px/1 system-ui, sans-serif;
      }
      #toast.popup-error .center-popup-icon { background: #ffebed; color: #c92a3a; }
      #toast .center-popup-title { margin: 0 0 9px; font: 800 20px/1.3 system-ui, sans-serif; }
      #toast .center-popup-message { margin: 0; color: #5c6476; font: 14px/1.6 system-ui, sans-serif; overflow-wrap: anywhere; }
      #toast .center-popup-close {
        margin-top: 22px; min-width: 110px; border: 0; border-radius: 9px;
        padding: 11px 20px; background: #15965e; color: #fff; cursor: pointer;
        font: 700 13px system-ui, sans-serif;
      }
      #toast.popup-error .center-popup-close { background: #d93649; }
      #toast .center-popup-close:focus-visible { outline: 3px solid #8b91ff; outline-offset: 3px; }
      @keyframes popupIn { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @media (prefers-reduced-motion: reduce) { #toast.center-popup-overlay, #toast .center-popup-card { animation: none; transition: none; } }
    `;
    document.head.appendChild(style);
  }

  function closeToast() {
    const el = $('toast');
    if (!el) return;
    el.classList.remove('popup-visible', 'popup-error');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '';
    clearTimeout(toastTimer);
  }

  function toast(message, isError=false) {
    const el = $('toast');
    if (!el) return;
    ensurePopupStyles();
    clearTimeout(toastTimer);
    el.className = 'toast center-popup-overlay' + (isError ? ' popup-error' : '');
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-hidden', 'false');

    const card = document.createElement('div');
    card.className = 'center-popup-card';
    const icon = document.createElement('div');
    icon.className = 'center-popup-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = isError ? '!' : '✓';
    const title = document.createElement('h2');
    title.className = 'center-popup-title';
    title.textContent = isError ? 'Something went wrong' : 'Success';
    const text = document.createElement('p');
    text.className = 'center-popup-message';
    text.textContent = String(message);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'center-popup-close';
    close.textContent = 'OK';
    close.addEventListener('click', closeToast);
    card.append(icon, title, text, close);
    el.replaceChildren(card);
    requestAnimationFrame(() => {
      el.classList.add('popup-visible');
      close.focus();
    });
    // Auto-dismiss after a few seconds, while allowing users to close it immediately.
    toastTimer = setTimeout(closeToast, 3600);
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('toast')?.classList.contains('popup-visible')) closeToast();
  });
  async function api(path, options={}) {
    // Real-project style: attach the stored Bearer token by default. Login/OTP
    // bootstrap calls intentionally remain unauthenticated.
    const headers = {'Content-Type':'application/json', ...(options.headers || {})};
    const isAuthBootstrap = ['/api/auth/login', '/api/auth/otp/send', '/api/auth/otp/get', '/api/auth/otp/verify'].includes(path);
    if (bearerToken && !isAuthBootstrap && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
    const res = await fetch(API + path, {...options, headers});
    const raw = await res.text(); let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {raw}; }
    // A rejected stored token should not leave the UI falsely authenticated.
    if (res.status === 401 && bearerToken && !isAuthBootstrap) clearAuthState('Session expired or token is invalid. Please log in again.');
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
  function setToken(data){
    if (!data || !data.token) throw new Error('Login succeeded but the API response did not include a token.');
    bearerToken = data.token;
    const user = data.user || {};
    const expiresAt = Date.now() + (Number(data.expires_in_seconds) || 3600) * 1000;
    // localStorage mirrors a common browser-based application pattern and survives refreshes.
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, bearerToken);
      localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
      localStorage.setItem(AUTH_EXPIRES_STORAGE_KEY, String(expiresAt));
    } catch (storageError) {
      console.warn('Could not persist the token in localStorage; keeping it in memory for this page only.', storageError);
    }
    renderAuthState(user, expiresAt);
  }
  function renderAuthState(user={}, expiresAt=null){
    if (!bearerToken) return;
    $('tokenValue').textContent = bearerToken;
    $('tokenValue').classList.add('has-token');
    $('tokenState').textContent = 'Active'; $('tokenState').style.color = '#15956e';
    $('authBadge').textContent = `Bearer · ${user.auth_method || 'restored'}`; $('authBadge').classList.add('active');
    ['copyToken','checkMe','logoutBtn','protectedRequest'].forEach(id=>$(id).disabled=false);
    const expiryText = expiresAt ? new Date(Number(expiresAt)).toLocaleString() : 'determined by the API';
    $('authMessage').textContent = `Authenticated${user.auth_method ? ` via ${user.auth_method}` : ''}. Token stored in browser localStorage. Expires around ${expiryText}.`;
    $('authMessage').classList.remove('hidden');
  }
  function clearAuthState(message='Signed out. Please log in again.'){
    bearerToken = null;
    try { localStorage.removeItem(TOKEN_STORAGE_KEY); localStorage.removeItem(AUTH_USER_STORAGE_KEY); localStorage.removeItem(AUTH_EXPIRES_STORAGE_KEY); } catch {}
    $('tokenValue').textContent = message; $('tokenValue').classList.remove('has-token');
    $('tokenState').textContent = 'Signed out'; $('tokenState').style.color = '';
    $('authBadge').textContent = 'No token'; $('authBadge').classList.remove('active');
    ['copyToken','checkMe','logoutBtn','protectedRequest'].forEach(id=>$(id).disabled=true);
    $('authMessage').classList.add('hidden');
  }
  async function restoreAuthState(){
    let storedToken = null, storedUser = {}, expiresAt = null;
    try {
      storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      storedUser = JSON.parse(localStorage.getItem(AUTH_USER_STORAGE_KEY) || '{}');
      expiresAt = localStorage.getItem(AUTH_EXPIRES_STORAGE_KEY);
    } catch (e) { console.warn('Could not read saved auth state from localStorage.', e); }
    if (!storedToken) return;
    if (expiresAt && Number(expiresAt) <= Date.now()) { clearAuthState('Saved session expired. Please log in again.'); return; }
    bearerToken = storedToken;
    renderAuthState(storedUser, expiresAt);
    try {
      const {res,data} = await api('/api/auth/me');
      if (res.ok) {
        $('protectedOutput').textContent = pretty(data);
        $('authMessage').textContent = `Restored browser session and validated token with GET /api/auth/me. ${expiresAt ? `Expires around ${new Date(Number(expiresAt)).toLocaleString()}.` : ''}`;
        $('authMessage').classList.remove('hidden');
      } else {
        clearAuthState('Saved token was rejected. Please log in again.');
      }
    } catch (e) { $('authMessage').textContent = 'Token is saved in localStorage, but the API could not be reached to validate it.'; }
  }
  $('copyToken').onclick=()=>copyText(bearerToken||'');
  async function protectedCall(path='/api/auth/me', method='GET'){
    if(!bearerToken){toast('Please log in first to create a Bearer token.',true);return;}
    try{const {res,data}=await api(path,{method,...(method==='POST'?{body:'{}'}:{})});$('protectedOutput').textContent=pretty(data);if(!res.ok)throw new Error(data.error || `HTTP ${res.status}`);toast('Protected API returned '+res.status);}
    catch(e){toast(e.message,true);}
  }
  $('checkMe').onclick=()=>protectedCall(); $('protectedRequest').onclick=()=>protectedCall();
  $('logoutBtn').onclick=async()=>{
    if(!bearerToken){clearAuthState();return;}
    try{const {res,data}=await api('/api/auth/logout',{method:'POST',body:'{}'});$('protectedOutput').textContent=pretty(data);if(!res.ok)throw new Error(data.error || `HTTP ${res.status}`);clearAuthState('Logged out. Login again to generate a token.');toast('Logged out; token removed from browser localStorage.');}
    catch(e){toast(e.message,true);}
  };
  // Keep tabs in sync if the user logs out or changes token in another same-origin tab.
  window.addEventListener('storage', event => {
    if (event.key === TOKEN_STORAGE_KEY) {
      if (event.newValue) { bearerToken = event.newValue; restoreAuthState(); }
      else if (bearerToken) clearAuthState('Session was cleared in another tab.');
    }
  });
  $('copyBaseUrl').onclick=()=>copyText(API||location.origin);
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>copyText(b.dataset.copy==='email'?$('demoEmail').textContent:$('demoPassword').textContent));
  async function copyText(text){try{await navigator.clipboard.writeText(text);toast('Copied to clipboard');}catch{toast('Copy not available in this browser',true);}}
  checkHealth(); refreshItems(); restoreAuthState();
})();
