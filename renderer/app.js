let contacts = [];

const $ = id => document.getElementById(id);

function normalizePhone(value) {
  let s = String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (!s) return '';

  // Excel may turn long numbers into scientific notation.
  if (/^[+]?\d+(?:\.\d+)?e[+]?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = Math.trunc(n).toString();
  }

  let digits = s.replace(/\D/g, '');
  if (digits.startsWith('0091')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  if (digits.length === 10) digits = '91' + digits;

  return digits;
}

function formatDisplayPhone(value) {
  const phone = normalizePhone(value);
  if (phone.length === 12 && phone.startsWith('91')) {
    return '+91 ' + phone.slice(2, 7) + ' ' + phone.slice(7);
  }
  return phone || String(value || '');
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

function renderContacts() {
  const eligible = contacts.filter(c => c.optedIn);

  $('total').textContent = contacts.length;
  $('eligible').textContent = eligible.length;
  $('excluded').textContent = contacts.length - eligible.length;
  $('campaignTotal').textContent = eligible.length;

  $('contacts').innerHTML = contacts.slice(0, 500).map((c, i) =>
    '<div class="row">' +
      '<span>' + (i + 1) + '</span>' +
      '<strong>' + escapeHtml(c.name || '') + '</strong>' +
      '<span>' + escapeHtml(formatDisplayPhone(c.phone)) + '</span>' +
      '<button class="pill ' + (c.optedIn ? 'on' : '') + '" data-index="' + i + '">' +
      (c.optedIn ? 'Opted in' : 'Excluded') +
      '</button>' +
    '</div>'
  ).join('');

  document.querySelectorAll('.pill').forEach(button => {
    button.onclick = () => {
      const i = Number(button.dataset.index);
      contacts[i].optedIn = !contacts[i].optedIn;
      renderContacts();
    };
  });
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map(x => x.replace(/^\uFEFF/, '').trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const first = lines[0].split(',').map(x => x.trim().toLowerCase());
  const headerNames = new Set([
    'phone','mobile','whatsapp','number','contact',
    'phone number','mobile number'
  ]);
  const hasHeader = first.some(x => headerNames.has(x));

  if (hasHeader) {
    const headers = first;

    return lines.slice(1).map(line => {
      const cells = line.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i] || ''; });

      const rawPhone =
        row.phone || row.mobile || row.whatsapp || row.number ||
        row.contact || row['phone number'] || row['mobile number'] || '';

      const hasOptInColumn =
        Object.prototype.hasOwnProperty.call(row, 'opted_in') ||
        Object.prototype.hasOwnProperty.call(row, 'optin') ||
        Object.prototype.hasOwnProperty.call(row, 'consent');

      const optValue = row.opted_in || row.optin || row.consent || 'true';

      return {
        name: row.name || row.full_name || row.customer_name || '',
        phone: normalizePhone(rawPhone),
        optedIn: !hasOptInColumn ||
          ['true','1','yes','y'].includes(String(optValue).toLowerCase())
      };
    }).filter(x => x.phone);
  }

  // Headerless CSV: first column is phone number.
  return lines.map(line => ({
    name: '',
    phone: normalizePhone(line.split(',')[0].trim()),
    optedIn: true
  })).filter(x => x.phone);
}

function addManualNumber() {
  const phone = normalizePhone($('manualPhone').value);
  const name = $('manualName').value.trim();

  if (!phone || phone.length !== 12 || !phone.startsWith('91')) {
    $('error').textContent =
      'Enter a valid 10-digit Indian mobile number. +91 will be added automatically.';
    return;
  }

  if (contacts.some(c => normalizePhone(c.phone) === phone)) {
    $('error').textContent = 'This number is already in the recipient list.';
    return;
  }

  contacts.push({ name, phone, optedIn: true });
  $('manualPhone').value = '';
  $('manualName').value = '';
  $('error').textContent = '';
  renderContacts();
}

function downloadDemoCsv() {
  const csv = 'phone\n9365137532\n9876543210\n9012345678\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'career-wings-demo-contacts.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('connect').onclick = async () => {
  $('error').textContent = '';
  try {
    await window.careerWings.connect();
  } catch (e) {
    $('error').textContent = e.message;
  }
};

$('disconnect').onclick = () => window.careerWings.disconnect();

$('downloadDemo').onclick = downloadDemoCsv;
$('addManual').onclick = addManualNumber;

$('manualPhone').addEventListener('keydown', e => {
  if (e.key === 'Enter') addManualNumber();
});

$('manualName').addEventListener('keydown', e => {
  if (e.key === 'Enter') addManualNumber();
});

$('import').onclick = async () => {
  const text = await window.careerWings.importCsv();

  if (text) {
    contacts = parseCsv(text);
    $('error').textContent = contacts.length
      ? ''
      : 'No valid phone numbers found in the CSV.';
    renderContacts();
  }
};

$('send').onclick = async () => {
  $('error').textContent = '';

  const eligible = contacts.filter(c => c.optedIn);

  if (!eligible.length) {
    $('error').textContent = 'No opted-in contacts available.';
    return;
  }

  try {
    await window.careerWings.sendCampaign({
      contacts,
      message: $('message').value,
      delayMs: Number($('delay').value) * 1000
    });
  } catch (e) {
    $('error').textContent = e.message;
  }
};

$('stop').onclick = () => window.careerWings.stopCampaign();

window.careerWings.onState(state => {
  $('status').textContent =
    state.status === 'connected' ? 'WhatsApp Connected' :
    state.status === 'qr' ? 'Scan QR' :
    state.status === 'authenticated' ? 'Authenticating…' :
    'Not Connected';

  $('status').className =
    'status ' + (state.status === 'connected' ? 'on' : '');

  $('sent').textContent = Number.isFinite(state.sent) ? state.sent : 0;
  $('failed').textContent = Number.isFinite(state.failed) ? state.failed : 0;
  $('campaignTotal').textContent =
    Number.isFinite(state.total)
      ? state.total
      : contacts.filter(c => c.optedIn).length;

  if (state.qr) {
    $('qr').innerHTML =
      '<img class="qrImage" alt="WhatsApp QR code" src="' + state.qr + '">';
    $('qrText').textContent =
      'Phone WhatsApp → Linked Devices → Link a Device → Scan this QR.';
  } else if (state.status === 'connected') {
    $('qr').innerHTML =
      '<div class="qrPlaceholder"><strong>WhatsApp Connected</strong><br>Session saved on this computer.</div>';
    $('qrText').textContent = 'Connected';
  }

  if (state.error) $('error').textContent = state.error;
});

renderContacts();