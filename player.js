// ============================================================
//  player.js · 独立播放器核心
//  设计原则：
//  1. 不自动执行任何初始化，由调用方通过 initPlayer() 控制
//  2. 支持两种数据源：传入 options 或自行 fetch config.json
//  3. 直接读取完整路径，不做路径拼接
//  4. 所有样式使用独立类名 .player-*
//  5. 支持 musicEnabled / musicAutoPlay / musicDefault
//  6. 支持播放记忆（localStorage）
//  7. 不依赖任何全局变量
//  8. 手机端触摸拖动进度条支持（视觉实时跟随，松手跳转）
//  9. 拖拽期间暂停 timeupdate 更新，防止冲突
//  10. 使用 canplay 事件恢复进度，无 setTimeout，无闪烁
// ============================================================

(function() {
    'use strict';

    // ============================================================
    //  1. 默认配置
    // ============================================================
    var DEFAULT_SONGS = [
        { name: '🎵 乌龙山剿匪记 · 强哥音乐测试', url: 'myyy/wlsjfj.mp3' },
        { name: '🎵 山隐居 · 古典', url: 'myyy/bj.mp3' }
    ];

    var STORAGE_KEY = 'player_state';

    // ============================================================
    //  2. 状态对象
    // ============================================================
    var state = {
        songs: [],
        currentIndex: 0,
        isPlaying: false,
        currentMode: 'order',
        currentEffect: 'red-bar-up',
        progress: 0,
        duration: 180,
        panelOpen: false,
        effectPanelOpen: false,
        isDragging: false,
        moved: false,
        musicEnabled: true,
        musicAutoPlay: false,
        musicDefault: '',
        // 拖拽进度标志
        isDraggingProgress: false
    };

    var audio = null;
    var elements = {};
    var timers = { spec: null, feedback: null };
    var effects = [
        { id: 'red-bar-up', label: '红色竖条' },
        { id: 'white-bar-up', label: '白色竖条' },
        { id: 'color-bar-up', label: '彩色竖条' },
        { id: 'red-bar-float', label: '红浮竖条' },
        { id: 'white-bar-float', label: '白浮竖条' },
        { id: 'color-bar-float', label: '彩浮竖条' },
        { id: 'combo-bar-float', label: '组合竖条' },
        { id: 'dots', label: '圆点' },
        { id: 'wave', label: '波浪' },
        { id: 'rings', label: '光环' },
        { id: 'radar', label: '雷达' },
        { id: 'meter', label: '仪表' },
        { id: 'combo', label: '组合' },
        { id: 'glow', label: '光晕' }
    ];
    var effectLabels = {};
    effects.forEach(function(e) { effectLabels[e.id] = e.label; });

    var specElements = [];
    var isInitialized = false;
    // 标记进度是否已在 canplay 中恢复过
    var progressRestored = false;

    // ============================================================
    //  3. 工具函数
    // ============================================================
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) seconds = 0;
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function getElement(selector) {
        return document.querySelector(selector);
    }

    function getAllElements(selector) {
        return document.querySelectorAll(selector);
    }

    // ============================================================
    //  4. localStorage 读写
    // ============================================================
    function saveState() {
        try {
            var data = {
                currentIndex: state.currentIndex,
                progress: state.progress,
                panelOpen: state.panelOpen,
                currentMode: state.currentMode,
                currentEffect: state.currentEffect
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) { /* 忽略存储错误 */ }
    }

    function loadState() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            return {
                currentIndex: typeof data.currentIndex === 'number' ? data.currentIndex : null,
                progress: typeof data.progress === 'number' ? data.progress : null,
                panelOpen: typeof data.panelOpen === 'boolean' ? data.panelOpen : null,
                currentMode: ['single', 'order', 'random'].indexOf(data.currentMode) !== -1 ? data.currentMode : null,
                currentEffect: data.currentEffect || null
            };
        } catch (e) { return null; }
    }

    // ============================================================
    //  5. 频谱渲染
    // ============================================================
    function renderSpectrum(style) {
        var area = elements.spectrumArea;
        if (!area) return;
        area.innerHTML = '';
        specElements = [];
        area.style.display = 'flex';
        area.style.alignItems = 'flex-end';
        area.style.justifyContent = 'center';
        area.style.gap = '3px';
        area.style.padding = '2px 4px';

        var count = 16;
        var isBar = style.indexOf('bar') !== -1 || style === 'combo-bar-float';
        var isFloat = (style === 'red-bar-float' || style === 'color-bar-float' ||
            style === 'white-bar-float' || style === 'combo-bar-float');
        var isCombo = style === 'combo-bar-float';

        if (isBar) {
            if (isFloat) area.style.alignItems = 'center';
            else area.style.alignItems = 'flex-end';
            var colorBase;
            if (style.startsWith('red')) colorBase = '#c23531';
            else if (style.startsWith('color')) colorBase = 'rainbow';
            else if (style.startsWith('white')) colorBase = '#e8d5c0';
            else colorBase = '#c23531';

            for (var i = 0; i < count; i++) {
                var bar = document.createElement('div');
                bar.className = 'player-spec-bar';
                bar.style.width = '4px';
                bar.style.height = '4px';
                bar.style.borderRadius = '2px';
                bar.style.transition = 'height 0.06s ease-out';
                bar.style.flexShrink = '0';
                if (colorBase === 'rainbow') {
                    var hue = (i / count) * 360;
                    bar.style.background = 'hsl(' + hue + ', 80%, 55%)';
                } else if (isCombo && i % 2 === 0) bar.style.background = '#c23531';
                else if (isCombo && i % 2 === 1) bar.style.background = '#e8a040';
                else bar.style.background = colorBase;
                area.appendChild(bar);
                specElements.push(bar);
            }
        } else if (style === 'dots') {
            area.style.alignItems = 'center';
            area.style.gap = '6px';
            area.style.flexWrap = 'wrap';
            for (var i = 0; i < 12; i++) {
                var dot = document.createElement('div');
                dot.className = 'player-spec-dot';
                dot.style.width = '6px';
                dot.style.height = '6px';
                dot.style.background = '#c23531';
                dot.style.transition = 'transform 0.08s ease-out';
                dot.style.transform = 'scale(0.3)';
                dot.style.flexShrink = '0';
                area.appendChild(dot);
                specElements.push(dot);
            }
        } else if (style === 'rings') {
            area.style.alignItems = 'center';
            area.style.justifyContent = 'center';
            area.style.position = 'relative';
            for (var i = 0; i < 5; i++) {
                var ring = document.createElement('div');
                ring.className = 'player-spec-ring';
                ring.style.width = (20 + i * 8) + 'px';
                ring.style.height = (20 + i * 8) + 'px';
                ring.style.border = '2px solid rgba(194,53,49,' + (0.5 - i * 0.08) + ')';
                ring.style.position = 'absolute';
                ring.style.top = '50%';
                ring.style.left = '50%';
                ring.style.transform = 'translate(-50%,-50%) scale(0.5)';
                ring.style.transition = 'all 0.1s ease-out';
                area.appendChild(ring);
                specElements.push(ring);
            }
        } else if (style === 'wave') {
            area.style.alignItems = 'center';
            area.style.padding = '2px 4px';
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.style.display = 'block';
            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M0,16 L240,16');
            path.setAttribute('stroke', '#c23531');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            svg.appendChild(path);
            area.appendChild(svg);
            specElements.push(path);
        } else if (style === 'meter') {
            area.style.alignItems = 'flex-end';
            area.style.flexDirection = 'column';
            area.style.gap = '1px';
            area.style.justifyContent = 'center';
            for (var i = 0; i < 8; i++) {
                var bar = document.createElement('div');
                bar.className = 'player-spec-bar';
                bar.style.width = (10 + i * 10) + '%';
                bar.style.height = '4px';
                bar.style.background = '#c23531';
                bar.style.borderRadius = '2px';
                bar.style.transition = 'height 0.06s ease-out';
                bar.style.marginBottom = '1px';
                area.appendChild(bar);
                specElements.push(bar);
            }
        } else if (style === 'combo') {
            area.style.alignItems = 'center';
            area.style.position = 'relative';
            area.style.gap = '3px';
            for (var i = 0; i < 12; i++) {
                var bar = document.createElement('div');
                bar.className = 'player-spec-bar';
                bar.style.width = '3px';
                bar.style.height = '4px';
                bar.style.background = i % 2 === 0 ? '#c23531' : '#e8a040';
                bar.style.borderRadius = '2px';
                bar.style.transition = 'height 0.06s ease-out';
                bar.style.flexShrink = '0';
                area.appendChild(bar);
                specElements.push(bar);
            }
            var glow = document.createElement('div');
            glow.style.width = '16px';
            glow.style.height = '16px';
            glow.style.borderRadius = '50%';
            glow.style.background = 'rgba(194,53,49,0.2)';
            glow.style.position = 'absolute';
            glow.style.top = '50%';
            glow.style.left = '50%';
            glow.style.transform = 'translate(-50%,-50%) scale(0.5)';
            glow.style.transition = 'all 0.15s ease-out';
            area.appendChild(glow);
            specElements.push(glow);
        } else if (style === 'glow') {
            area.style.alignItems = 'center';
            area.style.position = 'relative';
            var glowBg = document.createElement('div');
            glowBg.style.width = '100%';
            glowBg.style.height = '100%';
            glowBg.style.background = 'radial-gradient(circle, rgba(194,53,49,0.15) 0%, transparent 70%)';
            glowBg.style.borderRadius = '6px';
            glowBg.style.transition = 'opacity 0.2s ease-out';
            glowBg.style.opacity = '0.3';
            area.appendChild(glowBg);
            specElements.push(glowBg);
        }
    }

    function updateSpectrum() {
        if (!state.isPlaying) {
            for (var i = 0; i < specElements.length; i++) {
                var el = specElements[i];
                if (!el || !el.style) continue;
                if (el.className && el.className.indexOf('player-spec-bar') !== -1) {
                    el.style.height = '4px';
                } else if (el.className && el.className.indexOf('player-spec-dot') !== -1) {
                    el.style.transform = 'scale(0.3)';
                } else if (el.className && el.className.indexOf('player-spec-ring') !== -1) {
                    el.style.transform = 'translate(-50%,-50%) scale(0.5)';
                } else if (el.tagName === 'path') {
                    el.setAttribute('d', 'M0,16 L240,16');
                } else if (el.style && el.style.opacity !== undefined) {
                    el.style.opacity = '0.3';
                }
            }
            return;
        }
        for (var i = 0; i < specElements.length; i++) {
            var el = specElements[i];
            if (!el || !el.style) continue;
            if (el.className && el.className.indexOf('player-spec-bar') !== -1) {
                var height = 4 + Math.random() * 28;
                el.style.height = height + 'px';
            } else if (el.className && el.className.indexOf('player-spec-dot') !== -1) {
                el.style.transform = 'scale(' + (0.3 + Math.random() * 0.7) + ')';
            } else if (el.className && el.className.indexOf('player-spec-ring') !== -1) {
                el.style.transform = 'translate(-50%,-50%) scale(' + (0.4 + Math.random() * 0.6) + ')';
            } else if (el.tagName === 'path') {
                var points = [];
                for (var j = 0; j <= 24; j++) {
                    var x = j * 10;
                    var y = 16 + Math.sin(j * 0.6 + Date.now() / 400) * (6 + Math.random() * 4);
                    points.push(x + ',' + y);
                }
                el.setAttribute('d', 'M0,16 L' + points.join(' L') + ' L240,16');
            } else if (el.style && el.style.opacity !== undefined) {
                el.style.opacity = (0.3 + Math.random() * 0.5);
            }
        }
    }

    function startSpectrum() {
        stopSpectrum();
        timers.spec = setInterval(updateSpectrum, 60);
    }

    function stopSpectrum() {
        if (timers.spec) { clearInterval(timers.spec);
            timers.spec = null; }
        updateSpectrum();
    }

    function setEffect(effectId) {
        state.currentEffect = effectId;
        renderSpectrum(effectId);
        if (state.isPlaying) startSpectrum();
        else updateSpectrum();
        var btns = getAllElements('.player-effect-btn');
        btns.forEach(function(btn) {
            btn.classList.toggle('player-active', btn.dataset.effect === effectId);
        });
        saveState();
    }

    // ============================================================
    //  6. 更新进度条（受拖拽标志控制）
    // ============================================================
    function updateProgressBar() {
        // ★ 关键修复：拖拽期间不更新进度条，防止 timeupdate 覆盖用户操作
        if (state.isDraggingProgress) return;

        if (!elements.progressBar) return;
        var actualDuration = (audio && audio.duration && isFinite(audio.duration)) ? audio.duration : state.duration;
        var percent = (state.progress / actualDuration) * 100;
        if (percent > 100) percent = 100;
        if (percent < 0) percent = 0;
        elements.progressBar.style.width = percent + '%';
        if (elements.currentTime) elements.currentTime.textContent = formatTime(state.progress);
        if (elements.totalTime) elements.totalTime.textContent = formatTime(actualDuration);
        if (elements.progressDot) {
            elements.progressDot.classList.toggle('player-show', percent > 0 && percent < 100);
        }
    }

    // ============================================================
    //  7. 歌曲管理
    // ============================================================
    function loadSong(index, autoPlay) {
        if (!state.songs || state.songs.length === 0) {
            state.songs = DEFAULT_SONGS.slice();
        }
        var idx = ((index % state.songs.length) + state.songs.length) % state.songs.length;
        state.currentIndex = idx;
        var song = state.songs[idx];
        if (elements.songName) elements.songName.textContent = song.name;

        if (audio) {
            audio.src = song.url;
            audio.load();

            var saved = loadState();
            var savedProgress = 0;
            var restoreProgress = false;

            if (saved && saved.currentIndex === idx && saved.progress > 0) {
                savedProgress = saved.progress;
                restoreProgress = true;
                state.progress = savedProgress;
            } else {
                state.progress = 0;
            }

            // ★ 重置进度恢复标记
            progressRestored = false;

            updateProgressBar();

            // ★ 用 canplay 事件恢复进度（只触发一次，无闪烁）
            if (restoreProgress) {
                var onCanPlay = function() {
                    if (!progressRestored && audio) {
                        audio.currentTime = savedProgress;
                        state.progress = savedProgress;
                        updateProgressBar();
                        progressRestored = true;
                    }
                    audio.removeEventListener('canplay', onCanPlay);
                };
                audio.addEventListener('canplay', onCanPlay, { once: true });
            }

            state.duration = audio.duration || 180;
            if (elements.totalTime) elements.totalTime.textContent = formatTime(state.duration);

            setTimeout(function() {
                checkScroll();
            }, 50);

            if (autoPlay) {
                audio.play().then(function() {
                    state.isPlaying = true;
                    if (elements.toggleWrapper) elements.toggleWrapper.classList.add('player-playing');
                    if (elements.playBtn) {
                        elements.playBtn.className = 'player-play-btn player-paused';
                        elements.playBtn.textContent = '';
                    }
                    startSpectrum();
                    saveState();
                }).catch(function() {});
            } else {
                // 非自动播放：如果音频已就绪，立即恢复进度
                if (restoreProgress && audio.readyState >= 2) {
                    audio.currentTime = savedProgress;
                    state.progress = savedProgress;
                    updateProgressBar();
                    progressRestored = true;
                }

                if (elements.playBtn) {
                    elements.playBtn.className = 'player-play-btn player-playing';
                    elements.playBtn.textContent = '▶';
                }
                if (elements.toggleWrapper) {
                    elements.toggleWrapper.classList.remove('player-playing');
                }
                stopSpectrum();
            }
        }
        saveState();
    }

    function playSong(index) {
        if (index < 0 || index >= state.songs.length) return;
        loadSong(index, true);
    }

    // ★★★ 点击播放：使用 canplay 事件恢复进度（无闪烁，无 setTimeout） ★★★
    function togglePlay() {
        if (state.isPlaying) {
            if (audio) audio.pause();
            state.isPlaying = false;
            if (elements.toggleWrapper) elements.toggleWrapper.classList.remove('player-playing');
            if (elements.playBtn) {
                elements.playBtn.className = 'player-play-btn player-playing';
                elements.playBtn.textContent = '▶';
            }
            stopSpectrum();
            saveState();
            return;
        }

        if (!audio) return;

        // 从 localStorage 读取保存的进度
        var saved = loadState();
        var savedProgress = 0;
        if (saved && saved.currentIndex === state.currentIndex && saved.progress > 0) {
            savedProgress = saved.progress;
            state.progress = savedProgress;
            updateProgressBar();
        }

        // 播放前设置一次 currentTime（多数浏览器支持）
        if (savedProgress > 0) {
            audio.currentTime = savedProgress;
            state.progress = savedProgress;
            updateProgressBar();
        }

        // 重置进度恢复标记
        progressRestored = false;

        // ★ 用 canplay 事件作为进度恢复的保障（只触发一次）
        var onCanPlay = function() {
            if (!progressRestored && savedProgress > 0 && audio && state.isPlaying) {
                audio.currentTime = savedProgress;
                state.progress = savedProgress;
                updateProgressBar();
                progressRestored = true;
            }
            audio.removeEventListener('canplay', onCanPlay);
        };
        audio.addEventListener('canplay', onCanPlay, { once: true });

        // 开始播放
        audio.play().then(function() {
            state.isPlaying = true;
            if (elements.toggleWrapper) elements.toggleWrapper.classList.add('player-playing');
            if (elements.playBtn) {
                elements.playBtn.className = 'player-play-btn player-paused';
                elements.playBtn.textContent = '';
            }
            startSpectrum();
            // 播放完成后再次确认进度（防止手机端重置）
            if (savedProgress > 0) {
                audio.currentTime = savedProgress;
                state.progress = savedProgress;
                updateProgressBar();
                progressRestored = true;
            }
            saveState();
        }).catch(function(err) {
            console.warn('播放失败:', err);
            state.isPlaying = false;
            if (elements.playBtn) {
                elements.playBtn.className = 'player-play-btn player-playing';
                elements.playBtn.textContent = '▶';
            }
        });
    }

    function nextSong() {
        if (!state.songs || state.songs.length === 0) return;
        var oldIndex = state.currentIndex;
        if (state.currentMode === 'random') {
            var newIndex;
            do {
                newIndex = Math.floor(Math.random() * state.songs.length);
            } while (newIndex === oldIndex && state.songs.length > 1);
            state.currentIndex = newIndex;
        } else {
            state.currentIndex = (state.currentIndex + 1) % state.songs.length;
        }
        var wasPlaying = state.isPlaying;
        if (wasPlaying) {
            if (audio) audio.pause();
            state.isPlaying = false;
            if (elements.toggleWrapper) elements.toggleWrapper.classList.remove('player-playing');
            if (elements.playBtn) {
                elements.playBtn.className = 'player-play-btn player-playing';
                elements.playBtn.textContent = '▶';
            }
            stopSpectrum();
        }
        loadSong(state.currentIndex, wasPlaying);
        saveState();
    }

    function prevSong() {
        if (!state.songs || state.songs.length === 0) return;
        var oldIndex = state.currentIndex;
        if (state.currentMode === 'random') {
            var newIndex;
            do {
                newIndex = Math.floor(Math.random() * state.songs.length);
            } while (newIndex === oldIndex && state.songs.length > 1);
            state.currentIndex = newIndex;
        } else {
            state.currentIndex = (state.currentIndex - 1 + state.songs.length) % state.songs.length;
        }
        var wasPlaying = state.isPlaying;
        if (wasPlaying) {
            if (audio) audio.pause();
            state.isPlaying = false;
            if (elements.toggleWrapper) elements.toggleWrapper.classList.remove('player-playing');
            if (elements.playBtn) {
                elements.playBtn.className = 'player-play-btn player-playing';
                elements.playBtn.textContent = '▶';
            }
            stopSpectrum();
        }
        loadSong(state.currentIndex, wasPlaying);
        saveState();
    }

    function checkScroll() {
        var wrap = elements.songName ? elements.songName.parentElement : null;
        if (!wrap || !elements.songName) return;
        elements.songName.classList.remove('player-scrolling');
        void elements.songName.offsetWidth;
        if (elements.songName.scrollWidth > wrap.offsetWidth) {
            elements.songName.classList.add('player-scrolling');
        }
    }

    // ============================================================
    //  8. 面板控制
    // ============================================================
    function openMainPanel() {
        state.panelOpen = true;
        if (elements.panel) {
            elements.panel.style.display = 'block';
            elements.panel.classList.add('player-open');
        }
        updatePanelPosition();
        setTimeout(checkScroll, 100);
        if (state.isPlaying) startSpectrum();
        saveState();
    }

    function closeMainPanel() {
        state.panelOpen = false;
        if (elements.panel) {
            elements.panel.style.display = 'none';
            elements.panel.classList.remove('player-open');
        }
        if (state.effectPanelOpen) closeEffectPanel();
        saveState();
    }

    function toggleMainPanel() {
        if (state.panelOpen) {
            closeMainPanel();
        } else {
            openMainPanel();
        }
    }

    function openEffectPanel() {
        state.effectPanelOpen = true;
        if (elements.effectPanel) {
            elements.effectPanel.style.display = 'block';
            elements.effectPanel.classList.add('player-open');
        }
        if (elements.effectToggleBtn) elements.effectToggleBtn.classList.add('player-active');
        var panelRect = elements.panel ? elements.panel.getBoundingClientRect() : { left: 0, top: 0 };
        var winW = window.innerWidth,
            winH = window.innerHeight;
        var panelW = 220;
        var panelH = Math.min(320, elements.effectPanel ? elements.effectPanel.scrollHeight || 280 : 280);
        var left = panelRect.left;
        if (left + panelW > winW - 4) left = winW - panelW - 4;
        if (left < 4) left = 4;
        var top;
        var spaceAbove = panelRect.top - 10;
        var spaceBelow = winH - panelRect.bottom - 10;
        if (spaceAbove > panelH) top = panelRect.top - panelH - 2;
        else if (spaceBelow > panelH) top = panelRect.bottom + 2;
        else top = Math.max(4, panelRect.top - panelH - 2);
        if (elements.effectPanel) {
            elements.effectPanel.style.left = left + 'px';
            elements.effectPanel.style.top = top + 'px';
            elements.effectPanel.style.right = 'auto';
            elements.effectPanel.style.bottom = 'auto';
        }
    }

    function closeEffectPanel() {
        state.effectPanelOpen = false;
        if (elements.effectPanel) {
            elements.effectPanel.style.display = 'none';
            elements.effectPanel.classList.remove('player-open');
        }
        if (elements.effectToggleBtn) elements.effectToggleBtn.classList.remove('player-active');
    }

    function toggleEffectPanel() {
        if (state.effectPanelOpen) {
            closeEffectPanel();
        } else {
            openEffectPanel();
        }
    }

    function updatePanelPosition() {
        if (!elements.toggleWrapper || !elements.panel) return;
        var rect = elements.toggleWrapper.getBoundingClientRect();
        var winW = window.innerWidth,
            winH = window.innerHeight;
        var btnW = 56,
            btnH = 56;
        var centerX = rect.left + btnW / 2,
            centerY = rect.top + btnH / 2;
        var leftDir = centerX > winW / 2,
            topDir = centerY > winH / 2;
        elements.panel.style.left = elements.panel.style.right = elements.panel.style.top = elements.panel.style.bottom = '';
        if (leftDir) {
            elements.panel.style.right = (winW - rect.left + 1) + 'px';
        } else {
            elements.panel.style.left = (rect.left + btnW + 1) + 'px';
        }
        if (topDir) {
            elements.panel.style.bottom = (winH - rect.top + 1) + 'px';
        } else {
            elements.panel.style.top = (rect.top + btnH + 1) + 'px';
        }
    }

    // ============================================================
    //  9. 根据 musicEnabled 控制显示/隐藏
    // ============================================================
    function applyMusicEnabled() {
        if (!elements.toggleWrapper) return;
        if (state.musicEnabled) {
            elements.toggleWrapper.style.display = 'flex';
        } else {
            elements.toggleWrapper.style.display = 'none';
            if (state.panelOpen) {
                closeMainPanel();
            }
        }
    }

    // ============================================================
    //  10. 初始化播放器
    // ============================================================
    window.initPlayer = function(options) {
        options = options || {};

        if (isInitialized) {
            destroyPlayer();
        }

        elements.toggleWrapper = document.getElementById('playerToggleWrapper');
        elements.panel = document.getElementById('playerPanel');
        elements.playBtn = document.getElementById('playerPlayBtn');
        elements.prevBtn = document.getElementById('playerPrevBtn');
        elements.nextBtn = document.getElementById('playerNextBtn');
        elements.progressBar = document.getElementById('playerProgressBar');
        elements.progressWrap = document.getElementById('playerProgressWrap');
        elements.progressDot = document.getElementById('playerProgressDot');
        elements.currentTime = document.getElementById('playerCurrentTime');
        elements.totalTime = document.getElementById('playerTotalTime');
        elements.songName = document.getElementById('playerSongName');
        elements.spectrumArea = document.getElementById('playerSpectrumArea');
        elements.effectPanel = document.getElementById('playerEffectPanel');
        elements.effectToggleBtn = document.getElementById('playerEffectToggleBtn');
        elements.effectGrid = document.getElementById('playerEffectGrid');
        elements.effectConfirmBtn = document.getElementById('playerEffectConfirmBtn');

        if (!elements.toggleWrapper || !elements.panel) {
            console.warn('播放器元素未找到，请确保 HTML 结构完整');
            return;
        }

        audio = new Audio();

        audio.addEventListener('loadedmetadata', function() {
            if (audio.duration && isFinite(audio.duration)) {
                state.duration = audio.duration;
                var saved = loadState();
                if (saved && saved.currentIndex === state.currentIndex && saved.progress > 0) {
                    state.progress = saved.progress;
                }
                updateProgressBar();
                if (elements.totalTime) elements.totalTime.textContent = formatTime(state.duration);
            }
        });

        var saved = loadState();

        if (options.musicList && options.musicList.length > 0) {
            state.songs = options.musicList.map(function(item) {
                return { name: '🎵 ' + item.name, url: item.url };
            });
            state.musicEnabled = options.musicEnabled !== undefined ? options.musicEnabled : true;
            state.musicAutoPlay = options.musicAutoPlay || false;
            state.musicDefault = options.musicDefault || '';
            console.log('✅ 播放器已使用传入的 musicList，歌曲数:', state.songs.length);
            finishInit(saved);
        } else if (options.configPath) {
            fetch(options.configPath)
                .then(function(response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.json();
                })
                .then(function(data) {
                    applyConfigData(data, saved);
                })
                .catch(function(err) {
                    console.warn('⚠️ 加载配置失败，使用默认歌曲:', err.message);
                    state.songs = DEFAULT_SONGS.slice();
                    state.musicEnabled = true;
                    state.musicAutoPlay = false;
                    state.musicDefault = '';
                    finishInit(saved);
                });
            return;
        } else {
            fetch('config.json')
                .then(function(response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.json();
                })
                .then(function(data) {
                    applyConfigData(data, saved);
                })
                .catch(function(err) {
                    console.warn('⚠️ 加载 config.json 失败，使用默认歌曲:', err.message);
                    state.songs = DEFAULT_SONGS.slice();
                    state.musicEnabled = true;
                    state.musicAutoPlay = false;
                    state.musicDefault = '';
                    finishInit(saved);
                });
            return;
        }

        function finishInit(saved) {
            applyMusicEnabled();

            if (saved) {
                if (saved.currentMode) state.currentMode = saved.currentMode;
                if (saved.currentEffect) state.currentEffect = saved.currentEffect;
                if (saved.panelOpen !== null) state.panelOpen = saved.panelOpen;
            }

            var defaultIndex = 0;
            if (state.musicDefault) {
                var found = state.songs.findIndex(function(s) {
                    return s.name.replace('🎵 ', '') === state.musicDefault ||
                        s.name === state.musicDefault;
                });
                if (found !== -1) defaultIndex = found;
            }
            if (saved && saved.currentIndex !== null &&
                saved.currentIndex >= 0 && saved.currentIndex < state.songs.length) {
                defaultIndex = saved.currentIndex;
            }

            state.currentIndex = defaultIndex;

            bindEvents();

            renderSpectrum(state.currentEffect);
            renderEffectButtons();

            loadSong(state.currentIndex, false);

            if (saved && saved.panelOpen) {
                openMainPanel();
            }

            if (state.musicAutoPlay) {
                setTimeout(function() {
                    if (audio && !state.isPlaying) {
                        loadSong(state.currentIndex, true);
                    }
                }, 300);
            }

            setTimeout(function() {
                updatePanelPosition();
                console.log('✅ 播放器初始化完成');
                isInitialized = true;
            }, 100);
        }

        function applyConfigData(data, saved) {
            if (data.musicList && data.musicList.length > 0) {
                state.songs = data.musicList.map(function(item) {
                    return { name: '🎵 ' + item.name, url: item.url };
                });
                console.log('✅ 播放器已从 config.json 加载配置，歌曲数:', state.songs.length);
            } else {
                state.songs = DEFAULT_SONGS.slice();
                console.warn('⚠️ config.json 中 musicList 为空，使用默认歌曲');
            }

            state.musicEnabled = data.musicEnabled !== undefined ? data.musicEnabled : true;
            state.musicAutoPlay = data.musicAutoPlay || false;
            state.musicDefault = data.musicDefault || '';

            finishInit(saved);
        }
    };

    // ============================================================
    //  11. 事件绑定
    // ============================================================
    function bindEvents() {
        if (elements.toggleWrapper) {
            elements.toggleWrapper.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleMainPanel();
            });
        }

        if (elements.playBtn) {
            elements.playBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                applyFeedback(this);
                setTimeout(togglePlay, 50);
            });
        }

        if (elements.prevBtn) {
            elements.prevBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                applyFeedback(this);
                setTimeout(prevSong, 50);
            });
        }
        if (elements.nextBtn) {
            elements.nextBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                applyFeedback(this);
                setTimeout(nextSong, 50);
            });
        }

        if (elements.effectToggleBtn) {
            elements.effectToggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (!state.panelOpen) {
                    openMainPanel();
                    setTimeout(toggleEffectPanel, 150);
                } else {
                    toggleEffectPanel();
                }
            });
        }

        if (elements.effectConfirmBtn) {
            elements.effectConfirmBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                closeEffectPanel();
            });
        }

        var modeBtns = getAllElements('.player-mode-btn');
        modeBtns.forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var mode = this.dataset.mode;
                if (this.classList.contains('player-active')) {
                    this.classList.remove('player-active');
                    state.currentMode = 'order';
                    var orderBtn = document.querySelector('.player-mode-btn[data-mode="order"]');
                    if (orderBtn) orderBtn.classList.add('player-active');
                } else {
                    modeBtns.forEach(function(b) { b.classList.remove('player-active'); });
                    this.classList.add('player-active');
                    state.currentMode = mode;
                }
                saveState();
            });
        });

        // ---- 进度条（鼠标 + 触摸） ----
        bindProgressDrag();

        document.addEventListener('click', function(e) {
            var isInside = false;
            if (elements.panel && elements.panel.contains(e.target)) isInside = true;
            if (elements.toggleWrapper && elements.toggleWrapper.contains(e.target)) isInside = true;
            if (elements.effectPanel && elements.effectPanel.contains(e.target)) isInside = true;
            if (!isInside) {
                if (state.panelOpen) closeMainPanel();
                if (state.effectPanelOpen) closeEffectPanel();
            }
        });

        bindDragEvents();

        window.addEventListener('resize', function() {
            if (state.panelOpen) updatePanelPosition();
            if (state.effectPanelOpen) openEffectPanel();
        });

        if (audio) {
            // ★ 关键修复：timeupdate 中检查拖拽标志，不更新进度条
            audio.addEventListener('timeupdate', function() {
                if (state.isPlaying && audio.duration) {
                    state.progress = audio.currentTime;
                    state.duration = audio.duration || 180;
                    updateProgressBar(); // 内部检查 isDraggingProgress
                    if (Math.floor(state.progress) % 5 === 0) {
                        saveState();
                    }
                    if (audio.currentTime >= audio.duration) {
                        if (state.currentMode === 'single') {
                            audio.currentTime = 0;
                            audio.play();
                        } else {
                            var wasPlaying = true;
                            if (wasPlaying) {
                                audio.pause();
                                nextSong();
                                if (state.isPlaying) {
                                    audio.play().catch(function() {});
                                }
                            }
                        }
                        saveState();
                    }
                }
            });

            audio.addEventListener('error', function() {
                console.warn('音频加载失败');
                state.duration = 180;
                if (elements.totalTime) elements.totalTime.textContent = formatTime(state.duration);
            });
        }
    }

    // ============================================================
    //  12. 进度条拖拽（鼠标 + 触摸）
    //  修复：拖拽期间暂停 timeupdate 更新
    // ============================================================
    function bindProgressDrag() {
        if (!elements.progressWrap) return;

        function getProgressPercent(e) {
            var rect = elements.progressWrap.getBoundingClientRect();
            var clientX = e.clientX || (e.touches && e.touches[0].clientX);
            if (clientX === undefined) return 0;
            var pos = (clientX - rect.left) / rect.width;
            return Math.max(0, Math.min(1, pos));
        }

        function updateProgressVisual(percent) {
            var actualDuration = (audio && audio.duration && isFinite(audio.duration)) ? audio.duration : state.duration;
            var newProgress = percent * actualDuration;
            // ★ 拖拽期间只更新视觉，不更新 state.progress（防止与 timeupdate 冲突）
            if (elements.progressBar) {
                elements.progressBar.style.width = (percent * 100) + '%';
            }
            if (elements.currentTime) {
                elements.currentTime.textContent = formatTime(newProgress);
            }
            state._dragProgress = newProgress;
            state._dragPercent = percent;
        }

        // ---- 鼠标事件 ----
        elements.progressWrap.addEventListener('mousedown', function(e) {
            e.preventDefault();
            state.isDraggingProgress = true;
            var percent = getProgressPercent(e);
            updateProgressVisual(percent);
        });

        document.addEventListener('mousemove', function(e) {
            if (!state.isDraggingProgress) return;
            var percent = getProgressPercent(e);
            updateProgressVisual(percent);
        });

        document.addEventListener('mouseup', function(e) {
            if (!state.isDraggingProgress) return;
            state.isDraggingProgress = false;
            applyDragTarget();
        });

        // ---- 触摸事件 ----
        elements.progressWrap.addEventListener('touchstart', function(e) {
            e.preventDefault();
            state.isDraggingProgress = true;
            var percent = getProgressPercent(e);
            updateProgressVisual(percent);
        }, { passive: false });

        document.addEventListener('touchmove', function(e) {
            if (!state.isDraggingProgress) return;
            e.preventDefault();
            var percent = getProgressPercent(e);
            updateProgressVisual(percent);
        }, { passive: false });

        document.addEventListener('touchend', function(e) {
            if (!state.isDraggingProgress) return;
            state.isDraggingProgress = false;
            applyDragTarget();
        });

        // 点击跳转（不受拖拽标志影响）
        elements.progressWrap.addEventListener('click', function(e) {
            if (state.isDraggingProgress) return;
            var rect = this.getBoundingClientRect();
            var pos = (e.clientX - rect.left) / rect.width;
            if (audio && audio.duration && isFinite(audio.duration)) {
                audio.currentTime = pos * audio.duration;
                state.progress = audio.currentTime;
                updateProgressBar();
                saveState();
            } else {
                state.progress = Math.max(0, Math.min(pos * state.duration, state.duration));
                updateProgressBar();
                saveState();
            }
        });

        // 统一跳转逻辑
        function applyDragTarget() {
            if (state._dragProgress === undefined) return;
            var targetProgress = state._dragProgress;
            var actualDuration = (audio && audio.duration && isFinite(audio.duration)) ? audio.duration : state.duration;
            if (targetProgress > actualDuration) targetProgress = actualDuration;
            if (targetProgress < 0) targetProgress = 0;

            // 先更新 state.progress 和进度条
            state.progress = targetProgress;
            // ★ 重置进度恢复标记，允许 canplay 再次恢复
            progressRestored = false;

            // 如果正在播放，先暂停
            var wasPlaying = state.isPlaying;
            if (wasPlaying && audio) {
                audio.pause();
            }

            // 设置 currentTime（先尝试直接设置）
            if (audio && audio.duration && isFinite(audio.duration)) {
                audio.currentTime = targetProgress;
            }

            // 更新进度条
            updateProgressBar();
            saveState();

            // 恢复播放
            if (wasPlaying && audio) {
                audio.play().then(function() {
                    // 播放完成后用 canplay 确保进度正确
                    var onCanPlay = function() {
                        if (!progressRestored && audio) {
                            audio.currentTime = targetProgress;
                            state.progress = targetProgress;
                            updateProgressBar();
                            progressRestored = true;
                        }
                        audio.removeEventListener('canplay', onCanPlay);
                    };
                    audio.addEventListener('canplay', onCanPlay, { once: true });

                    // 再次确保播放后的进度
                    if (audio) {
                        audio.currentTime = targetProgress;
                        state.progress = targetProgress;
                        updateProgressBar();
                        progressRestored = true;
                    }
                    saveState();
                }).catch(function() {});
            } else {
                // 非播放状态，用 canplay 确保进度
                var onCanPlay = function() {
                    if (!progressRestored && audio) {
                        audio.currentTime = targetProgress;
                        state.progress = targetProgress;
                        updateProgressBar();
                        progressRestored = true;
                    }
                    audio.removeEventListener('canplay', onCanPlay);
                };
                audio.addEventListener('canplay', onCanPlay, { once: true });
            }

            state._dragProgress = undefined;
            state._dragPercent = undefined;
        }
    }

    // ============================================================
    //  13. 悬浮球拖拽
    // ============================================================
    function bindDragEvents() {
        if (!elements.toggleWrapper) return;
        var dragOffX = 0,
            dragOffY = 0,
            moved = false;

        function startDrag(e) {
            var clientX = e.clientX || (e.touches && e.touches[0].clientX);
            var clientY = e.clientY || (e.touches && e.touches[0].clientY);
            if (clientX === undefined) return;
            var rect = elements.toggleWrapper.getBoundingClientRect();
            dragOffX = clientX - rect.left;
            dragOffY = clientY - rect.top;
            state.isDragging = true;
            moved = false;
            elements.toggleWrapper.style.cursor = 'grabbing';
        }

        function moveDrag(e) {
            if (!state.isDragging) return;
            var clientX = e.clientX || (e.touches && e.touches[0].clientX);
            var clientY = e.clientY || (e.touches && e.touches[0].clientY);
            if (clientX === undefined) return;
            var winW = window.innerWidth,
                winH = window.innerHeight;
            var w = 56,
                h = 56;
            var newX = clientX - dragOffX,
                newY = clientY - dragOffY;
            newX = Math.max(0, Math.min(winW - w, newX));
            newY = Math.max(0, Math.min(winH - h, newY));
            elements.toggleWrapper.style.left = newX + 'px';
            elements.toggleWrapper.style.top = newY + 'px';
            elements.toggleWrapper.style.right = 'auto';
            elements.toggleWrapper.style.bottom = 'auto';
            moved = true;
            if (state.panelOpen) updatePanelPosition();
            if (state.effectPanelOpen) openEffectPanel();
            e.preventDefault();
        }

        function endDrag(e) {
            if (state.isDragging) {
                state.isDragging = false;
                elements.toggleWrapper.style.cursor = 'grab';
                if (moved && state.panelOpen) updatePanelPosition();
                if (moved && state.effectPanelOpen) openEffectPanel();
            }
        }

        elements.toggleWrapper.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', moveDrag);
        document.addEventListener('mouseup', endDrag);
        elements.toggleWrapper.addEventListener('touchstart', startDrag, { passive: true });
        document.addEventListener('touchmove', moveDrag, { passive: false });
        document.addEventListener('touchend', endDrag);
    }

    // ============================================================
    //  14. 反馈与效果按钮
    // ============================================================
    function applyFeedback(element) {
        if (timers.feedback) clearTimeout(timers.feedback);
        element.classList.add('player-feedback-red');
        timers.feedback = setTimeout(function() {
            element.classList.remove('player-feedback-red');
            timers.feedback = null;
        }, 150);
    }

    function renderEffectButtons() {
        if (!elements.effectGrid) return;
        elements.effectGrid.innerHTML = '';
        effects.forEach(function(e) {
            var btn = document.createElement('button');
            btn.className = 'player-effect-btn' + (e.id === state.currentEffect ? ' player-active' : '');
            btn.dataset.effect = e.id;
            btn.textContent = e.label;
            btn.addEventListener('click', function(ev) {
                ev.stopPropagation();
                setEffect(this.dataset.effect);
            });
            elements.effectGrid.appendChild(btn);
        });
    }

    // ============================================================
    //  15. 销毁
    // ============================================================
    function destroyPlayer() {
        if (audio) {
            audio.pause();
            audio.src = '';
        }
        if (timers.spec) { clearInterval(timers.spec);
            timers.spec = null; }
        if (timers.feedback) { clearTimeout(timers.feedback);
            timers.feedback = null; }
        isInitialized = false;
        console.log('播放器已销毁');
    }

    window.destroyPlayer = destroyPlayer;

})();