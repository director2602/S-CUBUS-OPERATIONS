// Demo data: ~60 days of realistic activity across 3 branches. Runs only when the database has no purchases yet.
const bcrypt = require('bcryptjs');
const { q, one } = require('./db');
const F = require('./finance');

let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const ri = (a, b) => Math.floor(rnd() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const nowHM = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(11, 16);

const FIRST = ['Rahul', 'Priya', 'Amit', 'Neha', 'Sanjay', 'Pooja', 'Vikas', 'Anjali', 'Rohit', 'Kavita', 'Deepak', 'Sunita', 'Manish', 'Ritu', 'Arjun', 'Meena', 'Karan', 'Shalini', 'Vivek', 'Nisha'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Yadav', 'Kumar', 'Jain', 'Mehta', 'Arora', 'Malhotra', 'Chauhan', 'Rawat', 'Bansal', 'Saxena'];
const name = () => `${pick(FIRST)} ${pick(LAST)}`;
const phone = () => '9' + String(ri(100000000, 999999999));

async function seedDemo() {
  const has = await one('SELECT COUNT(*)::int AS n FROM purchases');
  const done = await one("SELECT value FROM settings WHERE key='demo_seeded'");
  if (has.n > 0 || done) return;
  console.log('Seeding demo data…');
  await q("UPDATE branches SET name='Branch A', code='A' WHERE id=(SELECT MIN(id) FROM branches)");
  const nb = await one('SELECT COUNT(*)::int AS n FROM branches');
  if (nb.n < 3) await q("INSERT INTO branches (name, code) VALUES ('Branch B','B'), ('Branch C','C')");
  const branches = await q('SELECT * FROM branches ORDER BY id');
  const pw = await bcrypt.hash('Demo@123', 10);
  const users = {};
  const mk = async (nm, email, role, b, desig) => {
    const u = await one(`INSERT INTO users (name, email, phone, role, designation, branch_id, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING *`, [nm, email, phone(), role, desig, b.id, pw]);
    return u;
  };
  users.admin = await mk('Office Admin', 'admin@demo.scubus', 'admin', branches[0], 'Admin Head');
  users.accounts = await mk('Accounts Desk', 'accounts@demo.scubus', 'accounts', branches[0], 'Accountant');
  for (const [i, b] of branches.entries()) {
    const c = b.code.toLowerCase();
    users['manager' + i] = await mk(`${b.name} Manager`, `manager.${c}@demo.scubus`, 'manager', b, 'Branch Coordinator');
    users['guard' + i] = await mk(`${pick(['Ram', 'Shyam', 'Mohan', 'Suresh'])} (Guard ${b.code})`, `guard.${c}@demo.scubus`, 'guard', b, 'Security Guard');
    users['guardn' + i] = await mk(`${pick(['Raju', 'Dinesh', 'Mahesh', 'Bablu'])} (Night guard ${b.code})`, `nightguard.${c}@demo.scubus`, 'guard', b, 'Security Guard');
    users['ob' + i] = await mk(`${pick(['Sonu', 'Monu', 'Pappu', 'Golu'])} (Office boy ${b.code})`, `officeboy.${c}@demo.scubus`, 'office_boy', b, 'Office Boy');
    users['hk' + i] = await mk(`${pick(['Kamla', 'Savitri', 'Geeta', 'Lata'])} (Housekeeping ${b.code})`, `housekeeping.${c}@demo.scubus`, 'housekeeping', b, 'Housekeeping');
    users['rc' + i] = await mk(`${pick(['Simran', 'Aarti', 'Komal', 'Jyoti'])} (Reception ${b.code})`, `reception.${c}@demo.scubus`, 'staff', b, 'Receptionist');
  }
  users.driver = await mk('Harish (Driver)', 'driver@demo.scubus', 'driver', branches[0], 'Driver');
  const owner = await one("SELECT * FROM users WHERE role='owner' ORDER BY id LIMIT 1");
  await q("UPDATE register_defs SET branch_id=$1 WHERE key='vehicle'", [branches[0].id]);

  const vendorRows = [
    ['Gupta Stationers', 'Stationery & printing'], ['Delhi Book Depot', 'Books & study material'], ['CleanPro Supplies', 'Housekeeping supplies'],
    ['Sharma Electricals', 'Maintenance & repairs'], ['CoolAir AC Services', 'Maintenance & repairs'], ['Kumar Tees & Uniforms', 'Uniforms & merchandise'],
    ['TechZone IT', 'IT & electronics'], ['BSES Rajdhani', 'Utilities'], ['Airtel Business', 'Utilities'], ['Blue Dart', 'Courier & postage'], ['Haldiram Caterers', 'Refreshments & pantry']
  ];
  const vendors = [];
  for (const [vn, cat] of vendorRows) {
    vendors.push(await one('INSERT INTO vendors (name, category, phone, gstin, address) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [vn, cat, phone(), '07' + String(ri(10000, 99999)) + 'ABCDE' + ri(1, 9) + 'Z' + ri(1, 9), 'New Delhi']));
  }
  const cats = Object.fromEntries((await q('SELECT * FROM expense_categories')).map((c) => [c.name, c.id]));
  const itemRows = [
    ['A4 paper (ream)', 'Stationery', 'ream', 20, 260, 'Gupta Stationers'], ['Whiteboard markers', 'Stationery', 'pcs', 40, 35, 'Gupta Stationers'],
    ['Register notebooks', 'Stationery', 'pcs', 30, 60, 'Gupta Stationers'], ['Physics module – Class 11', 'Study material', 'pcs', 50, 320, 'Delhi Book Depot'],
    ['Chemistry module – Class 11', 'Study material', 'pcs', 50, 320, 'Delhi Book Depot'], ['Maths module – Class 12', 'Study material', 'pcs', 50, 340, 'Delhi Book Depot'],
    ['Foundation kit – Class 9', 'Study material', 'kit', 30, 950, 'Delhi Book Depot'], ['S-CUBUS T-shirt (M)', 'Merchandise', 'pcs', 25, 240, 'Kumar Tees & Uniforms'],
    ['S-CUBUS T-shirt (L)', 'Merchandise', 'pcs', 25, 240, 'Kumar Tees & Uniforms'], ['ID card with lanyard', 'Merchandise', 'pcs', 40, 45, 'Kumar Tees & Uniforms'],
    ['Floor cleaner (5 L)', 'Housekeeping', 'can', 6, 420, 'CleanPro Supplies'], ['Hand wash (5 L)', 'Housekeeping', 'can', 4, 380, 'CleanPro Supplies'],
    ['Garbage bags (roll)', 'Housekeeping', 'roll', 15, 90, 'CleanPro Supplies'], ['Tube light 20W', 'Electrical', 'pcs', 10, 210, 'Sharma Electricals']
  ];
  const items = [];
  for (const [n, c, u, min, rate, vn] of itemRows) {
    const it = await one('INSERT INTO items (name, category, unit, min_stock, rate) VALUES ($1,$2,$3,$4,$5) RETURNING *', [n, c, u, min, rate]);
    it.vendor = vendors.find((v) => v.name === vn); items.push(it);
  }

  const T = todayIST();
  const start = addDays(T, -62);
  // opening stock
  for (const b of branches) {
    for (const it of items) {
      const qty = Math.round(it.min_stock * (1.2 + rnd() * 1.6));
      await F.moveStock({ q, one }, { item_id: it.id, branch_id: b.id, qty, type: 'opening', ref_type: 'manual', remarks: 'Opening stock', user_id: owner.id });
    }
  }
  await q("UPDATE stock_movements SET created_at = $1::date + time '09:00' WHERE type='opening'", [start]);
  // petty cash opening top-ups
  for (const b of branches) await F.pettyTopup(users.accounts, b.id, { amount: 15000, payment_mode: 'bank_transfer', mode_details: { reference: 'UTR' + ri(100000, 999999) }, date: start, narration: 'Opening petty cash float' });

  const mgr = (i) => users['manager' + i];
  const approverFor = (amt, i) => (amt <= 5000 ? mgr(i) : users.accounts);

  for (let d = 0; d <= 62; d += 1) {
    const date = addDays(start, d);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const isToday = date === T;
    const sunday = dow === 0;
    const growth = 1 + d / 200;
    for (const [i, b] of branches.entries()) {
      const busy = [1, 0.75, 1.25][i] * growth * (sunday ? 0.35 : 1);
      const entry = async (key, data, hm, by, status) => {
        if (isToday && hm > nowHM()) return;
        const def = await one('SELECT id FROM register_defs WHERE key=$1', [key]);
        const st = status || (d < 55 ? pick(['verified', 'verified', 'verified', 'reviewed']) : (d < 61 ? pick(['verified', 'submitted']) : 'submitted'));
        await q(`INSERT INTO register_entries (register_id, branch_id, entry_date, data, status, created_by, created_at, verified_by, verified_at)
          VALUES ($1,$2,$3,$4,$5,$6, ($3::date + $7::time) AT TIME ZONE 'Asia/Kolkata', $8, CASE WHEN $5 IN ('verified','reviewed') THEN ($3::date + time '21:00') AT TIME ZONE 'Asia/Kolkata' END)`,
        [def.id, b.id, date, JSON.stringify(data), st, by.id, hm, ['verified', 'reviewed'].includes(st) ? mgr(i).id : null]);
      };
      const hm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      // Opening checklist
      const missOpen = rnd() < 0.04;
      if (!missOpen) {
        const checks = {};
        ['Electricity', 'Internet', 'AC', 'Lights', 'CCTV', 'Reception', 'Classrooms', 'Washrooms', 'Water', 'Security', 'Cleanliness'].forEach((c) => {
          const fail = rnd() < 0.03; checks[c] = { status: fail ? 'Not Completed' : 'Completed', remark: fail ? pick(['Internet down till 10 AM', 'Water tank low', 'AC remote missing']) : '' };
        });
        await entry('opening', { checklist: checks }, hm(rnd() < 0.08 ? 10 : 8, ri(5, 55)), users['guard' + i]);
      }
      // Security shifts
      for (const [shift, s, e, g] of [['Morning', '07:00', '15:00', 'guard'], ['Night', '15:00', '23:00', 'guardn']]) {
        if (rnd() < 0.03 && d < 61) continue;
        const subH = shift === 'Morning' ? hm(14, ri(30, 59)) : hm(rnd() < 0.07 ? 22 : 21, ri(10, 59));
        await entry('security', { shift, guard_name: users[g + i].name, shift_start: s, shift_end: e, visitors: ri(5, 25), deliveries: ri(0, 4), vehicles: ri(1, 6), incidents: 0,
          opening_condition: 'All normal', closing_condition: shift === 'Night' ? 'Premises locked' : 'Handed over', remarks: '' }, subH, users[g + i]);
      }
      // Visitors
      const nv = Math.round(ri(14, 26) * busy);
      for (let k = 0; k < nv; k += 1) {
        const type = rnd() < 0.5 ? 'Parent' : (rnd() < 0.6 ? 'Student' : 'Other');
        const h = ri(9, 18); const m = ri(0, 59);
        const inT = `${date}T${hm(h, m)}`;
        const outMin = h * 60 + m + ri(10, 75);
        const done = !isToday || outMin < Number(nowHM().slice(0, 2)) * 60 + Number(nowHM().slice(3));
        const purpose = type === 'Parent' ? pick(['Admission enquiry', 'Fee payment', 'Parent-teacher meeting', 'Counselling', 'Result / test query']) :
          (type === 'Student' ? pick(['Attend class / test', 'Document submission', 'Fee payment', 'Counselling']) : pick(['Vendor / delivery', 'Interview', 'Official', 'Other']));
        await entry('visitor', {
          visitor_type: type, visitor_type_other: type === 'Other' ? pick(['Vendor representative', 'Job applicant', 'Relative of student', 'Government official']) : undefined,
          visitor_name: name(), student_name: type !== 'Other' ? `${pick(FIRST)} ${pick(LAST)} / SCB-${String(ri(1, 2400)).padStart(6, '0')}` : undefined,
          phone: phone(), purpose, person_to_meet: pick(['Counsellor', 'Branch Manager', 'Accounts', 'Physics faculty', 'Reception']),
          entry_time: inT, exit_time: done ? `${date}T${hm(Math.min(20, Math.floor(outMin / 60)), outMin % 60)}` : '', id_type: 'None', visitors_count: ri(1, 2)
        }, hm(h, m), users['guard' + i]);
      }
      // Couriers, deliveries
      if (!sunday) {
        for (let k = 0; k < ri(1, 4); k += 1) {
          await entry('courier', { direction: pick(['Incoming', 'Incoming', 'Outgoing']), courier_type: pick(['Document', 'Parcel', 'Books / Material']), courier_company: pick(['Blue Dart', 'DTDC', 'India Post', 'Delhivery']),
            tracking_number: 'TRK' + ri(1000000, 9999999), sender: pick(['NTA', 'Delhi Book Depot', 'Parent', 'Head office']), recipient: pick(['Accounts', 'Branch Manager', 'Reception']),
            courier_status: pick(['Received', 'Delivered', 'Delivered', 'Pending']) }, hm(ri(10, 17), ri(0, 59)), users['rc' + i]);
        }
        for (let k = 0; k < ri(0, 2); k += 1) {
          await entry('delivery', { delivery_type: pick(['Inventory', 'Food', 'Equipment', 'Documents']), from_vendor: pick(vendors).name, items_description: 'As per challan', quantity: ri(1, 6), received_by: users['guard' + i].name, time: hm(ri(10, 17), ri(0, 59)) }, hm(ri(10, 17), ri(0, 59)), users['guard' + i]);
        }
      }
      // Housekeeping
      const missHk = rnd() < 0.05;
      if (!missHk) {
        for (const area of ['Classrooms', 'Washrooms', 'Reception']) {
          const checks = {};
          ['Floor cleaned', 'Dustbins emptied', 'Washrooms cleaned', 'Water available', 'Pantry cleaned', 'Classrooms ready'].forEach((c) => {
            const fail = rnd() < 0.04; checks[c] = { status: fail ? 'Not Completed' : 'Completed', remark: fail ? 'Supplies finished' : '' };
          });
          const issue = rnd() < 0.06 ? pick(['Tap leaking in washroom', 'Dustbin broken', 'Floor tiles cracked']) : '';
          await entry('housekeeping', { area, cleaning_time: hm(8, ri(0, 50)), checklist: checks, issue_found: issue, task_status: issue ? 'Partly done' : 'Done' }, hm(rnd() < 0.1 ? 11 : 9, ri(0, 59)), users['hk' + i]);
        }
      }
      // Keys
      if (!sunday && rnd() < 0.7) {
        const returned = !isToday || rnd() < 0.5;
        await entry('key', { key_id: 'K-' + ri(1, 30), key_name: pick(['Store room', 'Server room', 'Lab', 'Principal office', 'Terrace']), issued_to: name(), issued_at: `${date}T${hm(ri(9, 12), 0)}`,
          returned_at: returned ? `${date}T${hm(ri(13, 18), 0)}` : '', key_status: returned ? 'Available' : 'Issued', condition: 'Good' }, hm(ri(9, 12), 5), users['guard' + i]);
      }
      // Closing
      if (!isToday && rnd() > 0.03) {
        const checks = {};
        ['AC off', 'Lights off', 'Computers off', 'Doors checked', 'Windows checked', 'CCTV checked', 'Documents secured', 'Cash / petty cash secured', 'Water / electricity checked', 'Main gate locked'].forEach((c) => { checks[c] = { status: 'Completed', remark: '' }; });
        await entry('closing', { checklist: checks }, hm(21, ri(0, 40)), users['guardn' + i]);
      }
      // Reception & utility
      {
        await entry('reception', { calls_received: ri(20, 60), walk_ins: nv, enquiries: ri(4, 15), admissions: ri(0, 4) }, hm(19, ri(0, 25)), users['rc' + i]);
        await entry('utility', { meter_reading: 10000 + d * 120 + i * 5000, units_consumed: ri(90, 160), generator_hours: rnd() < 0.2 ? ri(1, 3) : 0 }, hm(19, ri(30, 55)), users['rc' + i]);
      }
      // Maintenance
      if (rnd() < 0.18 * (i === 1 ? 1.6 : 1)) {
        const issues = [['Projector not working', 'Room 3', 'Projector – Room 3'], ['Tap leaking', 'Washroom 2nd floor', ''], ['AC not cooling', 'Classroom 2', 'AC – Classroom 2'],
          ['Tube light fused', 'Corridor', ''], ['Chair broken', 'Classroom 5', ''], ['Wi-Fi not reachable', 'Staff room', 'Router – Staff room'], ['Door lock jammed', 'Store', '']];
        const [iss, loc, asset] = i === 0 && rnd() < 0.35 ? issues[0] : pick(issues);
        const age = 62 - d;
        const st = age > 6 ? pick(['Closed', 'Resolved', 'Closed']) : pick(['Open', 'Assigned', 'In progress', 'Resolved']);
        await entry('maintenance', { issue: iss, location: loc, asset, priority: pick(['Low', 'Medium', 'Medium', 'High']), description: `${iss} in ${loc}.`, issue_status: st,
          assigned_to: st === 'Open' ? '' : 'Sharma Electricals', estimated_cost: ri(2, 30) * 100, completion_date: ['Resolved', 'Closed'].includes(st) ? addDays(date, ri(0, 3)) : '' },
        hm(ri(9, 17), ri(0, 59)), pick([users['hk' + i], users['guard' + i], users['rc' + i]]));
      }
      // Incidents
      if (rnd() < 0.035) {
        const sev = pick(['Low', 'Low', 'Medium', 'High']);
        await entry('incident', { incident_type: pick(['Safety', 'Medical', 'Student conduct', 'Theft / Loss', 'Property damage']), severity: sev, time: hm(ri(10, 18), 0), location: pick(['Corridor', 'Classroom 4', 'Parking', 'Reception']),
          description: pick(['Student felt dizzy during test, first aid given', 'Argument between two students', 'Mobile phone reported missing', 'Glass pane cracked by ball']),
          immediate_action: 'Informed branch manager', incident_status: 62 - d > 4 ? 'Closed' : pick(['Open', 'Investigating']) }, hm(ri(10, 18), 15), users['guard' + i]);
      }
      // Lost & found
      if (rnd() < 0.08) {
        await entry('lost_found', { item: pick(['Water bottle', 'Calculator', 'Umbrella', 'Wallet', 'ID card', 'Earphones']), found_date: date, location: pick(['Classroom 3', 'Washroom', 'Reception', 'Library']),
          found_by: users['hk' + i].name, storage_location: 'Reception drawer', lf_status: 62 - d > 10 ? pick(['Returned', 'Claimed', 'Unclaimed']) : pick(['Found', 'Under Verification']) }, hm(ri(10, 18), 30), users['hk' + i]);
      }
      // Vehicle (branch A only)
      if (i === 0 && !sunday) {
        const sk = 42000 + d * 55;
        await entry('vehicle', { vehicle_number: 'DL01AB1234', vehicle_type: 'Van', driver: users.driver.name, start_km: sk, end_km: sk + ri(25, 80), purpose: pick(['Bank work', 'Material pickup', 'Branch transfer', 'Student event']),
          fuel_litres: rnd() < 0.25 ? ri(15, 30) : '', fuel_cost: '' }, hm(19, ri(0, 50)), users.driver);
      }
      // Inventory issues to students
      if (!sunday) {
        const issueItems = [items[3], items[4], items[5], items[6], items[7], items[8], items[9], items[0], items[1]];
        for (let k = 0; k < ri(1, 4); k += 1) {
          const it = pick(issueItems);
          const qty = it.unit === 'ream' ? ri(1, 3) : (it.category === 'Study material' ? Math.round(ri(4, 14) * busy) : ri(2, 8));
          const cur = await F.stockOf({ q, one }, it.id, b.id);
          if (cur >= qty) {
            await F.moveStock({ q, one }, { item_id: it.id, branch_id: b.id, qty: -qty, type: 'issue', ref_type: 'manual', issued_to: it.category === 'Study material' || it.category === 'Merchandise' ? 'New admissions batch' : 'Faculty', user_id: mgr(i).id });
            await q(`UPDATE stock_movements SET created_at=($1::date + time '13:00') AT TIME ZONE 'Asia/Kolkata' WHERE id=(SELECT MAX(id) FROM stock_movements)`, [date]);
          }
        }
        if (rnd() < 0.05) {
          const it = pick(items);
          if (await F.stockOf({ q, one }, it.id, b.id) > 2) {
            await F.moveStock({ q, one }, { item_id: it.id, branch_id: b.id, qty: -ri(1, 2), type: pick(['loss', 'damage']), ref_type: 'manual', remarks: 'Found during stock check', user_id: mgr(i).id });
            await q(`UPDATE stock_movements SET created_at=($1::date + time '17:00') AT TIME ZONE 'Asia/Kolkata' WHERE id=(SELECT MAX(id) FROM stock_movements)`, [date]);
          }
        }
      }
      // Purchases by petty cash / various modes
      if (!sunday) {
        const n = ri(0, 2) + (rnd() < 0.3 ? 1 : 0);
        for (let k = 0; k < n; k += 1) {
          const kindRoll = rnd();
          let body;
          if (kindRoll < 0.45) {
            body = { kind: 'expense', vendor_name: pick(['Local kirana store', 'Chai stall', 'Xerox shop', 'Hardware shop', 'Auto rickshaw']), category_id: cats[pick(['Refreshments & pantry', 'Stationery & printing', 'Maintenance & repairs', 'Transport & fuel', 'Courier & postage'])],
              description: pick(['Tea & snacks for parent meeting', 'Photocopies of test papers', 'Plumbing fittings', 'Auto fare for bank work', 'Speed post to NTA']),
              payment_mode: 'petty_cash', lines: [{ description: 'As per bill', qty: 1, rate: ri(4, 40) * 25 }] };
          } else {
            const v = pick(vendors.filter((x) => !['BSES Rajdhani', 'Airtel Business'].includes(x.name)));
            const its = items.filter((it) => it.vendor && it.vendor.id === v.id);
            const mode = pick(['upi', 'bank_transfer', 'cheque', 'card', 'credit', 'credit', 'cash']);
            const lines = its.length ? its.slice(0, ri(1, Math.min(3, its.length))).map((it) => ({ item_id: it.id, description: it.name, qty: Math.round(it.min_stock * (0.6 + rnd())), unit: it.unit, rate: it.rate, gst_rate: it.category === 'Study material' ? 0 : 18 }))
              : [{ description: v.category === 'Maintenance & repairs' ? pick(['AC servicing', 'Electrical repair work', 'Projector repair']) : 'Services', qty: 1, rate: ri(8, 60) * 100, gst_rate: 18 }];
            body = { kind: its.length ? 'purchase' : 'expense', vendor_id: v.id, category_id: cats[v.category], description: `${v.category} – ${v.name}`, payment_mode: mode,
              bill_no: 'INV-' + ri(1000, 9999), bill_date: date, lines,
              mode_details: { reference: ['upi', 'bank_transfer'].includes(mode) ? 'UTR' + ri(10000000, 99999999) : undefined, cheque_no: mode === 'cheque' ? String(ri(100000, 999999)) : undefined, bank: mode === 'cheque' ? 'HDFC Bank' : undefined,
                card_last4: mode === 'card' ? '4521' : undefined, due_date: mode === 'credit' ? addDays(date, 15) : undefined } };
          }
          body.date = date;
          const creator = body.payment_mode === 'petty_cash' ? users['ob' + i] : mgr(i);
          let id;
          try { id = await F.createPurchase(creator, body, b.id); } catch (e) {
            if (body.payment_mode === 'petty_cash') {
              await F.pettyTopup(users.accounts, b.id, { amount: 10000, payment_mode: 'cash', date, narration: 'Petty cash replenishment' });
              id = await F.createPurchase(creator, body, b.id);
            } else throw e;
          }
          const p = await one('SELECT total FROM purchases WHERE id=$1', [id]);
          if (62 - d > 2 || rnd() < 0.4) {
            if (rnd() < 0.04) await F.rejectPurchase(users.accounts, id, 'Duplicate bill');
            else await F.approvePurchase(p.total <= 5000 ? mgr(i) : users.accounts, id);
          }
        }
      }
      // Petty cash replenishment when low
      const bal = await F.pettyBalance(null, b.id);
      if (bal < 4000) await F.pettyTopup(users.accounts, b.id, { amount: 10000, payment_mode: pick(['cash', 'bank_transfer']), mode_details: { reference: 'UTR' + ri(100000, 999999) }, date, narration: 'Petty cash replenishment' });
      // Tasks for office boy
      if (!sunday) {
        for (let k = 0; k < ri(2, 5); k += 1) {
          const done = 62 - d > 3 ? true : (!isToday ? rnd() < 0.8 : rnd() < 0.5);
          const due = addDays(date, ri(0, 2));
          const late = done && rnd() < 0.12;
          const comp = late ? addDays(due, 1) : date;
          await q(`INSERT INTO tasks (title, category, branch_id, assigned_to, requested_by, priority, status, due_date, created_at, started_at, completed_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ($9::date + time '10:00') AT TIME ZONE 'Asia/Kolkata', ($9::date + time '10:30') AT TIME ZONE 'Asia/Kolkata', $10)`,
          [pick(['Collect documents from bank', 'Deliver courier to head office', 'Purchase stationery', 'Bring refreshments for meeting', 'Move files to store', 'Room setup for test', 'Event support – seminar', 'Get photocopies made']),
            'Errand', b.id, users['ob' + i].id, mgr(i).id, pick(['normal', 'normal', 'high', 'low']), done ? 'done' : (rnd() < 0.5 ? 'in_progress' : 'pending'), due, date,
            done ? `${comp} 16:00+05:30` : null]);
        }
      }
    }
  }
  // Payments against older credit purchases
  const credits = await q("SELECT * FROM purchases WHERE status='approved' AND payment_mode='credit' AND date < $1 ORDER BY date", [addDays(T, -12)]);
  for (const p of credits) {
    if (rnd() < 0.8) {
      const mode = pick(['bank_transfer', 'cheque', 'upi']);
      await F.recordPayment(users.accounts, p.id, { amount: p.total, payment_mode: mode, date: addDays(p.date, ri(7, 14)), approve_now: true,
        mode_details: { reference: 'UTR' + ri(10000000, 99999999), cheque_no: String(ri(100000, 999999)), bank: 'HDFC Bank' } });
    }
  }
  await q("UPDATE stock_movements m SET created_at = (p.date + time '12:00') AT TIME ZONE 'Asia/Kolkata' FROM purchases p WHERE m.ref_type='purchase' AND m.ref_id=p.id");
  await q("UPDATE purchases SET approved_at=(date + time '18:00') AT TIME ZONE 'Asia/Kolkata', created_at=(date + time '11:00') AT TIME ZONE 'Asia/Kolkata' WHERE date < CURRENT_DATE");
  await q("UPDATE vouchers SET approved_at=(date + time '18:00') AT TIME ZONE 'Asia/Kolkata', created_at=(date + time '11:00') AT TIME ZONE 'Asia/Kolkata' WHERE date < CURRENT_DATE");
  // Documents
  const docs = [['Fire NOC', 'license', 0, 18], ['Trade licence', 'license', 1, 26], ['Lift AMC', 'contract', 0, 41], ['Internet service agreement', 'contract', 2, 55],
    ['Shop & Establishment registration', 'license', 2, 210], ['Building insurance', 'insurance', null, 95], ['Rent agreement', 'contract', 1, 300], ['Pollution certificate – DL01AB1234', 'certificate', 0, -3]];
  for (const [t, ty, bi, days] of docs) {
    await q("INSERT INTO documents (title, doc_type, branch_id, number, issued_on, expires_on, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now() - interval '20 days')",
      [t, ty, bi === null ? null : branches[bi].id, 'NO-' + ri(10000, 99999), addDays(T, days - 365), addDays(T, days), owner.id]);
  }
  await q("INSERT INTO settings (key, value) VALUES ('demo_seeded', 'true') ON CONFLICT (key) DO NOTHING");
  if (process.env.DEMO_LOGINS !== 'true') {
    await q("UPDATE users SET active=false WHERE email LIKE '%@demo.scubus'");
    console.log('Demo data ready. Demo staff accounts are blocked from signing in (set DEMO_LOGINS=true to allow).');
  } else console.log('Demo data ready. Demo logins use password Demo@123.');
}

module.exports = { seedDemo };
