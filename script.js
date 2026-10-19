/* 詰将棋探索エンジン（簡易・自己完結版）
 * 合法手生成、王手判定、攻め方は王手のみ、玉方は全応手を探索します。
 * 盤面は内部的に file=0..8 (9..1), rank=0..8 (一..九)。
 */
const PIECES = [
  {k:"K", name:"玉", glyph:"玉", promoted:false},
  {k:"R", name:"飛", glyph:"飛", promoted:false},
  {k:"B", name:"角", glyph:"角", promoted:false},
  {k:"G", name:"金", glyph:"金", promoted:false},
  {k:"S", name:"銀", glyph:"銀", promoted:false},
  {k:"N", name:"桂", glyph:"桂", promoted:false},
  {k:"L", name:"香", glyph:"香", promoted:false},
  {k:"P", name:"歩", glyph:"歩", promoted:false},
  {k:"+R", name:"龍", glyph:"龍", promoted:true},
  {k:"+B", name:"馬", glyph:"馬", promoted:true},
  {k:"+S", name:"成銀", glyph:"全", promoted:true},
  {k:"+N", name:"成桂", glyph:"圭", promoted:true},
  {k:"+L", name:"成香", glyph:"杏", promoted:true},
  {k:"+P", name:"と", glyph:"と", promoted:true},
  {k:"E", name:"消去", glyph:"", promoted:false}
];
const BASE = {"K":"K","R":"R","+R":"R","B":"B","+B":"B","G":"G","S":"S","+S":"S","N":"N","+N":"N","L":"L","+L":"L","P":"P","+P":"P"};
const HAND_ORDER = ["R","B","G","S","N","L","P"];
const HAND_NAMES = {R:"飛",B:"角",G:"金",S:"銀",N:"桂",L:"香",P:"歩"};
const INVENTORY = {R:2,B:2,G:4,S:4,N:4,L:4,P:18};
const KANJI_NUM = ["一","二","三","四","五","六","七","八","九"];
let board = Array(81).fill(null);
let hands = {b:{},w:{}};
let currentOwner = "b";
let selectedPiece = "R";
let selectedErase = false;
let lastSolution = null;
let dragPayload = null;
let pointerDrag = null;
let suppressNextClick = false;

const boardEl = document.getElementById("board");
const paletteEl = document.getElementById("piecePalette");
const resultEl = document.getElementById("result");
const solutionEl = document.getElementById("solution");
const validationEl = document.getElementById("validation");

function idx(f,r){return r*9+f}
function coords(i){return {f:i%9,r:Math.floor(i/9)}}
function ownerLabel(o){return o==="b"?"▲":"△"}
function pieceInfo(k){return PIECES.find(p=>p.k===k)||PIECES[0]}
function makePiece(k,owner){return {k,owner}}
function cloneState(s){return {board:s.board.slice(),hands:{b:{...s.hands.b},w:{...s.hands.w}},turn:s.turn}}
function stateNow(){return {board:board.map(p=>p?{...p}:null),hands:{b:{...hands.b},w:{...hands.w}},turn:document.getElementById("turnSelect").value}}
function syncDefenderHand(){
  // 玉方の持ち駒は、標準の駒数から盤上と攻め方の持ち駒を差し引いた残り全部。
  const attacker=document.getElementById("turnSelect").value;
  const defender=attacker==="b"?"w":"b";
  const used={R:0,B:0,G:0,S:0,N:0,L:0,P:0};
  for(const p of board){if(p){const k=baseK(p.k);if(k!=="K"&&used[k]!==undefined)used[k]++;}}
  for(const k of HAND_ORDER) used[k]+=(hands[attacker][k]||0);
  hands[defender]={};
  for(const k of HAND_ORDER){const n=Math.max(0,(INVENTORY[k]||0)-used[k]);if(n>0)hands[defender][k]=n;}
}
function renderBoard(){
  syncDefenderHand();
  boardEl.innerHTML="";
  for(let r=0;r<9;r++) for(let f=0;f<9;f++){
    const i=idx(f,r), p=board[i], sq=document.createElement("button");
    sq.type="button";sq.className="square";sq.dataset.index=String(i);sq.setAttribute("role","gridcell");
    sq.setAttribute("aria-label",`${9-f}${KANJI_NUM[r]} ${p?ownerLabel(p.owner)+pieceInfo(p.k).name:"空き"}`);
    if(p){
      const span=document.createElement("span");span.className="piece owner-"+p.owner+(p.k.startsWith("+")?" promoted":"");span.textContent=pieceInfo(p.k).glyph;
      sq.appendChild(span);sq.draggable=false;
      sq.addEventListener("pointerdown",e=>beginPointerDrag(e,{type:"board",from:i,piece:{...p}}));
    }
    sq.addEventListener("click",()=>onSquareClick(i));
    sq.addEventListener("contextmenu",e=>{e.preventDefault();cyclePieceAt(i)});
    sq.addEventListener("dragenter",e=>{e.preventDefault();sq.classList.add("drop-target")});
    sq.addEventListener("dragover",e=>{e.preventDefault();sq.classList.add("drop-target");if(e.dataTransfer)e.dataTransfer.dropEffect="move"});
    sq.addEventListener("dragleave",()=>sq.classList.remove("drop-target"));
    sq.addEventListener("drop",e=>{e.preventDefault();e.stopPropagation();sq.classList.remove("drop-target");handleBoardDrop(i,e)});
    boardEl.appendChild(sq);
  }
  renderHands();
}
function renderPalette(){
  paletteEl.innerHTML="";
  PIECES.filter(p=>!p.promoted && p.k!=="E").forEach(p=>{
    const b=document.createElement("button");b.className="palette-btn"+((selectedPiece===p.k&&!selectedErase)?" active":"");
    b.type="button";b.draggable=false;
    b.innerHTML=`<span class="piece">${p.glyph}</span><small>${p.name}</small>`;
    b.addEventListener("pointerdown",e=>beginPointerDrag(e,{type:"palette",piece:{k:p.k,owner:currentOwner}}));
    b.addEventListener("click",()=>{if(suppressNextClick)return;selectedPiece=p.k;selectedErase=false;renderPalette()});paletteEl.appendChild(b);
  });
}
function renderHands(){
  for(const o of ["b","w"]){
    const el=document.getElementById(o==="b"?"handB":"handW");el.innerHTML="";
    const entries=HAND_ORDER.filter(k=>(hands[o][k]||0)>0);
    if(!entries.length){el.textContent="なし";el.style.color="#94a3b8";el.style.fontSize="18px"}
    else {
      el.style.color="";el.style.fontSize="";
      entries.forEach(k=>{const b=document.createElement("button");b.className="hand-chip";b.draggable=false;b.textContent=HAND_NAMES[k];const n=document.createElement("span");n.textContent="×"+hands[o][k];b.appendChild(n);b.title="ドラッグして盤上に置く／クリックで1枚減らす";
        b.addEventListener("click",()=>{if(suppressNextClick)return;hands[o][k]--;if(hands[o][k]<=0)delete hands[o][k];renderHands();renderValidation()});
        b.addEventListener("pointerdown",e=>beginPointerDrag(e,{type:"hand",owner:o,piece:{k,owner:o}}));el.appendChild(b)})
    }
    const box=el.closest(".hand-box")||el;
    box.ondragover=e=>{e.preventDefault();box.classList.add("drop-target");e.dataTransfer.dropEffect="move"};
    box.ondragleave=e=>{if(!box.contains(e.relatedTarget))box.classList.remove("drop-target")};
    box.ondrop=e=>{e.preventDefault();e.stopPropagation();box.classList.remove("drop-target");handleHandDrop(o,e)};
    box.onclick=e=>{
      if(suppressNextClick)return;
      if(e.target.closest&&e.target.closest(".hand-chip"))return;
      const attacker=document.getElementById("turnSelect").value,k=baseK(selectedPiece);
      if(o!==attacker||selectedErase||!HAND_ORDER.includes(k))return;
      hands[o][k]=(hands[o][k]||0)+1;renderBoard();renderValidation();resetResult();
    };
  }
}
function beginPointerDrag(e,data){
  if(e.button!==undefined && e.button!==0)return;
  pointerDrag={data,startX:e.clientX,startY:e.clientY,moved:false};
  dragPayload=data;
}
document.addEventListener("pointermove",e=>{
  if(!pointerDrag)return;
  if(Math.hypot(e.clientX-pointerDrag.startX,e.clientY-pointerDrag.startY)>5){
    pointerDrag.moved=true;
    const target=document.elementFromPoint(e.clientX,e.clientY);
    document.querySelectorAll(".drop-target").forEach(el=>el.classList.remove("drop-target"));
    const sq=target?.closest?.(".square"), hand=target?.closest?.(".hand-box");
    if(sq)sq.classList.add("drop-target"); else if(hand)hand.classList.add("drop-target");
  }
});
document.addEventListener("pointerup",e=>{
  if(!pointerDrag)return;
  const drag=pointerDrag;pointerDrag=null;
  document.querySelectorAll(".drop-target").forEach(el=>el.classList.remove("drop-target"));
  if(!drag.moved)return;
  suppressNextClick=true;setTimeout(()=>{suppressNextClick=false},500);
  const target=document.elementFromPoint(e.clientX,e.clientY);
  const square=target?.closest?.(".square"), handBox=target?.closest?.(".hand-box");
  if(square){
    const i=Number(square.dataset.index);
    if(Number.isInteger(i))applyPointerBoardDrop(i,drag.data);
  }else if(handBox){
    applyPointerHandDrop(handBox.dataset.handOwner,drag.data);
  }else if(drag.data.type==="board"){
    const from=drag.data.from;if(board[from]){board[from]=null;renderBoard();renderValidation();resetResult()}
  }
});
document.addEventListener("click",e=>{
  if(!suppressNextClick)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();suppressNextClick=false;
},true);
function applyPointerBoardDrop(to,data){
  if(!data)return;
  if(data.type==="palette"){
    board[to]=makePiece(baseK(data.piece.k),data.piece.owner);
  }else if(data.type==="hand"){
    const {owner,piece}=data;
    if((hands[owner][piece.k]||0)<=0)return;
    hands[owner][piece.k]--;if(hands[owner][piece.k]<=0)delete hands[owner][piece.k];
    board[to]=makePiece(piece.k,owner);
  }else if(data.type==="board"){
    const from=data.from;if(from===to||!board[from])return;
    const moving=board[from],target=board[to];board[to]=moving;board[from]=target||null;
  }
  renderBoard();renderValidation();resetResult();
}
function applyPointerHandDrop(owner,data){
  if(!data||!owner)return;
  const attacker=document.getElementById("turnSelect").value;
  if(data.type==="palette"){
    const k=baseK(data.piece.k);if(owner!==attacker||!HAND_ORDER.includes(k))return;
    hands[owner][k]=(hands[owner][k]||0)+1;
  }else if(data.type==="board"){
    const p=board[data.from];if(!p||p.k==="K")return;
    const k=baseK(p.k);if(!HAND_ORDER.includes(k))return;
    board[data.from]=null;
    if(owner===attacker)hands[owner][k]=(hands[owner][k]||0)+1;
    // 玉方の持ち駒は未使用駒から自動再計算される。
  }else if(data.type==="hand"){
    const k=data.piece.k;if(data.owner===owner)return;
    if((hands[data.owner][k]||0)<=0)return;
    hands[data.owner][k]--;if(hands[data.owner][k]<=0)delete hands[data.owner][k];
    if(owner===attacker)hands[owner][k]=(hands[owner][k]||0)+1;
  }
  renderBoard();renderValidation();resetResult();
}

function readDrag(e){
  try { return JSON.parse(e.dataTransfer.getData("text/plain")) || dragPayload; }
  catch { return dragPayload; }
}
function handleBoardDrop(to,e){
  const data=readDrag(e)||dragPayload;if(!data)return;
  if(data.type==="palette"){
    if(data.piece.k==="E")return;
    board[to]=makePiece(data.piece.k,data.piece.owner);
  } else if(data.type==="hand"){
    const {owner,piece}=data;
    if((hands[owner][piece.k]||0)<=0)return;
    hands[owner][piece.k]--;if(hands[owner][piece.k]<=0)delete hands[owner][piece.k];
    board[to]=makePiece(piece.k,owner);
  } else if(data.type==="board"){
    const from=data.from;if(from===to)return;
    const moving=board[from];if(!moving)return;
    const target=board[to];board[to]=moving;board[from]=target||null;
  }
  renderBoard();renderValidation();resetResult();
}
function handleHandDrop(owner,e){
  const data=readDrag(e)||dragPayload;if(!data)return;
  if(data.type==="board"){
    const p=board[data.from];if(!p||p.k==="K")return;
    const k=baseK(p.k);if(!HAND_ORDER.includes(k))return;
    hands[owner][k]=(hands[owner][k]||0)+1;board[data.from]=null;
  }else if(data.type==="palette"){
    const k=baseK(data.piece.k);if(!HAND_ORDER.includes(k))return;
    const attacker=document.getElementById("turnSelect").value;
    if(owner===attacker)hands[owner][k]=(hands[owner][k]||0)+1;
  }else if(data.type==="hand"){
    const k=data.piece.k;if(data.owner===owner)return;
    if((hands[data.owner][k]||0)<=0)return;
    hands[data.owner][k]--;if(hands[data.owner][k]<=0)delete hands[data.owner][k];
    hands[owner][k]=(hands[owner][k]||0)+1;
  }
  renderBoard();renderValidation();resetResult();
}
function cyclePieceAt(i){
  const p=board[i];if(!p)return;
  const base=baseK(p.k), promotable=!['K','G'].includes(base);
  if(promotable){
    if(p.owner==="b"&&!p.k.startsWith("+"))board[i]=makePiece("+"+base,"b");
    else if(p.owner==="b"&&p.k.startsWith("+"))board[i]=makePiece(base,"w");
    else if(p.owner==="w"&&!p.k.startsWith("+"))board[i]=makePiece("+"+base,"w");
    else board[i]=makePiece(base,"b");
  } else board[i]=makePiece(base,p.owner==="b"?"w":"b");
  renderBoard();renderValidation();resetResult();
}
function renderValidation(){
  const issues=validateInput(stateNow());validationEl.innerHTML="";
  issues.forEach(x=>{const li=document.createElement("li");li.className=x.type;li.textContent=x.text;validationEl.appendChild(li)});
}
function onSquareClick(i){
  if(suppressNextClick)return;
  if(selectedErase){board[i]=null}
  else board[i]=makePiece(selectedPiece,currentOwner);
  renderBoard();renderValidation();resetResult();
}
document.querySelectorAll(".owner-btn").forEach(b=>b.addEventListener("click",()=>{
  currentOwner=b.dataset.owner;document.querySelectorAll(".owner-btn").forEach(x=>x.classList.toggle("active",x===b));
}));
document.getElementById("clearBoardBtn").addEventListener("click",()=>{board=Array(81).fill(null);hands={b:{},w:{}};renderBoard();renderValidation();resetResult()});
document.getElementById("sampleBtn").addEventListener("click",loadSample);
document.getElementById("turnSelect").addEventListener("change",()=>{renderBoard();renderValidation();resetResult();});
document.getElementById("solveBtn").addEventListener("click",solveFromUI);

function validateInput(s){
  const issues=[], count={b:0,w:0};
  s.board.forEach(p=>{if(p&&p.k==="K")count[p.owner]++});
  // 詰将棋では玉方（守る側）の玉だけ必須。攻め方の玉は省略可能。
  const defender = s.turn === "b" ? "w" : "b";
  if(count[defender]!==1) issues.push({type:"error",text:`玉方（${defender==="b"?"先手":"後手"}）の玉：${count[defender]}枚（1枚必要）`});
  else issues.push({type:"ok",text:"玉方の玉：配置済み"});
  if(count[s.turn]===0) issues.push({type:"ok",text:"攻め方の玉：省略（配置不要）"});
  else if(count[s.turn]===1) issues.push({type:"ok",text:"攻め方の玉：配置済み"});
  else issues.push({type:"warn",text:"攻め方の玉が複数あります"});
  const pawnFiles={b:new Set(),w:new Set()};
  s.board.forEach((p,i)=>{if(p&&BASE[p.k]==="P"&&!p.k.startsWith("+")){const f=i%9;if(pawnFiles[p.owner].has(f))issues.push({type:"warn",text:`${p.owner==="b"?"先手":"後手"}の二歩の可能性（${9-f}筋）`});pawnFiles[p.owner].add(f)}});
  if(s.board.filter(Boolean).length===0)issues.push({type:"warn",text:"盤上に駒がありません"});
  issues.push({type:"",text:"詰将棋の出題形式（王手状態、余詰、無駄合など）は探索時に確認してください"});
  return issues;
}
function resetResult(){resultEl.className="result empty";resultEl.innerHTML='<div class="empty-icon">詰</div><h3>盤面を作成してください</h3><p>玉方の玉を配置し、「詰みを探索」を押してください。攻め方の玉は省略できます。</p>';solutionEl.classList.add("hidden");lastSolution=null;solveId++;stopSolver();setSolveBusy(false);yozumeUI=null}

function sideForward(owner){return owner==="b"?-1:1}
function inBoard(f,r){return f>=0&&f<9&&r>=0&&r<9}
function isPromoted(k){return k.startsWith("+")}
function baseK(k){return BASE[k]||k}
function canPromote(p,fromR,toR){
  if(isPromoted(p.k)||["K","G"].includes(p.k))return false;
  return p.owner==="b"?(fromR<=2||toR<=2):(fromR>=6||toR>=6);
}
function deadRank(k,owner,r){
  const rr=owner==="b"?r:8-r, b=baseK(k);
  if(b==="P"||b==="L")return rr===0;
  if(b==="N")return rr<=1;
  return false;
}
function attacksFrom(s,from,to,p){
  const {f:ff,r:fr}=coords(from),{f:tf,r:tr}=coords(to);
  const dx=tf-ff,dy=tr-fr,fw=sideForward(p.owner),k=p.k;
  const absx=Math.abs(dx),absy=Math.abs(dy);
  const step=(x,y)=>dx===x&&dy===y;
  let dirs=[];
  if(k==="K")return absx<=1&&absy<=1&&(absx+absy>0);
  if(k==="G"||["+S","+N","+L","+P"].includes(k)){
    return [[0,fw],[-1,fw],[1,fw],[-1,0],[1,0],[0,-fw]].some(([x,y])=>step(x,y));
  }
  if(k==="S")return [[0,fw],[-1,fw],[1,fw],[-1,-fw],[1,-fw]].some(([x,y])=>step(x,y));
  if(k==="N")return absy===2&&dy===2*fw&&absx===1;
  if(k==="L")dirs=[[0,fw]];
  if(k==="P")return dx===0&&dy===fw;
  if(k==="R"||k==="+R"){
    if(dx===0||dy===0){if(dx===0&&dy===0)return false;return pathClear(s,from,to)}
    if(k==="+R")return absx===1&&absy===1;
    return false;
  }
  if(k==="B"||k==="+B"){
    if(absx===absy&&absx>0)return pathClear(s,from,to);
    if(k==="+B"&&absx+absy===1)return true;
    return false;
  }
  if(k==="L"){if(dx!==0||dy*fw<=0)return false;return pathClear(s,from,to)}
  return false;
}
function pathClear(s,from,to){
  const a=coords(from),b=coords(to),dx=Math.sign(b.f-a.f),dy=Math.sign(b.r-a.r);
  let f=a.f+dx,r=a.r+dy;
  while(f!==b.f||r!==b.r){if(s.board[idx(f,r)])return false;f+=dx;r+=dy}
  return true;
}
function kingSquare(s,owner){return s.board.findIndex(p=>p&&p.k==="K"&&p.owner===owner)}
function isAttacked(s,square,byOwner){
  if(square<0)return false;
  for(let i=0;i<81;i++){const p=s.board[i];if(p&&p.owner===byOwner&&attacksFrom(s,i,square,p))return true}
  return false;
}
function inCheck(s,owner){return isAttacked(s,kingSquare(s,owner),owner==="b"?"w":"b")}
function pseudoMoves(s,owner){
  const moves=[];
  for(let from=0;from<81;from++){
    const p=s.board[from];if(!p||p.owner!==owner)continue;
    const {f,r}=coords(from);
    for(let to=0;to<81;to++){
      if(to===from)continue;
      const q=s.board[to];if(q&&(q.owner===owner||q.k==="K"))continue;
      if(!attacksFrom(s,from,to,p))continue;
      const tr=coords(to).r;
      const promote=canPromote(p,r,tr);
      const choices=[false];if(promote)choices.push(true);
      for(const promoted of choices){
        const k=promoted?(p.k.startsWith("+")?p.k:"+"+p.k):p.k;
        if(!promoted&&deadRank(k,owner,tr))continue;
        moves.push({from,to,piece:p.k,promote:promoted,drop:false});
      }
    }
  }
  for(const k of HAND_ORDER){
    if(!(s.hands[owner][k]>0))continue;
    for(let to=0;to<81;to++){
      if(s.board[to])continue;
      const {f,r}=coords(to);
      if(deadRank(k,owner,r))continue;
      if(k==="P"&&s.board.some((p,i)=>p&&p.owner===owner&&p.k==="P"&&i%9===f))continue;
      moves.push({from:-1,to,piece:k,promote:false,drop:true});
    }
  }
  return moves;
}
function applyMove(s,m){
  const n=cloneState(s),owner=s.turn,other=owner==="b"?"w":"b";
  if(m.drop){
    n.hands[owner][m.piece]--;
    if(n.hands[owner][m.piece]<=0)delete n.hands[owner][m.piece];
    n.board[m.to]=makePiece(m.piece,owner);
  }else{
    const p=n.board[m.from],q=n.board[m.to];
    if(q){const b=baseK(q.k);if(b!=="K")n.hands[owner][b]=(n.hands[owner][b]||0)+1}
    n.board[m.from]=null;
    n.board[m.to]=makePiece(m.promote?(p.k.startsWith("+")?p.k:"+"+p.k):p.k,owner);
  }
  n.turn=other;
  return n;
}
function legalMoves(s,owner,onlyChecks=false){
  const temp={...s,turn:owner},moves=pseudoMoves(temp,owner),out=[],opp=owner==="b"?"w":"b";
  for(const m of moves){
    const n=applyMove(temp,m);
    if(inCheck(n,owner))continue;
    const chk=inCheck(n,opp);
    if(onlyChecks&&!chk)continue;
    // 打ち歩詰め：歩を打って王手し、相手に合法手がなければ反則
    if(m.drop&&m.piece==="P"&&chk&&legalMoves(n,opp,false).length===0)continue;
    out.push(m);
  }
  return out;
}
function moveGivesCheck(s,m,owner){const n=applyMove({...s,turn:owner},m);return inCheck(n,owner==="b"?"w":"b")}
function moveText(m,s,owner){
  const to=coords(m.to),dest=`${9-to.f}${KANJI_NUM[to.r]}`;
  let name=m.drop?HAND_NAMES[m.piece]:pieceInfo(m.piece).glyph;
  if(m.promote)name+="成";
  else if(!m.drop&&canPromote({k:m.piece,owner},coords(m.from).r,to.r)&&!isPromoted(m.piece))name+="不成";
  return `${ownerLabel(owner)}${dest}${name}`;
}
const KCODE={};["K","R","+R","B","+B","G","S","+S","N","+N","L","+L","P","+P"].forEach((k,i)=>KCODE[k]=i+1);
function stateKey(s,depth){
  let b="";
  for(let i=0;i<81;i++){const p=s.board[i];b+=p?String.fromCharCode(48+KCODE[p.k]+(p.owner==="w"?20:0)):"."}
  let h=s.turn+depth+"|";
  for(const o of ["b","w"])for(const k of HAND_ORDER)h+=String.fromCharCode(48+(s.hands[o][k]||0));
  return b+h;
}
// 探索エンジン。時間・メモリに上限があり、Web Worker 内でも通常スレッドでも動く。
function solveMate(initial,maxPly,opts){
  opts=opts||{};
  const attacker=initial.turn,defender=attacker==="b"?"w":"b";
  const MEMO_CAP=600000,NODE_LIMIT=80000000;
  let limitMs=opts.timeLimitMs||30000,t0=Date.now(),curDepth=0,resTree=null;
  const memo=new Map();let nodes=0,aborted=false,reason="";
  function tick(){
    if(++nodes>NODE_LIMIT){aborted=true;reason="nodes";return true}
    if((nodes&2047)===0){
      if(Date.now()-t0>limitMs){aborted=true;reason="time";return true}
      if(memo.size>MEMO_CAP)memo.clear(); // メモリ暴走防止（キャッシュを捨てるだけで結果は変わらない）
      if(opts.onProgress&&(nodes&32767)===0)opts.onProgress(nodes,curDepth);
    }
    return false;
  }
  function tree(s,remaining){
    if(tick())return null;
    const key=stateKey(s,remaining);
    if(memo.has(key))return memo.get(key);
    let ans=null;
    if(s.turn===attacker){
      if(remaining>=1){
        for(const m of legalMoves(s,attacker,true)){
          const n=applyMove(s,m),child=tree(n,remaining-1);
          if(aborted)return null;
          if(child){ans={move:m,owner:attacker,state:n,child};break}
        }
      }
    }else{
      const replies=legalMoves(s,defender,false);
      if(replies.length===0){ans=inCheck(s,defender)?{mate:true,state:s}:null}
      else if(remaining>=1){
        replies.sort((x,y)=>x.drop-y.drop);
        const children=[];let ok=true;
        for(const m of replies){
          const n=applyMove(s,m),child=tree(n,remaining-1);
          if(aborted)return null;
          if(!child){ok=false;break}
          children.push({move:m,owner:defender,state:n,child});
        }
        if(ok)ans={defenderReplies:children,state:s};
      }
    }
    memo.set(key,ans);return ans;
  }
  // 作意手順の確定：攻方は最短、玉方は最長抵抗（各ノードに dist=詰みまでの手数）
  function refine(s,maxRem){
    if(s.turn===attacker){
      for(let rem=1;rem<=maxRem;rem+=2){
        const t=tree(s,rem);if(aborted)return null;
        if(t){const sub=refine(t.state,rem-1);if(!sub)return null;
          return {dist:sub.dist+1,node:{move:t.move,owner:attacker,state:t.state,child:sub.node,dist:sub.dist+1}}}
      }
      return null;
    }
    const replies=legalMoves(s,defender,false);
    if(!replies.length)return {dist:0,node:{mate:true,state:s}};
    const items=[];
    for(const m of replies){
      const n=applyMove(s,m),sub=refine(n,maxRem-1);if(!sub)return null;
      items.push({move:m,owner:defender,state:n,child:sub.node,dist:sub.dist+1});
    }
    items.sort((x,y)=>y.dist-x.dist||x.move.drop-y.move.drop);
    return {dist:items[0].dist,node:{defenderReplies:items,state:s,dist:items[0].dist}};
  }
  function sameMove(a,b){return a.from===b.from&&a.to===b.to&&a.drop===b.drop&&a.piece===b.piece&&a.promote===b.promote}
  // 余詰探索（要求されたときだけ実行）。全変化の攻方の手が対象。最終手は対象外。
  function findYozume(ms){
    aborted=false;reason="";nodes=0;t0=Date.now();limitMs=ms||30000;
    const list=[];
    (function walk(node,s,path){
      if(!node||node.mate||aborted)return;
      if(node.move){
        const mv=node.move;
        if(node.dist>1){
          const alts=[];
          for(const m of legalMoves(s,attacker,true)){
            if(sameMove(m,mv))continue;
            if(tree(applyMove(s,m),node.dist-1))alts.push(moveText(m,s,attacker));
            if(aborted)return;
          }
          if(alts.length)list.push({ply:path.length+1,path:path.slice(),main:moveText(mv,s,attacker),moves:alts});
        }
        path.push(moveText(mv,s,attacker));walk(node.child,node.state,path);path.pop();
      }else{
        for(const r of node.defenderReplies){path.push(moveText(r.move,node.state,defender));walk(r.child,r.state,path);path.pop();if(aborted)return}
      }
    })(resTree,{...initial,turn:attacker},[]);
    return {list,aborted};
  }
  // 反復深化：1手詰、3手詰、5手詰…と深くするので、最初に見つかった詰みが最短
  for(let d=1;d<=maxPly;d+=2){
    curDepth=d;if(opts.onProgress)opts.onProgress(nodes,d);
    const t=tree({...initial,turn:attacker},d);
    if(aborted)return {found:false,nodes,aborted:true,reason,tree:null,depth:d};
    if(t){
      const ref=refine({...initial,turn:attacker},d);
      if(!ref)return {found:false,nodes,aborted:true,reason,tree:null,depth:d};
      resTree=ref.node;
      return {found:true,nodes,aborted:false,reason:"",tree:ref.node,depth:ref.dist,findYozume};
    }
  }
  return {found:false,nodes,aborted:false,reason:"",tree:null};
}

// ===== Web Worker（探索中も画面が固まらない・中止できる） =====
let SOLVE_TIME_LIMIT=30000;
let solverWorker=null,solveId=0,yozumeUI=null,lastSolveRes=null;
function buildWorkerSource(){
  const consts=`const PIECES=${JSON.stringify(PIECES)},BASE=${JSON.stringify(BASE)},HAND_ORDER=${JSON.stringify(HAND_ORDER)},HAND_NAMES=${JSON.stringify(HAND_NAMES)},KANJI_NUM=${JSON.stringify(KANJI_NUM)},KCODE=${JSON.stringify(KCODE)};\n`;
  const fns=[idx,coords,ownerLabel,pieceInfo,makePiece,cloneState,sideForward,isPromoted,baseK,canPromote,deadRank,attacksFrom,pathClear,kingSquare,isAttacked,inCheck,pseudoMoves,applyMove,legalMoves,moveText,stateKey,solveMate].map(f=>f.toString()).join("\n");
  const body=`
let lastRes=null;
onmessage=e=>{const m=e.data;
  if(m.type==="solve"){
    const r=solveMate(m.initial,m.maxPly,{timeLimitMs:m.timeLimitMs,onProgress:(n,d)=>postMessage({type:"progress",nodes:n,depth:d})});
    lastRes=r;const {findYozume,...plain}=r;postMessage({type:"done",res:plain});
  }else if(m.type==="yozume"){
    const y=lastRes&&lastRes.findYozume?lastRes.findYozume(m.timeLimitMs):{list:[],aborted:false};
    postMessage({type:"yozumeDone",result:y});
  }
};`;
  return consts+fns+body;
}
function stopSolver(){if(solverWorker){try{solverWorker.terminate()}catch(e){}solverWorker=null}}
function setSolveBusy(b){const btn=document.getElementById("solveBtn");if(!btn)return;btn.disabled=b;btn.textContent=b?"探索中…":"詰みを探索"}
function showSearching(){
  resultEl.className="result empty";
  resultEl.innerHTML='<div class="empty-icon">…</div><h3>詰みを探索しています</h3><p id="progressText">準備中…</p>';
  const stop=document.createElement("button");stop.type="button";stop.className="button secondary";stop.style.marginTop="8px";stop.textContent="探索を中止";
  stop.addEventListener("click",()=>{solveId++;stopSolver();setSolveBusy(false);resultEl.className="result failure";resultEl.innerHTML='<p class="result-title">探索を中止しました</p><p class="result-detail">盤面や持ち駒を調整して、もう一度お試しください。</p>'});
  resultEl.appendChild(stop);solutionEl.classList.add("hidden");
}
function showSolveError(msg){setSolveBusy(false);resultEl.className="result failure";resultEl.innerHTML=`<p class="result-title">探索中にエラーが発生しました</p><p class="result-detail">${msg}</p>`}

// ===== 手順の表示（作意手順・変化手順・矢印キー） =====
let lastInitial=null,mainSteps=[],mainLabels=[],curPly=0,lineBoxEl=null;
function collectPV(tree,out=[]){
  if(!tree||tree.mate)return out;
  if(tree.move){out.push({move:tree.move,owner:tree.owner});return collectPV(tree.child,out)}
  if(tree.defenderReplies&&tree.defenderReplies.length){const r=tree.defenderReplies[0];out.push({move:r.move,owner:r.owner});return collectPV(r.child,out)}
  return out;
}
function formatMove(m,s,owner){return moveText(m,s,owner)}
function stepKey(st){const m=st.move;return st.owner+(m.drop?"d"+m.piece:m.from)+"-"+m.to+(m.promote?"+":"")}
function lineLabels(initial,steps){
  const labels=[],timeline=[cloneState(initial)];let s=cloneState(initial);
  steps.forEach(st=>{labels.push(moveText(st.move,s,st.owner));s=applyMove(s,st.move);timeline.push(cloneState(s))});
  return {labels,timeline};
}
function mkButton(text,fn,cls){const b=document.createElement("button");b.type="button";b.className=cls||"button secondary";b.textContent=text;b.addEventListener("click",fn);return b}
function showLine(steps,selectPly){
  const {labels,timeline}=lineLabels(lastInitial,steps);
  lastSolution={timeline,initial:cloneState(lastInitial)};
  let branch=-1;
  for(let i=0;i<steps.length;i++){if(!mainSteps[i]||stepKey(mainSteps[i])!==stepKey(steps[i])){branch=i;break}}
  const box=lineBoxEl;box.innerHTML="";
  const title=document.createElement("h3");
  title.textContent=branch<0?"作意手順":`変化手順（${branch+1}手目 ${labels[branch]} から分岐）`;box.appendChild(title);
  const note=document.createElement("p");note.className="move-position-note";box.appendChild(note);
  if(branch>=0&&mainLabels[branch]){const alt=document.createElement("p");alt.className="move-position-note";alt.textContent=`作意手順では ${branch+1}手目は ${mainLabels[branch]} です（橙色の手が作意と異なる部分）。`;box.appendChild(alt)}
  const ctl=document.createElement("div");ctl.className="line-controls";
  ctl.append(mkButton("⏮",()=>showTimelineState(0)),mkButton("◀",()=>showTimelineState(curPly-1)),mkButton("▶",()=>showTimelineState(curPly+1)),mkButton("⏭",()=>showTimelineState(1e9)));
  if(branch>=0)ctl.appendChild(mkButton("作意手順に戻る",()=>showLine(mainSteps,branch)));
  box.appendChild(ctl);
  const hint=document.createElement("p");hint.className="hint";hint.textContent="←→キーで1手ずつ進める・戻す　↑↓キーで最初／最後へ";box.appendChild(hint);
  const list=document.createElement("div");list.className="move-list";
  const first=document.createElement("button");first.type="button";first.className="move-row active";first.innerHTML='<span class="move-number">0手目</span><span class="move-text">初期局面</span>';
  first.addEventListener("click",()=>showTimelineState(0));list.appendChild(first);
  steps.forEach((st,i)=>{
    const row=document.createElement("button");row.type="button";row.className="move-row"+(branch>=0&&i>=branch?" branch":"");
    const no=document.createElement("span");no.className="move-number";no.textContent=`${i+1}手目`;
    const txt=document.createElement("span");txt.className="move-text";txt.textContent=labels[i];
    row.append(no,txt);
    if(i===branch){const bd=document.createElement("span");bd.className="branch-badge";bd.textContent="ここで分岐";row.appendChild(bd)}
    row.addEventListener("click",()=>showTimelineState(i+1));list.appendChild(row);
  });
  box.appendChild(list);
  if(!steps.length){const p=document.createElement("p");p.textContent="現在の盤面ですでに詰みの状態です。";box.appendChild(p)}
  showTimelineState(selectPly);
}
function showTimelineState(ply){
  if(!lastSolution||!lastSolution.timeline)return;
  ply=Math.max(0,Math.min(ply,lastSolution.timeline.length-1));curPly=ply;
  const s=cloneState(lastSolution.timeline[ply]);board=s.board;hands=s.hands;
  renderBoard();renderValidation();
  const rows=solutionEl.querySelectorAll(".move-row");
  rows.forEach((row,i)=>row.classList.toggle("active",i===ply));
  if(rows[ply]&&rows[ply].scrollIntoView)rows[ply].scrollIntoView({block:"nearest",inline:"nearest"});
  const note=solutionEl.querySelector(".move-position-note");if(note)note.textContent=ply===0?"初期局面を表示中。":`${ply}手目まで進めた局面を表示中。`;
}
document.addEventListener("keydown",e=>{
  if(!lastSolution||!lastSolution.timeline||e.ctrlKey||e.metaKey||e.altKey)return;
  const tag=e.target&&e.target.tagName;if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA")return;
  let p=curPly;
  if(e.key==="ArrowRight")p=curPly+1;else if(e.key==="ArrowLeft")p=curPly-1;
  else if(e.key==="ArrowUp"||e.key==="Home")p=0;else if(e.key==="ArrowDown"||e.key==="End")p=1e9;else return;
  e.preventDefault();showTimelineState(p);
});
function treeRow(parent,plyNo,text,tagText,onClick){
  const line=document.createElement("div");line.className="tree-line";
  const no=document.createElement("span");no.className="ply-no";no.textContent=plyNo+".";
  const btn=document.createElement("button");btn.type="button";btn.className="tree-move";btn.textContent=text;btn.addEventListener("click",onClick);
  line.append(no,btn);
  if(tagText){const tag=document.createElement("span");tag.className="tree-tag";tag.textContent=tagText;line.appendChild(tag)}
  parent.appendChild(line);
}
// 探索木。玉方の応手が複数ある所（分岐点）を見出しと色付きの枝で示す。差し手を押すと、その変化を最後まで表示する。
function renderInteractiveTree(node,container,state,depth,path,onMain){
  if(!node)return;
  if(onMain===undefined)onMain=true;
  if(node.mate){const end=document.createElement("div");end.className="tree-mate";end.textContent="詰み";container.appendChild(end);return}
  if(node.move){
    const np=path.concat([{move:node.move,owner:node.owner}]);
    treeRow(container,depth+1,moveText(node.move,state,node.owner),"",()=>showLine(np.concat(collectPV(node.child,[])),depth+1));
    renderInteractiveTree(node.child,container,node.state,depth+1,np,onMain);return;
  }
  if(node.defenderReplies){
    const n=node.defenderReplies.length;
    const group=document.createElement("div");group.className="branch-group";container.appendChild(group);
    if(n>1){const h=document.createElement("div");h.className="tree-branch-head";h.textContent=`▼ ${depth+1}手目：玉方の応手が${n}通り（上が${onMain?"作意":"最長抵抗"}、下は変化）`;group.appendChild(h)}
    node.defenderReplies.forEach((reply,ri)=>{
      const isMain=onMain&&ri===0;
      const item=document.createElement("div");item.className="branch-item "+(isMain?"main":"variation");group.appendChild(item);
      const np=path.concat([{move:reply.move,owner:reply.owner}]);
      const tag=(n>1?(ri===0?(onMain?"作意・":"最長・"):"変化・"):"")+`以降${reply.dist-1}手詰`;
      treeRow(item,depth+1,moveText(reply.move,node.state,reply.owner),tag,()=>showLine(np.concat(collectPV(reply.child,[])),depth+1));
      renderInteractiveTree(reply.child,item,reply.state,depth+1,np,isMain);
    });
  }
}
function requestYozume(btn,out){
  yozumeUI={btn,out};
  if(solverWorker)solverWorker.postMessage({type:"yozume",timeLimitMs:SOLVE_TIME_LIMIT});
  else if(lastSolveRes&&lastSolveRes.findYozume)setTimeout(()=>showYozume(lastSolveRes.findYozume(SOLVE_TIME_LIMIT)),30);
  else showYozume({list:[],aborted:false});
}
function showYozume(r){
  if(!yozumeUI)return;
  const {btn,out}=yozumeUI;btn.disabled=false;btn.textContent="余詰を調べ直す";out.innerHTML="";
  const head=document.createElement("p");head.className="result-detail";
  head.textContent=(r.list.length?`余詰が${r.list.length}件見つかりました（最終手は対象外）。`:"余詰は見つかりませんでした（最終手は対象外）。")+(r.aborted?"時間制限のため途中までの結果です。":"");
  out.appendChild(head);
  r.list.slice(0,40).forEach(y=>{
    const p=document.createElement("p");p.className="yozume-item";
    p.textContent=(y.path.length?`変化 ${y.path.join(" ")} の後、`:"作意手順の")+`${y.ply}手目：${y.main} のほか ${y.moves.join("、")} でも詰みます。`;
    out.appendChild(p);
  });
}
function displayResult(res,initial,maxPly){
  solutionEl.innerHTML="";
  if(!res.found){
    resultEl.className="result failure";
    const msg=res.aborted?((res.reason==="time"?`探索時間の上限（${Math.round(SOLVE_TIME_LIMIT/1000)}秒）に達しました。`:"探索ノード数の上限に達しました。")+"手数や駒数を減らして再試行してください。"):`最大${maxPly}手以内の詰みが見つかりません。盤面、攻め方、持ち駒を確認してください。`;
    resultEl.innerHTML=`<p class="result-title">${res.aborted?"探索上限に到達しました":"詰みを発見できませんでした"}</p><p class="result-detail">${msg}<br>探索ノード数：${res.nodes.toLocaleString()}</p>`;
    solutionEl.classList.add("hidden");return;
  }
  lastInitial=cloneState(initial);lastSolveRes=res;
  mainSteps=collectPV(res.tree,[]);mainLabels=lineLabels(lastInitial,mainSteps).labels;
  resultEl.className="result success";
  resultEl.innerHTML=`<p class="result-title">詰み手順を発見しました</p><p class="result-detail">${res.depth}手詰です（最短手順）。探索ノード数：${res.nodes.toLocaleString()}<br>作意手順は、攻方は最短・玉方は最長抵抗の手順です。</p>`;
  const yb=mkButton("余詰を調べる",()=>{yb.disabled=true;yb.textContent="余詰を調べています…";yout.innerHTML="";requestYozume(yb,yout)});
  yb.style.marginTop="8px";
  const yout=document.createElement("div");yout.className="yozume-out";
  resultEl.append(yb,yout);
  solutionEl.classList.remove("hidden");
  lineBoxEl=document.createElement("div");lineBoxEl.className="line-box";solutionEl.appendChild(lineBoxEl);
  const details=document.createElement("details");details.className="variation-details";details.open=true;
  const summary=document.createElement("summary");summary.textContent="探索木（分岐点は色付きの枝。差し手を押すとその変化を表示）";
  details.appendChild(summary);
  const treeScroll=document.createElement("div");treeScroll.className="tree-scroll";
  renderInteractiveTree(res.tree,treeScroll,lastInitial,0,[],true);
  details.appendChild(treeScroll);solutionEl.appendChild(details);
  showLine(mainSteps,0);
}
function solveFromUI(){
  const initial=stateNow(),issues=validateInput(initial);
  renderValidation();
  if(issues.some(x=>x.type==="error")){
    resultEl.className="result failure";resultEl.innerHTML='<p class="result-title">盤面を確認してください</p><p class="result-detail">玉方（受ける側）の玉を1枚配置してください。攻め方の玉は省略できます。</p>';solutionEl.classList.add("hidden");return;
  }
  const attacker=initial.turn;
  if(kingSquare(initial,attacker)!==-1&&inCheck(initial,attacker)){
    resultEl.className="result failure";resultEl.innerHTML='<p class="result-title">手番側の玉が王手されています</p><p class="result-detail">攻め方の玉が王手されていない盤面にしてください。</p>';solutionEl.classList.add("hidden");return;
  }
  const maxPly=19;
  stopSolver();const myId=++solveId;lastSolveRes=null;yozumeUI=null;lastSolution=null;
  setSolveBusy(true);showSearching();
  let worker=null;
  try{worker=new Worker(URL.createObjectURL(new Blob([buildWorkerSource()],{type:"text/javascript"})))}catch(err){worker=null}
  if(worker){
    solverWorker=worker;
    worker.onmessage=e=>{
      if(myId!==solveId)return;const m=e.data;
      if(m.type==="progress"){const p=document.getElementById("progressText");if(p)p.textContent=`${m.nodes.toLocaleString()}ノード探索済み（${m.depth}手まで読んでいます）`}
      else if(m.type==="done"){setSolveBusy(false);displayResult(m.res,initial,maxPly)}
      else if(m.type==="yozumeDone")showYozume(m.result);
    };
    worker.onerror=()=>{if(myId!==solveId)return;stopSolver();showSolveError("メモリ不足などで探索が止まりました。駒数を減らすか、盤面を簡単にして再試行してください。")};
    worker.postMessage({type:"solve",initial,maxPly,timeLimitMs:SOLVE_TIME_LIMIT});
  }else{
    // Worker が使えない環境：通常スレッドで実行（時間制限つき）
    setTimeout(()=>{
      try{const res=solveMate(initial,maxPly,{timeLimitMs:SOLVE_TIME_LIMIT});if(myId!==solveId)return;setSolveBusy(false);displayResult(res,initial,maxPly)}
      catch(err){console.error(err);showSolveError("盤面を確認して、もう一度お試しください。")}
    },30);
  }
}
function loadSample(){
  board=Array(81).fill(null);hands={b:{},w:{}};
  // サンプルは誤った王手状態を読み込まないよう、玉方の玉だけ置く。
  // 盤面を編集してから探索するための初期配置。
  board[idx(4,0)]=makePiece("K","w");
  document.getElementById("turnSelect").value="b";
  renderBoard();renderValidation();resetResult();
}
renderPalette();renderBoard();renderValidation();
