/**
 * 课程提醒系统 — 前端核心逻辑
 *
 * 关键设计：
 * 1. 双重定时器：setTimeout 精确到秒 + 30s 心跳对抗浏览器节流
 * 2. Web Speech API 语音播报（浏览器原生，无依赖）
 * 3. Notification API 消息弹窗
 * 4. 设置保存在 localStorage
 */

// ==================== 全局状态 ====================
const STATE = {
    todayCourses: [],        // 今天课程列表
    allCourses: [],          // 全部课程
    reminderTimers: [],     // setTimeout id 列表
    heartbeatTimer: null,   // 心跳计时器 id
    sentReminders: new Set(), // 已发送提醒的课程 id（防重复）
};


// ==================== 工具函数 ====================

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function api(path, opts = {}) {
    const url = path.startsWith('http') ? path : path;
    return fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
    }).then(function(r) {
        if (!r.ok) {
            throw new Error('HTTP ' + r.status + ' ' + path);
        }
        return r.json();
    });
}

function showToast(msg, type = 'info') {
    const container = $('#toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
}

function timeToMinutes(timeStr) {
    // HH:MM -> 分钟数
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function formatCountdown(targetMinutes) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const diff = targetMinutes - nowMin;
    if (diff <= 0) return '已上课';
    if (diff < 60) return `${diff} 分钟后`;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h} 小时 ${m} 分钟后`;
}

function getNowMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}


// ==================== 设置管理 ====================

function getSettings() {
    return {
        notifyEnabled: localStorage.getItem('notifyEnabled') !== 'false',  // 默认开启
        voiceEnabled: localStorage.getItem('voiceEnabled') !== 'false',    // 默认开启
        remindMinutes: parseInt(localStorage.getItem('remindMinutes')) || 15,
    };
}

function saveSetting(key, value) {
    localStorage.setItem(key, value);
}


// ==================== 语音播报 ====================

function speak(text) {
    const settings = getSettings();
    if (!settings.voiceEnabled) return;

    // 某些浏览器不支持 speechSynthesis
    if (typeof window.speechSynthesis === 'undefined') {
        console.warn('speechSynthesis 不可用');
        return;
    }

    // 取消当前正在播放的语音
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = 0.9;   // 稍慢，更清晰
    utter.pitch = 1.0;
    utter.volume = 1.0;

    // 尝试选择中文语音
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.startsWith('zh')) || voices[0];
    if (zhVoice) utter.voice = zhVoice;

    window.speechSynthesis.speak(utter);
}

/** 预加载语音列表（有些浏览器需要延迟获取） */
function preloadVoices() {
    // speechSynthesis 在某些浏览器中可能是 undefined
    if (typeof window.speechSynthesis === 'undefined') return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.getVoices();
        };
    }
}


// ==================== 消息弹窗 ====================

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('浏览器不支持 Notification API');
        return;
    }
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function showNotification(title, body) {
    const settings = getSettings();
    if (!settings.notifyEnabled) return;
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
        const n = new Notification(title, {
            body: body,
            icon: '/static/icon-192.png',
            badge: '/static/icon-192.png',
            tag: 'course-reminder',  // 同 tag 通知会替换上一个
            requireInteraction: true, // 不自动消失
            vibrate: [200, 100, 200, 100, 200], // 手机震动
        });
        n.onclick = () => {
            n.close();
            window.focus();
        };
        // 5 秒后自动关闭
        setTimeout(() => n.close(), 5000);
    }

    // 额外：尝试用 AudioContext 播放提示音（应对静音模式）
    playBeep();
}

/** 简单蜂鸣音，确保在静音模式下也能出声 */
function playBeep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 800;
        osc.type = 'sine';
        gain.gain.value = 0.3;
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
        setTimeout(() => {
            const osc2 = ctx.createOscillator();
            osc2.connect(gain);
            osc2.frequency.value = 1000;
            osc2.type = 'sine';
            osc2.start();
            osc2.stop(ctx.currentTime + 0.2);
        }, 200);
    } catch (e) {
        // 静默失败
    }
}


// ==================== 提醒引擎 ====================

/** 触发单个课程的提醒 */
function triggerReminder(course) {
    const courseId = course.id;
    // 防重复
    if (STATE.sentReminders.has(courseId)) return;

    const room = course.classroom;
    const name = course.name;
    const teacher = course.teacher || '';

    const voiceText = teacher
        ? `课前提醒：即将在${room}上${teacher}老师的${name}课，请做好准备`
        : `课前提醒：即将在${room}上${name}课，请做好准备`;

    const notifyTitle = '📚 课前提醒';
    const notifyBody = `🏫 ${room}\n📖 ${name}${teacher ? '\n👨‍🏫 ' + teacher : ''}`;

    console.log(`🔔 触发提醒: ${name} @ ${room}`);
    STATE.sentReminders.add(courseId);

    // 语音播报
    speak(voiceText);

    // 消息弹窗
    showNotification(notifyTitle, notifyBody);

    // 页面内 Toast
    showToast(`🔔 ${name} — ${room}`, 'info');
}

/** 设置所有提醒定时器 */
function setupReminders() {
    // 清除旧定时器
    clearAllReminders();

    const settings = getSettings();
    const remindBefore = settings.remindMinutes;
    const nowMin = getNowMinutes();

    STATE.todayCourses.forEach(course => {
        const courseStartMin = timeToMinutes(course.start_time);
        const remindAtMin = courseStartMin - remindBefore;

        // 课程已开始的不设提醒
        if (nowMin >= courseStartMin) return;

        // 提醒时间已过的不设提醒
        if (nowMin > remindAtMin) return;

        const delayMs = (remindAtMin - nowMin) * 60 * 1000;

        console.log(
            `⏰ 设置提醒: ${course.name} @ ${remindAtMin}分钟（延迟 ${Math.round(delayMs / 60000)} 分钟）`
        );

        const timerId = setTimeout(() => {
            triggerReminder(course);
        }, delayMs);

        STATE.reminderTimers.push(timerId);
    });

    // 启动心跳检测
    startHeartbeat();
}

/** 清除所有提醒定时器 */
function clearAllReminders() {
    STATE.reminderTimers.forEach(t => clearTimeout(t));
    STATE.reminderTimers = [];
    if (STATE.heartbeatTimer) {
        clearInterval(STATE.heartbeatTimer);
        STATE.heartbeatTimer = null;
    }
}

/** 30秒心跳：对抗浏览器后台定时器节流 */
function startHeartbeat() {
    if (STATE.heartbeatTimer) return;

    STATE.heartbeatTimer = setInterval(() => {
        const nowMin = getNowMinutes();
        const settings = getSettings();
        const remindBefore = settings.remindMinutes;

        STATE.todayCourses.forEach(course => {
            const courseStartMin = timeToMinutes(course.start_time);
            const remindAtMin = courseStartMin - remindBefore;

            // 检查是否处于提醒窗口内（当前时间在提醒时间到上课时间之间）
            if (nowMin >= remindAtMin && nowMin < courseStartMin) {
                if (!STATE.sentReminders.has(course.id)) {
                    console.log(`⏱️ 心跳补发提醒: ${course.name}`);
                    triggerReminder(course);
                }
            }
        });

        updateStatusBar();
    }, 30000); // 每 30 秒检查一次
}


// ==================== UI 渲染 ====================

/** 更新顶部时间 */
function updateHeader() {
    const now = new Date();
    $('#currentTime').textContent =
        now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    $('#currentDay').textContent = dayNames[now.getDay() || 7]; // getDay: 0=周日
}

/** 更新状态栏 */
function updateStatusBar() {
    const settings = getSettings();
    const dot = $('#statusDot');
    const text = $('#statusText');

    const pendingReminders = STATE.todayCourses.filter(c => {
        const remindAt = timeToMinutes(c.start_time) - settings.remindMinutes;
        return getNowMinutes() < remindAt && !STATE.sentReminders.has(c.id);
    }).length;

    dot.className = 'status-dot active';
    text.textContent = `${STATE.todayCourses.length} 节课 | ${pendingReminders} 个待提醒 | ${settings.notifyEnabled ? '💬弹窗' : ''} ${settings.voiceEnabled ? '🔊语音' : ''}`;
}

/** 渲染今日课程面板 */
function renderTodayCourses() {
    const container = $('#todayCourseList');
    const courses = STATE.todayCourses;
    const nowMin = getNowMinutes();
    const settings = getSettings();

    if (courses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🎉</div>
                <p>今天没有课程，好好休息吧</p>
            </div>`;
        return;
    }

    container.innerHTML = courses.map(c => {
        const startMin = timeToMinutes(c.start_time);
        const endMin = timeToMinutes(c.end_time);
        const remindAt = startMin - settings.remindMinutes;

        let statusClass = '';
        let countdownHtml = '';

        if (nowMin >= endMin) {
            statusClass = 'passed';
        } else if (nowMin >= startMin && nowMin < endMin) {
            statusClass = 'ongoing';
            countdownHtml = '<span class="course-countdown">进行中</span>';
        } else if (nowMin >= remindAt && nowMin < startMin) {
            statusClass = 'next-up';
            countdownHtml = `<span class="course-countdown">${formatCountdown(startMin)}</span>`;
        } else {
            countdownHtml = `<span class="course-countdown">${formatCountdown(startMin)}</span>`;
        }

        const teacherHtml = c.teacher ? `<span class="teacher">${c.teacher}</span>` : '';
        const weekTag = c.weeks_pattern !== 'every'
            ? `<span class="reminder-badge">${c.weeks_pattern === 'odd' ? '单周' : '双周'}</span>`
            : '';

        // 判断是否已发送提醒
        const reminded = STATE.sentReminders.has(c.id);

        return `
            <div class="course-card ${statusClass}">
                ${countdownHtml}
                <div class="course-time-block">
                    <span class="course-time start">${c.start_time}</span>
                    <span class="course-time">↓</span>
                    <span class="course-time">${c.end_time}</span>
                </div>
                <div class="course-info">
                    <div class="course-name">${c.name}</div>
                    <div class="course-detail">
                        <span class="room">${c.classroom}</span>
                        ${teacherHtml}
                    </div>
                    ${weekTag}
                    ${reminded && statusClass === '' ? '<span class="reminder-badge" style="background:rgba(46,204,113,0.2);color:#2ecc71;">✅ 已提醒</span>' : ''}
                </div>
            </div>`;
    }).join('');
}

/** 渲染全部课程管理列表 */
function renderAllCourses() {
    const container = $('#allCourseList');
    const courses = STATE.allCourses;

    if (courses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <p>还没有添加课程</p>
            </div>`;
        return;
    }

    const dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

    container.innerHTML = courses.map(c => {
        const weekTag = c.weeks_pattern !== 'every'
            ? ` · ${c.weeks_pattern === 'odd' ? '单周' : '双周'}`
            : '';
        const teacher = c.teacher ? ` · ${c.teacher}` : '';

        return `
            <div class="course-item-compact">
                <div class="info">
                    <div class="name">${c.name}</div>
                    <div class="meta">
                        ${dayNames[c.day_of_week]} ${c.start_time}-${c.end_time}
                        · ${c.classroom}${teacher}${weekTag}
                    </div>
                </div>
                <div class="actions">
                    <button class="btn-icon edit" onclick="editCourse(${c.id})" title="编辑">✏️</button>
                    <button class="btn-icon delete" onclick="deleteCourse(${c.id})" title="删除">🗑️</button>
                </div>
            </div>`;
    }).join('');
}


// ==================== 课程 CRUD 操作 ====================

async function loadTodayCourses() {
    try {
        const data = await api('/api/today');
        if (data.ok) {
            STATE.todayCourses = data.data;
            STATE.sentReminders.clear();
            renderTodayCourses();
            setupReminders();
            updateStatusBar();
        }
    } catch (e) {
        console.error('加载今日课程失败:', e);
    }
}

async function loadAllCourses() {
    try {
        const data = await api('/api/courses');
        if (data.ok) {
            STATE.allCourses = data.data;
            renderAllCourses();
        }
    } catch (e) {
        console.error('加载全部课程失败:', e);
    }
}

async function submitCourse(e) {
    e.preventDefault();

    const editId = $('#editId').value;
    const courseData = {
        name: $('#courseName').value.trim(),
        teacher: $('#teacher').value.trim(),
        classroom: $('#classroom').value.trim(),
        day_of_week: parseInt($('#dayOfWeek').value),
        start_time: $('#startTime').value,
        end_time: $('#endTime').value,
        weeks_pattern: $('#weeksPattern').value,
    };

    // 基础校验
    if (!courseData.name || !courseData.classroom || !courseData.day_of_week) {
        showToast('请填写必填字段', 'error');
        return;
    }
    if (!courseData.start_time || !courseData.end_time) {
        showToast('请选择上课/下课时间', 'error');
        return;
    }
    if (timeToMinutes(courseData.start_time) >= timeToMinutes(courseData.end_time)) {
        showToast('上课时间必须早于下课时间', 'error');
        return;
    }

    if (editId) {
        // 更新
        const data = await api(`/api/courses/${editId}`, {
            method: 'PUT',
            body: JSON.stringify(courseData),
        });
        if (data.ok) {
            showToast('课程已更新 ✅', 'success');
            resetForm();
            await loadAllCourses();
            await loadTodayCourses();
        } else {
            showToast(data.error || '更新失败', 'error');
        }
    } else {
        // 新增
        const data = await api('/api/courses', {
            method: 'POST',
            body: JSON.stringify(courseData),
        });
        if (data.ok) {
            showToast('课程已添加 ✅', 'success');
            resetForm();
            await loadAllCourses();
            await loadTodayCourses();
        } else {
            showToast(data.error || '添加失败', 'error');
        }
    }
}

function editCourse(id) {
    const course = STATE.allCourses.find(c => c.id === id);
    if (!course) return;

    $('#editId').value = course.id;
    $('#courseName').value = course.name;
    $('#teacher').value = course.teacher || '';
    $('#classroom').value = course.classroom;
    $('#dayOfWeek').value = course.day_of_week;
    $('#startTime').value = course.start_time;
    $('#endTime').value = course.end_time;
    $('#weeksPattern').value = course.weeks_pattern || 'every';

    $('#formTitle').textContent = '✏️ 编辑课程';
    $('#submitBtn').textContent = '💾 更新课程';
    $('#cancelEditBtn').style.display = 'block';

    // 滚动到表单
    $('#courseFormCard').scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
    $('#editId').value = '';
    $('#courseForm').reset();
    $('#formTitle').textContent = '➕ 添加课程';
    $('#submitBtn').textContent = '💾 保存课程';
    $('#cancelEditBtn').style.display = 'none';
}

async function deleteCourse(id) {
    const course = STATE.allCourses.find(c => c.id === id);
    if (!course) return;

    if (!confirm(`确定要删除「${course.name}」吗？\n此操作不可恢复。`)) return;

    const data = await api(`/api/courses/${id}`, { method: 'DELETE' });
    if (data.ok) {
        showToast(`已删除「${course.name}」`, 'info');
        await loadAllCourses();
        await loadTodayCourses();
    } else {
        showToast(data.error || '删除失败', 'error');
    }
}


// ==================== 设置面板 ====================

function initSettingsPanel() {
    const settings = getSettings();
    $('#notifyEnabled').checked = settings.notifyEnabled;
    $('#voiceEnabled').checked = settings.voiceEnabled;
    $('#remindMinutes').value = settings.remindMinutes;

    // 绑定修改事件
    $('#notifyEnabled').addEventListener('change', function () {
        saveSetting('notifyEnabled', this.checked);
        if (this.checked) {
            requestNotificationPermission();
        }
        updateStatusBar();
        showToast(this.checked ? '消息弹窗已开启' : '消息弹窗已关闭', 'info');
    });

    $('#voiceEnabled').addEventListener('change', function () {
        saveSetting('voiceEnabled', this.checked);
        updateStatusBar();
        if (this.checked) {
            // 预加载语音
            preloadVoices();
            speak('语音播报已开启');
        }
        showToast(this.checked ? '语音播报已开启' : '语音播报已关闭', 'info');
    });

    $('#remindMinutes').addEventListener('change', function () {
        saveSetting('remindMinutes', this.value);
        // 重新设置所有提醒
        setupReminders();
        updateStatusBar();
        showToast(`提醒时间已更改为课前 ${this.value} 分钟`, 'info');
    });

    // 测试语音按钮
    $('#testVoiceBtn').addEventListener('click', () => {
        const settings = getSettings();
        if (!settings.voiceEnabled) {
            showToast('请先开启语音播报', 'error');
            return;
        }
        preloadVoices();
        speak('这是一条测试语音。课程提醒系统运行正常。');
        showToast('正在播放测试语音...', 'info');
    });
}


// ==================== 页面初始化 ====================

async function init() {
    try {
    // 1. 请求通知权限
    requestNotificationPermission();

    // 2. 预加载语音引擎
    preloadVoices();

    // 3. 定时更新时间显示
    updateHeader();
    setInterval(updateHeader, 1000);

    // 4. 加载数据
    try {
        await loadTodayCourses();
    } catch (e) {
        console.error('loadTodayCourses error:', e);
    }
    try {
        await loadAllCourses();
    } catch (e) {
        console.error('loadAllCourses error:', e);
    }

    // 5. 初始化设置面板
    initSettingsPanel();

    // 6. 标签页切换
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            // 切换按钮 active
            $$('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // 切换面板
            $$('.tab-panel').forEach(p => p.classList.remove('active'));
            $(`#panel-${tabName}`).classList.add('active');
        });
    });

    // 7. 表单提交
    $('#courseForm').addEventListener('submit', submitCourse);
    $('#cancelEditBtn').addEventListener('click', resetForm);

    // 8. 更新状态栏
    updateStatusBar();

    // 9. 注册 Service Worker (PWA)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('✅ Service Worker 已注册'))
            .catch(err => console.log('⚠️ SW 注册失败:', err));
    }

    console.log('✅ 课程提醒系统初始化完成');
    console.log('   今日 ' + STATE.todayCourses.length + ' 节课');
    console.log('   共设置 ' + STATE.reminderTimers.length + ' 个提醒定时器');
    } catch (e) {
        console.error('初始化失败:', e);
        document.getElementById('statusText').textContent = '加载失败: ' + e.message;
        document.getElementById('statusDot').className = 'status-dot error';
    }
}

// 启动
document.addEventListener('DOMContentLoaded', init);

// 页面关闭或刷新前清理
window.addEventListener('beforeunload', () => {
    clearAllReminders();
});
