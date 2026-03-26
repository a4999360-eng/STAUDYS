// Firebase Configuration
const firebaseConfig = {
    apiKey: "YOUR_KEY",
    authDomain: "YOUR_DOMAIN",
    projectId: "YOUR_ID",
    storageBucket: "YOUR_BUCKET",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

function isFirebaseConfigValid() {
    return firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_KEY";
}

try {
    if (isFirebaseConfigValid()) {
        firebase.initializeApp(firebaseConfig);
    } else {
        console.info("Firebase config not set, using purely Local Storage mode.");
    }
} catch (e) {
    console.error("Firebase initialization failed", e);
}

const auth = isFirebaseConfigValid() ? firebase.auth() : { onAuthStateChanged: (cb) => { setTimeout(() => cb(null), 100); }, signOut: () => {} };
const db = isFirebaseConfigValid() ? firebase.firestore() : null;

// Application State
let userId = null;
let tasks = [];
let points = 0;
let xp = 0;
let level = 1;
let completedCount = 0;
let achievements = [];
let timerTime = 1500;
let timerInterval = null;
let lastMilestone = 0;

// Settings
let settings = {
    xpPerTask: 10,
    timerDuration: 25
};

// --- Elements ---
const taskInput = document.getElementById('taskInput');
const taskList = document.getElementById('taskList');
const pointsSpan = document.getElementById('points');
const levelSpan = document.getElementById('level');
const xpSpan = document.getElementById('xp');
const nextXPSpan = document.getElementById('nextXP');
const xpBarInner = document.getElementById('xp-bar-inner');
const timerDisplay = document.getElementById('timer-display');
const loginNav = document.getElementById('login-nav');
const userNav = document.getElementById('user-nav');
const userNameSpan = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const xpSetting = document.getElementById('xpSetting');
const timerSetting = document.getElementById('timerSetting');

// --- Navigation ---
window.showPage = (pageId, btn) => {
    document.querySelectorAll('.page-container').forEach(p => p.classList.add('hidden'));
    document.getElementById(pageId).classList.remove('hidden');
    
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    if (pageId === 'storage-page') renderStorage();
};

// --- Auth ---
// Kept for compatibility; GIS now handles Google Sign-In via handleCredentialResponse
window.login = () => {
    // GIS renders its own button; this function is no longer the primary entry point
    console.info('Use the Google Sign-In button rendered by GIS.');
};

// --- Google Identity Services (GIS) ---
function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
        window.atob(base64).split('').map(c =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join('')
    );
    return JSON.parse(jsonPayload);
}

window.handleCredentialResponse = async (response) => {
    const payload = parseJwt(response.credential);

    // Use email as unique user ID (consistent with previous GIS integration)
    const googleUserId = `google_${payload.email}`;
    userId = googleUserId;
    localStorage.setItem('username_id', userId);
    localStorage.setItem('username_real', payload.name);

    // UI: close overlay & show user info
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.add('hidden');
    userNameSpan.innerText = payload.name.split(' ')[0];
    userNav.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');

    await loadData();
    renderAll();
    console.log('تم الدخول بنجاح:', payload.email);
};

window.loginWithUsername = async () => {
    const input = document.getElementById('usernameInput');
    const name = input.value.trim();
    if (!name) return;

    // Use name as the ID for simple login
    userId = `user_${name}`;
    localStorage.setItem('username_id', userId);
    localStorage.setItem('username_real', name);
    
    // UI update
    userNameSpan.innerText = name;
    userNav.classList.remove('hidden');
    loginNav.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    
    await loadData();
    renderAll();
};

window.logout = () => {
    localStorage.removeItem('username_id');
    localStorage.removeItem('username_real');
    auth.signOut();
};

window.loginWithUsernameOverlay = async () => {
    const input = document.getElementById('usernameInputOverlay');
    const name = input.value.trim();
    if (!name) return;

    userId = `user_${name}`;
    localStorage.setItem('username_id', userId);
    localStorage.setItem('username_real', name);
    
    // UI toggle
    document.getElementById('login-overlay').classList.add('hidden');
    userNameSpan.innerText = name;
    userNav.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    
    await loadData();
    renderAll();
};

window.logout = () => {
    localStorage.removeItem('username_id');
    localStorage.removeItem('username_real');
    auth.signOut();
    // Reset page view for next user
    location.reload(); 
};

async function handleAuthState(user) {
    const overlay = document.getElementById('login-overlay');
    if (user) {
        userId = user.uid;
        userNameSpan.innerText = user.displayName.split(' ')[0];
        userNav.classList.remove('hidden');
        if (overlay) overlay.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
        await loadData();
    } else {
        const savedId = localStorage.getItem('username_id');
        const savedName = localStorage.getItem('username_real');
        if (savedId && savedName) {
            userId = savedId;
            userNameSpan.innerText = savedName;
            userNav.classList.remove('hidden');
            if (overlay) overlay.classList.add('hidden');
            logoutBtn.classList.remove('hidden');
            await loadData();
        } else {
            userId = null;
            userNav.classList.add('hidden');
            if (overlay) overlay.classList.remove('hidden');
            logoutBtn.classList.add('hidden');
            loadLocalData();
        }
    }
    renderAll();
}

if (isFirebaseConfigValid()) {
    auth.onAuthStateChanged(handleAuthState);
} else {
    // Immediate execution for Local-Only mode
    handleAuthState(null);
}

function loadLocalData() {
    tasks = JSON.parse(localStorage.getItem('tasks')) || [];
    points = parseInt(localStorage.getItem('points')) || 0;
    xp = parseInt(localStorage.getItem('xp')) || 0;
    level = parseInt(localStorage.getItem('level')) || 1;
    completedCount = parseInt(localStorage.getItem('completedCount')) || 0;
    achievements = JSON.parse(localStorage.getItem('achievements')) || [];
    settings = JSON.parse(localStorage.getItem('settings')) || { xpPerTask: 10, timerDuration: 25 };
    lastMilestone = Math.floor(points / 100) * 100;
}

async function loadData() {
    if (!userId) return;
    
    // 1. Try Firebase if configured
    if (db) {
        try {
            const doc = await db.collection("users").doc(userId).get();
            if (doc.exists) {
                applyData(doc.data());
                return;
            }
        } catch (e) {
            console.warn("Firebase load failed, trying local fallback", e);
        }
    }

    // 2. Fallback to localStorage for this specific user
    const localData = localStorage.getItem('data_' + userId);
    if (localData) {
        applyData(JSON.parse(localData));
    } else {
        resetDataState();
        renderAll(); // Final fallback
    }
}

function applyData(data) {
    tasks = data.tasks || [];
    points = data.points || 0;
    xp = data.xp || 0;
    level = data.level || 1;
    completedCount = data.completedCount || 0;
    achievements = data.achievements || [];
    settings = data.settings || { xpPerTask: 10, timerDuration: 25 };
    lastMilestone = Math.floor(points / 100) * 100;
    renderAll();
    applySettingsToUI();
}

function resetDataState() {
    tasks = [];
    points = 0;
    xp = 0;
    level = 1;
    completedCount = 0;
    achievements = [];
    settings = { xpPerTask: 10, timerDuration: 25 };
    lastMilestone = 0;
}

function saveData() {
    const data = { tasks, points, xp, level, completedCount, achievements, settings };
    
    if (userId) {
        // Always save locally (Primary Source)
        localStorage.setItem('data_' + userId, JSON.stringify(data));
        
        // Try Cloud sync if possible
        if (db) {
            db.collection("users").doc(userId).set(data).catch(e => console.warn("Firebase save failed", e));
        }
    } else {
        // Ghost mode save
        localStorage.setItem('tasks', JSON.stringify(tasks));
        localStorage.setItem('points', points);
        localStorage.setItem('xp', xp);
        localStorage.setItem('level', level);
        localStorage.setItem('completedCount', completedCount);
        localStorage.setItem('achievements', JSON.stringify(achievements));
        localStorage.setItem('settings', JSON.stringify(settings));
    }
}

// --- Settings ---
function applySettingsToUI() {
    xpSetting.value = settings.xpPerTask;
    timerSetting.value = settings.timerDuration;
    if (!timerInterval) {
        timerTime = settings.timerDuration * 60;
        updateTimerDisplay();
    }
}

window.saveSettings = () => {
    settings.xpPerTask = parseInt(xpSetting.value);
    settings.timerDuration = parseInt(timerSetting.value);
    saveData();
    alert("✅ تم حفظ الإعدادات!");
    if (!timerInterval) {
        timerTime = settings.timerDuration * 60;
        updateTimerDisplay();
    }
};

// --- Progression ---
function getNextXP() { return level * 50; }

function addXP(amount) {
    xp += amount;
    while (xp >= getNextXP()) {
        xp -= getNextXP();
        level++;
        showAchievementNotification("مستوى جديد!", `وصلت للمستوى ${level} 🔥`);
    }
    checkAchievements();
    checkMotivationMilestone();
    saveData();
    renderAll();
}

function checkAchievements() {
    const newAchievements = [];
    if (level >= 2 && !achievements.includes("L2")) newAchievements.push({id: "L2", name: "المستوى الثاني 🎉"});
    if (completedCount >= 5 && !achievements.includes("T5")) newAchievements.push({id: "T5", name: "إنجاز 5 مهام 🔥"});
    
    newAchievements.forEach(a => {
        achievements.push(a.id);
        showAchievementNotification("إنجاز جديد!", a.name);
    });
}

function checkMotivationMilestone() {
    const milestone = Math.floor(points / 100) * 100;
    if (milestone > lastMilestone && milestone > 0) {
        lastMilestone = milestone;
        showMotivationModal(milestone);
    }
}

// --- UI Rendering ---
function renderAll() {
    renderTasks();
    renderProgression();
    if (!document.getElementById('storage-page').classList.contains('hidden')) renderStorage();
}

function renderTasks() {
    taskList.innerHTML = '';
    const activeTasks = tasks.filter(t => !t.archived);
    activeTasks.forEach(task => {
        const div = document.createElement('div');
        div.className = `task-item-mobile ${task.completed ? 'completed' : ''}`;
        
        // ... (same logic for dateTimeStr)
        let dateTimeStr = "";
        if (task.date || task.time) {
            const dayName = task.date ? getArabicDayName(task.date) : "";
            dateTimeStr = `<div class="task-date-time">
                ${task.date ? `<span class="t-date"><i class="fas fa-calendar-alt"></i> ${dayName} ${task.date}</span>` : ""}
                ${task.time ? `<span class="t-time"><i class="fas fa-clock"></i> ${task.time}</span>` : ""}
            </div>`;
        }

        div.innerHTML = `
            <div class="task-main-info" onclick="toggleTask(${task.id})">
                <div class="task-txt">${task.text}</div>
                ${dateTimeStr}
            </div>
            <div class="task-actions-mini">
                <button class="mini-btn check" onclick="toggleTask(${task.id})">
                    <i class="fas ${task.completed ? 'fa-check-double' : 'fa-circle-check'}"></i>
                </button>
                <button class="mini-btn del" onclick="deleteTask(${task.id})">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
        `;
        taskList.appendChild(div);
    });
    updatePointsUI();
}

function updatePointsUI() {
    pointsSpan.innerText = points;
    const btn = document.getElementById('buy-mot-btn');
    if (!btn) return;
    if (points >= 100) {
        btn.classList.add('active');
        btn.classList.remove('disabled');
        btn.disabled = false;
    } else {
        btn.classList.remove('active');
        btn.classList.add('disabled');
        btn.disabled = true;
    }
}

window.spendPoints = () => {
    if (points < 100) return;
    points -= 100;
    saveData();
    updatePointsUI();
    
    const premiumMessages = [
        "لا تتوقف أبداً! العظمة تتطلب الصبر والجهد. 💎",
        "أنت تبني مستقبلك مع كل دقيقة دراسة. استمر! 🔥",
        "النجاح ليس صدفة، بل نتيجة قراراتك اليوم. 🚀",
        "تذكر دائماً لماذا بدأت.. الهدف يستحق التعب. ✨",
        "العالم ينتظر لمستك الخاصة وتأثيرك المبدع! 🏆"
    ];
    
    showMotivationModalPremium("مكافأة الحماس! ✨", premiumMessages[Math.floor(Math.random() * premiumMessages.length)]);
};

function showMotivationModalPremium(title, msg) {
    const modal = document.getElementById('motivation-modal');
    document.getElementById('mot-title').innerText = title;
    document.getElementById('mot-message').innerText = msg;
    modal.classList.remove('hidden');
}

function renderProgression() {
    levelSpan.innerText = level;
    nextXPSpan.innerText = getNextXP();
    xpBarInner.style.width = `${(xp / getNextXP()) * 100}%`;
    
    // Animated XP counter
    const currentDisplayed = parseInt(xpSpan.innerText) || 0;
    if (currentDisplayed !== xp) {
        animateCounter(xpSpan, currentDisplayed, xp, 400);
    }
}

function animateCounter(element, from, to, duration) {
    const startTime = performance.now();
    const diff = to - from;
    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // easeOutQuad for smooth deceleration
        const eased = 1 - (1 - progress) * (1 - progress);
        element.innerText = Math.round(from + diff * eased);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function renderAchievements() {
    const achBox = document.getElementById('achievements-list');
    if (!achBox) return;
    achBox.innerHTML = '';
    achievements.forEach(a => {
        const div = document.createElement('div');
        div.className = 'achievement-item';
        let text = a === "L2" ? "المستوى الثاني 🎉" : "بطل المهام 🔥";
        div.innerHTML = `<i class="fas fa-medal"></i> ${text}`;
        achBox.appendChild(div);
    });
}

// --- Task Actions ---
window.addTask = () => {
    const text = taskInput.value.trim();
    let date = document.getElementById('taskDate').value;
    const time = document.getElementById('taskTime').value;

    if (!text) return;

    // Default to today if date is empty
    if (!date) {
        const today = new Date();
        date = today.toISOString().split('T')[0];
    }

    tasks.push({ 
        id: Date.now(), 
        text, 
        completed: false,
        date: date,
        time: time || null,
        notified: false,
        archived: false // New flag
    });

    taskInput.value = "";
    document.getElementById('taskTime').value = "";
    saveData();
    renderTasks();
    requestNotificationPermission();
};

function getArabicDayName(dateStr) {
    const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const d = new Date(dateStr);
    return days[d.getDay()];
}

window.toggleTask = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const wasComp = task.completed;
    task.completed = !wasComp;
    if (!wasComp && task.completed) {
        points += settings.xpPerTask;
        completedCount++;
        addXP(settings.xpPerTask);
    }
    saveData();
    renderTasks();
};

window.deleteTask = (id) => {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.archived = true;
        saveData();
        renderAll();
    }
};

window.permanentDelete = (id) => {
    // حذف المهمة فوراً بناءً على طلب المستخدم
    tasks = tasks.filter(t => t.id !== id);
    saveData();
    renderAll();
};

// --- Timer ---
window.toggleTimer = () => {
    const btn = document.getElementById('timerBtn');
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
        btn.innerHTML = '<i class="fas fa-play"></i> ابدأ';
    } else {
        timerInterval = setInterval(() => {
            timerTime--;
            updateTimerDisplay();
            if (timerTime <= 0) {
                clearInterval(timerInterval);
                timerInterval = null;
                addXP(50);
                points += 10;
                alert("💪 جولة رائعة! +50 XP");
                resetTimer();
            }
        }, 1000);
        btn.innerHTML = '<i class="fas fa-pause"></i> إيقاف';
    }
};

window.resetTimer = () => {
    clearInterval(timerInterval);
    timerInterval = null;
    timerTime = settings.timerDuration * 60;
    updateTimerDisplay();
    document.getElementById('timerBtn').innerHTML = '<i class="fas fa-play"></i> ابدأ';
};

function updateTimerDisplay() {
    const m = Math.floor(timerTime/60);
    const s = timerTime%60;
    timerDisplay.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
}

// --- Popups ---
function showAchievementNotification(title, desc) {
    const banner = document.getElementById('achievement-banner');
    document.getElementById('achievement-name').innerText = desc;
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 4000);
}

function showMotivationModal(m) {
    const modal = document.getElementById('motivation-modal');
    const title = document.getElementById('mot-title');
    const msg = document.getElementById('mot-message');
    
    const messages = [
        "أنت وحش الإنتاجية مرعب! 🦁",
        "مستقبلك يبنى بيدك الآن.. لا تتوقف! 🔥",
        "100 نقطة من العظمة.. أنت في القمة! 🚀",
        "العالم ينتظر نجاحك.. استمر في تحطيم الأرقام! ✨"
    ];
    
    title.innerText = `عظيم! وصلت لـ ${m} نقطة 🥇`;
    msg.innerText = messages[Math.floor(Math.random() * messages.length)];
    modal.classList.remove('hidden');
}

window.closeMotivation = () => {
    document.getElementById('motivation-modal').classList.add('hidden');
};

// --- Storage System ---
function getWeekStartDate(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay(); // Sunday is 0
    const diff = d.getDate() - day;
    const start = new Date(d.setDate(diff));
    return start.toISOString().split('T')[0];
}

function renderStorage() {
    const container = document.getElementById('storage-lists');
    const searchInput = document.getElementById('storageSearchDate');
    const searchDate = searchInput ? searchInput.value : "";

    if (!container) return;
    container.innerHTML = '';

    let filteredTasks = tasks;
    
    // If searching by date.
    if (searchDate) {
        filteredTasks = tasks.filter(t => t.date === searchDate);
        if (filteredTasks.length === 0) {
            container.innerHTML = `<div class="glass-container empty-msg">لا توجد مهام في تاريخ: ${searchDate}</div>`;
            return;
        }
    }

    const weeks = {};
    
    // Group tasks by week
    filteredTasks.forEach(t => {
        if (!t.date) return;
        const weekStart = getWeekStartDate(t.date);
        if (!weeks[weekStart]) weeks[weekStart] = [];
        weeks[weekStart].push(t);
    });

    // ... (rest of the logic)
    const sortedWeeks = Object.keys(weeks).sort().reverse();

    if (sortedWeeks.length === 0 && !searchDate) {
        container.innerHTML = '<div class="glass-container empty-msg">لا توجد مهام مخزنة حتى الآن. ابدأ بإضافة المهام!</div>';
        return;
    }
    sortedWeeks.forEach(weekDate => {
        const weekTasks = weeks[weekDate];
        const weekEnd = new Date(new Date(weekDate).setDate(new Date(weekDate).getDate() + 6)).toISOString().split('T')[0];
        
        const weekCard = document.createElement('div');
        weekCard.className = 'glass-container storage-week-card';
        
        const taskItemsHTML = weekTasks.map(t => `
            <div class="storage-task-item ${t.completed ? 'completed' : ''}">
                <span class="st-dot"></span>
                <span class="st-txt" style="${t.archived ? 'opacity: 0.7' : ''}">${t.text}${t.archived ? ' (محذوف)' : ''}</span>
                <span class="st-date">${t.date.split('-').slice(1).join('/')}</span>
                <button class="st-del-btn" onclick="permanentDelete(${t.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');

        weekCard.innerHTML = `
            <div class="week-header">
                <div>
                    <span class="week-title">${searchDate ? 'نتائج البحث' : 'الأسبوع: ' + weekDate}</span>
                    <div class="week-range">${searchDate ? 'تاريخ الإسناد: ' + searchDate : 'من ' + weekDate + ' إلى ' + weekEnd}</div>
                </div>
                <div class="week-stats">${weekTasks.filter(t => t.completed).length} / ${weekTasks.length}</div>
            </div>
            <div class="week-tasks-list">
                ${taskItemsHTML}
            </div>
        `;
        container.appendChild(weekCard);
    });
}

window.clearStorageSearch = () => {
    document.getElementById('storageSearchDate').value = "";
    renderStorage();
};

// --- Init ---
// In local mode, handleAuthState is already called above synchronously.
// If Firebase is used, it will wait for the callback.
if (isFirebaseConfigValid()) {
    loadLocalData();
    applySettingsToUI();
    updateTimerDisplay();
}

taskInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addTask(); });

const overlayInput = document.getElementById('usernameInputOverlay');
if (overlayInput) {
    overlayInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') loginWithUsernameOverlay(); });
}

// Set default date for task input to today
document.getElementById('taskDate').valueAsDate = new Date();

renderAll();// --- Notification System ---
function requestNotificationPermission() {
    if ("Notification" in window) {
        Notification.requestPermission();
    }
}

function checkTaskReminders() {
    const now = new Date();
    tasks.forEach(t => {
        if (!t.date || !t.time || t.completed || t.notified) return;
        
        // مقارنة التاريخ والوقت بشكل صحيح لضمان عدم ضياع التنبيه
        const taskDateTime = new Date(`${t.date}T${t.time}`);
        if (now >= taskDateTime) {
            t.notified = true;
            showTaskNotification(t.text);
            saveData();
        }
    });
}

function showTaskNotification(text) {
    // تشغيل نغمة تنبيه دافئة ومميزة - نستخدم رابط بديل أكثر استقراراً
    try {
        const notificationSound = new Audio("https://cdn.pixabay.com/audio/2022/03/10/audio_c3523e4142.mp3");
        notificationSound.play().catch(e => {
            console.warn("تنبيه: يجب النقر على الصفحة أولاً لتفعيل الصوت في المتصفح.", e);
        });
    } catch(err) { console.error(err); }

    // 1. Browser Notification
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("تنبيه مهمة! 🎓", {
            body: `حان الآن موعد: ${text}`,
            icon: "https://cdn-icons-png.flaticon.com/512/3062/3062634.png"
        });
    }
    
    // 2. In-app Banner
    const banner = document.getElementById('achievement-banner');
    document.getElementById('achievement-name').innerText = `موعد المهمة: ${text} ✨`;
    banner.style.background = "var(--accent-color)";
    banner.classList.remove('hidden');
    setTimeout(() => {
        banner.classList.add('hidden');
        banner.style.background = ""; // Reset
    }, 6000);
}

// التحقق كل 5 ثوانٍ لضمان الدقة
setInterval(checkTaskReminders, 5000);

renderAll();

// --- Button Micro-Interactions ---
// تأثير ضغطة قوي على كل الأزرار
document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button');
    if (btn && !btn.classList.contains('nav-btn')) {
        btn.style.transform = 'scale(0.95)';
    }
});
document.addEventListener('mouseup', (e) => {
    const btn = e.target.closest('button');
    if (btn && !btn.classList.contains('nav-btn')) {
        btn.style.transform = '';
    }
});
document.addEventListener('mouseleave', (e) => {
    const btn = e.target.closest('button');
    if (btn) btn.style.transform = '';
}, true);
