/**
 * Service Worker — PWA 离线缓存
 * 策略：Network First（优先网络，失败时回退缓存）
 */

const CACHE_NAME = 'course-reminder-v1';

const CACHE_URLS = [
    '/',
    '/static/style.css',
    '/static/app.js',
    '/manifest.json',
];

// 安装：预缓存核心资源
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(CACHE_URLS).catch(err => {
                console.log('SW 缓存预热部分失败:', err);
            });
        })
    );
    self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// 请求：Network First
self.addEventListener('fetch', event => {
    // 跳过 API 请求（不缓存）
    if (event.request.url.includes('/api/')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // 更新缓存
                const cloned = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, cloned);
                });
                return response;
            })
            .catch(() => {
                // 网络失败时从缓存返回
                return caches.match(event.request);
            })
    );
});
