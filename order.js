/* Карточка заказа по ссылке из сообщения.
   Токен — 32 hex из ?t=, других прав он не даёт.
   Данные: GET /api/abs/v1/order/<token>, ответы — как в contracts/site-api.openapi.yaml. */
(() => {
  'use strict';

  const API = '/api/abs/v1';
  const TOKEN_RE = /^[0-9a-fA-F]{32}$/;
  const POLL_MS = 30000;
  const TZ = 'Europe/Volgograd';

  const $ = (id) => document.getElementById(id);
  const fmtMoney = (n) =>
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + '\u00a0₽';
  const fmtTime = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ,
    }).format(d).replace(',', '');
  };
  const fmtClock = () =>
    new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date());
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };

  /** Создать элемент: текст только через textContent, никакого innerHTML с данными API. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value; // только доверенная разметка из этого файла
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const state = { token: null, order: null, lastOk: null, polling: false, pollTimer: null, busy: false };

  /* ── Состояния страницы ─────────────────────────────────────────── */

  function clearState() {
    const box = $('state');
    box.textContent = '';
    box.hidden = true;
    box.className = 'order-state';
  }

  function showState({ title, text, action, soft = false, keepData = false }) {
    const box = $('state');
    box.className = 'order-state' + (soft ? ' order-state--soft' : '');
    box.textContent = '';
    box.append(el('h2', { text: title }), el('p', { text }));
    if (action) {
      const btn = el('button', {
        class: 'btn btn--ghost btn--small', type: 'button', text: action.label,
        onclick: action.onClick,
      });
      box.append(btn);
    }
    box.hidden = false;
    if (!keepData) {
      $('card').hidden = true;
      $('skeleton').hidden = true;
    }
  }

  function setSkeleton(on) {
    $('skeleton').hidden = !on;
    document.getElementById('order').setAttribute('aria-busy', on ? 'true' : 'false');
  }

  const CALL_LINK = () => $('company-phone').getAttribute('href');
  const CALL_TEXT = () => $('company-phone').textContent.trim();

  /* ── Загрузка ───────────────────────────────────────────────────── */

  async function load({ silent = false } = {}) {
    if (state.busy) return;
    state.busy = true;
    if (!state.order && !silent) setSkeleton(true);

    try {
      const res = await fetch(`${API}/order/${state.token}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => null);

      if (res.ok && body && body.ok) {
        state.order = body;
        state.lastOk = new Date();
        clearState();
        setSkeleton(false);
        render(body);
        startPolling();
        return;
      }

      const error = (body && body.error) || `http_${res.status}`;

      if (res.status === 404) {
        showState({
          title: 'Заказ не найден',
          text: `Ссылка могла устареть. Позвоните — найдём заказ по номеру телефона: ${CALL_TEXT()}.`,
          action: { label: 'Позвонить', onClick: () => { location.href = CALL_LINK(); } },
        });
        stopPolling();
        return;
      }

      if (res.status === 429) {
        const wait = Number(body && body.retry_after) || 30;
        retryLater(wait, 'Слишком много запросов', (body && body.message) || 'Попробуйте через минуту — данные не потеряются.');
        return;
      }

      networkError((body && body.message) || 'Не удалось загрузить заказ.', error);
    } catch (err) {
      networkError('Нет связи. Проверьте интернет — данные обновятся сами.', String(err));
    } finally {
      state.busy = false;
    }
  }

  function networkError(message, code) {
    setSkeleton(false);
    if (state.order) {
      showState({
        title: 'Не удалось обновить',
        text: `${message} Показаны данные на ${fmtTime(state.lastOk.toISOString())}.`,
        soft: true,
        keepData: true,
        action: { label: 'Обновить', onClick: () => load({ silent: true }) },
      });
      $('card').hidden = false;
    } else {
      showState({
        title: 'Заказ не открылся',
        text: `${message} Позвоните: ${CALL_TEXT()}.`,
        action: { label: 'Обновить', onClick: () => load() },
      });
    }
    if (code === 'upstream_unavailable' || code === 'internal_error') stopPolling();
  }

  function retryLater(seconds, title, text) {
    setSkeleton(false);
    let left = Math.max(1, Math.round(seconds));
    const btn = { label: `Обновить через ${left} с`, onClick: null, el: null };
    showState({
      title,
      text,
      soft: Boolean(state.order),
      keepData: Boolean(state.order),
      action: {
        label: btn.label,
        onClick: () => {
          if (btn.el && btn.el.disabled) return;
          load({ silent: true });
        },
      },
    });
    btn.el = $('state').querySelector('button');
    if (btn.el) btn.el.disabled = true;
    const tick = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(tick);
        if (btn.el) {
          btn.el.disabled = false;
          btn.el.textContent = 'Обновить сейчас';
        }
        return;
      }
      if (btn.el) btn.el.textContent = `Обновить через ${left} с`;
    }, 1000);
    if (state.order) $('card').hidden = false;
  }

  function startPolling() {
    if (state.polling) return;
    state.polling = true;
    state.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true });
    }, POLL_MS);
  }

  function stopPolling() {
    state.polling = false;
    clearInterval(state.pollTimer);
  }

  /* ── Отрисовка карточки ─────────────────────────────────────────── */

  function render(data) {
    const order = data.order || {};
    $('card').hidden = false;

    $('order-no').textContent = order.no ? `Заказ ${order.no}` : 'Заказ';
    $('status-word').textContent = order.status_label || 'Заказ';
    const tone = ['ready', 'done'].includes(order.status)
      ? 'ok'
      : ['cancelled', 'no_show'].includes(order.status) ? 'muted' : 'accent';
    $('status-mark').dataset.tone = tone;
    $('steps').dataset.tone = tone;

    const meta = $('order-meta');
    meta.textContent = '';
    [order.scheduled_text, order.car, order.service]
      .filter(Boolean)
      .forEach((value) => meta.append(el('span', { text: value })));
    meta.hidden = meta.childElementCount === 0;

    $('updated').textContent = `Обновлено в ${fmtClock()}`;
    $('updated').hidden = false;

    renderDecisions(data);
    renderSteps(data);
    renderPhotos(data);
    renderWarranty(data);
    renderMoney(data);
    renderFeedback(data);
    renderLinks(data);
    renderCompany(data);
  }

  function renderDecisions(data) {
    const block = $('decisions');
    const list = $('decisions-list');
    const approvals = Array.isArray(data.approvals) ? data.approvals.slice() : [];
    list.textContent = '';

    if (!approvals.length) {
      block.hidden = true;
      return;
    }

    approvals.sort((a, b) => {
      const rank = (x) => (x.can_answer ? 0 : 1);
      return rank(a) - rank(b) || (a.id || 0) - (b.id || 0);
    });

    const pending = approvals.filter((a) => a.can_answer).length;
    $('decisions-title').textContent = pending ? 'Нужно ваше решение' : 'Дополнительные работы';
    $('decisions-lead').textContent = pending === 1
      ? 'Мастер нашёл ещё одну работу. Скажите, делать ли её сейчас, — это одна кнопка.'
      : pending
        ? `Мастер нашёл ${pending} ${plural(pending, 'работу', 'работы', 'работ')}, которые стоит сделать сейчас. Одна кнопка — и мы поняли ваш ответ.`
        : 'Все дополнительные работы согласованы.';

    approvals.forEach((approval) => list.append(approvalCard(approval)));
    block.hidden = false;
  }

  function approvalCard(a) {
    const card = el('article', { class: 'decision', 'data-severity': a.severity || '', 'data-id': a.id });
    const top = el('div', { class: 'decision__top' }, [
      a.severity_label ? el('span', { class: 'decision__flag', text: a.severity_label }) : null,
      a.no ? el('span', { class: 'decision__no', text: a.no }) : null,
      typeof a.price === 'number' ? el('span', { class: 'decision__price', text: fmtMoney(a.price) }) : null,
    ]);
    card.append(top, el('h3', { class: 'decision__title', text: a.title || '' }));

    const photos = Array.isArray(a.photos) ? a.photos : [];
    if (photos.length) {
      const row = el('div', { class: 'decision__photos' });
      photos.forEach((p) => {
        row.append(el('a', { href: p.url, target: '_blank', rel: 'noopener', 'aria-label': 'Фото к работе' },
          el('img', { src: p.url, alt: a.title || 'Фото работы', loading: 'lazy', decoding: 'async', width: '72', height: '72' })));
      });
      card.append(row);
    }

    if (a.status === 'pending' && a.can_answer) {
      if (!a.can_defer && a.severity === 'critical') {
        card.append(el('p', { class: 'decision__warn', text: 'Важно для безопасности — отложить нельзя.' }));
      }
      const actions = el('div', { class: 'decision__actions' });
      actions.append(
        el('button', {
          class: 'btn btn--small', type: 'button',
          text: typeof a.price === 'number' ? `Согласен, ${fmtMoney(a.price)}` : 'Согласен',
          onclick: (e) => decide(a, 'approve', e.currentTarget),
        }),
        el('button', {
          class: 'btn btn--ghost btn--small', type: 'button', text: 'Отказаться',
          onclick: (e) => decide(a, 'decline', e.currentTarget),
        }),
      );
      if (a.can_defer) {
        const days = Number(a.defer_days) || 30;
        actions.append(el('button', {
          class: 'btn btn--link', type: 'button',
          text: `Отложить на ${days} ${plural(days, 'день', 'дня', 'дней')}`,
          onclick: (e) => decide(a, 'defer', e.currentTarget),
        }));
      }
      const status = el('p', { class: 'decision__status', role: 'status', 'aria-live': 'polite' });
      card.append(actions, status);
    } else {
      const settled = el('p', { class: 'decision__settled', 'data-status': a.status || '', text: settledText(a) });
      card.append(settled);
      card.classList.add('is-settled');
    }
    return card;
  }

  function settledText(a) {
    const via = { page: 'на сайте', telegram: 'в Telegram', phone: 'по телефону' }[a.decided_via] || '';
    const when = a.decided_at ? fmtTime(a.decided_at) : '';
    const base = a.status_label || 'Решение принято';
    const tail = [via, when].filter(Boolean).join(', ');
    return tail ? `${base} — ${tail}` : base;
  }

  async function decide(a, decision, button) {
    const card = button.closest('.decision');
    const status = card && card.querySelector('.decision__status');
    const buttons = card ? [...card.querySelectorAll('.decision__actions button')] : [];
    buttons.forEach((b) => { b.disabled = true; });
    if (status) { status.textContent = 'Отправляем…'; status.className = 'decision__status'; }

    try {
      const res = await fetch(`${API}/order/${state.token}/approvals/${a.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json().catch(() => null);

      if (res.ok && body && body.ok) {
        if (status) { status.textContent = body.message || 'Готово.'; status.classList.add('is-ok'); }
        setTimeout(() => load({ silent: true }), 700);
        return;
      }

      buttons.forEach((b) => { b.disabled = false; });
      if (status) {
        status.textContent = (body && body.message) || 'Не получилось. Попробуйте ещё раз или позвоните нам.';
        status.classList.add('is-error');
      }
      if (res.status === 409 && body && body.approval) {
        setTimeout(() => load({ silent: true }), 900);
      }
    } catch (err) {
      buttons.forEach((b) => { b.disabled = false; });
      if (status) {
        status.textContent = 'Нет связи. Позвоните — ответим сразу.';
        status.classList.add('is-error');
      }
    }
  }

  function renderSteps(data) {
    const list = $('steps');
    list.textContent = '';
    const order = data.order || {};
    const cancelled = ['cancelled', 'no_show'].includes(order.status);
    const steps = Array.isArray(data.steps) ? data.steps : [];

    if (cancelled) {
      list.append(el('li', { 'data-state': 'current' }, [
        el('span', { class: 'order-steps__label', text: order.status === 'no_show' ? 'Визит не состоялся' : 'Запись отменена' }),
        el('span', { class: 'order-steps__at', text: order.scheduled_text || '' }),
      ]));
    } else if (steps.length) {
      steps.forEach((s) => {
        list.append(el('li', { 'data-state': s.current ? 'current' : s.done ? 'done' : 'todo' }, [
          el('span', { class: 'order-steps__label', text: s.label || '' }),
          el('span', { class: 'order-steps__at', text: s.at ? fmtTime(s.at) : '' }),
        ]));
      });
    } else {
      list.append(el('li', { 'data-state': 'todo' }, el('span', { class: 'order-steps__label', text: 'Этапы появятся, когда заказ начнут вести' })));
    }

    const note = $('steps-note');
    if (cancelled) {
      note.textContent = 'Если отмена неожиданная — позвоните, разберёмся и вернём запись.';
      note.hidden = false;
    } else if (order.status === 'waiting_parts') {
      note.textContent = 'Ждём запчасти. Напишем, когда машина снова пойдёт в работу.';
      note.hidden = false;
    } else {
      note.hidden = true;
    }

    const events = $('events');
    const eventList = $('events-list');
    eventList.textContent = '';
    const timeline = Array.isArray(data.timeline) ? data.timeline : [];
    timeline.forEach((t) => {
      eventList.append(el('li', {}, [
        el('time', { datetime: t.at || '', text: t.at ? fmtTime(t.at) : '' }),
        el('span', { text: t.text || '' }),
      ]));
    });
    events.hidden = timeline.length < 2;
  }

  function renderPhotos(data) {
    const block = $('photos-block');
    const grid = $('photos');
    const files = (Array.isArray(data.files) ? data.files : []).filter((f) => f && f.url);
    grid.textContent = '';
    if (!files.length) { block.hidden = true; return; }

    files.forEach((f) => {
      const caption = f.caption ? el('figcaption', { text: f.caption }) : null;
      const link = el('a', {
        href: f.url, target: '_blank', rel: 'noopener',
        'aria-label': f.caption || 'Фото работ — открыть крупно',
      }, el('img', {
        src: f.url, alt: f.caption || 'Фото работ', loading: 'lazy', decoding: 'async',
      }));
      const figure = el('figure', { class: 'photos__item' }, [link, caption]);
      figure.style.margin = '0';
      figure.style.display = 'grid';
      figure.style.gap = '0.35rem';
      grid.append(figure);
    });
    block.hidden = false;
  }

  function renderWarranty(data) {
    const block = $('warranty-block');
    const w = data.warranty;
    const lines = w && Array.isArray(w.lines) ? w.lines.filter(Boolean) : [];
    if (!w || (!lines.length && !w.text)) { block.hidden = true; return; }
    $('warranty-from').textContent = w.from ? `С ${w.from}` : '';
    $('warranty-from').hidden = !w.from;
    const list = $('warranty-lines');
    list.textContent = '';
    lines.forEach((line) => list.append(el('li', { text: line })));
    $('warranty-text').textContent = w.text || '';
    $('warranty-text').hidden = !w.text;
    block.hidden = false;
  }

  function renderMoney(data) {
    const order = data.order || {};
    const rows = $('money-rows');
    rows.textContent = '';

    if (typeof order.amount_total === 'number') {
      rows.append(el('div', { class: 'money__row' }, [
        el('dt', { text: 'Работы и запчасти' }), el('dd', { text: fmtMoney(order.amount_total) }),
      ]));
    }
    if (typeof order.bonus_redeemed === 'number' && order.bonus_redeemed > 0) {
      rows.append(el('div', { class: 'money__row' }, [
        el('dt', { text: 'Бонусы' }), el('dd', { text: `−${fmtMoney(order.bonus_redeemed)}` }),
      ]));
    }

    const total = $('money-total');
    const note = $('money-note');
    if (typeof order.to_pay === 'number') {
      total.textContent = fmtMoney(order.to_pay);
      note.hidden = true;
    } else {
      total.textContent = 'Уточняется';
      note.textContent = 'Сумму назовём, когда посчитаем работы, — до того, как их начнём.';
      note.hidden = false;
    }
  }

  function renderFeedback(data) {
    const block = $('feedback-block');
    const fb = data.feedback || {};
    const form = $('rating');
    const done = $('rating-done');
    const score = typeof fb.score === 'number' ? fb.score : null;

    if (score) {
      block.hidden = false;
      form.hidden = true;
      done.hidden = false;
      $('feedback-lead').textContent = 'Спасибо, оценка сохранена.';
      $('rating-done-text').textContent = `Вы поставили ${score} из 5.`;
      return;
    }
    if (!fb.can_rate) { block.hidden = true; return; }

    block.hidden = false;
    form.hidden = false;
    done.hidden = true;
    $('feedback-lead').textContent = 'Одна оценка — и мы знаем, что поправить.';
    buildStars();
    const comment = $('rating-comment');
    comment.value = '';
    updateCount();
    $('rating-status').textContent = '';
    $('rating-status').className = 'form-status';
  }

  function buildStars() {
    const wrap = $('rating-stars');
    if (wrap.childElementCount) return;
    const star = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z"/></svg>';
    for (let i = 5; i >= 1; i -= 1) {
      wrap.append(el('label', { class: 'rating__star' }, [
        el('input', { type: 'radio', name: 'score', value: String(i), 'aria-label': `${i} из 5` }),
        el('span', { html: star }),
      ]));
    }
    wrap.addEventListener('change', () => {
      $('rating-status').textContent = '';
      $('rating-status').className = 'form-status';
    });
  }

  function updateCount() {
    const t = $('rating-comment');
    $('rating-count').textContent = `${t.value.length} / 1000`;
  }

  async function submitRating(event) {
    event.preventDefault();
    const form = $('rating');
    const status = $('rating-status');
    const btn = $('rating-submit');
    const picked = form.querySelector('input[name="score"]:checked');

    if (!picked) {
      status.textContent = 'Поставьте оценку — от одной до пяти звёзд.';
      status.className = 'form-status is-error';
      form.querySelector('input[name="score"]')?.focus();
      return;
    }

    btn.disabled = true;
    status.textContent = 'Отправляем…';
    status.className = 'form-status';

    try {
      const res = await fetch(`${API}/order/${state.token}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ score: Number(picked.value), comment: $('rating-comment').value.trim() }),
      });
      const body = await res.json().catch(() => null);

      if (res.ok && body && body.ok) {
        form.hidden = true;
        $('rating-done').hidden = false;
        $('rating-done-text').textContent = body.message || 'Спасибо за оценку!';
        $('feedback-lead').textContent = '';
        $('feedback-lead').hidden = true;
        if (body.review_url) {
          const link = $('rating-review');
          link.href = body.review_url;
          link.hidden = false;
        }
        return;
      }

      btn.disabled = false;
      status.textContent = (body && body.message) || 'Не получилось отправить. Попробуйте ещё раз.';
      status.className = 'form-status is-error';
      if (res.status === 409) {
        form.hidden = true;
        $('rating-done').hidden = false;
        $('rating-done-text').textContent = status.textContent;
        setTimeout(() => load({ silent: true }), 600);
      }
    } catch (err) {
      btn.disabled = false;
      status.textContent = 'Нет связи. Попробуйте ещё раз — оценка не потеряется.';
      status.className = 'form-status is-error';
    }
  }

  function renderLinks(data) {
    const tg = data.telegram || {};
    const link = $('telegram-link');
    if (tg.url && /^https:\/\/t\.me\//.test(tg.url)) {
      link.href = tg.url;
      link.textContent = 'Напоминания в Telegram';
      link.hidden = false;
      $('rail-actions').hidden = false;
    } else {
      link.hidden = true;
      $('rail-actions').hidden = true;
    }

    const ref = data.referral;
    const block = $('referral');
    if (ref && ref.url && /^https:\/\/t\.me\//.test(ref.url)) {
      $('referral-text').textContent = ref.text || '';
      $('referral-text').hidden = !ref.text;
      $('referral-copy').dataset.url = ref.url;
      $('referral-status').textContent = '';
      block.hidden = false;
    } else {
      block.hidden = true;
    }
  }

  function renderCompany(data) {
    const c = data.company || {};
    if (c.name) $('company-name').textContent = c.name;
    if (c.address) $('company-address').textContent = c.address;
    if (c.hours) $('company-hours').textContent = c.hours;
  }

  async function copyReferral(button) {
    const url = button.dataset.url;
    const status = $('referral-status');
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = 'Ссылка скопирована.';
      status.className = 'form-status is-ok';
    } catch (err) {
      status.textContent = url;
      status.className = 'form-status';
    }
  }

  /* ── Старт ──────────────────────────────────────────────────────── */

  function init() {
    const params = new URLSearchParams(location.search);
    const token = (params.get('t') || '').trim();
    $('rating')?.addEventListener('submit', submitRating);
    $('rating-comment')?.addEventListener('input', updateCount);
    $('referral-copy')?.addEventListener('click', (e) => copyReferral(e.currentTarget));

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.order && !state.busy) load({ silent: true });
    });

    if (!token) {
      showState({
        title: 'Ссылка неполная',
        text: `Откройте ссылку из сообщения целиком — в ней есть код заказа. Или позвоните: ${CALL_TEXT()}.`,
        action: { label: 'Позвонить', onClick: () => { location.href = CALL_LINK(); } },
      });
      return;
    }

    if (!TOKEN_RE.test(token)) {
      showState({
        title: 'Ссылка не действует',
        text: `Похоже, ссылка обрезалась. Скопируйте её из сообщения ещё раз или позвоните: ${CALL_TEXT()}.`,
        action: { label: 'Позвонить', onClick: () => { location.href = CALL_LINK(); } },
      });
      return;
    }

    state.token = token;
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
