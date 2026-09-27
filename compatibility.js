(() => {
  const TYPES = {
    cases: "📱 أغطية / كفرات",
    screens: "🖥️ شاشات",
    charging_flex_ic: "🔌 فلات / IC شحن",
    fingerprint: "👆 بصمة",
    chargers_power: "⚡ شواحن وقدرة الشحن"
  };
  const STATUS = {
    confirmed: "مطابق مؤكد",
    possible: "مطابقة محتملة",
    no_reliable_match: "لا يوجد تطابق موثوق"
  };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const apiUrl = (path) => `${window.API?.base || "/api"}${path}`;
  const isManager = () => typeof currentUser !== "undefined" && currentUser?.role === "مدير";
  const canSeeCompatibility = () => isManager() || (typeof currentUser !== "undefined" && (currentUser?.permissions || []).includes("compatibility"));

  function installStyles() {
    if (document.getElementById("compatibilityStyles")) return;
    const style = document.createElement("style");
    style.id = "compatibilityStyles";
    style.textContent = `
      #compatibility{max-width:1180px;margin:0 auto;padding:14px}
      #compatibility .compat-title{color:#0d1b35;margin:0 0 8px}
      #compatibility .compat-form{display:grid;gap:10px}
      #compatibility .compat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      #compatibility .compat-status{display:inline-block;border-radius:999px;padding:5px 10px;font-weight:bold;font-size:13px}
      #compatibility .compat-confirmed{background:#e7f7ef;color:#087744}
      #compatibility .compat-possible{background:#fff4d8;color:#8b5b00}
      #compatibility .compat-none{background:#f1f4f8;color:#596579}
      #compatibility .compat-record{border:1px solid #e3e9f2;border-radius:14px;padding:14px;margin-top:10px;background:white}
      #compatibility .compat-source{font-size:13px;overflow-wrap:anywhere}
      #compatibility .compat-admin{border-top:4px solid #0757d9}
      #compatibility .compat-small{font-size:13px;color:#6b7890;line-height:1.7}
      #compatibility textarea{min-height:76px}
      #compatibility .compat-danger{background:#d9363e;color:#fff}
      @media(max-width:650px){#compatibility .compat-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  async function request(path, options = {}) {
    if (window.API?.request) return window.API.request(path, options);
    const response = await fetch(apiUrl(path), {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function mount() {
    const container = document.querySelector(".container") || document.body;
    const nav = document.querySelector(".container > .nav") || document.querySelector(".refNav");
    if (!nav || document.getElementById("compatibility")) return;

    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.tab = "compatibility";
    tab.textContent = "توافق القطع";
    tab.addEventListener("click", () => show("compatibility"));
    nav.appendChild(tab);

    const section = document.createElement("section");
    section.id = "compatibility";
    section.className = "section";
    section.innerHTML = `
      <div class="card">
        <h2 class="compat-title">البحث عن توافق قطع الهواتف</h2>
        <p class="compat-small">اختر نوع القطعة واكتب موديل الهاتف كما هو. لا يتم استنتاج التوافق من تشابه الأسماء. تظهر العلاقة المؤكدة فقط مع مصدر ودليل راجعهما المدير.</p>
        <form id="compatSearchForm" class="compat-form">
          <div class="compat-grid">
            <select id="compatSearchType" class="input" required aria-label="نوع القطعة">
              <option value="">اختر نوع القطعة</option>
              ${Object.entries(TYPES).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
            </select>
            <input id="compatSearchModel" class="input" maxlength="160" placeholder="موديل الهاتف (اختياري عند البحث بـ SKU أو الاسم)">
          </div>
          <input id="compatSearchQuery" class="input" maxlength="100" placeholder="SKU أو اسم القطعة (اختياري)">
          <button class="btn" type="submit">ابحث عن التوافق</button>
        </form>
        <div id="compatSearchResults" aria-live="polite"></div>
        <p class="compat-small">لا يوجد تعرف آلي على موديل الهاتف من الصورة. يمكن إضافة رابط صورة للقطعة الآن، وتجهيز التعرف على الصور يتطلب خدمة مستقلة لاحقًا.</p>
      </div>
      <div id="compatAdminPanel" class="card compat-admin" hidden>
        <h2 class="compat-title">إدارة علاقات التوافق</h2>
        <p class="compat-small">تُحفظ بيانات الإدارة في قاعدة البيانات. أدخل كل موديل مرتبط في سطر مستقل أو افصل بينها بفاصلة. الحالة الافتراضية محتملة. التأكيد يتطلب مراجعة دليل موثوق ونطاق المصدر ضمن إعداد COMPATIBILITY_TRUSTED_HOSTS.</p>
        <form id="compatAdminForm" class="compat-form">
          <div class="compat-grid">
            <select id="compatType" class="input" required>
              ${Object.entries(TYPES).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
            </select>
            <input id="compatName" class="input" required maxlength="180" placeholder="اسم القطعة">
          </div>
          <div class="compat-grid">
            <input id="compatSku" class="input" maxlength="80" placeholder="SKU (اختياري)">
            <input id="compatBrand" class="input" maxlength="120" placeholder="شركة الهاتف (اختياري)">
          </div>
          <textarea id="compatModels" class="input" required placeholder="موديل واحد في كل سطر، أو افصل بينها بفاصلة"></textarea>
          <input id="compatDeviceImageUrl" class="input" type="url" placeholder="رابط صورة موديل واحد اختياري؛ لا يوجد تعرّف آلي من الصورة">
          <textarea id="compatAliases" class="input" placeholder="أسماء بديلة للموديل فقط، عندما تكون موثقة"></textarea>
          <div class="compat-grid">
            <select id="compatStatus" class="input">
              <option value="possible">مطابقة محتملة</option>
              <option value="confirmed">مطابق مؤكد بعد توثيق المصدر</option>
            </select>
            <input id="compatImageUrl" class="input" type="url" placeholder="رابط صورة القطعة (اختياري؛ لا تحليل صور)">
          </div>
          <input id="compatSourceName" class="input" maxlength="180" placeholder="اسم الشركة المصنّعة أو المورد الموثوق">
          <input id="compatSourceUrl" class="input" type="url" placeholder="رابط دليل التوافق أو صفحة المصدر">
          <textarea id="compatEvidence" class="input" placeholder="ما الدليل الذي تمت مراجعته؟ مطلوب للتأكيد"></textarea>
          <textarea id="compatNotes" class="input" placeholder="ملاحظات الملاءمة أو اختلاف النسخة"></textarea>
          <button class="btn" type="submit">حفظ علاقات التوافق</button>
        </form>
        <div id="compatAdminMessage" class="compat-small" aria-live="polite"></div>
        <h3>السجلات الحالية</h3>
        <div id="compatAdminRecords"></div>
      </div>`;
    container.appendChild(section);
    document.getElementById("compatSearchForm").addEventListener("submit", search);
    document.getElementById("compatAdminForm").addEventListener("submit", saveRecords);
    updatePermissionUi();
    window.addEventListener("compatibility:permissions", updatePermissionUi);
  }

  function updatePermissionUi() {
    const tab = document.querySelector('.nav button[data-tab="compatibility"], .refNav button[data-tab="compatibility"]');
    if (tab) tab.hidden = !canSeeCompatibility();
    installEmployeePermission();
  }

  function statusPill(status) {
    const css = status === "confirmed" ? "compat-confirmed" : status === "possible" ? "compat-possible" : "compat-none";
    return `<span class="compat-status ${css}">${STATUS[status] || STATUS.no_reliable_match}</span>`;
  }

  function renderResults(payload) {
    const target = document.getElementById("compatSearchResults");
    const records = payload.records || [];
    if (!records.length) {
      target.innerHTML = '<div class="compat-record">' + statusPill("no_reliable_match") + '<p>' + esc(payload.message || "لا توجد نتيجة موثوقة حاليًا") + '</p></div>';
      return;
    }
    target.innerHTML = '<div class="compat-record">' + statusPill(payload.status) + '</div>' + records.map((record) => {
      const source = record.source || {};
      const confidence = record.confidence || {};
      const updatedAt = source.updatedAt ? new Date(source.updatedAt).toLocaleString("ar-IQ") : "غير متاح";
      const sku = record.part.sku ? ' · <b>SKU:</b> ' + esc(record.part.sku) : "";
      const brand = record.model.brand ? esc(record.model.brand) + " " : "";
      const sourceLink = source.url ? ' · <a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">رابط المصدر</a>' : "";
      const evidence = source.evidence ? '<br>' + esc(source.evidence) : "";
      return '<article class="compat-record">' +
        statusPill(record.status) +
        '<h3>' + esc(record.part.name) + '</h3>' +
        '<p><b>النوع:</b> ' + esc(TYPES[record.part.type] || record.part.type) + sku + '</p>' +
        '<p><b>موديل الهاتف:</b> ' + brand + esc(record.model.name) + '</p>' +
        (record.part.notes ? '<p>' + esc(record.part.notes) + '</p>' : "") +
        (record.notes ? '<p><b>ملاحظة:</b> ' + esc(record.notes) + '</p>' : "") +
        '<p class="compat-source"><b>المصدر:</b> ' + esc(source.name || "غير متاح") + sourceLink + evidence + '</p>' +
        '<p class="compat-small"><b>تاريخ تحديث المصدر:</b> ' + esc(updatedAt) + ' · <b>مستوى الثقة:</b> ' + esc(confidence.label || "غير متاحة") + '</p>' +
        '</article>';
    }).join("");
  }
  async function search(event) {
    event.preventDefault();
    const target = document.getElementById("compatSearchResults");
    target.innerHTML = '<div class="compat-record">جارٍ البحث…</div>';
    const model = document.getElementById("compatSearchModel").value.trim();
    const query = document.getElementById("compatSearchQuery").value.trim();
    if (!model && !query) {
      target.innerHTML = '<div class="compat-record">اكتب موديل الهاتف أو SKU / اسم القطعة للبحث.</div>';
      return;
    }
    const params = new URLSearchParams({
      type: document.getElementById("compatSearchType").value,
      model,
      q: query
    });
    try {
      renderResults(await request(`/compatibility?${params}`));
    } catch (error) {
      target.innerHTML = `<div class="compat-record">تعذر البحث في قاعدة البيانات: ${esc(error.message)}</div>`;
    }
  }

  async function refreshAdmin() {
    const panel = document.getElementById("compatAdminPanel");
    if (!panel) return;
    if (!isManager() || document.getElementById("dashboard")?.style.display === "none") {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const target = document.getElementById("compatAdminRecords");
    if (!target) return;
    target.innerHTML = '<p class="compat-small">جارٍ تحميل السجلات…</p>';
    try {
      const payload = await request("/compatibility?admin=1");
      if (!payload.records.length) {
        target.innerHTML = '<p class="compat-small">لا توجد علاقات توافق بعد. لم تُضف بيانات افتراضية.</p>';
        return;
      }
      target.innerHTML = payload.records.map((record) => `
        <div class="compat-record">
          ${statusPill(record.status)} <b>${esc(record.part.name)}</b>
          <p>SKU: ${esc(record.part.sku || "—")} · النوع: ${esc(TYPES[record.part.type] || record.part.type)} · الموديل: ${esc(record.model.brand ? `${record.model.brand} ` : "")}${esc(record.model.name)}</p>
          ${record.source.url ? `<p class="compat-small">المصدر: ${esc(record.source.name || record.source.url)} · ${esc(record.source.url)}</p>` : ""}
          <button class="btn compat-danger" type="button" data-delete-relation="${esc(record.id)}">حذف العلاقة</button>
        </div>`).join("");
      target.querySelectorAll("[data-delete-relation]").forEach((button) => button.addEventListener("click", () => deleteRelation(button.dataset.deleteRelation)));
    } catch (error) {
      target.innerHTML = `<p class="compat-small">تعذر تحميل لوحة الإدارة. تحقق من اتصال قاعدة البيانات وجلسة المدير: ${esc(error.message)}</p>`;
    }
  }

  async function saveRecords(event) {
    event.preventDefault();
    if (!isManager()) return;
    const message = document.getElementById("compatAdminMessage");
    const input = {
      type: document.getElementById("compatType").value,
      name: document.getElementById("compatName").value.trim(),
      sku: document.getElementById("compatSku").value.trim(),
      brand: document.getElementById("compatBrand").value.trim(),
      models: document.getElementById("compatModels").value,
      deviceImageUrl: document.getElementById("compatDeviceImageUrl").value.trim(),
      aliases: document.getElementById("compatAliases").value,
      status: document.getElementById("compatStatus").value,
      imageUrl: document.getElementById("compatImageUrl").value.trim(),
      sourceName: document.getElementById("compatSourceName").value.trim(),
      sourceUrl: document.getElementById("compatSourceUrl").value.trim(),
      evidence: document.getElementById("compatEvidence").value.trim(),
      notes: document.getElementById("compatNotes").value.trim()
    };
    message.textContent = "جارٍ الحفظ…";
    try {
      const response = await request("/compatibility", { method: "POST", body: JSON.stringify(input) });
      message.textContent = `تم حفظ العلاقة مع ${response.relations.length} موديل/موديلات.`;
      document.getElementById("compatAdminForm").reset();
      await refreshAdmin();
    } catch (error) {
      message.textContent = `لم يتم الحفظ: ${error.message}`;
    }
  }

  async function deleteRelation(id) {
    if (!isManager() || !confirm("حذف علاقة التوافق هذه؟")) return;
    try {
      await request(`/compatibility?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshAdmin();
    } catch (error) {
      window.alert(`تعذر حذف العلاقة: ${error.message}`);
    }
  }

  function installEmployeePermission() {
    const form = document.querySelector('#employees form[onsubmit*="addEmployee"]');
    if (!form) return;
    let checkbox = document.getElementById("pCompatibility");
    if (!checkbox) {
      const row = [...form.querySelectorAll(".row")].find((item) => item.querySelector("#pSales"));
      if (!row) return;
      const label = document.createElement("label");
      label.innerHTML = '<input type="checkbox" id="pCompatibility"> توافق القطع';
      row.appendChild(label);
      checkbox = label.querySelector("input");
    }
    if (checkbox.dataset.compatBound) return;
    checkbox.dataset.compatBound = "1";
    const oldAdd = window.addEmployee;
    if (typeof oldAdd === "function") window.addEmployee = function(event) {
      const enabled = checkbox.checked;
      const username = document.getElementById("eUser")?.value.trim();
      oldAdd(event);
      if (enabled && username) {
        const employee = db.employees.find((item) => item.username === username);
        if (employee) {
          employee.permissions = [...new Set([...(employee.permissions || []), "compatibility"])];
          save();
          renderEmployees();
        }
      }
    };
  }

  function installPermissionWrappers() {
    const oldCanAccess = window.canAccess;
    if (typeof oldCanAccess === "function") window.canAccess = function(section) {
      if (section === "compatibility") return canSeeCompatibility();
      return oldCanAccess(section);
    };
    const oldApply = window.applyEmployeePermissions;
    if (typeof oldApply === "function") window.applyEmployeePermissions = function() {
      oldApply();
      const tab = document.querySelector('.nav button[data-tab="compatibility"], .refNav button[data-tab="compatibility"]');
      if (tab && !isManager()) tab.hidden = !canSeeCompatibility();
      window.dispatchEvent(new Event("compatibility:permissions"));
    };
    const oldPermissionName = window.permissionName;
    if (typeof oldPermissionName === "function") window.permissionName = function(permission) {
      return permission === "compatibility" ? "توافق القطع" : oldPermissionName(permission);
    };
  }

  installStyles();
  installPermissionWrappers();
  mount();
  installEmployeePermission();
  const oldRenderAdmin = window.renderAdmin;
  if (typeof oldRenderAdmin === "function") window.renderAdmin = function() {
    oldRenderAdmin();
    installEmployeePermission();
    refreshAdmin();
  };
  document.querySelector('.nav button[data-tab="compatibility"], .refNav button[data-tab="compatibility"]')?.addEventListener("click", refreshAdmin);
  window.addEventListener("compatibility:permissions", refreshAdmin);
})();
