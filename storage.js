/* ─────────────────────────────────────────────
   Keystone · 儲存層

   把「資料存哪」這件事跟 app.js 完全隔開，所以之後要換成雲端同步，
   只動這個檔案，app.js 不用改一行。

   三層退路，由上往下試：
     1. window.storage  — 之後要接的同步後端（現在不存在）
     2. localStorage    — 這台電腦的瀏覽器，離線可用
     3. 記憶體          — 無痕模式或儲存被封鎖時的最後退路

   對外只有兩個同步函式：
     Store.get(key)      → 存進去的物件，沒有就 null
     Store.set(key, val) → 寫入，失敗不會丟錯

   另外提供 Store.dump() / Store.restore(json) 給備份用。
   ───────────────────────────────────────────── */
var Store = (function(){
  "use strict";

  var PREFIX = "keystone:";
  var LEGACY = "buoy:";      // 舊名，資料要搬過來
  var mem = {};          // 第三層
  var backend = "memory";

  /* localStorage 在無痕模式、或使用者關掉網站資料時會直接丟錯，
     所以要實際寫一次才知道能不能用，不能只檢查它存不存在。 */
  function probe(){
    try{
      var k = PREFIX + "__probe";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    }catch(e){ return false; }
  }

  if(probe()) backend = "local";

  /* 這個 app 以前叫 Buoy。舊資料的鍵是 buoy: 開頭，
     第一次用新版時搬到 keystone:，搬完把舊的刪掉。
     只搬還沒有同名新鍵的，避免蓋掉新資料。 */
  function migrateLegacy(){
    if(backend !== "local") return 0;
    var moved = 0;
    try{
      /* 先把鍵名全部抄下來再動手。邊走訪邊寫入會讓索引位移，
         漏搬的鍵就等於資料不見了。 */
      var keys = [];
      for(var i = 0; i < window.localStorage.length; i++){
        var k = window.localStorage.key(i);
        if(k && k.indexOf(LEGACY) === 0) keys.push(k);
      }
      keys.forEach(function(k){
        var nk = PREFIX + k.slice(LEGACY.length);
        if(window.localStorage.getItem(nk) === null){
          window.localStorage.setItem(nk, window.localStorage.getItem(k));
          moved++;
        }
        window.localStorage.removeItem(k);
      });
    }catch(e){}
    return moved;
  }
  var migrated = migrateLegacy();

  function get(key){
    if(backend === "local"){
      try{
        var raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      }catch(e){
        /* 資料壞掉就當作沒有，不要讓整個 app 開不起來 */
        return null;
      }
    }
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
  }

  function set(key, val){
    mem[key] = val;                      // 記憶體永遠留一份當快取
    touch(key);
    if(backend !== "local") return false;
    try{
      window.localStorage.setItem(key, JSON.stringify(val));
      return true;
    }catch(e){
      /* 配額爆掉或被封鎖：資料還在記憶體，這個 session 照常用 */
      return false;
    }
  }

  /* ── 雲端同步 ───────────────────────────
     localStorage 仍是主要儲存，雲端只是另一份。
     每個鍵記一個「最後修改時間」，兩邊比大小，新的蓋舊的。
     設定（網址與密碼）跟時間戳都放在 keystone-sync: 開頭的鍵，
     不在 keystone: 底下，所以不會被匯出備份、也不會被同步出去。 */
  var SYNC_CFG = "keystone-sync:cfg";
  var SYNC_META = "keystone-sync:meta";
  var syncCfg = null;
  var meta = {};
  var pushTimer = 0;
  var pending = {};

  try{
    syncCfg = JSON.parse(window.localStorage.getItem(SYNC_CFG) || "null");
    meta = JSON.parse(window.localStorage.getItem(SYNC_META) || "{}") || {};
  }catch(e){}
  if(!syncCfg || !syncCfg.url || !syncCfg.token) syncCfg = null;

  function saveMeta(){
    try{ window.localStorage.setItem(SYNC_META, JSON.stringify(meta)); }catch(e){}
  }

  function touch(key){
    if(!syncCfg || key.indexOf(PREFIX) !== 0) return;
    meta[key] = Date.now();
    pending[key] = true;
    saveMeta();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, 800);   // 連續編輯合併成一次上傳
  }

  function api(path, opts){
    opts = opts || {};
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function(){ ctl.abort(); }, opts.timeout || 8000) : 0;
    return fetch(syncCfg.url.replace(/\/+$/, "") + path, {
      method: opts.method || "GET",
      headers: { "Authorization": "Bearer " + syncCfg.token, "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctl ? ctl.signal : undefined
    }).then(function(r){
      clearTimeout(timer);
      if(r.status === 401) throw new Error("token");
      if(!r.ok) throw new Error("http " + r.status);
      return r.json();
    }, function(e){ clearTimeout(timer); throw e; });
  }

  function push(key){
    return api("/sync/" + encodeURIComponent(key), {
      method: "PUT", body: { v: get(key), t: meta[key] }
    }).then(function(){ delete pending[key]; });
  }

  function flush(){
    if(!syncCfg) return Promise.resolve();
    return Promise.all(Object.keys(pending).map(function(k){
      return push(k).catch(function(){});   // 失敗的留在 pending，下次同步再補傳
    }));
  }

  /* 跟雲端對一次帳。回傳從雲端套用了幾筆（>0 代表畫面上的資料已經過時）。
     本機沒有時間戳的鍵視為最舊，所以新裝置第一次連線時會以雲端為準；
     雲端沒有的鍵則會補傳上去。 */
  function sync(opts){
    if(!syncCfg || backend !== "local") return Promise.resolve(0);
    var applied = 0;
    return flush().then(function(){
      return api("/sync", opts);
    }).then(function(remote){
      var jobs = [];
      Object.keys(remote).forEach(function(k){
        if(remote[k] > (meta[k] || 0)){
          jobs.push(api("/sync/" + encodeURIComponent(k), opts).then(function(r){
            window.localStorage.setItem(k, JSON.stringify(r.v));
            mem[k] = r.v;
            meta[k] = r.t;
            applied++;
          }));
        }
      });
      for(var i = 0; i < window.localStorage.length; i++){
        var lk = window.localStorage.key(i);
        if(!lk || lk.indexOf(PREFIX) !== 0) continue;
        if((meta[lk] || 0) > (remote[lk] || 0) || !(lk in remote)){
          if(!meta[lk]) meta[lk] = Date.now();
          jobs.push(push(lk));
        }
      }
      return Promise.all(jobs);
    }).then(function(){
      saveMeta();
      return applied;
    });
  }

  function isEditing(){
    var a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  }

  /* 啟動時先等雲端的資料進來再開始畫面，最多等 3 秒；
     離線或後端掛了就直接用本機資料，不擋住 app。 */
  var ready = sync({ timeout: 3000 }).catch(function(){ return 0; });

  /* 回到這個分頁時再對一次帳。app.js 的資料是載入時讀進記憶體的，
     雲端有新資料就整頁重載，不然下一次存檔會把新資料蓋回去。
     正在輸入文字時先不重載，免得打到一半被洗掉。 */
  function onResume(){
    if(!syncCfg || isEditing()) return;
    sync().then(function(n){ if(n > 0 && !isEditing()) location.reload(); }).catch(function(){});
  }
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "visible") onResume();
  });
  window.addEventListener("focus", onResume);

  function setupSync(url, token){
    try{
      if(url && token){
        window.localStorage.setItem(SYNC_CFG, JSON.stringify({ url: url, token: token }));
      }else{
        window.localStorage.removeItem(SYNC_CFG);
        window.localStorage.removeItem(SYNC_META);
      }
      return true;
    }catch(e){ return false; }
  }

  function testSync(url, token){
    var prev = syncCfg;
    syncCfg = { url: url, token: token };
    return api("/sync", { timeout: 5000 }).then(function(){ syncCfg = prev; }, function(e){ syncCfg = prev; throw e; });
  }

  /* 全部資料倒成一份 JSON，給「匯出備份」用 */
  function dump(){
    var out = {};
    if(backend === "local"){
      try{
        for(var i = 0; i < window.localStorage.length; i++){
          var k = window.localStorage.key(i);
          if(k && k.indexOf(PREFIX) === 0) out[k] = JSON.parse(window.localStorage.getItem(k));
        }
      }catch(e){}
    }else{
      Object.keys(mem).forEach(function(k){ out[k] = mem[k]; });
    }
    return { app:"keystone", version:1, exportedAt:new Date().toISOString(), data:out };
  }

  /* 從備份還原。回傳寫進去的筆數。 */
  function restore(payload){
    var data = payload && payload.data;
    if(!data) return 0;
    var n = 0;
    Object.keys(data).forEach(function(k){
      if(k.indexOf(PREFIX) !== 0) return;   // 只收自己的鍵，別的一律忽略
      set(k, data[k]);
      n++;
    });
    return n;
  }

  return {
    get: get,
    set: set,
    dump: dump,
    restore: restore,
    /* "local" = 有存住；"memory" = 這個 session 關掉就沒了 */
    backend: function(){ return backend; },
    prefix: PREFIX,
    /* 啟動時的第一次對帳；app.js 要等它完成再讀資料 */
    ready: ready,
    syncEnabled: function(){ return !!syncCfg; },
    syncConfig: function(){ return syncCfg; },
    setupSync: setupSync,
    testSync: testSync,
    /* 這次開啟時從舊版搬過來幾筆（0 = 沒有舊資料） */
    migrated: function(){ return migrated; }
  };
})();
