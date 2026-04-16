import { futuresTradableCommodities } from "../config.js";
import { computeEquity } from "../logic.js";
import { DEFAULT_PLAYER_ID, getActivePlayer, normalizePlayerId } from "../state.js";

const PLAYER_ID_STORAGE_KEY = "futures-game:playerId";

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 * @param {import('../config.js').GAME_CONFIG} ctx.config
 * @param {() => object} ctx.getGameState
 * @param {(a: import('../logic.js').GameAction) => void} ctx.dispatch
 * @param {ReturnType<import('../room.js').createLocalRoomTransport>} ctx.transport
 * @param {boolean} [ctx.roomModeEnabled] 为 false 时禁用创建/加入房间及联机自动进局
 * @param {(view: 'start'|'room'|'game') => void} ctx.setCurrentView
 * @param {() => 'start'|'room'|'game'} ctx.getCurrentView
 * @param {(playerId?: string, soloWithAI?: boolean, mp?: { humanPlayerIds?: string[], multiplayerWithBots?: boolean, playerLabels?: Record<string, string> }) => void} ctx.onEnterGame
 */
export function mountApp(root, ctx) {
  const {
    config,
    getGameState,
    dispatch,
    transport,
    roomModeEnabled = true,
    setCurrentView,
    getCurrentView,
    onEnterGame,
  } = ctx;

  const playerIdInput = /** @type {HTMLInputElement | null} */ (root.querySelector("#playerIdInput"));

  const viewStart = /** @type {HTMLElement} */ (root.querySelector("#view-start"));
  const viewRoom = /** @type {HTMLElement} */ (root.querySelector("#view-room"));
  const viewGame = /** @type {HTMLElement} */ (root.querySelector("#view-game"));

  const roomIdEl = root.querySelector("#roomIdDisplay");
  const roomPlayersEl = root.querySelector("#roomPlayersList");
  const roomStatusEl = root.querySelector("#roomStatusText");
  const joinRoomInput = /** @type {HTMLInputElement | null} */ (root.querySelector("#joinRoomInput"));
  const btnCreateRoom = root.querySelector("#btnCreateRoom");
  const btnJoinRoom = root.querySelector("#btnJoinRoom");
  const btnSolo = root.querySelector("#btnSolo");
  const btnRoomReady = root.querySelector("#btnRoomReady");
  const btnRoomLeave = root.querySelector("#btnRoomLeave");
  const btnHostStart = root.querySelector("#btnHostStart");
  const btnPlayroomOnline = root.querySelector("#btnPlayroomOnline");

  const roomDisabledTitle = "房间与联机暂不可用";
  if (!roomModeEnabled) {
    if (btnCreateRoom instanceof HTMLButtonElement) {
      btnCreateRoom.disabled = true;
      btnCreateRoom.setAttribute("aria-disabled", "true");
      btnCreateRoom.title = roomDisabledTitle;
    }
    if (btnJoinRoom instanceof HTMLButtonElement) {
      btnJoinRoom.disabled = true;
      btnJoinRoom.setAttribute("aria-disabled", "true");
      btnJoinRoom.title = roomDisabledTitle;
    }
    if (joinRoomInput) {
      joinRoomInput.disabled = true;
      joinRoomInput.title = roomDisabledTitle;
    }
    if (btnRoomReady instanceof HTMLButtonElement) {
      btnRoomReady.disabled = true;
      btnRoomReady.title = roomDisabledTitle;
    }
    if (btnHostStart instanceof HTMLButtonElement) {
      btnHostStart.disabled = true;
      btnHostStart.title = roomDisabledTitle;
    }
  }

  const orderLimitSection = /** @type {HTMLElement | null} */ (root.querySelector("#orderLimitSection"));

  const orderCommoditySelect = /** @type {HTMLSelectElement | null} */ (viewGame.querySelector("#orderCommodity"));
  if (orderCommoditySelect && config.features?.limitOrders) {
    orderCommoditySelect.innerHTML = "";
    for (const c of futuresTradableCommodities(config)) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      orderCommoditySelect.appendChild(opt);
    }
  }

  const gameEndOverlay = root.querySelector("#gameEndOverlay");
  const gameEndRankList = root.querySelector("#gameEndRankList");
  const gameEndSub = root.querySelector("#gameEndSub");
  const gameEndCloseBtn = root.querySelector("#gameEndCloseBtn");

  /** 用户关闭终局排名弹窗后，不再在每次 render 时强制弹出 */
  let endModalDismissed = false;

  if (playerIdInput) {
    try {
      const saved = localStorage.getItem(PLAYER_ID_STORAGE_KEY);
      if (saved != null) playerIdInput.value = saved;
    } catch {
      /* ignore */
    }
  }

  function persistPlayerId() {
    if (!playerIdInput) return;
    try {
      localStorage.setItem(PLAYER_ID_STORAGE_KEY, playerIdInput.value.trim());
    } catch {
      /* ignore */
    }
  }

  function getResolvedPlayerId() {
    if (!playerIdInput) return DEFAULT_PLAYER_ID;
    return normalizePlayerId(playerIdInput.value) ?? DEFAULT_PLAYER_ID;
  }

  /**
   * 进入游戏时的局内玩家 ID：优先使用房间 transport 的真实 ID（Playroom 为平台分配 id，
   * 本地内存房间为创建/加入时确定的 id），与 `state.players` 的 key 一致；勿仅用输入框默认值。
   */
  function getGamePlayerIdForEnter() {
    if (typeof transport.getLocalPlayerId === "function") {
      const tid = transport.getLocalPlayerId();
      if (tid != null && String(tid).trim() !== "") {
        return String(tid);
      }
    }
    return getResolvedPlayerId();
  }

  /** 用于房间展示名 / 结算：优先输入框原文，否则规范化后的 id */
  function getDisplayNameForRoomForm() {
    if (playerIdInput && playerIdInput.value.trim()) return playerIdInput.value.trim();
    return getResolvedPlayerId();
  }

  /** 从当前房间会话构建玩家显示名（创建/加入时写入的 displayName）。 */
  function buildPlayerLabelsFromSession() {
    const sess = transport.getSession();
    if (!sess || !sess.players) return {};
    /** @type {Record<string, string>} */
    const out = {};
    for (const p of sess.players) {
      const dn =
        p.displayName != null && String(p.displayName).trim() !== "" ? String(p.displayName).trim() : p.id;
      out[p.id] = dn;
    }
    return out;
  }

  // 统一显示创建/加入房间 UI（本地内存房间）
  root.querySelectorAll(".local-only").forEach((el) => {
    el.classList.remove("hidden");
  });
  // 隐藏原来的 Playroom 联机按钮（改用创建/加入房间流程）
  if (btnPlayroomOnline) {
    btnPlayroomOnline.classList.add("hidden");
  }

  function showView(name) {
    setCurrentView(name);
    viewStart.classList.toggle("hidden", name !== "start");
    viewRoom.classList.toggle("hidden", name !== "room");
    viewGame.classList.toggle("hidden", name !== "game");
    if (orderLimitSection) {
      orderLimitSection.classList.toggle("hidden", !config.features?.limitOrders);
    }
    if (name === "game") renderGame();
    if (name === "room") renderRoom();
  }

  async function renderGame() {
    let state = getGameState();
    if (state.multiplayerWithBots && !state.gameEnded) {
      const prog = transport.getNextDayProgress(state);
      if (prog.total > 0 && prog.ready === prog.total) {
        dispatch({ type: "NEXT_DAY" });
        await Promise.resolve(transport.clearNextDayReady(true));
        state = getGameState();
      }
    }
    const player = getActivePlayer(state);
    const equity = computeEquity(state, config);
    const gameOver = !!state.gameEnded;
    if (!gameOver) {
      endModalDismissed = false;
    }
    const totalGameDays = config.rules?.totalGameDays ?? 28;
    const globalDay = state.globalDay ?? state.currentDay;

    const cashDisplay = viewGame.querySelector("#cashDisplay");
    const equityDisplay = viewGame.querySelector("#equityDisplay");
    const dayCounter = viewGame.querySelector("#dayCounter");
    const playerStatusDisplay = viewGame.querySelector("#playerStatusDisplay");
    const backpackSeedsRow = viewGame.querySelector("#backpackSeedsRow");
    const backpackCropsRow = viewGame.querySelector("#backpackCropsRow");
    const spotPoolDisplay = viewGame.querySelector("#spotPoolDisplay");
    if (cashDisplay) cashDisplay.textContent = player.cash.toFixed(2);
    if (equityDisplay) equityDisplay.textContent = equity.toFixed(2);
    if (dayCounter) {
      dayCounter.innerHTML = `第${globalDay}天 / ${totalGameDays}天 · 轮回第${state.currentDay}天 / 7`;
    }
    const weekDisplay = viewGame.querySelector("#weekDisplay");
    const debtDisplay = viewGame.querySelector("#debtDisplay");
    if (weekDisplay) weekDisplay.textContent = String(state.globalWeek ?? 1);
    if (debtDisplay) debtDisplay.textContent = (state.debt ?? 0).toLocaleString();
    if (playerStatusDisplay) {
      if (gameOver) {
        playerStatusDisplay.textContent = "已结束";
        playerStatusDisplay.style.color = "#9ed98b";
      } else {
        const st = player.status;
        playerStatusDisplay.textContent =
          st === "failed" || st === "eliminated" ? "已出局" : "进行中";
        playerStatusDisplay.style.color =
          st === "failed" || st === "eliminated" ? "#ff8a7a" : "#ffd966";
      }
    }
    if (backpackSeedsRow) {
      backpackSeedsRow.innerHTML = "";
      const seeds = config.commodities.filter((c) => c.type === "seed");
        const disabled = player.status === "failed" || player.status === "eliminated" || gameOver;
      for (const comm of seeds) {
        const n = player.backpack[comm.id] ?? 0;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "backpack-seed-btn";
        btn.setAttribute("data-seed-id", comm.id);
        btn.textContent = `${comm.name} ×${n}`;
        btn.disabled = disabled || n <= 0;
        backpackSeedsRow.appendChild(btn);
      }
    }
    if (backpackCropsRow) {
      backpackCropsRow.innerHTML = "";
      const crops = config.commodities.filter((c) => c.type === "crop");
      if (crops.length === 0) {
        backpackCropsRow.innerHTML = "<span style='opacity:0.7'>—</span>";
      } else {
        for (const comm of crops) {
          const n = player.backpack[comm.id] ?? 0;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "backpack-crop-btn";
          btn.setAttribute("data-crop-id", comm.id);
          btn.textContent = `${comm.name} ×${n}`;
          btn.disabled =
            player.status === "failed" || player.status === "eliminated" || n <= 0 || gameOver;
          backpackCropsRow.appendChild(btn);
        }
      }
    }
    if (spotPoolDisplay) {
      const crops = config.commodities.filter((c) => c.type === "crop");
      spotPoolDisplay.textContent = crops.map((c) => `${c.name} ${state.spotPool[c.id] ?? 0}`).join(" · ");
    }

    const tbody = viewGame.querySelector("#marketTbody");
    if (tbody) {
      tbody.innerHTML = "";
      for (const comm of futuresTradableCommodities(config)) {
        const id = comm.id;
        const price = state.prices[id];
        const pos = player.positions[id];
        const longQty = pos.long.qty;
        const shortQty = pos.short.qty;
        let floatPL = 0;
        if (longQty > 0) floatPL += (price - pos.long.avgPrice) * longQty;
        if (shortQty > 0) floatPL += (pos.short.avgPrice - price) * shortQty;
        const plColor = floatPL >= 0 ? "style='color:#b3ffbc'" : "style='color:#ffbe9f'";
        const tr = document.createElement("tr");
        tr.innerHTML = `
                <td class="commodity-name">${comm.name}</td>
                <td class="price">${price.toFixed(2)}</td>
                <td>${longQty > 0 ? longQty + " (均价:" + pos.long.avgPrice.toFixed(2) + ")" : "—"}</td>
                <td>${shortQty > 0 ? shortQty + " (均价:" + pos.short.avgPrice.toFixed(2) + ")" : "—"}</td>
                <td ${plColor}>${floatPL >= 0 ? "+" + floatPL.toFixed(2) : floatPL.toFixed(2)}</td>
                <td class="btn-group">
                    <button type="button" data-action="market-long" data-commodity-id="${id}">📈 开多</button>
                    <button type="button" data-action="market-short" data-commodity-id="${id}">📉 开空</button>
                    <button type="button" data-action="close-long" data-commodity-id="${id}">✅ 平多</button>
                    <button type="button" data-action="close-short" data-commodity-id="${id}">❌ 平空</button>
                </td>
            `;
        if (gameOver || player.status === "failed") {
          tr.querySelectorAll("button").forEach((b) => {
            b.disabled = true;
          });
        }
        tbody.appendChild(tr);
      }
    }

    const posDetailDiv = viewGame.querySelector("#positionsDetail");
    if (posDetailDiv) {
      posDetailDiv.innerHTML = "";
      for (const comm of futuresTradableCommodities(config)) {
        const id = comm.id;
        const longPos = player.positions[id].long;
        const shortPos = player.positions[id].short;
        if (longPos.qty === 0 && shortPos.qty === 0) continue;
        let text = `<span style="background:#2f3a24; border-radius:40px; padding:4px 10px;">${comm.name} : `;
        if (longPos.qty > 0) text += `多 ${longPos.qty}手 @${longPos.avgPrice.toFixed(2)}  `;
        if (shortPos.qty > 0) text += `空 ${shortPos.qty}手 @${shortPos.avgPrice.toFixed(2)}  `;
        text += `</span>`;
        posDetailDiv.innerHTML += text;
      }
      if (posDetailDiv.innerHTML === "") posDetailDiv.innerHTML = "<span style='opacity:0.7'>暂无持仓</span>";
    }

    if (config.features?.limitOrders) {
      const orderContainer = viewGame.querySelector("#orderListContainer");
      if (orderContainer) {
        if (!player.pendingOrders.length) {
          orderContainer.innerHTML = "<div style='color:#ac9e7e; text-align:center;'>暂无挂单</div>";
        } else {
          orderContainer.innerHTML = "";
          player.pendingOrders.forEach((order) => {
            const commObj = config.commodities.find((c) => c.id === order.commodityId);
            const name = commObj ? commObj.name : order.commodityId;
            const dirText = order.type === "long" ? "📈 买入开多" : "📉 卖出开空";
            const div = document.createElement("div");
            div.className = "order-item";
            div.innerHTML = `
                    <span><strong>${name}</strong> ${dirText}  ${order.quantity}手 @${order.price.toFixed(2)}</span>
                    <button type="button" class="cancelOrderBtn" data-action="cancel-order" data-order-id="${order.id}" style="background:#8b3c2c;" ${gameOver || player.status === "failed" ? "disabled" : ""}>✖️撤单</button>
                `;
            orderContainer.appendChild(div);
          });
        }
      }
    }

    const logPanel = viewGame.querySelector("#logPanel");
    if (logPanel) {
      logPanel.innerHTML =
        "📢 " + state.logEntries.map((l) => l).join("<br>📢 ") + (state.logEntries.length ? "<br>" : "");
      logPanel.scrollTop = 0;
    }

    const nextDayBtnEl = viewGame.querySelector("#nextDayBtn");
    if (nextDayBtnEl) {
      if (state.multiplayerWithBots && transport.getSession()) {
        const prog = transport.getNextDayProgress(state);
        nextDayBtnEl.textContent = `⏩ 下一天 (${prog.ready}/${prog.total})`;
        const me = transport.getLocalPlayerId();
        const pl = me ? state.players[me] : null;
        nextDayBtnEl.disabled = gameOver || pl?.status === "failed";
      } else {
        nextDayBtnEl.textContent = "⏩ 下一天 ➕";
        nextDayBtnEl.disabled = gameOver;
      }
    }
    const placeOrderBtnEl = viewGame.querySelector("#placeOrderBtn");
    if (placeOrderBtnEl) {
      placeOrderBtnEl.disabled = gameOver || player.status === "failed";
    }

    if (gameEndOverlay && gameEndRankList && gameEndSub) {
      if (gameOver && state.finalRanking && state.finalRanking.length && !endModalDismissed) {
        gameEndSub.textContent = `第 ${totalGameDays} 天交割结算已完成，背包作物已按市价强制卖出（种子保留）。最终排名按现金：`;
        const labels = state.playerLabels && typeof state.playerLabels === "object" ? state.playerLabels : {};
        gameEndRankList.innerHTML = state.finalRanking
          .map((r) => {
            const showName = labels[r.playerId] ?? r.playerId;
            return `<li>玩家 <span class="rank-id">${escapeHtml(showName)}</span> — 现金 <span class="rank-cash">¥${r.cash.toFixed(2)}</span></li>`;
          })
          .join("");
        gameEndOverlay.classList.remove("hidden");
        gameEndOverlay.setAttribute("aria-hidden", "false");
      } else {
        gameEndOverlay.classList.add("hidden");
        gameEndOverlay.setAttribute("aria-hidden", "true");
      }
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderRoom() {
    const s = transport.getSession();
    if (!s) {
      if (roomStatusEl) roomStatusEl.textContent = "";
      return;
    }
    if (roomIdEl) {
      roomIdEl.textContent = s.roomId;
    }
    if (roomPlayersEl) {
      roomPlayersEl.innerHTML = s.players
        .map((p) => {
          const local = transport.getLocalPlayerId() === p.id ? " (我)" : "";
          return `<div class="room-player">${p.displayName}${local} — ${p.ready ? "已就绪" : "未就绪"}</div>`;
        })
        .join("");
    }
    const host = transport.isHost();
    if (btnHostStart) {
      btnHostStart.style.display = host ? "inline-block" : "none";
    }
    if (roomStatusEl) {
      const base = s.gameStarted ? "游戏进行中" : "等待就绪";
      roomStatusEl.textContent = base;
    }
  }

  function promptQty(title, defaultVal) {
    const v = window.prompt(title, defaultVal);
    if (v == null || v === "") return null;
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0) return null;
    return Math.floor(n);
  }

  if (btnCreateRoom) {
    btnCreateRoom.addEventListener("click", async () => {
      persistPlayerId();
      try {
        await Promise.resolve(transport.createRoom(getDisplayNameForRoomForm()));
        showView("room");
      } catch (e) {
        console.error(e);
        alert(e instanceof Error ? e.message : "创建房间失败");
      }
    });
  }
  if (btnJoinRoom && joinRoomInput) {
    btnJoinRoom.addEventListener("click", async () => {
      persistPlayerId();
      const roomCode = joinRoomInput.value.trim();
      if (!roomCode) {
        alert("请输入房间号");
        return;
      }
      try {
        const r = await Promise.resolve(transport.joinRoom(roomCode, getDisplayNameForRoomForm()));
        if (!r.ok) {
          alert(r.error || "加入失败");
          return;
        }
        showView("room");
      } catch (e) {
        console.error(e);
        alert(e instanceof Error ? e.message : "加入失败");
      }
    });
  }
  if (btnSolo) {
    btnSolo.addEventListener("click", () => {
      persistPlayerId();
        const soloPid = getResolvedPlayerId();
        onEnterGame(soloPid, true, {
          playerLabels: { [soloPid]: getDisplayNameForRoomForm() },
        });
      showView("game");
    });
  }
  if (btnRoomReady) {
    btnRoomReady.addEventListener("click", async () => {
      const s = transport.getSession();
      const me = transport.getLocalPlayerId();
      if (!s || !me) return;
      const p = s.players.find((x) => x.id === me);
      try {
        await Promise.resolve(transport.setReady(!(p && p.ready)));
        renderRoom();
      } catch (e) {
        console.error(e);
      }
    });
  }
  if (btnRoomLeave) {
    btnRoomLeave.addEventListener("click", async () => {
      try {
        await Promise.resolve(transport.leaveRoom());
      } catch (e) {
        console.error(e);
      }
      showView("start");
    });
  }
  viewGame.addEventListener("click", (e) => {
    const seedBtn = /** @type {HTMLElement | null} */ (e.target).closest("button[data-seed-id]");
    if (seedBtn) {
      const seedId = seedBtn.getAttribute("data-seed-id");
      if (!seedId) return;
      const state = getGameState();
      const pl = getActivePlayer(state);
      const maxQ = pl.backpack[seedId] ?? 0;
      if (maxQ <= 0 || pl.status === "failed") return;
      const qty = promptQty(`使用种子数量 (最多 ${maxQ})`, "1");
      if (qty == null) return;
      if (qty > maxQ) {
        alert(`数量不能超过持有量 ${maxQ}`);
        return;
      }
      dispatch({ type: "USE_SEED", seedId, qty });
      renderGame();
      return;
    }

    const cropBtn = /** @type {HTMLElement | null} */ (e.target).closest("button[data-crop-id]");
    if (cropBtn) {
      const cropId = cropBtn.getAttribute("data-crop-id");
      if (!cropId) return;
      const state = getGameState();
      const pl = getActivePlayer(state);
      const maxQ = pl.backpack[cropId] ?? 0;
      if (maxQ <= 0 || pl.status === "failed") return;
      const price = state.prices[cropId];
      const qty = promptQty(`卖出现货数量 (最多 ${maxQ})，现价 ${price.toFixed(2)}`, "1");
      if (qty == null) return;
      if (qty > maxQ) {
        alert(`数量不能超过持有量 ${maxQ}`);
        return;
      }
      dispatch({ type: "SELL_CROP_SPOT", commodityId: cropId, qty });
      renderGame();
    }
  });

  if (btnHostStart) {
    btnHostStart.addEventListener("click", async () => {
      try {
        const r = await Promise.resolve(transport.hostStartGame());
        if (!r.ok) {
          alert(r.error || "无法开始");
          return;
        }
        persistPlayerId();
        const sess = transport.getSession();
        const humanPlayerIds = sess ? sess.players.map((p) => p.id) : [];
        onEnterGame(getGamePlayerIdForEnter(), false, {
          humanPlayerIds,
          multiplayerWithBots: true,
          playerLabels: buildPlayerLabelsFromSession(),
        });
        showView("game");
      } catch (e) {
        console.error(e);
        alert("无法开始游戏");
      }
    });
  }

  const marketTbody = viewGame.querySelector("#marketTbody");
  if (marketTbody) {
    marketTbody.addEventListener("click", (e) => {
      const btn = /** @type {HTMLElement | null} */ (e.target).closest("button[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const commodityId = btn.getAttribute("data-commodity-id");
      if (!commodityId) return;

      if (action === "market-long" || action === "market-short") {
        const dir = action === "market-long" ? "long" : "short";
        const gs = getGameState();
        const pl = getActivePlayer(gs);
        const px = gs.prices[commodityId] ?? 0;
        const mr = config.rules.marginRate;
        const maxHands =
          pl.status !== "failed" && px > 0 && pl.cash > 0 ? Math.floor(pl.cash / (mr * px)) : 0;
        const qty = promptQty(
          `输入开仓数量 (${dir === "long" ? "做多" : "做空"} 数量)，最大可开 ${maxHands} 手`,
          maxHands > 0 ? String(maxHands) : "1"
        );
        if (qty == null) return;
        dispatch({ type: "OPEN_MARKET", commodityId, direction: dir, qty });
        renderGame();
      } else if (action === "close-long" || action === "close-short") {
        const dir = action === "close-long" ? "long" : "short";
        const state = getGameState();
        const pl = getActivePlayer(state);
        const maxQ = pl.positions[commodityId][dir].qty;
        if (maxQ === 0) return;
        const qty = promptQty(`平仓数量 (最多${maxQ})`, String(maxQ));
        if (qty == null) return;
        dispatch({ type: "CLOSE", commodityId, direction: dir, qty });
        renderGame();
      }
    });
  }

  const orderListContainer = viewGame.querySelector("#orderListContainer");
  if (orderListContainer && config.features?.limitOrders) {
    orderListContainer.addEventListener("click", (e) => {
      const btn = /** @type {HTMLElement | null} */ (e.target).closest("button[data-action='cancel-order']");
      if (!btn) return;
      const id = parseInt(btn.getAttribute("data-order-id") || "", 10);
      if (isNaN(id)) return;
      dispatch({ type: "CANCEL_ORDER", orderId: id });
      renderGame();
    });
  }

  const nextDayBtn = viewGame.querySelector("#nextDayBtn");
  const resetGameBtn = viewGame.querySelector("#resetGameBtn");
  const placeOrderBtn = viewGame.querySelector("#placeOrderBtn");

  if (gameEndCloseBtn && gameEndOverlay) {
    gameEndCloseBtn.addEventListener("click", () => {
      endModalDismissed = true;
      gameEndOverlay.classList.add("hidden");
      gameEndOverlay.setAttribute("aria-hidden", "true");
    });
  }

  const btnGemBoard = viewGame.querySelector("#btnGemBoard");
  const btnLandUp = viewGame.querySelector("#btnLandUp");
  const btnLoan10 = viewGame.querySelector("#btnLoan10");
  if (btnGemBoard) {
    btnGemBoard.addEventListener("click", () => {
      dispatch({ type: "UNLOCK_GEM_BOARD" });
      void renderGame();
    });
  }
  if (btnLandUp) {
    btnLandUp.addEventListener("click", () => {
      dispatch({ type: "UPGRADE_LAND" });
      void renderGame();
    });
  }
  if (btnLoan10) {
    btnLoan10.addEventListener("click", () => {
      dispatch({ type: "TAKE_LOAN", tier: "10w" });
      void renderGame();
    });
  }

  if (nextDayBtn) {
    nextDayBtn.addEventListener("click", async () => {
      const gs = getGameState();
      if (gs.multiplayerWithBots) {
        const me = transport.getLocalPlayerId();
        const s = transport.getSession();
        if (!me || !s) return;
        const pl = gs.players[me];
        if (pl?.status === "failed") return;
        const cur = !!s.nextDayReady?.[me];
        try {
          await Promise.resolve(transport.setNextDayReady(!cur));
          void renderGame();
        } catch (e) {
          console.error(e);
        }
        return;
      }
      dispatch({ type: "NEXT_DAY" });
      void renderGame();
    });
  }
  if (resetGameBtn) {
    resetGameBtn.addEventListener("click", () => {
      dispatch({ type: "RESET" });
      renderGame();
    });
  }
  if (placeOrderBtn && config.features?.limitOrders) {
    placeOrderBtn.addEventListener("click", () => {
      const commodityEl = /** @type {HTMLSelectElement | null} */ (viewGame.querySelector("#orderCommodity"));
      const dirEl = /** @type {HTMLSelectElement | null} */ (viewGame.querySelector("#orderDirection"));
      const priceEl = /** @type {HTMLInputElement | null} */ (viewGame.querySelector("#orderPrice"));
      const qtyEl = /** @type {HTMLInputElement | null} */ (viewGame.querySelector("#orderQty"));
      if (!commodityEl || !dirEl || !priceEl || !qtyEl) return;
      const commodityId = commodityEl.value;
      const direction = /** @type {'long'|'short'} */ (dirEl.value);
      const price = parseFloat(priceEl.value);
      const qty = parseFloat(qtyEl.value);
      dispatch({ type: "PLACE_LIMIT", commodityId, direction, price, qty });
      renderGame();
    });
  }

  transport.onStateChange(() => {
    const s = transport.getSession();
    // 检测到游戏已开始且当前在房间界面，自动切换到游戏（非房主）
    if (roomModeEnabled && s?.gameStarted && getCurrentView() === "room" && !transport.isHost()) {
      const me = transport.getLocalPlayerId();
      const humanPlayerIds = s.players.map((p) => p.id);
      onEnterGame(getGamePlayerIdForEnter(), false, {
        humanPlayerIds,
        multiplayerWithBots: true,
        playerLabels: buildPlayerLabelsFromSession(),
      });
      showView("game");
      return;
    }
    if (getCurrentView() === "room") {
      renderRoom();
    }
    if (getCurrentView() === "game") renderGame();
  });

  showView("start");

  return { showView, renderGame, renderRoom };
}
