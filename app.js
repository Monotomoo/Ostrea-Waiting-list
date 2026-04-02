// ═══════════════════════════════════════════════════
//  FIREBASE INIT
// ═══════════════════════════════════════════════════
const db = firebase.firestore();

// In-memory state — kept in sync by onSnapshot listeners
let queue    = [];
let bookings = [];

// ═══════════════════════════════════════════════════
//  STORAGE LAYER — FIRESTORE
// ═══════════════════════════════════════════════════
async function addGuest(data) {
  const entry = {
    name:      data.name.trim(),
    adults:    data.adults,
    kids:      data.kids,
    partySize: data.adults + data.kids,
    phone:     data.phone.trim(),
    whatsapp:  data.whatsapp.trim(),
    email:     data.email.trim(),
    timestamp: Date.now(),
    status:    'waiting'
  };
  const ref = await db.collection('waitlist').add(entry);
  return { id: ref.id, ...entry };
}

function updateStatus(id, status) {
  return db.collection('waitlist').doc(id).update({ status });
}
function removeGuest(id) {
  return db.collection('waitlist').doc(id).delete();
}
function clearSeated() {
  const batch = db.batch();
  queue.filter(e => e.status === 'seated')
       .forEach(e => batch.delete(db.collection('waitlist').doc(e.id)));
  return batch.commit();
}

async function addBooking(data) {
  const entry = {
    name:      data.name.trim(),
    adults:    data.adults,
    kids:      data.kids,
    partySize: data.adults + data.kids,
    date:      data.date,
    time:      data.time,
    timeLabel: data.timeLabel,
    phone:     (data.phone    || '').trim(),
    whatsapp:  (data.whatsapp || '').trim(),
    email:     (data.email    || '').trim(),
    notes:     (data.notes    || '').trim(),
    timestamp: Date.now(),
    status:    'pending'
  };
  const ref = await db.collection('bookings').add(entry);
  return { id: ref.id, ...entry };
}

function updateBookingStatus(id, status) {
  return db.collection('bookings').doc(id).update({ status });
}
function removeBooking(id) {
  return db.collection('bookings').doc(id).delete();
}
function clearPastBookings() {
  const batch = db.batch();
  bookings.filter(b => b.status === 'cancelled' || b.status === 'completed')
          .forEach(b => batch.delete(db.collection('bookings').doc(b.id)));
  return batch.commit();
}

// ═══════════════════════════════════════════════════
//  FIRESTORE REAL-TIME LISTENERS
// ═══════════════════════════════════════════════════
function initFirestore() {
  db.collection('waitlist').orderBy('timestamp').onSnapshot(snapshot => {
    queue = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    updateQueueStatusBar();
    const adminView = document.getElementById('admin-view');
    if (adminView.classList.contains('active') && currentAdminTab === 'waitlist') {
      renderAdmin();
    }
  });

  db.collection('bookings').orderBy('timestamp').onSnapshot(snapshot => {
    bookings = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const adminView = document.getElementById('admin-view');
    if (adminView.classList.contains('active') && currentAdminTab === 'bookings') {
      renderBookingsPanel();
    }
  });
}

// ═══════════════════════════════════════════════════
//  QUEUE LOGIC
// ═══════════════════════════════════════════════════
function getWaitingPosition(id) {
  const waiting = queue.filter(e => e.status === 'waiting');
  const idx = waiting.findIndex(e => e.id === id);
  return idx === -1 ? null : idx + 1;
}
function calcWait(pos) { return pos * 15; }

function formatTime(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}
function minutesAgo(ts) { return Math.floor((Date.now() - ts) / 60000); }

function sizeClass(n) {
  if (n <= 2) return 'size-sm';
  if (n <= 4) return 'size-md';
  if (n <= 6) return 'size-lg';
  return 'size-xl';
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Date / time helpers ─────────────────────────
function getDateOptions() {
  const days    = ['Ned','Pon','Uto','Sri','Čet','Pet','Sub'];
  const months  = ['Sij','Velj','Ožu','Tra','Svi','Lip','Srp','Kol','Ruj','Lis','Stu','Pro'];
  const friends = ['Danas','Sutra','+2 Dana','+3 Dana'];
  const now = new Date();
  return Array.from({ length: 4 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    return {
      iso:           d.toISOString().slice(0, 10),
      dayLabel:      days[d.getDay()],
      dateNum:       d.getDate(),
      monthLabel:    months[d.getMonth()],
      friendlyLabel: friends[i]
    };
  });
}

function generateTimeSlots() {
  const starts = ['12:00','14:00','16:00','18:00','20:00'];
  const ends   = ['14:00','16:00','18:00','20:00','22:00'];
  const toLabel = t => {
    const [h, m] = t.split(':').map(Number);
    const period = h < 12 ? 'h' : 'h';
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:${m.toString().padStart(2,'0')} ${period}`;
  };
  return starts.map((s, i) => ({ start: s, end: ends[i], label: `${toLabel(s)} – ${toLabel(ends[i])}` }));
}

function formatBookingDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'short' });
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function getUpcomingBookings() {
  return bookings
    .filter(b => b.date >= todayISO())
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

// ═══════════════════════════════════════════════════
//  GUEST VIEW
// ═══════════════════════════════════════════════════
let partyAdults = 2;
let partyKids   = 0;

function updateQueueStatusBar() {
  const bar = document.getElementById('queue-status-bar');
  if (!bar) return;
  const waiting = queue.filter(e => e.status === 'waiting').length;
  if (waiting === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML =
    '<span class="qsb-dot"></span>' +
    '<span class="queue-status-bar-text">' +
      '<span class="queue-status-bar-count">' + waiting + '</span>' +
      '\u00a0' + (waiting === 1 ? 'grupa' : 'grupa') + ' trenutno čeka' +
    '</span>';
}

function initGuestView() {
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });
  initBookingForm();

  const nameInput     = document.getElementById('g-name');
  const phoneInput    = document.getElementById('g-phone');
  const whatsappInput = document.getElementById('g-whatsapp');
  const emailInput    = document.getElementById('g-email');
  const errName       = document.getElementById('err-name');
  const submitBtn     = document.getElementById('submit-btn');

  const adultsVal = document.getElementById('party-adults-val');
  const adultsDec = document.getElementById('party-adults-dec');
  const adultsInc = document.getElementById('party-adults-inc');
  const kidsVal   = document.getElementById('party-kids-val');
  const kidsDec   = document.getElementById('party-kids-dec');
  const kidsInc   = document.getElementById('party-kids-inc');
  const totalEl   = document.getElementById('party-total');

  function updatePartyStepper() {
    adultsVal.textContent = partyAdults;
    kidsVal.textContent   = partyKids;
    totalEl.textContent   = partyAdults + partyKids;
    adultsDec.disabled = partyAdults <= 1;
    adultsInc.disabled = partyAdults + partyKids >= 12;
    kidsDec.disabled   = partyKids <= 0;
    kidsInc.disabled   = partyAdults + partyKids >= 12;
  }
  adultsDec.addEventListener('click', () => { if (partyAdults > 1)  { partyAdults--; updatePartyStepper(); } });
  adultsInc.addEventListener('click', () => { if (partyAdults + partyKids < 12) { partyAdults++; updatePartyStepper(); } });
  kidsDec.addEventListener('click',   () => { if (partyKids > 0)   { partyKids--;   updatePartyStepper(); } });
  kidsInc.addEventListener('click',   () => { if (partyAdults + partyKids < 12) { partyKids++;   updatePartyStepper(); } });
  updatePartyStepper();

  submitBtn.addEventListener('click', async () => {
    if (!nameInput.value.trim()) {
      nameInput.classList.add('error');
      errName.classList.add('visible');
      nameInput.focus();
      return;
    }
    nameInput.classList.remove('error');
    errName.classList.remove('visible');
    submitBtn.disabled = true;

    const optimisticPos = queue.filter(e => e.status === 'waiting').length + 1;
    const entry = await addGuest({
      name:     nameInput.value,
      adults:   partyAdults,
      kids:     partyKids,
      phone:    phoneInput.value,
      whatsapp: whatsappInput.value,
      email:    emailInput.value
    });
    submitBtn.disabled = false;
    showConfirmation(entry, optimisticPos);
  });

  nameInput.addEventListener('input', () => {
    if (nameInput.value.trim()) {
      nameInput.classList.remove('error');
      errName.classList.remove('visible');
    }
  });

  document.getElementById('accept-btn').addEventListener('click', () => {
    clearRejectCountdown();
    resetGuestForm();
  });
  document.getElementById('reject-btn').addEventListener('click', () => {
    clearRejectCountdown();
    if (currentEntry) removeGuest(currentEntry.id);
    resetGuestForm();
  });
}

let currentEntry = null;
let rejectTimer  = null;

function clearRejectCountdown() {
  if (rejectTimer) { clearInterval(rejectTimer); rejectTimer = null; }
  const btn = document.getElementById('reject-btn');
  if (btn) btn.classList.remove('counting');
}

function startRejectCountdown() {
  const btn       = document.getElementById('reject-btn');
  const label     = document.getElementById('reject-countdown');
  let   remaining = 20;
  btn.classList.add('counting');
  btn.style.animation = 'none';
  void btn.offsetWidth;
  btn.style.animation = '';

  rejectTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearRejectCountdown();
      if (currentEntry) removeGuest(currentEntry.id);
      resetGuestForm();
    } else {
      label.textContent = `automatski uklanja za ${remaining}s`;
    }
  }, 1000);
}

function showConfirmation(entry, pos) {
  currentEntry = entry;

  document.getElementById('conf-name').textContent  = `Sve je spremno, ${entry.name}!`;
  const partyLabel = entry.kids > 0
    ? `Grupa od ${entry.partySize} (${entry.adults} odraslih, ${entry.kids} djece)`
    : `Grupa od ${entry.partySize} ${entry.partySize === 1 ? 'osoba' : 'osoba'}`;
  document.getElementById('conf-party').textContent = partyLabel;
  document.getElementById('conf-pos').textContent = pos;

  const svgPhone = `<svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8a19.79 19.79 0 01-3.07-8.72A2 2 0 012 .15h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.12-1.16a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z"/></svg>`;
  const svgWA    = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
  const svgEmail = `<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>`;

  const contactsEl = document.getElementById('conf-contacts');
  contactsEl.innerHTML = '';
  const contacts = [
    { val: entry.phone,    svg: svgPhone, cls: 'conf-icon-phone' },
    { val: entry.whatsapp, svg: svgWA,    cls: 'conf-icon-wa'    },
    { val: entry.email,    svg: svgEmail, cls: 'conf-icon-email'  },
  ];
  const provided = contacts.filter(c => c.val);
  if (provided.length === 0) {
    contactsEl.innerHTML = `<div class="conf-info-row"><span class="conf-info-muted">Niste ostavili kontakt — molimo pričekajte u blizini.</span></div>`;
  } else {
    provided.forEach(c => {
      contactsEl.innerHTML += `
        <div class="conf-info-row">
          <span class="conf-icon-wrap ${c.cls}">${c.svg}</span>
          <span class="conf-info-val">${esc(c.val)}</span>
        </div>`;
    });
  }

  const msgs = [
    `Popijte piće i uživajte u pogledu — doći ćemo po vas čim vaš stol bude spreman.`,
    `Vaš stol za ${entry.partySize} je skoro spreman. Opustite se — javit ćemo vam uskoro.`,
    `Opustite se i uživajte. Kontaktirat ćemo vas čim se stol oslobodi.`,
  ];
  document.getElementById('conf-msg').textContent = msgs[pos % msgs.length];

  document.getElementById('form-screen').classList.add('hidden');
  document.getElementById('confirm-screen').classList.add('active');
  document.getElementById('reject-countdown').textContent = 'automatski uklanja za 20s';
  clearRejectCountdown();
  startRejectCountdown();
}

function resetGuestForm() {
  clearRejectCountdown();
  currentEntry = null;
  partyAdults = 2;
  partyKids = 0;
  ['g-name','g-phone','g-whatsapp','g-email'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('g-name').classList.remove('error');
  document.getElementById('err-name').classList.remove('visible');
  document.getElementById('party-adults-val').textContent = '2';
  document.getElementById('party-kids-val').textContent = '0';
  document.getElementById('party-total').textContent = '2';
  document.getElementById('party-adults-dec').disabled = false;
  document.getElementById('party-adults-inc').disabled = false;
  document.getElementById('party-kids-dec').disabled = true;
  document.getElementById('party-kids-inc').disabled = false;
  document.getElementById('form-screen').classList.remove('hidden');
  document.getElementById('confirm-screen').classList.remove('active');
}

// ═══════════════════════════════════════════════════
//  BOOKING GUEST FLOW
// ═══════════════════════════════════════════════════
let bPartyAdults        = 2;
let bPartyKids          = 0;
let selectedBookingDate = null;
let selectedBookingTime = null;
let currentBooking      = null;
let bookingRejectTimer  = null;
let activeMode          = 'waitlist';

function switchMode(mode) {
  activeMode = mode;
  const formScreen     = document.getElementById('form-screen');
  const bookingForm    = document.getElementById('booking-form-screen');
  const confirmScreen  = document.getElementById('confirm-screen');
  const bookingConfirm = document.getElementById('booking-confirm-screen');
  const h1 = document.querySelector('#guest-view .guest-header h1');
  const p  = document.querySelector('#guest-view .guest-header p');

  document.getElementById('tab-waitlist').classList.toggle('active', mode === 'waitlist');
  document.getElementById('tab-booking').classList.toggle('active', mode === 'booking');

  if (mode === 'waitlist') {
    formScreen.classList.remove('hidden');
    bookingForm.classList.add('hidden-init');
    confirmScreen.classList.remove('active');
    bookingConfirm.classList.add('hidden-init');
    h1.textContent = 'Lista čekanja';
    p.innerHTML = 'Opustite se &mdash; javit ćemo vam kad vaš stol bude spreman';
  } else {
    bookingForm.classList.remove('hidden-init');
    formScreen.classList.add('hidden');
    confirmScreen.classList.remove('active');
    bookingConfirm.classList.add('hidden-init');
    h1.textContent = 'Rezerviraj stol';
    p.innerHTML = 'Rezervirajte mjesto za danas ili sljedeća 3 dana';
  }
}

function initBookingForm() {
  const datePillsEl = document.getElementById('b-date-pills');
  const dateOptions = getDateOptions();
  selectedBookingDate = dateOptions[0].iso;
  datePillsEl.innerHTML = '';
  dateOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'date-pill' + (opt.iso === selectedBookingDate ? ' selected' : '');
    btn.dataset.iso = opt.iso;
    btn.innerHTML =
      `<span class="date-pill-day">${opt.dayLabel}</span>` +
      `<span class="date-pill-num">${opt.dateNum}</span>` +
      `<span class="date-pill-label">${opt.friendlyLabel}</span>`;
    btn.addEventListener('click', () => {
      selectedBookingDate = opt.iso;
      datePillsEl.querySelectorAll('.date-pill').forEach(p => p.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('err-b-date').classList.remove('visible');
    });
    datePillsEl.appendChild(btn);
  });

  const timeSlotsEl = document.getElementById('b-time-slots');
  timeSlotsEl.innerHTML = '';
  generateTimeSlots().forEach(slot => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'time-slot';
    btn.textContent = slot.label;
    btn.addEventListener('click', () => {
      selectedBookingTime = slot;
      timeSlotsEl.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('err-b-time').classList.remove('visible');
    });
    timeSlotsEl.appendChild(btn);
  });

  const bAdultsVal = document.getElementById('b-party-adults-val');
  const bAdultsDec = document.getElementById('b-party-adults-dec');
  const bAdultsInc = document.getElementById('b-party-adults-inc');
  const bKidsVal   = document.getElementById('b-party-kids-val');
  const bKidsDec   = document.getElementById('b-party-kids-dec');
  const bKidsInc   = document.getElementById('b-party-kids-inc');
  const bTotalEl   = document.getElementById('b-party-total');

  function updateBPartyStepper() {
    bAdultsVal.textContent = bPartyAdults;
    bKidsVal.textContent   = bPartyKids;
    bTotalEl.textContent   = bPartyAdults + bPartyKids;
    bAdultsDec.disabled = bPartyAdults <= 1;
    bAdultsInc.disabled = bPartyAdults + bPartyKids >= 12;
    bKidsDec.disabled   = bPartyKids <= 0;
    bKidsInc.disabled   = bPartyAdults + bPartyKids >= 12;
  }
  bAdultsDec.addEventListener('click', () => { if (bPartyAdults > 1)  { bPartyAdults--; updateBPartyStepper(); } });
  bAdultsInc.addEventListener('click', () => { if (bPartyAdults + bPartyKids < 12) { bPartyAdults++; updateBPartyStepper(); } });
  bKidsDec.addEventListener('click',   () => { if (bPartyKids > 0)   { bPartyKids--;   updateBPartyStepper(); } });
  bKidsInc.addEventListener('click',   () => { if (bPartyAdults + bPartyKids < 12) { bPartyKids++;   updateBPartyStepper(); } });
  updateBPartyStepper();

  const bName = document.getElementById('b-name');
  bName.addEventListener('input', () => {
    if (bName.value.trim()) {
      bName.classList.remove('error');
      document.getElementById('err-b-name').classList.remove('visible');
    }
  });

  document.getElementById('b-submit-btn').addEventListener('click', validateAndSubmitBooking);
  document.getElementById('b-accept-btn').addEventListener('click', () => { clearBookingCountdown(); resetBookingForm(); });
  document.getElementById('b-reject-btn').addEventListener('click', () => {
    clearBookingCountdown();
    if (currentBooking) removeBooking(currentBooking.id);
    resetBookingForm();
  });
}

async function validateAndSubmitBooking() {
  const bName      = document.getElementById('b-name');
  const bPhone     = document.getElementById('b-phone');
  const bWA        = document.getElementById('b-whatsapp');
  const bEmail     = document.getElementById('b-email');
  const errName    = document.getElementById('err-b-name');
  const errDate    = document.getElementById('err-b-date');
  const errTime    = document.getElementById('err-b-time');
  const errContact = document.getElementById('err-b-contact');
  let ok = true;

  if (!bName.value.trim()) {
    bName.classList.add('error'); errName.classList.add('visible');
    if (ok) bName.focus();
    ok = false;
  }
  if (!selectedBookingDate) { errDate.classList.add('visible'); ok = false; }
  if (!selectedBookingTime) { errTime.classList.add('visible'); ok = false; }
  if (!bPhone.value.trim() && !bWA.value.trim() && !bEmail.value.trim()) {
    errContact.classList.add('visible'); ok = false;
  }
  if (!ok) return;

  errName.classList.remove('visible'); errDate.classList.remove('visible');
  errTime.classList.remove('visible'); errContact.classList.remove('visible');

  const submitBtn = document.getElementById('b-submit-btn');
  submitBtn.disabled = true;
  const entry = await addBooking({
    name:      bName.value,
    adults:    bPartyAdults,
    kids:      bPartyKids,
    date:      selectedBookingDate,
    time:      selectedBookingTime.start,
    timeLabel: selectedBookingTime.label,
    phone:     bPhone.value,
    whatsapp:  bWA.value,
    email:     bEmail.value,
    notes:     document.getElementById('b-notes').value
  });
  submitBtn.disabled = false;
  showBookingConfirmation(entry);
}

function showBookingConfirmation(entry) {
  currentBooking = entry;
  document.getElementById('bc-name').textContent  = `Sve je spremno, ${entry.name}!`;
  const bPartyLabel = entry.kids > 0
    ? `Grupa od ${entry.partySize} (${entry.adults} odraslih, ${entry.kids} djece)`
    : `Grupa od ${entry.partySize} ${entry.partySize === 1 ? 'osoba' : 'osoba'}`;
  document.getElementById('bc-party').textContent = bPartyLabel;
  document.getElementById('bc-date').textContent  = formatBookingDate(entry.date);
  document.getElementById('bc-time').textContent  = entry.timeLabel || entry.time;

  const svgPhone = `<svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8a19.79 19.79 0 01-3.07-8.72A2 2 0 012 .15h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.12-1.16a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z"/></svg>`;
  const svgWA    = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
  const svgEmail = `<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>`;

  const contactsEl = document.getElementById('bc-contacts');
  contactsEl.innerHTML = '';
  [{ val: entry.phone, svg: svgPhone, cls: 'conf-icon-phone' },
   { val: entry.whatsapp, svg: svgWA, cls: 'conf-icon-wa' },
   { val: entry.email, svg: svgEmail, cls: 'conf-icon-email' }]
    .filter(c => c.val)
    .forEach(c => {
      contactsEl.innerHTML += `<div class="conf-info-row"><span class="conf-icon-wrap ${c.cls}">${c.svg}</span><span class="conf-info-val">${esc(c.val)}</span></div>`;
    });

  document.getElementById('bc-msg').textContent =
    'Vaša rezervacija je potvrđena. Veselimo se vašem dolasku — uživajte do tada.';

  document.getElementById('booking-form-screen').classList.add('hidden-init');
  document.getElementById('booking-confirm-screen').classList.remove('hidden-init');
  document.getElementById('b-reject-countdown').textContent = 'automatski otkazuje za 20s';
  clearBookingCountdown();
  startBookingRejectCountdown();
}

function clearBookingCountdown() {
  if (bookingRejectTimer) { clearInterval(bookingRejectTimer); bookingRejectTimer = null; }
  const btn = document.getElementById('b-reject-btn');
  if (btn) btn.classList.remove('counting');
}

function startBookingRejectCountdown() {
  const btn   = document.getElementById('b-reject-btn');
  const label = document.getElementById('b-reject-countdown');
  let remaining = 20;
  btn.classList.add('counting');
  btn.style.animation = 'none'; void btn.offsetWidth; btn.style.animation = '';
  bookingRejectTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearBookingCountdown();
      if (currentBooking) removeBooking(currentBooking.id);
      resetBookingForm();
    } else {
      label.textContent = `automatski otkazuje za ${remaining}s`;
    }
  }, 1000);
}

function resetBookingForm() {
  clearBookingCountdown();
  currentBooking = null;
  bPartyAdults = 2;
  bPartyKids = 0;
  selectedBookingTime = null;
  ['b-name','b-phone','b-whatsapp','b-email','b-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('b-name').classList.remove('error');
  ['err-b-name','err-b-date','err-b-time','err-b-contact'].forEach(id =>
    document.getElementById(id).classList.remove('visible'));
  document.getElementById('b-party-adults-val').textContent = '2';
  document.getElementById('b-party-kids-val').textContent = '0';
  document.getElementById('b-party-total').textContent = '2';
  document.getElementById('b-party-adults-dec').disabled = false;
  document.getElementById('b-party-adults-inc').disabled = false;
  document.getElementById('b-party-kids-dec').disabled = true;
  document.getElementById('b-party-kids-inc').disabled = false;
  const dateOptions = getDateOptions();
  selectedBookingDate = dateOptions[0].iso;
  document.getElementById('b-date-pills').querySelectorAll('.date-pill')
    .forEach((pill, i) => pill.classList.toggle('selected', i === 0));
  document.getElementById('b-time-slots').querySelectorAll('.time-slot')
    .forEach(s => s.classList.remove('selected'));
  document.getElementById('booking-confirm-screen').classList.add('hidden-init');
  document.getElementById('booking-form-screen').classList.remove('hidden-init');
}

// ═══════════════════════════════════════════════════
//  ADMIN VIEW
// ═══════════════════════════════════════════════════
let clockInterval  = null;
let seatedOpen     = false;
let adminInited    = false;
let currentAdminTab = 'waitlist';
let sortBySize     = false;

function startClock() {
  clearInterval(clockInterval);
  const el = document.getElementById('live-clock');
  const tick = () => el.textContent = new Date().toLocaleTimeString('hr-HR', { hour12: false });
  tick();
  clockInterval = setInterval(tick, 1000);
}
function stopClock() { clearInterval(clockInterval); }

function statusLabel(s) {
  return s === 'waiting' ? '● Čeka' : s === 'notified' ? '◎ Obaviješten' : '✓ Sjeo';
}

function partyChipText(entry) {
  const total = entry.partySize || ((entry.adults || 0) + (entry.kids || 0));
  if (entry.kids > 0) return `👥 ${total} (${entry.adults}O + ${entry.kids}D)`;
  return `👥 ${total}`;
}

function buildContactHtml(entry) {
  let html = '';
  if (entry.phone)    html += `<div class="contact-item"><span class="ci-icon">📞</span>${esc(entry.phone)}</div>`;
  if (entry.whatsapp) html += `<div class="contact-item"><span class="ci-icon">💬</span>${esc(entry.whatsapp)}</div>`;
  if (entry.email)    html += `<div class="contact-item"><span class="ci-icon">✉️</span>${esc(entry.email)}</div>`;
  return html;
}

function renderAdmin() {
  const active  = queue.filter(e => e.status !== 'seated').sort(sortBySize
    ? (a, b) => b.partySize - a.partySize
    : (a, b) => a.timestamp - b.timestamp);
  const seated  = queue.filter(e => e.status === 'seated').sort((a,b) => a.timestamp - b.timestamp);
  const waiting = queue.filter(e => e.status === 'waiting');

  document.getElementById('admin-count').textContent = waiting.length;
  const bPending = bookings.filter(b => b.status === 'pending' || b.status === 'bconfirmed').length;
  document.getElementById('admin-booking-count').textContent = bPending;
  document.getElementById('atab-waitlist-count').textContent = waiting.length;

  const activeList = document.getElementById('active-list');
  activeList.innerHTML = '';

  if (active.length === 0) {
    activeList.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🌊</div>
        <div class="es-title">Nema gostiju u redu</div>
        <div class="es-sub">Novi gosti će se automatski pojaviti ovdje</div>
      </div>`;
  } else {
    active.forEach(entry => {
      const pos  = entry.status === 'waiting' ? getWaitingPosition(entry.id) : null;
      const wait = pos ? calcWait(pos) : null;
      const ago  = minutesAgo(entry.timestamp);
      const card = document.createElement('div');
      card.className = `queue-card status-${entry.status} ${sizeClass(entry.partySize)}`;
      card.innerHTML = `
        <div class="card-num">${pos !== null ? pos : '–'}</div>
        <div class="card-body">
          <div class="card-top">
            <span class="card-name">${esc(entry.name)}</span>
            <span class="party-chip">${partyChipText(entry)}</span>
            <span class="status-badge ${entry.status}">${statusLabel(entry.status)}</span>
          </div>
          <div class="card-meta">${buildContactHtml(entry)}</div>
          <div class="time-meta">
            <div class="time-item"><span>Dodano</span>${formatTime(entry.timestamp)}</div>
            <div class="time-item"><span>Prije</span>${ago}m</div>
            ${wait !== null ? `<div class="time-item"><span>Čekanje</span>~${wait}m</div>` : ''}
          </div>
        </div>
        <div class="card-actions">
          ${entry.status === 'waiting'
            ? `<button class="action-btn btn-notify" data-action="notify" data-id="${entry.id}">Obavijesti</button>` : ''}
          ${entry.status !== 'seated'
            ? `<button class="action-btn btn-seat" data-action="seat" data-id="${entry.id}">Sjedi</button>` : ''}
          <button class="action-btn btn-remove" data-action="remove" data-id="${entry.id}">Ukloni</button>
        </div>`;
      activeList.appendChild(card);
    });
  }

  const seatedSection = document.getElementById('seated-section');
  const seatedList    = document.getElementById('seated-list');
  const seatedTitle   = document.getElementById('seated-title');
  const seatedIcon    = document.getElementById('seated-icon');

  if (seated.length > 0) {
    seatedSection.classList.remove('hidden-init');
    seatedTitle.textContent = `Sjeli (${seated.length})`;
    seatedList.innerHTML = '';
    if (seatedOpen) {
      seated.forEach(entry => {
        const card = document.createElement('div');
        card.className = `queue-card status-seated ${sizeClass(entry.partySize)}`;
        card.innerHTML = `
          <div class="card-num seated-num">✓</div>
          <div class="card-body">
            <div class="card-top">
              <span class="card-name">${esc(entry.name)}</span>
              <span class="party-chip">${partyChipText(entry)}</span>
              <span class="status-badge seated">${statusLabel('seated')}</span>
            </div>
            <div class="card-meta">${buildContactHtml(entry)}</div>
            <div class="time-meta">
              <div class="time-item"><span>Dodano</span>${formatTime(entry.timestamp)}</div>
              <div class="time-item"><span>Prije</span>${minutesAgo(entry.timestamp)}m</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="action-btn btn-remove" data-action="remove" data-id="${entry.id}">Ukloni</button>
          </div>`;
        seatedList.appendChild(card);
      });
    }
    seatedList.classList.toggle('open', seatedOpen);
    seatedIcon.classList.toggle('open', seatedOpen);
  } else {
    seatedSection.classList.add('hidden-init');
  }
}

// ─── Admin Bookings ─────────────────────────────
let pastBookingsOpen = false;

function bookingStatusLabel(s) {
  if (s === 'pending')    return '◌ Na čekanju';
  if (s === 'bconfirmed') return '● Potvrđeno';
  if (s === 'cancelled')  return '✕ Otkazano';
  if (s === 'completed')  return '✓ Završeno';
  return s;
}

function buildBookingCardHtml(entry) {
  const svgCal = `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  const ago = minutesAgo(entry.timestamp);
  const timeLabel = entry.timeLabel || entry.time;
  let actions = '';
  if (entry.status === 'pending') {
    actions += `<button class="action-btn btn-bconfirm"  data-action="bconfirm"  data-id="${entry.id}">Potvrdi</button>`;
    actions += `<button class="action-btn btn-bcancel"   data-action="bcancel"   data-id="${entry.id}">Otkaži</button>`;
  } else if (entry.status === 'bconfirmed') {
    actions += `<button class="action-btn btn-bcomplete" data-action="bcomplete" data-id="${entry.id}">Završi</button>`;
    actions += `<button class="action-btn btn-bcancel"   data-action="bcancel"   data-id="${entry.id}">Otkaži</button>`;
  } else {
    actions += `<button class="action-btn btn-remove"    data-action="bremove"   data-id="${entry.id}">Ukloni</button>`;
  }
  return `
    <div class="card-num booking-num">${svgCal}</div>
    <div class="card-body">
      <div class="card-top">
        <span class="card-name">${esc(entry.name)}</span>
        <span class="party-chip">${partyChipText(entry)}</span>
        <span class="status-badge ${entry.status}">${bookingStatusLabel(entry.status)}</span>
      </div>
      <div class="booking-datetime-chip">📅 ${formatBookingDate(entry.date)} · ${esc(timeLabel)}</div>
      <div class="card-meta">${buildContactHtml(entry)}</div>
      ${entry.notes ? `<div class="card-meta"><div class="contact-item"><span class="ci-icon">✍️</span>${esc(entry.notes)}</div></div>` : ''}
      <div class="time-meta">
        <div class="time-item"><span>Dodano</span>${formatTime(entry.timestamp)}</div>
        <div class="time-item"><span>Prije</span>${ago}m</div>
      </div>
    </div>
    <div class="card-actions">${actions}</div>`;
}

function renderBookingsPanel() {
  const all          = getUpcomingBookings();
  const today        = todayISO();
  const todayActive  = all.filter(b => b.date === today && (b.status === 'pending' || b.status === 'bconfirmed'));
  const upcoming     = all.filter(b => b.date > today  && (b.status === 'pending' || b.status === 'bconfirmed'));
  const past         = bookings.filter(b => b.status === 'cancelled' || b.status === 'completed')
                               .sort((a, b) => b.timestamp - a.timestamp);
  const total = todayActive.length + upcoming.length;
  document.getElementById('atab-bookings-count').textContent = total;
  document.getElementById('admin-booking-count').textContent = total;

  function renderList(listId, entries, emptyMsg) {
    const el = document.getElementById(listId); if (!el) return;
    el.innerHTML = '';
    if (entries.length === 0) {
      el.innerHTML = `<div class="empty-state"><div class="es-sub">${emptyMsg}</div></div>`;
      return;
    }
    entries.forEach(entry => {
      const card = document.createElement('div');
      card.className = `queue-card status-${entry.status} ${sizeClass(entry.partySize)}`;
      card.innerHTML = buildBookingCardHtml(entry);
      el.appendChild(card);
    });
  }

  renderList('today-bookings-list', todayActive, 'Nema aktivnih rezervacija za danas');
  renderList('upcoming-bookings-list', upcoming, 'Nema nadolazećih rezervacija');

  const pastSection = document.getElementById('past-bookings-section');
  const pastList    = document.getElementById('past-bookings-list');
  const pastTitle   = document.getElementById('past-bookings-title');
  const pastIcon    = document.getElementById('past-bookings-icon');
  if (past.length > 0) {
    pastSection.classList.remove('hidden-init');
    pastTitle.textContent = `Završene / Otkazane (${past.length})`;
    pastList.innerHTML = '';
    if (pastBookingsOpen) {
      past.forEach(entry => {
        const card = document.createElement('div');
        card.className = `queue-card status-${entry.status}`;
        card.innerHTML = buildBookingCardHtml(entry);
        pastList.appendChild(card);
      });
    }
    pastList.classList.toggle('open', pastBookingsOpen);
    pastIcon.classList.toggle('open', pastBookingsOpen);
  } else {
    pastSection.classList.add('hidden-init');
  }
}

function switchAdminTab(tab) {
  currentAdminTab = tab;
  document.getElementById('atab-waitlist').classList.toggle('active', tab === 'waitlist');
  document.getElementById('atab-bookings').classList.toggle('active', tab === 'bookings');
  document.getElementById('admin-waitlist-panel').classList.toggle('hidden-init', tab !== 'waitlist');
  document.getElementById('admin-bookings-panel').classList.toggle('hidden-init', tab !== 'bookings');
  if (tab === 'bookings') renderBookingsPanel();
  else renderAdmin();
}

function initAdminView() {
  startClock();
  renderAdmin();

  if (adminInited) return;
  adminInited = true;

  document.getElementById('sort-toggle').addEventListener('click', () => {
    sortBySize = !sortBySize;
    document.getElementById('sort-toggle').textContent = sortBySize ? 'Sort: Veličina ↓' : 'Sort: Vrijeme ↓';
    renderAdmin();
  });
  document.getElementById('seated-toggle').addEventListener('click', () => {
    seatedOpen = !seatedOpen;
    renderAdmin();
  });
  document.getElementById('clear-seated-btn').addEventListener('click', () => clearSeated());
  document.getElementById('past-bookings-toggle').addEventListener('click', () => {
    pastBookingsOpen = !pastBookingsOpen;
    renderBookingsPanel();
  });
  document.getElementById('clear-past-btn').addEventListener('click', () => clearPastBookings());
  document.querySelector('.admin-section-tabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-atab]');
    if (tab) switchAdminTab(tab.dataset.atab);
  });
  document.querySelector('.admin-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'notify')    updateStatus(id, 'notified');
    if (action === 'seat')      updateStatus(id, 'seated');
    if (action === 'remove')    removeGuest(id);
    if (action === 'bconfirm')  updateBookingStatus(id, 'bconfirmed');
    if (action === 'bcomplete') updateBookingStatus(id, 'completed');
    if (action === 'bcancel')   updateBookingStatus(id, 'cancelled');
    if (action === 'bremove')   removeBooking(id);
  });
}

// ═══════════════════════════════════════════════════
//  ADMIN PIN
// ═══════════════════════════════════════════════════
const ADMIN_PIN = '123321';

function isAdminAuthed() {
  return sessionStorage.getItem('adminAuth') === '1';
}

function showPinOverlay() {
  document.getElementById('guest-view').classList.remove('active');
  document.getElementById('admin-view').classList.remove('active');
  document.getElementById('pin-overlay').classList.add('active');
  const digits = document.querySelectorAll('.pin-digit');
  digits.forEach(d => d.value = '');
  setTimeout(() => digits[0].focus(), 100);
}

function initPinOverlay() {
  const digits    = document.querySelectorAll('.pin-digit');
  const submitBtn = document.getElementById('pin-submit');
  const errEl     = document.getElementById('pin-error');

  function checkPin() {
    const entered = Array.from(digits).map(d => d.value).join('');
    if (entered === ADMIN_PIN) {
      sessionStorage.setItem('adminAuth', '1');
      document.getElementById('pin-overlay').classList.remove('active');
      document.getElementById('admin-view').classList.add('active');
      initAdminView();
    } else {
      errEl.classList.add('visible');
      digits.forEach(d => { d.classList.add('shake'); d.value = ''; });
      setTimeout(() => {
        digits.forEach(d => d.classList.remove('shake'));
        digits[0].focus();
      }, 500);
    }
  }

  digits.forEach((digit, i) => {
    digit.addEventListener('input', () => {
      digit.value = digit.value.replace(/\D/g, '').slice(-1);
      errEl.classList.remove('visible');
      if (digit.value && i < digits.length - 1) digits[i + 1].focus();
    });
    digit.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !digit.value && i > 0) digits[i - 1].focus();
      if (e.key === 'Enter') checkPin();
    });
    digit.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
      text.split('').forEach((ch, j) => { if (digits[j]) digits[j].value = ch; });
      digits[Math.min(text.length, digits.length - 1)].focus();
    });
  });

  submitBtn.addEventListener('click', checkPin);
}

// ═══════════════════════════════════════════════════
//  ROUTER
// ═══════════════════════════════════════════════════
function route() {
  const isAdmin    = location.hash === '#admin';
  const guestView  = document.getElementById('guest-view');
  const adminView  = document.getElementById('admin-view');
  const pinOverlay = document.getElementById('pin-overlay');

  if (isAdmin) {
    if (isAdminAuthed()) {
      guestView.classList.remove('active');
      pinOverlay.classList.remove('active');
      adminView.classList.add('active');
      initAdminView();
    } else {
      showPinOverlay();
    }
  } else {
    adminView.classList.remove('active');
    pinOverlay.classList.remove('active');
    stopClock();
    guestView.classList.add('active');
    resetGuestForm();
    clearBookingCountdown();
    switchMode('waitlist');
  }
}

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
initFirestore();
initGuestView();
initPinOverlay();
window.addEventListener('hashchange', route);
route();
