const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const clockEl = $("#clock");
const dateLineEl = $("#date-line");
const topDateEl = $("#top-date");
const greetingEl = $("#greeting");
const progressEl = $("#music-progress");
const musicTimeEl = $("#music-current");
const playButton = $(".play-toggle");
const toastEl = $(".toast");

const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
let playing = true;
let progress = 31;
let toastTimer = 0;

function pad(value) {
  return String(value).padStart(2, "0");
}

function updateTime() {
  const now = new Date();
  const hour = now.getHours();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = weekdays[now.getDay()];

  clockEl.textContent = `${pad(hour)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  dateLineEl.textContent = `${year}-${pad(month)}-${pad(day)}　${weekday}`;
  topDateEl.textContent = `${month}月${day}日 ${weekday}`;

  if (hour < 6) greetingEl.textContent = "夜深啦！";
  else if (hour < 11) greetingEl.textContent = "早上好！";
  else if (hour < 14) greetingEl.textContent = "中午好！";
  else if (hour < 18) greetingEl.textContent = "下午好！";
  else greetingEl.textContent = "晚上好！";
}

function updateMusic() {
  if (!playing) return;
  progress = progress >= 99 ? 0 : progress + 0.16;
  const totalSeconds = 275;
  const currentSeconds = Math.round((progress / 100) * totalSeconds);
  progressEl.style.width = `${progress}%`;
  musicTimeEl.textContent = `${pad(Math.floor(currentSeconds / 60))}:${pad(currentSeconds % 60)}`;
}

function setPlayIcon() {
  const icon = playing ? "#icon-pause" : "#icon-play";
  playButton.querySelector("use").setAttribute("href", icon);
  playButton.setAttribute("aria-label", playing ? "暂停音乐" : "播放音乐");
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

$$(".nav-item[data-target]").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".nav-item[data-target]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    const target = document.getElementById(button.dataset.target);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

playButton.addEventListener("click", () => {
  playing = !playing;
  setPlayIcon();
  showToast(playing ? "音乐继续播放" : "音乐已暂停");
});

$(".heart-button").addEventListener("click", (event) => {
  event.currentTarget.classList.toggle("active");
  showToast(event.currentTarget.classList.contains("active") ? "已加入喜欢列表" : "已从喜欢列表移除");
});

$$(".quick-actions button").forEach((button) => {
  button.addEventListener("click", () => {
    showToast(`${button.textContent.trim()} 已加入今日工作台`);
  });
});

$$(".vps-actions button").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.textContent.trim();
    showToast(`已模拟发送 ${action} 指令`);
  });
});

$(".add-link").addEventListener("click", () => {
  showToast("收藏入口已预留，可以接入自己的链接数据");
});

$$(".mail-row, .doc-row").forEach((row) => {
  row.addEventListener("click", () => showToast("条目已选中"));
});

updateTime();
setPlayIcon();
setInterval(updateTime, 1000);
setInterval(updateMusic, 900);
