(function(){
'use strict';
var F = document.getElementById('lead-form');
if(!F) return;
var D = document, q = function(i ){ return D.getElementById(i); };
var API = '/api/abs/v1', CONSENT = 'site-consent-v2';
var base = API, mode = 'transfer', step = 1, code = null, chosen = '', busy = false, rid = null, maxProfile = '', channel = '';
var steps = F.querySelectorAll('[data-step-indicator]');
var panes = F.querySelectorAll('.lead__pane');
var chips = F.querySelectorAll('.chip[data-service-code]');
var sIn = q('lead-service'), pIn = q('lead-phone'), ok = q('lead-consent'), stt = q('lead-status');
var picked = q('lead-picked'), pName = q('lead-picked-name'), less = matchMedia('(prefers-reduced-motion: reduce)').matches;
var sb = function( ){ return less ? 'auto' : 'smooth'; };
function newId( ){ if(window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ''); return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, function( ){ return Math.floor(Math.random()*16).toString(16); }); }
function safeUrl(v){
try {
var u = new URL(String(v || ''));
return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
} catch(e ){ return null; }
}
function cut(v, n ){ var t = String(v || '').trim(); return t ? t.slice(0, n) : null; }
function validPhone(v ){ return /^[78]?\d{10}$/.test(String(v || '').replace(/\D/g, '')); }
function st(text, bad, phoneToo){
stt.className = 'lead__status' + (bad ? ' is-err' : '');
stt.replaceChildren(D.createTextNode(text || ''));
if(!phoneToo) return;
var a = D.createElement('a');
a.href = 'tel:+79370854888';
a.dataset.tel = 'form-error';
a.textContent = '8-937-085-48-88';
stt.append(D.createTextNode(' '), a);
}
function err(field, text){
var i = q(field), b = q(field + '-error');
if(i) text ? i.setAttribute('aria-invalid', 'true') : i.removeAttribute('aria-invalid');
if(b ){ b.textContent = text || ''; b.hidden = !text; }
return i;
}
function applyMode(next, b){
mode = next;
if(b) base = String(b).replace(/\/+$/, '');
q('lead-card').dataset.mode = mode;
F.querySelector('[data-send-api]').hidden = mode !== 'api';
F.querySelector('[data-send-transfer]').hidden = mode === 'api';
var m = D.querySelector('[data-motiv-api]');
if(m) m.hidden = mode !== 'api';
}
function initMode(){
var forced = /(^|\.)github\.io$/i.test(location.hostname);
fetch('site-config.json', { cache: 'no-store' })
.then(function(r ){ return r.ok ? r.json() : null; })
.then(function(c ){
if(c && c.max_profile_url) maxProfile = safeUrl(c.max_profile_url) || '';
if(!forced && c && c.lead_mode === 'api') applyMode('api', c.api_base || '');
else applyMode('transfer');
})
.catch(function( ){ applyMode('transfer'); });
}
function track(name, extra){
if(mode !== 'api') return;
if(!rid) rid = newId();
var body = { event: name, page: location.pathname.slice(0, 300), idem: rid || '' };
Object.assign(body, extra || {});
try {
fetch(base + '/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
} catch(e) {}
}
function setStep(n, focus){
step = n;
panes.forEach(function(p){
var on = Number(p.dataset.step) === n;
p.hidden = !on;
p.classList.remove('is-in');
if(on && !less ){ void p.offsetWidth; p.classList.add('is-in'); }
});
steps.forEach(function(li){
var k = Number(li.dataset.stepIndicator);
li.classList.toggle('is-done', k < n);
if(k === n) li.setAttribute('aria-current', 'step');
else li.removeAttribute('aria-current');
});
if(!focus) return;
var t = n === 1 ? F.querySelector('.chip') : pIn;
setTimeout(function( ){ t.focus({ preventScroll: true }); }, 40);
}
function paint(){
chips.forEach(function(c ){ c.setAttribute('aria-pressed', String(c.dataset.service === chosen)); });
picked.hidden = !chosen;
if(chosen) pName.textContent = chosen;
}
function setService(el){
chosen = String(el.dataset.service || '').trim().slice(0, 120);
code = el.dataset.serviceCode || null;
if(code) sIn.value = '';
err('lead-service');
paint();
}
function toLead( ){ q('lead').scrollIntoView({ behavior: sb(), block: 'start' }); }
function setChannel(v){
channel = v === 'max' ? 'max' : '';
var n = q('lead-chan');
if(n) n.hidden = channel !== 'max';
}
D.addEventListener('click', function(e){
var el = e.target.closest && e.target.closest('.chip[data-service-code], .sit[data-service]');
if(!el || !F) return;
setService(el);
setStep(2, el.classList.contains('chip'));
if(el.classList.contains('sit')){
toLead();
setTimeout(function( ){ pIn.focus({ preventScroll: true }); }, less ? 0 : 260);
}
if(mode === 'api') track('form_start', { block: el.classList.contains('sit') ? 'situation' : 'chip' });
});
F.addEventListener('focusin', function( ){ track('form_start'); }, { once: true });
sIn.addEventListener('input', function(){
if(sIn.value.trim() ){ chosen = ''; code = null; paint(); err('lead-service'); }
});
q('lead-next').addEventListener('click', function( ){ if(checkStep()) setStep(2, true); });
q('lead-back').addEventListener('click', function( ){ setStep(1, true); });
q('lead-edit').addEventListener('click', function( ){ setStep(1, true); });
function checkStep(){
if(!code && !sIn.value.trim()){
err('lead-service', 'Выберите ситуацию или опишите работу своими словами').focus({ preventScroll: true });
st('Проверьте выделенные поля и отправьте ещё раз.', true);
return false;
}
err('lead-service');
return true;
}
function checkContact(){
var first = null;
if(!validPhone(pIn.value)) first = err('lead-phone', 'Проверьте российский номер — 10 цифр после +7 или 8');
else err('lead-phone');
if(!ok.checked){
ok.setAttribute('aria-invalid', 'true');
var b = q('lead-consent-error');
b.textContent = 'Нужно согласие на обработку данных';
b.hidden = false;
if(!first) first = ok;
} else { ok.removeAttribute('aria-invalid'); err('lead-consent'); }
if(!first) return true;
st('Проверьте выделенные поля и отправьте ещё раз.', true);
first.focus({ preventScroll: true });
first.scrollIntoView({ behavior: sb(), block: 'center' });
return false;
}
function messengers(m){
var box = q('lead-messengers'), n = 0;
box.replaceChildren();
[['telegram_url', 'Продолжить в Telegram', 'telegram'], ['max_url', 'Продолжить в MAX', 'max']].forEach(function(c){
var href = safeUrl(m && m[c[0]]);
if(!href) return;
var a = D.createElement('a');
a.className = 'btn btn--navy';
a.href = href;
a.target = '_blank';
a.rel = 'noopener';
a.textContent = c[1];
a.addEventListener('click', function( ){ track('messenger_click', { src: c[2] }); });
box.append(a);
n += 1;
});
box.hidden = !n;
}
function showDone(kind, title, no, text){
var dTitle = q('lead-done-title'), num = q('lead-no'), msg = q('lead-done-message'), box = q('lead-done');
dTitle.textContent = title;
num.textContent = no ? 'Номер заявки: ' + no : '';
num.hidden = !no;
msg.textContent = text || '';
F.hidden = true;
box.hidden = false;
q('lead-done-api').hidden = kind !== 'api';
q('lead-done-transfer').hidden = kind !== 'transfer';
var cn = q('lead-chan-done');
if(cn) cn.hidden = kind !== 'api' || channel !== 'max';
if(kind === 'api') q('lead-check').classList.add('is-on');
st('');
box.focus({ preventScroll: true });
box.scrollIntoView({ behavior: sb(), block: 'center' });
}
function buildText(){
var t = ['Заявка с сайта · АБС-Автосервис'];
t.push('🔧 Услуга: ' + (chosen || sIn.value.trim()).slice(0, 120));
var car = cut(q('lead-car').value, 60), when = cut(q('lead-time').value, 80), name = cut(q('lead-name').value, 80);
if(car) t.push('🚗 Автомобиль: ' + car);
if(when) t.push('🕐 Когда удобно: ' + when);
if(name) t.push('👤 Имя: ' + name);
if(channel === 'max') t.push('💬 Ответить в: MAX');
t.push('📞 Телефон: ' + pIn.value.trim(), 'Прошу подтвердить время.');
return t.join('\n');
}
var copyBtn = q('lead-copy'), copyLabel = copyBtn.querySelector('span'), copyTimer = null;
function copied(){
copyLabel.textContent = 'Текст скопирован';
clearTimeout(copyTimer);
copyTimer = setTimeout(function( ){ copyLabel.textContent = 'Скопировать текст заявки'; }, 2600);
}
function fallback(area){
try {
area.focus();
area.select();
if(D.execCommand('copy')) copied();
} catch(e) {}
}
function copyText(){
var area = q('lead-text');
if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(area.value).then(copied, function( ){ fallback(area); });
else fallback(area);
}
copyBtn.addEventListener('click', copyText);
var tgCopy = q('lead-done-transfer').querySelector('a[data-tg]');
if(tgCopy) tgCopy.addEventListener('click', copyText);
function transferMax(){
var slot = q('lead-max-slot');
if(!slot) return;
slot.replaceChildren();
if(!maxProfile) return;
var a = D.createElement('a');
a.className = 'btn btn--ghost';
a.href = maxProfile;
a.target = '_blank';
a.rel = 'noopener';
a.dataset.max = 'form-transfer';
a.textContent = 'Открыть MAX';
a.addEventListener('click', function( ){ track('messenger_click', { src: 'max' }); });
slot.append(a);
}
function submitTransfer( ){
q('lead-text').value = buildText();
var lead = q('lead-transfer-lead');
if(lead) lead.textContent = channel === 'max'
  ? 'Скопируйте текст и отправьте его в наш Telegram — менеджер ответит в MAX.'
  : 'Скопируйте текст и отправьте его в наш Telegram — или позвоните.';
transferMax();
showDone('transfer');
}
function setBusy(v){
busy = v;
var b = q('lead-send');
b.disabled = v;
F.setAttribute('aria-busy', String(v));
if(mode === 'api') b.querySelector('[data-send-api]').textContent = v ? 'Отправляем…' : 'Отправить заявку';
}
function payload(){
var p = new URLSearchParams(location.search), utm = {}, ref = p.get('ref');
p.forEach(function(v, k ){ if(k.indexOf('utm_') === 0 && v.trim()) utm[k] = v.trim().slice(0, 300); });
var body = {
client_request_id: rid, kind: 'booking', phone: pIn.value.trim(),
name: cut(q('lead-name').value, 80), car: cut(q('lead-car').value, 120),
service: cut(chosen || sIn.value, 120), wish_time: cut(q('lead-time').value, 80),
page: location.pathname.slice(0, 300),
consent: { pd: ok.checked, ads: false, text_version: CONSENT },
website: q('lead-website').value
};
if(code && /^[a-z0-9_]{2,64}$/.test(code)) body.service_code = code;
if(channel === 'max') body.comment = 'Прошу связаться в MAX.';
if(Object.keys(utm).length) body.utm = utm;
if(ref && /^[A-Za-z0-9_-]{4,32}$/.test(ref)) body.ref = ref;
return body;
}
function handle(res){
var data = res.data || {}, fields = data.fields || {};
if(res.ok && data.ok === true){
var dup = data.status === 'duplicate';
messengers(data.messenger);
showDone('api', dup ? 'Заявка уже у нас' : 'Заявка принята', data.lead_no || '',
data.message || (dup ? 'Повторно отправлять не нужно: номер заявки тот же.' : ''));
track('lead_accepted', { status: data.status || 'accepted', scenario: code || 'manual' });
rid = null;
return;
}
if(res.status === 422){
if(fields.service_code){
st('Эта позиция прайса обновилась. Выберите работу заново.', true);
code = null;
chosen = '';
paint();
setStep(1, true);
rid = newId();
return;
}
var map = { phone: 'lead-phone', name: 'lead-name', car: 'lead-car', service: 'lead-service', wish_time: 'lead-time', consent: 'lead-consent', consent_pd: 'lead-consent' };
var first = null;
Object.keys(fields).forEach(function(k){
if(!map[k]) return;
var c = fields[k];
var node = err(map[k], c === 'required' ? 'Заполните поле' : c === 'too_long' ? 'Слишком длинное значение' : 'Проверьте значение');
if(node && !first) first = node;
});
st(data.message || 'Проверьте выделенные поля и отправьте ещё раз.', true);
if(first) first.focus({ preventScroll: true });
track('form_error', { reason: 'validation' });
rid = newId();
return;
}
if(res.status === 429){
var wait = Number(data.retry_after) > 0 ? ' Повторить можно через ' + Number(data.retry_after) + ' с.' : '';
st((data.message || 'Слишком много заявок. Позвоните нам или попробуйте позже.') + wait, true, true);
track('form_error', { reason: 'rate_limit' });
return;
}
track('form_error', { reason: 'server' });
st('Не удалось отправить. Повторите или позвоните:', true, true);
}
function submitApi(){
if(!rid) rid = newId();
var ctrl = new AbortController(), timer = setTimeout(function( ){ ctrl.abort(); }, 15000);
var init = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload()), signal: ctrl.signal };
setBusy(true);
st('');
fetch(base + '/lead', init).then(function(r){
return r.json().catch(function( ){ return null; }).then(function(data ){ return { status: r.status, ok: r.ok, data: data }; });
}).then(function(res ){ clearTimeout(timer); setBusy(false); handle(res); })
.catch(function(){
clearTimeout(timer);
setBusy(false);
track('form_error', { reason: 'network' });
st('Не удалось отправить. Повторите или позвоните:', true, true);
});
}
F.addEventListener('submit', function(e){
e.preventDefault();
if(busy) return;
if(!checkStep()) return setStep(1, true);
if(step === 1) return setStep(2, true);
if(!checkContact()) return;
if(mode === 'api') submitApi(); else submitTransfer();
});
ok.addEventListener('change', function(){
if(ok.checked ){ ok.removeAttribute('aria-invalid'); err('lead-consent'); }
});
q('lead-again').addEventListener('click', function(){
F.reset();
['lead-service', 'lead-phone', 'lead-consent'].forEach(function(f ){ err(f); });
chosen = '';
code = null;
rid = null;
setChannel('');
F.hidden = false;
q('lead-done').hidden = true;
q('lead-check').classList.remove('is-on');
st('');
setBusy(false);
setStep(1, false);
toLead();
setTimeout(function( ){ F.querySelector('.chip').focus({ preventScroll: true }); }, less ? 0 : 320);
});
D.querySelectorAll('[data-form]').forEach(function(a){
a.addEventListener('click', function(){
if(F.hidden) return;
setChannel('');
setTimeout(function(){
var t = a.dataset.leadFocus === 'service' ? sIn : step === 1 ? F.querySelector('.chip') : pIn;
if(a.dataset.leadFocus === 'service' && step !== 1) setStep(1, false);
t.focus({ preventScroll: true });
}, less ? 0 : 420);
});
});
D.addEventListener('click', function(e){
var a = e.target.closest && e.target.closest('a[data-tel]');
if(a) track('tel_click', { src: a.dataset.tel });
});
var maxBtn = q('hero-max');
if(maxBtn) maxBtn.addEventListener('click', function(){
setChannel('max');
toLead();
setTimeout(function( ){
var t = step === 1 ? F.querySelector('.chip') : pIn;
if(t) t.focus({ preventScroll: true });
}, less ? 0 : 420);
});
initMode();
setStep(1, false);
})();
