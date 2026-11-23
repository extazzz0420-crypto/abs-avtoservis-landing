/* АБС-Автосервис — поведение страницы.
   Без зависимостей и внешних запросов: только same-origin API и локальные модули. */
(() => {
  'use strict';

  const API = '/api/abs/v1';
  // v2: к согласию добавлена ссылка на политику обработки ПДн (/privacy/),
  // поэтому текст согласия отличается от v1 — версия растёт вместе с текстом.
  const CONSENT_VERSION = 'site-consent-v2';
  const PHONE_DISPLAY = '8-937-085-48-88';
  const PHONE_HREF = 'tel:+79370854888';
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollBehavior = () => (reduced() ? 'auto' : 'smooth');
  const desktopPointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  window.dataLayer = window.dataLayer || [];
  const track = (event, data = {}) => window.dataLayer.push({ event, ...data });

  /* События для abs.site_event: приёмник ждёт wa_click, tel_click, messenger_click,
     form_start, form_error. dataLayer уходит в GTM, но не в базу — поэтому шлём beacon.
     idem уникален на каждый клик, иначе дедуп приёмника проглотит повторного человека. */
  const pageKey = () => (location.pathname.replace(/\/+$/, '').replace(/^\//, '') || 'index')
    .replace(/[^a-z0-9-]/gi, '').slice(0, 16).toLowerCase();

  const sendEvent = (type, data = {}) => {
    try {
      const { utm, ref } = readAttribution();
      const srcRaw = String(data.src || data.block || data.channel || 'unknown');
      const src = srcRaw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 12) || 'unknown';
      const idem = `${pageKey()}-${src}-${Date.now().toString(36)}`
        .replace(/[^a-z0-9._-]/gi, '').slice(0, 64);
      const payload = JSON.stringify({ type, page: pageKey(), src, utm, ref, idem });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/abs/v1/event', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/abs/v1/event', {
          method: 'POST', body: payload, keepalive: true,
          headers: { 'content-type': 'application/json' }
        }).catch(() => {});
      }
    } catch (_) { /* событие не должно ломать клик */ }
  };

  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

  function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '' && text !== null && text !== undefined) node.textContent = String(text);
    return node;
  }

  function icon(path, size = 18) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    svg.append(p);
    return svg;
  }

  const money = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;
  };

  const plural = (n, forms) => {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last === 1) return forms[0];
    if (last >= 2 && last <= 4) return forms[1];
    return forms[2];
  };

  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  };

  const makeRequestId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID().replace(/-/g, '');
    }
    let id = '';
    while (id.length < 32) id += Math.random().toString(36).slice(2);
    return id.slice(0, 32);
  };

  const clean = (value, max) => {
    const text = String(value || '').trim();
    return text ? text.slice(0, max) : null;
  };

  function safeUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  /* ── Шапка, прогресс, меню ─────────────────────────────────────────── */

  const header = $('header');
  const progress = $('scroll-progress');
  let headerTick = false;

  function onScrollHeader() {
    if (header) header.classList.toggle('is-solid', window.scrollY > 24);
    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = `scaleX(${max > 0 ? clamp(window.scrollY / max) : 0})`;
    }
  }

  window.addEventListener('scroll', () => {
    if (headerTick) return;
    headerTick = true;
    window.requestAnimationFrame(() => {
      onScrollHeader();
      headerTick = false;
    });
  }, { passive: true });
  onScrollHeader();

  const menu = $('menu');
  const menuOpen = $('menu-open');
  if (menu && menuOpen) {
    menuOpen.addEventListener('click', () => {
      if (typeof menu.showModal === 'function') menu.showModal();
      else menu.setAttribute('open', '');
      document.body.classList.add('menu-open');
    });
    $('menu-close')?.addEventListener('click', () => menu.close());
    menu.addEventListener('close', () => {
      document.body.classList.remove('menu-open');
      menuOpen.focus({ preventScroll: true });
    });
    menu.addEventListener('click', (event) => {
      if (event.target === menu) menu.close();
      const link = event.target.closest('a');
      if (link) menu.close();
    });
  }

  /* ── Общие утилиты формы ───────────────────────────────────────────── */

  const phoneLink = (source) => {
    const link = el('a', '', PHONE_DISPLAY);
    link.href = PHONE_HREF;
    link.dataset.phoneClick = source;
    link.addEventListener('click', () => { track('phone_click', { block: source }); sendEvent('tel_click', { src: source }); });
    return link;
  };

  function setStatus(node, message, kind = '', withPhone = false) {
    if (!node) return;
    node.className = `form-status${kind ? ` is-${kind}` : ''}`;
    node.replaceChildren(document.createTextNode(message || ''));
    if (withPhone) node.append(document.createTextNode(' '), phoneLink('form-error'));
  }

  function clearFieldError(id) {
    const input = $(id);
    const error = $(`${id}-error`);
    if (input) input.removeAttribute('aria-invalid');
    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
  }

  function showFieldError(id, message) {
    const input = $(id);
    const error = $(`${id}-error`);
    if (input) input.setAttribute('aria-invalid', 'true');
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
    return input;
  }

  const validPhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    return /^[78]?\d{10}$/.test(digits);
  };

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

  /* ── Заявка: выбор ситуации и шаги ─────────────────────────────────── */

  const form = $('lead-form');
  const serviceInput = $('service');
  const choiceButtons = $$('.choice');
  const stepPanels = $$('.step-panel', form || document);
  const stepIndicators = $$('[data-step-indicator]');
  const lastStep = stepIndicators.length || 1;
  const stepsBar = document.querySelector('.steps');
  const selectionBar = $('form-selection');
  const selectionText = $('form-selection-text');
  const nextButton = $('step-next');
  const backButton = $('step-back');
  const submitButton = $('submit-button');
  const formStatus = $('form-status');
  const success = $('lead-success');
  const formCard = $('lead-form-card');
  let currentStep = 1;
  let selectedCode = null;
  let pendingRequestId = null;
  let submitting = false;

  function setRouteStage(stage) {
    $$('[data-route-step]').forEach((item) => {
      const n = Number(item.dataset.routeStep);
      item.classList.toggle('is-active', n === stage);
      item.classList.toggle('is-done', n < stage);
    });
  }

  function paintSelection(text, code) {
    selectedCode = code || null;
    for (const button of choiceButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.service === text));
    }
    if (!serviceInput) return;
    if (!text) {
      if (selectionBar) selectionBar.hidden = true;
      return;
    }
    if (selectionText) selectionText.textContent = text;
    if (selectionBar) selectionBar.hidden = false;
  }

  function setService(text, code = null, { advance = false, scroll = false } = {}) {
    if (!serviceInput) return;
    const value = String(text || '').slice(0, 120);
    serviceInput.value = value;
    clearFieldError('service');
    paintSelection(value, code);
    if (value) track('service_select', { code: code || 'manual', service: value });
    if (advance) {
      setStep(2, { focus: desktopPointer(), scroll });
    } else if (scroll) {
      scrollToForm();
    }
  }

  function scrollToForm() {
    const target = $('booking');
    if (!target) return;
    target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    window.setTimeout(() => {
      const phone = $('phone');
      if (phone && desktopPointer()) phone.focus({ preventScroll: true });
    }, reduced() ? 0 : 560);
  }

  function setStep(step, { focus = true, scroll = true } = {}) {
    currentStep = step;
    stepPanels.forEach((panel) => {
      panel.hidden = Number(panel.dataset.step) !== step;
    });
    stepIndicators.forEach((indicator) => {
      const n = Number(indicator.dataset.stepIndicator);
      indicator.classList.toggle('is-active', n === step);
      indicator.classList.toggle('is-done', n < step);
      if (n === step) indicator.setAttribute('aria-current', 'step');
      else indicator.removeAttribute('aria-current');
    });
    if (backButton) backButton.hidden = step === 1;
    if (nextButton) nextButton.hidden = step === lastStep;
    if (submitButton) submitButton.hidden = step !== lastStep;
    if (focus) {
      const panel = stepPanels.find((item) => Number(item.dataset.step) === step);
      const field = panel && panel.querySelector('input:not([type="checkbox"]), select');
      window.setTimeout(() => field?.focus({ preventScroll: true }), 30);
    }
    if (scroll) {
      formCard?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    }
  }

  function validateStep(step) {
    if (step === 1) {
      if (!serviceInput || !serviceInput.value.trim()) {
        showFieldError('service', 'Выберите ситуацию или коротко опишите работу');
        serviceInput?.focus({ preventScroll: true });
        return false;
      }
      clearFieldError('service');
      return true;
    }
    if (step === lastStep) {
      let firstInvalid = null;
      const phone = $('phone');
      if (!phone || !phone.value.trim() || !validPhone(phone.value)) {
        firstInvalid = showFieldError('phone', 'Проверьте российский номер — 10 цифр после +7 или 8');
      } else {
        clearFieldError('phone');
      }
      const consent = $('consent-pd');
      if (!consent?.checked) {
        const input = showFieldError('consent-pd', 'Нужно согласие на обработку данных');
        if (!firstInvalid) firstInvalid = input;
      } else {
        clearFieldError('consent-pd');
      }
      if (firstInvalid) {
        setStatus(formStatus, 'Проверьте выделенные поля.', 'error');
        firstInvalid.focus({ preventScroll: true });
        firstInvalid.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
        return false;
      }
      return true;
    }
    return true;
  }

  function buildLeadPayload() {
    const { utm, ref } = readAttribution();
    const payload = {
      client_request_id: pendingRequestId,
      kind: 'booking',
      phone: $('phone').value.trim(),
      name: clean($('name').value, 80),
      car: clean($('car').value, 120),
      service: clean(serviceInput.value, 120),
      wish_time: clean($('wish-time').value, 80),
      page: window.location.pathname.slice(0, 300),
      consent: {
        pd: Boolean($('consent-pd').checked),
        ads: Boolean($('consent-ads').checked),
        text_version: CONSENT_VERSION,
      },
      website: $('website').value,
    };
    if (selectedCode && /^[a-z0-9_]{2,64}$/.test(selectedCode)) payload.service_code = selectedCode;
    if (Object.keys(utm).length) payload.utm = utm;
    if (ref) payload.ref = ref;
    return payload;
  }

  function setSubmitting(value) {
    submitting = value;
    if (submitButton) {
      submitButton.disabled = value;
      const label = submitButton.querySelector('span');
      if (label) label.textContent = value ? 'Отправляем…' : 'Отправить заявку';
    }
    form?.setAttribute('aria-busy', String(value));
  }

  function renderMessengers(messenger, actions, block, lead, entry) {
    if (!actions || !block) return;
    actions.replaceChildren();
    block.hidden = true;
    if (lead) lead.hidden = true;
    if (!messenger || typeof messenger !== 'object') return;

    const channels = [
      { key: 'telegram_url', label: 'Продолжить в Telegram', channel: 'telegram' },
      { key: 'max_url', label: 'Продолжить в MAX', channel: 'max' },
    ];
    let count = 0;
    for (const channel of channels) {
      const href = safeUrl(messenger[channel.key]);
      if (!href) continue;
      const link = el('a', `messenger-btn${count ? ' messenger-btn--secondary' : ''}`);
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.append(el('span', '', channel.label));
      const arrow = el('span', 'messenger-btn__arrow', '→');
      arrow.setAttribute('aria-hidden', 'true');
      link.append(arrow);
      link.addEventListener('click', () => { track('messenger_click', { channel: channel.channel, entry }); sendEvent('messenger_click', { src: channel.channel }); });
      actions.append(link);
      count += 1;
    }
    block.hidden = count === 0;
    if (lead) lead.hidden = count === 0;
  }

  function showSuccess(data) {
    const message = $('success-message');
    if (message) {
      message.textContent = data.message || 'Заявка принята. Перезвоним с 8:00 до 20:00 и согласуем время.';
    }
    const leadNo = $('success-lead-no');
    if (leadNo) {
      leadNo.textContent = data.lead_no ? `Номер заявки: ${data.lead_no}` : '';
      leadNo.hidden = !data.lead_no;
    }
    formCard?.classList.add('is-success');
    renderMessengers(
      data.messenger,
      $('messenger-actions'),
      $('messenger-block'),
      $('success-channel-lead'),
      'booking'
    );
    if (form) form.hidden = true;
    if (stepsBar) stepsBar.hidden = true;
    if (selectionBar) selectionBar.hidden = true;
    if (success) {
      success.hidden = false;
      success.focus({ preventScroll: true });
      success.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    }
    setRouteStage(2);
    track('lead_accepted', { kind: 'booking', status: data.status || 'accepted', scenario: selectedCode || 'manual' });
  }

  function resetLeadForm() {
    form?.reset();
    clearFieldError('service');
    clearFieldError('phone');
    clearFieldError('consent-pd');
    selectedCode = null;
    pendingRequestId = null;
    paintSelection('', null);
    if (form) form.hidden = false;
    if (stepsBar) stepsBar.hidden = false;
    if (success) success.hidden = true;
    formCard?.classList.remove('is-success');
    setStatus(formStatus, '');
    setRouteStage(1);
    setSubmitting(false);
    setStep(1, { focus: false, scroll: false });
    $('booking')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    window.setTimeout(() => serviceInput?.focus({ preventScroll: true }), reduced() ? 0 : 400);
  }

  async function submitLead() {
    if (submitting) return;
    if (!validateStep(lastStep)) return;
    if (!pendingRequestId) pendingRequestId = makeRequestId();
    const payload = buildLeadPayload();
    track('lead_submit', { kind: 'booking', code: selectedCode || 'manual', page: window.location.pathname });
    setSubmitting(true);
    setStatus(formStatus, '');

    let response = null;
    let data = null;
    try {
      response = await fetch(`${API}/lead`, {
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
      return;
    }

    if (response && response.status === 422) {
      const fields = (data && data.fields) || {};
      const map = { phone: 'phone', name: 'name', car: 'car', service: 'service', wish_time: 'wish-time', consent: 'consent-pd', consent_pd: 'consent-pd' };
      let first = null;
      for (const [key, code] of Object.entries(fields)) {
        if (key === 'service_code') {
          selectedCode = null;
          setStatus(formStatus, 'Эта позиция прайса обновилась. Выберите работу заново.', 'error');
          setStep(1, { focus: true, scroll: true });
          pendingRequestId = makeRequestId();
          return;
        }
        const id = map[key];
        if (!id) continue;
        const message = code === 'required' ? 'Заполните поле' : code === 'too_long' ? 'Слишком длинное значение' : 'Проверьте значение';
        const input = showFieldError(id, message);
        if (input && !first) first = input;
      }
      setStatus(formStatus, (data && data.message) || 'Проверьте выделенные поля и отправьте ещё раз.', 'error');
      first?.focus({ preventScroll: true });
      pendingRequestId = makeRequestId();
      return;
    }

    if (response && response.status === 429) {
      const seconds = data && Number.isFinite(Number(data.retry_after)) ? Number(data.retry_after) : 0;
      const wait = seconds > 0 ? ` Повторить можно через ${seconds} с.` : '';
      setStatus(formStatus, `${(data && data.message) || 'Слишком много заявок. Попробуйте позже.'}${wait}`, 'error', true);
      return;
    }

    setStatus(formStatus, 'Не удалось отправить. Повторите или позвоните:', 'error', true);
  }

  for (const button of choiceButtons) {
    button.addEventListener('click', () => setService(button.dataset.service || '', null, { advance: true, scroll: true }));
  }

  $$('.sit').forEach((button) => {
    button.addEventListener('click', () => {
      setService(button.dataset.service || '', null, { advance: true, scroll: true });
    });
  });

  serviceInput?.addEventListener('input', () => {
    const value = serviceInput.value.trim();
    paintSelection(value, null);
    clearFieldError('service');
  });

  $('form-selection-change')?.addEventListener('click', () => {
    setStep(1, { focus: true, scroll: true });
  });

  nextButton?.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    if (currentStep < lastStep) setStep(currentStep + 1);
  });

  backButton?.addEventListener('click', () => {
    if (currentStep > 1) setStep(currentStep - 1);
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (currentStep < lastStep) {
      if (validateStep(currentStep)) setStep(currentStep + 1);
      return;
    }
    void submitLead();
  });

  form?.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id) clearFieldError(target.id);
  });

  $('success-again')?.addEventListener('click', resetLeadForm);

  // Российский номер: мягкая маска не мешает вставке в любом формате.
  $('phone')?.addEventListener('blur', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const digits = input.value.replace(/\D/g, '');
    if (!digits || !validPhone(input.value)) return;
    const normalized = digits.length === 11 ? digits : `7${digits}`;
    input.value = `+${normalized[0]} ${normalized.slice(1, 4)} ${normalized.slice(4, 7)}-${normalized.slice(7, 9)}-${normalized.slice(9, 11)}`;
  });

  /* ── Прайс ────────────────────────────────────────────────────────── */

  const priceList = $('price-list');
  const priceSearch = $('price-search');
  const priceFilters = $('price-filters');
  const priceCount = $('price-count');
  const priceEmpty = document.createElement('p');
  priceEmpty.className = 'prices__empty';
  priceEmpty.hidden = true;
  priceEmpty.textContent = 'Ничего не нашлось. Попробуйте другое слово или позвоните — подскажем.';

  let priceGroups = [];
  let activeCategory = 'all';
  let defaultPriceGroup = 0;

  const groupChevron = () => {
    const box = el('span', 'price-group__chevron');
    box.setAttribute('aria-hidden', 'true');
    box.append(icon('M6 9l6 6 6-6', 16));
    return box;
  };

  function priceRow(item) {
    const row = el('div', 'price-row');
    const main = el('div', 'price-row__main');
    main.append(el('p', 'price-row__title', item.title || 'Работа'));
    if (item.note) main.append(el('p', 'price-row__note', item.note));
    row.append(main);
    const value = el('p', 'price-row__price');
    if (item.price_from) value.append(el('small', '', 'от '), document.createTextNode(money(item.price)));
    else value.textContent = money(item.price);
    row.append(value);

    const add = el('button', 'price-row__add');
    add.type = 'button';
    add.dataset.code = item.code || '';
    add.dataset.title = item.title || '';
    add.dataset.note = item.note || '';
    add.setAttribute('aria-label', `Записаться: ${item.title || 'работа'}${item.note ? `, ${item.note}` : ''}`);
    add.append(icon('M5 12h13M13 6l6 6-6 6', 16));
    add.addEventListener('click', () => {
      const title = add.dataset.title;
      const note = add.dataset.note;
      const text = `${title}${note ? ` — ${note}` : ''}`;
      setService(text, add.dataset.code || null, { advance: true, scroll: true });
    });
    row.append(add);
    return row;
  }

  function renderPrices(data) {
    if (!priceList) return;
    const categories = Array.isArray(data.categories) ? data.categories.filter((c) => c && Array.isArray(c.items)) : [];
    const total = categories.reduce((sum, category) => sum + category.items.length, 0);
    priceList.replaceChildren();
    priceGroups = [];

    if (!total) {
      priceList.append(priceEmpty);
      priceEmpty.hidden = false;
      priceEmpty.textContent = 'Прайс обновляется. Точную цену по вашей задаче назовём по телефону: 8-937-085-48-88.';
      if (priceCount) priceCount.textContent = '0 позиций';
      return;
    }

    const preferred = categories.findIndex((category) => /техобслуживание/i.test(category.category || ''));
    defaultPriceGroup = preferred >= 0 ? preferred : 0;

    categories.forEach((category, index) => {
      const details = el('details', 'price-group');
      if (index === defaultPriceGroup) details.open = true;
      const summary = el('summary');
      summary.append(el('span', 'price-group__name', category.category || 'Работы'));
      summary.append(el('span', 'price-group__count', `${category.items.length} ${plural(category.items.length, ['позиция', 'позиции', 'позиций'])}`));
      summary.append(groupChevron());
      details.append(summary);

      const body = el('div', 'price-group__body');
      const rows = [];
      for (const item of category.items) {
        const row = priceRow(item);
        body.append(row);
        rows.push({ el: row, text: normalize(`${item.title || ''} ${item.note || ''} ${item.code || ''}`) });
      }
      details.append(body);
      priceList.append(details);
      priceGroups.push({ el: details, category: category.category || '', rows });
    });

    priceList.append(priceEmpty);
    priceEmpty.hidden = true;

    buildFilters(categories);
    if (priceCount) priceCount.textContent = `${total} ${plural(total, ['позиция', 'позиции', 'позиций'])}`;

    const draft = $('prices-draft');
    if (draft) draft.hidden = data.draft !== true;

    applyAnchorPrices(data);
  }

  // Цены в ситуациях — не минимум категории, а позиция-якорь из anchors{}.
  // Нет якоря или позиции — число не показываем: минимум здесь врёт.
  function applyAnchorPrices(data) {
    const anchors = data && data.anchors;
    if (!anchors || typeof anchors !== 'object') return;
    const byCode = new Map();
    for (const category of data.categories || []) {
      for (const item of category.items || []) {
        if (item && item.code) byCode.set(item.code, item);
      }
    }
    $$('.sit[data-anchor-category]').forEach((button) => {
      const code = anchors[button.dataset.anchorCategory];
      const item = code ? byCode.get(code) : null;
      const out = button.querySelector('.sit__price');
      if (!out) return;
      if (!item || !Number.isFinite(Number(item.price))) {
        out.hidden = true;
        return;
      }
      out.hidden = false;
      out.textContent = `${item.price_from ? 'от ' : ''}${money(item.price)}`;
    });
  }

  function buildFilters(categories) {
    if (!priceFilters) return;
    priceFilters.replaceChildren();
    const all = el('button', 'filter', 'Все');
    all.type = 'button';
    all.dataset.category = 'all';
    all.setAttribute('aria-pressed', 'true');
    priceFilters.append(all);
    for (const category of categories) {
      const button = el('button', 'filter', category.category || 'Работы');
      button.type = 'button';
      button.dataset.category = category.category || '';
      button.setAttribute('aria-pressed', 'false');
      priceFilters.append(button);
    }
    priceFilters.addEventListener('click', (event) => {
      const button = event.target.closest('.filter');
      if (!button) return;
      activeCategory = button.dataset.category || 'all';
      for (const item of priceFilters.querySelectorAll('.filter')) {
        item.setAttribute('aria-pressed', String(item === button));
      }
      applyPriceFilter();
    });
  }

  const normalize = (value) => String(value || '').toLowerCase().replace(/ё/g, 'е');
  const queryStems = (query) => normalize(query).split(/\s+/).filter(Boolean).map((word) => (word.length > 4 ? word.slice(0, 4) : word));

  function applyPriceFilter() {
    const query = normalize(priceSearch?.value || '');
    const stems = queryStems(query);
    let visible = 0;
    for (const group of priceGroups) {
      let shown = 0;
      for (const row of group.rows) {
        const match = !stems.length || stems.every((stem) => row.text.includes(stem));
        row.el.hidden = !match;
        if (match) shown += 1;
      }
      const categoryMatch = activeCategory === 'all' || group.category === activeCategory;
      group.el.hidden = !categoryMatch || shown === 0;
      if (categoryMatch && shown > 0) {
        if (stems.length || activeCategory !== 'all') group.el.open = true;
        else group.el.open = false;
        visible += shown;
      }
    }
    if (!stems.length && activeCategory === 'all' && priceGroups[defaultPriceGroup]) priceGroups[defaultPriceGroup].el.open = true;
    if (priceCount) priceCount.textContent = `${visible} ${plural(visible, ['позиция', 'позиции', 'позиций'])}`;
    priceEmpty.hidden = visible > 0;
  }

  priceSearch?.addEventListener('input', applyPriceFilter);

  async function loadPrices() {
    let data = null;
    try {
      const response = await fetch(`${API}/prices`, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('prices');
      const payload = await response.json();
      if (!payload || payload.ok !== true || !Array.isArray(payload.categories)) throw new Error('prices');
      data = payload;
    } catch {
      data = window.ABS_PRICES_FALLBACK || null;
    }
    if (!data) {
      if (priceList) {
        priceList.replaceChildren(priceEmpty);
        priceEmpty.hidden = false;
        priceEmpty.textContent = 'Прайс обновляется. Точную цену по вашей задаче назовём по телефону: 8-937-085-48-88.';
      }
      if (priceCount) priceCount.textContent = 'Прайс недоступен';
      return;
    }
    renderPrices(data);
    const updated = formatDate(data.updated_at);
    if (updated && priceCount && data.draft === true) {
      priceCount.textContent += ` · обновлено ${updated}`;
    }
  }

  void loadPrices();

  /* ── Кузовной предрасчёт ──────────────────────────────────────────── */

  const partsRoot = $('parts');
  const partsCount = $('parts-count');
  const partsReset = $('parts-reset');
  const damagePanel = $('damage-panel');
  const damageList = $('damage-list');
  const estimateForm = $('estimate-form');
  const estimateResult = $('estimate-result');
  const estimateStatus = $('estimate-status');
  const estimateSubmit = $('estimate-submit');
  const selectedParts = new Map();
  let estimateRequestId = null;
  let estimateSending = false;

  const damageOptions = [
    { value: 'paint', label: 'Ремонт и покраска' },
    { value: 'dent_3', label: 'Вмятина до 3 см' },
    { value: 'dent_5', label: 'Вмятина до 5 см' },
    { value: 'dent_8', label: 'Вмятина до 8 см' },
  ];

  function updatePartsMeta() {
    const count = selectedParts.size;
    if (partsCount) {
      partsCount.textContent = count
        ? `Выбрано: ${count} ${plural(count, ['деталь', 'детали', 'деталей'])} из 10`
        : 'Детали не выбраны';
    }
    if (partsReset) partsReset.hidden = count === 0;
    if (damagePanel) damagePanel.hidden = count === 0;
  }

  function renderDamageRows() {
    if (!damageList) return;
    damageList.replaceChildren();
    for (const [part, item] of selectedParts) {
      const row = el('div', 'damage-row');
      row.append(el('span', 'damage-row__name', item.label));
      if (item.bumper) {
        row.append(el('span', 'damage-row__fixed', 'Ремонт и покраска'));
      } else {
        const select = el('select');
        select.setAttribute('aria-label', `Характер повреждения: ${item.label}`);
        for (const option of damageOptions) {
          const node = el('option', '', option.label);
          node.value = option.value;
          if (option.value === item.damage) node.selected = true;
          select.append(node);
        }
        select.addEventListener('change', () => {
          item.damage = select.value;
        });
        row.append(select);
      }
      damageList.append(row);
    }
    updatePartsMeta();
  }

  partsRoot?.addEventListener('click', (event) => {
    const button = event.target.closest('.part');
    if (!button) return;
    const part = button.dataset.part;
    if (!part) return;
    const isSelected = button.getAttribute('aria-pressed') === 'true';
    if (isSelected) {
      button.setAttribute('aria-pressed', 'false');
      selectedParts.delete(part);
    } else {
      if (selectedParts.size >= 10) {
        setStatus(estimateStatus, 'Можно выбрать до 10 деталей — этого хватит для вилки.', 'error');
        return;
      }
      button.setAttribute('aria-pressed', 'true');
      selectedParts.set(part, {
        label: button.dataset.label || '',
        damage: 'paint',
        bumper: button.dataset.bumper === 'true',
      });
      setStatus(estimateStatus, '');
    }
    renderDamageRows();
  });

  partsReset?.addEventListener('click', () => {
    selectedParts.clear();
    $$('.part', partsRoot).forEach((button) => button.setAttribute('aria-pressed', 'false'));
    renderDamageRows();
    if (partsRoot) partsRoot.querySelector('.part')?.focus({ preventScroll: true });
  });

  function buildEstimatePayload() {
    const { utm, ref } = readAttribution();
    const payload = {
      client_request_id: estimateRequestId,
      phone: $('estimate-phone').value.trim(),
      name: clean($('estimate-name').value, 80),
      car: clean($('estimate-car').value, 120),
      items: Array.from(selectedParts, ([part, value]) => ({ part, damage: value.damage })),
      page: window.location.pathname.slice(0, 300),
      consent: { pd: Boolean($('estimate-consent').checked), ads: false, text_version: CONSENT_VERSION },
      website: $('estimate-website').value,
    };
    if (Object.keys(utm).length) payload.utm = utm;
    if (ref) payload.ref = ref;
    return payload;
  }

  function validateEstimate() {
    let first = null;
    if (selectedParts.size === 0) {
      setStatus(estimateStatus, 'Отметьте хотя бы одну повреждённую деталь.', 'error');
      first = partsRoot?.querySelector('.part');
    }
    const phone = $('estimate-phone');
    if (!phone.value.trim() || !validPhone(phone.value)) {
      const input = showFieldError('estimate-phone', 'Проверьте российский номер — 10 цифр после +7 или 8');
      if (!first) first = input;
    } else {
      clearFieldError('estimate-phone');
    }
    const consent = $('estimate-consent');
    if (!consent.checked) {
      const input = showFieldError('estimate-consent', 'Нужно согласие на обработку данных');
      if (!first) first = input;
    } else {
      clearFieldError('estimate-consent');
    }
    if (first) {
      first.focus({ preventScroll: true });
      first.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
      return false;
    }
    return true;
  }

  function showEstimate(data) {
    const estimate = data && data.estimate;
    if (!estimate) {
      setStatus(estimateStatus, (data && data.message) || 'Расчёт не построен. Позвоните — уточним по вашей работе.', 'error', true);
      return;
    }
    const range = $('estimate-range');
    if (range) {
      const min = Number(estimate.min);
      const max = Number(estimate.max);
      range.replaceChildren();
      if (Number.isFinite(min) && Number.isFinite(max)) {
        range.append(document.createTextNode(`${money(min)} — ${money(max)}`));
      } else {
        range.textContent = 'Вилка уточняется';
      }
    }
    const note = $('estimate-note');
    if (note) note.textContent = estimate.note || 'Точную стоимость мастер назовёт после осмотра.';
    const lines = $('estimate-lines');
    if (lines) {
      lines.replaceChildren();
      for (const line of Array.isArray(estimate.lines) ? estimate.lines : []) {
        const label = line.part_label || line.title || line.part;
        if (!label) continue;
        const damage = line.damage_label || '';
        const price = line.price_from ?? line.price;
        const row = el('li');
        row.append(el('span', '', `${label}${damage ? ` · ${damage}` : ''}`));
        row.append(el('b', '', Number.isFinite(Number(price)) ? `от ${money(price)}` : 'по осмотру'));
        lines.append(row);
      }
    }
    const message = $('estimate-message');
    if (message) message.textContent = data.message || 'Расчёт сохранён в заявке.';
    renderMessengers(
      data.messenger,
      $('estimate-messenger-actions'),
      $('estimate-messenger-block'),
      $('estimate-channel-lead'),
      'estimate'
    );
    if (estimateForm) estimateForm.hidden = true;
    if (estimateResult) {
      estimateResult.hidden = false;
      estimateResult.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    }
    track('estimate_accepted', { status: data.status || 'accepted', parts: selectedParts.size });
  }

  async function submitEstimate() {
    if (estimateSending) return;
    if (!validateEstimate()) return;
    if (!estimateRequestId) estimateRequestId = makeRequestId();
    if (estimateSubmit) {
      estimateSubmit.disabled = true;
      const label = estimateSubmit.querySelector('span');
      if (label) label.textContent = 'Считаем…';
    }
    estimateSending = true;
    setStatus(estimateStatus, '');
    track('estimate_submit', { parts: selectedParts.size });

    let response = null;
    let data = null;
    try {
      response = await fetch(`${API}/body-estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(buildEstimatePayload()),
      });
      data = await response.json().catch(() => null);
    } catch {
      response = null;
    }

    estimateSending = false;
    if (estimateSubmit) {
      estimateSubmit.disabled = false;
      const label = estimateSubmit.querySelector('span');
      if (label) label.textContent = 'Показать вилку';
    }

    if (response && response.ok && data && data.ok === true) {
      showEstimate(data);
      return;
    }
    if (response && response.status === 422) {
      const fields = (data && data.fields) || {};
      if (fields.phone) showFieldError('estimate-phone', 'Проверьте номер');
      if (fields.consent) showFieldError('estimate-consent', 'Нужно согласие');
      if (fields.items) setStatus(estimateStatus, 'Проверьте выбранные детали: до 10, без повторов. Бампер — только ремонт и покраска.', 'error');
      else setStatus(estimateStatus, (data && data.message) || 'Проверьте данные расчёта.', 'error');
      estimateRequestId = makeRequestId();
      return;
    }
    if (response && response.status === 429) {
      const seconds = data && Number.isFinite(Number(data.retry_after)) ? Number(data.retry_after) : 0;
      setStatus(estimateStatus, `Слишком много запросов.${seconds ? ` Повторите через ${seconds} с.` : ''}`, 'error', true);
      return;
    }
    setStatus(estimateStatus, 'Не удалось отправить. Повторите или позвоните:', 'error', true);
  }

  estimateSubmit?.addEventListener('click', () => void submitEstimate());

  $('estimate-again')?.addEventListener('click', () => {
    selectedParts.clear();
    $$('.part', partsRoot).forEach((button) => button.setAttribute('aria-pressed', 'false'));
    renderDamageRows();
    if (estimateResult) estimateResult.hidden = true;
    if (estimateForm) estimateForm.hidden = false;
    setStatus(estimateStatus, '');
    estimateRequestId = null;
    $('estimate')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  });

  $('estimate-phone')?.addEventListener('blur', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const digits = input.value.replace(/\D/g, '');
    if (!digits || !validPhone(input.value)) return;
    const normalized = digits.length === 11 ? digits : `7${digits}`;
    input.value = `+${normalized[0]} ${normalized.slice(1, 4)} ${normalized.slice(4, 7)}-${normalized.slice(7, 9)}-${normalized.slice(9, 11)}`;
  });

  /* ── Мобильная панель ─────────────────────────────────────────────── */

  const mobileBar = $('mobile-bar');
  const heroCta = document.querySelector('.hero__actions .btn');
  const bookingSection = $('booking');
  const mobileMedia = window.matchMedia('(max-width: 900px)');

  if (mobileBar && heroCta && bookingSection) {
    const updateBar = () => {
      const heroGone = heroCta.getBoundingClientRect().bottom < 0;
      const bookingRect = bookingSection.getBoundingClientRect();
      const bookingVisible = bookingRect.top < window.innerHeight && bookingRect.bottom > 0;
      mobileBar.classList.toggle('is-visible', mobileMedia.matches && heroGone && !bookingVisible);
    };
    window.addEventListener('scroll', updateBar, { passive: true });
    window.addEventListener('resize', updateBar);
    mobileMedia.addEventListener?.('change', updateBar);
    updateBar();
  }

  /* ── Чат: существующий модуль, грузится по первому клику ──────────── */

  const chatWidget = $('chat-widget');
  const formSections = [$('booking'), $('estimate')].filter(Boolean);
  const revealChat = () => {
    if (!chatWidget) return;
    const pastFold = window.scrollY > window.innerHeight * 0.55;
    // Чат не висит поверх формы: там главное действие — заявка, а не переписка.
    const overForm = formSections.some((section) => {
      const rect = section.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.85 && rect.bottom > window.innerHeight * 0.15;
    });
    chatWidget.classList.toggle('is-visible', pastFold && !overForm);
  };
  window.addEventListener('scroll', revealChat, { passive: true });
  window.addEventListener('resize', revealChat);
  revealChat();

  const chatToggle = $('chat-toggle');
  let chatInitialized = false;
  let chatPromise = null;
  let syntheticChatOpen = false;
  const chatLabel = chatToggle ? chatToggle.textContent : 'Онлайн-помощник';

  chatToggle?.addEventListener('click', async () => {
    const isOpening = chatToggle.getAttribute('aria-expanded') !== 'true';
    if (chatInitialized) {
      if (isOpening && !syntheticChatOpen) track('chat_open', { block: 'chat' });
      syntheticChatOpen = false;
      return;
    }
    chatToggle.disabled = true;
    chatToggle.setAttribute('aria-busy', 'true');
    chatToggle.textContent = 'Открываем чат…';
    track('chat_open', { block: 'chat' });
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

  /* ── Телефонные клики ─────────────────────────────────────────────── */

  $$('[data-phone-click]').forEach((link) => {
    link.addEventListener('click', () => {
      const src = link.dataset.phoneClick || 'unknown';
      track('phone_click', { block: src, page: window.location.pathname });
      sendEvent('tel_click', { src });
    });
  });

  // Первый экран: шаги сброшены, выбранной позиции нет.
  setStep(1, { focus: false, scroll: false });
})();
