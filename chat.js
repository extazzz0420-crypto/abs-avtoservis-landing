/**
 * АБС-Автосервис — чат с онлайн-администратором.
 *
 * Обычный ES-модуль без внешних зависимостей. Работает с публичным API:
 *   POST /api/abs/v1/chat            — сообщение клиента и ответы после него;
 *   GET  /api/abs/v1/chat/updates    — новые сообщения после last_id.
 *
 * chat_token и last_id живут в localStorage, история сообщений — в sessionStorage.
 * Опрос идёт только пока панель открыта и вкладка видима.
 */

const API_BASE = '/api/abs/v1';
const CONSENT_VERSION = 'site-chat-notice-v1';
const PHONE_DISPLAY = '8-937-085-48-88';
const PHONE_PLACEHOLDER = '+7 9__ ___-__-__';
const INPUT_PLACEHOLDER = 'Напишите сообщение…';
const POLL_INTERVAL_MS = 5000;
const HISTORY_LIMIT = 200;

const GREETING =
  'Здравствуйте! Напишите, что случилось с машиной или что нужно сделать — подскажу по услугам и ценам.';
const SUBTITLE_STAFF = 'На связи сотрудник';
const SUBTITLE_ASSISTANT = 'Отвечает онлайн-помощник, сложные вопросы передаёт мастеру';
const SUBTITLE_CLOSED = 'Сервис откроется в 8:00, ответим утром';
const SEND_ERROR = `Не удалось отправить. Позвоните: ${PHONE_DISPLAY}`;
const CHAT_RESET_NOTICE =
  'Сессия чата обновилась. Следующее сообщение начнёт новый диалог.';

const KEYS = {
  token: 'abs_chat_token',
  lastId: 'abs_chat_last_id',
  history: 'abs_chat_history',
  flags: 'abs_chat_flags',
};

/** Элементы виджета; заполняется в initChat. */
let ui = null;

const state = {
  open: false,
  token: '',
  lastId: '',
  messages: [],
  seen: new Set(),
  sending: false,
  pollTimer: 0,
  flags: {
    askPhone: false,
    operator: false,
    workingNow: null, // null — состояние ещё неизвестно
  },
  phoneSent: false,
};

const systemSeq = { value: 0 };

// ---------------------------------------------------------------------------
// утилиты
// ---------------------------------------------------------------------------

function byId(id) {
  return document.getElementById(id);
}

function storageGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    if (value === null || value === undefined) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // приватный режим или переполнение — чат продолжает работать без сохранения
  }
}

function makeClientMessageId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID().replace(/-/g, '');
  }
  let id = '';
  while (id.length < 32) {
    id += Math.random().toString(36).slice(2);
  }
  return id.slice(0, 32);
}

/** Похоже ли сообщение на номер телефона. */
function looksLikePhone(text) {
  const digits = text.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 && /^[+\d\s()\-–—]+$/.test(text);
}

function buildNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// рендер ленты
// ---------------------------------------------------------------------------

function buildMessageNode(item) {
  const wrap = buildNode('div', `chat-msg chat-msg--${item.author}`);
  wrap.dataset.key = item.key;
  if (item.author === 'user') {
    if (item.status === 'failed') wrap.classList.add('is-failed');
    if (item.status === 'sending') wrap.classList.add('is-sending');
  }

  // Только textContent: сервер присылает простой текст, а не HTML.
  wrap.append(buildNode('div', 'chat-bubble', item.text));

  if (item.author === 'user') {
    const meta = buildNode('p', 'chat-msg-meta', 'не отправлено');
    meta.hidden = item.status !== 'failed';
    wrap.append(meta);
  }

  return wrap;
}

function scrollLogToEnd() {
  if (!ui) return;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function saveHistory() {
  const items = state.messages.slice(-HISTORY_LIMIT).map((item) => {
    const plain = { key: item.key, author: item.author, text: item.text };
    if (item.author === 'user') {
      // Незавершённую отправку после перезагрузки считаем отправленной:
      // повторить её уже нельзя, а историю показываем как есть.
      plain.status = item.status === 'failed' ? 'failed' : 'sent';
    }
    return plain;
  });
  storageSet(sessionStorage, KEYS.history, JSON.stringify(items));
}

function addMessage(item) {
  state.seen.add(item.key);
  state.messages.push(item);
  ui.log.append(buildMessageNode(item));
  saveHistory();
  scrollLogToEnd();
}

function addGreeting() {
  addMessage({ key: 'local:greeting', author: 'bot', text: GREETING });
}

function addSystemNotice(text) {
  systemSeq.value += 1;
  addMessage({
    key: `local:sys:${Date.now()}:${systemSeq.value}`,
    author: 'system',
    text,
  });
}

function setUserStatus(clientId, status) {
  const key = `local:${clientId}`;
  const item = state.messages.find((entry) => entry.key === key);
  if (item && item.author === 'user') item.status = status;

  const node = ui.log.querySelector(`[data-key="${key}"]`);
  if (node) {
    node.classList.toggle('is-failed', status === 'failed');
    node.classList.toggle('is-sending', status === 'sending');
    const meta = node.querySelector('.chat-msg-meta');
    if (meta) meta.hidden = status !== 'failed';
  }
  saveHistory();
}

/** Добавляет сообщения сервера, пропуская уже показанные (по id). */
function applyMessages(list) {
  if (!Array.isArray(list)) return;

  let added = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.id === null || raw.id === undefined) continue;
    const key = `srv:${String(raw.id)}`;
    if (state.seen.has(key)) continue;

    const author = raw.author === 'staff' ? 'staff' : 'bot';
    const item = {
      key,
      author,
      text: typeof raw.text === 'string' ? raw.text : String(raw.text ?? ''),
    };
    state.seen.add(key);
    state.messages.push(item);
    ui.log.append(buildMessageNode(item));
    if (author === 'staff' && !state.flags.operator) {
      state.flags.operator = true;
      storageSet(sessionStorage, KEYS.flags, JSON.stringify(state.flags));
    }
    added += 1;
  }

  if (added > 0) {
    saveHistory();
    updateSubtitle();
    updateAskPhone();
    if (state.open) scrollLogToEnd();
  }
}

function applyFlags(data) {
  let changed = false;

  if (typeof data.ask_phone === 'boolean' && data.ask_phone !== state.flags.askPhone) {
    state.flags.askPhone = data.ask_phone;
    changed = true;
  }
  if (typeof data.operator === 'boolean' && data.operator !== state.flags.operator) {
    state.flags.operator = data.operator;
    changed = true;
  }
  if (typeof data.working_now === 'boolean' && data.working_now !== state.flags.workingNow) {
    state.flags.workingNow = data.working_now;
    changed = true;
  }

  if (changed) {
    storageSet(sessionStorage, KEYS.flags, JSON.stringify(state.flags));
    updateSubtitle();
    updateAskPhone();
  }
}

function updateSubtitle() {
  const { operator, workingNow } = state.flags;
  let text = SUBTITLE_ASSISTANT;
  if (workingNow === false) text = SUBTITLE_CLOSED;
  else if (operator) text = SUBTITLE_STAFF;
  ui.subtitle.textContent = text;
}

function updateAskPhone() {
  ui.askPhone.hidden = !(state.flags.askPhone && !state.phoneSent);
}

function updateComposer() {
  ui.send.disabled = state.sending;
  ui.form.setAttribute('aria-busy', state.sending ? 'true' : 'false');
}

function showTyping() {
  if (!ui || ui.typing) return;

  const wrap = buildNode('div', 'chat-msg chat-msg--bot chat-typing');
  const bubble = buildNode('div', 'chat-bubble chat-bubble--typing');

  const dots = buildNode('span', 'chat-typing-dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) dots.append(buildNode('span', 'chat-typing-dot'));

  bubble.append(dots, buildNode('span', 'chat-typing-label', 'печатает…'));
  wrap.append(bubble);
  ui.log.append(wrap);
  ui.typing = wrap;
  scrollLogToEnd();
}

function hideTyping() {
  if (!ui || !ui.typing) return;
  ui.typing.remove();
  ui.typing = null;
}

// ---------------------------------------------------------------------------
// ошибки отправки
// ---------------------------------------------------------------------------

function errorDetail(response, data) {
  if (!response) return 'Проверьте соединение и попробуйте ещё раз.';

  if (response.status === 422) {
    return (data && typeof data.message === 'string' && data.message) || 'Проверьте сообщение.';
  }
  if (response.status === 429) {
    const retryAfter = data && Number.isFinite(Number(data.retry_after)) ? Number(data.retry_after) : 0;
    const wait = retryAfter > 0 ? ` Повторить можно через ${retryAfter} с.` : '';
    const message =
      (data && typeof data.message === 'string' && data.message) ||
      'Слишком много сообщений. Попробуйте позже.';
    return `${message}${wait}`;
  }
  if (response.status >= 500) {
    return (
      (data && typeof data.message === 'string' && data.message) ||
      'Сервис временно недоступен. Попробуйте ещё раз чуть позже.'
    );
  }
  return null;
}

function addSendError(clientId, text, response, data) {
  const wrap = buildNode('div', 'chat-msg chat-msg--error');
  const bubble = buildNode('div', 'chat-bubble chat-bubble--error');

  bubble.append(buildNode('p', 'chat-error-title', SEND_ERROR));
  const detail = errorDetail(response, data);
  if (detail) bubble.append(buildNode('p', 'chat-error-detail', detail));

  const retry = buildNode('button', 'btn btn-secondary chat-retry', 'Повторить');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    wrap.remove();
    retrySend(clientId, text);
  });
  bubble.append(retry);
  wrap.append(bubble);
  ui.log.append(wrap);
  scrollLogToEnd();
}

/** Тот же текст с тем же client_message_id — сервер не создаст дубль. */
function retrySend(clientId, text) {
  if (state.sending) return;
  setUserStatus(clientId, 'sending');
  void sendMessage(text, clientId);
}

// ---------------------------------------------------------------------------
// отправка
// ---------------------------------------------------------------------------

function appendUserMessage(text, clientId) {
  addMessage({ key: `local:${clientId}`, author: 'user', text, status: 'sending' });
}

async function sendMessage(text, clientId) {
  if (state.sending) return;

  state.sending = true;
  updateComposer();
  showTyping();

  const body = {
    message: text,
    client_message_id: clientId,
    page: window.location.pathname.slice(0, 300),
    consent_version: CONSENT_VERSION,
  };
  if (state.token) body.chat_token = state.token;

  let response = null;
  let data = null;
  try {
    response = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    data = await response.json().catch(() => null);
  } catch {
    response = null;
    data = null;
  }

  state.sending = false;
  updateComposer();
  hideTyping();

  if (response && response.ok && data && data.ok === true) {
    applyServerData(data);
    setUserStatus(clientId, 'sent');
    if (looksLikePhone(text)) {
      state.phoneSent = true;
      updateAskPhone();
      ui.input.placeholder = INPUT_PLACEHOLDER;
    }
    return;
  }

  // Неизвестный чат: сервер обычно сам начинает новый, но если токен
  // забракован валидацией — забываем его, чтобы повтор создал новый диалог.
  if (response && response.status === 422 && data && data.fields && data.fields.chat_token) {
    forgetChatSession();
  }

  setUserStatus(clientId, 'failed');
  addSendError(clientId, text, response, data);
}

/**
 * last_id только растёт: запоздавший ответ опроса не должен откатить его назад.
 */
function updateLastId(value) {
  if (value === null || value === undefined) return;
  const next = String(value);
  if (!/^\d+$/.test(next)) return;

  const current = /^\d+$/.test(state.lastId) ? BigInt(state.lastId) : -1n;
  if (BigInt(next) <= current) return;

  state.lastId = next;
  storageSet(localStorage, KEYS.lastId, next);
}

function applyServerData(data) {
  if (typeof data.chat_token === 'string' && data.chat_token) {
    state.token = data.chat_token;
    storageSet(localStorage, KEYS.token, state.token);
  }
  updateLastId(data.last_id);
  applyFlags(data);
  applyMessages(data.messages);
  schedulePoll();
}

// ---------------------------------------------------------------------------
// опрос обновлений
// ---------------------------------------------------------------------------

function isPollingAllowed() {
  return state.open && document.visibilityState === 'visible' && state.token !== '';
}

function stopPolling() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = 0;
  }
}

function schedulePoll() {
  stopPolling();
  if (!isPollingAllowed()) return;
  state.pollTimer = window.setTimeout(pollTick, POLL_INTERVAL_MS);
}

async function pollUpdates() {
  const token = state.token;
  if (!token) return;

  const url = `${API_BASE}/chat/updates?chat_token=${encodeURIComponent(token)}&after=${encodeURIComponent(
    state.lastId || '0',
  )}`;

  let response = null;
  let data = null;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
    data = await response.json().catch(() => null);
  } catch {
    return; // сеть пропала — следующий тик попробует снова
  }

  if (response.status === 404) {
    // Диалога больше нет: начинаем чат заново при следующем сообщении.
    forgetChatSession();
    addSystemNotice(CHAT_RESET_NOTICE);
    return;
  }

  if (!response.ok || !data || data.ok !== true) return;

  if (typeof data.chat_token === 'string' && data.chat_token) {
    state.token = data.chat_token;
    storageSet(localStorage, KEYS.token, state.token);
  }
  updateLastId(data.last_id);
  applyFlags(data);
  applyMessages(data.messages);
}

async function pollTick() {
  state.pollTimer = 0;
  if (!isPollingAllowed()) return;
  if (!state.sending) await pollUpdates();
  // Пока шёл запрос, панель могли закрыть — schedulePoll это проверит.
  schedulePoll();
}

function forgetChatSession() {
  state.token = '';
  state.lastId = '';
  storageSet(localStorage, KEYS.token, null);
  storageSet(localStorage, KEYS.lastId, null);
  schedulePoll(); // токена нет — опрос остановится
}

// ---------------------------------------------------------------------------
// панель
// ---------------------------------------------------------------------------

function openPanel() {
  if (state.open) return;
  state.open = true;
  ui.panel.hidden = false;
  ui.root.classList.add('is-open');
  ui.toggle.setAttribute('aria-expanded', 'true');
  updateSubtitle();
  updateAskPhone();
  resizeInput();
  scrollLogToEnd();
  schedulePoll();
  ui.input.focus({ preventScroll: true });
}

function closePanel() {
  if (!state.open) return;
  state.open = false;
  ui.panel.hidden = true;
  ui.root.classList.remove('is-open');
  ui.toggle.setAttribute('aria-expanded', 'false');
  stopPolling();
  ui.toggle.focus({ preventScroll: true });
}

function resizeInput() {
  if (!ui) return;
  if (!state.open) {
    // Панель скрыта: высоту посчитаем при открытии.
    ui.input.style.height = '';
    return;
  }
  ui.input.style.height = 'auto';
  ui.input.style.height = `${Math.min(ui.input.scrollHeight || 0, 132)}px`;
}

// ---------------------------------------------------------------------------
// ввод
// ---------------------------------------------------------------------------

function submitComposer() {
  if (state.sending) return;

  const text = ui.input.value.replace(/\r\n/g, '\n').trim();
  if (text === '') return;

  const message = text.slice(0, 1000);
  const clientId = makeClientMessageId();

  ui.input.value = '';
  resizeInput();
  appendUserMessage(message, clientId);
  void sendMessage(message, clientId);
}

// ---------------------------------------------------------------------------
// инициализация
// ---------------------------------------------------------------------------

function restoreHistory() {
  const raw = storageGet(sessionStorage, KEYS.history);
  let items = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  }

  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    if (!['bot', 'staff', 'user', 'system'].includes(entry.author)) continue;
    if (typeof entry.text !== 'string' || typeof entry.key !== 'string') continue;
    if (state.seen.has(entry.key)) continue;

    const item = { key: entry.key, author: entry.author, text: entry.text };
    if (entry.author === 'user') {
      item.status = entry.status === 'failed' ? 'failed' : 'sent';
    }
    state.seen.add(item.key);
    state.messages.push(item);
    ui.log.append(buildMessageNode(item));
  }

  if (state.messages.length === 0) addGreeting();
  state.phoneSent = state.messages.some(
    (item) => item.author === 'user' && looksLikePhone(item.text),
  );
}

function loadFlags() {
  const raw = storageGet(sessionStorage, KEYS.flags);
  if (!raw) return;
  try {
    const flags = JSON.parse(raw);
    if (!flags || typeof flags !== 'object') return;
    if (typeof flags.askPhone === 'boolean') state.flags.askPhone = flags.askPhone;
    if (typeof flags.operator === 'boolean') state.flags.operator = flags.operator;
    if (typeof flags.workingNow === 'boolean') state.flags.workingNow = flags.workingNow;
  } catch {
    // битое значение — начинаем с состояния по умолчанию
  }
}

function wireEvents() {
  ui.toggle.addEventListener('click', () => {
    if (state.open) closePanel();
    else openPanel();
  });

  ui.close.addEventListener('click', () => {
    closePanel();
  });

  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitComposer();
  });

  ui.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (state.sending) return;
    submitComposer();
  });

  ui.input.addEventListener('input', () => {
    resizeInput();
  });

  ui.askPhoneBtn.addEventListener('click', () => {
    ui.input.placeholder = PHONE_PLACEHOLDER;
    ui.input.focus({ preventScroll: true });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      event.stopPropagation();
      closePanel();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!state.open) return;
    if (document.visibilityState === 'visible') schedulePoll();
    else stopPolling();
  });
}

/**
 * Подключает виджет к разметке страницы. Вызывается один раз из app.js.
 */
export function initChat() {
  const root = byId('chat-widget');
  if (!root) return;

  ui = {
    root,
    panel: byId('chat-panel'),
    toggle: byId('chat-toggle'),
    close: byId('chat-close'),
    log: byId('chat-log'),
    subtitle: byId('chat-subtitle'),
    askPhone: byId('chat-ask-phone'),
    askPhoneBtn: byId('chat-ask-phone-btn'),
    form: byId('chat-form'),
    input: byId('chat-input'),
    send: byId('chat-send'),
    typing: null,
  };
  if (!ui.panel || !ui.toggle || !ui.log || !ui.form || !ui.input || !ui.send) return;

  // Битые значения из прошлых версий не должны ломать первый запрос.
  const storedToken = storageGet(localStorage, KEYS.token) || '';
  state.token = /^[A-Za-z0-9_-]{20,64}$/.test(storedToken) ? storedToken : '';
  const storedLastId = storageGet(localStorage, KEYS.lastId) || '';
  state.lastId = /^\d+$/.test(storedLastId) ? storedLastId : '';

  if (!state.token) {
    // Токен негодный — диалога нет, его last_id тоже не нужен.
    state.lastId = '';
    if (storedToken) storageSet(localStorage, KEYS.token, null);
    if (storedLastId) storageSet(localStorage, KEYS.lastId, null);
  } else if (!state.lastId && storedLastId) {
    storageSet(localStorage, KEYS.lastId, null);
  }

  loadFlags();
  restoreHistory();
  updateSubtitle();
  updateAskPhone();
  updateComposer();
  resizeInput();

  wireEvents();
}
