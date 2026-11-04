'use strict';
(function () {
  const api = window.sipQuick, $ = s => document.querySelector(s);
  const input = $('#text'), msg = $('#msg');
  const say = (t, err) => { msg.textContent = t; msg.classList.toggle('err', !!err); };
  const due = $('#due'), dueTime = $('#dueTime');
  due.addEventListener('input', () => { dueTime.disabled = !due.value; if (!due.value) dueTime.value = ''; });
  let busy = false;
  $('#form').addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const text = input.value.trim(); if (!text) { say('Type what you need to do.', true); input.focus(); return; }
    busy = true;
    try {
      const r = await api.add(text, due.value ? due.value + (dueTime.value ? 'T' + dueTime.value : '') : '');
      if (r && r.ok) { input.value = ''; due.value = ''; dueTime.value = ''; dueTime.disabled = true; say(`Added. ${r.open} open.`); setTimeout(() => api.close(), 700); }
      else say((r && r.error) || 'Could not add that.', true);
    } catch (err) { say('Could not add that.', true); }
    busy = false; input.focus();
  });
  $('#cancel').addEventListener('click', () => api.close());
  addEventListener('keydown', e => { if (e.key === 'Escape') api.close(); });
  input.focus();
})();
