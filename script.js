/* =========================================================
   My Playlist Editor - script.js
   데이터 흐름:
   playlist.json → localStorage 우선 로드 → DOM 카드 렌더
   → 선택/추가/수정/삭제 → localStorage 저장 → iframe 재생
   ========================================================= */

const STORAGE_KEY = "myPlaylist";
const SIG_KEY = "myPlaylistSig"; // 마지막으로 동기화한 playlist.json의 서명(버전)
const QUEUE_KEY = "myQueue"; // 사용자가 만든 재생목록 저장 키

// 상태(state)
let songs = [];          // 전체 곡 목록
let currentId = null;    // 현재 재생 중인 곡 id
let editingId = null;    // 폼에서 수정 중인 곡 id (null이면 '추가' 모드)
let playlistIds = [];    // 사용자가 만든 재생목록 (곡 id 배열)
let playIndex = -1;      // 재생목록에서 현재 재생 위치 (-1 = 재생목록 재생 아님)

// DOM 캐싱
const el = {
  list: document.getElementById("songList"),
  emptyMsg: document.getElementById("emptyMsg"),
  songCount: document.getElementById("songCount"),
  search: document.getElementById("searchInput"),
  randomBtn: document.getElementById("randomBtn"),
  syncBtn: document.getElementById("syncBtn"),
  player: document.getElementById("player"),
  npTitle: document.getElementById("npTitle"),
  npArtist: document.getElementById("npArtist"),
  npMemo: document.getElementById("npMemo"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  queuePos: document.getElementById("queuePos"),
  queueList: document.getElementById("queueList"),
  queueCount: document.getElementById("queueCount"),
  queueEmpty: document.getElementById("queueEmpty"),
  playAllBtn: document.getElementById("playAllBtn"),
  clearQueueBtn: document.getElementById("clearQueueBtn"),
  form: document.getElementById("songForm"),
  formTitle: document.getElementById("formTitle"),
  submitBtn: document.getElementById("submitBtn"),
  resetBtn: document.getElementById("resetBtn"),
  inputId: document.getElementById("songId"),
  inputTitle: document.getElementById("inputTitle"),
  inputArtist: document.getElementById("inputArtist"),
  inputVideoId: document.getElementById("inputVideoId"),
  inputMemo: document.getElementById("inputMemo"),
};

/* ---------- 1. 데이터 로드 ---------- */
async function loadData() {
  let base = [];
  try {
    // 캐시를 무시하고 항상 최신 playlist.json을 읽어 변경을 감지
    const res = await fetch("playlist.json?t=" + Date.now());
    base = await res.json();
  } catch (e) {
    console.warn("playlist.json 로드 실패", e);
  }

  const sig = signature(base);
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    songs = base; // 최초 1회: json을 그대로 사용
  } else {
    songs = JSON.parse(saved);
    // json이 바뀐 경우(서명 불일치)에만 병합 → 편집 내용은 보존
    if (base.length && localStorage.getItem(SIG_KEY) !== sig) {
      songs = mergePlaylist(base, songs);
      console.log("playlist.json 변경 감지 → 자동 동기화");
    }
  }

  localStorage.setItem(SIG_KEY, sig);
  save();
  loadQueue();
  render();
  renderQueue();
}

/* ---------- 1-1. 변경 감지(서명) ---------- */
function signature(arr) {
  const str = JSON.stringify(arr);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return arr.length + ":" + h; // 곡 수 + 내용 해시
}

/* ---------- 1-2. 병합: json(base) 기준 + 사용자 편집 보존 ---------- */
function keyTitle(s) {
  return (s.title + "|" + s.artist).toLowerCase().trim();
}

function mergePlaylist(base, stored) {
  // 저장본을 videoId / 제목+가수 두 가지로 색인
  const byVid = new Map();
  const byTitle = new Map();
  stored.forEach((s) => {
    if (s.videoId && s.videoId !== "None") byVid.set(s.videoId, s);
    byTitle.set(keyTitle(s), s);
  });

  const used = new Set();
  const merged = base.map((b) => {
    // videoId 우선, 없으면 제목+가수로 기존 곡 매칭 (None→실제ID 전환도 처리)
    const s = (b.videoId && byVid.get(b.videoId)) || byTitle.get(keyTitle(b));
    if (s) {
      used.add(s);
      return {
        ...b, // title/artist/videoId 는 json을 정답으로 사용(수정분 반영)
        memo: s.memo || b.memo, // 사용자 메모 보존
      };
    }
    return b; // json에만 있는 새 곡
  });

  // 사용자가 폼으로 직접 추가한 곡(json에 없는 곡) 이어붙이기
  const baseTitles = new Set(base.map(keyTitle));
  const baseVids = new Set(
    base.filter((b) => b.videoId && b.videoId !== "None").map((b) => b.videoId)
  );
  stored.forEach((s) => {
    if (used.has(s)) return;
    const inBase =
      baseTitles.has(keyTitle(s)) || (s.videoId && baseVids.has(s.videoId));
    if (!inBase) merged.push(s);
  });

  merged.forEach((s, i) => (s.id = i + 1)); // id 재정렬
  return merged;
}

/* ---------- 1-3. 수동 동기화 버튼 ---------- */
async function syncFromJson() {
  try {
    const res = await fetch("playlist.json?t=" + Date.now());
    const base = await res.json();
    const before = songs.length;
    songs = mergePlaylist(base, songs);
    localStorage.setItem(SIG_KEY, signature(base));
    save();
    render();
    alert(`동기화 완료\n곡 수: ${before} → ${songs.length} (메모·추가곡 유지)`);
  } catch (e) {
    alert("playlist.json 동기화 실패: " + e.message);
  }
}

/* ---------- 2. localStorage 저장 ---------- */
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

function saveQueue() {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(playlistIds));
}

function loadQueue() {
  try {
    const arr = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    const exist = new Set(songs.map((s) => s.id));
    playlistIds = arr.filter((id) => exist.has(id)); // 사라진 곡 제외
  } catch {
    playlistIds = [];
  }
}

/* ---------- 3. 렌더링 ---------- */
// 현재 화면(검색 반영)의 곡 목록을 배열로 반환
function getFiltered() {
  const keyword = el.search.value.trim().toLowerCase();
  return songs.filter(
    (s) =>
      s.title.toLowerCase().includes(keyword) ||
      s.artist.toLowerCase().includes(keyword)
  );
}

function render() {
  const filtered = getFiltered();

  el.list.innerHTML = "";
  el.emptyMsg.hidden = filtered.length !== 0;
  if (el.songCount) el.songCount.textContent = `${songs.length}곡`;

  filtered.forEach((song, i) => {
    const li = document.createElement("li");
    li.className = "song-card" + (song.id === currentId ? " active" : "");
    li.dataset.id = song.id;
    const thumb = song.videoId
      ? `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`
      : "";
    li.innerHTML = `
      <div class="col-index">
        <span class="index-num">${i + 1}</span>
        <span class="eq"><i></i><i></i><i></i></span>
      </div>
      <div class="col-title">
        <img class="thumb" src="${thumb}" alt="" loading="lazy"
             onerror="this.style.visibility='hidden'" />
        <div class="title-text">
          <strong>${escapeHtml(song.title)}</strong>
          <span>${escapeHtml(song.artist)}</span>
        </div>
      </div>
      <div class="col-actions">
        <button class="icon-btn" data-action="add" title="재생목록에 추가">➕</button>
        <button class="icon-btn" data-action="edit" title="수정">✏️</button>
        <button class="icon-btn" data-action="delete" title="삭제">🗑️</button>
      </div>`;
    el.list.appendChild(li);
  });
}

/* ---------- 5. 재생목록 담기 / 재생 ---------- */

// 라이브러리 → 재생목록에 추가
function addToPlaylist(id) {
  if (playlistIds.includes(id)) return; // 중복 방지
  playlistIds.push(id);
  saveQueue();
  renderQueue();
}

// 재생목록에서 제거
function removeFromPlaylist(index) {
  if (index < 0 || index >= playlistIds.length) return;
  playlistIds.splice(index, 1);
  if (index < playIndex) playIndex--;
  else if (index === playIndex) playIndex = -1; // 재생 중이던 곡 제거됨
  saveQueue();
  renderQueue();
  refreshControls();
}

// 재생목록 비우기
function clearPlaylist() {
  if (!playlistIds.length) return;
  if (!confirm("재생목록을 비울까요?")) return;
  playlistIds = [];
  playIndex = -1;
  saveQueue();
  renderQueue();
  refreshControls();
}

// 재생목록의 특정 위치부터 재생
function playFromPlaylist(index) {
  if (index < 0 || index >= playlistIds.length) return;
  playIndex = index;
  playByIndex();
}

function playByIndex() {
  const song = songs.find((s) => s.id === playlistIds[playIndex]);
  if (!song) return;
  currentId = song.id;
  startOrSkip(song);
  render();
  renderQueue();
}

function playNext() {
  if (playIndex >= 0 && playIndex < playlistIds.length - 1) {
    playIndex++;
    playByIndex();
  }
}

function playPrev() {
  if (playIndex > 0) {
    playIndex--;
    playByIndex();
  }
}

// 라이브러리 곡 본문 클릭 → 단일 미리듣기(재생목록과 무관)
function previewPlay(id) {
  const song = songs.find((s) => s.id === id);
  if (!song) return;
  playIndex = -1;
  currentId = id;
  startOrSkip(song);
  render();
  renderQueue();
}

// 영상 재생 or 재생 불가 안내 + 정보 갱신
function startOrSkip(song) {
  updateNowPlaying(song);
  if (song.videoId && song.videoId !== "None") startPlayer(song.videoId);
  else showUnavailable();
}

// 우측 '현재 재생' 패널 갱신
function updateNowPlaying(song) {
  el.npTitle.textContent = song.title;
  el.npArtist.textContent = song.artist;
  el.npMemo.textContent = song.memo || "-";
  refreshControls();
}

// 위치표시 / 이전·다음 버튼 상태
function refreshControls() {
  if (el.queuePos)
    el.queuePos.textContent =
      playIndex >= 0 ? `${playIndex + 1} / ${playlistIds.length}` : "–";
  if (el.prevBtn) el.prevBtn.disabled = playIndex <= 0;
  if (el.nextBtn)
    el.nextBtn.disabled = playIndex < 0 || playIndex >= playlistIds.length - 1;
}

function showUnavailable() {
  el.player.innerHTML = `
    <div class="player-placeholder">
      <svg viewBox="0 0 24 24" class="placeholder-icon"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" fill="currentColor"/></svg>
      <span>재생할 수 없는 곡입니다 (videoId 없음)</span>
    </div>`;
}

/* ---------- 5-2. 재생목록 패널 렌더 ---------- */
function renderQueue() {
  if (!el.queueList) return;
  el.queueCount.textContent = `${playlistIds.length}곡`;
  el.queueEmpty.hidden = playlistIds.length !== 0;
  el.queueList.innerHTML = "";
  playlistIds.forEach((id, i) => {
    const song = songs.find((s) => s.id === id);
    if (!song) return;
    const li = document.createElement("li");
    li.className = "queue-card" + (i === playIndex ? " active" : "");
    li.dataset.index = i;
    const thumb =
      song.videoId && song.videoId !== "None"
        ? `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`
        : "";
    li.innerHTML = `
      <span class="q-index">${i + 1}</span>
      <img class="thumb" src="${thumb}" alt="" loading="lazy"
           onerror="this.style.visibility='hidden'" />
      <div class="title-text">
        <strong>${escapeHtml(song.title)}</strong>
        <span>${escapeHtml(song.artist)}</span>
      </div>
      <button class="icon-btn" data-action="remove" title="목록에서 제거">✕</button>`;
    el.queueList.appendChild(li);
  });
}

/* ---------- 5-0. YouTube IFrame Player API (자동 다음곡용) ---------- */
let ytPlayer = null;     // YT.Player 인스턴스
let ytReady = false;     // API 로드 완료 여부
let pendingVideoId = null;

function loadYouTubeAPI() {
  if (document.getElementById("yt-api")) return;
  const tag = document.createElement("script");
  tag.id = "yt-api";
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
}

// API 로드가 끝나면 YouTube가 자동 호출하는 전역 콜백
window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
  if (pendingVideoId) {
    startPlayer(pendingVideoId);
    pendingVideoId = null;
  }
};

function startPlayer(videoId) {
  if (!ytReady) {
    pendingVideoId = videoId; // API 준비되면 재생
    loadYouTubeAPI();
    return;
  }
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(videoId); // 기존 플레이어 재사용
    return;
  }
  el.player.innerHTML = '<div id="ytframe"></div>';
  ytPlayer = new YT.Player("ytframe", {
    width: "100%",
    height: "100%",
    videoId,
    playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
    events: {
      onStateChange: (e) => {
        // 곡이 끝나면(0=ENDED) 자동으로 다음 곡
        if (e.data === YT.PlayerState.ENDED) playNext();
      },
    },
  });
}

/* ---------- 5-1. 재생 화면 초기화 ---------- */
function resetPlayer() {
  if (ytPlayer && ytPlayer.destroy) {
    ytPlayer.destroy();
    ytPlayer = null;
  }
  playIndex = -1; // 재생목록 자체는 유지, 재생 위치만 해제
  el.player.innerHTML = `
    <div class="player-placeholder">
      <svg viewBox="0 0 24 24" class="placeholder-icon"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" fill="currentColor"/></svg>
      <span>곡을 선택하면 재생됩니다</span>
    </div>`;
  el.npTitle.textContent = "재생 중인 곡 없음";
  el.npArtist.textContent = "아티스트";
  el.npMemo.textContent = "-";
  refreshControls();
}

/* ---------- 6. 폼: 추가 / 수정 ---------- */
el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    title: el.inputTitle.value.trim(),
    artist: el.inputArtist.value.trim(),
    // 전체 YouTube URL을 붙여넣어도 videoId만 추출
    videoId: parseVideoId(el.inputVideoId.value.trim()),
    memo: el.inputMemo.value.trim(),
  };

  if (editingId) {
    // 수정
    const idx = songs.findIndex((s) => s.id === editingId);
    songs[idx] = { ...songs[idx], ...data };
  } else {
    // 추가
    const newId = songs.length ? Math.max(...songs.map((s) => s.id)) + 1 : 1;
    songs.push({ id: newId, ...data });
  }

  save();
  render();
  resetForm();
});

/* ---------- 7. 폼 채우기(수정 모드) / 초기화 ---------- */
function fillForm(song) {
  editingId = song.id;
  el.inputTitle.value = song.title;
  el.inputArtist.value = song.artist;
  el.inputVideoId.value = song.videoId;
  el.inputMemo.value = song.memo || "";
  el.formTitle.textContent = "곡 수정";
  el.submitBtn.textContent = "수정하기";
}

function resetForm() {
  editingId = null;
  el.form.reset();
  el.formTitle.textContent = "곡 추가";
  el.submitBtn.textContent = "추가하기";
}

el.resetBtn.addEventListener("click", resetForm);

/* ---------- 8. 곡 삭제 ---------- */
function deleteSong(id) {
  if (!confirm("이 곡을 삭제할까요?")) return;
  songs = songs.filter((s) => s.id !== id);
  // 재생목록에서도 제거하고 위치 보정
  const qpos = playlistIds.indexOf(id);
  if (qpos !== -1) {
    playlistIds.splice(qpos, 1);
    if (qpos < playIndex) playIndex--;
    else if (qpos === playIndex) playIndex = -1;
    saveQueue();
  }
  if (currentId === id) {
    currentId = null;
    resetPlayer();
  }
  if (editingId === id) resetForm();
  save();
  render();
  renderQueue();
}

/* ---------- 9. 이벤트 위임 (카드 클릭) ---------- */
el.list.addEventListener("click", (e) => {
  const card = e.target.closest(".song-card");
  if (!card) return;
  const id = Number(card.dataset.id);
  const action = e.target.dataset.action;

  if (action === "add") {
    addToPlaylist(id); // ➕ 재생목록에 담기
  } else if (action === "edit") {
    fillForm(songs.find((s) => s.id === id));
  } else if (action === "delete") {
    deleteSong(id);
  } else {
    previewPlay(id); // 카드 본문 클릭 → 단일 미리듣기
  }
});

/* ---------- 9-1. 재생목록 패널 클릭 ---------- */
if (el.queueList) {
  el.queueList.addEventListener("click", (e) => {
    const card = e.target.closest(".queue-card");
    if (!card) return;
    const index = Number(card.dataset.index);
    if (e.target.dataset.action === "remove") removeFromPlaylist(index);
    else playFromPlaylist(index); // 재생목록 곡 클릭 → 그 위치부터 재생
  });
}

/* ---------- 10. 검색 / 필터 / 랜덤 ---------- */
el.search.addEventListener("input", render);
if (el.syncBtn) el.syncBtn.addEventListener("click", syncFromJson);
// ▶ 재생목록 전체 재생 (처음부터)
if (el.playAllBtn)
  el.playAllBtn.addEventListener("click", () => {
    if (!playlistIds.length) {
      alert("재생목록이 비어 있습니다. 곡의 ➕ 로 추가하세요.");
      return;
    }
    playFromPlaylist(0);
  });

// 🔀 재생목록을 섞어서 처음부터 재생
el.randomBtn.addEventListener("click", () => {
  if (!playlistIds.length) {
    alert("재생목록이 비어 있습니다. 곡의 ➕ 로 추가하세요.");
    return;
  }
  for (let i = playlistIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playlistIds[i], playlistIds[j]] = [playlistIds[j], playlistIds[i]];
  }
  saveQueue();
  renderQueue();
  playFromPlaylist(0);
});

if (el.clearQueueBtn) el.clearQueueBtn.addEventListener("click", clearPlaylist);
if (el.prevBtn) el.prevBtn.addEventListener("click", playPrev);
if (el.nextBtn) el.nextBtn.addEventListener("click", playNext);

/* ---------- 유틸: URL → videoId 추출 ---------- */
function parseVideoId(input) {
  if (!input) return "";
  // 이미 ID만 입력한 경우(영숫자/-/_ 11자 내외) 그대로 사용
  if (!input.includes("/") && !input.includes("=")) return input;
  try {
    const url = new URL(input);
    return url.searchParams.get("v") || url.pathname.split("/").pop() || input;
  } catch {
    return input;
  }
}

/* ---------- 유틸: XSS 방지 ---------- */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- 시작 ---------- */
loadData();
