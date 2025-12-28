// 狼人杀游戏客户端
class WerewolfClient {
  constructor() {
    this.ws = null;
    this.userId = this.getOrCreateUserId();
    this.userName = '';
    this.currentRoom = null;
    this.isHost = false;
    this.myRole = null;
    this.selectedTarget = null;

    this.init();
  }

  init() {
    this.bindElements();
    this.bindEvents();
    this.connect();

    // 游戏中刷新时提示确认
    window.addEventListener('beforeunload', (e) => {
      if (this.currentRoom && this.myRole) {
        e.preventDefault();
        e.returnValue = '游戏正在进行中，确定要刷新页面吗？';
        return e.returnValue;
      }
    });
  }

  bindElements() {
    // 屏幕
    this.screens = {
      lobby: document.getElementById('lobby'),
      room: document.getElementById('room'),
      game: document.getElementById('game')
    };

    // 大厅元素
    this.loginForm = document.getElementById('loginForm');
    this.lobbyActions = document.getElementById('lobbyActions');
    this.playerNameInput = document.getElementById('playerName');
    this.displayName = document.getElementById('displayName');
    this.roomIdInput = document.getElementById('roomIdInput');

    // 房间元素
    this.roomIdDisplay = document.getElementById('roomId');
    this.playersList = document.getElementById('playersList');
    this.hostActions = document.getElementById('hostActions');

    // 游戏元素
    this.dayNumber = document.getElementById('dayNumber');
    this.phaseIcon = document.getElementById('phaseIcon');
    this.phaseName = document.getElementById('phaseName');
    this.myRoleDisplay = document.getElementById('myRole');
    this.playersGrid = document.getElementById('playersGrid');
    this.actionPanel = document.getElementById('actionPanel');
    this.actionTitle = document.getElementById('actionTitle');
    this.actionTargets = document.getElementById('actionTargets');
    this.votePanel = document.getElementById('votePanel');
    this.voteCandidates = document.getElementById('voteCandidates');
    this.messages = document.getElementById('messages');
    this.chatInput = document.getElementById('chatInput');
    this.sendChatBtn = document.getElementById('sendChatBtn');

    // 默认禁用聊天输入
    this.setChatEnabled(false);

    // 游戏结束
    this.winnerText = document.getElementById('winnerText');
    this.winReason = document.getElementById('winReason');
    this.finalRoles = document.getElementById('finalRoles');

    // 猎人弹窗
    this.hunterModal = document.getElementById('hunterModal');
    this.hunterTargets = document.getElementById('hunterTargets');

    // Toast
    this.toast = document.getElementById('toast');

    // 结果弹窗
    this.resultModal = document.getElementById('resultModal');
    this.resultTitle = document.getElementById('resultTitle');
    this.resultMessage = document.getElementById('resultMessage');
    this.closeResultBtn = document.getElementById('closeResultBtn');

    // 倒计时显示
    this.countdownDisplay = document.getElementById('countdown');

    // 房间列表
    this.roomList = document.getElementById('roomList');
  }

  bindEvents() {
    // 大厅
    document.getElementById('joinBtn').addEventListener('click', () => this.join());
    document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
    document.getElementById('joinRoomBtn').addEventListener('click', () => this.joinRoom());
    document.getElementById('refreshRoomsBtn').addEventListener('click', () => this.refreshRooms());

    // 支持回车键
    this.playerNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.join();
    });
    this.roomIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.joinRoom();
    });

    // 房间
    document.getElementById('leaveRoomBtn').addEventListener('click', () => this.leaveRoom());
    document.getElementById('addAIBtn').addEventListener('click', () => this.addAI());
    document.getElementById('removeAIBtn').addEventListener('click', () => this.removeAI());
    document.getElementById('startGameBtn').addEventListener('click', () => this.startGame());

    // 游戏
    document.getElementById('confirmActionBtn').addEventListener('click', () => this.confirmAction());
    document.getElementById('skipActionBtn').addEventListener('click', () => this.skipAction());
    document.getElementById('confirmVoteBtn').addEventListener('click', () => this.confirmVote());
    document.getElementById('sendChatBtn').addEventListener('click', () => this.sendChat());
    document.getElementById('pauseGameBtn').addEventListener('click', () => this.pauseGame());
    document.getElementById('resumeGameBtn').addEventListener('click', () => this.resumeGame());
    document.getElementById('exitGameBtn').addEventListener('click', () => this.exitGame());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    // 猎人
    document.getElementById('hunterShootBtn').addEventListener('click', () => this.hunterShoot());

    // 结果弹窗
    if (this.closeResultBtn) {
      this.closeResultBtn.addEventListener('click', () => {
        this.resultModal.style.display = 'none';
      });
    }

    // 游戏结束
    document.getElementById('viewHistoryBtn').addEventListener('click', () => this.viewHistory());
    document.getElementById('backToLobbyBtn').addEventListener('click', () => this.backToLobby());
  }

  // WebSocket 连接
  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

    // 显示连接中状态
    this.showConnectionStatus('connecting');

    this.ws = new WebSocket(`${protocol}://${window.location.host}`);

    this.ws.onopen = () => {
      console.log('WebSocket 连接成功');
      this.showConnectionStatus('connected');

      // 尝试恢复会话
      const savedName = localStorage.getItem('playerName');

      if (savedName) {
        this.userName = savedName;
        this.playerNameInput.value = savedName;

        // 自动重新加入 - 服务器会自动恢复房间状态
        this.send('join', { userId: this.userId, name: savedName });
      }
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    this.ws.onclose = () => {
      console.log('WebSocket 连接关闭');
      this.showConnectionStatus('disconnected');
      this.showToast('连接断开，正在重连...', 'error');
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket 错误:', error);
      this.showConnectionStatus('error');
    };
  }

  // 显示连接状态
  showConnectionStatus(status) {
    let overlay = document.getElementById('connectionOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'connectionOverlay';
      overlay.innerHTML = `
        <div class="connection-content">
          <div class="connection-spinner"></div>
          <div class="connection-text">连接中...</div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const text = overlay.querySelector('.connection-text');

    if (status === 'connecting') {
      overlay.style.display = 'flex';
      text.textContent = '连接中...';
    } else if (status === 'connected') {
      overlay.style.display = 'none';
    } else if (status === 'disconnected') {
      overlay.style.display = 'flex';
      text.textContent = '连接断开，重连中...';
    } else if (status === 'error') {
      overlay.style.display = 'flex';
      text.textContent = '连接失败，重试中...';
    }
  }

  // 获取或创建用户 ID
  getOrCreateUserId() {
    let userId = localStorage.getItem('userId');
    if (!userId) {
      userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('userId', userId);
    }
    return userId;
  }

  // 发送消息
  send(type, data = {}) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  // 处理服务器消息
  handleMessage(message) {
    const { type, data } = message;

    switch (type) {
      case 'joined':
        this.onJoined(data);
        break;
      case 'room_state':
        this.onRoomState(data);
        break;
      case 'left_room':
        this.onLeftRoom();
        break;
      case 'game_started':
        this.onGameStarted(data);
        break;
      case 'phase_change':
        this.onPhaseChange(data);
        break;
      case 'action_required':
        this.onActionRequired(data);
        break;
      case 'action_result':
        this.onActionResult(data);
        break;
      case 'vote_result':
        this.onVoteResult(data);
        break;
      case 'chat':
        this.onChat(data);
        break;
      case 'wolf_chat':
        this.onWolfChat(data);
        break;
      case 'hunter_shot':
        this.onHunterShot(data);
        break;
      case 'hunter_shot_result':
        this.onHunterShotResult(data);
        break;
      case 'game_ended':
        this.onGameEnded(data);
        break;
      case 'countdown':
        this.onCountdown(data);
        break;
      case 'room_list':
        this.onRoomList(data);
        break;
      case 'game_paused':
        this.onGamePaused(data);
        break;
      case 'game_resumed':
        this.onGameResumed(data);
        break;
      case 'exited_game':
        this.onExitedGame();
        break;
      case 'player_exited':
        this.onPlayerExited(data);
        break;
      case 'speaking_turn':
        this.onSpeakingTurn(data);
        break;
      case 'room_closed':
        this.onRoomClosed(data);
        break;
      case 'error':
        this.showToast(message.message, 'error');
        break;
    }
  }

  // 加入游戏
  join() {
    const name = this.playerNameInput.value.trim();
    if (!name) {
      this.showToast('请输入昵称', 'error');
      return;
    }

    this.userName = name;
    localStorage.setItem('playerName', name);
    this.send('join', { userId: this.userId, name });
  }

  onJoined(data) {
    this.loginForm.style.display = 'none';
    this.lobbyActions.style.display = 'flex';
    this.displayName.textContent = data.name;

    // 如果服务器返回了 roomId，保存它（用于后续可能的重连）
    if (data.roomId) {
      localStorage.setItem('currentRoom', data.roomId);
    }

    this.showToast('欢迎回来！', 'success');

    // 自动刷新房间列表
    this.refreshRooms();
  }

  // 刷新房间列表
  refreshRooms() {
    this.send('get_rooms');
  }

  // 房间列表响应
  onRoomList(data) {
    const { rooms } = data;

    if (!this.roomList) return;

    if (rooms.length === 0) {
      this.roomList.innerHTML = '<p class="no-rooms">暂无可用房间，创建一个吧！</p>';
    } else {
      this.roomList.innerHTML = rooms
        .map(
          (room) => `
                <div class="room-item">
                    <div class="room-info">
                        <span class="room-id">${room.roomId}</span>
                        <span class="room-players">房主: ${room.hostName} | ${room.playerCount} 人</span>
                    </div>
                    <button class="join-btn" onclick="client.joinRoomById('${room.roomId}')">加入</button>
                </div>
            `
        )
        .join('');
    }
  }

  // 通过房间ID加入
  joinRoomById(roomId) {
    this.send('join_room', { roomId });
  }

  // 创建房间
  createRoom() {
    this.send('create_room');
  }

  // 加入房间
  joinRoom() {
    const roomId = this.roomIdInput.value.trim().toUpperCase();
    if (!roomId) {
      this.showToast('请输入房间号', 'error');
      return;
    }
    this.send('join_room', { roomId });
  }

  onRoomState(data) {
    this.currentRoom = data.roomId;
    this.isHost = data.hostId === this.userId;
    this.myRole = data.myRole;

    // 保存房间信息用于重连
    localStorage.setItem('currentRoom', data.roomId);

    if (data.state === 'waiting') {
      this.showScreen('room');
      this.roomIdDisplay.textContent = data.roomId;
      this.hostActions.style.display = this.isHost ? 'flex' : 'none';
      this.updatePlayersList(data.players, data.hostId);
    } else if (data.state === 'playing') {
      this.showScreen('game');
      this.updateGameUI(data);
    }
  }

  updatePlayersList(players, hostId) {
    this.playersList.innerHTML = '';
    const playerCount = players.length;

    players.forEach((player) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="player-name">${player.name}</span>
        ${player.id === hostId ? '<span class="player-tag host">房主</span>' : ''}
        ${player.isAI ? '<span class="player-tag ai">AI</span>' : ''}
        ${!player.isOnline ? '<span class="player-tag">离线</span>' : ''}
      `;
      this.playersList.appendChild(li);
    });

    if (this.isHost) {
      const startGameBtn = document.getElementById('startGameBtn');
      const addAIBtn = document.getElementById('addAIBtn');
      const removeAIBtn = document.getElementById('removeAIBtn');

      if (startGameBtn) {
        const validCounts = [6, 8, 9, 10, 12];
        const isValid = validCounts.includes(playerCount);
        startGameBtn.disabled = !isValid;
        startGameBtn.title = isValid ? '开始游戏' : `人数不足或不支持（当前 ${playerCount} 人，支持 6, 8, 9, 10, 12 人）`;
      }

      const aiPlayers = players.filter((p) => p.isAI);

      if (addAIBtn) {
        addAIBtn.disabled = playerCount >= 12;
        addAIBtn.title = playerCount >= 12 ? '房间已满（最多 12 人）' : '添加 AI 玩家';
      }

      if (removeAIBtn) {
        removeAIBtn.disabled = aiPlayers.length === 0;
        removeAIBtn.title = aiPlayers.length === 0 ? '没有可以移除的 AI' : '减少 AI 玩家';
      }
    }
  }

  // 离开房间
  leaveRoom() {
    this.send('leave_room');
  }

  onLeftRoom() {
    this.currentRoom = null;
    localStorage.removeItem('currentRoom');
    this.showScreen('lobby');
    this.showToast('已离开房间');
  }

  // 添加 AI
  addAI() {
    this.send('add_ai');
  }

  removeAI() {
    this.send('remove_ai');
  }

  // 开始游戏
  startGame() {
    this.send('start_game');
  }

  onGameStarted(data) {
    this.myRole = data.role;
    this.showScreen('game');
    this.myRoleDisplay.textContent = `你是 ${data.role}`;
    this.updatePlayersGrid(data.players);
    this.addSystemMessage(`游戏开始！你的角色是 ${data.role}。${data.roleDescription}`);
    this.showToast(`你的角色是：${data.role}`, 'success');
  }

  onPhaseChange(data) {
    const { phase, dayNumber, deaths, candidates, discussionTime, voteTime } = data;

    // 修复 dayNumber undefined 问题
    const day = dayNumber || this.currentDayNumber || 1;
    this.currentDayNumber = day;
    this.dayNumber.textContent = `第 ${day} 天`;

    if (phase === 'night') {
      this.phaseIcon.textContent = '🌙';
      this.phaseName.textContent = '夜晚';
      this.addSystemMessage(`第 ${day} 夜开始，请闭眼。`);
      this.votePanel.style.display = 'none';
      this.hideCountdown();
    } else if (phase === 'day') {
      this.phaseIcon.textContent = '☀️';
      this.phaseName.textContent = '白天';
      this.actionPanel.style.display = 'none';

      if (deaths && deaths.length > 0) {
        deaths.forEach((d) => {
          const player = document.querySelector(`[data-player-id="${d.id}"]`);
          if (player) {
            player.classList.add('dead');
          }
          // 如果死亡的是我自己，更新存活状态
          if (d.id === this.userId) {
            this.myIsAlive = false;
          }
        });
      }
    } else if (phase === 'vote') {
      this.phaseIcon.textContent = '🗳️';
      this.phaseName.textContent = '投票';
      // 只有存活玩家才能投票
      if (this.myIsAlive !== false) {
        this.showVotePanel(candidates);
      }
    }

    // 切换阶段时默认禁用聊天，除非是狼人夜晚
    if (phase === 'night' && this.myRole === '狼人') {
      this.setChatEnabled(true);
      this.chatInput.placeholder = '狼人频道讨论中...';
    } else {
      this.setChatEnabled(false);
    }
  }

  // 倒计时处理
  onCountdown(data) {
    const seconds = data.seconds;
    if (seconds > 0) {
      this.showCountdown(seconds);
    } else {
      this.hideCountdown();
    }
  }

  showCountdown(seconds) {
    if (this.countdownDisplay) {
      this.countdownDisplay.textContent = `‣ ${seconds}秒`;
      this.countdownDisplay.style.display = 'inline-block';
    }
  }

  hideCountdown() {
    if (this.countdownDisplay) {
      this.countdownDisplay.style.display = 'none';
    }
  }

  onActionRequired(data) {
    const { role, possibleTargets } = data;

    this.actionPanel.style.display = 'block';
    document.getElementById('noActionPlaceholder').style.display = 'none';

    const roleActions = {
      wolf: '选择今晚要击杀的目标',
      seer: '选择要查验的玩家',
      witch: '选择使用药水',
      guard: '选择要守护的玩家'
    };

    this.actionTitle.textContent = roleActions[role] || '请选择目标';
    this.actionTargets.innerHTML = '';
    this.selectedTarget = null;

    if (role === 'witch') {
      this.renderWitchUI(possibleTargets);
    } else {
      possibleTargets.forEach((target) => {
        const btn = document.createElement('button');
        btn.className = 'target-btn';
        btn.textContent = target.label || target.name;
        btn.dataset.id = target.id;
        btn.dataset.action = target.action || role;
        btn.addEventListener('click', () => {
          this.actionTargets.querySelectorAll('.target-btn').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.selectedTarget = { id: target.id, action: btn.dataset.action };
        });
        this.actionTargets.appendChild(btn);
      });
    }
  }

  renderWitchUI(targets) {
    const container = document.createElement('div');
    container.className = 'witch-actions';

    // 解药区域
    const saveTarget = targets.find((t) => t.action === 'save');
    if (saveTarget) {
      const saveSection = document.createElement('div');
      saveSection.className = 'witch-section';
      saveSection.innerHTML = `<h4>💊 解药</h4><p>昨晚死亡：<strong>${saveTarget.name}</strong></p>`;

      const btn = document.createElement('button');
      btn.className = 'target-btn save-btn';
      btn.textContent = '救活'; // 简化文本
      btn.onclick = () => {
        this.selectWitchAction(btn, { id: saveTarget.id, action: 'save' });
      };
      saveSection.appendChild(btn);
      container.appendChild(saveSection);
    }

    // 毒药区域
    const poisonTargets = targets.filter((t) => t.action === 'poison');
    if (poisonTargets.length > 0) {
      const poisonSection = document.createElement('div');
      poisonSection.className = 'witch-section';
      poisonSection.innerHTML = `<h4>☠️ 毒药</h4>`;

      const grid = document.createElement('div');
      grid.className = 'witch-targets-grid';

      poisonTargets.forEach((target) => {
        const btn = document.createElement('button');
        btn.className = 'target-btn poison-btn';
        btn.textContent = target.name; // 只显示名字
        btn.onclick = () => {
          this.selectWitchAction(btn, { id: target.id, action: 'poison' });
        };
        grid.appendChild(btn);
      });
      poisonSection.appendChild(grid);
      container.appendChild(poisonSection);
    }

    this.actionTargets.appendChild(container);
  }

  selectWitchAction(btn, target) {
    // 清除所有选中状态
    this.actionTargets.querySelectorAll('.target-btn').forEach((b) => b.classList.remove('selected'));
    // 选中当前按钮
    btn.classList.add('selected');
    this.selectedTarget = target;
  }

  confirmAction() {
    if (!this.selectedTarget) {
      this.showToast('请选择目标', 'error');
      return;
    }

    this.send('game_action', {
      action: this.selectedTarget.action,
      target: this.selectedTarget.id
    });

    this.actionPanel.style.display = 'none';
    this.updatePlaceholderVisibility();
    this.selectedTarget = null;
  }

  skipAction() {
    this.send('game_action', { action: 'none' });
    this.actionPanel.style.display = 'none';
    this.updatePlaceholderVisibility();
  }

  onActionResult(data) {
    this.addSystemMessage(`[系统] ${data.message}`);

    // 如果有具体消息，显示弹窗（特别是预言家查验结果）
    if (data.message) {
      this.showResultModal('行动结果', data.message);
    }
  }

  showResultModal(title, message) {
    if (this.resultTitle) this.resultTitle.textContent = title;
    if (this.resultMessage) this.resultMessage.textContent = message;
    if (this.resultModal) this.resultModal.style.display = 'flex';
  }

  showVotePanel(candidates) {
    this.votePanel.style.display = 'block';
    document.getElementById('noActionPlaceholder').style.display = 'none';
    this.voteCandidates.innerHTML = '';
    this.selectedTarget = null;

    candidates.forEach((candidate) => {
      // 不能投给自己
      if (candidate.id === this.userId) return;

      const btn = document.createElement('button');
      btn.className = 'vote-btn';
      btn.textContent = candidate.name;
      btn.dataset.id = candidate.id;
      btn.addEventListener('click', () => {
        this.voteCandidates.querySelectorAll('.vote-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedTarget = candidate.id;
      });
      this.voteCandidates.appendChild(btn);
    });
  }

  confirmVote() {
    if (!this.selectedTarget) {
      this.showToast('请选择投票目标', 'error');
      return;
    }

    this.send('game_action', {
      action: 'vote',
      target: this.selectedTarget
    });

    this.votePanel.style.display = 'none';
    this.updatePlaceholderVisibility();
    this.selectedTarget = null;
    this.showToast('投票成功');
  }

  // 更新暂无操作占位符的显示状态
  updatePlaceholderVisibility() {
    const placeholder = document.getElementById('noActionPlaceholder');
    const actionVisible = this.actionPanel.style.display !== 'none';
    const voteVisible = this.votePanel.style.display !== 'none';

    if (!actionVisible && !voteVisible) {
      placeholder.style.display = 'flex';
    } else {
      placeholder.style.display = 'none';
    }
  }

  onVoteResult(data) {
    const { eliminated, revealed, voteCount } = data;

    // 显示投票统计
    const voteInfo = Object.entries(voteCount)
      .map(([id, count]) => `${count}票`)
      .join(', ');

    if (revealed) {
      this.addSystemMessage(`${revealed.name} 是 ${revealed.role}，展示身份后免于放逐！`);
    } else if (eliminated) {
      this.addSystemMessage(`投票结果: ${eliminated.name} 被放逐了。`);
      const card = document.querySelector(`[data-player-id="${eliminated.id}"]`);
      if (card) card.classList.add('dead');
    } else {
      this.addSystemMessage('投票平票，没有人被放逐。');
    }
  }

  onSpeakingTurn(data) {
    const { playerId, playerName, isHuman, timeout } = data;

    // 清除之前所有发言高亮
    document.querySelectorAll('.player-card').forEach((card) => card.classList.remove('speaking'));

    // 高亮当前发言者卡片
    const currentCard = document.querySelector(`[data-player-id="${playerId}"]`);
    if (currentCard) {
      currentCard.classList.add('speaking');
    }

    // 如果是自己发言
    if (isHuman && playerName === this.userName) {
      this.showSpeakPanel(timeout);
      this.addSystemMessage(`轮到你了！请发言... (限时 ${timeout} 秒)`);
      this.showToast('轮到你了，请发言！', 'info');
      this.setChatEnabled(true);
    } else {
      this.hideSpeakPanel();
      this.addSystemMessage(`等待 ${playerName} 发言...`);
      this.setChatEnabled(false);
    }
  }

  showSpeakPanel(timeout) {
    // 创建或显示发言控制面板
    let panel = document.getElementById('speak-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'speak-panel';
      panel.className = 'vote-panel'; // 复用样式
      panel.innerHTML = `
                <h3>🎙️ 轮到你发言</h3>
                <div class="speak-controls">
                    <div id="speak-timer">剩余时间: ${timeout}s</div>
                    <p class="speak-hint">你可以发送多条消息，说完请点击结束</p>
                    <button id="end-speech-btn" class="action-btn">结束发言</button>
                </div>
            `;
      // 插入到操作区域容器中
      const container = document.querySelector('.panels-container');
      // 确保没有其他面板显示
      this.actionPanel.style.display = 'none';
      this.votePanel.style.display = 'none';
      container.appendChild(panel);

      document.getElementById('end-speech-btn').onclick = () => this.endSpeech();
    } else {
      panel.style.display = 'block';
      this.actionPanel.style.display = 'none';
      this.votePanel.style.display = 'none';
      // 更新定时器显示
      const timer = document.getElementById('speak-timer');
      if (timer) timer.textContent = `剩余时间: ${timeout}s`;
    }

    // 开始倒计时
    this.startSpeakTimer(timeout);
  }

  hideSpeakPanel() {
    const panel = document.getElementById('speak-panel');
    if (panel) {
      panel.style.display = 'none';
    }
    this.stopSpeakTimer();
  }

  startSpeakTimer(seconds) {
    this.stopSpeakTimer();
    let remaining = seconds;
    const timerDisplay = document.getElementById('speak-timer');

    this.speakTimerInterval = setInterval(() => {
      remaining--;
      if (timerDisplay) timerDisplay.textContent = `剩余时间: ${remaining}s`;

      if (remaining <= 0) {
        this.stopSpeakTimer();
        this.hideSpeakPanel(); // 超时自动隐藏
      }
    }, 1000);
  }

  stopSpeakTimer() {
    if (this.speakTimerInterval) {
      clearInterval(this.speakTimerInterval);
      this.speakTimerInterval = null;
    }
  }

  endSpeech() {
    this.sendChat('game_action', { action: 'end_speech' }); // Assuming send handles type correctly, but logic below says send takes type
    // Wait, sendChat is for chat messages. logic uses 'send'.
    // Correcting to use this.send
    this.send('game_action', { action: 'end_speech' });
    this.hideSpeakPanel();
    this.setChatEnabled(false);
    this.showToast('发言结束');
  }

  setChatEnabled(enabled) {
    if (this.chatInput) {
      this.chatInput.disabled = !enabled;
      this.chatInput.placeholder = enabled ? '发送消息...' : '当前无法发言';
    }
    if (this.sendChatBtn) {
      this.sendChatBtn.disabled = !enabled;
    }
  }

  // 聊天
  sendChat() {
    const message = this.chatInput.value.trim();
    if (!message) return;

    this.send('chat', { message });
    this.chatInput.value = '';
  }

  onChat(data) {
    const { from, message } = data;

    if (from === 'host') {
      this.addHostMessage(message);
    } else if (from === 'system') {
      this.addSystemMessage(message);
    } else {
      this.addMessage(from, message);
    }
  }

  onWolfChat(data) {
    this.addMessage(`[狼人] ${data.from}`, data.message, 'wolf');
  }

  addMessage(from, content, type = '') {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.innerHTML = `<div class="sender">${from}</div><div class="content">${content}</div>`;
    this.messages.appendChild(div);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  addSystemMessage(content) {
    const div = document.createElement('div');
    div.className = 'message system';
    div.innerHTML = `<div class="content">${content}</div>`;
    this.messages.appendChild(div);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  // 添加主持人消息
  addHostMessage(content) {
    const div = document.createElement('div');
    div.className = 'message host';
    div.innerHTML = `<div class="content">${content}</div>`;
    this.messages.appendChild(div);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  // 猎人
  onHunterShot(data) {
    this.hunterModal.style.display = 'flex';
    this.hunterTargets.innerHTML = '';
    this.selectedTarget = null;

    data.targets.forEach((target) => {
      const btn = document.createElement('button');
      btn.className = 'target-btn';
      btn.textContent = target.name;
      btn.dataset.id = target.id;
      btn.addEventListener('click', () => {
        this.hunterTargets.querySelectorAll('.target-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedTarget = target.id;
      });
      this.hunterTargets.appendChild(btn);
    });
  }

  hunterShoot() {
    if (!this.selectedTarget) {
      this.showToast('请选择开枪目标', 'error');
      return;
    }

    this.send('game_action', {
      action: 'hunter_shoot',
      target: this.selectedTarget
    });

    this.hunterModal.style.display = 'none';
  }

  onHunterShotResult(data) {
    this.addSystemMessage(`猎人 ${data.hunter} 开枪带走了 ${data.target}！`);
    const card = document.querySelector(`[data-player-id="${data.targetId}"]`);
    if (card) card.classList.add('dead');
  }

  // 游戏结束
  onGameEnded(data) {
    // 显示游戏结束覆盖层（不切换屏幕）
    const modal = document.getElementById('gameOverModal');
    if (modal) modal.style.display = 'flex';

    const isWolfWin = data.winner === 'wolf';
    this.winnerText.textContent = isWolfWin ? '🐺 狼人阵营获胜！' : '👥 好人阵营获胜！';
    this.winnerText.className = isWolfWin ? 'wolf-win' : 'villager-win';
    this.winReason.textContent = data.reason;

    this.finalRoles.innerHTML = '';
    data.players.forEach((player) => {
      const div = document.createElement('div');
      div.className = `player-result ${player.isAlive ? '' : 'dead'}`;
      div.innerHTML = `
        <div class="name">${player.name} ${player.isAlive ? '' : '💀'}</div>
        <div class="role">${player.role}</div>
      `;
      this.finalRoles.appendChild(div);
    });
  }

  // 关闭游戏结束弹窗（查看复盘）
  viewHistory() {
    const modal = document.getElementById('gameOverModal');
    if (modal) modal.style.display = 'none';
  }

  backToLobby() {
    // 隐藏游戏结束弹窗
    const modal = document.getElementById('gameOverModal');
    if (modal) modal.style.display = 'none';

    this.currentRoom = null;
    this.myRole = null;
    this.currentDayNumber = 1;
    localStorage.removeItem('currentRoom');
    this.messages.innerHTML = '';
    this.showScreen('lobby');
  }

  // 更新玩家网格
  updatePlayersGrid(players) {
    this.playersGrid.innerHTML = '';
    players.forEach((player) => {
      const card = document.createElement('div');
      card.className = `player-card ${player.isAlive ? '' : 'dead'}`;
      card.dataset.playerId = player.id;

      const avatar = player.isAI ? '🤖' : '👤';
      card.innerHTML = `
        <div class="avatar">${avatar}</div>
        <div class="name">${player.name}</div>
        <div class="status">${player.isAlive ? '存活' : '死亡'}</div>
      `;
      this.playersGrid.appendChild(card);
    });
  }

  updateGameUI(data) {
    this.currentDayNumber = data.dayNumber || 1;
    this.dayNumber.textContent = `第 ${this.currentDayNumber} 天`;

    if (data.myRole) {
      this.myRole = data.myRole;
      this.myRoleDisplay.textContent = `你是 ${data.myRole}`;

      // 如果有角色描述，在聊天窗口添加欢迎消息（如果还没有）
      if (data.myRoleDescription && data.state === 'playing') {
        const welcomeMsg = `游戏开始！你的角色是 ${data.myRole}。${data.myRoleDescription}`;
        // 检查是否已经有这条消息，避免重复
        const existingMsgs = this.messages.querySelectorAll('.system-message');
        let alreadyShown = false;
        existingMsgs.forEach((msg) => {
          if (msg.textContent.includes('游戏开始！你的角色是')) {
            alreadyShown = true;
          }
        });
        if (!alreadyShown) {
          this.addSystemMessage(welcomeMsg);
        }
      }
    }

    // 恢复阶段显示
    if (data.currentPhase === 'night') {
      this.phaseIcon.textContent = '🌙';
      this.phaseName.textContent = '夜晚';
    } else if (data.currentPhase === 'day') {
      this.phaseIcon.textContent = '☀️';
      this.phaseName.textContent = '白天';
    } else if (data.currentPhase === 'vote') {
      this.phaseIcon.textContent = '🗳️';
      this.phaseName.textContent = '投票';
    }

    // 更新界面时根据身份和阶段动态判断聊天框状态
    if (data.currentPhase === 'night' && this.myRole === '狼人') {
      this.setChatEnabled(true);
      this.chatInput.placeholder = '狼人频道讨论中...';
    } else if (data.currentPhase === 'day') {
      // 白天默认禁用，等待发言回合开启
      this.setChatEnabled(false);
    } else {
      this.setChatEnabled(false);
    }

    this.updatePlayersGrid(data.players);

    // 保存自己的存活状态
    this.myIsAlive = data.myIsAlive !== false;

    // 恢复动作面板 (只有存活玩家且未行动才能看到)
    if (data.actionRequired && this.myIsAlive && !data.hasActed) {
      this.onActionRequired(data.actionRequired);
    } else {
      this.actionPanel.style.display = 'none';
    }

    // 恢复投票面板 (只有存活玩家且未投票才能看到)
    if (data.currentPhase === 'vote' && data.candidates && this.myIsAlive && !data.hasVoted) {
      this.showVotePanel(data.candidates);
    } else {
      this.votePanel.style.display = 'none';
    }

    // 恢复发言状态
    if (data.speakingTurn) {
      this.onSpeakingTurn(data.speakingTurn);
    } else if (data.currentPhase !== 'night') {
      this.hideSpeakPanel();
    }

    // 恢复倒计时
    if (data.countdown > 0) {
      this.onCountdown({ seconds: data.countdown });
    }

    // 恢复狼人频道记录
    if (data.wolfChatHistory && data.wolfChatHistory.length > 0) {
      // 可以在这里特殊处理，或者直接加入到消息列表中（如果前端还没收到过的话）
      // 注意：onRoomState 会清空 messages 列表并重新填充，所以我们在下面统一处理
    }

    // 恢复消息记录（合并系统消息、公共消息和狼人消息）
    if ((data.messages && data.messages.length > 0) || (data.wolfChatHistory && data.wolfChatHistory.length > 0)) {
      this.messages.innerHTML = '';
      const allMessages = [...(data.messages || [])];

      // 如果是狼人，加入狼人历史
      if (this.myRole === '狼人' && data.wolfChatHistory) {
        data.wolfChatHistory.forEach((wm) => {
          // 标记为狼人消息
          allMessages.push({ ...wm, isWolf: true });
        });
      }

      // 按时间排序
      allMessages.sort((a, b) => (a.time || 0) - (b.time || 0));

      allMessages.forEach((msg) => {
        if (msg.from === 'system') {
          this.addSystemMessage(msg.content);
        } else if (msg.from === 'host') {
          this.addMessage(msg.from, msg.content, 'host');
        } else if (msg.isWolf) {
          this.addMessage(`[狼人] ${msg.from}`, msg.content, 'wolf');
        } else {
          this.addMessage(msg.from, msg.content);
        }
      });
    }
  }

  // 暂停游戏（房主）
  pauseGame() {
    if (!this.isHost) {
      this.showToast('只有房主可以暂停游戏', 'error');
      return;
    }
    this.send('pause_game');
  }

  // 恢复游戏（房主）
  resumeGame() {
    if (!this.isHost) {
      this.showToast('只有房主可以恢复游戏', 'error');
      return;
    }
    this.send('resume_game');
  }

  // 退出游戏
  exitGame() {
    if (confirm('确定要退出游戏吗？退出后游戏将继续进行。')) {
      this.send('exit_game');
    }
  }

  // 游戏暂停
  onGamePaused(data) {
    this.isPaused = true;
    this.showToast('游戏已暂停', 'warning');

    // 显示暂停指示器
    const pausedIndicator = document.getElementById('pausedIndicator');
    const pauseBtn = document.getElementById('pauseGameBtn');
    const resumeBtn = document.getElementById('resumeGameBtn');

    if (pausedIndicator) pausedIndicator.style.display = 'inline-block';
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (resumeBtn && this.isHost) resumeBtn.style.display = 'inline-block';

    this.hideCountdown();
  }

  // 游戏恢复
  onGameResumed(data) {
    this.isPaused = false;
    this.showToast('游戏已恢复', 'success');

    const pausedIndicator = document.getElementById('pausedIndicator');
    const pauseBtn = document.getElementById('pauseGameBtn');
    const resumeBtn = document.getElementById('resumeGameBtn');

    if (pausedIndicator) pausedIndicator.style.display = 'none';
    if (pauseBtn && this.isHost) pauseBtn.style.display = 'inline-block';
    if (resumeBtn) resumeBtn.style.display = 'none';
  }

  // 退出游戏成功
  onExitedGame() {
    // 隐藏游戏结束弹窗
    const modal = document.getElementById('gameOverModal');
    if (modal) modal.style.display = 'none';

    this.currentRoom = null;
    this.myRole = null;
    localStorage.removeItem('currentRoom');
    this.messages.innerHTML = '';
    this.showScreen('lobby');
    this.showToast('已退出游戏', 'success');

    // 刷新房间列表
    this.refreshRooms();
  }

  // 房间解散
  onRoomClosed(data) {
    // 隐藏游戏结束弹窗
    const modal = document.getElementById('gameOverModal');
    if (modal) modal.style.display = 'none';

    this.currentRoom = null;
    this.myRole = null;
    localStorage.removeItem('currentRoom');
    this.messages.innerHTML = '';
    this.showScreen('lobby');
    this.showToast(`房间已解散: ${data.reason}`, 'info');

    // 刷新房间列表
    this.refreshRooms();
  }

  // 更新游戏控制按钮显示
  updateGameControls() {
    const pauseBtn = document.getElementById('pauseGameBtn');
    const resumeBtn = document.getElementById('resumeGameBtn');

    if (this.isHost && !this.isPaused) {
      if (pauseBtn) pauseBtn.style.display = 'inline-block';
      if (resumeBtn) resumeBtn.style.display = 'none';
    } else if (this.isHost && this.isPaused) {
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (resumeBtn) resumeBtn.style.display = 'inline-block';
    } else {
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (resumeBtn) resumeBtn.style.display = 'none';
    }
  }

  // 切换屏幕
  showScreen(screenName) {
    Object.values(this.screens).forEach((screen) => {
      screen.classList.remove('active');
    });
    this.screens[screenName].classList.add('active');
  }

  // 显示 Toast
  showToast(message, type = '') {
    this.toast.textContent = message;
    this.toast.className = `toast show ${type}`;

    setTimeout(() => {
      this.toast.className = 'toast';
    }, 3000);
  }
}

// 启动客户端
document.addEventListener('DOMContentLoaded', () => {
  window.client = new WerewolfClient();
});
