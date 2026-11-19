const API_BASE = '/api/abs/v1';
const CONSENT_TEXT_VERSION = 'site-consent-v1';
const PHONE_DISPLAY = '8-937-085-48-88';

const byId = (id) => document.getElementById(id);
const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const form = byId('lead-form');
const serviceInput = byId('service');
const options = Array.from(document.querySelectorAll('.situation-option'));
let selectedCode = null;
let pendingRequestId = null;

window.dataLayer = window.dataLayer || [];

function track(event, properties = {}) {
  // Local only: no network analytics and no personal/form field data.
  window.dataLayer.push({ event, ...properties });
}

function makeRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID().replace(/-/g, '');
  }
  let id = '';
  while (id.length < 32) id += Math.random().toString(36).slice(2);
  return id.slice(0, 32);
}

function cleanText(value, maxLength) {
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function readAttribution() {
  const params = new URLSearchParams(window.location.search);
  const utm = {};
  for (const [key, value] of params.entries()) {
    if (key.startsWith('utm_') && value.trim()) utm[key] = value.trim().slice(0, 300);
  }
  const refValue = params.get('ref');
  const ref = refValue && /^[A-Za-z0-9_-]{4,32}$/.test(refValue) ? refValue : null;
  return { utm, ref };
}

function clearFieldError(input) {
  if (!(input instanceof HTMLElement)) return;
  input.removeAttribute('aria-invalid');
  const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/);
  for (const id of ids) {
    const node = byId(id);
    if (node && node.classList.contains('field-error')) {
      node.textContent = '';
      node.hidden = true;
    }
  }
}

function showFieldError(field, message) {
  const input = byId(field);
  const error = byId(`${field}-error`);
  if (!input || !error) return null;
  input.setAttribute('aria-invalid', 'true');
  error.textContent = message;
  error.hidden = false;
  return input;
}

function clearErrors() {
  for (const input of form.querySelectorAll('input')) clearFieldError(input);
}

function resetSelection(clearService = true) {
  selectedCode = null;
  for (const option of options) option.setAttribute('aria-pressed', 'false');
  byId('route-selection').hidden = true;
  byId('route-continue').hidden = true;
  if (clearService) {
    serviceInput.value = '';
    clearFieldError(serviceInput);
  }
}

function selectSituation(option) {
  const service = option.dataset.service || '';
  selectedCode = option.dataset.code || null;
  for (const item of options) item.setAttribute('aria-pressed', String(item === option));
  serviceInput.value = service;
  clearFieldError(serviceInput);
  byId('route-selection-text').textContent = service;
  byId('route-selection').hidden = false;
  byId('route-continue').hidden = false;
  track('service_select', { code: selectedCode, block: 'situations' });
}

for (const option of options) {
  option.addEventListener('click', () => selectSituation(option));
}

byId('route-clear').addEventListener('click', () => {
  resetSelection();
  options[0].focus({ preventScroll: true });
});

serviceInput.addEventListener('input', () => {
  const selected = options.find((option) => option.getAttribute('aria-pressed') === 'true');
  if (selected && serviceInput.value !== selected.dataset.service) resetSelection(false);
});

for (const link of document.querySelectorAll('[data-phone-click]')) {
  link.addEventListener('click', () => {
    track('phone_click', { block: link.dataset.phoneClick || 'unknown', page: window.location.pathname });
  });
}

function buildPayload() {
  const { utm, ref } = readAttribution();
  const payload = {
    client_request_id: pendingRequestId,
    kind: 'booking',
    phone: byId('phone').value.trim(),
    name: cleanText(byId('name').value, 80),
    car: cleanText(byId('car').value, 120),
    service: cleanText(serviceInput.value, 120),
    wish_time: cleanText(byId('wish-time').value, 80),
    page: window.location.pathname.slice(0, 300),
    consent: {
      pd: byId('consent-pd').checked,
      ads: false,
      text_version: CONSENT_TEXT_VERSION,
    },
    website: byId('website').value,
  };
  if (Object.keys(utm).length) payload.utm = utm;
  if (ref) payload.ref = ref;
  return payload;
}

function setStatus(message, kind = '', withPhone = false) {
  const status = byId('form-status');
  status.className = `form-status${kind ? ` is-${kind}` : ''}`;
  status.replaceChildren(document.createTextNode(message));
  if (withPhone) {
    const link = document.createElement('a');
    link.href = 'tel:+79370854888';
    link.textContent = PHONE_DISPLAY;
    link.dataset.phoneClick = 'form-error';
    link.addEventListener('click', () => track('phone_click', { block: 'form-error', page: window.location.pathname }));
    status.append(document.createTextNode(' '), link);
  }
}

function setSubmitting(isSubmitting) {
  byId('submit-button').disabled = isSubmitting;
  byId('submit-button').querySelector('span').textContent = isSubmitting ? 'Отправляем…' : 'Отправить заявку';
  form.setAttribute('aria-busy', String(isSubmitting));
}

function validate(payload) {
  clearErrors();
  const invalid = [];
  if (!payload.service) invalid.push(showFieldError('service', 'Выберите ситуацию или коротко опишите работу'));
  const digits = payload.phone.replace(/\D/g, '');
  if (!payload.phone) invalid.push(showFieldError('phone', 'Укажите телефон'));
  else if (!/^[78]?\d{10}$/.test(digits)) invalid.push(showFieldError('phone', 'Проверьте российский номер телефона'));
  if (!payload.consent.pd) invalid.push(showFieldError('consent-pd', 'Нужно согласие на обработку данных'));
  const targets = invalid.filter(Boolean);
  if (targets.length) {
    setStatus('Проверьте выделенные поля.', 'error');
    targets[0].focus({ preventScroll: true });
    targets[0].scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    return false;
  }
  return true;
}

function applyServerErrors(fields) {
  const targets = [];
  for (const [key, code] of Object.entries(fields || {})) {
    const normalized = key.startsWith('consent') ? 'consent-pd' : key;
    const message = code === 'required' ? 'Заполните поле' : code === 'too_long' ? 'Слишком длинное значение' : 'Проверьте значение';
    const target = showFieldError(normalized, message);
    if (target) targets.push(target);
  }
  if (targets.length) targets[0].focus({ preventScroll: true });
}

function safeMessengerUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function renderMessengers(messenger) {
  const block = byId('messenger-block');
  const actions = byId('messenger-actions');
  actions.replaceChildren();
  block.hidden = true;
  if (!messenger || typeof messenger !== 'object') return;

  // MAX first when the server really provides it; unavailable channels are omitted.
  const channels = [
    { key: 'max_url', label: 'Продолжить в MAX', channel: 'max' },
    { key: 'telegram_url', label: 'Продолжить в Telegram', channel: 'telegram' },
  ];
  for (const item of channels) {
    const href = safeMessengerUrl(messenger[item.key]);
    if (!href) continue;
    const link = document.createElement('a');
    link.className = `button ${actions.childElementCount ? 'button-secondary' : 'button-primary'}`;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = item.label;
    link.addEventListener('click', () => track('messenger_click', { channel: item.channel, entry: 'booking' }));
    actions.append(link);
  }
  block.hidden = actions.childElementCount === 0;
}

function showSuccess(data) {
  byId('success-message').textContent = data.message || 'Заявка принята. Продолжите в доступном мессенджере или дождитесь подтверждения приёмщика.';
  const leadNo = byId('success-lead-no');
  if (data.lead_no) {
    leadNo.textContent = `Номер заявки: ${data.lead_no}`;
    leadNo.hidden = false;
  } else {
    leadNo.hidden = true;
  }
  renderMessengers(data.messenger);
  form.hidden = true;
  const success = byId('lead-success');
  success.hidden = false;
  success.focus({ preventScroll: true });
  success.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  track('lead_accepted', { kind: 'booking', status: data.status || 'accepted', scenario: selectedCode || 'manual' });
}

async function handleSubmit(event) {
  event.preventDefault();
  if (byId('submit-button').disabled) return;
  if (!pendingRequestId) pendingRequestId = makeRequestId();
  const payload = buildPayload();
  if (!validate(payload)) return;

  track('lead_submit', { kind: 'booking', code: selectedCode || 'manual', page: window.location.pathname });
  setSubmitting(true);
  setStatus('');

  let response = null;
  let data = null;
  try {
    response = await fetch(`${API_BASE}/lead`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await response.json().catch(() => null);
  } catch {
    response = null;
  }

  setSubmitting(false);

  if (response && response.ok && data && data.ok === true) {
    showSuccess(data);
    form.reset();
    clearErrors();
    pendingRequestId = null;
    return;
  }

  if (response && response.status === 422) {
    applyServerErrors(data && data.fields);
    setStatus((data && data.message) || 'Проверьте выделенные поля и отправьте ещё раз.', 'error');
    pendingRequestId = makeRequestId();
    return;
  }

  if (response && response.status === 429) {
    const seconds = data && Number.isFinite(Number(data.retry_after)) ? Number(data.retry_after) : 0;
    const wait = seconds > 0 ? ` Повторить можно через ${seconds} с.` : '';
    setStatus(`${(data && data.message) || 'Слишком много заявок. Попробуйте позже.'}${wait}`, 'error', true);
    return;
  }

  // Network/proxy/5xx: retain every field and reuse the same request ID on retry.
  setStatus('Не удалось отправить. Повторите или позвоните:', 'error', true);
}

form.addEventListener('submit', (event) => void handleSubmit(event));
form.addEventListener('input', (event) => clearFieldError(event.target));

// Focus events avoid a global :has() invalidation and keep fixed actions away from keyboards.
const updateInputFocus = () => {
  const active = document.activeElement;
  document.body.classList.toggle('input-focus', Boolean(active && active.matches('input, textarea')));
};
document.addEventListener('focusin', updateInputFocus);
document.addEventListener('focusout', () => requestAnimationFrame(updateInputFocus));

const chatToggle = byId('chat-toggle');
let chatInitialized = false;
let chatPromise = null;
let syntheticChatOpen = false;
const chatLabel = chatToggle.textContent;

chatToggle.addEventListener('click', async () => {
  const isOpening = chatToggle.getAttribute('aria-expanded') !== 'true';

  if (chatInitialized) {
    if (isOpening && !syntheticChatOpen) track('chat_open', { block: 'hero', scenario: 'question' });
    syntheticChatOpen = false;
    return;
  }

  // The existing chat module is loaded only when the visitor asks for it.
  chatToggle.disabled = true;
  chatToggle.setAttribute('aria-busy', 'true');
  chatToggle.textContent = 'Открываем помощника…';
  track('chat_open', { block: 'hero', scenario: 'question' });
  try {
    if (!chatPromise) chatPromise = import('./chat.js');
    const { initChat } = await chatPromise;
    initChat();
    chatInitialized = true;
    chatToggle.disabled = false;
    chatToggle.setAttribute('aria-busy', 'false');
    chatToggle.textContent = chatLabel;
    syntheticChatOpen = true;
    chatToggle.click();
  } catch {
    chatPromise = null;
    chatToggle.disabled = false;
    chatToggle.setAttribute('aria-busy', 'false');
    chatToggle.textContent = `Чат недоступен — позвоните ${PHONE_DISPLAY}`;
  }
});

// The mobile recovery bar appears only when the main CTA is no longer visible.
// It also yields to the actual booking form instead of duplicating its action.
const mobileActions = document.querySelector('.mobile-actions');
const heroBookingLink = document.querySelector('.hero-actions [data-booking-link]');
const bookingSection = byId('booking');
if ('IntersectionObserver' in window && heroBookingLink && mobileActions) {
  let heroActionVisible = true;
  let bookingVisible = false;
  const updateMobileActions = () => {
    mobileActions.classList.toggle('is-visible', !heroActionVisible && !bookingVisible);
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === heroBookingLink) heroActionVisible = entry.isIntersecting;
      if (entry.target === bookingSection) bookingVisible = entry.isIntersecting;
    }
    updateMobileActions();
  }, { threshold: 0.01 });
  observer.observe(heroBookingLink);
  observer.observe(bookingSection);
} else if (mobileActions) {
  mobileActions.classList.add('is-visible');
}
