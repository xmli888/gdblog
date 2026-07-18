// ============================================================
//  登录三件套（硬编码默认值，用于首次部署/兜底）
//  注意：请将 YOUR_PUBLIC_KEY 和 YOUR_CHALLENGE_CIPHER 替换为您的真实值
// ============================================================
var YOUR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu7d4XxEfYz5zNjxR+W+w
... (请替换为您的真实公钥)
-----END PUBLIC KEY-----`;

var YOUR_CHALLENGE_CIPHER = '... (请替换为您的真实挑战码密文) ...';
var YOUR_EXPECTED_PLAIN = 'OK';

// ============================================================
//  全局配置
// ============================================================
var config = { token: '', user: '', repo: '', path: 'posts.json', configPath: 'config.json' };
var posts = [];
var categories = [];
var tags = [];
var aboutContent = '';
var siteSettings = {};
var fonts = [];
var defaultFont = '';
var fontSwitchEnabled = true;
var musicList = [];
var musicEnabled = true;
var musicAutoPlay = false;
var musicDefault = '';
var securityConfig = null;
var lastBackupTime = '';
var autoLoadComments = true;
var giscusConfig = { repo: '', repoId: '', category: 'General', categoryId: '' };
var messages = [];
var likedPosts = JSON.parse(localStorage.getItem('liked_posts') || '{}');
var likedMessages = JSON.parse(localStorage.getItem('liked_messages') || '{}');

var DEFAULT_CONFIG = {
    categories: ['随笔', '书评', '游记', '散文', '诗词', '其他'],
    tags: ['墨韵', '古宅', '红木', '诗词', '阅读'],
    about: '墨韵轩，一处藏于青砖屋檐下的精神角落。',
    siteSettings: {
        logo: '墨',
        title: '墨韵轩',
        subtitle: '— 青砖檐下 · 笔墨春秋 · 静观自得 —',
        authorName: '墨轩主',
        authorDesc: '闲来读书，兴至写文。\n以文会友，以友辅仁。'
    },
    fonts: ['楷体', '宋体', '黑体', '仿宋', '行楷', '隶书', '方正'],
    defaultFont: '楷体',
    fontSwitchEnabled: true,
    musicList: [],
    musicEnabled: true,
    musicAutoPlay: false,
    musicDefault: '',
    lastBackupTime: '',
    autoLoadComments: true,
    giscus: {
        repo: '',
        repoId: '',
        category: 'General',
        categoryId: ''
    },
    // ============================================================
    //  ★★★ 您的登录三件套（作为默认配置）★★★
    // ============================================================
    security: {
        publicKey: YOUR_PUBLIC_KEY,
        challengeCipher: YOUR_CHALLENGE_CIPHER,
        expectedPlain: YOUR_EXPECTED_PLAIN
    }
};

var DEFAULT_MESSAGES = { messages: [] };
var DEFAULT_POSTS = [
    {
        "id": 1,
        "title": "欢迎来到墨韵轩",
        "category": "随笔",
        "tags": ["墨韵", "古宅", "红木"],
        "date": "2026-07-16",
        "author": "墨轩主",
        "views": 0,
        "likes": 0,
        "content": "这里是一篇示例文章，您可以在后台添加或修改内容。"
    }
];

// ============================================================
//  工具函数
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getToday() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getNowString() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
    return y + '-' + m + '-' + day + ' ' + h + ':' + min + ':' + s;
}

function getTimestamp() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
    return y + '-' + m + '-' + day + '_' + h + min + s;
}

function showToast(msg, type) {
    var el = document.getElementById('toastContainer');
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.style.background = type === 'error' ? '#8b2500' : (type === 'success' ? '#4a5a6a' : '#3e2723');
    el.classList.add('show');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(function() { el.classList.remove('show'); }, 3000);
}

function loadLocalConfig() {
    var saved = localStorage.getItem('github_config');
    if (saved) {
        try {
            var parsed = JSON.parse(saved);
            config.token = parsed.token || '';
            config.user = parsed.user || '';
            config.repo = parsed.repo || '';
            config.path = parsed.path || 'posts.json';
            config.configPath = parsed.configPath || 'config.json';
        } catch (e) {}
    }
}

function isConfigured() { return config.token && config.user && config.repo; }

// ============================================================
//  文件读写
// ============================================================
function decodeBase64Utf8(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
}

function encodeUtf8ToBase64(text) {
    var data = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
    return btoa(binary);
}

function fetchFileRaw(path) {
    return fetch(path, { cache: 'no-store' })
        .then(function(res) {
            if (res.ok) return res.text();
            else return null;
        })
        .catch(function() { return null; });
}

function fetchJsonRaw(path) {
    return fetchFileRaw(path).then(function(text) {
        if (text) {
            try { return JSON.parse(text); } catch (e) { return null; }
        }
        return null;
    });
}

function saveFile(path, content, message) {
    if (!isConfigured()) {
        showToast('请先配置GitHub', 'error');
        return Promise.reject('未配置GitHub');
    }
    var url = 'https://api.github.com/repos/' + config.user + '/' + config.repo + '/contents/' + path;
    var encoded = encodeUtf8ToBase64(content);
    return fetch(url, {
        headers: { 'Authorization': 'token ' + config.token, 'Accept': 'application/vnd.github.v3+json' }
    }).then(function(res) {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }).then(function(data) {
        var body = { message: message || '更新文件', content: encoded, branch: 'main' };
        if (data && data.sha) body.sha = data.sha;
        return fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': 'token ' + config.token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }).then(function(res) {
        if (!res.ok) return res.json().then(function(err) { throw new Error(err.message || '保存失败'); });
        return res.json();
    });
}

// ============================================================
//  配置应用
// ============================================================
function applyConfig(json) {
    categories = json.categories && json.categories.length ? json.categories : DEFAULT_CONFIG.categories.slice();
    tags = json.tags && json.tags.length ? json.tags.slice() : [];
    if (tags.length === 0 && posts.length > 0) {
        var tagSet = {};
        posts.forEach(function(p) {
            if (p.tags) {
                p.tags.forEach(function(t) {
                    if (t) tagSet[t] = true;
                });
            }
        });
        tags = Object.keys(tagSet);
    }
    aboutContent = json.about || DEFAULT_CONFIG.about;
    siteSettings = json.siteSettings || DEFAULT_CONFIG.siteSettings;
    fonts = json.fonts || DEFAULT_CONFIG.fonts;
    defaultFont = json.defaultFont || DEFAULT_CONFIG.defaultFont;
    fontSwitchEnabled = json.fontSwitchEnabled !== undefined ? json.fontSwitchEnabled : true;
    musicList = json.musicList || [];
    musicEnabled = json.musicEnabled !== undefined ? json.musicEnabled : true;
    musicAutoPlay = json.musicAutoPlay || false;
    musicDefault = json.musicDefault || '';
    lastBackupTime = json.lastBackupTime || '';
    autoLoadComments = json.autoLoadComments !== undefined ? json.autoLoadComments : true;
    giscusConfig = json.giscus || { repo: '', repoId: '', category: 'General', categoryId: '' };
    // ★★★ 您的登录三件套：优先从 config.json 读取，如果没有则用硬编码默认值 ★★★
    if (json.security) {
        securityConfig = json.security;
        localStorage.setItem('security_config', JSON.stringify(json.security));
    } else {
        securityConfig = DEFAULT_CONFIG.security;
        localStorage.setItem('security_config', JSON.stringify(DEFAULT_CONFIG.security));
    }
}

function saveConfigData() {
    var data = {
        categories: categories,
        tags: tags,
        about: aboutContent,
        siteSettings: siteSettings,
        fonts: fonts,
        defaultFont: defaultFont,
        fontSwitchEnabled: fontSwitchEnabled,
        musicList: musicList,
        musicEnabled: musicEnabled,
        musicAutoPlay: musicAutoPlay,
        musicDefault: musicDefault,
        lastBackupTime: lastBackupTime,
        autoLoadComments: autoLoadComments,
        giscus: giscusConfig,
        // ★★★ 保存登录三件套到 config.json ★★★
        security: JSON.parse(localStorage.getItem('security_config') || '{}')
    };
    var jsonStr = JSON.stringify(data, null, 2);
    return saveFile('config.json', jsonStr, '更新配置');
}

function saveMessagesData() {
    var data = { messages: messages };
    var jsonStr = JSON.stringify(data, null, 2);
    return saveFile('messages.json', jsonStr, '更新留言');
}

// ============================================================
//  数据加载
// ============================================================
function loadAllData() {
    return fetchFileRaw('posts.json')
        .then(function(text) {
            if (text) {
                try {
                    var parsed = JSON.parse(text);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        posts = parsed;
                        posts.forEach(function(p, idx) { p.id = idx + 1; });
                    } else {
                        if (posts.length === 0) {
                            posts = JSON.parse(JSON.stringify(DEFAULT_POSTS));
                            if (isConfigured()) {
                                saveFile('posts.json', JSON.stringify(DEFAULT_POSTS, null, 2), '创建默认文章').catch(function() {});
                            }
                        }
                    }
                } catch (e) {
                    console.warn('JSON解析失败:', e);
                    if (posts.length === 0) {
                        posts = JSON.parse(JSON.stringify(DEFAULT_POSTS));
                        if (isConfigured()) {
                            saveFile('posts.json', JSON.stringify(DEFAULT_POSTS, null, 2), '创建默认文章').catch(function() {});
                        }
                    }
                }
            } else {
                if (posts.length === 0) {
                    posts = JSON.parse(JSON.stringify(DEFAULT_POSTS));
                    if (isConfigured()) {
                        saveFile('posts.json', JSON.stringify(DEFAULT_POSTS, null, 2), '创建默认文章').catch(function() {});
                    }
                }
            }
            return fetchJsonRaw('config.json');
        })
        .then(function(json) {
            if (json) {
                applyConfig(json);
            } else {
                applyConfig(DEFAULT_CONFIG);
                if (isConfigured()) {
                    saveFile('config.json', JSON.stringify(DEFAULT_CONFIG, null, 2), '创建默认配置').catch(function() {});
                }
            }
            return fetchJsonRaw('messages.json');
        })
        .then(function(msgJson) {
            if (msgJson && msgJson.messages) {
                messages = msgJson.messages;
            } else {
                messages = [];
                if (isConfigured()) {
                    saveFile('messages.json', JSON.stringify(DEFAULT_MESSAGES, null, 2), '创建默认留言文件').catch(function() {});
                }
            }
        })
        .catch(function(err) {
            console.error('加载数据出错:', err);
            applyConfig(DEFAULT_CONFIG);
        });
}

// ============================================================
//  ★★★ 您的登录解密函数（原封不动）★★★
// ============================================================
function base64ToArrayBuffer(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function pemToArrayBuffer(pem, type) {
    var marker = '-----BEGIN ' + type + '-----';
    var footer = '-----END ' + type + '-----';
    var content = pem.trim();
    if (content.includes(marker)) {
        content = content.substring(content.indexOf(marker) + marker.length, content.lastIndexOf(footer));
    }
    return base64ToArrayBuffer(content.replace(/\s/g, ''));
}

function importPrivateKey(pem) {
    var buf = pemToArrayBuffer(pem, 'PRIVATE KEY');
    return crypto.subtle.importKey('pkcs8', buf, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}

function hybridDecrypt(base64Package, privateKeyPem) {
    var combinedBuf = base64ToArrayBuffer(base64Package);
    var combined = new Uint8Array(combinedBuf);
    var iv = combined.slice(0, 12);
    var encryptedAESKeyLen = 256;
    if (combined.length < 12 + encryptedAESKeyLen) throw new Error('数据包长度异常');
    var encryptedAESKey = combined.slice(12, 12 + encryptedAESKeyLen);
    var ciphertextWithTag = combined.slice(12 + encryptedAESKeyLen);
    return importPrivateKey(privateKeyPem).then(function(rsaPrivKey) {
        return crypto.subtle.decrypt({ name: 'RSA-OAEP' }, rsaPrivKey, encryptedAESKey)
            .then(function(aesKeyRaw) {
                return crypto.subtle.importKey('raw', aesKeyRaw, { name: 'AES-GCM' }, false, ['decrypt']);
            })
            .then(function(aesKey) {
                return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, tagLength: 128 }, aesKey,
                    ciphertextWithTag);
            })
            .then(function(plaintextBuf) {
                return new TextDecoder().decode(plaintextBuf);
            });
    });
}

loadLocalConfig();
