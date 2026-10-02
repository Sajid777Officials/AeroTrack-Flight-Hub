export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AeroTrack Activity Records</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#13243a;background:#edf3f8}*{box-sizing:border-box}body{margin:0;padding:24px}.shell{width:min(1100px,100%);margin:0 auto}.top{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:18px}.eyebrow{margin:0 0 5px;color:#1667b7;font-size:.73rem;font-weight:800;letter-spacing:.1em}.top h1{margin:0;font-size:clamp(1.8rem,4vw,3rem);letter-spacing:-.04em}.top p:not(.eyebrow){margin:8px 0 0;color:#607087}.panel{padding:20px;border:1px solid #d4e0ea;border-radius:18px;background:#fff;box-shadow:0 16px 35px rgba(18,48,76,.1)}.login{display:flex;align-items:end;gap:10px;flex-wrap:wrap}.field{display:grid;gap:6px;flex:1;min-width:240px;color:#607087;font-size:.78rem;font-weight:700}.field input,.field select{height:44px;padding:0 12px;border:1px solid #cddae6;border-radius:11px;background:#f7fafc;color:#13243a;font:inherit}.button{min-height:44px;padding:10px 15px;border:1px solid transparent;border-radius:11px;background:#1667b7;color:#fff;font:inherit;font-weight:800;cursor:pointer}.button.secondary{border-color:#cddae6;background:#f5f8fb;color:#173b5e}.button:disabled{opacity:.6;cursor:wait}.status{min-height:22px;margin:14px 0 0;color:#607087;font-size:.85rem}.status.error{color:#b22933}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 10px}.toolbar h2{margin:0;font-size:1.1rem}.toolbar-actions{display:flex;gap:8px}.table-wrap{overflow:auto;border:1px solid #d7e2ec;border-radius:14px}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:11px 12px;border-bottom:1px solid #e3ebf2;text-align:left;font-size:.82rem;white-space:nowrap}th{position:sticky;top:0;background:#f2f7fb;color:#52667d;font-size:.73rem;text-transform:uppercase}tbody tr:last-child td{border-bottom:0}.empty{text-align:center;color:#607087;padding:32px}.foot{margin:14px 0 0;color:#6d7e91;font-size:.74rem}@media(max-width:720px){body{padding:14px}.top{align-items:stretch;flex-direction:column}.login{align-items:stretch;flex-direction:column}.toolbar{align-items:stretch;flex-direction:column}.toolbar-actions{display:grid;grid-template-columns:1fr 1fr}.toolbar-actions .button{width:100%}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="top"><div><p class="eyebrow">AEROTRACK BACKEND</p><h1>Activity records</h1><p>Authorized view of consented active-domain records.</p></div></header>
    <section class="panel">
      <form class="login" id="login-form">
        <label class="field"><span>Admin token</span><input id="token" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>Records</span><select id="limit"><option>50</option><option selected>100</option><option>250</option><option>500</option></select></label>
        <button class="button" id="load" type="submit">Load records</button>
      </form>
      <p class="status" id="status" role="status" aria-live="polite">Enter the private admin token to continue.</p>
      <div id="records" hidden>
        <div class="toolbar"><h2>Latest records</h2><div class="toolbar-actions"><button class="button secondary" id="refresh" type="button">Refresh</button><button class="button secondary" id="download" type="button">Download CSV</button></div></div>
        <div class="table-wrap"><table><thead><tr><th>Server time</th><th>Domain</th><th>Installation ID</th></tr></thead><tbody id="rows"></tbody></table></div>
        <p class="foot">Only the active hostname, random installation ID, and server receive time are stored.</p>
      </div>
    </section>
  </main>
  <script>
    const form = document.querySelector('#login-form');
    const tokenInput = document.querySelector('#token');
    const limitInput = document.querySelector('#limit');
    const statusBox = document.querySelector('#status');
    const records = document.querySelector('#records');
    const rows = document.querySelector('#rows');
    const loadButton = document.querySelector('#load');
    let adminToken = '';

    function setStatus(message, error = false) {
      statusBox.textContent = message;
      statusBox.className = error ? 'status error' : 'status';
    }

    function cell(value) {
      const element = document.createElement('td');
      element.textContent = String(value || '—');
      return element;
    }

    function render(items) {
      if (!items.length) {
        const row = document.createElement('tr');
        const empty = document.createElement('td');
        empty.colSpan = 3;
        empty.className = 'empty';
        empty.textContent = 'No records found.';
        row.append(empty);
        rows.replaceChildren(row);
        return;
      }
      rows.replaceChildren(...items.map((item) => {
        const row = document.createElement('tr');
        row.append(cell(new Date(item.receivedAt).toLocaleString()), cell(item.domain), cell(item.installationId));
        return row;
      }));
    }

    async function loadRecords() {
      if (!adminToken) adminToken = tokenInput.value.trim();
      if (!adminToken) return;
      loadButton.disabled = true;
      setStatus('Loading records…');
      try {
        const response = await fetch('/api/admin/activity?limit=' + encodeURIComponent(limitInput.value), {
          headers: { Authorization: 'Bearer ' + adminToken },
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Unable to load records.');
        render(payload.records || []);
        records.hidden = false;
        tokenInput.value = '';
        setStatus(payload.count + ' record' + (payload.count === 1 ? '' : 's') + ' loaded.');
      } catch (error) {
        adminToken = '';
        records.hidden = true;
        setStatus(error.message || 'Unable to load records.', true);
      } finally {
        loadButton.disabled = false;
      }
    }

    async function downloadCsv() {
      if (!adminToken) return setStatus('Load records again before downloading.', true);
      try {
        const response = await fetch('/api/admin/activity.csv?limit=5000', {
          headers: { Authorization: 'Bearer ' + adminToken },
        });
        if (!response.ok) throw new Error('Unable to download CSV.');
        const href = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = href;
        link.download = 'aerotrack-activity.csv';
        link.click();
        URL.revokeObjectURL(href);
        setStatus('CSV download started.');
      } catch (error) {
        setStatus(error.message || 'Unable to download CSV.', true);
      }
    }

    form.addEventListener('submit', (event) => { event.preventDefault(); adminToken = tokenInput.value.trim(); loadRecords(); });
    document.querySelector('#refresh').addEventListener('click', loadRecords);
    document.querySelector('#download').addEventListener('click', downloadCsv);
  </script>
</body>
</html>`;
