const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
  settings: {},
  documents: [],
  favorites: [],
  mails: [],
  todos: [],
  notes: [],
  music: []
};

const els = {
  clock: $("#clock"),
  dateLine: $("#date-line"),
  topDate: $("#top-date"),
  greeting: $("#greeting"),
  welcome: $("#welcome-copy"),
  brandOwner: $("#brand-owner"),
  brandSubtitle: $("#brand-subtitle"),
  quote: $("#quote-pill"),
  docsList: $("#docs-list"),
  favoritesGrid: $("#favorites-grid"),
  mailList: $("#mail-list"),
  mailBadge: $("#mail-badge"),
  todoList: $("#todo-list"),
  todoForm: $("#todo-form"),
  fileInput: $("#file-input"),
  modal: $("#app-modal"),
  modalTitle: $("#modal-title"),
  modalBody: $("#modal-body"),
  toast: $(".toast"),
  trackTitle: $("#track-title"),
  trackArtist: $("#track-artist"),
  musicCurrent: $("#music-current"),
  musicDuration: $("#music-duration"),
  musicProgress: $("#music-progress"),
  playButton: $(".play-toggle")
};

const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
let toastTimer = 0;
let trackIndex = 0;
let playing = false;
let trackProgress = 0;
let audioContext = null;
let oscillator = null;
let gainNode = null;

function h(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDuration(seconds = 0) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "local";
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 2400);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? undefined : { "content-type": "application/json" },
    ...options
  });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || response.statusText || "请求失败");
  return payload;
}

async function refreshState() {
  const data = await api("/api/state");
  Object.assign(state, data);
  renderAll();
}

function renderSettings() {
  els.brandOwner.textContent = state.settings.owner || "我的主页";
  els.brandSubtitle.textContent = state.settings.subtitle || "Harith Home";
  els.welcome.textContent = state.settings.welcome || "欢迎回来，今天也要元气满满哦~";
  els.quote.textContent = state.settings.quote || "如花美眷，似水流年。";
}

function renderDocuments() {
  if (!state.documents.length) {
    els.docsList.innerHTML = `<p class="empty-state">还没有文档，点击“新建”或“上传”。</p>`;
    return;
  }
  els.docsList.innerHTML = state.documents.slice(0, 8).map((doc) => `
    <div class="doc-row item-row">
      <span class="file ${h(doc.kind || "md")}">${h((doc.kind || "F").slice(0, 3).toUpperCase())}</span>
      <strong title="${h(doc.title)}">${h(doc.title)}</strong>
      <time>${h(formatTime(doc.updatedAt))}</time>
      <small>${h(doc.size || "0 KB")}</small>
      <span class="row-actions">
        ${doc.storedName ? `<button type="button" data-doc-download="${h(doc.id)}" aria-label="下载 ${h(doc.title)}"><svg><use href="#icon-external"></use></svg></button>` : ""}
        <button type="button" data-doc-delete="${h(doc.id)}" aria-label="删除 ${h(doc.title)}"><svg><use href="#icon-trash"></use></svg></button>
      </span>
    </div>
  `).join("");
}

function renderFavorites() {
  const cards = state.favorites.slice(0, 8).map((fav) => `
    <div class="favorite-card">
      <button type="button" class="favorite-open" data-fav-open="${h(fav.id)}">
        <span class="site-icon" style="background:${h(fav.color || "#3b8cff")}">${h(fav.icon || "★")}</span>
        <strong>${h(fav.title)}</strong>
        <small>${h(hostOf(fav.url))}</small>
      </button>
      <button type="button" class="mini-delete" data-fav-delete="${h(fav.id)}" aria-label="删除 ${h(fav.title)}"><svg><use href="#icon-trash"></use></svg></button>
    </div>
  `).join("");
  els.favoritesGrid.innerHTML = `${cards}<button class="add-link" type="button" data-open-modal="favorite"><svg><use href="#icon-plus"></use></svg><strong>添加</strong></button>`;
}

function renderMails() {
  const unread = state.mails.filter((mail) => !mail.read).length;
  els.mailBadge.textContent = unread;
  if (!state.mails.length) {
    els.mailList.innerHTML = `<p class="empty-state">收件箱为空。</p>`;
    return;
  }
  els.mailList.innerHTML = state.mails.slice(0, 6).map((mail) => `
    <button type="button" class="mail-row ${mail.read ? "" : "unread"}" data-mail-id="${h(mail.id)}">
      <span class="mail-icon">${h(mail.icon || "✉")}</span>
      <span><strong>${h(mail.sender)}</strong><small>${h(mail.subject)}</small></span>
      <time>${h(formatTime(mail.time))}</time>
    </button>
  `).join("");
}

function renderTodos() {
  if (!state.todos.length) {
    els.todoList.innerHTML = `<p class="empty-state">待办清单空空的。</p>`;
    return;
  }
  els.todoList.innerHTML = state.todos.slice(0, 6).map((todo) => `
    <div class="todo-item ${todo.done ? "done" : ""}">
      <button type="button" data-todo-toggle="${h(todo.id)}" aria-label="切换待办状态">
        <svg><use href="${todo.done ? "#icon-check" : "#icon-clock"}"></use></svg>
      </button>
      <span>${h(todo.title)}</span>
      <button type="button" data-todo-delete="${h(todo.id)}" aria-label="删除待办"><svg><use href="#icon-trash"></use></svg></button>
    </div>
  `).join("");
}

function renderMusic() {
  const track = state.music[trackIndex] || state.music[0];
  if (!track) return;
  els.trackTitle.textContent = track.title;
  els.trackArtist.textContent = track.artist;
  els.musicDuration.textContent = `/ ${formatDuration(track.duration)}`;
  $(".heart-button").classList.toggle("active", Boolean(track.liked));
  updateMusicUi();
}

function renderAll() {
  renderSettings();
  renderDocuments();
  renderFavorites();
  renderMails();
  renderTodos();
  renderMusic();
}

function updateTime() {
  const now = new Date();
  const hour = now.getHours();
  const weekday = weekdays[now.getDay()];
  els.clock.textContent = `${pad(hour)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  els.dateLine.textContent = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}　${weekday}`;
  els.topDate.textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${weekday}`;
  if (hour < 6) els.greeting.textContent = "夜深啦！";
  else if (hour < 11) els.greeting.textContent = "早上好！";
  else if (hour < 14) els.greeting.textContent = "中午好！";
  else if (hour < 18) els.greeting.textContent = "下午好！";
  else els.greeting.textContent = "晚上好！";
}

function updateMusicUi() {
  const track = state.music[trackIndex] || { duration: 1 };
  const percent = Math.min(100, (trackProgress / track.duration) * 100);
  els.musicCurrent.textContent = formatDuration(trackProgress);
  els.musicProgress.style.width = `${percent}%`;
  els.playButton.querySelector("use").setAttribute("href", playing ? "#icon-pause" : "#icon-play");
}

function stopTone() {
  if (oscillator) {
    oscillator.stop();
    oscillator.disconnect();
    oscillator = null;
  }
  if (gainNode) {
    gainNode.disconnect();
    gainNode = null;
  }
}

async function startTone() {
  const track = state.music[trackIndex];
  if (!track) return;
  audioContext ||= new AudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();
  stopTone();
  oscillator = audioContext.createOscillator();
  gainNode = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = Number(track.tone || 440);
  gainNode.gain.value = 0.045;
  oscillator.connect(gainNode).connect(audioContext.destination);
  oscillator.start();
}

async function toggleMusic() {
  playing = !playing;
  if (playing) {
    await startTone();
    showToast("音乐已播放：本地合成音演示");
  } else {
    stopTone();
    showToast("音乐已暂停");
  }
  updateMusicUi();
}

async function changeTrack(direction) {
  if (!state.music.length) return;
  trackIndex = (trackIndex + direction + state.music.length) % state.music.length;
  trackProgress = 0;
  renderMusic();
  if (playing) await startTone();
}

async function likeTrack() {
  const track = state.music[trackIndex];
  if (!track) return;
  const updated = await api(`/api/music/${track.id}`, {
    method: "PATCH",
    body: JSON.stringify({ liked: !track.liked })
  });
  state.music = state.music.map((item) => item.id === updated.id ? updated : item);
  renderMusic();
}

async function refreshWeather() {
  const settings = state.settings || {};
  const query = new URLSearchParams({
    lat: settings.latitude ?? 31.2304,
    lon: settings.longitude ?? 121.4737,
    location: settings.locationLabel || "上海市 · 浦东新区"
  });
  const weather = await api(`/api/weather?${query}`);
  $("#weather-temp").textContent = Math.round(weather.temperature);
  $("#weather-feels").textContent = Math.round(weather.apparent);
  $("#weather-label").textContent = weather.label;
  $("#weather-humidity").textContent = `${Math.round(weather.humidity)}%`;
  $("#weather-wind").textContent = `${Math.round(weather.wind)} km/h`;
  $("#weather-source").textContent = weather.live ? "实时" : "离线";
  $("#weather-location").textContent = weather.location;
}

function closeModal() {
  els.modal.close();
  els.modalBody.innerHTML = "";
}

function setModal(title, body) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = body;
  els.modal.showModal();
}

function openModal(type, data = {}) {
  if (type === "document") {
    setModal("新建文档", `
      <form class="form-grid" data-form="document">
        <label>标题<input name="title" required placeholder="例如：部署记录.md"></label>
        <label>内容<textarea name="content" rows="7" placeholder="写点内容，会保存为 Markdown 文件。"></textarea></label>
        <button class="primary-button" type="submit">保存文档</button>
      </form>
    `);
  }

  if (type === "favorite") {
    setModal("新增收藏", `
      <form class="form-grid" data-form="favorite">
        <label>名称<input name="title" required placeholder="GitHub"></label>
        <label>网址<input name="url" required type="url" placeholder="https://github.com"></label>
        <label>图标字<input name="icon" maxlength="2" placeholder="GH"></label>
        <label>颜色<input name="color" type="color" value="#3b8cff"></label>
        <button class="primary-button" type="submit">保存收藏</button>
      </form>
    `);
  }

  if (type === "note") {
    setModal("记录灵感", `
      <form class="form-grid" data-form="note">
        <label>标题<input name="title" required placeholder="灵感标题"></label>
        <label>内容<textarea name="body" rows="6" required placeholder="把灵感先放在这里。"></textarea></label>
        <button class="primary-button" type="submit">保存笔记</button>
      </form>
    `);
  }

  if (type === "mail") {
    setModal("写本地邮件", `
      <form class="form-grid" data-form="mail">
        <label>发件人<input name="sender" required placeholder="系统通知"></label>
        <label>主题<input name="subject" required placeholder="新的提醒"></label>
        <label>内容<textarea name="body" rows="6" placeholder="邮件内容"></textarea></label>
        <button class="primary-button" type="submit">发送到本地收件箱</button>
      </form>
    `);
  }

  if (type === "settings") {
    setModal("主页设置", `
      <form class="form-grid" data-form="settings">
        <label>站点标题<input name="owner" value="${h(state.settings.owner || "")}"></label>
        <label>副标题<input name="subtitle" value="${h(state.settings.subtitle || "")}"></label>
        <label>欢迎语<input name="welcome" value="${h(state.settings.welcome || "")}"></label>
        <label>短句<input name="quote" value="${h(state.settings.quote || "")}"></label>
        <label>天气位置名<input name="locationLabel" value="${h(state.settings.locationLabel || "")}"></label>
        <div class="form-pair">
          <label>纬度<input name="latitude" type="number" step="0.0001" value="${h(state.settings.latitude || "")}"></label>
          <label>经度<input name="longitude" type="number" step="0.0001" value="${h(state.settings.longitude || "")}"></label>
        </div>
        <button class="primary-button" type="submit">保存设置</button>
      </form>
    `);
  }

  if (type === "mail-detail") {
    setModal(data.subject || "邮件详情", `
      <div class="detail-view">
        <p><strong>${h(data.sender)}</strong> · ${h(formatTime(data.time))}</p>
        <p>${h(data.body || "没有正文。")}</p>
        <div class="modal-actions">
          <button class="primary-button" type="button" data-mail-read="${h(data.id)}">标记已读</button>
          <button class="danger-button" type="button" data-mail-archive="${h(data.id)}">归档</button>
        </div>
      </div>
    `);
  }
}

async function handleModalSubmit(form) {
  const values = Object.fromEntries(new FormData(form));
  const type = form.dataset.form;
  if (type === "document") {
    await api("/api/documents", { method: "POST", body: JSON.stringify(values) });
    showToast("文档已保存");
  }
  if (type === "favorite") {
    await api("/api/favorites", { method: "POST", body: JSON.stringify(values) });
    showToast("收藏已添加");
  }
  if (type === "note") {
    await api("/api/notes", { method: "POST", body: JSON.stringify(values) });
    showToast("笔记已保存");
  }
  if (type === "mail") {
    await api("/api/mails", { method: "POST", body: JSON.stringify(values) });
    showToast("邮件已进入本地收件箱");
  }
  if (type === "settings") {
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        ...values,
        latitude: Number(values.latitude),
        longitude: Number(values.longitude)
      })
    });
    showToast("设置已保存");
  }
  closeModal();
  await refreshState();
  await refreshWeather();
}

async function uploadFile(file) {
  const data = new FormData();
  data.append("file", file);
  await api("/api/upload", { method: "POST", body: data });
  showToast(`已上传 ${file.name}`);
  await refreshState();
}

document.addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-open-modal]");
  if (openButton) openModal(openButton.dataset.openModal);

  const closeButton = event.target.closest("[data-close-modal]");
  if (closeButton) closeModal();

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === "upload") els.fileInput.click();
    if (action === "refresh") {
      await refreshState();
      await refreshWeather();
      showToast("数据已同步");
    }
    if (action === "weather") {
      await refreshWeather();
      showToast("天气已刷新");
    }
  }

  const musicButton = event.target.closest("[data-music]");
  if (musicButton) {
    const action = musicButton.dataset.music;
    if (action === "toggle") await toggleMusic();
    if (action === "next") await changeTrack(1);
    if (action === "prev") await changeTrack(-1);
    if (action === "stop") {
      playing = false;
      trackProgress = 0;
      stopTone();
      updateMusicUi();
    }
    if (action === "like") await likeTrack();
  }

  const docDownload = event.target.closest("[data-doc-download]");
  if (docDownload) window.open(`/api/files/${docDownload.dataset.docDownload}`, "_blank");

  const docDelete = event.target.closest("[data-doc-delete]");
  if (docDelete && confirm("确定删除这个文档吗？")) {
    await api(`/api/documents/${docDelete.dataset.docDelete}`, { method: "DELETE" });
    await refreshState();
    showToast("文档已删除");
  }

  const favOpen = event.target.closest("[data-fav-open]");
  if (favOpen) {
    const fav = state.favorites.find((item) => item.id === favOpen.dataset.favOpen);
    if (fav) window.open(fav.url, "_blank", "noopener,noreferrer");
  }

  const favDelete = event.target.closest("[data-fav-delete]");
  if (favDelete) {
    await api(`/api/favorites/${favDelete.dataset.favDelete}`, { method: "DELETE" });
    await refreshState();
    showToast("收藏已删除");
  }

  const mailRow = event.target.closest("[data-mail-id]");
  if (mailRow) {
    const mail = state.mails.find((item) => item.id === mailRow.dataset.mailId);
    if (mail) openModal("mail-detail", mail);
  }

  const mailRead = event.target.closest("[data-mail-read]");
  if (mailRead) {
    await api(`/api/mails/${mailRead.dataset.mailRead}`, { method: "PATCH", body: JSON.stringify({ read: true }) });
    closeModal();
    await refreshState();
  }

  const mailArchive = event.target.closest("[data-mail-archive]");
  if (mailArchive) {
    await api(`/api/mails/${mailArchive.dataset.mailArchive}`, { method: "PATCH", body: JSON.stringify({ read: true, archived: true }) });
    closeModal();
    await refreshState();
    showToast("邮件已归档");
  }

  const todoToggle = event.target.closest("[data-todo-toggle]");
  if (todoToggle) {
    const todo = state.todos.find((item) => item.id === todoToggle.dataset.todoToggle);
    if (todo) {
      await api(`/api/todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ done: !todo.done }) });
      await refreshState();
    }
  }

  const todoDelete = event.target.closest("[data-todo-delete]");
  if (todoDelete) {
    await api(`/api/todos/${todoDelete.dataset.todoDelete}`, { method: "DELETE" });
    await refreshState();
  }

});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (form.matches("[data-form]")) {
    event.preventDefault();
    await handleModalSubmit(form);
  }
});

els.todoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const title = new FormData(form).get("title");
  if (!String(title || "").trim()) return;
  await api("/api/todos", { method: "POST", body: JSON.stringify({ title }) });
  form.reset();
  await refreshState();
});

els.fileInput.addEventListener("change", async (event) => {
  const [file] = event.currentTarget.files;
  if (file) await uploadFile(file);
  event.currentTarget.value = "";
});

$$(".nav-item[data-target]").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".nav-item[data-target]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    const target = document.getElementById(button.dataset.target);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

setInterval(() => {
  if (!playing) return;
  const track = state.music[trackIndex];
  if (!track) return;
  trackProgress += 1;
  if (trackProgress >= track.duration) changeTrack(1);
  updateMusicUi();
}, 1000);

updateTime();
setInterval(updateTime, 1000);

refreshState()
  .then(() => refreshWeather())
  .catch((error) => showToast(error.message));

setInterval(() => refreshWeather(), 30000);
