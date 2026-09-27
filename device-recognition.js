(() => {
  const LABEL = "📸 التعرّف على الجهاز";
  const PERMISSION = "device_recognition";
  const LEGACY_PERMISSION = "compatibility";
  const IDENTITY_FIELDS = [
    ["manufacturer", "الشركة"],
    ["deviceName", "اسم الجهاز"],
    ["model", "الموديل"],
    ["modelNumber", "رقم الموديل"]
  ];
  const FIELDS = [
    ["memory", "التخزين / الذاكرة"],
    ["ram", "الرام"],
    ["processor", "المعالج"],
    ["display", "الشاشة"],
    ["cameras", "الكاميرات"],
    ["battery", "البطارية"],
    ["networks", "الشبكات"],
    ["supports5G", "دعم 5G"],
    ["operatingSystem", "نظام التشغيل"],
    ["additional", "مواصفات إضافية"]
  ];
  const styles = `
    #deviceRecognition{max-width:900px;margin:0 auto;padding:14px}
    #deviceRecognition .recognition-title{color:#0d1b35;margin:0 0 8px}
    #deviceRecognition .recognition-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    #deviceRecognition .recognition-photo{display:block;width:100%;max-height:420px;object-fit:contain;border-radius:14px;margin:10px auto;background:#f4f7fb}
    #deviceRecognition .recognition-result{border:1px solid #e3e9f2;border-radius:14px;padding:14px;margin-top:12px;background:#fff}
    #deviceRecognition .recognition-specs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    #deviceRecognition .recognition-spec{background:#f7f9fc;border-radius:10px;padding:10px}
    #deviceRecognition .recognition-help{font-size:13px;color:#6b7890;line-height:1.8}
    @media(max-width:650px){#deviceRecognition .recognition-grid,#deviceRecognition .recognition-specs{grid-template-columns:1fr}}
  `;

  const currentUserValue = () => typeof currentUser !== "undefined" ? currentUser : null;
  const currentPermissions = () => Array.isArray(currentUserValue()?.permissions) ? currentUserValue().permissions : [];
  const isManager = () => Boolean(currentUserValue()?.username) && currentUserValue()?.role === "مدير";
  const canUse = () => isManager() || (Boolean(currentUserValue()?.username) && currentPermissions().includes(PERMISSION));
  const navButton = () => document.querySelector('.container > .nav button[data-tab="deviceRecognition"], .refNav button[data-tab="deviceRecognition"]');

  function migrateLegacyPermissions() {
    const appDb = typeof db !== "undefined" ? db : null;
    if (!Array.isArray(appDb?.employees)) return;
    let changed = false;
    for (const employee of appDb.employees) {
      if (!Array.isArray(employee.permissions) || !employee.permissions.includes(LEGACY_PERMISSION)) continue;
      employee.permissions = [...new Set(employee.permissions.filter((permission) => permission !== LEGACY_PERMISSION).concat(PERMISSION))];
      changed = true;
    }
    if (changed && typeof window.save === "function") window.save();
  }

  function mount() {
    if (document.getElementById("deviceRecognition")) return;
    const nav = document.querySelector(".container > .nav") || document.querySelector(".refNav");
    if (!nav) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tab = "deviceRecognition";
    button.textContent = LABEL;
    button.addEventListener("click", () => window.show("deviceRecognition"));
    nav.appendChild(button);

    const section = document.createElement("section");
    section.id = "deviceRecognition";
    section.className = "section";
    section.innerHTML = `
      <div class="card">
        <h2 class="recognition-title">${LABEL}</h2>
        <p class="recognition-help">صوّر أو ارفع صورة واضحة لظهر الجهاز، مع إظهار أي كتابة أو رقم موديل مطبوع. لن نستنتج اسم الجهاز من الشكل أو الشعار.</p>
        <p class="recognition-help">تُرسل الصورة إلى مزود تحليل الصور المضبوط على الخادم عند طلب التحليل، ولا تُحفظ في قاعدة بيانات الموقع. لا ترفع صورة يظهر فيها IMEI أو رقم تسلسلي أو بيانات شخصية.</p>
        <form id="deviceRecognitionForm" class="form">
          <input id="deviceRecognitionImage" class="input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="صورة ظهر الهاتف" required>
          <img id="deviceRecognitionPreview" class="recognition-photo" alt="معاينة صورة الجهاز" hidden>
          <button id="deviceRecognitionSubmit" class="btn" type="submit">حلّل الصورة</button>
        </form>
        <div id="deviceRecognitionMessage" class="recognition-help" aria-live="polite"></div>
        <div id="deviceRecognitionResults"></div>
      </div>`;
    document.body.appendChild(section);
    document.getElementById("deviceRecognitionForm").addEventListener("submit", analyzeImage);
    document.getElementById("deviceRecognitionImage").addEventListener("change", showPreview);
    updatePermissionUi();
  }

  function installStyles() {
    if (document.getElementById("deviceRecognitionStyles")) return;
    const style = document.createElement("style");
    style.id = "deviceRecognitionStyles";
    style.textContent = styles;
    document.head.appendChild(style);
  }

  function installEmployeePermission() {
    const form = document.querySelector('#employees form[onsubmit*="addEmployee"]');
    if (!form) return;
    let checkbox = document.getElementById("pDeviceRecognition");
    if (!checkbox) {
      const row = [...form.querySelectorAll(".row")].find((item) => item.querySelector("#pSales"));
      if (!row) return;
      const label = document.createElement("label");
      label.innerHTML = '<input type="checkbox" id="pDeviceRecognition"> 📸 التعرّف على الجهاز';
      row.appendChild(label);
      checkbox = label.querySelector("input");
    }
    if (checkbox.dataset.deviceRecognitionBound) return;
    checkbox.dataset.deviceRecognitionBound = "1";
    const originalAddEmployee = window.addEmployee;
    if (typeof originalAddEmployee !== "function") return;
    window.addEmployee = function(event) {
      const enabled = checkbox.checked;
      const username = document.getElementById("eUser")?.value.trim();
      originalAddEmployee(event);
      if (!enabled || !username) return;
      const appDb = typeof db !== "undefined" ? db : null;
      const employee = appDb?.employees?.find((item) => item.username === username);
      if (!employee) return;
      employee.permissions = [...new Set([...(employee.permissions || []), PERMISSION])];
      window.save?.();
      window.renderEmployees?.();
    };
  }

  function updatePermissionUi() {
    migrateLegacyPermissions();
    const button = navButton();
    if (button) button.hidden = !canUse();
    installEmployeePermission();
  }

  function toJpegDataUrl(file) {
    return createImageBitmap(file).then((bitmap) => new Promise((resolve, reject) => {
      const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) { bitmap.close?.(); reject(new Error("تعذر تجهيز الصورة")); return; }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const exportAtQuality = (quality) => canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("تعذر قراءة الصورة")); return; }
        if (blob.size > 2.8 * 1024 * 1024 && quality > 0.62) exportAtQuality(quality - 0.08);
        else if (blob.size > 3 * 1024 * 1024) reject(new Error("الصورة كبيرة جدًا؛ اختر صورة أصغر."));
        else {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("تعذرت قراءة الصورة"));
          reader.readAsDataURL(blob);
        }
      }, "image/jpeg", quality);
      exportAtQuality(0.88);
    }));
  }

  function showPreview() {
    const file = document.getElementById("deviceRecognitionImage").files?.[0];
    const preview = document.getElementById("deviceRecognitionPreview");
    document.getElementById("deviceRecognitionResults").replaceChildren();
    if (!file) { preview.hidden = true; preview.removeAttribute("src"); return; }
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 16 * 1024 * 1024) {
      document.getElementById("deviceRecognitionMessage").textContent = "اختر صورة JPG أو PNG أو WEBP بحجم لا يتجاوز 16 ميغابايت.";
      preview.hidden = true;
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    document.getElementById("deviceRecognitionMessage").textContent = "راجع الصورة قبل التحليل؛ تُرسل فقط عند الضغط على زر التحليل.";
  }

  function appendText(parent, tag, text, className = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function renderResults(result) {
    const root = document.getElementById("deviceRecognitionResults");
    root.replaceChildren();
    const card = document.createElement("div");
    card.className = "recognition-result";
    appendText(card, "h3", "نتيجة القراءة من الصورة");
    const identityGrid = document.createElement("div");
    identityGrid.className = "recognition-specs";
    for (const [key, label] of IDENTITY_FIELDS) {
      const item = document.createElement("div");
      item.className = "recognition-spec";
      appendText(item, "b", label);
      appendText(item, "div", result[key] || "غير واضحة من الصورة");
      identityGrid.appendChild(item);
    }
    card.appendChild(identityGrid);
    if (result.identificationEvidence) appendText(card, "p", `النص المقروء: ${result.identificationEvidence}`, "recognition-help");
    appendText(card, "p", result.message || "لم تُستنتج أي مواصفات غير ظاهرة.", "recognition-help");
    appendText(card, "h3", "المواصفات الظاهرة فقط");
    const grid = document.createElement("div");
    grid.className = "recognition-specs";
    for (const [key, label] of FIELDS) {
      const item = result.specifications?.[key];
      const spec = document.createElement("div");
      spec.className = "recognition-spec";
      appendText(spec, "b", label);
      const value = key === "supports5G"
        ? item?.value === true ? "يظهر نص 5G بالصورة" : item?.value === false ? "يظهر نص يدل على 4G فقط بالصورة" : "غير واضحة من الصورة"
        : item?.value || "غير واضحة من الصورة";
      appendText(spec, "div", value);
      if (item?.evidence) appendText(spec, "small", `النص الظاهر: ${item.evidence}`, "recognition-help");
      grid.appendChild(spec);
    }
    card.appendChild(grid);
    appendText(card, "p", "هذه قراءة للنص الظاهر في الصورة، وليست تحققًا من مواصفات الجهاز الداخلية أو من قاعدة بيانات الشركة المصنّعة.", "recognition-help");
    root.appendChild(card);
  }

  async function analyzeImage(event) {
    event.preventDefault();
    if (!canUse()) {
      document.getElementById("deviceRecognitionMessage").textContent = "هذه الميزة غير متاحة لحسابك.";
      return;
    }
    const file = document.getElementById("deviceRecognitionImage").files?.[0];
    const message = document.getElementById("deviceRecognitionMessage");
    const submit = document.getElementById("deviceRecognitionSubmit");
    if (!file) { message.textContent = "اختر صورة واضحة لظهر الهاتف أولًا."; return; }
    submit.disabled = true;
    message.textContent = "جارٍ قراءة النص الظاهر في الصورة…";
    document.getElementById("deviceRecognitionResults").replaceChildren();
    try {
      const image = await toJpegDataUrl(file);
      const result = await window.API.request("/device-recognition", { method: "POST", body: JSON.stringify({ image }) });
      renderResults(result);
      message.textContent = "اكتمل فحص الصورة.";
    } catch (error) {
      message.textContent = error.message || "تعذر تحليل الصورة. أعد المحاولة بصورة أوضح.";
    } finally {
      submit.disabled = false;
    }
  }

  function installPermissionWrappers() {
    const originalCanAccess = window.canAccess;
    if (typeof originalCanAccess === "function") window.canAccess = function(section) {
      if (section === "deviceRecognition") return canUse();
      return originalCanAccess(section);
    };
    const originalApply = window.applyEmployeePermissions;
    if (typeof originalApply === "function") window.applyEmployeePermissions = function() {
      originalApply();
      updatePermissionUi();
      window.dispatchEvent(new Event("device-recognition:permissions"));
    };
    const originalPermissionName = window.permissionName;
    if (typeof originalPermissionName === "function") window.permissionName = function(permission) {
      if (permission === PERMISSION || permission === LEGACY_PERMISSION) return LABEL;
      return originalPermissionName(permission);
    };
  }

  installStyles();
  installPermissionWrappers();
  mount();
})();