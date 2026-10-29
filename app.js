(function(){
"use strict";

var PALETTE=["#7FA6B8","#86AE97","#C2996B","#A08BB8","#C8A84B","#6E9BC4","#C48585","#93AC7B"];
var DOW=["一","二","三","四","五","六","日"];
var SLOT=22, CFG_KEY="keystone:config", NOTE_KEY="keystone:notes", TODO_KEY="keystone:todos";
var UNCAT={id:0,name:"未分類",color:"#A8B2C4"};

/* budget＝上班總時數（舊資料沿用），budgetOff＝放假總時數 */
var cfg={budget:40,budgetOff:0,startHour:8,endHour:23,tasks:[],seq:1};
var week={blocks:[],seq:1};
var notes={items:[],cats:[],seq:1,cseq:1};
var todos={items:[],seq:1,day:""};
var todoOnce=false;
var weekStart=mondayOf(new Date());
var armed=null, drag=null, popEl=null, sorting=false;
var noteFilter="all", openNote=null, noteQuery="", focusBody=false;

function $(id){ return document.getElementById(id); }
function pad(n){ return n<10?"0"+n:""+n; }
function mondayOf(d){ var x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; }
function iso(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function addDays(d,n){ var x=new Date(d); x.setDate(x.getDate()+n); return x; }
function fmtH(n){ return (Math.round(n*10)/10).toString(); }
function slots(){ return (cfg.endHour-cfg.startHour)*2; }
function slotLabel(s){ var m=cfg.startHour*60+s*30; return pad(Math.floor(m/60)%24)+":"+pad(m%60); }
function esc(s){ return String(s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function lum(h){ var n=parseInt(h.slice(1),16); return (0.299*((n>>16)&255)+0.587*((n>>8)&255)+0.114*(n&255))/255; }

/* ── 儲存 ───────────────────────────────
   storage.js 提供 Store。它會依序嘗試：
     1. window.storage（雲端／同步後端，之後接）
     2. localStorage（這台電腦，離線可用）
     3. 記憶體（最後退路，重新整理就沒了）
   目前實際用到的是 localStorage。 */
function weekKey(){ return "keystone:w:"+iso(weekStart); }
function load(k){ return Store.get(k); }
function save(k,v){ return Store.set(k,v); }
var timer=null;
/* 啟動完成、資料真的讀進來之前一律不存。
   否則還沒載入的預設空資料（沒有項目、沒有筆記）會被當成「剛改的」存下去，
   帶著新時間戳同步出去，蓋掉雲端與另一台的真資料。 */
var loaded=false, held=false;
function saveSoon(){
  if(!loaded || held) return;
  clearTimeout(timer);
  var wk=weekKey();
  timer=setTimeout(function(){
    save(CFG_KEY,cfg); save(wk,week); save(NOTE_KEY,notes); save(TODO_KEY,todos);
  },250);
}

function doneByTask(){ var m={}; week.blocks.forEach(function(b){ m[b.taskId]=(m[b.taskId]||0)+b.len*0.5; }); return m; }
/* 沒設定過的項目一律當上班 */
function isWork(t){ return t.kind!=="off"; }
/* 上班或放假項目的每週目標時數加總 */
function plannedOf(work){
  return cfg.tasks.reduce(function(s,t){ return s+(isWork(t)===work?(t.target||0):0); },0);
}
function taskById(id){ for(var i=0;i<cfg.tasks.length;i++) if(cfg.tasks[i].id===id) return cfg.tasks[i]; return null; }
function catOf(id){
  for(var i=0;i<notes.cats.length;i++) if(notes.cats[i].id===id) return notes.cats[i];
  return UNCAT;
}

/* ── 模式切換 ─────────────────────────── */
function setView(v){
  $("app").dataset.view=v;
  document.querySelectorAll(".tab").forEach(function(b){
    var on=b.dataset.view===v;
    b.classList.toggle("on",on);
    b.setAttribute("aria-selected",on?"true":"false");
  });
  document.querySelectorAll(".dock button").forEach(function(b){ b.classList.toggle("on",b.dataset.view===v); });
  document.querySelectorAll(".view").forEach(function(p){ p.classList.toggle("on",p.id==="view-"+v); });
  closePop();
  if(v==="cal") scrollToToday();
}
document.querySelectorAll(".tab,.dock button").forEach(function(b){
  b.onclick=function(){ setView(b.dataset.view); };
});

function scrollToToday(){
  var wrap=$("calWrap");
  if(!wrap || wrap.scrollWidth<=wrap.clientWidth) return;
  var i=(new Date().getDay()+6)%7;
  var d=new Date(), inWeek = iso(mondayOf(d))===iso(weekStart);
  var cell=wrap.querySelectorAll(".calhead .dh")[inWeek?i:0];
  if(cell) wrap.scrollLeft=Math.max(0,cell.offsetLeft-wrap.clientWidth/2+cell.offsetWidth/2);
}

/* ── 頂欄 ─────────────────────────────── */
function renderHeader(){
  var end=addDays(weekStart,6);
  $("weekLabel").textContent=(weekStart.getMonth()+1)+"/"+weekStart.getDate()+" – "+(end.getMonth()+1)+"/"+end.getDate();
  $("noteMeta").textContent=notes.items.length
    ? "共 "+notes.items.length+" 則"
    : "隨時記下來的地方，分類自己管";
  var done=0; week.blocks.forEach(function(b){ done+=b.len*0.5; });
  var wp=plannedOf(true), op=plannedOf(false);
  $("doneTotal").textContent=fmtH(done);
  $("planTotal").textContent=fmtH(wp+op);
  $("planStat").classList.toggle("over",wp>cfg.budget||op>cfg.budgetOff);
  if(document.activeElement!==$("budgetVal")) $("budgetVal").value=cfg.budget;
  if(document.activeElement!==$("budgetOff")) $("budgetOff").value=cfg.budgetOff;
  var c=notes.items.length?String(notes.items.length):"";
  $("tabCount").textContent=c; $("dockCount").textContent=c;
}

/* ── 分配軌 ───────────────────────────── */
function renderRail(){
  var box=$("railBox"); box.innerHTML=""; box.style.background="";
  var wp=plannedOf(true), op=plannedOf(false);
  $("kindSum").innerHTML='<span class="kw"><i></i>上班 '+fmtH(wp)+' / '+fmtH(cfg.budget)+'h</span>'+
    '<span class="ko"><i></i>放假 '+fmtH(op)+' / '+fmtH(cfg.budgetOff)+'h</span>';
  if(!cfg.tasks.length){
    box.innerHTML='<div class="rail-empty">先在下面加入項目，這條軌會顯示時間怎麼分配。</div>';
    return;
  }
  /* 上班、放假各有自己的總時數：軌道前半是上班（項目＋未分配），後半是放假 */
  var done=doneByTask();
  var wSpan=Math.max(cfg.budget,wp), oSpan=Math.max(cfg.budgetOff,op);
  var total=Math.max(wSpan+oSpan,0.5);
  var rail=document.createElement("div"); rail.className="rail";
  /* 軌道底色：左邊是上班的藍（長度＝上班總時數的比例），往右漸層回原本的底色 */
  var wx=Math.min(wSpan/total*100,100), fade=wx+(100-wx)*0.7;
  box.style.background=wSpan>0
    ? "linear-gradient(90deg,var(--work) 0,var(--work) "+wx+"%,var(--bg) "+fade+"%)"
    : "";
  function addGroup(work,budget,plan){
    cfg.tasks.filter(function(t){ return isWork(t)===work; }).forEach(function(t){
      var tg=t.target||0, d=done[t.id]||0;
      var ratio=tg>0?Math.min(d/tg,1):(d>0?1:0);
      var seg=document.createElement("div");
      seg.className="seg"+(ratio>0.5?"":" pale")+(tg>0&&d>tg?" over":"");
      seg.style.flex=(tg>0?tg:0.4)+" 0 0";
      seg.innerHTML='<div class="fill" style="background:'+t.color+';width:'+(ratio*100)+'%"></div>'+
        '<div class="tag">'+esc(t.name)+'</div><div class="amt">'+fmtH(d)+'/'+fmtH(tg)+'</div>';
      rail.appendChild(seg);
    });
    var free=budget-plan;
    if(free>0.01){
      var fs=document.createElement("div"); fs.className="seg free"; fs.style.flex=free+" 0 0";
      fs.innerHTML='<div class="tag">未分配</div><div class="amt">'+fmtH(free)+'h</div>';
      rail.appendChild(fs);
    }
  }
  addGroup(true,cfg.budget,wp);
  addGroup(false,cfg.budgetOff,op);
  box.appendChild(rail);
  function overLine(at,over){
    var ln=document.createElement("div"); ln.className="bline";
    ln.style.left="calc(13px + (100% - 26px) * "+(at/total)+")";
    ln.innerHTML='<b>超出 '+fmtH(over)+'h</b>';
    box.appendChild(ln);
  }
  if(wp>cfg.budget+0.01) overLine(cfg.budget,wp-cfg.budget);
  if(op>cfg.budgetOff+0.01) overLine(wSpan+cfg.budgetOff,op-cfg.budgetOff);
}

/* ── 項目 ─────────────────────────────── */
function renderTasks(){
  var host=$("taskList"); host.innerHTML="";
  var done=doneByTask();
  if(!cfg.tasks.length){
    host.innerHTML='<div style="color:var(--ink-3);font-size:12.5px;padding:4px 0 8px">還沒有項目。在下面輸入名稱和每週想花的時數。</div>';
  }
  cfg.tasks.forEach(function(t,idx){
    var d=done[t.id]||0;
    var row=document.createElement("div");
    row.className="task"+(armed===t.id?" armed":"");

    var sw=document.createElement("button");
    sw.className="sw"; sw.style.background=t.color; sw.setAttribute("aria-label","換顏色"); sw.title="換顏色";
    sw.onclick=function(e){ e.stopPropagation(); openColorPop(t,e.clientX,e.clientY); };

    var main=document.createElement("div"); main.className="tmain";
    /* 唯讀時整列都是選取區；雙擊名稱才進入編輯 */
    var nm=document.createElement("input");
    nm.className="tname"; nm.value=t.name; nm.maxLength=16;
    nm.readOnly=true;
    nm.title="雙擊可改名";
    nm.oninput=function(){ t.name=nm.value; saveSoon(); renderRail(); renderCal(); };
    nm.onblur=function(){ nm.readOnly=true; };
    nm.onkeydown=function(e){ if(e.key==="Enter"||e.key==="Escape"){ nm.blur(); } };
    row.ondblclick=function(e){
      if(e.target===nm||nm.contains(e.target)||e.target.classList.contains("tmain")){
        nm.readOnly=false; nm.focus(); nm.select();
      }
    };
    var mt=document.createElement("div"); mt.className="meter";
    var mi=document.createElement("i");
    mi.style.background=t.color;
    mi.style.width=(t.target>0?Math.min(d/t.target,1)*100:(d>0?100:0))+"%";
    mt.appendChild(mi); main.appendChild(nm); main.appendChild(mt);

    var num=document.createElement("div"); num.className="tnum";
    var s1=document.createElement("span");
    s1.textContent=fmtH(d)+" / "; s1.style.color=d>0?"var(--ink)":"var(--ink-3)";
    var hi=document.createElement("input");
    hi.type="number"; hi.min="0"; hi.max="80"; hi.step="0.5"; hi.value=t.target;
    hi.onclick=function(e){ e.stopPropagation(); };
    hi.oninput=function(){
      t.target=Math.max(0,parseFloat(hi.value)||0);
      saveSoon(); renderHeader(); renderRail();
      mi.style.width=(t.target>0?Math.min(d/t.target,1)*100:(d>0?100:0))+"%";
    };
    num.appendChild(s1); num.appendChild(hi); num.appendChild(document.createTextNode(" h"));

    var del=document.createElement("button");
    del.className="tdel tedit"; del.setAttribute("aria-label","編輯項目 "+t.name); del.title="編輯";
    del.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 4.5l3 3L8 19l-4 1 1-4z"/></svg>';
    del.onclick=function(e){ e.stopPropagation(); openTaskPop(t,e.clientX,e.clientY); };

    row.appendChild(sw); row.appendChild(main);
    if(sorting){
      row.classList.add("sorting");
      var mv=document.createElement("div"); mv.className="mv";
      [["▲",-1,"上移"],["▼",1,"下移"]].forEach(function(a){
        var b=document.createElement("button");
        b.textContent=a[0]; b.setAttribute("aria-label",a[2]+" "+t.name);
        var to=idx+a[1];
        b.disabled=to<0||to>=cfg.tasks.length;
        b.onclick=function(e){
          e.stopPropagation();
          cfg.tasks.splice(to,0,cfg.tasks.splice(idx,1)[0]);
          saveSoon(); renderAll();
        };
        mv.appendChild(b);
      });
      row.appendChild(mv);
    }else{
      row.appendChild(num); row.appendChild(del);
    }
    /* 選取只切 class，不重繪清單 —— 重繪會把節點換掉，雙擊就落不到原本那一列 */
    row.onclick=function(){
      if(sorting) return;
      if(!nm.readOnly) return;            // 正在改名時不要順手取消選取
      armed=(armed===t.id?null:t.id);
      document.querySelectorAll("#taskList .task").forEach(function(r){
        r.classList.toggle("armed", r===row && armed===t.id);
      });
      renderArmed();
      if(armed && mobileQ.matches) $("taskCard").classList.remove("open");   // 選好就收起來，直接去畫
    };
    host.appendChild(row);
  });
  $("cal").classList.toggle("arm",!!armed);
  $("sortBtn").hidden=cfg.tasks.length<2;
  $("sortBtn").textContent=sorting?"完成":"調整順序";
  $("sortBtn").classList.toggle("on",sorting);
}

$("sortBtn").onclick=function(){
  sorting=!sorting;
  if(sorting) armed=null;
  renderTasks(); renderArmed();
};

/* 手機版：項目與待辦收成一列，點標題展開 */
var mobileQ=window.matchMedia("(max-width:720px)");
[["taskHead","taskCard"],["todoHead","todoCard"]].forEach(function(p){
  $(p[0]).onclick=function(){
    if(!mobileQ.matches) return;
    var open=$(p[1]).classList.toggle("open");
    $(p[0]).setAttribute("aria-expanded",open?"true":"false");
  };
});

/* 手機版：備份、同步等按鈕收在右上角的設定鈕 */
function toggleTools(on){
  var tl=$("tools"), g=$("gearBtn");
  if(on===undefined) on=!tl.classList.contains("open");
  if(on) tl.style.top=(g.getBoundingClientRect().bottom+8)+"px";
  tl.classList.toggle("open",on);
  g.classList.toggle("on",on);
  g.setAttribute("aria-expanded",on?"true":"false");
}
$("gearBtn").onclick=function(e){ e.stopPropagation(); toggleTools(); };
$("tools").addEventListener("click",function(e){ if(e.target.tagName==="BUTTON") toggleTools(false); });
document.addEventListener("click",function(e){ if(!$("tools").contains(e.target)) toggleTools(false); });
window.addEventListener("scroll",function(){ toggleTools(false); },{passive:true});

/* 項目顏色：點色點展開一排，一次選定。最後一格可自訂 */
var PICK=PALETTE.concat(["#D4A5A5","#9AA5C8","#7FB5B0","#D9A066","#B58DAA","#8C9BA8","#B8B27A","#C9788E"]);
function openColorPop(t,x,y){
  closePop();
  var p=document.createElement("div");
  p.className="pop";
  p.innerHTML='<div class="pn"><i style="background:'+t.color+'"></i>'+esc(t.name)+'</div><div class="swgrid"></div>';
  var grid=p.querySelector(".swgrid");
  function apply(c){ t.color=c; saveSoon(); renderAll(); closePop(); }
  PICK.forEach(function(c){
    var b=document.createElement("button");
    b.className="swc"+(c.toLowerCase()===String(t.color).toLowerCase()?" on":"");
    b.style.background=c; b.setAttribute("aria-label","選用顏色 "+c);
    b.onclick=function(){ apply(c); };
    grid.appendChild(b);
  });
  var cu=document.createElement("label");
  cu.className="swc custom"; cu.title="自訂顏色";
  cu.innerHTML='<input type="color" aria-label="自訂顏色">';
  cu.querySelector("input").value=/^#[0-9a-f]{6}$/i.test(t.color)?t.color:"#7FA6B8";
  cu.querySelector("input").onchange=function(e){ apply(e.target.value); };
  grid.appendChild(cu);
  document.body.appendChild(p);
  var w=p.offsetWidth,h=p.offsetHeight;
  p.style.left=Math.max(10,Math.min(window.innerWidth-w-10,x-w/2))+"px";
  p.style.top=(y+h+16>window.innerHeight?Math.max(10,y-h-12):y+12)+"px";
  p.addEventListener("pointerdown",function(ev){ ev.stopPropagation(); });
  popEl=p;
}

/* 項目的「編輯」視窗：改上班／放假，或刪除 */
function openTaskPop(t,x,y){
  closePop();
  var p=document.createElement("div");
  p.className="pop";
  p.innerHTML='<div class="pn"><i style="background:'+t.color+'"></i>'+esc(t.name)+'</div>'+
    '<div class="pt">這項算哪一種時間？</div>'+
    '<div class="dur"><button data-k="work">上班</button><button data-k="off">放假</button></div>'+
    '<div class="pacts"><button class="danger" data-act="del">刪除項目</button><button data-act="close">關閉</button></div>';
  document.body.appendChild(p);
  var w=p.offsetWidth,h=p.offsetHeight;
  p.style.left=Math.max(10,Math.min(window.innerWidth-w-10,x-w/2))+"px";
  p.style.top=(y+h+16>window.innerHeight?Math.max(10,y-h-12):y+12)+"px";
  p.addEventListener("pointerdown",function(ev){ ev.stopPropagation(); });
  p.querySelectorAll("[data-k]").forEach(function(btn){
    btn.classList.toggle("on",(btn.dataset.k==="work")===isWork(t));
    btn.onclick=function(){ t.kind=btn.dataset.k; saveSoon(); renderAll(); closePop(); };
  });
  p.querySelector('[data-act="del"]').onclick=function(){
    var nb=week.blocks.filter(function(b){ return b.taskId===t.id; }).length;
    var msg="刪除項目「"+t.name+"」？";
    if(nb) msg+="\n本週 "+nb+" 個色塊會一併移除。";
    if(!confirm(msg)) return;
    cfg.tasks=cfg.tasks.filter(function(v){ return v.id!==t.id; });
    week.blocks=week.blocks.filter(function(b){ return b.taskId!==t.id; });
    if(armed===t.id) armed=null;
    saveSoon(); renderAll(); closePop();
  };
  p.querySelector('[data-act="close"]').onclick=closePop;
  popEl=p;
}

function renderArmed(){
  var n=$("armedNote"), t=armed?taskById(armed):null;
  $("taskSum").textContent=t?"正在畫 · "+t.name:(cfg.tasks.length?cfg.tasks.length+" 個項目 · 點開選一個":"還沒有項目");
  if(t){
    n.className="note-armed";
    n.innerHTML='正在畫 <b>'+esc(t.name)+'</b>。在週曆上按住往下拖，放開就完成紀錄。再點一次可取消。';
  }else{
    n.className="note-armed idle";
    n.textContent="尚未選取項目。點任一項目，就能在週曆上畫出實際花掉的時間。";
  }
  $("cal").classList.toggle("arm",!!armed);
}

/* ── 今日待辦 ─────────────────────────── */
/* 跨日：勾選全部清空（浮起來），只做一次的已完成項目自動消失 */
function rollover(){
  var today=iso(new Date());
  if(todos.day===today) return false;
  var fresh=todos.day!=="";
  todos.items=todos.items.filter(function(t){ return !(t.once&&t.done&&fresh); });
  todos.items.forEach(function(t){ t.done=false; });
  todos.day=today;
  saveSoon();
  return true;
}

function renderTodos(){
  var host=$("todoList"); host.innerHTML="";
  var d=new Date();
  var done=todos.items.filter(function(t){ return t.done; }).length;
  $("todoDate").textContent=(d.getMonth()+1)+"/"+d.getDate()+" 週"+DOW[(d.getDay()+6)%7]+
    (todos.items.length?" · "+done+"/"+todos.items.length:"");

  if(!todos.items.length){
    host.innerHTML='<div class="todo-empty">還沒有待辦。<br>加進來的事每天早上都會重新浮起來等你勾。</div>';
    return;
  }
  todos.items.forEach(function(t){
    var row=document.createElement("div");
    row.className="todo"+(t.done?" done":"");
    row.setAttribute("role","checkbox");
    row.setAttribute("aria-checked",t.done?"true":"false");
    row.tabIndex=0;

    var box=document.createElement("span");
    box.className="box";
    box.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 6.5"/></svg>';

    var tx=document.createElement("span");
    tx.className="txt"; tx.textContent=t.text;

    row.appendChild(box); row.appendChild(tx);
    if(t.once){
      var o=document.createElement("span"); o.className="once"; o.textContent="單次";
      row.appendChild(o);
    }

    var del=document.createElement("button");
    del.className="tdel"; del.textContent="×"; del.setAttribute("aria-label","刪除待辦 "+t.text);
    del.onclick=function(e){
      e.stopPropagation();
      todos.items=todos.items.filter(function(x){ return x.id!==t.id; });
      saveSoon(); renderTodos();
    };
    row.appendChild(del);

    function toggle(){ t.done=!t.done; saveSoon(); renderTodos(); }
    row.onclick=toggle;
    row.onkeydown=function(e){ if(e.key===" "||e.key==="Enter"){ e.preventDefault(); toggle(); } };
    host.appendChild(row);
  });
}

document.querySelectorAll(".modebtn").forEach(function(b){
  b.onclick=function(){
    todoOnce=b.dataset.once==="1";
    document.querySelectorAll(".modebtn").forEach(function(x){ x.classList.toggle("on",x===b); });
    $("newTodo").focus({preventScroll:true});
  };
});
$("addTodo").onclick=function(){
  var v=$("newTodo").value.trim();
  if(!v){ $("newTodo").focus(); return; }
  todos.items.push({id:todos.seq++,text:v,done:false,once:todoOnce});
  $("newTodo").value="";
  saveSoon(); renderTodos(); $("newTodo").focus();
};
$("newTodo").addEventListener("keydown",function(e){ if(e.key==="Enter") $("addTodo").click(); });

/* 開著過午夜也會自己翻頁 */
function watchDay(){ if(loaded && rollover()) renderTodos(); }
setInterval(watchDay,30000);
document.addEventListener("visibilitychange",function(){ if(!document.hidden) watchDay(); });
window.addEventListener("focus",watchDay);

/* ── 週曆 ─────────────────────────────── */
function renderCalHead(){
  var head=$("calHead");
  head.innerHTML='<div class="gutspace"></div>';
  var today=iso(new Date()), per=[0,0,0,0,0,0,0];
  week.blocks.forEach(function(b){ per[b.day]+=b.len*0.5; });
  for(var i=0;i<7;i++){
    var d=addDays(weekStart,i);
    var el=document.createElement("div");
    el.className="dh"+(iso(d)===today?" today":"");
    el.innerHTML='<span class="dw">'+DOW[i]+'</span><span class="dd">'+(d.getMonth()+1)+"/"+d.getDate()+
      '</span><span class="dq">'+(per[i]>0?fmtH(per[i])+"h":"")+'</span>';
    head.appendChild(el);
  }
}

function lanes(list){
  var sorted=list.slice().sort(function(a,b){ return a.start-b.start||a.len-b.len; });
  var out=[],cl=[],end=-1;
  function flush(){
    if(!cl.length) return;
    var le=[];
    cl.forEach(function(b){ var k=0; while(k<le.length&&le[k]>b.start) k++; le[k]=b.start+b.len; b._lane=k; });
    cl.forEach(function(b){ b._lanes=le.length; out.push(b); });
    cl=[];
  }
  sorted.forEach(function(b){
    if(cl.length&&b.start>=end){ flush(); end=-1; }
    cl.push(b); end=Math.max(end,b.start+b.len);
  });
  flush();
  return out;
}

function renderCal(){
  renderCalHead();
  var body=$("calBody"); body.innerHTML="";
  var n=slots(), H=n*SLOT;

  var gut=document.createElement("div");
  gut.className="gut"; gut.style.height=(H+14)+"px"; gut.style.position="sticky";
  for(var h=cfg.startHour;h<=cfg.endHour;h++){
    var l=document.createElement("div");
    l.className="hr"; l.style.top=(7+(h-cfg.startHour)*2*SLOT)+"px";
    l.textContent=pad(h%24)+":00";
    gut.appendChild(l);
  }
  body.appendChild(gut);

  for(var i=0;i<7;i++){
    var well=document.createElement("div");
    well.className="well"+(i>=5?" wknd":"");
    well.style.height=(H+14)+"px";
    var col=document.createElement("div");
    col.className="daycol"; col.dataset.day=i; col.style.height=H+"px";
    for(var s=1;s<n;s++){
      var ln=document.createElement("div");
      ln.className="hl"+(s%2===0?" hour":"");
      ln.style.top=(s*SLOT)+"px";
      col.appendChild(ln);
    }
    lanes(week.blocks.filter(function(b){ return b.day===i; })).forEach(function(b){
      var t=taskById(b.taskId); if(!t) return;
      var el=document.createElement("div");
      el.className="blk"; el.dataset.id=b.id;
      el.style.top=(b.start*SLOT)+"px";
      el.style.height=(b.len*SLOT-3)+"px";
      el.style.background=t.color;
      var w=100/(b._lanes||1);
      el.style.left=(w*b._lane)+"%";
      el.style.width="calc("+w+"% - 3px)";
      if(lum(t.color)>0.72) el.style.color="#49536A";
      /* 備註接在時間下面，高度放得下幾行就顯示幾行 */
      var lines=Math.floor((b.len*SLOT-3-10-14-(b.len>=2?11:0))/12.5);
      el.innerHTML='<span class="bn">'+esc(t.name)+'</span>'+
        (b.len>=2?'<span class="bt">'+slotLabel(b.start)+'–'+slotLabel(b.start+b.len)+'</span>':'')+
        (b.note&&b.len>=2&&lines>=1?'<span class="bm" style="-webkit-line-clamp:'+lines+'">'+esc(b.note)+'</span>':'');
      el.title=t.name+" · "+fmtH(b.len*0.5)+"h"+(b.note?"\n"+b.note:"");
      col.appendChild(el);
    });
    well.appendChild(col);
    body.appendChild(well);
  }

  if(!week.blocks.length){
    var hint=document.createElement("div");
    hint.className="calempty";
    hint.textContent=armed?"在任一天按住往下拖，放開就完成紀錄。"
      :"本週還沒有紀錄。\n先選一個項目，再到這裡拖出實際花掉的時間。";
    body.appendChild(hint);
  }
}

/* ── 筆記 ─────────────────────────────── */
function renderNoteCats(){
  var sel=$("nCat"), keep=sel.value;
  sel.innerHTML="";
  notes.cats.forEach(function(c){
    var o=document.createElement("option"); o.value=c.id; o.textContent=c.name; sel.appendChild(o);
  });
  var o0=document.createElement("option"); o0.value="0"; o0.textContent="未分類"; sel.appendChild(o0);
  sel.value=(keep&&sel.querySelector('option[value="'+keep+'"]'))?keep:(notes.cats.length?notes.cats[0].id:"0");
  syncDot();
}
function syncDot(){ $("nDot").style.background=catOf(+$("nCat").value).color; }

function setCatPanel(open){
  $("catPanel").hidden=!open;
  $("nDot").classList.toggle("open",open);
  $("nDot").setAttribute("aria-expanded",open?"true":"false");
  if(open){ renderCatList(); $("newCat").focus({preventScroll:true}); }
}
$("nDot").onclick=function(){ setCatPanel($("catPanel").hidden); };
$("catDone").onclick=function(){ setCatPanel(false); $("nCat").focus({preventScroll:true}); };

function renderCatList(){
  var host=$("catList"); host.innerHTML="";
  if(!notes.cats.length){
    host.innerHTML='<div style="color:var(--ink-3);font-size:12.5px;padding:4px 0 8px">還沒有分類。筆記會先歸在「未分類」。</div>';
  }
  notes.cats.forEach(function(c){
    var used=notes.items.filter(function(n){ return n.cat===c.id; }).length;
    var row=document.createElement("div");
    row.className="crow";

    var sw=document.createElement("button");
    sw.className="sw"; sw.style.background=c.color; sw.setAttribute("aria-label","換顏色"); sw.title="換顏色";
    sw.onclick=function(){
      c.color=PALETTE[(PALETTE.indexOf(c.color)+1)%PALETTE.length];
      saveSoon(); syncDot(); renderCatList(); renderFilters(); renderNotes();
    };

    var nm=document.createElement("input");
    nm.className="cname"; nm.value=c.name; nm.maxLength=12;
    nm.readOnly=true; nm.title="點一下可改名";
    nm.onclick=function(){ nm.readOnly=false; nm.focus(); nm.select(); };
    nm.onblur=function(){ nm.readOnly=true; };
    nm.onkeydown=function(e){ if(e.key==="Enter"||e.key==="Escape") nm.blur(); };
    nm.oninput=function(){
      c.name=nm.value; saveSoon();
      renderFilters(); renderNotes();
    };

    var cn=document.createElement("span");
    cn.className="cn"; cn.textContent=used?used+" 則":"";

    var del=document.createElement("button");
    del.className="tdel"; del.textContent="×"; del.setAttribute("aria-label","刪除分類 "+c.name);
    del.onclick=function(){
      var msg="刪除分類「"+c.name+"」？";
      if(used) msg+="\n底下 "+used+" 則筆記會改成未分類，不會被刪掉。";
      if(!confirm(msg)) return;
      notes.cats=notes.cats.filter(function(x){ return x.id!==c.id; });
      notes.items.forEach(function(n){ if(n.cat===c.id) n.cat=0; });
      if(noteFilter===c.id) noteFilter="all";
      saveSoon(); renderHeader(); renderNoteCats(); renderCatList(); renderFilters(); renderNotes();
    };

    row.appendChild(sw); row.appendChild(nm); row.appendChild(cn); row.appendChild(del);
    host.appendChild(row);
  });

  var un=notes.items.filter(function(n){ return !n.cat; }).length;
  var fixed=document.createElement("div");
  fixed.className="crow fixed";
  fixed.innerHTML='<span class="sw" style="background:'+UNCAT.color+'"></span>'+
    '<span class="cname">未分類</span><span class="cn">'+(un?un+" 則":"")+'</span>';
  fixed.title="固定分類，不能刪除";
  host.appendChild(fixed);
}

$("addCat").onclick=function(){
  var name=$("newCat").value.trim();
  if(!name){ $("newCat").focus(); return; }
  var c={id:notes.cseq++,name:name,color:PALETTE[notes.cats.length%PALETTE.length]};
  notes.cats.push(c);
  $("newCat").value="";
  saveSoon();
  renderNoteCats(); $("nCat").value=String(c.id); syncDot();
  renderCatList(); renderFilters(); $("newCat").focus();
};
$("newCat").addEventListener("keydown",function(e){ if(e.key==="Enter") $("addCat").click(); });

function renderFilters(){
  var host=$("noteFilters"); host.innerHTML="";
  function chip(key,label,color){
    var b=document.createElement("button");
    b.className="chip"+(noteFilter===key?" on":"");
    b.innerHTML=(color?'<i style="background:'+color+'"></i>':'')+esc(label);
    b.onclick=function(){ noteFilter=key; renderFilters(); renderNotes(); };
    host.appendChild(b);
  }
  chip("all","全部 "+notes.items.length,null);
  notes.cats.forEach(function(ct){
    var c=notes.items.filter(function(n){ return n.cat===ct.id; }).length;
    if(c) chip(ct.id,ct.name+" "+c,ct.color);
  });
  var un=notes.items.filter(function(n){ return !n.cat; }).length;
  if(un) chip(0,"未分類 "+un,UNCAT.color);
}

function noteDate(ts){
  var d=new Date(ts), now=new Date();
  return (d.getFullYear()!==now.getFullYear() ? d.getFullYear()+"/" : "")+
    (d.getMonth()+1)+"/"+d.getDate()+" "+pad(d.getHours())+":"+pad(d.getMinutes());
}

/* 搜尋：空白分隔的每個關鍵字都要出現在標題或內文裡（不分大小寫） */
function matchNote(n,q){
  if(!q) return true;
  var hay=(n.title+"\n"+(n.body||"")).toLowerCase();
  return q.toLowerCase().split(/\s+/).every(function(w){ return !w || hay.indexOf(w)>=0; });
}

function growArea(ta){ ta.style.height="auto"; ta.style.height=(ta.scrollHeight+2)+"px"; }

function renderNotes(){
  var host=$("noteList"); host.innerHTML="";
  var list=notes.items.slice().sort(function(a,b){ return b.ts-a.ts; });
  if(noteFilter!=="all") list=list.filter(function(n){ return (n.cat||0)===noteFilter; });
  list=list.filter(function(n){ return matchNote(n,noteQuery); });

  if(!list.length){
    var e=document.createElement("div");
    e.className="nempty";
    e.textContent=!notes.items.length?"還沒有任何筆記。\n填標題、選分類，就能把想法存下來。"
      :noteQuery?"找不到符合「"+noteQuery+"」的筆記。":"這個分類還沒有筆記。";
    host.appendChild(e);
    return;
  }
  var focusTa=null;
  list.forEach(function(nt){
    var c=catOf(nt.cat||0);
    var card=document.createElement("div");
    var open=openNote===nt.id;
    card.className="ncard"+(open?" open":"");
    card.dataset.id=nt.id;

    if(!open){
      /* 收合：只露出預覽，點一下展開 */
      card.tabIndex=0; card.setAttribute("role","button");
      card.innerHTML='<div class="bar" style="background:'+c.color+'"></div>'+
        '<div class="top"><h4>'+esc(nt.title)+'</h4><span class="cat">'+esc(c.name)+'</span></div>'+
        (nt.body?'<div class="body">'+esc(nt.body)+'</div>':'')+
        '<div class="foot"><span>'+noteDate(nt.ts)+'</span></div>';
      var expand=function(){ openNote=nt.id; focusBody=true; renderNotes(); };
      card.onclick=expand;
      card.onkeydown=function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); expand(); } };
      host.appendChild(card);
      return;
    }

    /* 展開：標題、分類、內文都直接可改，輸入就存，不用按編輯 */
    card.innerHTML='<div class="bar" style="background:'+c.color+'"></div>'+
      '<div class="top"><input class="ntitle" maxlength="60" aria-label="標題"><select class="ncatsel" aria-label="分類"></select></div>'+
      '<textarea class="nbody" aria-label="內容" placeholder="還沒有內容，直接在這裡寫"></textarea>'+
      '<div class="foot"><span>'+noteDate(nt.ts)+'</span><span class="sp"></span>'+
      '<button data-a="close">收起</button><button class="del" data-a="del">刪除</button></div>';

    var ti=card.querySelector(".ntitle"), sel=card.querySelector(".ncatsel"), ta=card.querySelector(".nbody");
    ti.value=nt.title; ta.value=nt.body||"";
    notes.cats.concat([UNCAT]).forEach(function(ct){
      var o=document.createElement("option"); o.value=ct.id; o.textContent=ct.name; sel.appendChild(o);
    });
    sel.value=String(nt.cat||0);

    /* 以下都只改資料和局部畫面，不重繪清單，輸入中的游標才不會被洗掉 */
    ti.oninput=function(){ var v=ti.value.trim(); if(v){ nt.title=v; saveSoon(); } };
    ti.onblur=function(){ if(!ti.value.trim()) ti.value=nt.title; };   // 標題不能空，清空就還原
    ta.oninput=function(){ nt.body=ta.value; saveSoon(); growArea(ta); };
    sel.onchange=function(){
      nt.cat=parseInt(sel.value,10)||0;
      card.querySelector(".bar").style.background=catOf(nt.cat).color;
      saveSoon(); renderFilters();
    };
    card.querySelector('[data-a="close"]').onclick=function(){ openNote=null; renderNotes(); };
    card.querySelector('[data-a="del"]').onclick=function(){
      if(!confirm("刪除筆記「"+nt.title+"」？")) return;
      notes.items=notes.items.filter(function(x){ return x.id!==nt.id; });
      openNote=null;
      saveSoon(); renderHeader(); renderFilters(); renderNotes();
    };
    host.appendChild(card);
    focusTa=ta;
  });
  if(focusTa){
    growArea(focusTa);
    /* 只有「剛點開」才把游標放進內文；改分類名稱之類的重繪不能搶走別處的游標 */
    if(focusBody){
      focusTa.focus({preventScroll:true});
      focusTa.setSelectionRange(focusTa.value.length,focusTa.value.length);
    }
  }
  focusBody=false;
}

$("noteSearch").oninput=function(){ noteQuery=$("noteSearch").value.trim(); renderNotes(); };

function resetForm(){
  setCatPanel(false);
  $("nTitle").value=""; $("nBody").value="";
}

$("nCat").onchange=syncDot;
$("nSave").onclick=function(){
  var title=$("nTitle").value.trim();
  if(!title){ $("nTitle").focus(); return; }
  var cat=parseInt($("nCat").value,10)||0;
  var body=$("nBody").value.trim();
  var id=notes.seq++;
  notes.items.push({id:id,title:title,cat:cat,body:body,ts:Date.now()});
  /* 新加的筆記要看得到：清掉搜尋與分類篩選 */
  noteQuery=""; $("noteSearch").value=""; noteFilter="all";
  resetForm(); saveSoon(); renderHeader(); renderFilters(); renderNotes();
};
$("nTitle").addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); $("nBody").focus(); } });

/* ── 拖曳 ─────────────────────────────── */
function slotAt(col,y){
  var r=col.getBoundingClientRect();
  return Math.max(0,Math.min(slots()-1,Math.floor((y-r.top)/SLOT)));
}
function colAt(x,y){
  var el=document.elementFromPoint(x,y);
  if(!el) return null;
  var c=el.closest(".daycol");
  if(c) return c;
  var w=el.closest(".well");
  return w?w.querySelector(".daycol"):null;
}
function colIn(target){
  var c=target.closest(".daycol");
  if(c) return c;
  var w=target.closest(".well");
  return w?w.querySelector(".daycol"):null;
}

$("calBody").addEventListener("pointerdown",function(e){
  closePop();
  var be=e.target.closest(".blk");
  var col=colIn(e.target);
  if(!col) return;
  if(be){
    var b=week.blocks.filter(function(x){ return x.id===+be.dataset.id; })[0];
    if(!b) return;
    drag={mode:"move",id:b.id,el:be,x0:e.clientX,y0:e.clientY,start0:b.start,moved:false};
    e.preventDefault(); return;
  }
  if(!armed) return;
  var s=slotAt(col,e.clientY), t=taskById(armed);
  var g=document.createElement("div");
  g.className="ghost"; g.style.background=t.color;
  g.style.left="0"; g.style.right="3px";
  g.style.top=(s*SLOT)+"px"; g.style.height=(SLOT-3)+"px";
  col.appendChild(g);
  drag={mode:"paint",day:+col.dataset.day,anchor:s,cur:s,ghost:g,col:col};
  e.preventDefault();
});

window.addEventListener("pointermove",function(e){
  if(!drag) return;
  if(drag.mode==="paint"){
    var col=colAt(e.clientX,e.clientY)||drag.col;
    if(+col.dataset.day!==drag.day){ drag.day=+col.dataset.day; col.appendChild(drag.ghost); drag.col=col; }
    drag.cur=slotAt(drag.col,e.clientY);
    var a=Math.min(drag.anchor,drag.cur), len=Math.abs(drag.cur-drag.anchor)+1;
    drag.ghost.style.top=(a*SLOT)+"px";
    drag.ghost.style.height=(len*SLOT-3)+"px";
  }else{
    var dx=e.clientX-drag.x0, dy=e.clientY-drag.y0;
    if(!drag.moved&&Math.abs(dx)+Math.abs(dy)<6) return;
    drag.moved=true;
    var b=week.blocks.filter(function(x){ return x.id===drag.id; })[0];
    var c2=colAt(e.clientX,e.clientY);
    if(c2) b.day=+c2.dataset.day;
    b.start=Math.max(0,Math.min(slots()-b.len,drag.start0+Math.round(dy/SLOT)));
    renderCal();
    drag.el=document.querySelector('.blk[data-id="'+drag.id+'"]');
    if(drag.el) drag.el.classList.add("dragging");
  }
},{passive:true});

window.addEventListener("pointerup",function(e){
  if(!drag) return;
  if(drag.mode==="paint"){
    var a=Math.min(drag.anchor,drag.cur), len=Math.abs(drag.cur-drag.anchor)+1;
    if(drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    week.blocks.push({id:week.seq++,taskId:armed,day:drag.day,start:a,len:len});
    drag=null; saveSoon(); renderAll(); return;
  }
  var moved=drag.moved, id=drag.id;
  if(drag.el) drag.el.classList.remove("dragging");
  drag=null;
  if(moved){ saveSoon(); renderAll(); }
  else openPop(id,e.clientX,e.clientY);
});
window.addEventListener("pointercancel",function(){
  if(drag&&drag.mode==="paint"&&drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
  if(drag&&drag.el) drag.el.classList.remove("dragging");
  drag=null;
});

/* ── 色塊視窗 ─────────────────────────── */
function closePop(){ if(popEl){ popEl.remove(); popEl=null; } }
function openPop(id,x,y){
  closePop();
  var b=week.blocks.filter(function(v){ return v.id===id; })[0];
  if(!b) return;
  var t=taskById(b.taskId);
  var p=document.createElement("div");
  p.className="pop";
  p.innerHTML='<div class="pn"><i style="background:'+t.color+'"></i>'+esc(t.name)+'</div>'+
    '<div class="pt">'+slotLabel(b.start)+'–'+slotLabel(b.start+b.len)+' · '+fmtH(b.len*0.5)+' 小時</div>'+
    '<textarea class="pnote" rows="2" maxlength="120" placeholder="這段時間做了什麼？備註會顯示在色塊上"></textarea>'+
    '<div class="dur"><button data-d="-1">− 30m</button><button data-d="1">+ 30m</button></div>'+
    '<div class="pacts"><button class="danger" data-act="del">刪除</button><button data-act="close">關閉</button></div>';
  document.body.appendChild(p);
  var w=p.offsetWidth,h=p.offsetHeight;
  p.style.left=Math.max(10,Math.min(window.innerWidth-w-10,x-w/2))+"px";
  p.style.top=(y+h+16>window.innerHeight?Math.max(10,y-h-12):y+12)+"px";
  p.addEventListener("pointerdown",function(ev){ ev.stopPropagation(); });
  var ta=p.querySelector(".pnote");
  ta.value=b.note||"";
  ta.oninput=function(){
    var v=ta.value.trim();
    if(v) b.note=v; else delete b.note;
    saveSoon(); renderCal();
  };
  ta.onkeydown=function(e){ if(e.key==="Escape") closePop(); };
  p.querySelectorAll("[data-d]").forEach(function(btn){
    btn.onclick=function(){
      b.len=Math.max(1,Math.min(slots()-b.start,b.len+(+btn.dataset.d)));
      saveSoon(); renderAll(); closePop();
    };
  });
  p.querySelector('[data-act="del"]').onclick=function(){
    week.blocks=week.blocks.filter(function(v){ return v.id!==id; });
    saveSoon(); renderAll(); closePop();
  };
  p.querySelector('[data-act="close"]').onclick=closePop;
  popEl=p;
}
window.addEventListener("pointerdown",function(e){ if(popEl&&!e.target.closest(".pop")) closePop(); });
window.addEventListener("keydown",function(e){
  if(e.key==="Escape"){
    closePop();
    if(!$("catPanel").hidden) setCatPanel(false);
    if(armed){ armed=null; renderTasks(); renderArmed(); }
  }
});

/* ── 控制項 ───────────────────────────── */
$("addTask").onclick=function(){
  var name=$("newName").value.trim();
  if(!name){ $("newName").focus(); return; }
  var hrs=parseFloat($("newHours").value);
  cfg.tasks.push({id:cfg.seq++,name:name,target:isNaN(hrs)?0:Math.max(0,hrs),color:PALETTE[cfg.tasks.length%PALETTE.length]});
  $("newName").value=""; $("newHours").value="";
  armed=cfg.tasks[cfg.tasks.length-1].id;
  saveSoon(); renderAll(); $("newName").focus();
};
$("newName").addEventListener("keydown",function(e){ if(e.key==="Enter") $("addTask").click(); });
$("newHours").addEventListener("keydown",function(e){ if(e.key==="Enter") $("addTask").click(); });

$("budgetVal").oninput=function(){
  cfg.budget=Math.max(0,parseFloat($("budgetVal").value)||0);
  saveSoon(); renderHeader(); renderRail();
};
$("budgetOff").oninput=function(){
  cfg.budgetOff=Math.max(0,parseFloat($("budgetOff").value)||0);
  saveSoon(); renderHeader(); renderRail();
};

/* 舊版筆記的分類是週曆項目，搬家時複製成筆記自己的分類 */
function catFromTask(taskId){
  if(!taskId) return 0;
  var t=taskById(taskId);
  if(!t) return 0;
  for(var i=0;i<notes.cats.length;i++) if(notes.cats[i].name===t.name) return notes.cats[i].id;
  var c={id:notes.cseq++,name:t.name,color:t.color};
  notes.cats.push(c);
  return c.id;
}

/* 把舊版存在該週裡的筆記搬進全域清單 */
function normalizeWeek(){
  if(!week.blocks) week.blocks=[];
  if(!week.seq) week.seq=(week.blocks.reduce(function(m,b){ return Math.max(m,b.id); },0)||0)+1;
  if(week.notes && week.notes.length){
    week.notes.forEach(function(n){
      notes.items.push({id:notes.seq++,title:n.title,cat:catFromTask(n.cat),body:n.body||"",ts:n.ts||Date.now()});
    });
    delete week.notes; delete week.nseq;
    saveSoon();
  }else{ delete week.notes; delete week.nseq; }
}
async function goWeek(d){
  weekStart=mondayOf(d);
  week=(await load(weekKey()))||{blocks:[],seq:1};
  normalizeWeek(); closePop();
  renderAll(); scrollToToday();
}
$("prevWeek").onclick=function(){ goWeek(addDays(weekStart,-7)); };
$("nextWeek").onclick=function(){ goWeek(addDays(weekStart,7)); };
$("thisWeek").onclick=function(){ goWeek(new Date()); };

function fillRange(){
  var a=$("startSel"), b=$("endSel");
  a.innerHTML=""; b.innerHTML="";
  for(var h=0;h<=23;h++){ var o=document.createElement("option"); o.value=h; o.textContent=pad(h)+":00"; a.appendChild(o); }
  for(var k=1;k<=24;k++){ var o2=document.createElement("option"); o2.value=k; o2.textContent=pad(k%24)+":00"; b.appendChild(o2); }
  a.value=cfg.startHour; b.value=cfg.endHour;
}
$("startSel").onchange=function(){
  var v=+$("startSel").value;
  if(v>=cfg.endHour){ $("startSel").value=cfg.startHour; return; }
  cfg.startHour=v; saveSoon(); renderCal();
};
$("endSel").onchange=function(){
  var v=+$("endSel").value;
  if(v<=cfg.startHour){ $("endSel").value=cfg.endHour; return; }
  cfg.endHour=v; saveSoon(); renderCal();
};

$("exportBtn").onclick=function(){
  var payload=Store.dump();
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  var a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="keystone-backup-"+iso(new Date())+".json";
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); },1000);
};
$("importBtn").onclick=function(){ $("importFile").click(); };
$("importFile").onchange=function(){
  var f=$("importFile").files[0];
  if(!f) return;
  var fr=new FileReader();
  fr.onload=function(){
    var payload;
    try{ payload=JSON.parse(fr.result); }
    catch(e){ alert("這個檔案不是 Keystone 的備份，讀不出來。"); return; }
    if(!payload || payload.app!=="keystone"){ alert("這個檔案不是 Keystone 的備份。"); return; }
    if(!confirm("用備份覆蓋現在的資料？\n目前所有紀錄會被取代。")) return;
    var n=Store.restore(payload);
    alert("還原了 "+n+" 筆資料，現在重新載入。");
    location.reload();
  };
  fr.readAsText(f);
  $("importFile").value="";
};

$("syncBtn").onclick=function(){
  var cur=Store.syncConfig();
  var url=prompt("同步網址（Worker 的網址）。\n留空按確定＝關掉同步。",cur?cur.url:"");
  if(url===null) return;
  url=url.trim();
  if(!url){
    if(!Store.syncEnabled()) return;
    if(!confirm("關掉同步？這台裝置的資料會保留，只是不再跟雲端互通。")) return;
    Store.setupSync("","");
    location.reload();
    return;
  }
  var token=prompt("同步密碼（部署 Worker 時設的 TOKEN）：",cur?cur.token:"");
  if(!token) return;
  token=token.trim();
  Store.testSync(url,token).then(function(){
    Store.setupSync(url,token);
    alert("連上了。現在重新載入，會先跟雲端對一次資料。");
    location.reload();
  },function(e){
    alert(e&&e.message==="token"?"密碼不對，連得到但被擋下來。":"連不上這個網址，檢查一下有沒有打錯。");
  });
};

$("undoSyncBtn").onclick=function(){
  var list=Store.backups?Store.backups():[];
  if(!list.length){ alert("這台沒有被同步蓋掉的備份。\n（只有更新到這個版本之後才開始備份。）"); return; }
  var lines=list.map(function(s,i){
    var d=new Date(s.at);
    return (i+1)+". "+(d.getMonth()+1)+"/"+d.getDate()+" "+pad(d.getHours())+":"+pad(d.getMinutes())+"　"+Object.keys(s.data).length+" 筆";
  });
  var pick=prompt("同步時，這台原本的資料被雲端蓋掉過，留了這幾份：\n"+lines.join("\n")+"\n\n輸入編號，用那一份還原：","1");
  if(pick===null) return;
  var i=parseInt(pick,10)-1;
  if(!(i>=0&&i<list.length)){ alert("沒有這個編號。"); return; }
  if(!confirm("用第 "+(i+1)+" 份還原？現在的資料會被取代，並同步到雲端。")) return;
  var n=Store.restoreBackup(i);
  alert("還原了 "+n+" 筆，現在重新載入。");
  setTimeout(function(){ location.reload(); },900);   // 等還原的資料先送上雲端
};

$("clearBtn").onclick=function(){
  if(!week.blocks.length) return;
  if(!confirm("清空本週所有色塊？項目設定與筆記會保留。")) return;
  week.blocks=[]; saveSoon(); renderAll();
};

$("copyBtn").onclick=function(){
  var end=addDays(weekStart,6);
  var L=["本週時間帳 "+iso(weekStart)+" ~ "+iso(end),""];
  var done=doneByTask(), got={true:0,false:0};
  [true,false].forEach(function(work){
    var rows=cfg.tasks.filter(function(t){ return isWork(t)===work; });
    if(!rows.length) return;
    L.push("【"+(work?"上班":"放假")+"】");
    rows.forEach(function(t){
      var d=done[t.id]||0; got[work]+=d;
      L.push(t.name+"　"+fmtH(d)+" / "+fmtH(t.target)+" h");
    });
    L.push("小計 "+fmtH(got[work])+" / "+fmtH(work?cfg.budget:cfg.budgetOff)+" h","");
  });
  L.push("合計 "+fmtH(got[true]+got[false])+" / "+fmtH(cfg.budget+cfg.budgetOff)+" h");
  var txt=L.join("\n");
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){ flash($("copyBtn"),"已複製"); },function(){ alert(txt); });
  }else alert(txt);
};
function flash(b,m){ var o=b.textContent; b.textContent=m; setTimeout(function(){ b.textContent=o; },1400); }

function renderAll(){
  renderHeader(); renderRail(); renderTasks(); renderArmed(); renderCal(); renderTodos();
  renderNoteCats(); renderCatList(); renderFilters(); renderNotes();
}

window.addEventListener("resize",function(){ closePop(); });
window.addEventListener("online",function(){ if(held) location.reload(); });

/* ── 啟動 ─────────────────────────────── */
(async function init(){
  await Store.ready;
  var saved=await load(CFG_KEY);
  /* 有開同步、這台又沒有任何資料、而且沒連上雲端：這時的「預設值」不是資料，
     存下去會蓋掉雲端的真資料。先不存，等連上再說。 */
  if(!saved && Store.syncEnabled() && Store.synced && !Store.synced()){
    held=true;
    $("syncWarn").hidden=false;
  }
  if(saved){
    cfg=Object.assign(cfg,saved);
    if(!cfg.seq) cfg.seq=(cfg.tasks.reduce(function(m,t){ return Math.max(m,t.id); },0)||0)+1;
  }else{
    cfg.tasks=[
      {id:1,name:"產品設計",  target:10,color:PALETTE[0]},
      {id:2,name:"前端開發",  target:12,color:PALETTE[1]},
      {id:3,name:"行銷內容",  target:6, color:PALETTE[2]},
      {id:4,name:"會議與行政",target:4, color:PALETTE[3]}
    ];
    cfg.seq=5;
    if(!held) save(CFG_KEY,cfg);
  }
  fillRange();
  var sn=await load(NOTE_KEY);
  if(sn && sn.items){
    notes=sn;
    if(!notes.cats) notes.cats=[];
    if(!notes.seq)  notes.seq=(notes.items.reduce(function(m,n){ return Math.max(m,n.id); },0)||0)+1;
    if(!notes.cseq) notes.cseq=(notes.cats.reduce(function(m,c){ return Math.max(m,c.id); },0)||0)+1;
  }else{
    notes.cats=[
      {id:1,name:"想法",color:PALETTE[3]},
      {id:2,name:"待辦",color:PALETTE[2]},
      {id:3,name:"紀錄",color:PALETTE[0]}
    ];
    notes.cseq=4;
  }
  var st=await load(TODO_KEY);
  if(st && st.items){
    todos=st;
    if(!todos.seq) todos.seq=(todos.items.reduce(function(m,t){ return Math.max(m,t.id); },0)||0)+1;
    if(!todos.day) todos.day="";
  }
  var rolled=rollover();

  week=(await load(weekKey()))||{blocks:[],seq:1};
  normalizeWeek();
  if(Store.backend()!=="local") $("storeWarn").hidden=false;
  loaded=true;
  if(rolled) saveSoon();
  renderAll();
  setTimeout(scrollToToday,60);
})();

})();
