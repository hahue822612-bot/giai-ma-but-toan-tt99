/* GIẢI MÃ BÚT TOÁN DOANH NGHIỆP – CHUẨN THÔNG TƯ 99/2025/TT-BTC
 * Ứng dụng tĩnh 100% client-side, Zero-Build, tương thích tuyệt đối GitHub Pages.
 */
(function () {
  'use strict';

  const STORAGE_KEYS = {
    PROFILE: 'gmbt_tt99_profile_v2',
    WRONG: 'gmbt_tt99_wrong_v2',
    HISTORY: 'gmbt_tt99_history_v2',
    BEST: 'gmbt_tt99_best_v2',
  };

  const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

  const state = {
    loading: true,
    loadError: '',
    config: null,
    accountsData: null,
    stageCache: {},
    activeTab: 'home', // 'home' | 'accounts' | 'wrong' | 'history'
    view: 'tab',       // 'tab' | 'setup' | 'quiz' | 'result'
    profile: { fullName: '', className: '', programLevel: 'TC' },
    wrongRecords: [],
    history: [],
    bestScores: {},    // key: `${programLevel}_${stage}` -> number

    // Setup state
    setupStage: null,
    setupLoading: false,
    setupRawQuestions: [],
    setupMode: 'practice', // 'practice' | 'exam'
    setupLevel: 'ALL',
    setupType: 'ALL',
    setupCount: 20,
    setupDuration: 30,
    setupWarning: '',

    // Quiz state
    quiz: null, // { stageNumber, stageName, mode, questions, answers, currentIndex, durationMinutes, remainingSeconds, elapsedSeconds, startedAt, drawerOpen, confirmOpen }
    quizTimerId: null,

    // Result state
    resultAttempt: null,
    resultReturnTab: 'home',
    resultShowReview: false,
    resultReviewFilter: 'ALL', // 'ALL' | 'WRONG'

    // Accounts state
    accSearch: '',
    accGroup: 'ALL',
    accStage: 'ALL',
    accSelected: null,
    accExpandedMethods: {},

    // Wrong screen state
    wrongStageFilter: 'ALL',
    wrongExpanded: {},
  };

  // =========================================================================
  // 1. UTILITIES
  // =========================================================================
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function removeDiacritics(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
  }

  function formatScore10VN(score) {
    return Number(score || 0).toFixed(1).replace('.', ',');
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return String(m).padStart(2, '0') + ':' + String(rem).padStart(2, '0');
  }

  function formatDateTimeVN(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function sanitizeFilename(str) {
    return removeDiacritics(str).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'SinhVien';
  }

  function levelLabel(lvl) {
    if (lvl === 'Nhan_biet') return 'Nhận biết';
    if (lvl === 'Thong_hieu') return 'Thông hiểu';
    if (lvl === 'Van_dung') return 'Vận dụng';
    return lvl || '';
  }

  function typeLabel(t) {
    if (t === 'Ly_thuyet') return 'Lý thuyết';
    if (t === 'Dinh_khoan') return 'Định khoản';
    if (t === 'Tinh_huong') return 'Tình huống';
    if (t === 'Tinh_toan') return 'Tính toán';
    return t || '';
  }

  function toRel(path) {
    const clean = String(path || '').trim().replace(/^\/+/, '');
    return clean.startsWith('./') ? clean : './' + clean;
  }

  // Fisher-Yates shuffle
  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function prepareShuffledQuiz(questions, maxCount) {
    const qList = shuffle(questions);
    const sliced = maxCount > 0 ? qList.slice(0, maxCount) : qList;
    return sliced.map(function (q) {
      const indexed = q.options.map(function (txt, idx) {
        return { text: txt, isCorrect: idx === q.correctIndex };
      });
      const mixed = shuffle(indexed);
      const newCorrect = mixed.findIndex(function (x) { return x.isCorrect; });
      return Object.assign({}, q, {
        options: mixed.map(function (x) { return x.text; }),
        correctIndex: newCorrect >= 0 ? newCorrect : 0,
      });
    });
  }

  function calcScore10(correct, total) {
    if (!total) return 0;
    return Math.round((correct / total) * 100) / 10;
  }

  function resolveTitle(score10) {
    const rules = (state.config && state.config.scoring && state.config.scoring.titles) || [];
    const sorted = rules.slice().sort(function (a, b) { return b.minScore10 - a.minScore10; });
    for (let i = 0; i < sorted.length; i++) {
      if (score10 >= sorted[i].minScore10) return sorted[i];
    }
    return sorted[sorted.length - 1] || { icon: '🎓', name: 'Tân binh kế toán', color: '#475569' };
  }

  function makeVerificationCode(p) {
    const payload = [
      String(p.fullName || '').trim().toUpperCase(),
      String(p.className || '').trim().toUpperCase(),
      p.stageName,
      p.correctCount + '/' + p.totalQuestions,
      p.completedAt,
    ].join('|');
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < payload.length; i++) {
      const ch = payload.charCodeAt(i);
      h1 ^= ch;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= ch + ((h2 << 5) + (h2 >>> 2));
      h2 = Math.imul(h2, 0x85ebca6b);
    }
    const combined = ((h1 >>> 0) ^ (h2 >>> 0)) >>> 0;
    const hex = combined.toString(16).toUpperCase().padStart(8, '0').slice(0, 4);
    return 'GMBT-' + hex;
  }

  function computeBreakdowns(questions, answers) {
    const levels = ['Nhan_biet', 'Thong_hieu', 'Van_dung'];
    const types = ['Ly_thuyet', 'Dinh_khoan', 'Tinh_huong', 'Tinh_toan'];
    const byLevel = [];
    const byType = [];

    levels.forEach(function (lvl) {
      const qs = questions.filter(function (q) { return q.level === lvl; });
      if (!qs.length) return;
      const ok = qs.filter(function (q) { return answers[q.id] === q.correctIndex; }).length;
      byLevel.push({ key: lvl, label: levelLabel(lvl), correct: ok, total: qs.length, percent: Math.round((ok / qs.length) * 100) });
    });

    types.forEach(function (t) {
      const qs = questions.filter(function (q) { return q.questionType === t; });
      if (!qs.length) return;
      const ok = qs.filter(function (q) { return answers[q.id] === q.correctIndex; }).length;
      byType.push({ key: t, label: typeLabel(t), correct: ok, total: qs.length, percent: Math.round((ok / qs.length) * 100) });
    });

    return { byLevel: byLevel, byType: byType };
  }

  // =========================================================================
  // 2. LOCAL STORAGE
  // =========================================================================
  function loadStorage() {
    try {
      const p = JSON.parse(localStorage.getItem(STORAGE_KEYS.PROFILE) || 'null');
      if (p && typeof p === 'object') {
        state.profile = {
          fullName: String(p.fullName || ''),
          className: String(p.className || ''),
          programLevel: p.programLevel === 'CD' ? 'CD' : 'TC',
        };
      }
    } catch (e) {}
    try {
      const w = JSON.parse(localStorage.getItem(STORAGE_KEYS.WRONG) || '[]');
      if (Array.isArray(w)) state.wrongRecords = w;
    } catch (e) {}
    try {
      const h = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]');
      if (Array.isArray(h)) state.history = h;
    } catch (e) {}
    try {
      const b = JSON.parse(localStorage.getItem(STORAGE_KEYS.BEST) || '{}');
      if (b && typeof b === 'object') state.bestScores = b;
    } catch (e) {}
  }

  function saveProfile() {
    try { localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(state.profile)); } catch (e) {}
  }

  function saveWrong() {
    try { localStorage.setItem(STORAGE_KEYS.WRONG, JSON.stringify(state.wrongRecords)); } catch (e) {}
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history.slice(0, 40)));
    } catch (e) {
      try { localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history.slice(0, 15))); } catch (e2) {}
    }
  }

  function saveBest() {
    try { localStorage.setItem(STORAGE_KEYS.BEST, JSON.stringify(state.bestScores)); } catch (e) {}
  }

  function recordWrongQuestions(wrongQs) {
    if (!wrongQs.length) return;
    const map = {};
    state.wrongRecords.forEach(function (r) { map[r.question.id] = r; });
    const now = new Date().toISOString();
    wrongQs.forEach(function (q) {
      if (map[q.id]) {
        map[q.id] = { question: q, wrongCount: map[q.id].wrongCount + 1, lastWrongAt: now };
      } else {
        map[q.id] = { question: q, wrongCount: 1, lastWrongAt: now };
      }
    });
    state.wrongRecords = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      return new Date(b.lastWrongAt).getTime() - new Date(a.lastWrongAt).getTime();
    });
    saveWrong();
  }

  // =========================================================================
  // 3. DATA FETCHING
  // =========================================================================
  async function fetchJson(path) {
    const res = await fetch(toRel(path), { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' (' + path + ')');
    return await res.json();
  }

  async function initApp() {
    loadStorage();
    try {
      const results = await Promise.all([
        fetchJson('./data/config.json'),
        fetchJson('./data/accounts-tt99.json'),
      ]);
      state.config = results[0];
      state.accountsData = results[1];
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      const isFileProto = window.location.protocol === 'file:';
      state.loadError = isFileProto
        ? 'Trình duyệt đang chặn đọc tệp JSON do bạn mở trực tiếp bằng đường dẫn file:// trên máy tính. Khi tải lên GitHub Pages (https://...), ứng dụng sẽ tự động tải đầy đủ 1.176 câu hỏi và 71 tài khoản TT 99/2025 mà không gặp lỗi này.'
        : 'Không tải được dữ liệu từ thư mục ./data/ (' + (err && err.message ? err.message : 'Lỗi kết nối') + '). Hãy kiểm tra xem thư mục data/ và assets/ đã nằm cùng cấp với tệp index.html chưa.';
      render();
    }
  }

  async function openStageSetup(stageNum) {
    const st = state.config.stages.find(function (s) { return s.stage === stageNum; });
    if (!st) return;
    stopTimer();
    state.setupStage = st;
    state.setupMode = 'practice';
    state.setupLevel = 'ALL';
    state.setupType = 'ALL';
    state.setupCount = 20;
    state.setupDuration = 30;
    state.setupWarning = '';
    state.view = 'setup';

    if (state.stageCache[stageNum]) {
      state.setupRawQuestions = state.stageCache[stageNum];
      state.setupLoading = false;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    state.setupLoading = true;
    state.setupRawQuestions = [];
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const qs = await fetchJson(st.file);
      state.stageCache[stageNum] = Array.isArray(qs) ? qs : [];
      state.setupRawQuestions = state.stageCache[stageNum];
    } catch (e) {
      state.setupRawQuestions = [];
    }
    state.setupLoading = false;
    render();
  }

  function getFilteredSetupQuestions() {
    const rule = state.config.programRules[state.profile.programLevel];
    const allowed = rule ? rule.includeLevels : (state.profile.programLevel === 'TC' ? ['TC', 'BOTH'] : ['CD', 'BOTH']);
    return state.setupRawQuestions.filter(function (q) {
      if (allowed.indexOf(q.programLevel) === -1) return false;
      if (state.setupLevel !== 'ALL' && q.level !== state.setupLevel) return false;
      if (state.setupType !== 'ALL' && q.questionType !== state.setupType) return false;
      return true;
    });
  }

  // =========================================================================
  // 4. QUIZ ENGINE & TIMER
  // =========================================================================
  function stopTimer() {
    if (state.quizTimerId !== null) {
      window.clearInterval(state.quizTimerId);
      state.quizTimerId = null;
    }
  }

  function startQuiz(opts) {
    stopTimer();
    const totalSec = opts.durationMinutes * 60;
    state.quiz = {
      stageNumber: opts.stageNumber,
      stageName: opts.stageName,
      mode: opts.mode,
      questions: opts.questions,
      answers: {},
      currentIndex: 0,
      durationMinutes: opts.durationMinutes,
      remainingSeconds: totalSec,
      elapsedSeconds: 0,
      startedAt: new Date().toISOString(),
      drawerOpen: false,
      confirmOpen: false,
      submitted: false,
    };
    state.view = 'quiz';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    state.quizTimerId = window.setInterval(function () {
      if (!state.quiz || state.quiz.submitted) {
        stopTimer();
        return;
      }
      state.quiz.elapsedSeconds += 1;
      if (state.quiz.mode === 'exam') {
        state.quiz.remainingSeconds -= 1;
        if (state.quiz.remainingSeconds <= 0) {
          state.quiz.remainingSeconds = 0;
          finishQuiz();
          return;
        }
      }
      // Update timer DOM directly without full re-render flicker
      const el = document.getElementById('quiz-timer-val');
      const pill = document.getElementById('quiz-timer-pill');
      if (el) {
        el.textContent = formatDuration(state.quiz.mode === 'exam' ? state.quiz.remainingSeconds : state.quiz.elapsedSeconds);
      }
      if (pill && state.quiz.mode === 'exam' && state.quiz.remainingSeconds <= 120) {
        pill.classList.add('low');
      }
    }, 1000);
  }

  function finishQuiz() {
    if (!state.quiz || state.quiz.submitted) return;
    state.quiz.submitted = true;
    stopTimer();

    const qz = state.quiz;
    const total = qz.questions.length;
    const wrongQs = [];
    let correctCount = 0;

    qz.questions.forEach(function (q) {
      if (qz.answers[q.id] === q.correctIndex) {
        correctCount += 1;
      } else {
        wrongQs.push(q);
      }
    });

    const score10 = calcScore10(correctCount, total);
    const percent = total ? Math.round((correctCount / total) * 100) : 0;
    const title = resolveTitle(score10);
    const completedAt = new Date().toISOString();
    const verificationCode = makeVerificationCode({
      fullName: state.profile.fullName,
      className: state.profile.className,
      stageName: qz.stageName,
      correctCount: correctCount,
      totalQuestions: total,
      completedAt: completedAt,
    });
    const bd = computeBreakdowns(qz.questions, qz.answers);

    const attempt = {
      id: 'ATT_' + Date.now(),
      verificationCode: verificationCode,
      student: Object.assign({}, state.profile),
      stageNumber: qz.stageNumber,
      stageName: qz.stageName,
      mode: qz.mode,
      startedAt: qz.startedAt,
      completedAt: completedAt,
      durationSeconds: qz.elapsedSeconds,
      totalQuestions: total,
      correctCount: correctCount,
      score10: score10,
      percent: percent,
      title: title,
      questions: qz.questions,
      answers: qz.answers,
      byLevel: bd.byLevel,
      byType: bd.byType,
    };

    if (wrongQs.length > 0) recordWrongQuestions(wrongQs);

    state.history.unshift(attempt);
    if (state.history.length > 40) state.history = state.history.slice(0, 40);
    saveHistory();

    if (qz.stageNumber > 0) {
      const bestKey = state.profile.programLevel + '_' + qz.stageNumber;
      if (state.bestScores[bestKey] === undefined || score10 > state.bestScores[bestKey]) {
        state.bestScores[bestKey] = score10;
        saveBest();
      }
    }

    state.resultAttempt = attempt;
    state.resultReturnTab = state.activeTab;
    state.resultShowReview = false;
    state.resultReviewFilter = 'ALL';
    state.quiz = null;
    state.view = 'result';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // =========================================================================
  // 5. HTML5 CANVAS PNG CERTIFICATE (1080 x 1350px)
  // =========================================================================
  function drawRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawWrapped(ctx, text, x, y, maxW, lineH, align) {
    ctx.textAlign = align || 'left';
    const words = String(text || '').split(/\s+/);
    let line = '';
    let curY = y;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, curY);
        line = words[i];
        curY += lineH;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, curY);
      curY += lineH;
    }
    return curY;
  }

  function downloadCertificatePng(attempt) {
    const W = 1080;
    const H = 1350;
    const FONT = "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const brand = state.config.brand;

    // Background & double border
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, W, H);

    drawRoundRect(ctx, 36, 36, W - 72, H - 72, 24);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1E3A5F';
    ctx.stroke();

    drawRoundRect(ctx, 52, 52, W - 104, H - 104, 16);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#B45309';
    ctx.stroke();

    // Watermark
    ctx.save();
    ctx.translate(W / 2, H / 2 + 50);
    ctx.rotate(-0.34);
    ctx.font = '700 66px ' + FONT;
    ctx.fillStyle = 'rgba(30, 58, 95, 0.04)';
    ctx.textAlign = 'center';
    ctx.fillText('THÔNG TƯ 99/2025/TT-BTC', 0, 0);
    ctx.restore();

    // Academic header (no logo)
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1E3A5F';
    ctx.font = '700 22px ' + FONT;
    ctx.fillText(brand.org1, W / 2, 110);

    ctx.fillStyle = '#334155';
    ctx.font = '600 19px ' + FONT;
    ctx.fillText(brand.org2, W / 2, 142);

    ctx.fillStyle = '#0D9488';
    ctx.font = '700 20px ' + FONT;
    ctx.fillText(brand.org3, W / 2, 174);

    ctx.beginPath();
    ctx.moveTo(160, 198);
    ctx.lineTo(W - 160, 198);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#CBD5E1';
    ctx.stroke();

    // Title Banner
    drawRoundRect(ctx, 90, 222, W - 180, 96, 14);
    ctx.fillStyle = '#1E3A5F';
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 28px ' + FONT;
    ctx.fillText('PHIẾU KẾT QUẢ HỌC TẬP', W / 2, 264);

    ctx.fillStyle = '#FDE68A';
    ctx.font = '600 19px ' + FONT;
    ctx.fillText('KẾ TOÁN TÀI CHÍNH DOANH NGHIỆP (CHUẨN TT 99/2025/TT-BTC)', W / 2, 298);

    // Student info block
    drawRoundRect(ctx, 90, 344, W - 180, 280, 16);
    ctx.fillStyle = '#F8FAFC';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#E2E8F0';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = '600 17px ' + FONT;
    ctx.fillStyle = '#64748B';
    ctx.fillText('HỌ VÀ TÊN SINH VIÊN', 122, 384);
    ctx.fillText('LỚP & HỆ ĐÀO TẠO', 620, 384);

    ctx.font = '700 23px ' + FONT;
    ctx.fillStyle = '#0F172A';
    drawWrapped(ctx, (attempt.student.fullName || '').trim() || 'Chưa cập nhật', 122, 418, 470, 28, 'left');
    const progTxt = attempt.student.programLevel === 'TC' ? 'Trung cấp (TC)' : 'Cao đẳng (CĐ)';
    drawWrapped(ctx, ((attempt.student.className || '').trim() || 'Chưa cập nhật') + ' • ' + progTxt, 620, 418, 350, 28, 'left');

    ctx.font = '600 17px ' + FONT;
    ctx.fillStyle = '#64748B';
    ctx.fillText('CHẶNG HỌC TẬP', 122, 484);

    // Fixed: Never print "Chặng 0" for wrong-questions practice
    const stageLine = attempt.stageNumber > 0
      ? ('Chặng ' + attempt.stageNumber + ': ' + attempt.stageName)
      : attempt.stageName;
    ctx.font = '700 22px ' + FONT;
    ctx.fillStyle = '#1E3A5F';
    drawWrapped(ctx, stageLine, 122, 516, 840, 28, 'left');

    ctx.font = '600 17px ' + FONT;
    ctx.fillStyle = '#64748B';
    ctx.fillText('CHẾ ĐỘ LÀM BÀI', 122, 570);
    ctx.fillText('THỜI ĐIỂM HOÀN THÀNH', 620, 570);

    ctx.font = '600 20px ' + FONT;
    ctx.fillStyle = '#0F172A';
    ctx.fillText(attempt.mode === 'exam' ? 'Thi thử (Bấm giờ)' : 'Ôn luyện (Xem giải thích)', 122, 602);
    ctx.fillText(formatDateTimeVN(attempt.completedAt), 620, 602);

    // Score10 + Title parallel cards
    drawRoundRect(ctx, 90, 650, 430, 236, 18);
    ctx.fillStyle = '#1E3A5F';
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#CBD5E1';
    ctx.font = '600 19px ' + FONT;
    ctx.fillText('ĐIỂM ĐÁNH GIÁ (HỆ 10)', 305, 696);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 84px ' + FONT;
    ctx.fillText(formatScore10VN(attempt.score10), 305, 796);

    ctx.fillStyle = '#93C5FD';
    ctx.font = '700 23px ' + FONT;
    ctx.fillText('/ 10 điểm', 305, 846);

    drawRoundRect(ctx, 540, 650, 450, 236, 18);
    ctx.fillStyle = '#FFFBEB';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#B45309';
    ctx.stroke();

    ctx.fillStyle = '#92400E';
    ctx.font = '700 19px ' + FONT;
    ctx.fillText('DANH HIỆU ĐẠT ĐƯỢC', 765, 696);

    ctx.font = '62px ' + FONT;
    ctx.fillText(attempt.title.icon, 765, 774);

    ctx.fillStyle = attempt.title.color || '#B45309';
    ctx.font = '800 27px ' + FONT;
    drawWrapped(ctx, attempt.title.name, 765, 826, 400, 32, 'center');

    // 4 Stats boxes
    const stats = [
      { label: 'SỐ CÂU ĐÚNG', value: attempt.correctCount + ' / ' + attempt.totalQuestions, verify: false },
      { label: 'TỶ LỆ CHÍNH XÁC', value: attempt.percent + '%', verify: false },
      { label: 'THỜI GIAN LÀM BÀI', value: formatDuration(attempt.durationSeconds), verify: false },
      { label: 'MÃ XÁC THỰC', value: attempt.verificationCode, verify: true },
    ];
    const bW = 435;
    const bH = 112;
    stats.forEach(function (st, idx) {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const bx = 90 + col * (bW + 30);
      const by = 916 + row * (bH + 22);

      drawRoundRect(ctx, bx, by, bW, bH, 14);
      ctx.fillStyle = st.verify ? '#F0FDFA' : '#F8FAFC';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = st.verify ? '#0D9488' : '#CBD5E1';
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#64748B';
      ctx.font = '700 17px ' + FONT;
      ctx.fillText(st.label, bx + bW / 2, by + 40);

      ctx.fillStyle = st.verify ? '#0F766E' : '#0F172A';
      ctx.font = '800 32px ' + FONT;
      ctx.fillText(st.value, bx + bW / 2, by + 84);
    });

    // Footer
    ctx.beginPath();
    ctx.moveTo(90, 1196);
    ctx.lineTo(W - 90, 1196);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#E2E8F0';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#1E3A5F';
    ctx.font = '700 20px ' + FONT;
    ctx.fillText(brand.title + ' – ' + brand.slogan, W / 2, 1238);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 17px ' + FONT;
    ctx.fillText('Phiếu kết quả xuất tự động chuẩn TT 99/2025/TT-BTC • Giảng viên đối chiếu qua Mã xác thực.', W / 2, 1272);

    const stageSlug = attempt.stageNumber > 0 ? ('Chang' + attempt.stageNumber) : 'OnCauSai';
    const filename = 'PhieuDiem_' + sanitizeFilename(attempt.student.fullName) + '_' + stageSlug + '.png';

    if (canvas.toBlob) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          fallbackDownload(canvas, filename);
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      }, 'image/png');
    } else {
      fallbackDownload(canvas, filename);
    }
  }

  function fallbackDownload(canvas, filename) {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // =========================================================================
  // 6. SHARED RENDER HELPERS
  // =========================================================================
  function renderJournalLines(lines, isMethod) {
    const clean = (lines || []).map(function (l) { return String(l || '').trim(); }).filter(Boolean);
    if (!clean.length) return '';
    const html = clean.map(function (line) {
      if (/^Nợ\s+/i.test(line)) {
        return '<div class="je-debit">' + esc(line) + '</div>';
      }
      if (/^Có\s+/i.test(line)) {
        return '<div class="je-credit">' + esc(line) + '</div>';
      }
      return '<div class="je-note">' + esc(line) + '</div>';
    }).join('');
    return '<div class="journal-box' + (isMethod ? ' method-variant' : '') + '">' + html + '</div>';
  }

  function renderExplanation4Parts(q) {
    const jeHtml = q.journalEntry && q.journalEntry.trim()
      ? '<div><div class="expl-title" style="color:#0369A1;margin-bottom:4px">Định khoản chuẩn</div>' + renderJournalLines(q.journalEntry.split('\n'), false) + '</div>'
      : '';
    const qaHtml = q.qaGuidance && q.qaGuidance.trim()
      ? '<div class="guidance-box"><div class="guidance-title">💡 Lưu ý &amp; Mẹo tránh bẫy</div><p class="guidance-body">' + esc(q.qaGuidance) + '</p></div>'
      : '';
    const srcText = esc(q.source || '') + (q.sourceDetail ? ' – ' + esc(q.sourceDetail) : '');
    return (
      '<div class="explanation-wrap">' +
        '<div class="expl-box">' +
          '<div class="expl-title">Giải thích chuẩn TT 99/2025</div>' +
          '<p class="expl-body">' + esc(q.explanation) + '</p>' +
        '</div>' +
        jeHtml +
        qaHtml +
        (srcText ? '<div class="source-line">Nguồn: <strong>' + srcText + '</strong></div>' : '') +
      '</div>'
    );
  }

  // =========================================================================
  // 7. SCREEN RENDERERS
  // =========================================================================
  function renderHeader() {
    const b = state.config.brand;
    return (
      '<header class="site-header">' +
        '<div class="header-inner">' +
          '<div class="org-1">' + esc(b.org1) + '</div>' +
          '<div class="org-2">' + esc(b.org2) + '</div>' +
          '<div class="org-3">' + esc(b.org3) + '</div>' +
          '<div class="header-divider"></div>' +
          '<h1 class="site-title">' + esc(b.title) + '</h1>' +
          '<p class="site-slogan">' + esc(b.slogan) + '</p>' +
          '<div class="reg-pill"><span>📜</span><span>Chuẩn Thông tư 99/2025/TT-BTC (Hiệu lực 01/01/2026)</span></div>' +
        '</div>' +
      '</header>'
    );
  }

  function renderNav() {
    const disabled = state.view === 'quiz' ? ' disabled' : '';
    const tabs = [
      { id: 'home', label: 'Trang chủ', short: 'Trang chủ', icon: '🏠', badge: 0 },
      { id: 'accounts', label: 'Hệ thống TK TT99', short: 'TK TT99', icon: '📖', badge: 0 },
      { id: 'wrong', label: 'Ôn câu sai', short: 'Ôn câu sai', icon: '🔄', badge: state.wrongRecords.length },
      { id: 'history', label: 'Lịch sử', short: 'Lịch sử', icon: '📋', badge: state.history.length },
    ];

    const desktopHtml = tabs.map(function (t) {
      const act = state.activeTab === t.id && state.view === 'tab' ? ' active' : '';
      const bd = t.badge > 0 ? '<span class="nav-badge">' + t.badge + '</span>' : '';
      return '<button type="button" class="nav-btn' + act + '" data-nav="' + t.id + '"' + disabled + '>' +
        '<span>' + t.icon + '</span><span>' + t.label + '</span>' + bd + '</button>';
    }).join('');

    const mobileHtml = tabs.map(function (t) {
      const act = state.activeTab === t.id && state.view === 'tab' ? ' active' : '';
      const bd = t.badge > 0 ? '<span class="bottom-badge">' + (t.badge > 99 ? '99+' : t.badge) + '</span>' : '';
      return '<button type="button" class="bottom-nav-btn' + act + '" data-nav="' + t.id + '"' + disabled + '>' +
        '<span class="bottom-nav-icon">' + t.icon + bd + '</span><span>' + t.short + '</span></button>';
    }).join('');

    return (
      '<nav class="top-nav"><div class="top-nav-inner"><div class="top-nav-tabs">' + desktopHtml + '</div>' +
      '<div class="nav-meta">' + state.config.stages.reduce(function (s, x) { return s + (x.totalQuestions || 0); }, 0).toLocaleString('vi-VN') + ' câu hỏi • ' + state.accountsData.meta.totalLevel1 + ' TK TT 99/2025</div></div></nav>' +
      '<nav class="bottom-nav">' + mobileHtml + '</nav>'
    );
  }

  function renderHome() {
    const prog = state.profile.programLevel;
    const stagesHtml = state.config.stages.map(function (st) {
      const cnt = prog === 'TC' ? st.tcQuestions : st.cdQuestions;
      const best = state.bestScores[prog + '_' + st.stage];
      const tkChips = (st.keyAccounts || []).slice(0, 6).map(function (c) {
        return '<span class="chip-tk">' + esc(c) + '</span>';
      }).join('');
      return (
        '<div class="stage-card">' +
          '<div>' +
            '<div class="stage-head">' +
              '<div class="stage-icon">' + esc(st.icon) + '</div>' +
              '<div>' +
                '<div class="stage-kicker">Chặng ' + st.stage + '</div>' +
                '<h3 class="stage-title">' + esc(st.name) + '</h3>' +
              '</div>' +
            '</div>' +
            '<p class="stage-desc">' + esc(st.desc) + '</p>' +
            '<div class="chips-row" style="margin-top:10px">' +
              '<span class="chip chip-slate">' + cnt + ' câu (' + (prog === 'TC' ? 'TC' : 'CĐ') + ')</span>' +
              (best !== undefined ? '<span class="chip chip-amber">🏆 Cao nhất: ' + formatScore10VN(best) + '/10</span>' : '') +
            '</div>' +
            (tkChips ? '<div class="chips-row" style="margin-top:8px"><span style="font-size:0.72rem;color:#64748B;font-weight:600">TK trọng tâm:</span>' + tkChips + '</div>' : '') +
          '</div>' +
          '<div class="stage-actions">' +
            '<button type="button" class="btn btn-primary btn-full" data-open-stage="' + st.stage + '">▶ Vào học / Thi</button>' +
            '<button type="button" class="btn btn-teal-soft btn-full" data-stage-accounts="' + st.stage + '">📖 Xem TK chặng này</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="stack-lg">' +
        '<section class="card">' +
          '<div style="margin-bottom:14px">' +
            '<h2 class="section-heading" style="font-size:1.05rem">👤 Hồ sơ sinh viên</h2>' +
            '<p class="section-sub">Tự động lưu trên thiết bị và lọc chính xác ngân hàng câu hỏi theo hệ đào tạo</p>' +
          '</div>' +
          '<div class="profile-grid">' +
            '<div>' +
              '<label class="field-label" for="inp-fullname">Họ và tên sinh viên</label>' +
              '<input id="inp-fullname" class="text-input" type="text" placeholder="Ví dụ: Nguyễn Văn An" value="' + esc(state.profile.fullName) + '" />' +
            '</div>' +
            '<div>' +
              '<label class="field-label" for="inp-class">Lớp</label>' +
              '<input id="inp-class" class="text-input" type="text" placeholder="Ví dụ: CĐ KTDN 24A" value="' + esc(state.profile.className) + '" />' +
            '</div>' +
            '<div>' +
              '<label class="field-label">Hệ đào tạo (Lọc cứng câu hỏi)</label>' +
              '<div class="seg-2">' +
                '<button type="button" class="seg-btn' + (prog === 'TC' ? ' active' : '') + '" data-set-prog="TC">🎓 Trung cấp (TC)</button>' +
                '<button type="button" class="seg-btn' + (prog === 'CD' ? ' active' : '') + '" data-set-prog="CD">🎓 Cao đẳng (CĐ)</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<section class="stack-md">' +
          '<div>' +
            '<h2 class="section-heading">Lộ trình 11 Chặng Kế toán Tài chính Doanh nghiệp</h2>' +
            '<p class="section-sub">Đang lọc bộ câu hỏi cho hệ <strong style="color:var(--teal-dark)">' +
              (function () {
                const sum = state.config.stages.reduce(function (s, x) { return s + (prog === 'TC' ? (x.tcQuestions || 0) : (x.cdQuestions || 0)); }, 0);
                return prog === 'TC' ? ('Trung cấp (TC + Chung: ' + sum + ' câu)') : ('Cao đẳng (CĐ + Chung: ' + sum + ' câu)');
              })() +
            '</strong></p>' +
          '</div>' +
          '<div class="stages-grid">' + stagesHtml + '</div>' +
        '</section>' +
      '</div>'
    );
  }

  function renderSetup() {
    const st = state.setupStage;
    const filtered = getFilteredSetupQuestions();
    const prog = state.profile.programLevel;
    const needProfile = !state.profile.fullName.trim() || !state.profile.className.trim() || Boolean(state.setupWarning);

    const levels = [
      { id: 'ALL', lbl: 'Tất cả' },
      { id: 'Nhan_biet', lbl: 'Nhận biết' },
      { id: 'Thong_hieu', lbl: 'Thông hiểu' },
      { id: 'Van_dung', lbl: 'Vận dụng' },
    ];
    const types = [
      { id: 'ALL', lbl: 'Tất cả' },
      { id: 'Ly_thuyet', lbl: 'Lý thuyết' },
      { id: 'Dinh_khoan', lbl: 'Định khoản' },
      { id: 'Tinh_huong', lbl: 'Tình huống' },
      { id: 'Tinh_toan', lbl: 'Tính toán' },
    ];
    const counts = [
      { v: 10, lbl: '10 câu' },
      { v: 20, lbl: '20 câu' },
      { v: 30, lbl: '30 câu' },
      { v: 50, lbl: '50 câu' },
      { v: 0, lbl: 'Tất cả (' + filtered.length + ')' },
    ];
    const times = [15, 30, 45, 60];
    const actualCount = state.setupCount === 0 ? filtered.length : Math.min(state.setupCount, filtered.length);

    return (
      '<div class="narrow-container stack-md">' +
        '<div><button type="button" class="btn btn-outline" data-action="back-home">← Quay lại 11 Chặng</button></div>' +
        '<div class="card stack-lg">' +
          '<div class="stage-head" style="padding-bottom:14px;border-bottom:1px solid var(--border)">' +
            '<div class="stage-icon" style="width:48px;height:48px;font-size:1.5rem">' + esc(st.icon) + '</div>' +
            '<div>' +
              '<div class="stage-kicker">Thiết lập phiên học • Chặng ' + st.stage + '</div>' +
              '<h2 class="section-heading" style="margin-top:2px">' + esc(st.name) + '</h2>' +
              '<p class="section-sub">' + esc(st.desc) + '</p>' +
            '</div>' +
          '</div>' +

          (needProfile ? (
            '<div class="alert-amber stack-sm">' +
              '<div style="font-weight:700">⚠️ ' + esc(state.setupWarning || 'Bạn chưa điền đủ Họ tên và Lớp (bắt buộc khi Thi thử để xuất Phiếu kết quả PNG):') + '</div>' +
              '<div class="seg-2" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">' +
                '<input id="setup-fullname" class="text-input" type="text" placeholder="Họ và tên sinh viên..." value="' + esc(state.profile.fullName) + '" />' +
                '<input id="setup-class" class="text-input" type="text" placeholder="Lớp (VD: CĐ KTDN 24A)..." value="' + esc(state.profile.className) + '" />' +
              '</div>' +
            '</div>'
          ) : '') +

          '<div class="stack-sm">' +
            '<div class="field-label" style="font-size:0.88rem;color:var(--navy)">1. Chọn chế độ học tập</div>' +
            '<div class="mode-grid">' +
              '<button type="button" class="mode-card' + (state.setupMode === 'practice' ? ' active-practice' : '') + '" data-setup-mode="practice">' +
                '<div class="mode-card-icon">📘</div>' +
                '<div><div class="mode-card-title">Ôn luyện (Xem giải thích ngay)</div><div class="mode-card-desc">Chấm điểm &amp; xem lời giải, định khoản, mẹo tránh bẫy ngay từng câu.</div></div>' +
              '</button>' +
              '<button type="button" class="mode-card' + (state.setupMode === 'exam' ? ' active-exam' : '') + '" data-setup-mode="exam">' +
                '<div class="mode-card-icon">⏱️</div>' +
                '<div><div class="mode-card-title">Thi thử (Bấm giờ &amp; Xuất phiếu điểm)</div><div class="mode-card-desc">Đếm ngược thời gian, chỉ chấm điểm &amp; xuất Phiếu kết quả PNG sau khi nộp.</div></div>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="stack-md">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
              '<span style="font-size:0.88rem;font-weight:800;color:var(--navy)">2. Bộ lọc câu hỏi (Hệ ' + (prog === 'TC' ? 'Trung cấp' : 'Cao đẳng') + ')</span>' +
              '<span class="chip chip-navy">' + (state.setupLoading ? 'Đang tải...' : 'Khả dụng: ' + filtered.length + ' câu') + '</span>' +
            '</div>' +

            '<div>' +
              '<div class="field-label">Mức độ nhận thức</div>' +
              '<div class="filter-grid-4">' +
                levels.map(function (x) {
                  return '<button type="button" class="seg-btn' + (state.setupLevel === x.id ? ' active' : '') + '" data-setup-level="' + x.id + '">' + x.lbl + '</button>';
                }).join('') +
              '</div>' +
            '</div>' +

            '<div>' +
              '<div class="field-label">Loại câu hỏi</div>' +
              '<div class="filter-grid-5">' +
                types.map(function (x) {
                  return '<button type="button" class="seg-btn' + (state.setupType === x.id ? ' active-teal' : '') + '" data-setup-type="' + x.id + '">' + x.lbl + '</button>';
                }).join('') +
              '</div>' +
            '</div>' +

            '<div>' +
              '<div class="field-label">Số lượng câu hỏi</div>' +
              '<div class="filter-grid-5">' +
                counts.map(function (x) {
                  return '<button type="button" class="seg-btn' + (state.setupCount === x.v ? ' active' : '') + '" data-setup-count="' + x.v + '">' + x.lbl + '</button>';
                }).join('') +
              '</div>' +
            '</div>' +

            (state.setupMode === 'exam' ? (
              '<div>' +
                '<div class="field-label">Thời gian làm bài (Thi thử)</div>' +
                '<div class="filter-grid-4">' +
                  times.map(function (m) {
                    return '<button type="button" class="seg-btn' + (state.setupDuration === m ? ' active-amber' : '') + '" data-setup-time="' + m + '">' + m + ' phút</button>';
                  }).join('') +
                '</div>' +
              '</div>'
            ) : '') +
          '</div>' +

          '<div style="background:#F8FAFC;border:1px solid var(--border);border-radius:12px;padding:11px 13px;font-size:0.8rem;color:var(--text-sub)">' +
            '🔀 Hệ thống tự động xáo trộn thứ tự câu hỏi và đảo vị trí 4 phương án A, B, C, D mỗi phiên học để chống học vẹt.' +
          '</div>' +

          (!state.setupLoading && filtered.length === 0 ? '<div class="alert-red">Không có câu hỏi nào khớp bộ lọc hiện tại. Hãy chọn "Tất cả" ở Mức độ hoặc Loại câu hỏi.</div>' : '') +

          '<button type="button" class="btn btn-primary btn-full" style="min-height:54px;font-size:1rem" data-action="start-quiz"' +
            (state.setupLoading || filtered.length === 0 ? ' disabled' : '') + '>' +
            (state.setupLoading ? 'Đang tải ngân hàng câu hỏi...' : '▶ Bắt đầu ' + (state.setupMode === 'exam' ? 'Thi thử' : 'Ôn luyện') + ' (' + actualCount + ' câu)') +
          '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderQuiz() {
    const qz = state.quiz;
    const q = qz.questions[qz.currentIndex];
    const selected = qz.answers[q.id];
    const isAnswered = selected !== undefined;
    const showFeedback = qz.mode === 'practice' && isAnswered;
    const answeredCount = qz.questions.filter(function (item) { return qz.answers[item.id] !== undefined; }).length;
    const pct = Math.round(((qz.currentIndex + 1) / qz.questions.length) * 100);
    const isLow = qz.mode === 'exam' && qz.remainingSeconds <= 120;

    const optionsHtml = q.options.map(function (optText, idx) {
      let cls = 'option-btn';
      let iconRight = '';
      if (showFeedback) {
        if (idx === q.correctIndex) {
          cls += ' correct';
          iconRight = '<span style="font-size:1.1rem">✅</span>';
        } else if (idx === selected) {
          cls += ' wrong';
          iconRight = '<span style="font-size:1.1rem">❌</span>';
        } else {
          cls += ' muted';
        }
      } else if (idx === selected) {
        cls += ' selected';
      }
      const lock = showFeedback ? ' disabled' : '';
      return (
        '<button type="button" class="' + cls + '" data-pick-opt="' + idx + '"' + lock + '>' +
          '<span class="option-letter">' + OPTION_LETTERS[idx] + '</span>' +
          '<span class="option-content">' + esc(optText) + '</span>' +
          iconRight +
        '</button>'
      );
    }).join('');

    let drawerHtml = '';
    if (qz.drawerOpen) {
      const cells = qz.questions.map(function (item, i) {
        const ans = qz.answers[item.id];
        let c = 'qgrid-btn';
        if (qz.mode === 'practice' && ans !== undefined) {
          c += (ans === item.correctIndex ? ' correct' : ' wrong');
        } else if (ans !== undefined) {
          c += ' answered';
        }
        if (i === qz.currentIndex) c += ' current';
        return '<button type="button" class="' + c + '" data-jump-q="' + i + '">' + (i + 1) + '</button>';
      }).join('');

      drawerHtml =
        '<div class="overlay drawer-align" data-backdrop="drawer">' +
          '<div class="drawer-panel">' +
            '<div class="modal-head">' +
              '<div><div style="font-weight:800">Bảng câu hỏi</div><div style="font-size:0.76rem;color:#CBD5E1">Đã làm ' + answeredCount + ' / ' + qz.questions.length + ' câu</div></div>' +
              '<button type="button" class="modal-close-btn" data-close-drawer="1">✕</button>' +
            '</div>' +
            '<div class="modal-body"><div class="qgrid">' + cells + '</div></div>' +
          '</div>' +
        '</div>';
    }

    let confirmHtml = '';
    if (qz.confirmOpen) {
      const left = qz.questions.length - answeredCount;
      confirmHtml =
        '<div class="overlay" data-backdrop="confirm">' +
          '<div class="modal-panel stack-md">' +
            '<h3 style="margin:0;color:var(--navy)">⚠️ Xác nhận nộp bài?</h3>' +
            '<p style="margin:0;font-size:0.9rem;color:var(--text-sub)">Bạn đã trả lời <strong>' + answeredCount + ' / ' + qz.questions.length + '</strong> câu.' +
              (left > 0 ? ' Còn <strong>' + left + '</strong> câu chưa chọn đáp án.' : '') + '</p>' +
            '<div class="seg-2">' +
              '<button type="button" class="btn btn-outline" data-close-confirm="1">Làm tiếp</button>' +
              '<button type="button" class="btn btn-teal" data-action="confirm-submit">Nộp bài ngay</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    return (
      '<div class="narrow-container stack-md">' +
        '<div class="card">' +
          '<div class="quiz-topbar">' +
            '<div>' +
              '<div class="stage-kicker">' + (qz.stageNumber > 0 ? 'Chặng ' + qz.stageNumber + ': ' : '') + esc(qz.stageName) + '</div>' +
              '<div style="font-size:0.98rem;font-weight:800;color:var(--navy)">Câu ' + (qz.currentIndex + 1) + ' / ' + qz.questions.length +
                ' <span style="font-size:0.78rem;font-weight:600;color:var(--text-muted)">(Đã làm: ' + answeredCount + '/' + qz.questions.length + ')</span></div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<div id="quiz-timer-pill" class="timer-pill' + (isLow ? ' low' : '') + '">⏱ <span id="quiz-timer-val">' +
                formatDuration(qz.mode === 'exam' ? qz.remainingSeconds : qz.elapsedSeconds) + '</span></div>' +
              '<button type="button" class="btn btn-outline btn-sm" data-action="open-drawer">▦ Bảng câu</button>' +
            '</div>' +
          '</div>' +
          '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '</div>' +

        '<div class="card stack-md">' +
          '<div class="chips-row">' +
            '<span class="chip chip-navy">' + esc(levelLabel(q.level)) + '</span>' +
            '<span class="chip chip-teal">' + esc(typeLabel(q.questionType)) + '</span>' +
            '<span class="chip chip-slate" style="font-family:var(--font-mono)">' + esc(q.id) + '</span>' +
          '</div>' +
          '<h3 class="question-text">' + esc(q.question) + '</h3>' +
          '<div class="stack-sm">' + optionsHtml + '</div>' +
          (showFeedback ? renderExplanation4Parts(q) : '') +
        '</div>' +

        '<div class="quiz-footer-nav">' +
          '<button type="button" class="btn btn-outline" data-action="prev-q"' + (qz.currentIndex === 0 ? ' disabled' : '') + '>← Câu trước</button>' +
          (qz.currentIndex < qz.questions.length - 1
            ? '<button type="button" class="btn btn-primary" style="min-width:155px" data-action="next-q">Câu tiếp theo →</button>'
            : '<button type="button" class="btn btn-teal" style="min-width:175px" data-action="open-confirm">✓ Nộp bài &amp; Chấm điểm</button>') +
        '</div>' +

        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<button type="button" class="btn btn-sm" style="color:var(--text-muted)" data-action="cancel-quiz">Thoát phiên làm bài</button>' +
          '<button type="button" class="btn btn-teal-soft btn-sm" data-action="open-confirm">Nộp bài sớm (' + answeredCount + '/' + qz.questions.length + ')</button>' +
        '</div>' +
        drawerHtml +
        confirmHtml +
      '</div>'
    );
  }

  function renderResult() {
    const att = state.resultAttempt;
    const b = state.config.brand;
    const wrongQs = att.questions.filter(function (q) { return att.answers[q.id] !== q.correctIndex; });
    const reviewed = state.resultReviewFilter === 'WRONG' ? wrongQs : att.questions;

    function renderBars(list, defaultColor) {
      return list.map(function (s) {
        const col = s.percent >= 70 ? defaultColor : (s.percent >= 50 ? '#B45309' : '#DC2626');
        return (
          '<div class="bar-row">' +
            '<div class="bar-head"><span>' + esc(s.label) + '</span><span style="color:var(--navy)">' + s.correct + '/' + s.total + ' (' + s.percent + '%)</span></div>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + s.percent + '%;background:' + col + '"></div></div>' +
          '</div>'
        );
      }).join('');
    }

    let reviewHtml = '';
    if (state.resultShowReview) {
      const cards = reviewed.map(function (q, idx) {
        const uAns = att.answers[q.id];
        const ok = uAns === q.correctIndex;
        const opts = q.options.map(function (opt, oi) {
          let style = 'border:1px solid var(--border);background:#F8FAFC;color:#334155;';
          if (oi === q.correctIndex) style = 'border:1.5px solid var(--green);background:var(--green-soft);color:#064E3B;font-weight:700;';
          else if (oi === uAns) style = 'border:1.5px solid var(--red);background:var(--red-soft);color:#7F1D1D;';
          return '<div style="padding:8px 12px;border-radius:10px;font-size:0.86rem;' + style + '"><strong>' + OPTION_LETTERS[oi] + '.</strong> ' + esc(opt) + '</div>';
        }).join('');
        return (
          '<div class="card stack-sm">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">' +
              '<div class="chips-row">' +
                '<strong style="font-size:0.84rem;color:var(--navy)">Câu ' + (idx + 1) + '</strong>' +
                '<span class="chip chip-slate" style="font-family:var(--font-mono)">' + esc(q.id) + '</span>' +
                '<span class="chip chip-navy">' + esc(levelLabel(q.level)) + ' • ' + esc(typeLabel(q.questionType)) + '</span>' +
              '</div>' +
              (ok
                ? '<span class="chip" style="background:var(--green-soft);color:#065F46">✅ Đúng</span>'
                : '<span class="chip" style="background:var(--red-soft);color:#991B1B">❌ ' + (uAns === undefined ? 'Chưa làm' : 'Sai') + '</span>') +
            '</div>' +
            '<p class="question-text" style="font-size:0.95rem">' + esc(q.question) + '</p>' +
            '<div class="stack-sm">' + opts + '</div>' +
            renderExplanation4Parts(q) +
          '</div>'
        );
      }).join('');

      reviewHtml =
        '<section class="stack-md">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
            '<h3 class="section-heading" style="font-size:1.05rem">Chi tiết bài làm (' + reviewed.length + ' câu)</h3>' +
            '<div class="pill-wrap">' +
              '<button type="button" class="pill-btn' + (state.resultReviewFilter === 'ALL' ? ' active' : '') + '" data-rev-filter="ALL">Tất cả (' + att.questions.length + ')</button>' +
              '<button type="button" class="pill-btn' + (state.resultReviewFilter === 'WRONG' ? ' active' : '') + '" data-rev-filter="WRONG">Chỉ câu sai (' + wrongQs.length + ')</button>' +
            '</div>' +
          '</div>' +
          cards +
        '</section>';
    }

    return (
      '<div class="narrow-container stack-lg">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
          '<button type="button" class="btn btn-outline" data-action="result-back">← Quay lại</button>' +
          '<button type="button" class="btn btn-amber" data-action="download-png">📥 Tải ảnh Phiếu kết quả (PNG)</button>' +
        '</div>' +

        '<section class="cert-outer">' +
          '<div class="cert-inner">' +
            '<div style="text-align:center;border-bottom:1px solid var(--border);padding-bottom:12px">' +
              '<div style="font-size:0.74rem;font-weight:800;color:var(--navy);text-transform:uppercase">' + esc(b.org1) + '</div>' +
              '<div style="font-size:0.72rem;font-weight:600;color:var(--text-sub);text-transform:uppercase">' + esc(b.org2) + '</div>' +
              '<div style="font-size:0.76rem;font-weight:800;color:var(--teal);text-transform:uppercase">' + esc(b.org3) + '</div>' +
              '<div class="cert-banner">PHIẾU KẾT QUẢ HỌC TẬP – KẾ TOÁN TÀI CHÍNH (TT 99/2025)</div>' +
            '</div>' +

            '<div class="cert-info-grid">' +
              '<div><span class="cert-info-lbl">Họ và tên</span><span class="cert-info-val">' + esc((att.student.fullName || '').trim() || 'Chưa cập nhật') + '</span></div>' +
              '<div><span class="cert-info-lbl">Lớp &amp; Hệ đào tạo</span><span class="cert-info-val">' + esc((att.student.className || '').trim() || 'Chưa cập nhật') + ' • ' + (att.student.programLevel === 'TC' ? 'Trung cấp (TC)' : 'Cao đẳng (CĐ)') + '</span></div>' +
              '<div><span class="cert-info-lbl">Chặng học tập</span><span class="cert-info-val" style="color:var(--navy)">' + (att.stageNumber > 0 ? 'Chặng ' + att.stageNumber + ': ' : '') + esc(att.stageName) + '</span></div>' +
              '<div><span class="cert-info-lbl">Chế độ &amp; Ngày giờ</span><span class="cert-info-val">' + (att.mode === 'exam' ? 'Thi thử (Bấm giờ)' : 'Ôn luyện') + ' • ' + esc(formatDateTimeVN(att.completedAt)) + '</span></div>' +
            '</div>' +

            '<div class="cert-highlight">' +
              '<div class="score-box">' +
                '<div style="font-size:0.74rem;font-weight:700;text-transform:uppercase;color:#CBD5E1">Điểm hệ 10</div>' +
                '<div class="score-big">' + formatScore10VN(att.score10) + '<span style="font-size:1.1rem;color:#93C5FD"> / 10</span></div>' +
              '</div>' +
              '<div class="title-box">' +
                '<div style="font-size:0.74rem;font-weight:800;text-transform:uppercase;color:#92400E">Danh hiệu đạt được</div>' +
                '<div style="font-size:2.2rem;line-height:1.15;margin-top:4px">' + esc(att.title.icon) + '</div>' +
                '<div style="font-size:1.05rem;font-weight:900;margin-top:2px;color:' + esc(att.title.color || '#B45309') + '">' + esc(att.title.name) + '</div>' +
              '</div>' +
            '</div>' +

            '<div class="stats-4">' +
              '<div class="stat-tile"><div class="stat-lbl">Số câu đúng</div><div class="stat-val">' + att.correctCount + ' / ' + att.totalQuestions + '</div></div>' +
              '<div class="stat-tile"><div class="stat-lbl">Tỷ lệ %</div><div class="stat-val" style="color:var(--teal-dark)">' + att.percent + '%</div></div>' +
              '<div class="stat-tile"><div class="stat-lbl">Thời gian</div><div class="stat-val" style="font-family:var(--font-mono)">' + formatDuration(att.durationSeconds) + '</div></div>' +
              '<div class="stat-tile verify"><div class="stat-lbl">🛡️ Mã xác thực</div><div class="stat-val">' + esc(att.verificationCode) + '</div></div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<section class="card stack-md">' +
          '<h3 class="section-heading" style="font-size:1.02rem">Phân tích điểm mạnh / yếu</h3>' +
          '<div class="breakdown-grid">' +
            '<div class="stack-sm"><div class="field-label">Theo Mức độ nhận thức</div>' + renderBars(att.byLevel, '#0D9488') + '</div>' +
            '<div class="stack-sm"><div class="field-label">Theo Loại câu hỏi</div>' + renderBars(att.byType, '#1E3A5F') + '</div>' +
          '</div>' +
          '<div class="seg-2" style="padding-top:10px;border-top:1px solid #F1F5F9;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">' +
            '<button type="button" class="btn btn-primary" data-action="toggle-review">👁 ' + (state.resultShowReview ? 'Ẩn chi tiết bài làm' : 'Xem lại toàn bộ bài làm') + '</button>' +
            (wrongQs.length > 0 ? '<button type="button" class="btn btn-amber-soft" data-action="practice-attempt-wrong">🔄 Ôn riêng các câu làm sai (' + wrongQs.length + ' câu)</button>' : '') +
          '</div>' +
        '</section>' +

        reviewHtml +
      '</div>'
    );
  }

  function renderAccountModal() {
    const acc = state.accSelected;
    if (!acc) return '';
    const st = acc.structure || {};
    const hasDebitBal = !st.noBalance && Array.isArray(st.debitBalance) && st.debitBalance.length > 0;
    const hasCreditBal = !st.noBalance && Array.isArray(st.creditBalance) && st.creditBalance.length > 0;

    const allOpen = acc.methods.length > 0 && acc.methods.every(function (_, idx) { return Boolean(state.accExpandedMethods[idx]); });

    const subHtml = acc.subAccounts && acc.subAccounts.length
      ? '<div style="background:#F8FAFC;border:1px solid var(--border);border-radius:12px;padding:12px">' +
          '<div class="field-label" style="color:var(--teal-dark)">Tài khoản chi tiết thuộc TK ' + esc(acc.code) + '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px">' +
            acc.subAccounts.map(function (s) {
              return '<div style="background:#FFF;border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:0.82rem"><strong style="font-family:var(--font-mono);color:var(--navy)">' + esc(s.code) + '</strong> – ' + esc(s.name) + '</div>';
            }).join('') +
          '</div>' +
        '</div>'
      : '';

    const methodsHtml = acc.methods.map(function (m, idx) {
      const open = Boolean(state.accExpandedMethods[idx]);
      return (
        '<div class="acc-item">' +
          '<button type="button" class="acc-head" data-toggle-method="' + idx + '">' +
            '<span>' + esc(m.title) + '</span><span>' + (open ? '▲' : '▼') + '</span>' +
          '</button>' +
          (open ? '<div class="acc-body">' + renderJournalLines(m.entries, true) + '</div>' : '') +
        '</div>'
      );
    }).join('');

    return (
      '<div class="overlay" data-backdrop="acc">' +
        '<div class="account-modal-panel">' +
          '<div class="modal-head">' +
            '<div>' +
              '<div style="font-size:0.72rem;font-weight:700;color:#5EEAD4;text-transform:uppercase">' + esc(acc.groupName) + '</div>' +
              '<div style="font-size:1.1rem;font-weight:900">TK ' + esc(acc.code) + ' – ' + esc(acc.name) + '</div>' +
            '</div>' +
            '<button type="button" class="modal-close-btn" data-close-acc="1">✕</button>' +
          '</div>' +
          '<div class="modal-body">' +
            /* (i) Sơ đồ chữ T */
            '<section class="card stack-sm">' +
              '<h3 class="section-heading" style="font-size:0.94rem;text-align:center;text-transform:uppercase">(i) Sơ đồ chữ T – Kết cấu chuẩn TT 99/2025</h3>' +
              '<div class="t-diagram">' +
                '<div class="t-top">TK ' + esc(acc.code) + ' – ' + esc(acc.name) + '</div>' +
                '<div class="t-cols">' +
                  '<div class="t-col-debit">' +
                    '<div><div class="t-col-head debit">BÊN NỢ</div><ul class="t-list">' +
                      (st.debit || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') +
                    '</ul></div>' +
                    (hasDebitBal
                      ? '<div class="t-bal-box debit"><div class="t-bal-title">Số dư bên Nợ</div>' +
                          st.debitBalance.map(function (b) { return '<div>' + esc(b) + '</div>'; }).join('') + '</div>'
                      : '') +
                  '</div>' +
                  '<div class="t-col-credit">' +
                    '<div><div class="t-col-head credit">BÊN CÓ</div><ul class="t-list">' +
                      (st.credit || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') +
                    '</ul></div>' +
                    (hasCreditBal
                      ? '<div class="t-bal-box credit"><div class="t-bal-title">Số dư bên Có</div>' +
                          st.creditBalance.map(function (b) { return '<div>' + esc(b) + '</div>'; }).join('') + '</div>'
                      : '') +
                  '</div>' +
                '</div>' +
                (st.noBalance ? '<div class="t-nobal-bar">Tài khoản không có số dư cuối kỳ</div>' : '') +
              '</div>' +
              (st.balanceNote && !st.noBalance ? '<div style="font-size:0.78rem;color:var(--text-muted);text-align:center;font-style:italic">' + esc(st.balanceNote) + '</div>' : '') +
            '</section>' +

            /* (ii) Nguyên tắc kế toán */
            '<section class="card stack-sm">' +
              '<h3 class="section-heading" style="font-size:0.94rem;text-transform:uppercase">(ii) Nguyên tắc kế toán &amp; Tài khoản chi tiết</h3>' +
              subHtml +
              '<div class="stack-sm">' +
                (acc.principles || []).map(function (p, i) {
                  return '<div style="display:flex;gap:8px;font-size:0.84rem;color:#1E293B"><span class="chip chip-navy" style="height:24px;flex-shrink:0">' + (i + 1) + '</span><span>' + esc(p) + '</span></div>';
                }).join('') +
              '</div>' +
            '</section>' +

            /* (iii) Hướng dẫn hạch toán */
            '<section class="card stack-sm">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
                '<h3 class="section-heading" style="font-size:0.94rem;text-transform:uppercase">(iii) Hướng dẫn hạch toán các nghiệp vụ chủ yếu (' + acc.methods.length + ' mục)</h3>' +
                (acc.methods.length ? '<button type="button" class="btn btn-teal-soft btn-sm" data-action="toggle-all-methods">' + (allOpen ? 'Thu gọn tất cả' : 'Mở tất cả') + '</button>' : '') +
              '</div>' +
              '<div class="stack-sm">' + (methodsHtml || '<p class="section-sub">Chưa có mục hướng dẫn chi tiết.</p>') + '</div>' +
            '</section>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderAccounts() {
    const ad = state.accountsData;
    const detailMap = {};
    ad.accounts.forEach(function (a) { detailMap[a.code] = a; });

    let stageCodes = null;
    if (state.accStage !== 'ALL') {
      stageCodes = {};
      ad.accounts.forEach(function (a) {
        if (a.stages && a.stages.indexOf(state.accStage) !== -1) stageCodes[a.code] = true;
      });
      const stCfg = state.config.stages.find(function (s) { return s.stage === state.accStage; });
      if (stCfg && stCfg.keyAccounts) {
        stCfg.keyAccounts.forEach(function (c) { stageCodes[c.slice(0, 3)] = true; });
      }
    }

    const qNorm = removeDiacritics(state.accSearch.trim());
    const filtered = ad.catalog.filter(function (item) {
      if (state.accGroup !== 'ALL' && item.group !== state.accGroup) return false;
      const root = detailMap[item.code] ? item.code : (item.parent && detailMap[item.parent] ? item.parent : item.code.slice(0, 3));
      if (stageCodes && !stageCodes[root]) return false;
      if (qNorm) {
        const hitCode = item.code.toLowerCase().indexOf(qNorm) !== -1;
        const hitName = removeDiacritics(item.name).indexOf(qNorm) !== -1;
        if (!hitCode && !hitName) return false;
      }
      return true;
    });

    const groups = Object.keys(ad.meta.groups || {}).sort();
    const pdfHref = toRel((state.config.resources && state.config.resources.accountsPdf) || './assets/He_thong_tai_khoan_TT99_2025.pdf');

    const rowsHtml = filtered.length === 0
      ? '<div style="padding:32px;text-align:center;color:var(--text-muted);font-size:0.9rem">Không tìm thấy tài khoản nào khớp từ khóa hoặc bộ lọc.</div>'
      : filtered.map(function (item) {
          const root = detailMap[item.code] ? item.code : (item.parent && detailMap[item.parent] ? item.parent : item.code.slice(0, 3));
          const lvlCls = 'lvl-' + Math.min(5, Math.max(1, item.level));
          return (
            '<button type="button" class="catalog-row ' + lvlCls + '" data-open-acc="' + esc(root) + '">' +
              '<span class="code-badge">' + esc(item.code) + '</span>' +
              '<span class="catalog-name">' + esc(item.name) + '</span>' +
              '<span class="level-tag">Cấp ' + item.level + '</span>' +
              '<span style="color:var(--teal);font-weight:800">›</span>' +
            '</button>'
          );
        }).join('');

    return (
      '<div class="stack-md">' +
        '<section class="card stack-md">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">' +
            '<div>' +
              '<h2 class="section-heading">Hệ thống Tài khoản Kế toán TT 99/2025/TT-BTC</h2>' +
              '<p class="section-sub">' + ad.meta.totalLevel1 + ' TK cấp 1 • ' + ad.meta.totalCodes + ' mã TK (cấp 1 → cấp 5) • Bấm vào dòng bất kỳ để mở Sơ đồ chữ T &amp; Hướng dẫn hạch toán</p>' +
            '</div>' +
            '<a class="btn btn-amber" href="' + esc(pdfHref) + '" target="_blank" rel="noopener noreferrer">📄 Tải tài liệu PDF gốc – 319 trang</a>' +
          '</div>' +

          '<div style="position:relative">' +
            '<input id="acc-search-inp" class="text-input" type="text" placeholder="🔍 Tìm số hiệu (112, 332, 215...) hoặc tên tài khoản (có/không dấu)..." value="' + esc(state.accSearch) + '" />' +
          '</div>' +

          '<div>' +
            '<div class="field-label">Lọc theo 9 Loại tài khoản</div>' +
            '<div class="pill-wrap">' +
              '<button type="button" class="pill-btn' + (state.accGroup === 'ALL' ? ' active' : '') + '" data-acc-group="ALL">Tất cả loại</button>' +
              groups.map(function (g) {
                return '<button type="button" class="pill-btn' + (state.accGroup === g ? ' active' : '') + '" data-acc-group="' + g + '">' + esc(ad.meta.groups[g]) + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div>' +
            '<div class="field-label">Lọc theo 11 Chặng học tập</div>' +
            '<div class="pill-wrap">' +
              '<button type="button" class="pill-btn' + (state.accStage === 'ALL' ? ' active-teal' : '') + '" data-acc-stage="ALL">Tất cả chặng</button>' +
              state.config.stages.map(function (st) {
                return '<button type="button" class="pill-btn' + (state.accStage === st.stage ? ' active-teal' : '') + '" data-acc-stage="' + st.stage + '">Chặng ' + st.stage + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</section>' +

        '<section class="catalog-list">' +
          '<div style="padding:11px 14px;background:#F8FAFC;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;font-size:0.82rem;font-weight:800;color:var(--navy)">' +
            '<span>Bảng danh mục (' + ad.catalog.length + ' mã TK)</span>' +
            '<span style="color:var(--text-muted)">Hiển thị: ' + filtered.length + ' mục</span>' +
          '</div>' +
          rowsHtml +
        '</section>' +
        renderAccountModal() +
      '</div>'
    );
  }

  function renderWrong() {
    const stagesMap = {};
    state.wrongRecords.forEach(function (r) { stagesMap[r.question.stage] = r.question.stageName; });
    const stageNums = Object.keys(stagesMap).map(Number).sort(function (a, b) { return a - b; });
    const filtered = state.wrongStageFilter === 'ALL'
      ? state.wrongRecords
      : state.wrongRecords.filter(function (r) { return r.question.stage === state.wrongStageFilter; });

    const listHtml = filtered.length === 0
      ? '<div class="card" style="text-align:center;padding:36px 18px"><div style="font-size:2rem">🎉</div><h3 class="section-heading" style="margin-top:8px">Chưa có câu sai nào được lưu</h3><p class="section-sub">Các câu trả lời sai trong lúc Ôn luyện hoặc Thi thử sẽ tự động lưu tại đây để bạn luyện lại.</p></div>'
      : filtered.map(function (rec) {
          const q = rec.question;
          const isOpen = Boolean(state.wrongExpanded[q.id]);
          return (
            '<div class="card stack-sm">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
                '<div class="chips-row">' +
                  '<span class="chip chip-navy">Chặng ' + q.stage + '</span>' +
                  '<span class="chip chip-slate" style="font-family:var(--font-mono)">' + esc(q.id) + '</span>' +
                  '<span class="chip chip-amber">Sai ' + rec.wrongCount + ' lần</span>' +
                '</div>' +
                '<button type="button" class="btn btn-teal-soft btn-sm" data-remove-wrong="' + esc(q.id) + '">✓ Đã thuộc / Xóa</button>' +
              '</div>' +
              '<p class="question-text" style="font-size:0.95rem">' + esc(q.question) + '</p>' +
              '<div style="background:var(--green-soft);border:1px solid var(--green-border);border-radius:10px;padding:10px 12px;font-size:0.86rem;font-weight:700;color:#065F46">' +
                'Đáp án đúng: ' + esc(q.options[q.correctIndex]) +
              '</div>' +
              '<button type="button" class="btn btn-outline btn-sm btn-full" data-toggle-wrong="' + esc(q.id) + '">' +
                (isOpen ? '▲ Ẩn giải thích chi tiết' : '▼ Xem giải thích &amp; bút toán chuẩn') +
              '</button>' +
              (isOpen ? renderExplanation4Parts(q) : '') +
            '</div>'
          );
        }).join('');

    return (
      '<div class="stack-md">' +
        '<section class="card stack-md">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
            '<div>' +
              '<h2 class="section-heading">🔄 Kho Ôn câu sai (' + state.wrongRecords.length + ')</h2>' +
              '<p class="section-sub">Tự động lưu trên thiết bị. Bấm "Đã thuộc / Xóa" khi bạn đã nắm vững.</p>' +
            '</div>' +
            (filtered.length > 0
              ? '<div class="pill-wrap">' +
                  '<button type="button" class="btn btn-primary btn-sm" data-action="practice-wrong-all">▶ Ôn tập ngay (' + filtered.length + ' câu)</button>' +
                  '<button type="button" class="btn btn-danger-soft btn-sm" data-action="clear-wrong-all">🗑 Xóa tất cả</button>' +
                '</div>'
              : '') +
          '</div>' +
          (stageNums.length > 1
            ? '<div class="pill-wrap">' +
                '<button type="button" class="pill-btn' + (state.wrongStageFilter === 'ALL' ? ' active-teal' : '') + '" data-wrong-stage="ALL">Tất cả chặng</button>' +
                stageNums.map(function (sn) {
                  return '<button type="button" class="pill-btn' + (state.wrongStageFilter === sn ? ' active-teal' : '') + '" data-wrong-stage="' + sn + '">Chặng ' + sn + '</button>';
                }).join('') +
              '</div>'
            : '') +
        '</section>' +
        listHtml +
      '</div>'
    );
  }

  function renderHistory() {
    const cards = state.history.length === 0
      ? '<div class="card" style="text-align:center;padding:36px 18px"><div style="font-size:2rem">📋</div><h3 class="section-heading" style="margin-top:8px">Chưa có lịch sử làm bài</h3><p class="section-sub">Hoàn thành một lượt Ôn luyện hoặc Thi thử để xem lại Phiếu kết quả và tải ảnh PNG tại đây.</p></div>'
      : state.history.map(function (att, idx) {
          return (
            '<button type="button" class="history-card" data-open-history="' + idx + '">' +
              '<div class="stack-sm" style="gap:5px;min-width:0">' +
                '<div class="chips-row">' +
                  '<span class="chip" style="background:var(--navy);color:#FFF">' + (att.mode === 'exam' ? 'Thi thử' : 'Ôn luyện') + '</span>' +
                  '<span class="chip chip-teal" style="font-family:var(--font-mono)">🛡️ ' + esc(att.verificationCode) + '</span>' +
                  '<span style="font-size:0.74rem;color:var(--text-muted)">' + esc(formatDateTimeVN(att.completedAt)) + '</span>' +
                '</div>' +
                '<div style="font-weight:800;font-size:0.94rem;color:var(--navy)">' + (att.stageNumber > 0 ? 'Chặng ' + att.stageNumber + ': ' : '') + esc(att.stageName) + '</div>' +
                '<div style="font-size:0.78rem;color:var(--text-sub)">' +
                  esc(att.title.icon) + ' <strong>' + esc(att.title.name) + '</strong> • Đúng <strong>' + att.correctCount + '/' + att.totalQuestions + '</strong> (' + att.percent + '%) • ⏱ ' + formatDuration(att.durationSeconds) +
                '</div>' +
              '</div>' +
              '<div style="text-align:right;flex-shrink:0">' +
                '<div style="font-size:1.5rem;font-weight:900;color:var(--navy);line-height:1">' + formatScore10VN(att.score10) + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);font-weight:700">/ 10 đ</div>' +
              '</div>' +
            '</button>'
          );
        }).join('');

    return (
      '<div class="stack-md">' +
        '<section class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
          '<div>' +
            '<h2 class="section-heading">📋 Lịch sử làm bài (' + state.history.length + ')</h2>' +
            '<p class="section-sub">Bấm vào từng lượt để mở lại Phiếu kết quả &amp; tải ảnh PNG bất cứ lúc nào.</p>' +
          '</div>' +
          (state.history.length ? '<button type="button" class="btn btn-danger-soft btn-sm" data-action="clear-history">🗑 Xóa lịch sử</button>' : '') +
        '</section>' +
        '<div class="stack-sm">' + cards + '</div>' +
      '</div>'
    );
  }

  // =========================================================================
  // 8. MAIN RENDER & EVENT DELEGATION
  // =========================================================================
  function render() {
    const root = document.getElementById('app');
    if (!root) return;

    if (state.loading) {
      root.innerHTML = '<div class="loading-box"><div class="spinner"></div><p>Đang khởi tạo dữ liệu học tập chuẩn Thông tư 99/2025/TT-BTC...</p></div>';
      return;
    }

    if (state.loadError) {
      root.innerHTML =
        '<div class="error-banner">' +
          '<h2>⚠️ Không thể nạp dữ liệu JSON tại địa chỉ hiện tại</h2>' +
          '<p>' + esc(state.loadError) + '</p>' +
          '<p><strong>Gợi ý:</strong> Tải toàn bộ thư mục này lên <strong>GitHub Pages</strong> để có đường link <code>https://...</code> chạy mượt trên cả điện thoại và máy tính.</p>' +
        '</div>';
      return;
    }

    let bodyHtml = '';
    if (state.view === 'setup') bodyHtml = renderSetup();
    else if (state.view === 'quiz') bodyHtml = renderQuiz();
    else if (state.view === 'result') bodyHtml = renderResult();
    else if (state.activeTab === 'home') bodyHtml = renderHome();
    else if (state.activeTab === 'accounts') bodyHtml = renderAccounts();
    else if (state.activeTab === 'wrong') bodyHtml = renderWrong();
    else if (state.activeTab === 'history') bodyHtml = renderHistory();

    // Preserve search input focus/caret when typing on Accounts tab
    const activeEl = document.activeElement;
    const preserveId = activeEl && (activeEl.id === 'acc-search-inp' || activeEl.id === 'inp-fullname' || activeEl.id === 'inp-class' || activeEl.id === 'setup-fullname' || activeEl.id === 'setup-class')
      ? activeEl.id : null;
    const selStart = preserveId && activeEl.selectionStart !== null ? activeEl.selectionStart : null;

    root.innerHTML = renderHeader() + renderNav() + '<main class="main-container">' + bodyHtml + '</main>';

    if (preserveId) {
      const nextEl = document.getElementById(preserveId);
      if (nextEl) {
        nextEl.focus();
        if (selStart !== null && nextEl.setSelectionRange) {
          nextEl.setSelectionRange(selStart, selStart);
        }
      }
    }
  }

  // Click delegation
  document.addEventListener('click', function (e) {
    // Handle dark backdrop click directly (clicks inside panel will not match e.target)
    const backdrop = e.target && e.target.getAttribute ? e.target.getAttribute('data-backdrop') : null;
    if (backdrop === 'drawer' && state.quiz) { state.quiz.drawerOpen = false; render(); return; }
    if (backdrop === 'confirm' && state.quiz) { state.quiz.confirmOpen = false; render(); return; }
    if (backdrop === 'acc' && state.accSelected) { state.accSelected = null; render(); return; }

    const target = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!target) return;

    // Close overlays
    if (target.hasAttribute('data-close-drawer') && state.quiz) {
      state.quiz.drawerOpen = false;
      render();
      return;
    }
    if (target.hasAttribute('data-close-confirm') && state.quiz) {
      state.quiz.confirmOpen = false;
      render();
      return;
    }
    if (target.hasAttribute('data-close-acc') && state.accSelected) {
      state.accSelected = null;
      render();
      return;
    }

    // Navigation
    const navId = target.getAttribute('data-nav');
    if (navId && state.view !== 'quiz') {
      state.activeTab = navId;
      state.view = 'tab';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Program level toggle
    const prog = target.getAttribute('data-set-prog');
    if (prog) {
      state.profile.programLevel = prog === 'CD' ? 'CD' : 'TC';
      saveProfile();
      render();
      return;
    }

    // Open stage setup
    const stageNum = target.getAttribute('data-open-stage');
    if (stageNum) {
      openStageSetup(Number(stageNum));
      return;
    }

    // Jump to stage accounts
    const stAcc = target.getAttribute('data-stage-accounts');
    if (stAcc) {
      state.accStage = Number(stAcc);
      state.accGroup = 'ALL';
      state.activeTab = 'accounts';
      state.view = 'tab';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Setup controls
    const sMode = target.getAttribute('data-setup-mode');
    if (sMode) { state.setupMode = sMode; state.setupWarning = ''; render(); return; }

    const sLvl = target.getAttribute('data-setup-level');
    if (sLvl) { state.setupLevel = sLvl; render(); return; }

    const sType = target.getAttribute('data-setup-type');
    if (sType) { state.setupType = sType; render(); return; }

    const sCnt = target.getAttribute('data-setup-count');
    if (sCnt !== null) { state.setupCount = Number(sCnt); render(); return; }

    const sTime = target.getAttribute('data-setup-time');
    if (sTime) { state.setupDuration = Number(sTime); render(); return; }

    // Quiz answer pick
    const optIdx = target.getAttribute('data-pick-opt');
    if (optIdx !== null && state.quiz) {
      const curQ = state.quiz.questions[state.quiz.currentIndex];
      if (state.quiz.mode === 'practice' && state.quiz.answers[curQ.id] !== undefined) return;
      state.quiz.answers[curQ.id] = Number(optIdx);
      render();
      return;
    }

    // Quiz jump
    const jumpIdx = target.getAttribute('data-jump-q');
    if (jumpIdx !== null && state.quiz) {
      state.quiz.currentIndex = Number(jumpIdx);
      state.quiz.drawerOpen = false;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Result review filter
    const revF = target.getAttribute('data-rev-filter');
    if (revF) { state.resultReviewFilter = revF; render(); return; }

    // Accounts filters & modal
    const accG = target.getAttribute('data-acc-group');
    if (accG) { state.accGroup = accG; render(); return; }

    const accS = target.getAttribute('data-acc-stage');
    if (accS) { state.accStage = accS === 'ALL' ? 'ALL' : Number(accS); render(); return; }

    const openAcc = target.getAttribute('data-open-acc');
    if (openAcc && state.accountsData) {
      const found = state.accountsData.accounts.find(function (a) { return a.code === openAcc; });
      if (found) {
        state.accSelected = found;
        state.accExpandedMethods = { 0: true };
        render();
      }
      return;
    }

    const togM = target.getAttribute('data-toggle-method');
    if (togM !== null) {
      state.accExpandedMethods[Number(togM)] = !state.accExpandedMethods[Number(togM)];
      render();
      return;
    }

    // Wrong screen actions
    const wStage = target.getAttribute('data-wrong-stage');
    if (wStage) { state.wrongStageFilter = wStage === 'ALL' ? 'ALL' : Number(wStage); render(); return; }

    const rmWrong = target.getAttribute('data-remove-wrong');
    if (rmWrong) {
      state.wrongRecords = state.wrongRecords.filter(function (r) { return r.question.id !== rmWrong; });
      saveWrong();
      render();
      return;
    }

    const togWrong = target.getAttribute('data-toggle-wrong');
    if (togWrong) {
      state.wrongExpanded[togWrong] = !state.wrongExpanded[togWrong];
      render();
      return;
    }

    // Open history item
    const hIdx = target.getAttribute('data-open-history');
    if (hIdx !== null) {
      const att = state.history[Number(hIdx)];
      if (att) {
        state.resultAttempt = att;
        state.resultReturnTab = 'history';
        state.resultShowReview = false;
        state.resultReviewFilter = 'ALL';
        state.view = 'result';
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    // Named actions
    const action = target.getAttribute('data-action');
    if (!action) return;

    if (action === 'back-home') {
      stopTimer();
      state.view = 'tab';
      state.activeTab = 'home';
      render();
    } else if (action === 'start-quiz') {
      if (state.setupMode === 'exam' && (!state.profile.fullName.trim() || !state.profile.className.trim())) {
        state.setupWarning = 'Vui lòng nhập đầy đủ Họ và tên + Lớp trước khi bắt đầu Thi thử để xuất Phiếu kết quả chính xác.';
        render();
        return;
      }
      const filtered = getFilteredSetupQuestions();
      if (!filtered.length) return;
      startQuiz({
        stageNumber: state.setupStage.stage,
        stageName: state.setupStage.name,
        mode: state.setupMode,
        questions: prepareShuffledQuiz(filtered, state.setupCount),
        durationMinutes: state.setupDuration,
      });
    } else if (action === 'prev-q' && state.quiz && state.quiz.currentIndex > 0) {
      state.quiz.currentIndex -= 1;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'next-q' && state.quiz && state.quiz.currentIndex < state.quiz.questions.length - 1) {
      state.quiz.currentIndex += 1;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'open-drawer' && state.quiz) {
      state.quiz.drawerOpen = true;
      render();
    } else if (action === 'open-confirm' && state.quiz) {
      state.quiz.confirmOpen = true;
      render();
    } else if (action === 'confirm-submit') {
      finishQuiz();
    } else if (action === 'cancel-quiz') {
      stopTimer();
      state.quiz = null;
      state.view = 'tab';
      render();
    } else if (action === 'result-back') {
      state.activeTab = state.resultReturnTab;
      state.view = 'tab';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'download-png' && state.resultAttempt) {
      downloadCertificatePng(state.resultAttempt);
    } else if (action === 'toggle-review') {
      state.resultShowReview = !state.resultShowReview;
      render();
    } else if (action === 'practice-attempt-wrong' && state.resultAttempt) {
      const wrongQs = state.resultAttempt.questions.filter(function (q) {
        return state.resultAttempt.answers[q.id] !== q.correctIndex;
      });
      if (wrongQs.length) {
        startQuiz({
          stageNumber: 0,
          stageName: 'Ôn tập các câu làm sai',
          mode: 'practice',
          questions: prepareShuffledQuiz(wrongQs, 0),
          durationMinutes: 30,
        });
      }
    } else if (action === 'toggle-all-methods' && state.accSelected) {
      const allOpen = state.accSelected.methods.every(function (_, idx) { return Boolean(state.accExpandedMethods[idx]); });
      state.accExpandedMethods = {};
      if (!allOpen) {
        state.accSelected.methods.forEach(function (_, idx) { state.accExpandedMethods[idx] = true; });
      }
      render();
    } else if (action === 'practice-wrong-all') {
      const filtered = state.wrongStageFilter === 'ALL'
        ? state.wrongRecords
        : state.wrongRecords.filter(function (r) { return r.question.stage === state.wrongStageFilter; });
      if (filtered.length) {
        startQuiz({
          stageNumber: 0,
          stageName: 'Ôn tập các câu làm sai',
          mode: 'practice',
          questions: prepareShuffledQuiz(filtered.map(function (r) { return r.question; }), 0),
          durationMinutes: 30,
        });
      }
    } else if (action === 'clear-wrong-all') {
      state.wrongRecords = [];
      saveWrong();
      render();
    } else if (action === 'clear-history') {
      state.history = [];
      saveHistory();
      render();
    }
  });

  // Input listeners
  document.addEventListener('input', function (e) {
    const id = e.target && e.target.id;
    if (id === 'inp-fullname' || id === 'setup-fullname') {
      state.profile.fullName = e.target.value;
      state.setupWarning = '';
      saveProfile();
    } else if (id === 'inp-class' || id === 'setup-class') {
      state.profile.className = e.target.value;
      state.setupWarning = '';
      saveProfile();
    } else if (id === 'acc-search-inp') {
      state.accSearch = e.target.value;
      render();
    }
  });

  initApp();
})();
