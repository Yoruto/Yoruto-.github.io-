# Firebase 房间与游戏同步配置

1. **Firebase 控制台**（本项目使用 [firebase-config.js](js/firebase-config.js)）
   - 启用 **Authentication** → **匿名**（Anonymous）
   - 启用 **Firestore Database**

2. **部署 Firestore 规则**  
   将 [firestore.rules](firestore.rules) 复制到控制台 → Firestore → 规则 → **发布**。  
   规则覆盖：
   - `rooms/{roomId}`：房间元数据（玩家列表、`gameStarted`、`nextDayReady` 等）
   - `rooms/{roomId}/sharedState/current`：房主写入的整局游戏状态 JSON（`payload` + `version`）
   - `rooms/{roomId}/intents/{intentId}`：非房主提交的操作意图，由房主消费后删除

3. **索引**  
   若控制台提示 `intents` 查询需要 **复合索引**，按错误里的链接一键创建（一般为 `createdAt` 升序）。

4. **房间后端**（默认 Firestore 联机）
   - 默认使用 Firestore；无需在 URL 加参数。
   - 仅本地调试、不连 Firebase：URL `?mp=local`，或 `localStorage.setItem('futures-game:roomBackend', 'local')` 后刷新。

5. **行为说明**
   - 房主点击「开始游戏」后，**全员**进入游戏界面（依赖 `gameStarted` 快照）。
   - **房主**执行 `reduce` 并写入 `sharedState`；**非房主**通过 `intents` 提交操作，由房主应用后再同步。
   - 「下一天」全员准备后，仅**房主**执行 `NEXT_DAY`，其他人通过 `sharedState` 快照更新。

6. **API 密钥**  
   可在 Google Cloud Console 中为浏览器密钥设置 **HTTP 引用来源**。
