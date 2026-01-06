// 유틸리티
function normalizeArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v);
  return [];
}

let globalData = { categories: [], config: {}, security: {} };
let isAdmin = localStorage.getItem('kac_admin_mode') === '1';
let isPreview = localStorage.getItem('kac_preview_active') === '1';
let searchIndex = [];
let editingCardId = null;
let moveSrcIndex = -1;

// 페이지네이션
const itemsPerPage = 5;
let currentPage = 1;

// 드래그앤드롭
let dragSrcIndex = null;

// 종합 관리용 변수
let currentTreeSelection = null; 

function ensureAnonAuth() {
  return new Promise((resolve) => {
    const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        unsubscribe();
        resolve();
      } else {
        firebase.auth().signInAnonymously().catch((error) => {
          unsubscribe();
          resolve();
        });
      }
    });
  });
}

function openQrZoom() {
    document.getElementById('qrZoomModal').style.display = 'flex';
}

async function init() {
  const spinner = document.getElementById('loadingSpinner');
  if(spinner) spinner.style.display = 'flex';

  await ensureAnonAuth();

  setTheme(localStorage.getItem('kac_theme') || 'light');
  if (isPreview) document.body.classList.add('preview-active');
  if (isAdmin) document.body.classList.add('admin-mode');

  try {
    const snapshot = await db.ref('/').once('value');
    if (snapshot.exists()) {
      const serverData = snapshot.val();
      globalData = serverData;
      if (globalData.categories) {
          globalData.categories = normalizeArray(globalData.categories);
      } else {
          globalData.categories = [];
      }
      syncToLocalStorage(globalData);
      if(globalData.config) applyConfig(globalData.config);
    } else {
      reconstructGlobalDataFromLocal();
    }
  } catch (e) {
    reconstructGlobalDataFromLocal();
  }

  const contentTop = localStorage.getItem('kac_content_top');
  if(contentTop) {
      document.querySelector('.content-wrapper').style.paddingTop = contentTop + 'px';
  }
  
  loadFooterText(); 
  ensurePageSlots(); 
  renderCards(false); 
  buildSearchIndex(); 
  renderSidebar(); 
  checkAndShowNotice(); // [추가] 공지사항 팝업 체크
  
  if(spinner) {
      spinner.style.opacity = '0';
      setTimeout(() => spinner.style.display='none', 500);
  }
}
  
function loadFooterText() {
    let savedHtml = globalData.config.footerText;
    if (!savedHtml) {
        savedHtml = localStorage.getItem('kac_full_footer');
    }
    const defaultHtml = "<p>본 웹사이트는 한국공항공사 항공기술훈련원의 항행안전시설 분야 교육 관련 플랫폼입니다.</p><p>문의 이메일 : jds0616@airport.co.kr (Developed by DooSeok, Jang)</p><p>© 2026 Korea Airports Corporation. All rights reserved.</p>";
    document.querySelector('.footer-content').innerHTML = savedHtml || defaultHtml;
}

function openFooterEditModal() {
    let content = document.querySelector('.footer-content').innerHTML;
    let plainText = content.replace(/<br\s*\/?>/gi, "\n")
                            .replace(/<\/p>/gi, "\n")
                            .replace(/<p[^>]*>/gi, "")
                            .replace(/^\s*[\r\n]/gm, "") 
                            .trim();
    document.getElementById('footerTextInput').value = plainText;
    document.getElementById('footerEditModal').style.display = 'flex';
}

function saveFooterText() {
    const rawText = document.getElementById('footerTextInput').value;
    const lines = rawText.split('\n');
    let htmlOutput = '';
    lines.forEach(line => {
        if(line.trim() !== '') {
            htmlOutput += `<p>${line.trim()}</p>`;
        }
    });
    localStorage.setItem('kac_full_footer', htmlOutput);
    globalData.config.footerText = htmlOutput;
    syncToLocalStorage(globalData);
    loadFooterText();
    document.getElementById('footerEditModal').style.display = 'none';
    alert("하단 문구가 저장되었습니다.");
}

function reconstructGlobalDataFromLocal() {
const currentSecurity = globalData.security || {
    entry_pw: "db2d3257df630ebeb488b0a9435b863702a0a25694205626359045b8427f311c",
    admin_pw: "db2d3257df630ebeb488b0a9435b863702a0a25694205626359045b8427f311c"
};

// [수정] 공지사항 설정 초기화 추가
globalData = { 
    meta: { version: "2.1", lastUpdated: new Date().toISOString() }, 
    config: {
        notice: { active: false, content: "", id: "" } 
    }, 
    categories: [], 
    security: currentSecurity 
};

globalData.config.iconSize = parseInt(localStorage.getItem('kac_idx_icon_size') || 60);
globalData.config.labelSize = parseInt(localStorage.getItem('kac_idx_label_size') || 24);

const savedTitles = localStorage.getItem('kac_page_titles');
globalData.config.pageTitles = savedTitles ? JSON.parse(savedTitles) : {};
globalData.config.footerText = localStorage.getItem('kac_full_footer');

const contentTop = localStorage.getItem('kac_content_top');
if(contentTop) globalData.config.contentTop = contentTop;

applyConfig(globalData.config);

const orderRaw = localStorage.getItem('kac_index_order');
if(orderRaw) {
    const order = JSON.parse(orderRaw);
    globalData.categories = order.map(id => {
        if(!id) return null;
        const s = JSON.parse(localStorage.getItem(`kac_style_${id}`) || '{}');
        const ms = JSON.parse(localStorage.getItem(`kac_menu_${id}`) || '[]');
        const access = s.access || { visible: true, adminOnly: false, showSidebar: true };

        const menuList = ms.map(m => {
            const subs = JSON.parse(localStorage.getItem(`kac_subs_${id}_${m.dataId}`) || '[]');
            const isVisible = (m.visible !== undefined) ? m.visible : true;
            return { id: m.dataId, label: m.label, line1: m.line1, line2: m.line2, link: m.link, visible: isVisible, subjects: subs };
        });

        return { id: id, name: s.name, code: s.code, color: s.color, access: access, menus: menuList };
    });
}
}

function resetToDataJson() {
if(confirm("모든 내용이 사라지고 서버 상태로 되돌아갑니다. 계속하시겠습니까?")) {
    localStorage.clear();
    location.reload();
}
}

window.addEventListener('pageshow', () => {
    const savedStatus = localStorage.getItem('kac_admin_mode') === '1';
    if (isAdmin !== savedStatus) location.reload();
});

function ensurePageSlots() {
const cleanList = globalData.categories.filter(c => c !== null);
globalData.categories = cleanList;
if (globalData.categories.length % itemsPerPage !== 0) {
    const needed = itemsPerPage - (globalData.categories.length % itemsPerPage);
    for(let i=0; i<needed; i++) globalData.categories.push(null);
}
}

function syncToLocalStorage(data) {
  const order = [];
  if (!data.categories) return;

  data.categories.forEach(cat => {
    if(cat) {
      order.push(cat.id);
      const access = cat.access || { visible: true, adminOnly: false, showSidebar: true };
      localStorage.setItem(`kac_style_${cat.id}`, JSON.stringify({ name: cat.name, code: cat.code, color: cat.color, access: access }));
      const safeMenus = cat.menus || []; 
      const menuList = safeMenus.map(m => ({ 
          dataId: m.id, 
          label: m.label, 
          line1: m.line1, 
          line2: m.line2, 
          link: m.link,
          visible: (m.visible !== undefined) ? m.visible : true
      }));
      localStorage.setItem(`kac_menu_${cat.id}`, JSON.stringify(menuList));
      safeMenus.forEach(m => { 
          if(m.subjects) {
              localStorage.setItem(`kac_subs_${cat.id}_${m.id}`, JSON.stringify(m.subjects)); 
          }
      });
    } else {
      order.push(null);
    }
  });
  localStorage.setItem('kac_index_order', JSON.stringify(order));
  
  if(data.config) {
      localStorage.setItem('kac_idx_icon_size', data.config.iconSize);
      localStorage.setItem('kac_idx_label_size', data.config.labelSize);
      if(data.config.pageTitles) localStorage.setItem('kac_page_titles', JSON.stringify(data.config.pageTitles));
      if(data.config.footerText) localStorage.setItem('kac_full_footer', data.config.footerText);
      if(data.config.contentTop) localStorage.setItem('kac_content_top', data.config.contentTop);
  }
}

function applyConfig(cfg) {
if(!cfg) return;
document.documentElement.style.setProperty('--icon-size-idx', (cfg.iconSize||60)+'px');
document.documentElement.style.setProperty('--label-size-idx', (cfg.labelSize||24)+'px');
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebarOverlay');
    sb.classList.toggle('active');
    ov.classList.toggle('active');
}

function renderSidebar() {
    const content = document.getElementById('sidebarContent');
    content.innerHTML = '';
    const cats = globalData.categories.filter(c => {
        if (c === null) return false;
        const acc = c.access || { visible: true, adminOnly: false, showSidebar: true };
        if (!acc.visible || !acc.showSidebar) return false;
        if (acc.adminOnly && !isAdmin) return false;
        return true;
    });

    if(cats.length === 0) {
        content.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">메뉴가 없습니다.</div>';
    } else {
        cats.forEach((cat, cIdx) => {
            const acc = cat.access || { visible: true, adminOnly: false, showSidebar: true };
            let namePrefix = (isAdmin && acc.adminOnly) ? "(관리자) " : "";
            const item = document.createElement('div');
            let subHtml = '';
            if(cat.menus && cat.menus.length > 0) {
                subHtml = `<div class="sb-sub-list" id="sb-sub-${cat.id}">`;
                cat.menus.forEach(m => {
                    const isMenuVisible = (m.visible !== undefined) ? m.visible : true;
                    if(isMenuVisible) {
                        subHtml += `<div class="sb-sub-item" onclick="location.href='viewer_list.html?type=${cat.id}&menu=${encodeURIComponent(m.label)}&id=${m.id}'">
                            ${m.label}
                        </div>`;
                    }
                });
                subHtml += `</div>`;
            }
            item.innerHTML = `
            <div class="sb-item" onclick="toggleSubMenu('${cat.id}', this)">
                <span style="display:flex;align-items:center;gap:10px;">
                    <span style="width:10px;height:10px;border-radius:50%;background:${cat.color}"></span>
                    ${namePrefix}${cat.name}
                </span>
                <span class="sb-toggle">▶</span>
            </div>
            ${subHtml}
            `;
            content.appendChild(item);
        });
    }

    // [추가] 모바일/사이드바용 공지사항 메뉴
    const noticeItem = document.createElement('div');
    noticeItem.className = 'sb-item';
    noticeItem.innerHTML = `<span style="display:flex;align-items:center;gap:10px;">📢 공지사항 확인</span>`;
    noticeItem.onclick = () => {
        showNoticeManual();
        toggleSidebar();
    };
    content.appendChild(noticeItem);

    // [추가] 사이드바 내 테마 설정 버튼 (모바일용 대체)
    const themeItem = document.createElement('div');
    themeItem.className = 'sb-item';
    themeItem.style.marginTop = '20px';
    themeItem.style.borderTop = '1px solid var(--btn-border)';
    themeItem.onclick = () => {
        const cur = localStorage.getItem('kac_theme') || 'light';
        setTheme(cur === 'light' ? 'dark' : 'light');
    };
    themeItem.innerHTML = `
    <span style="display:flex; align-items:center; gap:10px;">
        🌙 주/야간 모드 전환
    </span>
    <span style="font-size:12px; color:var(--text-sub);" id="sbThemeStatus">
        ${(localStorage.getItem('kac_theme')||'light')==='light' ? '주간' : '야간'}
    </span>
    `;
    content.appendChild(themeItem);

    const settingsItem = document.createElement('div');
    settingsItem.className = 'sb-item';
    settingsItem.innerHTML = `<span style="display:flex;align-items:center;gap:10px;" onclick="openSettings(); toggleSidebar();">⚙️ 시스템 설정</span>`;
    content.appendChild(settingsItem);
}

function toggleSubMenu(id, element) {
    const el = document.getElementById(`sb-sub-${id}`);
    if(el) {
        if (el.classList.contains('open')) {
            el.classList.remove('open');
            element.querySelector('.sb-toggle').textContent = '▶';
        } else {
            el.classList.add('open');
            element.querySelector('.sb-toggle').textContent = '▼';
        }
    }
}

function updateHeadline() {
    const el = document.getElementById('pageHeadline');
    const titles = globalData.config.pageTitles || {};
    const t = titles[currentPage] || "";
    el.textContent = t;
    document.getElementById('pageBadge').textContent = `Page ${currentPage}`;
    if(isAdmin && t === "") {
        el.textContent = "제목 없음 (클릭 수정)";
        el.style.opacity = "0.5";
    } else {
        el.style.opacity = "1";
    }
}

function editPageTitle() {
    if(!isAdmin) return;
    const titles = globalData.config.pageTitles || {};
    const oldVal = titles[currentPage] || "";
    const newVal = prompt(`[${currentPage}페이지] 제목을 입력하세요:`, oldVal);
    if(newVal !== null) {
        titles[currentPage] = newVal;
        globalData.config.pageTitles = titles;
        syncToLocalStorage(globalData);
        updateHeadline();
    }
}

function renderCards(animate = true) {
const containerWrapper = document.getElementById('cardContainer');
const pagination = document.getElementById('pagination');
const isMobile = window.innerWidth <= 768;

if(animate) {
    containerWrapper.style.opacity = '0';
    containerWrapper.style.transform = 'translateY(10px)';
    setTimeout(() => {
        performRender(isMobile);
        containerWrapper.style.opacity = '1';
        containerWrapper.style.transform = 'translateY(0)';
    }, 300);
} else {
    performRender(isMobile);
}

function performRender(isMobileMode) {
    containerWrapper.innerHTML = ''; 
    pagination.innerHTML = '';
    let renderList = [];
    
    if (isAdmin) {
        renderList = globalData.categories;
    } else {
        renderList = globalData.categories.filter(cat => {
            if(!cat) return false;
            const acc = cat.access || { visible: true, adminOnly: false, showSidebar: true };
            return acc.visible && !acc.adminOnly;
        });
    }

    if(isMobileMode) {
        const mobileList = renderList.filter(item => item !== null);
        mobileList.forEach((cat, i) => {
            const originalIdx = globalData.categories.indexOf(cat);
            createAndAppendCard(cat, originalIdx, true); 
        });
        return; 
    }

    const totalPages = Math.ceil(renderList.length / itemsPerPage) || 1;
    if(currentPage > totalPages) currentPage = 1; 
    const startIdx = (currentPage - 1) * itemsPerPage;
    const pageItems = renderList.slice(startIdx, startIdx + itemsPerPage);

    pageItems.forEach((cat, i) => {
        let globalIdx = isAdmin ? startIdx + i : -1;
        createAndAppendCard(cat, globalIdx, false);
    });

    for(let i=1; i<=totalPages; i++) {
        const dot = document.createElement('div');
        dot.className = `page-dot ${i === currentPage ? 'active' : ''}`;
        dot.onclick = () => { if(i !== currentPage) { currentPage = i; renderCards(true); } };
        pagination.appendChild(dot);
    }
    
    if(isAdmin && !isPreview) {
        const addPageBtn = document.createElement('div');
        addPageBtn.className = 'page-dot';
        addPageBtn.style.border = '1px solid #cbd5e1';
        addPageBtn.innerText = '+';
        addPageBtn.onclick = () => {
            for(let k=0; k<itemsPerPage; k++) globalData.categories.push(null);
            currentPage = Math.ceil(globalData.categories.length / itemsPerPage);
            renderCards(true);
        };
        pagination.appendChild(addPageBtn);
    }
    updateHeadline();
}

function createAndAppendCard(cat, idx, isMobileRender) {
    if(cat) { 
        const acc = cat.access || { visible: true, adminOnly: false, showSidebar: true };
        const card = document.createElement('div');
        card.className = 'card';
        card.style.setProperty('--card-color', cat.color);
        card.onclick = () => location.href = `facility.html?type=${cat.id}`;
        if (isAdmin && (!acc.visible || acc.adminOnly)) card.classList.add('restricted-view');

        if(isAdmin && !isPreview && !isMobileRender) {
            card.setAttribute('draggable', 'true');
            card.ondragstart = (e) => { dragSrcIndex = idx; e.target.classList.add('dragging'); };
            card.ondragover = (e) => e.preventDefault();
            card.ondrop = (e) => {
            const srcItem = globalData.categories[dragSrcIndex];
            globalData.categories[dragSrcIndex] = globalData.categories[idx];
            globalData.categories[idx] = srcItem;
            renderCards(false);
            };
            card.ondragend = () => document.querySelectorAll('.card').forEach(c => c.classList.remove('dragging'));

            let statusBadges = "";
            if(!acc.visible) statusBadges += "🚫비공개 ";
            if(acc.adminOnly) statusBadges += "🔒관리자전용 ";

            card.innerHTML = `
            <div class="card-ctrl" onclick="event.stopPropagation()">
                <button class="btn-sm" onclick="openEdit('${cat.id}')">수정</button>
                <button class="btn-sm btn-move" onclick="openMovePageModal(${idx})">이동</button>
                <button class="btn-sm btn-del" onclick="deleteCard('${idx}')">삭제</button>
            </div>
            <div class="icon-box">${cat.code}</div>
            <h2>${cat.name}</h2>
            ${statusBadges ? `<div style="position:absolute; bottom:15px; font-size:12px; color:red; font-weight:800; background:rgba(255,255,255,0.8); padding:2px 8px; border-radius:10px;">${statusBadges}</div>` : ''}
            `;
        } else {
            card.innerHTML = `<div class="icon-box">${cat.code}</div><h2>${cat.name}</h2>`;
        }
        containerWrapper.appendChild(card);
    } else if(isAdmin && !isPreview && !isMobileRender) { 
        const empty = document.createElement('div');
        empty.className = 'card add-slot';
        empty.innerHTML = '<div style="font-size:40px;">+</div><div>추가</div>';
        empty.onclick = () => openEdit('NEW', idx);
        containerWrapper.appendChild(empty);
    }
}
}

function toggleThemeMobile() {
    const current = localStorage.getItem('kac_theme') || 'light';
    setTheme(current === 'light' ? 'dark' : 'light');
}

function buildSearchIndex() {
searchIndex = [];
if (!globalData || !globalData.categories) return;
globalData.categories.forEach(cat => {
    if(!cat) return;
    const acc = cat.access || { visible: true, adminOnly: false, showSidebar: true };
    if (!isAdmin && (!acc.visible || acc.adminOnly)) return;
    const safeMenus = cat.menus || [];
    safeMenus.forEach(menu => {
    const isMenuVisible = (menu.visible !== undefined) ? menu.visible : true;
    if(!isAdmin && !isMenuVisible) return;
    const safeSubjects = menu.subjects || [];
    safeSubjects.forEach(sub => {
        searchIndex.push({
        name: sub.name, type: cat.id, code: cat.code, typeName: cat.name,
        menuName: menu.label, menuId: menu.id, subId: sub.id, color: cat.color
        });
    });
    });
});
}

const searchInput = document.getElementById('mainSearch');
const searchRes = document.getElementById('searchResults');
const sOverlay = document.getElementById('searchOverlay');

if(searchInput) {
    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if(!q) { searchRes.classList.remove('active'); return; }
        const matches = searchIndex.filter(i => i.name.toLowerCase().includes(q) || i.menuName.toLowerCase().includes(q));
        searchRes.innerHTML = matches.map(i => `
        <div class="result-item" onclick="location.href='viewer_list.html?type=${i.type}&menu=${encodeURIComponent(i.menuName)}&id=${i.menuId}&autoOpen=${i.subId}'">
            <div><div class="res-title">${i.name}</div><div class="res-path">${i.typeName} > ${i.menuName}</div></div>
            <div class="res-tag" style="background:${i.color}">${i.code}</div>
        </div>
        `).join('') || '<div style="padding:15px;text-align:center;">결과 없음</div>';
        searchRes.classList.add('active');
    });

    searchInput.onfocus = () => { sOverlay.classList.add('active'); if(searchInput.value) searchRes.classList.add('active'); };
}
if(sOverlay) {
    sOverlay.onclick = () => { sOverlay.classList.remove('active'); searchRes.classList.remove('active'); };
}

function openSettings() {
document.getElementById('guestSettings').style.display = isAdmin ? 'none' : 'block';
document.getElementById('adminSettings').style.display = isAdmin ? 'block' : 'none';
if(isAdmin) {
    document.getElementById('setIconSize').value = globalData.config.iconSize || 60;
    document.getElementById('setLabelSize').value = globalData.config.labelSize || 24;
    document.getElementById('setContentTop').value = localStorage.getItem('kac_content_top') || 135; 
    document.getElementById('modalPreviewBtn').textContent = isPreview ? "미리보기 종료" : "미리보기 시작";
    document.getElementById('modalPreviewBtn').classList.toggle('btn-preview-active', isPreview);

    // [추가] 공지사항 설정 불러오기
    const notice = globalData.config?.notice || { active: false, content: "" };
    document.getElementById('chkNoticeActive').checked = notice.active;
    document.getElementById('noticeTextInput').value = notice.content;
}
document.getElementById('settingsModal').style.display='flex';
}

function saveUISettings() {
globalData.config.iconSize = parseInt(document.getElementById('setIconSize').value);
globalData.config.labelSize = parseInt(document.getElementById('setLabelSize').value);
globalData.config.contentTop = parseInt(document.getElementById('setContentTop').value);
applyConfig(globalData.config);
localStorage.setItem('kac_content_top', globalData.config.contentTop);
document.querySelector('.content-wrapper').style.paddingTop = globalData.config.contentTop + 'px';
document.getElementById('settingsModal').style.display='none';
}

function togglePreview() {
isPreview = !isPreview;
localStorage.setItem('kac_preview_active', isPreview ? '1' : '0');
location.reload();
}

async function toggleAdmin() {
if(isAdmin) {
    if(confirm("관리자 모드를 종료하시겠습니까?")) {
    localStorage.setItem('kac_admin_mode','0');
    location.reload();
    }
} else {
    const pw = prompt("관리자 비밀번호를 입력하세요");
    if(!pw) return;
    const inputHash = await sha256(pw.toUpperCase());
    const snapshot = await db.ref('security/admin_pw').once('value');
    let serverHash = snapshot.val() || "db2d3257df630ebeb488b0a9435b863702a0a25694205626359045b8427f311c";
    if(inputHash === serverHash) {
        localStorage.setItem('kac_admin_mode','1');
        location.reload();
    } else alert("비밀번호 불일치");
}
}

async function sha256(message) {
const msgBuffer = new TextEncoder().encode(message);
const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// [수정] setTheme 함수 업데이트 (사이드바 텍스트 갱신용)
function setTheme(m) { 
    document.body.className = m==='dark'?'dark-mode':''; 
    localStorage.setItem('kac_theme', m); 
    const btnDay = document.getElementById('btnDay');
    const btnNight = document.getElementById('btnNight');
    if(btnDay) btnDay.classList.toggle('active', m==='light'); 
    if(btnNight) btnNight.classList.toggle('active', m==='dark'); 

    // [추가] 사이드바 상태 텍스트 업데이트
    const sbStatus = document.getElementById('sbThemeStatus');
    if(sbStatus) sbStatus.innerText = m==='light' ? '주간' : '야간';
}

// [추가] 공유 모달 관련 함수
function openShareModal() {
    const url = window.location.href;
    const input = document.getElementById('shareUrlInput');
    const img = document.getElementById('shareQrImg');
    const modal = document.getElementById('shareModal');
    
    if(input && img && modal) {
        input.value = url;
        // 무료 QR 생성 API (goqr.me)
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}`;
        modal.style.display = 'flex';
    }
}

function copyShareLink() {
    const copyText = document.getElementById("shareUrlInput");
    copyText.select();
    copyText.setSelectionRange(0, 99999); // 모바일 대응
    document.execCommand("copy");
    alert("링크가 복사되었습니다.");
}

// [추가] ================= 공지사항 관련 로직 =================

// 1. 공지사항 설정 저장 (관리자용)
async function saveNoticeSettings() {
    if(!isAdmin) return;
    
    const active = document.getElementById('chkNoticeActive').checked;
    const content = document.getElementById('noticeTextInput').value;
    
    // 내용이 변경되면 새로운 ID 부여하여 '오늘 보지 않기' 초기화 효과
    const currentId = globalData.config.notice?.id || Date.now();
    const newId = (globalData.config.notice?.content !== content) ? Date.now() : currentId;

    globalData.config.notice = {
        active: active,
        content: content,
        id: newId
    };

    // Firebase 및 로컬 저장
    syncToLocalStorage(globalData);
    
    // Firebase에 바로 저장
    const snapshot = await db.ref('/').once('value');
    let fullData = snapshot.val();
    if(!fullData.config) fullData.config = {};
    fullData.config.notice = globalData.config.notice;
    
    try {
        await db.ref('/').set(fullData);
        alert("공지사항 설정이 저장되었습니다.");
    } catch(e) {
        console.error(e);
        alert("로컬에는 저장되었으나 서버 전송 중 오류가 발생했습니다.");
    }
}

// 2. 접속 시 공지 띄우기 체크
function checkAndShowNotice() {
    const notice = globalData.config?.notice;
    if (!notice || !notice.active || !notice.content) return;

    // '오늘 하루 보지 않기' 체크 확인
    const hideKey = `kac_hide_notice_${notice.id}`;
    const hideDate = localStorage.getItem(hideKey);
    const today = new Date().toDateString();

    if (hideDate === today) return; // 오늘 이미 숨김 처리함

    // 팝업 내용 주입 및 표시
    document.getElementById('noticeContent').innerHTML = notice.content;
    document.getElementById('mainNoticeModal').style.display = 'flex';
}

// 3. 수동으로 공지사항 열기 (푸터/사이드바 클릭 시)
function showNoticeManual() {
    const notice = globalData.config?.notice;
    const content = (notice && notice.content) ? notice.content : "<p style='text-align:center; padding:20px; color:#64748b;'>현재 등록된 공지사항이 없습니다.</p>";
    
    document.getElementById('noticeContent').innerHTML = content;
    
    // 수동 오픈 시 '오늘 보지 않기' 체크박스는 숨기거나 초기화
    document.getElementById('dontShowToday').checked = false;
    document.getElementById('mainNoticeModal').style.display = 'flex';
}

// 4. 팝업 닫기 및 쿠키 처리
function closeNoticePopup() {
    const checkbox = document.getElementById('dontShowToday');
    const notice = globalData.config?.notice;

    if (checkbox.checked && notice && notice.id) {
        const hideKey = `kac_hide_notice_${notice.id}`;
        localStorage.setItem(hideKey, new Date().toDateString());
    }
    document.getElementById('mainNoticeModal').style.display = 'none';
}

init();